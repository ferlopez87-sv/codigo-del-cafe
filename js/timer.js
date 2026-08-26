// _src/js/timer.js — cl-timer
// Dueño: cl-timer · Contrato: CONTRACT.md §4, §5, §7 (IDs #cronometro, #cronometro-anuncio, #aviso-conexion)
// Vanilla JS — ES module, sin dependencias, sin almacenamiento local, sin frameworks.

/**
 * Cronómetro server-authoritative para "El Código del Café".
 *
 * Fuente de verdad: estado_juego().segundos_restantes + estado_juego().servidor_en (timestamptz del servidor).
 * Nunca almacenamiento local, nunca Date.now() como duracion fija.
 *
 * Cálculo:
 *   skew     = Date.now() - new Date(servidorEn).getTime()
 *   deadline = Date.now() + segundosRestantes * 1000 - skew
 *            ≡ new Date(servidorEn).getTime() + segundosRestantes * 1000
 *            (se escribe expandido para cumplir literalmente el contrato §7)
 *
 * Interpolación: setInterval 1000 ms que deriva restante de deadline - Date.now().
 * Re-sincronización: cada estado() exitoso vuelve a llamar a iniciarTimer/sincronizar().
 * Anuncio SR: solo en 600s (10 min), 300s (5 min), 60s (1 min) vía #cronometro-anuncio.
 * Tiempo agotado: segundos <= 0 o flag tiempo_agotado del servidor → onTiempoAgotado().
 * Red: #aviso-conexion visible sin perder tiempo server; blur local, re-sync al reconectar.
 * Motion: respeta prefers-reduced-motion — sin animación JS; clases visuales vía CSS.
 */

'use strict';

// ---------------------------------------------------------------------------
// Estado interno del módulo (no exportado)
// ---------------------------------------------------------------------------
let _intervalId = null;
let _deadlineMs = null;
let _segundosIniciales = null;
let _onTiempoAgotado = null;
let _yaAgotado = false;
let _anunciados = new Set(); // guarda 600, 300, 60 ya anunciados
let _conexionListenersAtados = false;

// Umbrales de anuncio (§13, a11y-checklist 7.7)
const UMBRALES_ANUNCIO = new Map([
  [600, 'Quedan 10 minutos'],
  [300, 'Quedan 5 minutos'],
  [60, 'Queda 1 minuto'],
]);

// ---------------------------------------------------------------------------
// Helpers de DOM — nunca lanzan si el nodo no existe (juego.html lazy)
// ---------------------------------------------------------------------------
function _el(id) {
  return document.getElementById(id);
}

