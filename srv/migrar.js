// srv/migrar.js — ejecuta migraciones SQL en orden
// Llamado desde index.js al iniciar (una sola vez)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { conectarAdmin } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, '..', 'sql');

// Migraciones en orden
const archivos = [
  '00-roles.sql',
  '01-esquema.sql',
  '02-rls.sql',
  '03-funciones.sql',
  '04-docentes.sql',
  '06-superadmin.sql'
];

export async function aplicarMigraciones() {
  const client = await conectarAdmin();
  try {
    // Verificar si ya se inicializó (tabla sesiones existe)
    const chk = await client.query(`
      SELECT EXISTS(SELECT 1 FROM information_schema.tables
                    WHERE table_name='sesiones') as existe
    `);

    if (chk.rows[0].existe) {
      console.log('[migrar] ✓ BD ya inicializada (tabla sesiones existe)');
      return true;
    }

    console.log('[migrar] iniciando aplicación de migraciones...');

    for (const archivo of archivos) {
      const ruta = path.join(sqlDir, archivo);
      if (!fs.existsSync(ruta)) {
        console.warn(`[migrar] ⚠️  saltando ${archivo} (no existe)`);
        continue;
      }

      const sql = fs.readFileSync(ruta, 'utf8');
      console.log(`[migrar] aplicando ${archivo}...`);

      try {
        await client.query(sql);
        console.log(`[migrar] ✓ ${archivo} OK`);
      } catch (err) {
        console.error(`[migrar] ✗ ERROR en ${archivo}:`, err.message);
        // Continuar con siguiente (algunos .sql pueden fallar si objeto ya existe)
        // pero si es un error crítico, el app finalizará
        if (archivo === '00-roles.sql' || archivo === '01-esquema.sql') {
          throw err; // Fallos en roles/esquema son fatales
        }
      }
    }

    console.log('[migrar] ✅ Migraciones completadas');
    return true;
  } catch (err) {
    console.error('[migrar] ❌ Error fatal:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

// Si se ejecuta directamente: node srv/migrar.js
if (import.meta.url === `file://${process.argv[1]}`) {
  aplicarMigraciones().then(
    () => { console.log('[migrar] saliendo exitosamente'); process.exit(0); },
    err => { console.error('[migrar] error:', err); process.exit(1); }
  );
}
