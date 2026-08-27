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

router.get('/estaciones', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const r = await conSesion(req.perfil.id, async (c)=>{
      const q = await c.query('SELECT * FROM estaciones_publicas ORDER BY id');
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
