// srv/migrar.js — aplica sql/00..06 al arrancar.
// Existe porque el plan free de Render no da acceso a Shell: no hay dónde
// correr las migraciones a mano. Todos los .sql son idempotentes (create table
// if not exists / create or replace / on conflict), así que corren SIEMPRE, en
// cada arranque. Eso es a propósito: si una migración falla a medias, el
// siguiente deploy la reintenta sola — sin Shell, un "ya inicializada, salto"
// dejaría la base rota para siempre.
//
// Dos conexiones distintas, a propósito (CONTRACT §3.1):
//   DATABASE_URL      → rol dueño. Migra: crea tablas, políticas, siembra.
//   DATABASE_URL_APP  → rol app_runtime, NO dueño. Lo usa el servidor, y es
//                       el único al que RLS puede restringir de verdad.
// Si las dos apuntan al mismo rol dueño, la app ve todo y las políticas son
// decorativas. Por eso al final se audita contra la base y se avisa.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import pg from 'pg';
import { pool } from './db.js';
import { hashCodigo } from './email.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

// Contraseña de desarrollo que vive en el repo (docker-compose la usa). En
// producción NO sirve: es pública. APP_RUNTIME_PASSWORD la reemplaza.
const CLAVE_DEV = 'app_runtime_pw';

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

function poolAdmin() {
  const cs = process.env.DATABASE_URL || process.env.DATABASE_URL_APP;
  if (!process.env.DATABASE_URL && process.env.DATABASE_URL_APP) {
    console.warn('[migrar] DATABASE_URL no definida — migrando con DATABASE_URL_APP. Funciona solo mientras ese rol sea el dueño de las tablas.');
  }
  return new Pool({
    connectionString: cs,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 2
  });
}

// Deja en el log qué rol corre las migraciones. En local es superusuario (la
// imagen de postgres crea POSTGRES_USER así); en un Postgres administrado no.
// Esa diferencia decide si FORCE RLS se puede usar — ver 02-rls.sql.
async function diagnosticar(cliente) {
  const { rows } = await cliente.query(`
    select current_user as usuario,
           rolsuper      as es_superusuario,
           rolcreaterole as puede_crear_roles,
           rolbypassrls  as bypasa_rls
    from pg_roles where rolname = current_user
  `);
  const r = rows[0] || {};
  console.log(`[migrar] rol=${r.usuario} superusuario=${r.es_superusuario} createrole=${r.puede_crear_roles} bypassrls=${r.bypasa_rls}`);
  return r;
}

