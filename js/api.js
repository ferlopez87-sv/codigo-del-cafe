// _src/js/api.js — cl-api — ÚNICO archivo que conoce Supabase URL y anon key (CONTRACT §5, §14.1)
// Vanilla JS type:module — sin SDK, sin inyección de HTML, con textContent para errores en consumidores.
// Toda función async, devuelve { datos, error } nunca lanza (CONTRACT §14.5).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { estaEnDemo, activarDemo, generarCodigoDemo, verificarCodigoDemo, ESTACIONES_DEMO, validarDemo } from './demo.js';

const STORAGE_KEY = 'cc_sesion';
const DEMO_ESTADO_KEY = 'cc_demo_estado';

// ---------------------------------------------------------------------------
// Modo demo — mocks sin Supabase (cuando email llega al límite)
// ---------------------------------------------------------------------------
async function mockDemo(path, { method, body }){
  // Normalizar body a objeto si es string JSON
  let b=null;
  try{ b = typeof body==='string' ? JSON.parse(body) : body; }catch{ b=body; }
  // Auth OTP en demo: no hace fetch, genera código local y finge éxito
  if(path.startsWith('/auth/v1/otp')){
    const email=(b?.email||'').trim().toLowerCase();
    if(email){
      const code=generarCodigoDemo(email);
      // En demo mostramos el código directamente en la respuesta para que el UI lo pueda mostrar
      // y también lo dejamos en localStorage para verificar luego
      return { datos: { demo:true, code }, error: null };
    }
    return { datos:{}, error:null };
  }
  if(path.startsWith('/auth/v1/verify')){
    const email=(b?.email||'').trim().toLowerCase();
    const token=(b?.token||'').trim();
    const ok=verificarCodigoDemo(email, token);
    if(ok){
      const fake={ access_token:'demo-'+btoa(email).slice(0,16), refresh_token:'demo-refresh', expires_in:3600, token_type:'bearer', user:{email, id:'demo-'+btoa(email).slice(0,8)} };
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(fake)); }catch{}
      return { datos: fake, error: null };
    }
    return { datos:null, error:{ mensaje:'Código demo incorrecto', codigo:'codigo_invalido', estado:400 } };
  }
  // Estaciones públicas en demo: devolver ESTACIONES_DEMO expandidas con narrativa/datos mínimos
  if(path.startsWith('/rest/v1/estaciones_publicas')){
    const rows = ESTACIONES_DEMO.map(e=>({
      id:e.id, titulo:e.titulo, pilar:e.pilar,
      narrativa:`Narrativa demo para ${e.titulo} — modo sin correo, datos locales.`,
      datos:{ demo:true }, reto:`Reto demo ${e.id}`, interaccion:{ tipo: e.id===1?'orden': e.id===4?'checklist': e.id===5?'clasificacion':'numero' }
    }));
    return { datos: rows, error:null };
  }
  // RPCs demo
  if(path.startsWith('/rest/v1/rpc/mi_equipo')){
    const ses = leerSesionCruda();
    const email = ses?.user?.email || 'demo@local';
    return { datos: { equipo:{id:'demo-equipo-1', nombre:'Equipo Demo', iniciado_en:null, finalizado_en:null, motivo_fin:null}, sesion:{id:'demo-sesion-1', nombre:'Sesión Demo', estado:'abierta', duracion_minutos:50}, estaciones: Object.entries(JSON.parse(localStorage.getItem(DEMO_ESTADO_KEY)||'{}').estaciones||{}).map(([k,v])=>({estacion_id:parseInt(k), estado:v.estado, intentos:v.intentos})), integrantes:[{id:'demo-user', nombre: email.split('@')[0]}] }, error:null };
  }
  if(path.startsWith('/rest/v1/rpc/estado_juego')){
    const st = JSON.parse(localStorage.getItem(DEMO_ESTADO_KEY)||'{}');
    const ests = Object.entries(st.estaciones||{}).map(([k,v])=>({estacion_id:parseInt(k,10), estado:v.estado, intentos:v.intentos, codigo: v.estado==='resuelta' ? ESTACIONES_DEMO.find(x=>x.id===parseInt(k))?.codigo||null : null}));
    return { datos: { equipo:{id:'demo-equipo-1', nombre:'Equipo Demo', iniciado_en: st.iniciadoEn? new Date(st.iniciadoEn).toISOString(): null, finalizado_en: st.finalizado? new Date().toISOString(): null, motivo_fin: st.finalizado? 'completado': null}, sesion:{id:'demo-sesion-1', estado:'abierta', duracion_minutos:50}, estaciones: ests, resueltas: Object.values(st.estaciones||{}).filter(v=>v.estado==='resuelta').length, segundos_restantes: 1800, servidor_en: new Date().toISOString() }, error:null };
  }
  if(path.startsWith('/rest/v1/rpc/verificar_estacion')){
    // body: {p_equipo, p_estacion, p_respuesta}
    const p_est = b?.p_estacion || b?.p_estacion===0? b.p_estacion : (b?.estacion_id||1);
    const p_resp = b?.p_respuesta || b?.respuesta || {};
    const res = validarDemo(Number(p_est), p_resp);
    // Actualizar estado demo
    try{
      const st=JSON.parse(localStorage.getItem(DEMO_ESTADO_KEY)||'{}');
      if(st.estaciones && st.estaciones[p_est]){
        st.estaciones[p_est].intentos = (st.estaciones[p_est].intentos||0)+1;
        if(res.ok){
          st.estaciones[p_est].estado='resuelta';
          st.estaciones[p_est].resueltaEn=Date.now();
          // Desbloquear E5 si 1-4 resueltas
          const r4 = [1,2,3,4].every(k=> st.estaciones[k]?.estado==='resuelta');
          if(r4 && st.estaciones[5]) st.estaciones[5].estado='pendiente';
        } else {
          if(st.estaciones[p_est].estado!=='resuelta') st.estaciones[p_est].estado='progreso';
        }
        localStorage.setItem(DEMO_ESTADO_KEY, JSON.stringify(st));
      }
      const codigo = res.ok ? (ESTACIONES_DEMO.find(x=>x.id===Number(p_est))?.codigo||null) : null;
      const intentos = st.estaciones[p_est]?.intentos||1;
      if(res.ok) return { datos: {ok:true, codigo, feedback:`¡Correcto! Código: ${codigo}`, intentos}, error:null };
      // Pista demo simple
      return { datos: {ok:false, detalle: res.detalle||'vacio', pista:'Revisá la pista demo', intentos, parcial: res.detalle?.startsWith('parcial')}, error:null };
    }catch(e){
      return { datos: {ok:res.ok, detalle:res.detalle}, error:null };
    }
  }
  if(path.startsWith('/rest/v1/rpc/verificar_maestro')){
    const p_codigo=(b?.p_codigo||b?.codigo||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    const esperado='0687042P4';
    const ok = p_codigo===esperado;
    return { datos: ok? {ok:true}:{ok:false, detalle:'codigo-mal'}, error:null };
  }
  // Sesiones/equipos/nomina en demo: devolver vacío o éxito
  if(path.startsWith('/rest/v1/sesiones')||path.startsWith('/rest/v1/equipos')||path.startsWith('/rest/v1/nomina')||path.startsWith('/rest/v1/v_desempeno')){
    if(method==='GET') return { datos: [], error:null };
    return { datos: {}, error:null };
  }
  if(path.startsWith('/rest/v1/rpc/cerrar_sesion_clase')||path.startsWith('/rest/v1/rpc/anonimizar_sesion')){
    return { datos: {ok:true}, error:null };
  }
  return null; // no mock para este path, seguir a Supabase
}

