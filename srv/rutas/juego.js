import { Router } from 'express';
import { pool, conSesion } from '../db.js';
const router = Router();

router.get('/mi-equipo', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const r = await conSesion(req.perfil.id, async (c)=>{
      const q = await c.query('SELECT mi_equipo() as datos');
      return q.rows[0]?.datos;
    });
    // mi_equipo ya incluye soy_apuntador/es_apuntador según §4.2; si es null → sin equipo
    if(!r) return res.json(null);
    res.json(r);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

// P1 (plan-motor-misiones.md): antes hacía `SELECT * FROM estaciones_publicas
// ORDER BY id` sin filtrar — devolvía TODAS las salas de TODAS las misiones a
// cualquier estudiante autenticado. Ahora se limita a la misión de la sesión
// del equipo de quien pregunta (perfil → integrantes → equipos → sesiones →
// mision_id). `sesiones` tiene política RLS real de lectura para el propio
// estudiante (sql/02-rls.sql, `sesiones_lectura_estudiante`) — no hace falta
// tocar `misiones` (deny-all salvo super-admin, ver 06-superadmin.sql) porque
// nunca se lee esa tabla directamente, solo `sesiones.mision_id`.
// Mismo criterio de "equipo actual" que `mi_equipo()` (sql/03-funciones.sql):
// `limit 1` sin order by, sin resolver histórico de más de un equipo.
router.get('/estaciones', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const r = await conSesion(req.perfil.id, async (c)=>{
      const q = await c.query(`
        SELECT ep.* FROM estaciones_publicas ep
        WHERE ep.mision_id = (
          SELECT s.mision_id
          FROM equipos e
          JOIN integrantes i ON i.equipo_id = e.id
          JOIN sesiones s ON s.id = e.sesion_id
          WHERE i.perfil_id = $1
          LIMIT 1
        )
        ORDER BY ep.orden`, [req.perfil.id]);
      return q.rows;
    });
    res.json(r);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

router.get('/estado/:equipo', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const datos = await conSesion(req.perfil.id, async (c)=>{
      const q = await c.query('SELECT estado_juego($1) as datos', [req.params.equipo]);
      return q.rows[0]?.datos;
    });
    res.json(datos);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

router.post('/verificar', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { equipo, estacion, respuesta } = req.body||{};
  if(!equipo || !estacion) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const out = await conSesion(req.perfil.id, async (c)=>{
      const q = await c.query('SELECT verificar_estacion($1,$2,$3) as datos', [equipo, Number(estacion), respuesta||{}]);
      return q.rows[0]?.datos;
    });
    res.json(out);
  }catch(e){
    const msg = e.message||'';
    if(msg.includes('no_apuntador')) return res.json({ error:'no_apuntador' });
    if(msg.includes('sin_apuntador')) return res.json({ error:'sin_apuntador' });
    if(msg.includes('no_autorizado')) return res.json({ error:'no_autorizado' });
    console.error(e); res.status(500).json({ error:'error_interno' });
  }
});

router.post('/verificar-maestro', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { equipo, codigo } = req.body||{};
  if(!equipo) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const out = await conSesion(req.perfil.id, async (c)=>{
      const q = await c.query('SELECT verificar_maestro($1,$2) as datos', [equipo, String(codigo||'')]);
      return q.rows[0]?.datos;
    });
    res.json(out);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

export default router;
