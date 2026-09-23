import { Router } from 'express';
import { pool, conSesion } from '../db.js';
import { hashCodigo } from '../email.js';
import { generarCodigoEquipo } from '../util.js';
const router = Router();

// helper: verificar rol docente (RLS ya lo hace, pero early 403)
function esDocente(perfil){ return perfil?.rol==='docente'; }

// GET /todo-equipos — consola de super-admin (2026-08-26): la sección ya
// existía en el HTML pero nunca se llenaba de nada ("solo un adorno"). Las
// sesiones cross-docente ya viajan gratis por /sesiones (la policy RLS de
// sql/06-superadmin.sql ya le da a fglopez visibilidad total); acá falta
// el mismo alcance pero para equipos, así que se agrega esta ruta liviana.
// No hace ningún chequeo de rol extra a propósito — RLS es la autoridad
// real: para cualquier otro docente esto simplemente devuelve sus propios
// equipos (mismo resultado que ya podía ver en /equipos de sus sesiones),
// no una fuga de datos ajenos.
router.get('/todo-equipos', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const rows = await conSesion(req.perfil.id, async c=>{
      const q = await c.query(`
        SELECT e.id, e.nombre, e.sesion_id, s.nombre as sesion_nombre, s.docente_id, s.estado as sesion_estado,
               (SELECT count(*) FROM integrantes i WHERE i.equipo_id=e.id) as integrantes
        FROM equipos e JOIN sesiones s ON s.id=e.sesion_id
        ORDER BY s.creada_en DESC, e.nombre`);
      return q.rows;
    });
    res.json(rows);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

// sesiones CRUD
router.get('/sesiones', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const rows = await conSesion(req.perfil.id, async c=>{
      const q = await c.query('SELECT * FROM sesiones ORDER BY creada_en DESC');
      return q.rows;
    });
    res.json(rows);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
// P1 (plan-motor-misiones.md §"srv/rutas/docente.js — solo dos rutas"):
// acepta y persiste `mision_id`. Si no viene, usa `misiones_publicas()`
// (sql/03-funciones.sql, agregada por la coordinadora tras reportar que
// `misiones` es deny-all salvo super-admin): exactamente una misión
// publicada → esa; cero o más de una → 400 parametros_faltantes.
router.post('/sesiones', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { nombre, duracion_minutos } = req.body||{};
  let { mision_id } = req.body||{};
  if(!nombre) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const row = await conSesion(req.perfil.id, async c=>{
      if(!mision_id){
        const m = await c.query('SELECT * FROM misiones_publicas()');
        if(m.rows.length !== 1) throw new Error('parametros_faltantes');
        mision_id = m.rows[0].id;
      }
      const q = await c.query('INSERT INTO sesiones (nombre, docente_id, duracion_minutos, mision_id) VALUES ($1,$2,$3,$4) RETURNING *', [String(nombre).trim(), req.perfil.id, Number(duracion_minutos)||50, mision_id]);
      return q.rows[0];
    });
    res.json(row);
  }catch(e){
    if(e.message==='parametros_faltantes') return res.status(400).json({ error:'parametros_faltantes' });
    console.error(e); res.status(500).json({ error:'error_interno' });
  }
});
// DELETE /sesiones/:id — 2026-08-26, distinto de "cerrar" (que solo marca
// estado='cerrada' y conserva todo). Esto borra la fila de verdad; el
// esquema ya tiene `on delete cascade` desde equipos/nomina hacia abajo
// (integrantes, intentos, progreso, codigos_equipo), así que no deja
// huérfanos. RLS de `sesiones` (for all) ya cubre DELETE — solo el docente
// dueño (o super-admin) puede borrar la suya; 0 filas afectadas = 404.
router.delete('/sesiones/:id', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const borrada = await conSesion(req.perfil.id, async c=>{
      const q = await c.query('DELETE FROM sesiones WHERE id=$1 RETURNING id', [req.params.id]);
      return q.rowCount > 0;
    });
    if(!borrada) return res.status(404).json({ error:'no_encontrada_o_no_autorizado' });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.post('/sesiones/:id/abrir', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    await conSesion(req.perfil.id, async c=>{ await c.query("UPDATE sesiones SET estado='abierta' WHERE id=$1", [req.params.id]); });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.post('/sesiones/:id/cerrar', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const out = await conSesion(req.perfil.id, async c=>{ const q=await c.query('SELECT cerrar_sesion_clase($1) as datos', [req.params.id]); return q.rows[0]?.datos; });
    res.json(out||{ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

// nómina
router.get('/nomina', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const sesionId = req.query.sesionId;
  if(!sesionId) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const rows = await conSesion(req.perfil.id, async c=>{
      const q=await c.query('SELECT * FROM nomina WHERE sesion_id=$1 ORDER BY creada_en', [sesionId]);
      return q.rows;
    });
    res.json(rows);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.post('/nomina', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { sesion_id, nombre, correo, carne } = req.body||{};
  if(!sesion_id||!nombre||!correo||!carne) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const row = await conSesion(req.perfil.id, async c=>{
      const q=await c.query('INSERT INTO nomina (sesion_id, nombre, correo, carne) VALUES ($1,$2,$3,$4) RETURNING *', [sesion_id, String(nombre).trim(), String(correo).trim().toLowerCase(), String(carne).trim()]);
      return q.rows[0];
    });
    res.json(row);
  }catch(e){ console.error(e); res.status(400).json({ error: e.message||'no_se_pudo_agregar' }); }
});

// 2026-08-26: ya no exige `perfil_id IS NOT NULL` — antes esta lista solo
// mostraba estudiantes que ya se habían autoregistrado por correo/OTP, lo
// cual no tiene sentido con el acceso por código de equipo (el docente arma
// equipos ANTES de que nadie haya entrado nunca). Devuelve `nominaId`
// siempre y `perfilId` solo si ya existe — /equipos/:id/asignar acepta
// cualquiera de los dos.
router.get('/registrados/:sesion', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const rows = await conSesion(req.perfil.id, async c=>{
      const q=await c.query(`
        SELECT n.id as "nominaId", n.perfil_id as "perfilId", n.nombre, n.correo, n.carne
        FROM nomina n
        WHERE n.sesion_id=$1
          AND (n.perfil_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM integrantes i JOIN equipos e ON e.id=i.equipo_id
            WHERE e.sesion_id=$1 AND i.perfil_id=n.perfil_id
          ))
        ORDER BY n.creada_en`, [req.params.sesion]);
      return q.rows;
    });
    res.json(rows);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

// equipos
router.post('/equipos', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { sesion_id, nombre } = req.body||{};
  if(!sesion_id||!nombre) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const row = await conSesion(req.perfil.id, async c=>{
      const q=await c.query('INSERT INTO equipos (sesion_id, nombre) VALUES ($1,$2) RETURNING *', [sesion_id, String(nombre).trim()]);
      // P1: reemplaza el `for(let i=1;i<=5;i++)` cableado a 5 salas fijas —
      // ahora usa inicializar_progreso_equipo(uuid) (sql/03-funciones.sql),
      // que deriva las salas de la misión de la sesión del equipo y respeta
      // `desbloqueo` por sala. Misma función que va a reusar P6-servidor.
      await c.query('SELECT inicializar_progreso_equipo($1)', [q.rows[0].id]);
      return q.rows[0];
    });
    res.json(row);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
// DELETE /equipos/:id — 2026-08-26: no existía ninguna forma de borrar un
// equipo completo (solo "Quitar" a un integrante por vez). RLS de `equipos`
// (policy "for all") ya cubre DELETE para el docente dueño de la sesión;
// integrantes/progreso/intentos/codigos_equipo/calificaciones cascadean
// desde equipos.id (§01-esquema), así que no deja huérfanos.
router.delete('/equipos/:id', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const borrado = await conSesion(req.perfil.id, async c=>{
      const q = await c.query('DELETE FROM equipos WHERE id=$1 RETURNING id', [req.params.id]);
      return q.rowCount > 0;
    });
    if(!borrado) return res.status(404).json({ error:'no_encontrado_o_no_autorizado' });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
// 2026-08-26: acepta `nominaId` además de `perfilId` — el flujo de acceso
// por código de equipo arma equipos ANTES de que nadie se haya registrado,
// así que la fila de nómina puede no tener perfil todavía. Si no lo tiene,
// se crea acá mismo con crear_o_recuperar_perfil() (misma función que usaba
// el registro por correo — nombre/carné siguen saliendo de la nómina, no de
// lo que nadie teclee) y recién entonces se arma el vínculo.
router.post('/equipos/:id/asignar', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { perfilId, nominaId } = req.body||{};
  if(!perfilId && !nominaId) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    await conSesion(req.perfil.id, async c=>{
      let idAUsar = perfilId;
      if(!idAUsar){
        const n = await c.query('SELECT correo, perfil_id FROM nomina WHERE id=$1', [nominaId]);
        if(!n.rows.length) throw new Error('nomina_no_encontrada');
        idAUsar = n.rows[0].perfil_id;
        if(!idAUsar){
          const pr = await c.query('SELECT (crear_o_recuperar_perfil($1)).*', [n.rows[0].correo]);
          idAUsar = pr.rows[0]?.id;
          // Sin esto, `nomina.perfil_id` se quedaba NULL para siempre en el
          // camino por nominaId (el único que usa la pantalla hoy): el
          // filtro de /registrados (`n.perfil_id IS NULL OR NOT EXISTS(...)`)
          // seguía tomando a estos estudiantes como "sin equipo" aunque ya
          // estuvieran asignados, y volvían a aparecer con botón "Asignar →".
          if(idAUsar) await c.query('UPDATE nomina SET perfil_id=$1 WHERE id=$2', [idAUsar, nominaId]);
        }
      }
      if(!idAUsar) throw new Error('no_se_pudo_resolver_perfil');
      await c.query('INSERT INTO integrantes (equipo_id, perfil_id) VALUES ($1,$2)', [req.params.id, idAUsar]);
    });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(400).json({ error: e.message||'no_se_pudo_asignar' }); }
});

// POST /equipos/:id/codigo — genera (o regenera) el código de acceso del
// equipo. Devuelve el código EN CLARO una sola vez — a partir de acá solo
// se guarda su hash, no hay forma de volver a mostrarlo sin regenerarlo.
router.post('/equipos/:id/codigo', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const horas = Math.min(Math.max(Number(req.body?.horasValidez)||4, 1), 24);
  try{
    const codigo = generarCodigoEquipo();
    const hash = hashCodigo(codigo);
    const expira = new Date(Date.now() + horas*60*60*1000);
    await conSesion(req.perfil.id, async c=>{
      // El SELECT contra `equipos` sí tiene RLS real — si esto no devuelve
      // fila, quien llama no es docente de ese equipo (o no existe), y no
      // debe poder escribir en codigos_equipo (que no tiene RLS propio).
      const eq = await c.query('SELECT id FROM equipos WHERE id=$1', [req.params.id]);
      if(!eq.rows.length) throw new Error('equipo_no_encontrado_o_no_autorizado');
      await c.query(`INSERT INTO codigos_equipo (equipo_id, codigo_hash, expira_en, creado_en)
        VALUES ($1,$2,$3, now())
        ON CONFLICT (equipo_id) DO UPDATE SET codigo_hash=$2, expira_en=$3, creado_en=now()`,
        [req.params.id, hash, expira]);
    });
    res.json({ ok:true, codigo, expiraEn: expira.toISOString() });
  }catch(e){ console.error(e); res.status(400).json({ error: e.message||'no_se_pudo_generar' }); }
});
router.post('/equipos/:id/desasignar', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { perfilId } = req.body||{};
  if(!perfilId) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    await conSesion(req.perfil.id, async c=>{ await c.query('DELETE FROM integrantes WHERE equipo_id=$1 AND perfil_id=$2', [req.params.id, perfilId]); });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.post('/equipos/:id/apuntador', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const { perfilId } = req.body||{};
  if(!perfilId) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    await conSesion(req.perfil.id, async c=>{ await c.query('SELECT marcar_apuntador($1,$2)', [req.params.id, perfilId]); });
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(400).json({ error:e.message||'no_se_pudo_marcar' }); }
});

router.get('/desempeno/:sesion', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const rows = await conSesion(req.perfil.id, async c=>{
      const q=await c.query('SELECT * FROM v_desempeno WHERE sesion_id=$1', [req.params.sesion]);
      return q.rows;
    });
    res.json(rows);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.get('/calificaciones/:equipo', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const row = await conSesion(req.perfil.id, async c=>{
      const q=await c.query('SELECT * FROM calificaciones WHERE equipo_id=$1', [req.params.equipo]);
      return q.rows[0] || null;
    });
    res.json(row);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.post('/calificaciones/:equipo', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const rubrica = req.body||{};
  try{
    const row = await conSesion(req.perfil.id, async c=>{
      const q=await c.query(`INSERT INTO calificaciones (equipo_id, uso_evidencia, distincion_dato, pensamiento_critico, trabajo_equipo, nota_final, observaciones)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (equipo_id) DO UPDATE SET uso_evidencia=EXCLUDED.uso_evidencia, distincion_dato=EXCLUDED.distincion_dato, pensamiento_critico=EXCLUDED.pensamiento_critico, trabajo_equipo=EXCLUDED.trabajo_equipo, nota_final=EXCLUDED.nota_final, observaciones=EXCLUDED.observaciones, actualizada_en=now()
        RETURNING *`, [req.params.equipo, rubrica.uso_evidencia||null, rubrica.distincion_dato||null, rubrica.pensamiento_critico||null, rubrica.trabajo_equipo||null, rubrica.nota_final||null, rubrica.observaciones||null]);
      return q.rows[0];
    });
    res.json(row);
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
// El editor de contenido (GET/PUT estaciones, validadores) se movió a
// srv/rutas/contenido.js en P4 (plan-motor-misiones.md): ahora las salas
// pertenecen a una misión (mision_id, orden), no son 5 fijas globales.

router.post('/anonimizar/:sesion', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  try{
    const out = await conSesion(req.perfil.id, async c=>{ const q=await c.query('SELECT anonimizar_sesion($1) as datos', [req.params.sesion]); return q.rows[0]?.datos; });
    res.json(out||{ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

export default router;