// ---------------------------------------------------------------------------
// Helpers de sesión (localStorage)
// ---------------------------------------------------------------------------
function leerSesionCruda() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Supabase GoTrue puede envolver la sesión en { ... } o { session: { ... } }
    if (parsed && parsed.session && parsed.session.access_token) return parsed.session;
    return parsed;
  } catch {
    return null;
  }
}

function guardarSesion(sesion) {
  try {
    if (!sesion) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sesion));
  } catch {
    // localStorage no disponible (SSR/preview) — se ignora sin romper.
  }
}

function limpiarSesion() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignorar
  }
}

// ---------------------------------------------------------------------------
// peticion — único punto de fetch a Supabase
// Arma cabeceras apikey + Authorization: Bearer <access_token>
// Reintenta 1 vez ante 401 refrescando token (POST /auth/v1/token?grant_type=refresh_token)
// Normaliza errores y devuelve { datos, error } — nunca lanza.
// ---------------------------------------------------------------------------
export async function peticion(path, opts = {}) {
  const { method = 'GET', body, headers = {}, _reintento = false, ...rest } = opts;

  // Modo demo: si está activo, interceptar endpoints clave sin tocar Supabase
  if (estaEnDemo()) {
    const mock = await mockDemo(path, { method, body, headers });
    if (mock !== null) return mock;
    // Si no hay mock para este path en demo, seguir a Supabase normal (por si hay datos mixtos)
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('TU-PROYECTO')) {
    return {
      datos: null,
      error: {
        mensaje: 'Configuración de Supabase incompleta. Revisá js/config.js (SUPABASE_URL / SUPABASE_ANON_KEY).',
        codigo: 'config_incompleta',
        estado: 0
      }
    };
  }

  const sesion = leerSesionCruda();
  const token = sesion?.access_token || null;

  const url = `${String(SUPABASE_URL).replace(/\/$/, '')}${path}`;

  const cabeceras = {
    apikey: SUPABASE_ANON_KEY,
    ...headers
  };

  // Authorization siempre que haya token; para endpoints /auth/* Supabase igual lo acepta.
  if (token) {
    cabeceras['Authorization'] = `Bearer ${token}`;
  } else {
    // Sin sesión, Supabase espera Bearer anon para RLS anon (que será denegado, pero evita 401 malformado).
    cabeceras['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  // Content-Type por defecto si hay body y no se especificó otro.
  const tieneBody = body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD';
  if (tieneBody && !cabeceras['Content-Type'] && !cabeceras['content-type']) {
    cabeceras['Content-Type'] = 'application/json';
  }
  // Prefer para POST/PATCH REST que devuelva representación (útil para crearSesion etc.)
  if ((method === 'POST' || method === 'PATCH') && path.startsWith('/rest/v1/') && !cabeceras['Prefer']) {
    // No forzar Prefer globalmente para no romper RPC; RPC ignora Prefer.
    // Solo se añade si el caller no lo especificó.
  }

  let cuerpoFetch = undefined;
  if (tieneBody) {
    cuerpoFetch = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const res = await fetch(url, {
      method,
      headers: cabeceras,
      body: cuerpoFetch,
      ...rest
    });

    // 401 → intenta refrescar una sola vez (no reintentar si ya es un reintento o si es la propia ruta de refresh/otp/verify)
    const esRutaAuth = path.startsWith('/auth/v1/token') || path.startsWith('/auth/v1/otp') || path.startsWith('/auth/v1/verify');
    if (res.status === 401 && !_reintento && !esRutaAuth) {
      const r = await Auth.refrescar();
      if (!r.error && r.datos) {
        // Reintenta una vez con el nuevo token
        return peticion(path, { method, body, headers, _reintento: true, ...rest });
      }
      // Si refrescar falla, cae al manejo de error normal con el 401 original.
    }

    const contentType = res.headers.get('content-type') || '';
    const esJson = contentType.includes('application/json');

    let payload = null;
    let texto = '';
    if (res.status !== 204) {
      if (esJson) {
        try {
          payload = await res.json();
        } catch {
          // Respuesta declara json pero no parsea — tratar como texto
          try { texto = await res.text(); } catch { texto = ''; }
          payload = texto || null;
        }
      } else {
        try { texto = await res.text(); } catch { texto = ''; }
        if (texto) {
          try { payload = JSON.parse(texto); } catch { payload = texto; }
        }
      }
    }

    if (!res.ok) {
      // Fallback demo: si Supabase dice 429 / rate limit / capacity / email limit en OTP, generar código local
      const esOTP = path.startsWith('/auth/v1/otp');
      const textoLower = String(texto||'').toLowerCase();
      const msgLower = String(payload?.message||payload?.msg||payload?.error||'').toLowerCase();
      const esRateLimit = res.status===429 || textoLower.includes('rate') || textoLower.includes('limit') || textoLower.includes('capacity') || msgLower.includes('rate') || msgLower.includes('limit') || msgLower.includes('capacity') || msgLower.includes('exceeded') || msgLower.includes('too many');
      if(esOTP && esRateLimit){
        try{
          let b=null; try{ b= typeof body==='string'? JSON.parse(body): body; }catch{ b=body; }
          const email=(b?.email||'').trim().toLowerCase();
          if(email){
            // Activar demo y generar código local
            activarDemo(email);
            const code=generarCodigoDemo(email);
            return { datos: { demo:true, code, mensaje: `Modo demo activo (Supabase sin correos). Tu código es ${code} — válido 5 min. Ingresalo abajo o hacé clic en "Entrar en modo demo".` }, error: null };
          }
        }catch{}
      }
      // Normaliza mensaje desde Supabase (GoTrue / PostgREST)
      let mensaje = '';
      let codigo = '';
      if (payload && typeof payload === 'object') {
        mensaje = payload.msg || payload.message || payload.error_description || payload.error || payload.hint || '';
        codigo = payload.code || payload.error_code || payload.error || '';
        // GoTrue a veces devuelve { error: "correo_no_esta_en_la_nomina..." }
        if (!mensaje && typeof payload.error === 'string') mensaje = payload.error;
      }
      if (!mensaje && typeof payload === 'string') mensaje = payload;
      if (!mensaje) mensaje = texto || res.statusText || `Error ${res.status}`;
      // Limpia mensaje para display con textContent (sin HTML)
      mensaje = String(mensaje).trim().slice(0, 500);
      return {
        datos: null,
        error: {
          mensaje,
          codigo: String(codigo || ''),
          estado: res.status,
          detalle: payload
        }
      };
    }

    // Éxito: si payload es null y había texto, devolver texto; si no, payload tal cual
    const datos = payload !== null && payload !== undefined ? payload : (texto || null);
    return { datos, error: null };
  } catch (err) {
    const mensaje = err && err.message ? String(err.message).slice(0, 500) : 'Error de red. Verificá tu conexión.';
    return {
      datos: null,
      error: {
        mensaje,
        codigo: 'red',
        estado: 0,
        detalle: err ? String(err) : null
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Auth — OTP por correo (CONTRACT §5)
// POST /auth/v1/otp con shouldCreateUser:true
// POST /auth/v1/verify → guarda sesión en localStorage bajo cc_sesion
// ---------------------------------------------------------------------------
export const Auth = {
  async registrar({ nombre, correo, carne }) {
    const email = String(correo || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { datos: null, error: { mensaje: 'Ingresá un correo válido.', codigo: 'correo_invalido', estado: 400 } };
    }
    const redirectTo = (typeof window !== 'undefined' && window.location ? window.location.origin + '/index.html' : undefined);
    const payload = {
      email,
      shouldCreateUser: true,
      data: {
        nombre: String(nombre || '').trim(),
        carne: String(carne || '').trim()
      },
      // Magic-link: Supabase envía enlace por defecto; el código de 6 dígitos viene además si la plantilla lo incluye.
      // Incluimos redirect para que el clic vuelva a esta app y podamos capturar la sesión.
      ...(redirectTo ? { emailRedirectTo: redirectTo, redirectTo, email_redirect_to: redirectTo } : {})
    };
    return peticion('/auth/v1/otp', {
      method: 'POST',
      body: payload,
      headers: { apikey: SUPABASE_ANON_KEY }
    });
  },

  async enviarCodigo(correo) {
    const email = String(correo || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { datos: null, error: { mensaje: 'Ingresá un correo válido.', codigo: 'correo_invalido', estado: 400 } };
    }
    const redirectTo = (typeof window !== 'undefined' && window.location ? window.location.origin + '/index.html' : undefined);
    return peticion('/auth/v1/otp', {
      method: 'POST',
      body: { email, shouldCreateUser: true, ...(redirectTo ? { emailRedirectTo: redirectTo, redirectTo, email_redirect_to: redirectTo } : {}) },
      headers: { apikey: SUPABASE_ANON_KEY }
    });
  },

  async verificarCodigo(correo, token) {
    const email = String(correo || '').trim().toLowerCase();
    const code = String(token || '').trim();
    if (!email || !code) {
      return { datos: null, error: { mensaje: 'Correo y código son obligatorios.', codigo: 'parametros_faltantes', estado: 400 } };
    }
    const res = await peticion('/auth/v1/verify', {
      method: 'POST',
      body: { email, token: code, type: 'email' },
      headers: { apikey: SUPABASE_ANON_KEY }
    });
    if (!res.error && res.datos) {
      // GoTrue devuelve { access_token, refresh_token, user, ... } o { session: { ... } }
      const sesion = res.datos.session || res.datos;
      if (sesion && sesion.access_token) {
        guardarSesion(sesion);
        return { datos: sesion, error: null };
      }
      // Si vino envuelto distinto, igual persistir lo recibido
      guardarSesion(res.datos);
    }
    return res;
  },

  async sesion() {
    const s = leerSesionCruda();
    if (!s) return { datos: null, error: null };
    // Validación blanda de expiración (exp en JWT); no bloquea, solo informa
    return { datos: s, error: null };
  },

  // Sincrónico para uso interno; expuesto como async por contrato
  // Refresca con POST /auth/v1/token?grant_type=refresh_token
  async refrescar() {
    const actual = leerSesionCruda();
    const refreshToken = actual?.refresh_token;
    if (!refreshToken) {
      return { datos: null, error: { mensaje: 'No hay sesión para refrescar.', codigo: 'sin_sesion', estado: 401 } };
    }
    // No usar peticion() para evitar recursión de 401 → refrescar → 401
    const url = `${String(SUPABASE_URL).replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      const ct = res.headers.get('content-type') || '';
      let payload = null;
      if (ct.includes('application/json')) {
        try { payload = await res.json(); } catch { payload = null; }
      } else {
        const t = await res.text().catch(() => '');
        try { payload = JSON.parse(t); } catch { payload = t || null; }
      }
      if (!res.ok) {
        const msg = payload?.error_description || payload?.msg || payload?.message || payload?.error || res.statusText || 'No se pudo refrescar la sesión.';
        return { datos: null, error: { mensaje: String(msg).slice(0, 500), codigo: payload?.code || payload?.error || '', estado: res.status } };
      }
      const nueva = payload?.session || payload;
      if (nueva && nueva.access_token) {
        // Preservar campos previos si el refresh no trae user
        const combinada = { ...actual, ...nueva };
        guardarSesion(combinada);
        return { datos: combinada, error: null };
      }
      guardarSesion(payload);
      return { datos: payload, error: null };
    } catch (err) {
      return { datos: null, error: { mensaje: err?.message ? String(err.message).slice(0, 500) : 'Error de red al refrescar.', codigo: 'red', estado: 0 } };
    }
  },

  async salir() {
    const s = leerSesionCruda();
    const token = s?.access_token;
    // Intenta revocar en servidor, pero siempre limpia local aunque falle red
    if (token) {
      try {
        await fetch(`${String(SUPABASE_URL).replace(/\/$/, '')}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
      } catch {
        // ignorar error de red en logout
      }
    }
    limpiarSesion();
    return { datos: { ok: true }, error: null };
  }
};

// ---------------------------------------------------------------------------
// Juego — estudiante (CONTRACT §4, §5)
// ---------------------------------------------------------------------------
export const Juego = {
  async miEquipo() {
    return peticion('/rest/v1/rpc/mi_equipo', {
      method: 'POST',
      body: {},
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async estaciones() {
    return peticion('/rest/v1/estaciones_publicas?select=*', {
      method: 'GET'
    });
  },

  async estado(equipoId) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/rest/v1/rpc/estado_juego', {
      method: 'POST',
      body: { p_equipo: equipoId }
    });
  },

  async verificar(equipoId, estacionId, respuesta) {
    if (!equipoId || !estacionId) {
      return { datos: null, error: { mensaje: 'Faltan parámetros para verificar.', codigo: 'parametros_faltantes', estado: 400 } };
    }
    return peticion('/rest/v1/rpc/verificar_estacion', {
      method: 'POST',
      body: { p_equipo: equipoId, p_estacion: Number(estacionId), p_respuesta: respuesta ?? {} }
    });
  },

  async verificarMaestro(equipoId, codigo) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/rest/v1/rpc/verificar_maestro', {
      method: 'POST',
      body: { p_equipo: equipoId, p_codigo: String(codigo ?? '') }
    });
  }
};

// ---------------------------------------------------------------------------
// Docente — panel (CONTRACT §5, §8)
// ---------------------------------------------------------------------------
export const Docente = {
  async sesiones() {
    return peticion('/rest/v1/sesiones?select=*&order=creada_en.desc', { method: 'GET' });
  },

  async crearSesion(d) {
    const payload = { ...(d || {}) };
    // nombre requerido
    if (!payload.nombre || !String(payload.nombre).trim()) {
      return { datos: null, error: { mensaje: 'El nombre de la sesión es obligatorio.', codigo: 'parametros_faltantes', estado: 400 } };
    }
    payload.nombre = String(payload.nombre).trim();
    if (payload.duracion_minutos !== undefined) payload.duracion_minutos = Number(payload.duracion_minutos);
    // docente_id lo exige RLS (docente_id = auth.uid()); inyectarlo si tenemos sesión
    const s = leerSesionCruda();
    const uid = s?.user?.id || s?.user?.sub || null;
    if (uid && !payload.docente_id) payload.docente_id = uid;
    return peticion('/rest/v1/sesiones', {
      method: 'POST',
      body: payload,
      headers: { Prefer: 'return=representation' }
    });
  },

  async abrirSesion(id) {
    if (!id) return { datos: null, error: { mensaje: 'Falta id de sesión.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/rest/v1/sesiones?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { estado: 'abierta' },
      headers: { Prefer: 'return=representation' }
    });
  },

  async cerrarSesion(id) {
    if (!id) return { datos: null, error: { mensaje: 'Falta id de sesión.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/rest/v1/rpc/cerrar_sesion_clase', {
      method: 'POST',
      body: { p_sesion: id }
    });
  },

  async registrados(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    // Dos consultas: nómina con perfil ligado + integrantes de la sesión para filtrar "sin equipo"
    const nominaRes = await peticion(
      `/rest/v1/nomina?sesion_id=eq.${encodeURIComponent(sesionId)}&perfil_id=not.is.null&select=*&order=creada_en.asc`,
      { method: 'GET' }
    );
    if (nominaRes.error) return nominaRes;

    const integrantesRes = await peticion(
      `/rest/v1/integrantes?sesion_id=eq.${encodeURIComponent(sesionId)}&select=perfil_id`,
      { method: 'GET' }
    );
    if (integrantesRes.error) {
      // Si no se puede leer integrantes, devolver nómina sin filtrar (no bloquear)
      return nominaRes;
    }

    const asignados = new Set(
      (Array.isArray(integrantesRes.datos) ? integrantesRes.datos : []).map((r) => r.perfil_id).filter(Boolean)
    );
    const sinEquipo = (Array.isArray(nominaRes.datos) ? nominaRes.datos : []).filter((r) => !asignados.has(r.perfil_id));
    return { datos: sinEquipo, error: null };
  },

  async crearEquipo(sesionId, nombre) {
    if (!sesionId || !String(nombre || '').trim()) {
      return { datos: null, error: { mensaje: 'Faltan sesionId o nombre del equipo.', codigo: 'parametros_faltantes', estado: 400 } };
    }
    return peticion('/rest/v1/equipos', {
      method: 'POST',
      body: { sesion_id: sesionId, nombre: String(nombre).trim() },
      headers: { Prefer: 'return=representation' }
    });
  },

  async asignar(equipoId, perfilId) {
    if (!equipoId || !perfilId) return { datos: null, error: { mensaje: 'Faltan equipoId o perfilId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/rest/v1/integrantes', {
      method: 'POST',
      body: { equipo_id: equipoId, perfil_id: perfilId },
      headers: { Prefer: 'return=representation' }
    });
  },

  async desasignar(equipoId, perfilId) {
    if (!equipoId || !perfilId) return { datos: null, error: { mensaje: 'Faltan equipoId o perfilId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(
      `/rest/v1/integrantes?equipo_id=eq.${encodeURIComponent(equipoId)}&perfil_id=eq.${encodeURIComponent(perfilId)}`,
      { method: 'DELETE' }
    );
  },

  async desempeno(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/rest/v1/v_desempeno?sesion_id=eq.${encodeURIComponent(sesionId)}&select=*`, { method: 'GET' });
  },

  async guardarCalificacion(equipoId, rubrica) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    const body = { equipo_id: equipoId, ...(rubrica || {}) };
    // Upsert: si existe equipo_id, merge
    return peticion('/rest/v1/calificaciones?on_conflict=equipo_id', {
      method: 'POST',
      body,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
    });
  },

  async anonimizar(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/rest/v1/rpc/anonimizar_sesion', {
      method: 'POST',
      body: { p_sesion: sesionId }
    });
  }
};
