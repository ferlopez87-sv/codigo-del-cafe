// _src/js/juego.js — cl-juego
// Dueño: cl-juego. Vanilla ES module. Único que conoce el estado global del equipo.
// Contrato: CONTRACT.md §4.2, §5-7, §11-12. Sin llamada directa de red (usa js/api.js),
// sin calculo de tiempo (delega a cl-timer), pinta datos con textContent.

import { Auth, Juego } from './api.js';

// ---------------------------------------------------------------------------
// Estado global — memoria volátil del módulo, no persiste en localStorage.
// ---------------------------------------------------------------------------
let equipoActual = null;
let sesionActual = null;
let estacionActual = null;
let ultimoFoco = null;

// Mapa de clases de estado admitidas por el contrato §7
const ESTADOS_VALIDOS = ['pendiente', 'progreso', 'resuelta', 'bloqueada'];
const CLASES_ESTADO = ESTADOS_VALIDOS.map((e) => `is-${e}`);

// Etiquetas visibles por estado — nunca solo color (§13)
const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  progreso: 'En progreso',
  resuelta: 'Resuelta',
  bloqueada: 'Bloqueada',
};

const ICONO_ESTADO = {
  pendiente: '○',
  progreso: '◐',
  resuelta: '✓',
  bloqueada: '🔒',
};

// ---------------------------------------------------------------------------
// Helpers de DOM — todos con textContent (§14.4)
// ---------------------------------------------------------------------------
function $(id) {
  return document.getElementById(id);
}

function setText(id, valor) {
  const el = typeof id === 'string' ? $(id) : id;
  if (el) el.textContent = valor == null ? '' : String(valor);
}

