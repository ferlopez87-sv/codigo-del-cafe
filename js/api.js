// js/api.js — cliente same-origin §5.2 CONTRACT.md (Node/Express + cookies)
// Sin SUPABASE_URL, sin claves, solo fetch con credentials:include
// Toda función devuelve {datos, error} y nunca lanza.
async function peticion(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const url = path; // same-origin, srv sirve /api/*
  const headers = { 'Content-Type': 'application/json' };
  const init = { method, headers, credentials: 'include' };
  if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  try {
    const res = await fetch(url, init);
    const ct = res.headers.get('content-type') || '';
    let payload = null;
    if (ct.includes('application/json')) {
      try { payload = await res.json(); } catch { payload = null; }
    } else {
      const t = await res.text().catch(() => '');
      try { payload = t ? JSON.parse(t) : null; } catch { payload = t || null; }
    }
    if (!res.ok) {
      let mensaje = payload?.error || payload?.mensaje || payload?.message || res.statusText || `Error ${res.status}`;
      let codigo = payload?.codigo || payload?.code || payload?.error || '';
      // normalizar para UI con textContent
      mensaje = String(mensaje).slice(0, 600);
      return { datos: null, error: { mensaje, codigo: String(codigo), estado: res.status, detalle: payload } };
    }
    // éxito: payload puede ser {datos} o directo; normalizamos a datos
    // srv responde {datos: ...} o directo según ruta; api.js expone payload como datos
    if (payload && typeof payload === 'object' && 'datos' in payload && Object.keys(payload).length === 1) return { datos: payload.datos, error: null };
    if (payload && typeof payload === 'object' && 'error' in payload && payload.error) {
      // srv usó envoltura {error}
      return { datos: null, error: { mensaje: String(payload.error).slice(0,600), codigo: String(payload.error), estado: res.status } };
    }
    return { datos: payload, error: null };
  } catch (err) {
    return { datos: null, error: { mensaje: err?.message ? String(err.message).slice(0,600) : 'Error de red. Verificá tu conexión.', codigo: 'red', estado: 0 } };
  }
}

