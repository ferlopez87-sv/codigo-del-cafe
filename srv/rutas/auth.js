import { Router } from 'express';
import crypto from 'crypto';
import { pool, conSesion } from '../db.js';
import { generarCodigo, hashCodigo, enviarCodigo } from '../email.js';

const router = Router();

function hashToken(token){ return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function normalizarCorreo(c){ return String(c||'').trim().toLowerCase(); }

// POST /api/auth/registrar { correo } — §5.1 (reenviar comparte lógica, con rate limit)
async function emitirOTP(correoRaw, res, checkRate){
  const correo = normalizarCorreo(correoRaw);
  if(!correo || !correo.includes('@')) return res.status(400).json({ error:'correo_invalido' });
  const codigo = generarCodigo();
  const codigoHash = hashCodigo(codigo);
  const expira = new Date(Date.now()+ 5*60*1000);
  // rate limit 45s si checkRate: ver creado_en en codigos_verificacion
  if(checkRate){
    const prev = await pool.query('SELECT creado_en FROM codigos_verificacion WHERE correo=$1', [correo]);
    if(prev.rows.length){
      const diff = Date.now() - new Date(prev.rows[0].creado_en).getTime();
      if(diff < 45000) return res.status(429).json({ error:'reenvio_muy_pronto', reintentar_en: Math.ceil((45000-diff)/1000) });
    }
  }
  await pool.query(`INSERT INTO codigos_verificacion (correo, codigo_hash, intentos, expira_en, creado_en)
    VALUES ($1,$2,0,$3, now())
    ON CONFLICT (correo) DO UPDATE SET codigo_hash=$2, intentos=0, expira_en=$3, creado_en=now()`, [correo, codigoHash, expira]);
  const envio = await enviarCodigo(correo, codigo);
  if(!envio.ok && !envio.local) return res.status(502).json({ error:'correo_no_enviado' });
  return res.json({ ok:true, correo });
}

router.post('/registrar', async (req,res)=>{
  try{ await emitirOTP(req.body?.correo, res, false); }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});
router.post('/reenviar', async (req,res)=>{
  try{ await emitirOTP(req.body?.correo, res, true); }catch(e){ console.error(e); res.status(500).json({ error:'error_interno' }); }
});

// Crea/recupera el perfil y emite la cookie de sesión — comparten esto tanto
// el OTP normal como el código personal sin vencimiento (abajo).
async function finalizarSesion(correo, req, res){
  // crear o recuperar perfil §2.1 — (crear_o_recuperar_perfil($1)).* expande
  // el composite `perfiles` directo en columnas tipadas. Antes esto hacía un
  // segundo SELECT plano a perfiles fuera de conSesion(): con app_runtime
  // realmente restringido (no superusuario, §3.1) ese SELECT chocaba con
  // RLS y devolvía 0 filas siempre — "no_se_pudo_crear_perfil" incluso con
  // el perfil ya creado. Se enmascaraba antes porque app_runtime era
  // superusuario por error de docker-compose.yml (bug real, corregido
  // 2026-08-26 al probar el acceso de super-admin).
  let perfil;
  try{
    const pr = await pool.query('SELECT (crear_o_recuperar_perfil($1)).*', [correo]);
    perfil = pr.rows[0];
  }catch(e){
    const msg = e.message||'';
    if(msg.includes('correo_no_esta_en_la_nomina')) return res.status(403).json({ error:'correo_no_esta_en_la_nomina_del_curso' });
    throw e;
  }
  if(!perfil) return res.status(500).json({ error:'no_se_pudo_crear_perfil' });
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expira = new Date(Date.now()+30*24*60*60*1000);
  await pool.query('INSERT INTO sesiones_login (token_hash, perfil_id, creada_en, expira_en, user_agent) VALUES ($1,$2, now(), $3, $4)', [tokenHash, perfil.id, expira, req.headers['user-agent']||'']);
  await pool.query('DELETE FROM codigos_verificacion WHERE correo=$1', [correo]);
  const secure = process.env.NODE_ENV==='production';
  res.cookie('sesion', token, { httpOnly:true, secure, sameSite:'Strict', maxAge:30*24*60*60*1000, path:'/' });
  return res.json({ ok:true, perfil });
}

// POST /api/auth/verificar { correo, codigo }
router.post('/verificar', async (req,res)=>{
  const correo = normalizarCorreo(req.body?.correo);
  const codigo = String(req.body?.codigo||'').trim();
  if(!correo || !codigo) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    // Código personal sin vencimiento (2026-08-26) — vía alterna al OTP para
    // cuando Resend en sandbox no puede entregarle nada a este correo (le
    // pasa incluso al docente con su propio correo institucional). Se
    // prueba primero porque no consume intentos ni tiene la lógica de
    // expiración/borrado del OTP; si no matchea, sigue el camino normal —
    // mismo formulario de siempre, sin pantalla nueva.
    const personal = await pool.query('SELECT codigo_hash, expira_en FROM codigos_personales WHERE correo=$1', [correo]);
    if(personal.rows.length){
      const p = personal.rows[0];
      const vigente = p.expira_en == null || new Date(p.expira_en) > new Date();
      if(vigente && hashCodigo(codigo) === p.codigo_hash){
        return await finalizarSesion(correo, req, res);
      }
    }

    // Código de equipo (2026-08-26) — el mismo formulario de "correo +
    // código" ahora también acepta el código que reparte el docente por
    // equipo, no solo el personal/OTP. codigos_equipo no está ligado a un
    // correo (lo comparte todo el equipo): el correo de este form es lo
    // que dice CUÁL integrante del equipo sos. Se prueba con
    // normalizarCodigoEquipo porque acá puede llegar en minúsculas o con
    // espacios, a diferencia del flujo de /equipo-por-codigo que ya lo pide
    // limpio desde el input (autocapitalize).
    const codigoEquipoNorm = normalizarCodigoEquipo(codigo);
    if(codigoEquipoNorm){
      const eq = await pool.query('SELECT equipo_id, expira_en FROM codigos_equipo WHERE codigo_hash=$1', [hashCodigo(codigoEquipoNorm)]);
      if(eq.rows.length){
        const { equipo_id, expira_en } = eq.rows[0];
        if(new Date(expira_en) >= new Date()){
          const integrantes = await pool.query('SELECT * FROM integrantes_de_equipo($1)', [equipo_id]);
          const yo = integrantes.rows.find(r => normalizarCorreo(r.correo) === correo);
          if(yo) return await finalizarSesion(correo, req, res);
        }
      }
    }

    const row = await pool.query('SELECT codigo_hash, intentos, expira_en FROM codigos_verificacion WHERE correo=$1', [correo]);
    if(!row.rows.length) return res.status(400).json({ error:'codigo_invalido' });
    const r = row.rows[0];
    if(new Date(r.expira_en) < new Date()) return res.status(400).json({ error:'codigo_vencido' });
    if(r.intentos >=5) return res.status(429).json({ error:'demasiados_intentos' });
    const ok = hashCodigo(codigo) === r.codigo_hash;
    if(!ok){
      await pool.query('UPDATE codigos_verificacion SET intentos=intentos+1 WHERE correo=$1', [correo]);
      return res.status(400).json({ error:'codigo_invalido' });
    }
    return await finalizarSesion(correo, req, res);
  }catch(e){
    console.error('[verificar]', e);
    return res.status(500).json({ error:'error_interno' });
  }
});

