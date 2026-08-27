// srv/migrar.js — aplica sql/00..06 al arrancar.
// Existe porque el plan free de Render no da acceso a Shell: no hay dónde
// correr las migraciones a mano. Todos los .sql son idempotentes (create table
// if not exists / create or replace / on conflict), así que corren SIEMPRE, en
// cada arranque. Eso es a propósito: si una migración falla a medias, el
// siguiente deploy la reintenta sola — sin Shell, un "ya inicializada, salto"
// dejaría la base rota para siempre.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

// El orden importa: 00 crea el rol, 01 las tablas, 02 las políticas que
// dependen de ellas, 03 las funciones, 04/05 los datos base. 05-seed carga
// las 5 estaciones — sin él, inicializar_progreso() falla y no se puede
// crear ningún equipo.
const ARCHIVOS = [
  '00-roles.sql',
  '01-esquema.sql',
  '02-rls.sql',
  '03-funciones.sql',
  '04-docentes.sql',
  '05-seed.sql',
  '06-superadmin.sql'
];

// Deja en el log qué rol es el que está corriendo esto. En local es un
// superusuario (la imagen de postgres crea POSTGRES_USER así); en Render no.
// Esa diferencia decide si RLS puede funcionar como manda CONTRACT §3.1, así
// que conviene verla escrita y no suponerla.
async function diagnosticar(cliente) {
  const { rows } = await cliente.query(`
    select current_user as usuario,
           rolsuper     as es_superusuario,
           rolcreaterole as puede_crear_roles,
           rolbypassrls as bypasa_rls
    from pg_roles where rolname = current_user
  `);
  const r = rows[0] || {};
  console.log(`[migrar] rol=${r.usuario} superusuario=${r.es_superusuario} createrole=${r.puede_crear_roles} bypassrls=${r.bypasa_rls}`);
  return r;
}

// RLS solo aísla si el rol con el que se conecta la app NO es dueño de las
// tablas (o si es dueño y hay FORCE, que exige superusuario — ver 02-rls.sql).
// Si ninguna de las dos se cumple, la app ve TODO y las políticas son adorno.
// Eso no se puede detectar leyendo el código: hay que preguntárselo a la base.
async function auditarAislamiento(cliente) {
  const { rows } = await cliente.query(`
    select
      current_user as rol,
      (select count(*) from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relrowsecurity and pg_get_userbyid(c.relowner) = current_user
         and not c.relforcerowsecurity) as tablas_sin_aislar
  `);
  const n = Number(rows[0]?.tablas_sin_aislar || 0);
  if (n > 0) {
    console.warn(`[migrar] 🔓 RLS NO aísla: '${rows[0].rol}' es dueño de ${n} tabla(s) con RLS y sin FORCE — las ve todas.`);
    console.warn(`[migrar] 🔓 Para cerrarlo hay que conectar la app con un rol NO dueño (app_runtime) en DATABASE_URL_APP. Ver CONTRACT §3.1.`);
  } else {
    console.log('[migrar] 🔒 aislamiento por RLS efectivo para el rol de la app');
  }
}

export async function aplicarMigraciones() {
  const cliente = await pool.connect();
  const fallos = [];
  try {
    await diagnosticar(cliente);

    for (const archivo of ARCHIVOS) {
      const ruta = path.join(sqlDir, archivo);
      if (!fs.existsSync(ruta)) {
        console.warn(`[migrar] ⚠️  ${archivo} no existe — salto`);
        continue;
      }
      const sql = fs.readFileSync(ruta, 'utf8');
      // Una transacción por archivo: un fallo en 05 no revierte 01..04.
      try {
        await cliente.query('BEGIN');
        await cliente.query(sql);
        await cliente.query('COMMIT');
        console.log(`[migrar] ✓ ${archivo}`);
      } catch (err) {
        try { await cliente.query('ROLLBACK'); } catch {}
        console.error(`[migrar] ✗ ${archivo}: ${err.message}`);
        fallos.push({ archivo, mensaje: err.message });
      }
    }

    await auditarAislamiento(cliente);

    if (fallos.length === 0) {
      console.log('[migrar] ✅ migraciones completadas sin errores');
      return { ok: true, fallos: [] };
    }
    // No se tira el proceso abajo: el servidor levanta igual para que se
    // puedan leer los logs y el /health desde el panel de Render. Pero queda
    // gritado en el log qué falló, porque la app va a andar a medias.
    console.error(`[migrar] ⚠️  ${fallos.length} archivo(s) fallaron: ${fallos.map(f => f.archivo).join(', ')}`);
    return { ok: false, fallos };
  } finally {
    cliente.release();
  }
}

// Permite correrlo suelto también: `node srv/migrar.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  aplicarMigraciones()
    .then(r => { pool.end(); process.exit(r.ok ? 0 : 1); })
    .catch(err => { console.error('[migrar] error fatal:', err); pool.end(); process.exit(1); });
}