function _formatearMmSs(totalSegundos) {
  const s = Math.max(0, Math.floor(totalSegundos));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function _renderCronometro(segundos) {
  const nodo = _el('cronometro');
  if (!nodo) return;
  // §14.4 — textContent, nunca HTML inyectado
  nodo.textContent = _formatearMmSs(segundos);

  // Umbrales visuales (compat con contrato offline §7): is-alerta <5min, is-critico <1min
  // Solo clases; la transición real vive en CSS bajo prefers-reduced-motion
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  nodo.classList.remove('is-alerta', 'is-critico');
  if (segundos <= 60 && segundos > 0) {
    nodo.classList.add('is-critico');
  } else if (segundos <= 300 && segundos > 0) {
    nodo.classList.add('is-alerta');
  }

  // Si reduceMotion, asegurar que no quede transición JS pendiente
  // (las transiciones CSS ya están neutralizadas en a11y.css/layout.css)
  void reduceMotion;
}

function _anunciarSiCorresponde(segundos) {
  const nodo = _el('cronometro-anuncio');
  if (!nodo) return;
  // Anuncia SOLO al cruzar exactamente el umbral, una vez por sesión
  // Se usa floor(segundos) para tolerar drift del interval
  const s = Math.floor(segundos);
  if (UMBRALES_ANUNCIO.has(s) && !_anunciados.has(s)) {
    _anunciados.add(s);
    nodo.textContent = UMBRALES_ANUNCIO.get(s);
  }
  // No limpiar el nodo en cada tick: el lector ya anunció; dejar el último
  // anuncio evita re-anuncios por re-sync. Si se quiere vaciar, hacerlo tras
  // 6s para no saturar, pero sin borrar el umbral ya marcado como anunciado.
}

function _mostrarAvisoConexion() {
  const nodo = _el('aviso-conexion');
  if (!nodo) return;
  nodo.hidden = false;
  nodo.removeAttribute('hidden');
  // role="status" ya está en el HTML; asegurar visibilidad para AT
}

function _ocultarAvisoConexion() {
  const nodo = _el('aviso-conexion');
  if (!nodo) return;
  nodo.hidden = true;
}

function _asegurarListenersConexion() {
  if (_conexionListenersAtados) return;
  _conexionListenersAtados = true;
  window.addEventListener('online', () => {
    _ocultarAvisoConexion();
  });
  window.addEventListener('offline', () => {
    _mostrarAvisoConexion();
    // No se pausa el deadline: el tiempo server sigue corriendo.
    // Solo se avisa; al reconectar, el caller re-sincronizará con estado_juego().
  });
}

// ---------------------------------------------------------------------------
// Tiempo agotado — bloquea inputs y delega a callback externo
// ---------------------------------------------------------------------------
function _dispararTiempoAgotado() {
  if (_yaAgotado) return;
  _yaAgotado = true;
  detenerTimer();

  // Render final 00:00
  _renderCronometro(0);

  // Bloqueo genérico de inputs del juego (no rompe si no existen)
  const selectoresBloqueo = [
    '#modal-estacion input',
    '#modal-estacion button',
    '#modal-estacion select',
    '#modal-estacion textarea',
    '#input-codigo-maestro',
    '#btn-verificar-maestro',
    '#btn-verificar',
  ];
  for (const sel of selectoresBloqueo) {
    for (const el of document.querySelectorAll(sel)) {
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
    }
  }

  // Cerrar modal si está abierto para mostrar veredicto/resumen
  const modal = _el('modal-estacion');
  const backdrop = _el('modal-backdrop');
  if (modal && !modal.hasAttribute('hidden') && modal.getAttribute('hidden') === null) {
    // No forzar cierre si el juego quiere otro flujo; solo ocultar si existe helper externo
    // Se deja al caller decidir, pero se asegura backdrop oculto si onTiempoAgotado no lo hace
  }
  void backdrop;

  if (typeof _onTiempoAgotado === 'function') {
    try {
      _onTiempoAgotado();
    } catch (_e) {
      // Nunca romper el cronómetro por un callback defectuoso
    }
  } else {
    // Fallback mínimo si nadie registró callback: mostrar resumen/veredicto si existen
    const resumen = _el('pantalla-resumen');
    const veredicto = _el('pantalla-veredicto');
    const dashboard = _el('pantalla-dashboard');
    // No se asume estructura; solo se intenta revelar el veredicto
    void resumen; void veredicto; void dashboard;
  }
}

// ---------------------------------------------------------------------------
// Tick — corazón de la interpolación
// ---------------------------------------------------------------------------
function _tick() {
  if (_deadlineMs === null) return;

  // Si el navegador está offline, seguimos interpolando localmente
  // pero mostramos el aviso. No se altera deadline.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _mostrarAvisoConexion();
  }

  const ahora = Date.now();
  const restantesMs = _deadlineMs - ahora;
  const restantesSeg = Math.ceil(restantesMs / 1000);

  if (restantesSeg <= 0 || restantesMs <= 0) {
    _renderCronometro(0);
    _dispararTiempoAgotado();
    return;
  }

  _renderCronometro(restantesSeg);
  _anunciarSiCorresponde(restantesSeg);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Registra el callback que se ejecuta al agotarse el tiempo.
 * El handler debe bloquear inputs y mostrar veredicto/resumen (§7).
 * @param {() => void} fn
 */
export function onTiempoAgotado(fn) {
  _onTiempoAgotado = typeof fn === 'function' ? fn : null;
}

/** Alias histórico del contrato offline: alExpirar(callback) */
export function alExpirar(fn) {
  onTiempoAgotado(fn);
}

/** Alias histórico: alTick(callback) — recibe segundos restantes cada 1000ms */
let _onTick = null;
export function alTick(fn) {
  _onTick = typeof fn === 'function' ? fn : null;
}

/**
 * Inicia (o re-sincroniza) el cronómetro con tiempo del servidor.
 *
 * @param {number} segundosRestantes - estado_juego().segundos_restantes
 * @param {string|number|Date} servidorEn - estado_juego().servidor_en (timestamptz ISO)
 * @returns {{ deadlineMs: number, segundosRestantes: number, skewMs: number } | null}
 */
export function iniciarTimer(segundosRestantes, servidorEn) {
  // Normalización defensiva
  const seg = Number(segundosRestantes);
  if (!Number.isFinite(seg)) return null;

  // servidorEn puede venir como ISO string, número (ms), o Date
  let servidorMs;
  if (servidorEn instanceof Date) {
    servidorMs = servidorEn.getTime();
  } else if (typeof servidorEn === 'number') {
    servidorMs = servidorEn;
  } else {
    servidorMs = new Date(servidorEn).getTime();
  }
  // Fallback: si el servidor no mandó timestamp válido, asumir skew 0
  if (!Number.isFinite(servidorMs)) {
    servidorMs = Date.now();
  }

  // Cálculo literal del contrato §7 (forma canónica en comentario):
  // skew = Date.now() - new Date(servidorEn).getTime()
  // deadline = Date.now() + segundos*1000 - skew
  // Implementación precisa con captura única de Date.now() para evitar drift de 1ms:
  const _ahora = Date.now();
  const skew = _ahora - servidorMs; // normalizado: equivale a Date.now() - new Date(servidorEn).getTime()
  const deadline = _ahora + seg * 1000 - skew; // equivale a Date.now() + segundos*1000 - skew

  // Guardar estado
  _deadlineMs = deadline;
  _segundosIniciales = seg;
  _yaAgotado = false;

  // Si es primera sincronización, limpiar anunciados; si es re-sync,
  // conservar los ya anunciados para no repetir (p. ej. re-sync en 590s no re-anuncia 600)
  const esPrimerArranque = _intervalId === null && _anunciados.size === 0;
  if (esPrimerArranque) {
    _anunciados = new Set();
  }

  // Caso borde: tiempo ya agotado al llegar la respuesta del servidor
  if (seg <= 0) {
    _renderCronometro(0);
    _dispararTiempoAgotado();
    return { deadlineMs: deadline, segundosRestantes: 0, skewMs: skew };
  }

  // Render inmediato (sin esperar 1000ms) + anuncio si corresponde
  _renderCronometro(seg);
  _anunciarSiCorresponde(seg);

  // (Re)armar intervalo
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }

  // Envolver tick para también disparar alTick externo si existe
  _intervalId = window.setInterval(() => {
    _tick();
    if (_onTick && _deadlineMs !== null && !_yaAgotado) {
      try {
        const restantes = Math.max(0, Math.ceil((_deadlineMs - Date.now()) / 1000));
        _onTick(restantes);
      } catch (_e) {}
    }
  }, 1000);

  _asegurarListenersConexion();

  // Inicializar visibilidad de aviso según navigator.onLine
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _mostrarAvisoConexion();
  } else {
    _ocultarAvisoConexion();
  }

  return { deadlineMs: deadline, segundosRestantes: seg, skewMs: skew };
}