// app_runtime tiene que existir con una clave que NO esté en el repo, y con
// permisos sobre todo lo que 01..06 acaban de crear. Se rehace en cada arranque
// porque es barato y idempotente, y porque ALTER DEFAULT PRIVILEGES solo cubre
// lo creado después de correr — no lo que ya existía.
async function asegurarRolApp(cliente, capacidades) {
  const clave = process.env.APP_RUNTIME_PASSWORD;
  const enProduccion = process.env.NODE_ENV === 'production';

  if (!clave) {
    if (enProduccion) console.warn('[migrar] APP_RUNTIME_PASSWORD no definida — no puedo darle una clave propia a app_runtime.');
    return;
  }
  if (enProduccion && clave === CLAVE_DEV) {
    console.error('[migrar] ❌ APP_RUNTIME_PASSWORD es la clave de desarrollo, que está publicada en el repo. Poné otra.');
    return;
  }
  if (!capacidades.puede_crear_roles && !capacidades.es_superusuario) {
    console.warn('[migrar] el rol actual no puede crear/alterar roles — omito app_runtime.');
    return;
  }

  await cliente.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
        create role app_runtime login;
      end if;
    end $$;
  `);
  // La clave va por fuera del DO porque ALTER ROLE ... PASSWORD no acepta
  // parámetros: se arma con format(%L) para que quede escapada igual.
  const { rows } = await cliente.query(
    `select format('alter role app_runtime login password %L', $1::text) as sql`,
    [clave]
  );
  await cliente.query(rows[0].sql);

  await cliente.query(`
    grant usage on schema public, app to app_runtime;
    grant select, insert, update, delete on all tables in schema public to app_runtime;
    grant usage, select on all sequences in schema public to app_runtime;
    grant execute on all functions in schema public to app_runtime;
    grant execute on function app.usuario_actual() to app_runtime;
  `);
  console.log('[migrar] app_runtime listo con clave propia y permisos al día');
}

// Problema de arranque: en una base recién creada no hay NINGÚN código.
// 04-docentes.sql solo llena la lista blanca (docentes_autorizados), que
// habilita el alta pero no es una credencial. Las tres tablas de códigos
// (personales, equipo, verificación) nacen vacías, así que /verificar
// responde codigo_invalido — correctamente: no hay nada contra qué comparar.
// La otra vía, el OTP por correo, depende de que Resend pueda entregar, y en
// sandbox solo entrega a la casilla dueña de la cuenta. Resultado: nadie
// puede entrar la primera vez.
// Esto sirve el primer código personal desde una variable de entorno, que es
// la única superficie de escritura disponible sin Shell.
async function sembrarCodigoDocente(cliente) {
  const codigo = process.env.BOOTSTRAP_DOCENTE_CODIGO;
  if (!codigo) return;

  let correo = (process.env.BOOTSTRAP_DOCENTE_CORREO || '').trim().toLowerCase();
  if (!correo) {
    // Sin correo explícito: si la lista blanca tiene exactamente uno, es ese.
    const { rows } = await cliente.query('select correo from docentes_autorizados limit 2');
    if (rows.length !== 1) {
      console.warn('[migrar] BOOTSTRAP_DOCENTE_CODIGO definido pero no sé para qué correo — definí BOOTSTRAP_DOCENTE_CORREO.');
      return;
    }
    correo = rows[0].correo;
  }

  const { rows } = await cliente.query('select 1 from docentes_autorizados where correo=$1', [correo]);
  if (!rows.length) {
    console.warn(`[migrar] ${correo} no está en docentes_autorizados — el código no serviría (el alta lo rechazaría). Omito.`);
    return;
  }

  // hashCodigo es HMAC con COOKIE_SECRET: si esa variable cambia, todos los
  // códigos guardados dejan de validar. Por eso se resiembra en cada arranque.
  await cliente.query(
    `insert into codigos_personales (correo, codigo_hash, expira_en, creado_en)
     values ($1, $2, null, now())
     on conflict (correo) do update set codigo_hash = excluded.codigo_hash, expira_en = null`,
    [correo, hashCodigo(codigo)]
  );
  console.log(`[migrar] código personal de arranque servido para ${correo} (no vence)`);
}

// RLS solo aísla si el rol con el que se conecta la APP no es dueño de las
// tablas (o si es dueño y hay FORCE, que exige superusuario — ver 02-rls.sql).
// Se pregunta desde el pool de la app, no desde el de migraciones: lo que
// importa es con qué rol va a atender las peticiones, no con cuál migró.
async function auditarAislamiento() {
  let cliente;
  try {
    cliente = await pool.connect();
  } catch (err) {
    console.error(`[migrar] ⚠️  el rol de la app no puede conectarse: ${err.message}`);
    return;
  }
  try {
    const { rows } = await cliente.query(`
      select current_user as rol,
        (select count(*) from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relrowsecurity and pg_get_userbyid(c.relowner) = current_user
            and not c.relforcerowsecurity) as sin_aislar
    `);
    const n = Number(rows[0]?.sin_aislar || 0);
    if (n > 0) {
      console.warn(`[migrar] 🔓 RLS NO aísla: la app corre como '${rows[0].rol}', dueño de ${n} tabla(s) con RLS y sin FORCE — las ve todas.`);
      console.warn('[migrar] 🔓 Apuntá DATABASE_URL_APP a app_runtime (y DATABASE_URL al rol dueño). Ver CONTRACT §3.1.');
    } else {
      console.log(`[migrar] 🔒 aislamiento efectivo: la app corre como '${rows[0].rol}' y RLS la restringe`);
    }
  } finally {
    cliente.release();
  }
}

export async function aplicarMigraciones() {
  const admin = poolAdmin();
  const cliente = await admin.connect();
  const fallos = [];
  try {
    const capacidades = await diagnosticar(cliente);

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

    try {
      await asegurarRolApp(cliente, capacidades);
    } catch (err) {
      console.error(`[migrar] ✗ app_runtime: ${err.message}`);
    }

    try {
      await sembrarCodigoDocente(cliente);
    } catch (err) {
      console.error(`[migrar] ✗ código de arranque: ${err.message}`);
    }

    if (fallos.length) {
      console.error(`[migrar] ⚠️  ${fallos.length} archivo(s) fallaron: ${fallos.map(f => f.archivo).join(', ')}`);
    } else {
      console.log('[migrar] ✅ migraciones completadas sin errores');
    }
  } finally {
    cliente.release();
    await admin.end();
  }

  // Después de cerrar la conexión de dueño, para que mida el estado final.
  await auditarAislamiento();
  return { ok: fallos.length === 0, fallos };
}

// Permite correrlo suelto también: `node srv/migrar.js`
//
// La comparación va contra pathToFileURL(argv[1]), no contra `file://` + la
// ruta cruda. argv[1] llega tal cual lo escribió quien invoca — normalmente
// relativo ("srv/migrar.js") — y aunque sea absoluto, una URL codifica espacios
// y acentos (%20, %C3%B3). Este proyecto vive en ".../My Drive/Escuela Mónica
// Herrera/...", así que las dos cadenas no coincidían nunca: `npm run migrar`
// no hacía nada y salía con código 0, como si hubiera migrado. En Render no se
// notaba porque ahí la ruta es /app y el servidor llama a aplicarMigraciones()
// al arrancar, sin pasar por esta guarda.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  aplicarMigraciones()
    .then(r => pool.end().then(() => process.exit(r.ok ? 0 : 1)))
    .catch(err => { console.error('[migrar] error fatal:', err); pool.end().then(() => process.exit(1)); });
}