// POST /api/auth/generar-codigo-personal { correo } — genera un código sin
// vencimiento para ESE correo. Autoservicio: solo se puede generar para el
// correo de la sesión ya activa, o (si quien pide ya es super-admin) para
// cualquiera — así nadie mina un código de reingreso permanente para una
// identidad que no es la suya sin ya estar autenticado como esa identidad.
router.post('/generar-codigo-personal', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  const correo = normalizarCorreo(req.body?.correo || req.perfil.correo);
  const esUnoMismo = correo === normalizarCorreo(req.perfil.correo);
  const esSuperAdmin = normalizarCorreo(req.perfil.correo) === 'fglopez@monicaherrera.edu.sv';
  if(!esUnoMismo && !esSuperAdmin) return res.status(403).json({ error:'no_autorizado' });
  try{
    const codigo = generarCodigo(); // mismo generador que el OTP (6 dígitos), reutilizado
    const hash = hashCodigo(codigo);
    await pool.query(`INSERT INTO codigos_personales (correo, codigo_hash, expira_en, creado_en)
      VALUES ($1,$2, NULL, now())
      ON CONFLICT (correo) DO UPDATE SET codigo_hash=$2, expira_en=NULL, creado_en=now()`, [correo, hash]);
    res.json({ ok:true, correo, codigo });
  }catch(e){ console.error('[generar-codigo-personal]', e); res.status(500).json({ error:'error_interno' }); }
});