export const Auth = {
  async registrar({ correo }) {
    const c = String(correo || '').trim().toLowerCase();
    if (!c || !c.includes('@')) return { datos: null, error: { mensaje: 'Ingresá un correo válido.', codigo: 'correo_invalido', estado: 400 } };
    return peticion('/api/auth/registrar', { method: 'POST', body: { correo: c } });
  },
  async reenviar(correo) {
    const c = String(correo || '').trim().toLowerCase();
    if (!c || !c.includes('@')) return { datos: null, error: { mensaje: 'Ingresá un correo válido.', codigo: 'correo_invalido', estado: 400 } };
    return peticion('/api/auth/reenviar', { method: 'POST', body: { correo: c } });
  },
  // alias histórico enviarCodigo
  async enviarCodigo(correo) { return this.reenviar(correo); },
  async verificarCodigo(correo, codigo) {
    const c = String(correo || '').trim().toLowerCase();
    const tok = String(codigo || '').trim();
    if (!c || !tok) return { datos: null, error: { mensaje: 'Correo y código son obligatorios.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/auth/verificar', { method: 'POST', body: { correo: c, codigo: tok } });
  },
  async sesion() {
    return peticion('/api/auth/sesion', { method: 'GET' });
  },
  async salir() {
    return peticion('/api/auth/salir', { method: 'POST', body: {} });
  },
  // Acceso por código de equipo (2026-08-26) — reemplaza el correo OTP como
  // vía principal para estudiantes; el docente distribuye el código él mismo.
  async equipoPorCodigo(codigo) {
    const c = String(codigo || '').trim();
    if (!c) return { datos: null, error: { mensaje: 'Ingresá el código del equipo.', codigo: 'codigo_invalido', estado: 400 } };
    return peticion('/api/auth/equipo-por-codigo', { method: 'POST', body: { codigo: c } });
  },
  async accesoEquipo(codigo, perfilId) {
    if (!codigo || !perfilId) return { datos: null, error: { mensaje: 'Faltan datos.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/auth/acceso-equipo', { method: 'POST', body: { codigo, perfilId } });
  }
};

export const Juego = {
  async miEquipo() { return peticion('/api/juego/mi-equipo', { method: 'GET' }); },
  async estaciones() { return peticion('/api/juego/estaciones', { method: 'GET' }); },
  async estado(equipoId) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/juego/estado/${encodeURIComponent(equipoId)}`, { method: 'GET' });
  },
  async verificar(equipoId, estacionId, respuesta) {
    if (!equipoId || !estacionId) return { datos: null, error: { mensaje: 'Faltan parámetros.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/juego/verificar', { method: 'POST', body: { equipo: equipoId, estacion: Number(estacionId), respuesta: respuesta ?? {} } });
  },
  async verificarMaestro(equipoId, codigo) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/juego/verificar-maestro', { method: 'POST', body: { equipo: equipoId, codigo: String(codigo ?? '') } });
  }
};

export const Docente = {
  async sesiones() { return peticion('/api/docente/sesiones', { method: 'GET' }); },
  // Consola de super-admin (2026-08-26): RLS ya decide qué ve cada quien —
  // para fglopez esto trae TODAS las sesiones/equipos; para cualquier otro
  // docente, solo los suyos (mismo alcance que ya tenían en el resto del panel).
  async todosLosEquipos() { return peticion('/api/docente/todo-equipos', { method: 'GET' }); },
  async crearSesion(d) {
    if (!d?.nombre || !String(d.nombre).trim()) return { datos: null, error: { mensaje: 'El nombre de la sesión es obligatorio.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/docente/sesiones', { method: 'POST', body: { nombre: String(d.nombre).trim(), duracion_minutos: d.duracion_minutos != null ? Number(d.duracion_minutos) : 50 } });
  },
  async abrirSesion(id) {
    if (!id) return { datos: null, error: { mensaje: 'Falta id.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/sesiones/${encodeURIComponent(id)}/abrir`, { method: 'POST', body: {} });
  },
  async cerrarSesion(id) {
    if (!id) return { datos: null, error: { mensaje: 'Falta id.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/sesiones/${encodeURIComponent(id)}/cerrar`, { method: 'POST', body: {} });
  },
  // Borra la sesión de verdad (distinto de cerrarla) — 2026-08-26.
  async borrarSesion(id) {
    if (!id) return { datos: null, error: { mensaje: 'Falta id.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/sesiones/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async registrados(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/registrados/${encodeURIComponent(sesionId)}`, { method: 'GET' });
  },
  async nomina(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/nomina?sesionId=${encodeURIComponent(sesionId)}`, { method: 'GET' });
  },
  async agregarANomina(sesionId, { nombre, correo, carne }) {
    if (!sesionId || !nombre || !correo || !carne) return { datos: null, error: { mensaje: 'Faltan datos.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/docente/nomina', { method: 'POST', body: { sesion_id: sesionId, nombre: String(nombre).trim(), correo: String(correo).trim().toLowerCase(), carne: String(carne).trim() } });
  },
  async crearEquipo(sesionId, nombre) {
    if (!sesionId || !String(nombre || '').trim()) return { datos: null, error: { mensaje: 'Faltan datos.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion('/api/docente/equipos', { method: 'POST', body: { sesion_id: sesionId, nombre: String(nombre).trim() } });
  },
  async borrarEquipo(equipoId) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/equipos/${encodeURIComponent(equipoId)}`, { method: 'DELETE' });
  },
  // 2026-08-26: acepta perfilId (ya registrado) o nominaId (todavía no —
  // el servidor le crea el perfil en el momento, misma fuente de verdad
  // de siempre: nombre/carné de la nómina, nunca de lo que nadie teclee).
  async asignar(equipoId, { perfilId, nominaId } = {}) {
    if (!equipoId || (!perfilId && !nominaId)) return { datos: null, error: { mensaje: 'Faltan datos.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/equipos/${encodeURIComponent(equipoId)}/asignar`, { method: 'POST', body: { perfilId, nominaId } });
  },
  async generarCodigoEquipo(equipoId, horasValidez) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/equipos/${encodeURIComponent(equipoId)}/codigo`, { method: 'POST', body: { horasValidez: horasValidez != null ? Number(horasValidez) : undefined } });
  },
  async desasignar(equipoId, perfilId) {
    if (!equipoId || !perfilId) return { datos: null, error: { mensaje: 'Faltan datos.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/equipos/${encodeURIComponent(equipoId)}/desasignar`, { method: 'POST', body: { perfilId } });
  },
  async marcarApuntador(equipoId, perfilId) {
    if (!equipoId || !perfilId) return { datos: null, error: { mensaje: 'Faltan datos.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/equipos/${encodeURIComponent(equipoId)}/apuntador`, { method: 'POST', body: { perfilId } });
  },
  async desempeno(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/desempeno/${encodeURIComponent(sesionId)}`, { method: 'GET' });
  },
  async guardarCalificacion(equipoId, rubrica) {
    if (!equipoId) return { datos: null, error: { mensaje: 'Falta equipoId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/calificaciones/${encodeURIComponent(equipoId)}`, { method: 'POST', body: rubrica || {} });
  },
  async anonimizar(sesionId) {
    if (!sesionId) return { datos: null, error: { mensaje: 'Falta sesionId.', codigo: 'parametros_faltantes', estado: 400 } };
    return peticion(`/api/docente/anonimizar/${encodeURIComponent(sesionId)}`, { method: 'POST', body: {} });
  }
};
