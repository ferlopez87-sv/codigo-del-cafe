import pg from 'pg';
const { Pool } = pg;

const connStr = process.env.DATABASE_URL_APP || process.env.DATABASE_URL;
if (!connStr) console.warn('[db] DATABASE_URL_APP no definida — define en .env o Render Environment');

export const pool = new Pool({
  connectionString: connStr,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10
});

// patrón obligatorio §4.3: set_config app.usuario_actual por transacción, is_local=true
export async function conSesion(perfilId, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.usuario_actual', $1, true)", [perfilId || '']);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    cliente.release();
  }
}