function setHidden(el, oculto) {
  if (!el) return;
  if (oculto) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function normalizarCodigo(codigo) {
  // Replica la normalización del servidor (§4.2, verificar_maestro):
  // fuera todo lo que no sea letra o dígito, a mayúsculas.
  // Acepta "06-87-04-2P-4", "06 87 04 2p 4", "0687042P4" por igual.
  return String(codigo ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// 1. initJuego() — puerta de entrada de juego.html
// ---------------------------------------------------------------------------
export async function initJuego() {
  // §1 y §7: cada página verifica sesión al cargar y redirige.
  let sesion = null;
  try {
    const r = Auth.sesion();
    sesion = r instanceof Promise ? await r : r;
  } catch {
    sesion = null;
  }

  if (!sesion) {
    window.location.href = 'index.html';
    return;
  }

  let respuesta;
  try {
    respuesta = await Juego.miEquipo();
  } catch (e) {
    mostrarErrorGlobal('No se pudo cargar el equipo. Revisá tu conexión.');
    return;
  }

  // api.js normaliza a { datos, error } — contemplamos ambos formatos.
  const datos = respuesta && 'datos' in respuesta ? respuesta.datos : respuesta;
  const error = respuesta && 'error' in respuesta ? respuesta.error : null;

  if (error) {
    const msg = typeof error === 'string' ? error : error.message || 'Error al cargar el equipo.';
    mostrarErrorGlobal(msg);
    return;
  }

  // miEquipo() devuelve null si aún no fue asignado (§4.2) — caso normal, no error.
  if (!datos) {
    mostrarSinEquipo();
    return;
  }

  // miEquipo() puede devolver { error: 'no_autorizado' | 'sesion_cerrada' }
  if (datos && datos.error) {
    mostrarErrorGlobal(mensajeErrorServidor(datos.error));
    return;
  }

  // Estructura de miEquipo(): { equipo, sesion, estaciones, integrantes, ... }
  // Reutiliza estado_juego + integrantes.
  const equipo = datos.equipo || datos;
  const equipoId = equipo.id || datos.equipo_id || equipo.equipo_id;

  if (!equipoId) {
    mostrarSinEquipo();
    return;
  }

  equipoActual = equipo;
  sesionActual = datos.sesion || null;

  ocultarSinEquipo();
  // §7: sala de espera si aún no arranca el reloj (iniciado_en null)
  const iniciado = equipo?.iniciado_en || datos.iniciado_en || datos.equipo?.iniciado_en;
  if(!iniciado){
    mostrarBienvenida();
  } else {
    mostrarDashboard();
  }

  // Primer pintado con lo que ya trae miEquipo(); luego refresco vía estado_juego().
  if (Array.isArray(datos.estaciones)) {
    pintarEstadoDesdeDatos(datos);
  }

  await cargarEstado(equipoId);
  enlazarEventosUnaVez();
}

// ---------------------------------------------------------------------------
// Visibilidad de pantallas §7
// ---------------------------------------------------------------------------
function mostrarSinEquipo() {
  const sinEquipo = $('sin-equipo');
  const dashboard = $('pantalla-dashboard');
  const bienvenida = $('pantalla-bienvenida');
  if (sinEquipo) {
    sinEquipo.removeAttribute('hidden');
  }
  if (dashboard) {
    dashboard.setAttribute('hidden', '');
  }
  if (bienvenida) {
    // Sala de espera solo si hay equipo; sin equipo se oculta también.
    bienvenida.setAttribute('hidden', '');
  }
}

function ocultarSinEquipo() {
  const el = $('sin-equipo');
  if (el) {
    el.setAttribute('hidden', '');
  }
}

function mostrarBienvenida(){
  const bienvenida=$('pantalla-bienvenida');
  const dash=$('pantalla-dashboard');
  if(bienvenida) bienvenida.removeAttribute('hidden');
  if(dash) dash.setAttribute('hidden','');
  // Mostrar nombre equipo e integrantes en bienvenida si están disponibles
  if(equipoActual){
    const nombreEl=$('bienvenida-equipo-nombre');
    if(nombreEl) nombreEl.textContent = equipoActual.nombre || equipoActual.equipo || 'Equipo';
  }
}
function mostrarDashboard() {
  const dash = $('pantalla-dashboard');
  const bienvenida=$('pantalla-bienvenida');
  if (dash) {
    dash.removeAttribute('hidden');
  }
  if(bienvenida) bienvenida.setAttribute('hidden','');
}

function mostrarErrorGlobal(mensaje) {
  const aviso = $('aviso-conexion') || $('mensaje-auth') || $('estacion-feedback');
  if (aviso) {
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    aviso.textContent = mensaje;
    aviso.removeAttribute('hidden');
  }
}

// ---------------------------------------------------------------------------
// 2. cargarEstado(equipoId) — refresca progreso desde el servidor
// ---------------------------------------------------------------------------
export async function cargarEstado(equipoId) {
  const id = equipoId || (equipoActual && equipoActual.id);
  if (!id) return;

  let respuesta;
  try {
    respuesta = await Juego.estado(id);
  } catch {
    mostrarErrorGlobal('Sin conexión. Tu progreso ya guardado no se pierde.');
    return;
  }

  const datos = respuesta && 'datos' in respuesta ? respuesta.datos : respuesta;
  const error = respuesta && 'error' in respuesta ? respuesta.error : null;

  if (error) {
    const msg = typeof error === 'string' ? error : error.message || 'Error al cargar el estado.';
    // Errores esperados del servidor (§4.1): no_autorizado, sesion_cerrada, tiempo_agotado
    if (datos && datos.error) {
      manejarErrorEstado(datos.error);
      return;
    }
    mostrarErrorGlobal(msg);
    return;
  }

  if (datos && datos.error) {
    manejarErrorEstado(datos.error);
    return;
  }

  if (!datos) return;

  // Guardar referencias por si cambian
  if (datos.equipo) equipoActual = datos.equipo;
  if (datos.sesion) sesionActual = datos.sesion;

  pintarEstadoDesdeDatos(datos);
}

function manejarErrorEstado(codigo) {
  const msg = mensajeErrorServidor(codigo);
  // tiempo_agotado y sesion_cerrada son terminales: se muestran y deshabilitan acciones.
  mostrarErrorGlobal(msg);
  if (codigo === 'tiempo_agotado' || codigo === 'sesion_cerrada') {
    deshabilitarInteraccionesPorCierre(codigo);
  }
}

function mensajeErrorServidor(codigo) {
  switch (codigo) {
    case 'no_autorizado': return 'No estás autorizado para ver este equipo.';
    case 'sesion_cerrada': return 'La sesión ya fue cerrada por el docente.';
    case 'tiempo_agotado': return 'Se agotó el tiempo de la sesión.';
    case 'bloqueada': return 'Esta estación sigue bloqueada. Resolvé las cuatro anteriores primero.';
    case 'estacion_invalida': return 'Estación no válida.';
    default: return String(codigo);
  }
}

function deshabilitarInteraccionesPorCierre(codigo) {
  const btnMaestro = $('btn-verificar-maestro');
  if (btnMaestro) btnMaestro.setAttribute('aria-disabled', 'true');
  const inputMaestro = $('input-codigo-maestro');
  if (inputMaestro) inputMaestro.setAttribute('aria-disabled', 'true');
}

// ---------------------------------------------------------------------------
// Pintado — tarjetas, barra, contador, fragmentos (§7)
// ---------------------------------------------------------------------------
function pintarEstadoDesdeDatos(datos) {
  const estaciones = Array.isArray(datos.estaciones) ? datos.estaciones : [];
  const resueltas = typeof datos.resueltas === 'number'
    ? datos.resueltas
    : estaciones.filter((e) => e.estado === 'resuelta').length;

  pintarTarjetas(estaciones);
  pintarBarraProgreso(resueltas, 5);
  pintarFragmentos(estaciones);

  // El tiempo lo posee el servidor; aquí no se calcula ni se interpola.
  // Se emite un evento para que cl-timer lo consuma si está presente.
  if (typeof datos.segundos_restantes === 'number') {
    window.dispatchEvent(new CustomEvent('juego:segundos', {
      detail: { segundos: datos.segundos_restantes, servidorEn: datos.servidor_en },
    }));
  }
}

function pintarTarjetas(estaciones) {
  const lista = $('lista-estaciones');
  if (!lista) return;

  estaciones.forEach((est) => {
    const id = est.estacion_id ?? est.id;
    const estado = ESTADOS_VALIDOS.includes(est.estado) ? est.estado : 'pendiente';
    const card = lista.querySelector(`.estacion-card[data-estacion="${id}"]`);
    if (!card) return;

    // Clases is-*: solo una activa a la vez (§7)
    card.classList.remove(...CLASES_ESTADO);
    card.classList.add(`is-${estado}`);

    // Accesibilidad: aria-disabled en bloqueada, aria-expanded colapsada
    if (estado === 'bloqueada') card.setAttribute('aria-disabled', 'true');
    else card.removeAttribute('aria-disabled');

    // Badge de estado — texto + ícono, nunca solo color (§13)
    const badge = card.querySelector('.estacion-card__estado') || card.querySelector('[data-rol="estado"]');
    if (badge) {
      badge.textContent = `${ICONO_ESTADO[estado]} ${ETIQUETA_ESTADO[estado]}`;
    } else {
      // Si no hay badge dedicado, exponer estado vía aria-label
      card.setAttribute('aria-label', `${card.getAttribute('aria-label') || `Estación ${id}`} — ${ETIQUETA_ESTADO[estado]}`);
    }

    // Habilitar/deshabilitar click según estado
    if (estado === 'bloqueada') {
      card.setAttribute('tabindex', '-1');
    } else {
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
    }
  });
}

function pintarBarraProgreso(resueltas, total) {
  const relleno = $('barra-progreso-relleno');
  const contador = $('contador-progreso');
  const barra = $('barra-progreso');

  const pct = total > 0 ? Math.round((resueltas / total) * 100) : 0;

  if (relleno) {
    // Único estilo en línea permitido por §15: width de la barra
    relleno.style.width = `${pct}%`;
  }

  if (barra) {
    barra.setAttribute('aria-valuenow', String(resueltas));
    barra.setAttribute('aria-valuemax', String(total));
    barra.setAttribute('aria-valuetext', `${resueltas} de ${total} estaciones`);
    barra.setAttribute('role', 'progressbar');
  }

  if (contador) {
    // Formato del contrato: texto "2 / 5" legible en proyector
    contador.textContent = `${resueltas} / ${total}`;
  }
}

function pintarFragmentos(estaciones) {
  const cont = $('fragmentos-codigo');
  if (!cont) return;

  // Limpiar de forma segura. Se reconstruye con textContent.
  while (cont.firstChild) cont.removeChild(cont.firstChild);

  // Ordenar por id para que el código maestro tenga orden estable
  const ordenadas = [...estaciones].sort((a, b) => (a.estacion_id ?? a.id) - (b.estacion_id ?? b.id));

  ordenadas.forEach((est) => {
    const id = est.estacion_id ?? est.id;
    const item = document.createElement('li');
    item.setAttribute('role', 'listitem');
    // codigo solo viaja si la estación está resuelta (§4.2 estado_juego)
    const codigo = est.codigo || null;
    const estado = est.estado;
    if (codigo && estado === 'resuelta') {
      item.textContent = String(codigo);
      item.setAttribute('aria-label', `Fragmento ${id}, ${codigo} obtenido`);
      item.dataset.obtenido = 'true';
    } else {
      item.textContent = '—';
      item.setAttribute('aria-label', `Fragmento ${id} aún no obtenido`);
      item.dataset.obtenido = 'false';
    }
    cont.appendChild(item);
  });

  cont.setAttribute('role', 'list');
  cont.setAttribute('aria-label', 'Fragmentos de código obtenidos');
}

// ---------------------------------------------------------------------------
// 3. Modal #modal-estacion — abrir/cerrar, foco, Esc (§13)
// ---------------------------------------------------------------------------
export function abrirModal(estacionId) {
  const modal = $('modal-estacion');
  const backdrop = $('modal-backdrop');
  if (!modal) return;

  const id = Number(estacionId);
  if (!Number.isInteger(id) || id < 1 || id > 5) return;

  // Bloqueada no se abre — el servidor es la autoridad, pero evitamos el viaje inútil.
  const card = document.querySelector(`.estacion-card[data-estacion="${id}"]`);
  if (card && card.classList.contains('is-bloqueada')) return;

  estacionActual = id;
  ultimoFoco = document.activeElement;

  // Mostrar modal
  modal.removeAttribute('hidden');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('role', 'dialog');

  if (backdrop) {
    backdrop.removeAttribute('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  // Inert + aria-hidden en el fondo mientras el modal está abierto (§13)
  const main = document.querySelector('main');
  const barra = $('barra-superior');
  if (main) { main.setAttribute('aria-hidden', 'true'); main.inert = true; }
  if (barra) { barra.setAttribute('aria-hidden', 'true'); barra.inert = true; }

  // Bloquear scroll del body — clase controlada por CSS
  document.body.classList.add('is-modal-abierto');

  // Actualizar aria-expanded de la tarjeta que abrió
  if (card) card.setAttribute('aria-expanded', 'true');

  // Limpiar feedback previo
  limpiarFeedbackEstacion();

  // Foco inicial: primer elemento enfocable dentro del modal, o el botón cerrar
  const focoInicial = modal.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ) || $('btn-cerrar-modal') || modal;
  if (focoInicial && typeof focoInicial.focus === 'function') {
    // tabindex -1 si el contenedor mismo recibe foco
    if (focoInicial === modal && !modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    focoInicial.focus();
  }

  // Cargar datos de la estación si hay capa de contenido disponible (opcional)
  // No se asume que exista; el modal puede ser pintado por cl-render.
  window.dispatchEvent(new CustomEvent('juego:abrir-estacion', { detail: { estacionId: id } }));
}

export function cerrarModal() {
  const modal = $('modal-estacion');
  const backdrop = $('modal-backdrop');
  if (!modal || modal.hasAttribute('hidden')) return;

  modal.setAttribute('hidden', '');
  if (backdrop) {
    backdrop.setAttribute('hidden', '');
  }

  const main = document.querySelector('main');
  const barra = $('barra-superior');
  if (main) { main.removeAttribute('aria-hidden'); main.inert = false; }
  if (barra) { barra.removeAttribute('aria-hidden'); barra.inert = false; }

  document.body.classList.remove('is-modal-abierto');

  // Restaurar aria-expanded
  if (estacionActual != null) {
    const card = document.querySelector(`.estacion-card[data-estacion="${estacionActual}"]`);
    if (card) card.setAttribute('aria-expanded', 'false');
  }

  // Devolver foco a la tarjeta que abrió
  const destino = ultimoFoco && document.contains(ultimoFoco) ? ultimoFoco
    : document.querySelector(`.estacion-card[data-estacion="${estacionActual}"]`);
  if (destino && typeof destino.focus === 'function') destino.focus();

  estacionActual = null;
  ultimoFoco = null;
}

function limpiarFeedbackEstacion() {
  const fb = $('estacion-feedback');
  if (fb) {
    fb.textContent = '';
    fb.removeAttribute('data-estado');
    fb.setAttribute('hidden', '');
  }
  const intentos = $('estacion-intentos');
  if (intentos) intentos.textContent = '';
}

// Trampa de foco dentro del modal — Tab/Shift+Tab cicla (§13)
function atraparFoco(e) {
  const modal = $('modal-estacion');
  if (!modal || modal.hasAttribute('hidden')) return;
  if (e.key !== 'Tab') return;

  const focusables = modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusables.length === 0) return;

  const primero = focusables[0];
  const ultimo = focusables[focusables.length - 1];

  if (e.shiftKey && document.activeElement === primero) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primero.focus();
  }
}

// ---------------------------------------------------------------------------
// 4. verificarEstacion() — arma jsonb según §12 y llama Juego.verificar()
// ---------------------------------------------------------------------------
export async function verificarEstacion() {
  if (estacionActual == null) return;
  const estacionId = estacionActual;
  const equipoId = equipoActual && equipoActual.id;
  if (!equipoId) {
    mostrarFeedbackEstacion('No se encontró el equipo. Recargá la página.', 'error');
    return;
  }

  const respuesta = construirRespuesta(estacionId);
  // Validación mínima cliente: si vino vacío, igual se envía para que el servidor
  // devuelva detalle "vacio" y la pista escalonada; no se bloquea el envío.

  let result;
  try {
    result = await Juego.verificar(equipoId, estacionId, respuesta);
  } catch {
    mostrarFeedbackEstacion('Sin conexión. Tu progreso ya guardado no se pierde.', 'alerta');
    return;
  }

  const datos = result && 'datos' in result ? result.datos : result;
  const error = result && 'error' in result ? result.error : null;

  if (error && !datos) {
    mostrarFeedbackEstacion(typeof error === 'string' ? error : 'Error de red.', 'error');
    return;
  }

  if (datos && datos.error) {
    // Errores de §4.1: no_autorizado, sesion_cerrada, tiempo_agotado, bloqueada
    const msg = mensajeErrorServidor(datos.error);
    mostrarFeedbackEstacion(msg, 'error');
    if (datos.error === 'tiempo_agotado' || datos.error === 'sesion_cerrada') {
      deshabilitarInteraccionesPorCierre(datos.error);
    }
    return;
  }

  if (!datos) {
    mostrarFeedbackEstacion('Respuesta vacía del servidor.', 'error');
    return;
  }

  // Caso ya resuelta (reabrir tarjeta): el servidor devuelve ok:true sin pista
  if (datos.ok === true) {
    const feedback = datos.feedback || '¡Correcto!';
    const intentos = datos.intentos != null ? `Intento ${datos.intentos}` : '';
    mostrarFeedbackEstacion(feedback, 'ok', intentos);
    // Actualizar contador de intentos visible
    const elIntentos = $('estacion-intentos');
    if (elIntentos) elIntentos.textContent = intentos;
    // Refrescar estado global (barra, tarjetas, fragmentos)
    await cargarEstado(equipoId);
    // Notificar a quien renderiza el veredicto/fragmentos
    window.dispatchEvent(new CustomEvent('juego:estacion-resuelta', {
      detail: { estacionId, codigo: datos.codigo, feedback },
    }));
    return;
  }

  // Fallo con pista escalonada — el cliente nunca recibe el arreglo completo (§4.1)
  if (datos.ok === false) {
    const pista = datos.pista || '';
    const detalle = datos.detalle || '';
    const intentos = datos.intentos != null ? `Intento ${datos.intentos}` : '';
    // Mensaje que no revela la respuesta: combina pista del servidor + detalle genérico
    // Sin exponer cuál parte acertó (parcial:true solo dice "vas por buen camino").
    let texto = pista || mensajeDetalle(detalle);
    if (datos.parcial) {
      // Mensaje adicional permitido por §12 sin revelar cuál acertó
      texto = `${texto} — Vas por buen camino, revisá lo que falta.`;
    }
    mostrarFeedbackEstacion(texto, 'alerta', intentos);
    const elIntentos = $('estacion-intentos');
    if (elIntentos) elIntentos.textContent = intentos;
    // Refrescar tarjetas por si el estado pasó a "progreso"
    await cargarEstado(equipoId);
    return;
  }

  // Fallback
  mostrarFeedbackEstacion('Respuesta no reconocida del servidor.', 'error');
}

function mensajeDetalle(detalle) {
  // Traduce claves de §12 a mensajes que no revelan la respuesta
  switch (detalle) {
    case 'vacio': return 'No se recibió una respuesta. Completá los campos e intentá de nuevo.';
    case 'orden-mal': return 'El orden no coincide. Revisá la secuencia de la cadena.';
    case 'eslabon-mal': return 'El eslabón señalado no es el correcto.';
    case 'ambos-mal': return 'Tanto el orden como el eslabón necesitan revisión.';
    case 'porcentaje-mal': return 'El porcentaje no coincide con el expediente.';
    case 'porcentaje-fuera-rango': return 'Estás cerca, pero el valor no es el punto medio del rango.';
    case 'juicio-mal': return 'El juicio sobre la afirmación no coincide.';
    case 'inconsistencia-mal': return 'La inconsistencia señalada no es la correcta.';
    case 'sobre-marcado': return 'Marcaste actores de más. Solo algunos tienen evidencia directa.';
    case 'sub-marcado': return 'Te falta marcar a alguien con evidencia directa.';
    case 'equivocados': return 'Revisá la selección: hay marcas que sobran y faltan.';
    default:
      if (detalle && detalle.startsWith('parcial-')) {
        const n = detalle.split('-')[1];
        return `Acertaste ${n} de 5. Revisá las que faltan.`;
      }
      return detalle || 'Revisá tu respuesta e intentá de nuevo.';
  }
}

function mostrarFeedbackEstacion(texto, estado, intentosTexto) {
  const fb = $('estacion-feedback');
  if (!fb) return;
  fb.textContent = texto;
  fb.setAttribute('role', 'status');
  fb.setAttribute('aria-live', 'polite');
  fb.setAttribute('aria-atomic', 'true');
  if (estado) fb.setAttribute('data-estado', estado);
  fb.removeAttribute('hidden');

  if (intentosTexto != null) {
    const el = $('estacion-intentos');
    if (el) el.textContent = intentosTexto;
  }
}

// ---------------------------------------------------------------------------
// Construcción del jsonb por estación (§12)
// ---------------------------------------------------------------------------
function construirRespuesta(estacionId) {
  const modal = $('modal-estacion');
  const scope = modal && !modal.hasAttribute('hidden') ? modal : document;

  switch (Number(estacionId)) {
    case 1: return construirE1(scope);
    case 2: return construirE2(scope);
    case 3: return construirE3(scope);
    case 4: return construirE4(scope);
    case 5: return construirE5(scope);
    default: return {};
  }
}

function construirE1(scope) {
  // { orden:[ids], eslabon:"cultivo" }
  // Orden: lee el orden actual del DOM (botones ↑/↓ reordenan).
  // Soporta múltiples selectores por compatibilidad con cl-render.
  const orden = [];
  const candidatos = scope.querySelectorAll(
    '[data-orden-item], .orden-item[data-id], #lista-orden [data-id], #estacion-interaccion [data-id]'
  );
  // Si el render usa una lista dedicada, priorizar esa lista
  const listaOrden = scope.querySelector('#lista-orden') || scope.querySelector('[data-lista="orden"]');
  const fuente = listaOrden ? listaOrden.querySelectorAll('[data-id]') : candidatos;
  fuente.forEach((el) => {
    const id = (el.getAttribute('data-id') || el.getAttribute('data-orden-item') || '').trim().toLowerCase();
    if (id) orden.push(id);
  });
  // Fallback: si no se encontró nada, intentar leer un input hidden con el orden serializado
  if (orden.length === 0) {
    const hidden = scope.querySelector('input[name="orden"], input[data-campo="orden"]');
    if (hidden && hidden.value) {
      try {
        const parsed = JSON.parse(hidden.value);
        if (Array.isArray(parsed)) return { orden: parsed.map((s) => String(s).toLowerCase().trim()), eslabon: leerEslabon(scope) };
      } catch { /* ignorar */ }
    }
  }
  return { orden, eslabon: leerEslabon(scope) };
}

function leerEslabon(scope) {
  // Busca el radio/select del eslabón crítico
  const checked = scope.querySelector('input[name="eslabon"]:checked, input[data-campo="eslabon"]:checked');
  if (checked) return String(checked.value).trim().toLowerCase();
  const sel = scope.querySelector('select[name="eslabon"], select[data-campo="eslabon"], #campo-eslabon');
  if (sel) return String(sel.value).trim().toLowerCase();
  const txt = scope.querySelector('input[name="eslabon"], input[data-campo="eslabon"]');
  if (txt) return String(txt.value).trim().toLowerCase();
  return '';
}

function construirE2(scope) {
  // { porcentaje:n, enganosa:"si"|"no" }
  const pct = leerNumero(scope, 'porcentaje');
  const eng = leerRadioOSelect(scope, 'enganosa');
  const out = {};
  if (pct != null) out.porcentaje = pct;
  if (eng) out.enganosa = eng.toLowerCase();
  return out;
}

function construirE3(scope) {
  // { porcentaje:n, inconsistencia:"a"|"b"|"c" }
  const pct = leerNumero(scope, 'porcentaje');
  const inc = leerRadioOSelect(scope, 'inconsistencia');
  const out = {};
  if (pct != null) out.porcentaje = pct;
  if (inc) out.inconsistencia = inc.toLowerCase();
  return out;
}

function construirE4(scope) {
  // { actores:[ids] }
  const checks = scope.querySelectorAll(
    'input[name="actores"]:checked, input[data-campo="actores"]:checked, input[type="checkbox"][data-actor]:checked, #estacion-interaccion input[type="checkbox"]:checked'
  );
  const actores = [];
  checks.forEach((c) => {
    const v = (c.value || c.getAttribute('data-actor') || c.getAttribute('data-id') || '').trim().toLowerCase();
    if (v) actores.push(v);
  });
  return { actores };
}

function construirE5(scope) {
  // { frases:[5] } — valores: "sin_evidencia" | "enganosa" | "verificable"
  // Orden posicional: f1..f5 según interaccion.items del seed.
  const frases = [];
  // Intenta selects/radios por frase
  for (let i = 1; i <= 5; i++) {
    const sel = scope.querySelector(
      `select[data-frase="${i}"], select[name="frase-${i}"], select[data-frase-id="f${i}"]`
    );
    if (sel) {
      const v = String(sel.value || '').trim().toLowerCase();
      frases.push(v || '');
      continue;
    }
    const checked = scope.querySelector(
      `input[name="frase-${i}"]:checked, input[name="f${i}"]:checked, input[data-frase="${i}"]:checked`
    );
    if (checked) {
      frases.push(String(checked.value).trim().toLowerCase());
      continue;
    }
    // Fallback: inputs con data-frase
    const inp = scope.querySelector(`[data-frase="${i}"]`);
    if (inp && inp.value) {
      frases.push(String(inp.value).trim().toLowerCase());
      continue;
    }
    frases.push('');
  }
  // Si no se encontró nada con el patrón anterior, intentar leer todos los selects de clasificación
  if (frases.every((f) => f === '')) {
    const todos = scope.querySelectorAll('#estacion-interaccion select, [data-rol="clasificacion"] select');
    if (todos.length === 5) {
      return { frases: Array.from(todos, (s) => String(s.value || '').trim().toLowerCase()) };
    }
    // Último fallback: radios agrupados por contenedor
    const grupos = scope.querySelectorAll('[data-frase-grupo]');
    if (grupos.length === 5) {
      return {
        frases: Array.from(grupos, (g) => {
          const c = g.querySelector('input:checked, select');
          return c ? String(c.value || '').trim().toLowerCase() : '';
        }),
      };
    }
  }
  // Filtrar vacíos finales si el usuario no completó todo: se envía lo que haya;
  // el servidor devuelve "vacio" o "parcial-n" según §12.
  // Pero mantenemos longitud 5 si hay algún valor, rellenando con ''.
  const tieneAlgo = frases.some((f) => f !== '');
  if (!tieneAlgo) return { frases: [] };
  return { frases };
}

function leerNumero(scope, campo) {
  const el = scope.querySelector(
    `input[data-campo="${campo}"], #campo-${campo}, input[name="${campo}"], input[id="${campo}"]`
  );
  if (!el) return null;
  const raw = String(el.value || '').trim().replace(',', '.');
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function leerRadioOSelect(scope, campo) {
  const checked = scope.querySelector(`input[name="${campo}"]:checked, input[data-campo="${campo}"]:checked`);
  if (checked) return String(checked.value).trim();
  const sel = scope.querySelector(`select[name="${campo}"], select[data-campo="${campo}"], #campo-${campo}`);
  if (sel) return String(sel.value).trim();
  const txt = scope.querySelector(`input[name="${campo}"], input[data-campo="${campo}"]`);
  if (txt) return String(txt.value).trim();
  return '';
}

// ---------------------------------------------------------------------------
// 5. Código maestro — normaliza con regex y llama Juego.verificarMaestro()
// ---------------------------------------------------------------------------
export async function verificarCodigoMaestro(codigoRaw) {
  const input = $('input-codigo-maestro');
  const raw = codigoRaw != null ? String(codigoRaw) : (input ? input.value : '');
  const normalizado = normalizarCodigo(raw);
  const equipoId = equipoActual && equipoActual.id;

  const feedback = $('feedback-maestro');
  if (feedback) {
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
  }

  if (!equipoId) {
    setFeedbackMaestro('No se encontró el equipo.', 'error');
    return { ok: false };
  }

  if (!normalizado) {
    setFeedbackMaestro('Ingresá el código maestro.', 'error');
    if (input) input.setAttribute('aria-invalid', 'true');
    return { ok: false };
  }

  if (input) input.setAttribute('aria-invalid', 'false');

  // Se envía el normalizado; el servidor vuelve a normalizar (§4.2) — doble tolerancia.
  let result;
  try {
    result = await Juego.verificarMaestro(equipoId, normalizado);
  } catch {
    setFeedbackMaestro('Sin conexión. Intentá de nuevo.', 'error');
    return { ok: false };
  }

  const datos = result && 'datos' in result ? result.datos : result;
  const error = result && 'error' in result ? result.error : null;

  if (error && !datos) {
    setFeedbackMaestro(typeof error === 'string' ? error : 'Error de red.', 'error');
    return { ok: false };
  }

  if (datos && datos.error) {
    setFeedbackMaestro(mensajeErrorServidor(datos.error), 'error');
    return { ok: false, error: datos.error };
  }

  if (datos && datos.ok === true) {
    setFeedbackMaestro('¡Código correcto! Veredicto desbloqueado.', 'ok');
    // Revelar veredicto si existe el contenedor
    const veredicto = $('pantalla-veredicto');
    if (veredicto) {
      veredicto.removeAttribute('hidden');
    }
    const texto = $('texto-veredicto');
    if (texto) texto.removeAttribute('hidden');
    window.dispatchEvent(new CustomEvent('juego:maestro-ok', { detail: datos }));
    return { ok: true, datos };
  }

  // Código incorrecto
  const detalle = datos && datos.detalle ? datos.detalle : 'codigo-mal';
  if (detalle === 'vacio') setFeedbackMaestro('Ingresá el código maestro.', 'error');
  else setFeedbackMaestro('Código incorrecto. Revisá los fragmentos obtenidos.', 'error');
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  return { ok: false, detalle };
}

function setFeedbackMaestro(texto, estado) {
  const fb = $('feedback-maestro');
  if (!fb) return;
  fb.textContent = texto;
  if (estado) fb.setAttribute('data-estado', estado);
  fb.removeAttribute('hidden');
}

// ---------------------------------------------------------------------------
// Cableado de eventos — se llama una sola vez desde initJuego()
// ---------------------------------------------------------------------------
let eventosEnlazados = false;

function enlazarEventosUnaVez() {
  if (eventosEnlazados) return;
  eventosEnlazados = true;

  // Delegación para abrir modal desde tarjetas
  const lista = $('lista-estaciones');
  if (lista) {
    lista.addEventListener('click', (e) => {
      const card = e.target.closest('.estacion-card[data-estacion]');
      if (!card) return;
      if (card.classList.contains('is-bloqueada') || card.getAttribute('aria-disabled') === 'true') return;
      const id = card.getAttribute('data-estacion');
      abrirModal(id);
    });
    lista.addEventListener('keydown', (e) => {
      const card = e.target.closest('.estacion-card[data-estacion]');
      if (!card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (card.classList.contains('is-bloqueada')) return;
        abrirModal(card.getAttribute('data-estacion'));
      }
    });
  }

  // Cerrar modal
  const btnCerrar = $('btn-cerrar-modal');
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarModal);

  const backdrop = $('modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', cerrarModal);

  // Botón Iniciar auditoría — sala de espera §7
  const btnIniciar = $('btn-iniciar');
  if (btnIniciar) btnIniciar.addEventListener('click', async ()=>{
    const bienvenida=$('pantalla-bienvenida');
    const dashboard=$('pantalla-dashboard');
    if(bienvenida) bienvenida.setAttribute('hidden','');
    if(dashboard) dashboard.removeAttribute('hidden');
    // Forzar refresco de estado para arrancar cronómetro server (primer acceso sella iniciado_en)
    const id = equipoActual?.id;
    if(id) await cargarEstado(id);
  });

  // Botón verificar dentro del modal — id puede variar; cubrimos variantes
  const btnVerificar = $('btn-verificar-estacion') || $('estacion-verificar') || document.querySelector('[data-accion="verificar-estacion"]');
  if (btnVerificar) btnVerificar.addEventListener('click', verificarEstacion);

  // Código maestro
  const btnMaestro = $('btn-verificar-maestro');
  if (btnMaestro) btnMaestro.addEventListener('click', () => verificarCodigoMaestro());

  const inputMaestro = $('input-codigo-maestro');
  if (inputMaestro) {
    inputMaestro.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        verificarCodigoMaestro();
      }
    });
  }

  // Teclado global: Esc cierra modal, Tab atrapa foco
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('modal-estacion');
      if (modal && !modal.hasAttribute('hidden')) {
        e.preventDefault();
        cerrarModal();
      }
    }
    atraparFoco(e);
  });
}

// Alias exigido por el contrato §5 — verificarMaestro es verificarCodigoMaestro
export const verificarMaestro = verificarCodigoMaestro;

// Auto-init si el DOM ya está listo y estamos en juego.html
if (typeof document !== 'undefined') {
  const enJuego = $('lista-estaciones') || $('modal-estacion') || $('sin-equipo');
  if (enJuego) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        // Evitar doble init si el HTML ya llama initJuego() explícitamente
        if (!eventosEnlazados) initJuego();
      });
    } else if (!eventosEnlazados) {
      // Diferir un tick para que api.js termine de inicializar si es necesario
      queueMicrotask(() => initJuego());
    }
  }
}
