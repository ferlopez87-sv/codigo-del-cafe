import crypto from 'crypto';
import { pool } from '../db.js';

function hashToken(token){
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export async function sesionMiddleware(req,res,next){
  const token = req.cookies?.sesion;
  if(!token){
    req.perfil = null;
    return next();
  }
  const h = hashToken(token);
  try{
    // perfiles tiene RLS activo (solo lee la propia fila, §3.2) — en este punto
    // todavía no hay identidad seteada (app.usuario_actual() es null), así que
    // un SELECT directo a perfiles siempre devolvería 0 filas. obtener_perfil_por_token
    // es SECURITY DEFINER exactamente para resolver este huevo-y-gallina (CONTRACT §2.1/§4.2).
    const q = await pool.query('SELECT * FROM obtener_perfil_por_token($1)', [h]);
    if(!q.rows.length){
      req.perfil=null; return next();
    }
    const row = q.rows[0];
    if(new Date(row.expira_en) < new Date()){
      req.perfil=null; return next();
    }
    req.perfil = { id: row.id, nombre: row.nombre, carne: row.carne, correo: row.correo, rol: row.rol };
    req.perfilId = row.id;
    next();
  }catch(e){
    console.error('[sesion] error', e);
    req.perfil=null; next();
  }
}

export function requiereSesion(req,res,next){
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  next();
}