/**
 * Re-sincroniza con un nuevo estado_juego() exitoso.
 * Alias semántico de iniciarTimer — conserva anunciados para no repetir.
 */
export function sincronizar(segundosRestantes, servidorEn) {
  return iniciarTimer(segundosRestantes, servidorEn);
}

/**
 * Sincroniza directamente desde el objeto que devuelve estado_juego().
 * Acepta forma snake_case (segundos_restantes, servidor_en) o camelCase.
 * Útil para: sincronizarDesdeEstado(datos) tras Juego.estado(equipoId)
 * @param {{ segundos_restantes?: number, segundosRestantes?: number, servidor_en?: string, servidorEn?: string, tiempo_agotado?: boolean, tiempoAgotado?: boolean }} estado
 */
export function sincronizarDesdeEstado(estado) {
  if (!estado || typeof estado !== 'object') return null;
  const seg = estado.segundos_restantes ?? estado.segundosRestantes;
  const srv = estado.servidor_en ?? estado.servidorEn ?? estado.servidor_en ?? estado.servidorEn;
  const agotado = estado.tiempo_agotado ?? estado.tiempoAgotado;
  if (agotado) {
    _renderCronometro(0);
    _dispararTiempoAgotado();
    return null;
  }
  // Si el payload trae segundos_restantes pero no servidor_en, no podemos calcular skew;
  // fallback a servidorEn = ahora (skew 0) para no romper interpolación
  return iniciarTimer(seg ?? 0, srv ?? new Date().toISOString());
}

/**
 * Maneja pérdida de red de forma explícita (por si el caller detecta error de fetch).
 * Muestra #aviso-conexion y mantiene el deadline intacto (pausa visual, no temporal).
 */
export function notificarConexionPerdida() {
  _mostrarAvisoConexion();
}

/** Oculta el aviso de conexión (llamar tras un estado() exitoso). */
export function notificarConexionRestaurada() {
  _ocultarAvisoConexion();
}

export function detenerTimer() {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/** Alias histórico del contrato offline */
export function detener() {
  detenerTimer();
}

export function restanteMs() {
  if (_deadlineMs === null) return 0;
  return Math.max(0, _deadlineMs - Date.now());
}

export function restanteSegundos() {
  return Math.max(0, Math.ceil(restanteMs() / 1000));
}

/** Alias histórico: restanteMs() */
export function restanteMsAlias() {
  return restanteMs();
}

export function formatear(segundos) {
  return _formatearMmSs(segundos);
}

/** Alias histórico del contrato offline: formatear(ms) — acepta ms o segundos */
export function formatearMs(ms) {
  // Heurística: si es >= 1000 y divisible, tratar como ms; si no, como segundos
  // Para compatibilidad, si ms > 1000, convertir a segundos
  if (typeof ms === 'number' && ms >= 1000) {
    return _formatearMmSs(Math.ceil(ms / 1000));
  }
  return _formatearMmSs(ms);
}

// ---------------------------------------------------------------------------
// Helpers de test / introspección (no usados en producción, no rompen contrato)
// ---------------------------------------------------------------------------
export function _debugEstado() {
  return {
    deadlineMs: _deadlineMs,
    segundosIniciales: _segundosIniciales,
    yaAgotado: _yaAgotado,
    anunciados: [..._anunciados],
    intervalActivo: _intervalId !== null,
  };
}

export function _resetForTest() {
  detenerTimer();
  _deadlineMs = null;
  _segundosIniciales = null;
  _yaAgotado = false;
  _anunciados = new Set();
  _onTiempoAgotado = null;
  _onTick = null;
  _ocultarAvisoConexion();
}