// ---------------------------------------------------------------------------
// Acceso por código de equipo (2026-08-26) — reemplaza el correo OTP como vía
// principal para estudiantes: el docente genera un código por equipo
// (srv/rutas/docente.js) y lo distribuye él mismo, la app nunca lo envía.
// Dos pasos: 1) el código solo revela quiénes son los integrantes (nombres,
// nada más) para que la persona elija quién es; 2) confirmar identidad emite
// la cookie de sesión, igual que /verificar.
// ---------------------------------------------------------------------------
function normalizarCodigoEquipo(c){
  return String(c||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
}

// POST /api/auth/equipo-por-codigo { codigo } — público, pre-identidad.
// Nunca revela más que nombres del propio equipo — ni correo, ni carné, ni
// a qué sesión de clase pertenece.
router.post('/equipo-por-codigo', async (req,res)=>{
  const codigo = normalizarCodigoEquipo(req.body?.codigo);
  if(!codigo) return res.status(400).json({ error:'codigo_invalido' });
  try{
    const hash = hashCodigo(codigo);
    const row = await pool.query('SELECT equipo_id, expira_en FROM codigos_equipo WHERE codigo_hash=$1', [hash]);
    if(!row.rows.length) return res.status(400).json({ error:'codigo_invalido' });
    const { equipo_id, expira_en } = row.rows[0];
    if(new Date(expira_en) < new Date()) return res.status(400).json({ error:'codigo_vencido' });
    const eq = await pool.query('SELECT nombre_de_equipo($1) as nombre', [equipo_id]);
    // ya_entro (2026-08-28): para que la pantalla de "¿quién sos?" marque
    // como tomados a quienes ya entraron — no revela nada más que antes.
    const integrantes = await pool.query('SELECT perfil_id, nombre, ya_entro FROM integrantes_de_equipo($1)', [equipo_id]);
    return res.json({ equipoId: equipo_id, equipoNombre: eq.rows[0]?.nombre||'', integrantes: integrantes.rows });
  }catch(e){ console.error('[equipo-por-codigo]', e); res.status(500).json({ error:'error_interno' }); }
});

// POST /api/auth/acceso-equipo { codigo, perfilId } — confirma quién sos
// dentro del equipo que ya reveló el paso anterior y emite la sesión.
router.post('/acceso-equipo', async (req,res)=>{
  const codigo = normalizarCodigoEquipo(req.body?.codigo);
  const perfilId = String(req.body?.perfilId||'').trim();
  if(!codigo || !perfilId) return res.status(400).json({ error:'parametros_faltantes' });
  try{
    const hash = hashCodigo(codigo);
    const row = await pool.query('SELECT equipo_id, expira_en FROM codigos_equipo WHERE codigo_hash=$1', [hash]);
    if(!row.rows.length) return res.status(400).json({ error:'codigo_invalido' });
    const { equipo_id, expira_en } = row.rows[0];
    if(new Date(expira_en) < new Date()) return res.status(400).json({ error:'codigo_vencido' });
    const integrantes = await pool.query('SELECT * FROM integrantes_de_equipo($1)', [equipo_id]);
    const perfil = integrantes.rows.find(r=> r.perfil_id === perfilId);
    if(!perfil) return res.status(400).json({ error:'perfil_no_es_de_este_equipo' });

    // 2026-08-28 (pedido de Fernando): "si un usuario ya entró, otro no
    // puede usar su lugar". reclamar_lugar_equipo marca primer_acceso_en de
    // forma atómica (WHERE ... IS NULL) — si ya estaba marcado, no emite la
    // cookie. La búsqueda de arriba (equipo-por-codigo) ya avisa en la UI
    // qué nombres están tomados; esto es el cierre server-side por si dos
    // personas llegan a elegir el mismo nombre casi al mismo tiempo.
    const claim = await pool.query('SELECT reclamar_lugar_equipo($1,$2) as ok', [equipo_id, perfilId]);
    if(!claim.rows[0]?.ok) return res.status(409).json({ error:'lugar_ya_tomado' });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiraSesion = new Date(Date.now()+30*24*60*60*1000);
    await pool.query('INSERT INTO sesiones_login (token_hash, perfil_id, creada_en, expira_en, user_agent) VALUES ($1,$2, now(), $3, $4)',
      [tokenHash, perfil.perfil_id, expiraSesion, req.headers['user-agent']||'']);
    const secure = process.env.NODE_ENV==='production';
    res.cookie('sesion', token, { httpOnly:true, secure, sameSite:'Strict', maxAge:30*24*60*60*1000, path:'/' });
    return res.json({ ok:true, perfil: { id: perfil.perfil_id, nombre: perfil.nombre, correo: perfil.correo, carne: perfil.carne, rol: perfil.rol } });
  }catch(e){ console.error('[acceso-equipo]', e); res.status(500).json({ error:'error_interno' }); }
});

router.post('/salir', async (req,res)=>{
  const token = req.cookies?.sesion;
  if(token){
    const h = hashToken(token);
    try{ await pool.query('DELETE FROM sesiones_login WHERE token_hash=$1', [h]); }catch{}
  }
  res.clearCookie('sesion', { path:'/' });
  res.json({ ok:true });
});

router.get('/sesion', async (req,res)=>{
  if(!req.perfil) return res.status(401).json({ error:'no_autorizado' });
  res.json(req.perfil);
});

export default router;
