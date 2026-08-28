// _src/js/juego.js — cl-juego
// Dueño: cl-juego. Vanilla ES module. Único que conoce el estado global del equipo.
// Contrato: CONTRACT.md §4.2, §5-7, §11-12. Sin llamada directa de red (usa js/api.js),
// sin calculo de tiempo (delega a cl-timer), pinta datos con textContent.
//
// Reescrito 2026-08-25: de modal a tablero persistente (CONTRACT §7.2). El panel de
// estación ya no es un diálogo que se abre/cierra — es contenido normal de la página
// que se repinta al elegir una sala en la barra lateral (#nav-salas). Por eso ya no
// hay foco atrapado, backdrop, ni `inert` sobre el resto de la página: no hace falta,
// nada queda "detrás" de un overlay.

import { Auth, Juego } from './api.js';
import { renderInteraccion, serializarRespuesta } from './render.js';
import { sincronizarDesdeEstado, onTiempoAgotado } from './timer.js';
import { ESTACIONES_UI } from './contenido.js';

// ---------------------------------------------------------------------------
// Estado global — memoria volátil del módulo, no persiste en localStorage.
// ---------------------------------------------------------------------------
let equipoActual = null;
let sesionActual = null;
let estacionActual = null;
let perfilActual = null; // { id, nombre, correo, carne, rol } de Auth.sesion() — para #usuario-actual

// Cache de estaciones_publicas — contenido estático por partida (§10, §5).
// Se pide una sola vez con Juego.estaciones() y se reutiliza en cada selección de sala.
let estacionesCache = null;
let estacionesCargando = null;

// Mapa de clases de estado admitidas por el contrato §7
// Las 5 estaciones son fijas por contrato (inicializar_progreso las exige).
const TOTAL_ESTACIONES = 5;
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
// Contenido de estaciones — Juego.estaciones() cacheado (§5, §10, §11)
// ---------------------------------------------------------------------------
async function obtenerEstacionesPublicas() {
  if (estacionesCache) return estacionesCache;
  if (estacionesCargando) return estacionesCargando;

  estacionesCargando = (async () => {
    let respuesta;
    try {
      respuesta = await Juego.estaciones();
    } catch {
      return null;
    }
    const datos = respuesta && 'datos' in respuesta ? respuesta.datos : respuesta;
    const error = respuesta && 'error' in respuesta ? respuesta.error : null;
    if (error || !Array.isArray(datos)) return null;
    estacionesCache = datos;
    return estacionesCache;
  })();

  const resultado = await estacionesCargando;
  estacionesCargando = null;
  return resultado;
}

// Fisher-Yates — usado solo para el orden inicial de E1 (contenido.js: ordenInicialAleatorio)
function barajar(items) {
  const copia = items.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// El servidor entrega interaccion.items de E1 en el orden correcto (es también la
// respuesta esperada) — ESTACIONES_UI[1].ordenInicialAleatorio pide barajar del lado
// cliente antes de pintar, para no regalar la solución por el orden de aparición.
function prepararInteraccion(estacion) {
  const interaccion = estacion && estacion.interaccion;
  if (!interaccion || typeof interaccion !== 'object') return interaccion;
  const id = Number(estacion.id);
  const ui = ESTACIONES_UI[id];
  if (id === 1 && ui && ui.ordenInicialAleatorio && Array.isArray(interaccion.items)) {
    return { ...interaccion, items: barajar(interaccion.items) };
  }
  return interaccion;
}

// ---------------------------------------------------------------------------
// Pintado del contenido real de la estación dentro de #panel-estacion (§7.2, §11, §14.4)
// Todo con textContent/createElement — nunca innerHTML con datos del servidor.
// ---------------------------------------------------------------------------
function humanizarClave(clave) {
  const s = String(clave ?? '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pintarValorDato(contenedorDd, valor) {
  if (Array.isArray(valor)) {
    const ul = document.createElement('ul');
    valor.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item && typeof item === 'object' ? JSON.stringify(item) : String(item);
      ul.appendChild(li);
    });
    contenedorDd.appendChild(ul);
  } else if (valor && typeof valor === 'object') {
    const subDl = document.createElement('dl');
    Object.entries(valor).forEach(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = humanizarClave(k);
      const dd = document.createElement('dd');
      pintarValorDato(dd, v);
      subDl.appendChild(dt);
      subDl.appendChild(dd);
    });
    contenedorDd.appendChild(subDl);
  } else {
    contenedorDd.textContent = valor == null ? '' : String(valor);
  }
}

// Cada dato del expediente se pinta como una tarjeta .exhibit (Stitch v2,
// diseño "Forensic Audit Protocol" — superficie color papel, ver styles.css
// §11.1). Antes era un <dl> plano; una tarjeta por dato es lo que hace que
// el dato se lea como evidencia y no como una lista de configuración.
function pintarDatosEstacion(contenedor, datos) {
  while (contenedor.firstChild) contenedor.removeChild(contenedor.firstChild);
  if (!datos || typeof datos !== 'object') return;
  Object.entries(datos).forEach(([clave, valor]) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'exhibit';
    const etiqueta = document.createElement('span');
    etiqueta.className = 'exhibit__etiqueta';
    etiqueta.textContent = humanizarClave(clave);
    const cuerpo = document.createElement('p');
    cuerpo.className = 'exhibit__valor';
    pintarValorDato(cuerpo, valor);
    tarjeta.appendChild(etiqueta);
    tarjeta.appendChild(cuerpo);
    contenedor.appendChild(tarjeta);
  });
}

function pintarTituloEstacion(estacion) {
  // #estacion-titulo (CONTRACT §7.2): antes #modal-estacion-titulo, renombrado
  // porque ya no vive dentro de un diálogo modal.
  const h2 = $('estacion-titulo');
  if (h2) h2.textContent = estacion.titulo || `Estación ${estacion.id}`;
  const pilarEl = $('estacion-pilar');
  if (pilarEl) pilarEl.textContent = estacion.pilar || '';
}

// Reconoce ÚNICAMENTE <b>...</b> en el texto de contenido (CONTRACT §14.4:
// nunca innerHTML con datos dinámicos) y arma <strong>/texto plano a mano —
// cualquier otro `<...>` que aparezca en el contenido queda como texto
// literal, igual que si esta función no existiera. 2026-08-28: antes
// pintarNarrativaEstacion hacía p.textContent = texto directo, así que un
// <b> ya presente en el contenido (Sala de Hechos) se veía literal
// ("&lt;b&gt;...") en vez de negrita real — encontrado al verificar contra
// el juego real el pedido de negrita en Sala Verde.
function _pintarConNegritas(contenedor, texto) {
  const partes = String(texto || '').split(/<b>(.*?)<\/b>/);
  partes.forEach((parte, i) => {
    if (!parte) return;
    if (i % 2 === 1) {
      const strong = document.createElement('strong');
      strong.textContent = parte;
      contenedor.appendChild(strong);
    } else {
      contenedor.appendChild(document.createTextNode(parte));
    }
  });
}

function pintarNarrativaEstacion(texto) {
  const cont = $('estacion-narrativa');
  if (!cont) return;
  while (cont.firstChild) cont.removeChild(cont.firstChild);
  const p = document.createElement('p');
  _pintarConNegritas(p, texto);
  cont.appendChild(p);
}

function pintarRetoEstacion(texto) {
  const el = $('estacion-reto-texto');
  if (!el) return;
  const strongPrevio = el.querySelector('strong');
  while (el.firstChild) el.removeChild(el.firstChild);
  if (strongPrevio) {
    el.appendChild(strongPrevio);
  } else {
    const s = document.createElement('strong');
    s.textContent = 'Reto:';
    el.appendChild(s);
  }
  el.appendChild(document.createTextNode(' ' + (texto || '')));
}

async function pintarEstacionEnPanel(id) {
  const lista = await obtenerEstacionesPublicas();
  if (!lista) {
    mostrarFeedbackEstacion('No se pudo cargar el contenido de la estación. Revisá tu conexión.', 'error');
    return;
  }
  const estacion = lista.find((e) => Number(e.id) === Number(id));
  if (!estacion) {
    mostrarFeedbackEstacion('No se encontró el contenido de esta estación.', 'error');
    return;
  }

  pintarTituloEstacion(estacion);
  pintarNarrativaEstacion(estacion.narrativa);

  const datosEl = $('estacion-datos');
  if (datosEl) pintarDatosEstacion(datosEl, estacion.datos);

  pintarRetoEstacion(estacion.reto);

  const interaccionEl = $('estacion-interaccion');
  if (interaccionEl) {
    renderInteraccion(interaccionEl, prepararInteraccion(estacion));
    if(!soyApuntador){
      interaccionEl.querySelectorAll('input,select,button,textarea').forEach(el=>{ el.disabled = true; });
      // El tablero de E1 son <div>/<li>, no controles de formulario: `disabled`
      // no existe para ellos, asi que el selector de arriba no los tocaba y
      // cualquier integrante podia arrastrar tarjetas y creer que su respuesta
      // contaba. Se bloquea por aria-disabled (el CSS corta pointer-events) y
      // se saca del orden de tabulacion.
      interaccionEl.querySelectorAll('.orden-tarjeta,.orden-casilla').forEach(el=>{
        el.setAttribute('aria-disabled','true');
        el.setAttribute('draggable','false');
        el.setAttribute('tabindex','-1');
      });
      const b = $('btn-verificar-estacion'); if(b){ b.disabled=true; b.setAttribute('aria-disabled','true'); }
    }
  }
}

// ---------------------------------------------------------------------------
// 1. initJuego() — puerta de entrada de juego.html
// ---------------------------------------------------------------------------
export async function initJuego() {
  // §1 y §7: cada página verifica sesión al cargar y redirige.
  // OJO (bug real encontrado con navegador real 2026-08-26, no con stubs):
  // Auth.sesion() devuelve siempre { datos, error } — ese objeto envoltorio
  // nunca es falsy, aunque datos sea null. `if (!sesion)` nunca disparaba, así
  // que juego.html seguía de largo sin sesión y llamaba a Juego.miEquipo()
  // igual (404 real contra Supabase). Hay que revisar `.datos`, como ya hace
  // (correctamente) initDocente() en js/docente.js.
  let sesion = null;
  try {
    const r = Auth.sesion();
    sesion = r instanceof Promise ? await r : r;
  } catch {
    sesion = null;
  }

  const datosSesion = sesion?.datos;
  // Cookie httpOnly: no hay access_token. Sesión válida si hay datos y no hay error (401 → error)
  if (!datosSesion || sesion?.error) {
    window.location.href = 'index.html#vista-acceso';
    return;
  }
  perfilActual = datosSesion;
  pintarUsuarioActual();

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
    mostrarErrorGlobal(mensajeDeError(error));
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

  // Se enlaza ANTES de pintar/cargar estado: cargarEstado() más abajo puede
  // sincronizar cl-timer por primera vez, y si el tiempo ya estaba agotado al
  // entrar, onTiempoAgotado() debe estar registrado para que _dispararTiempoAgotado()
  // no caiga en su fallback silencioso por falta de callback.
  enlazarEventosUnaVez();

  ocultarSinEquipo();
  // §7: sala de espera si aún no arranca el reloj (iniciado_en null)
  const iniciado = equipo?.iniciado_en || datos.iniciado_en || datos.equipo?.iniciado_en;
  if(!iniciado){
    mostrarBienvenida();
  } else {
    mostrarDashboard();
  }

  // Primer pintado con lo que ya trae miEquipo(). OJO (bug real encontrado
  // en navegador, no con stubs): esto estaba gateado por
  // `Array.isArray(datos.estaciones)`, pero miEquipo() nunca trae esa
  // clave (solo estado_juego() la trae) — así que pintarEstadoDesdeDatos()
  // nunca corría acá, y el bloque de adentro que lee `soy_apuntador` y
  // pinta integrantes/nombre de equipo tampoco. Resultado: CUALQUIERA veía
  // el botón de enviar respuesta habilitado como si fuera el apuntador
  // (el valor por defecto de soyApuntador nunca se corregía), hasta que
  // intentaba enviar y el servidor lo rechazaba — eso es lo que se
  // reportaba como "error de red" al enviar la primera respuesta.
  // pintarEstadoDesdeDatos() ya tolera la ausencia de `estaciones` (usa []
  // como fallback), así que llamarla siempre acá es seguro; estado_juego()
  // pinta encima con los datos reales de las salas un instante después.
  pintarEstadoDesdeDatos(datos);

  await cargarEstado(equipoId);
}

// ---------------------------------------------------------------------------
// Visibilidad de pantallas §7
// ---------------------------------------------------------------------------
// Las 5 pantallas de nivel superior de juego.html (CONTRACT §9/§11) son
// mutuamente excluyentes. Antes solo se manejaban bienvenida/sin-equipo/
// dashboard entre sí — veredicto y resumen se quedaban sin `hidden` inicial
// y ninguna función las ocultaba, así que aparecían siempre superpuestas al
// tablero (bug real, encontrado probando en navegador). Este helper es el
// único punto que las oculta todas antes de mostrar la que corresponde.
function ocultarPantallasSuperiores() {
  ['sin-equipo', 'pantalla-dashboard', 'pantalla-bienvenida', 'pantalla-veredicto', 'pantalla-resumen']
    .forEach((id) => { const el = $(id); if (el) el.setAttribute('hidden', ''); });
}

function mostrarSinEquipo() {
  ocultarPantallasSuperiores();
  const sinEquipo = $('sin-equipo');
  if (sinEquipo) sinEquipo.removeAttribute('hidden');
}

function ocultarSinEquipo() {
  const el = $('sin-equipo');
  if (el) {
    el.setAttribute('hidden', '');
  }
}

function mostrarBienvenida(){
  ocultarPantallasSuperiores();
  const bienvenida=$('pantalla-bienvenida');
  if(bienvenida) bienvenida.removeAttribute('hidden');
  // Mostrar nombre equipo e integrantes en bienvenida si están disponibles
  if(equipoActual){
    const nombreEl=$('bienvenida-equipo-nombre');
    if(nombreEl) nombreEl.textContent = equipoActual.nombre || equipoActual.equipo || 'Equipo';
  }
}
function mostrarDashboard() {
  ocultarPantallasSuperiores();
  const dash = $('pantalla-dashboard');
  if (dash) dash.removeAttribute('hidden');
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
    // Errores esperados del servidor (§4.1): no_autorizado, sesion_cerrada, tiempo_agotado
    if (datos && datos.error) {
      manejarErrorEstado(datos.error);
      return;
    }
    mostrarErrorGlobal(mensajeDeError(error));
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
    case 'sesion_no_abierta': return 'Tu docente todavía no abrió la sesión. Avisale y volvé a intentar — no hace falta recargar.';
    case 'tiempo_agotado': return 'Se agotó el tiempo de la sesión.';
    case 'bloqueada': return 'Esta estación sigue bloqueada. Resolvé las cuatro anteriores primero.';
    case 'estacion_invalida': return 'Estación no válida.';
    case 'no_apuntador': return 'Solo la persona apuntadora del equipo puede enviar respuestas. Pedile que la mande ella.';
    case 'sin_apuntador': return 'Tu equipo todavía no tiene apuntador/a — pedile al docente que marque uno en el panel.';
    case 'red': return 'Sin conexión. Verificá tu internet e intentá de nuevo.';
    case 'error_interno': return 'Error del servidor. Intentá de nuevo en un momento.';
    default: return String(codigo);
  }
}

// api.js (§5.2) siempre entrega los errores como OBJETO {mensaje, codigo,
// estado} — nunca como string. Los `typeof error === 'string'` que había en
// cada llamador de acá abajo nunca eran ciertos, así que CUALQUIER rechazo
// del servidor (apuntador equivocado, estación bloqueada, sesión cerrada,
// lo que sea) cascaba al mismo "Error de red." genérico, sin decir qué
// pasó — eso es lo que se reportaba como "error de red" al enviar la
// primera respuesta, cuando en realidad era p.ej. "no_apuntador".
function mensajeDeError(error) {
  if (!error) return mensajeErrorServidor('red');
  if (typeof error === 'string') return mensajeErrorServidor(error);
  return mensajeErrorServidor(error.codigo || 'red');
}

function deshabilitarInteraccionesPorCierre(codigo) {
  const btnMaestro = $('btn-verificar-maestro');
  if (btnMaestro) btnMaestro.setAttribute('aria-disabled', 'true');
  const inputMaestro = $('input-codigo-maestro');
  if (inputMaestro) inputMaestro.setAttribute('aria-disabled', 'true');
  // Sesion cerrada o tiempo agotado es terminal: navegar a otra sala solo
  // llevaria a un tablero que ya no acepta respuestas. La bandera sobrevive a
  // los repintados, que si no volverian a habilitar el boton.
  juegoCerrado = true;
  actualizarBotonSiguiente();
}

// ---------------------------------------------------------------------------
// Drawer móvil — mismo #sidebar-salas en desktop y móvil (§11)
// En móvil entra/sale con translate; en desktop es estático. No se duplica
// #nav-salas para no tener dos fuentes de estado.
// ---------------------------------------------------------------------------
function abrirMenuMobile(){
  const nav = $('sidebar-salas'); const bd = $('backdrop-mobile'); const btn = $('btn-menu-mobile');
  if(nav) nav.classList.add('is-abierta');
  if(bd) bd.removeAttribute('hidden');
  if(btn) btn.setAttribute('aria-expanded','true');
  document.body.classList.add('is-menu-abierto');
}
function cerrarMenuMobile(){
  const nav = $('sidebar-salas'); const bd = $('backdrop-mobile'); const btn = $('btn-menu-mobile');
  if(nav) nav.classList.remove('is-abierta');
  if(bd) bd.setAttribute('hidden','');
  if(btn) btn.setAttribute('aria-expanded','false');
  document.body.classList.remove('is-menu-abierto');
  if(btn) btn.focus();
}
function toggleMenuMobile(){
  const nav = $('sidebar-salas');
  if(nav && nav.classList.contains('is-abierta')) cerrarMenuMobile();
  else abrirMenuMobile();
}

// ---------------------------------------------------------------------------
// Pintado — barra lateral, panel, contador, fragmentos (§7.2)
// ---------------------------------------------------------------------------
// Quién está logueado debe verse todo el tiempo (§sidebar-salas, fuera de
// las <section> que se ocultan/muestran entre pantallas) — antes no había
// ningún indicador y era fácil perder de vista con qué cuenta se estaba
// jugando, sobre todo probando varios integrantes del mismo equipo seguido.
function pintarUsuarioActual(){
  const el = $('usuario-actual-texto');
  if(!el || !perfilActual) return;
  const base = perfilActual.nombre || perfilActual.correo || '';
  el.textContent = soyApuntador ? `${base} ★ apuntador/a` : base;
}

let soyApuntador = true;
let nombreApuntador = '';
function aplicarModoApuntador(soy, nombre){
  soyApuntador = soy !== false;
  nombreApuntador = nombre || '';
  pintarUsuarioActual();
  const aviso = $('aviso-solo-apuntador');
  const btn = $('btn-verificar-estacion');
  const btnM = $('btn-verificar-maestro');
  const txt = $('aviso-solo-apuntador-texto') || (aviso ? aviso.querySelector('span:last-child') : null);
  if(!soyApuntador){
    if(aviso){ aviso.removeAttribute('hidden'); if(txt) txt.textContent = `Solo ${nombreApuntador || 'tu apuntador'} puede enviar la respuesta de tu equipo. Podés seguir el expediente y discutir con tu equipo.`; }
    if(btn){ btn.disabled = true; btn.setAttribute('aria-disabled','true'); }
    if(btnM){ btnM.disabled = true; btnM.setAttribute('aria-disabled','true'); }
    // deshabilitar controles de interacción actuales
    const inter = $('estacion-interaccion');
    if(inter) inter.querySelectorAll('input,select,button,textarea').forEach(el=>{ el.disabled = true; });
  } else {
    if(aviso) aviso.setAttribute('hidden','');
    if(btn){ btn.disabled = false; btn.removeAttribute('aria-disabled'); }
    if(btnM){ btnM.disabled = false; btnM.removeAttribute('aria-disabled'); }
  }
}
function pintarEstadoDesdeDatos(datos) {
  const estaciones = Array.isArray(datos.estaciones) ? datos.estaciones : [];
  const resueltas = typeof datos.resueltas === 'number'
    ? datos.resueltas
    : estaciones.filter((e) => e.estado === 'resuelta').length;

  pintarTarjetas(estaciones);
  pintarBarraProgreso(resueltas, 5);
  pintarFragmentos(estaciones);
  // Apuntador §4.1 §11
  if('soy_apuntador' in datos || 'soyApuntador' in datos){
    const soy = datos.soy_apuntador ?? datos.soyApuntador;
    const integrantes = datos.integrantes || datos.equipo?.integrantes || [];
    let nombre = '';
    if(Array.isArray(integrantes)){
      const ap = integrantes.find(i=> i.es_apuntador || i.esApuntador);
      if(ap) nombre = ap.nombre || ap.correo || '';
    }
    aplicarModoApuntador(soy, nombre);
    // pintar lista de integrantes con indicador
    const ul = $('lista-integrantes');
    if(ul && Array.isArray(integrantes)){
      while(ul.firstChild) ul.removeChild(ul.firstChild);
      integrantes.forEach(it=>{
        const li=document.createElement('li');
        li.className = it.es_apuntador ? 'integrante--apuntador font-bold' : '';
        li.textContent = `${it.nombre || it.correo}${it.es_apuntador ? ' — apuntador/a ★' : ''}`;
        li.setAttribute('role','listitem');
        ul.appendChild(li);
      });
    }
    // nombre equipo
    const ne = $('nombre-equipo-activo'); if(ne) ne.textContent = datos.equipo?.nombre || datos.nombre || ne.textContent;
    const be = $('bienvenida-equipo-nombre'); if(be) be.textContent = `Equipo: ${datos.equipo?.nombre || datos.nombre || '—'}`;
  }

  // El tiempo lo posee el servidor; aquí no se calcula ni se interpola.
  // cl-timer recibe el estado crudo y hace su propio cálculo/interpolación (§7).
  if (typeof datos.segundos_restantes === 'number' || datos.tiempo_agotado) {
    sincronizarDesdeEstado(datos);
  }
}

function pintarTarjetas(estaciones) {
  // #nav-salas (CONTRACT §7.2): antes #lista-estaciones. Los botones siguen
  // siendo .estacion-card[data-estacion] — mismas clases de estado, mismo
  // tratamiento visual con icono (nunca solo color, §13), solo cambió el
  // contenedor que los agrupa (de grilla de tarjetas a lista de la barra lateral).
  const lista = $('nav-salas');
  if (!lista) return;

  estaciones.forEach((est) => {
    const id = est.estacion_id ?? est.id;
    const estado = ESTADOS_VALIDOS.includes(est.estado) ? est.estado : 'pendiente';
    const card = lista.querySelector(`.estacion-card[data-estacion="${id}"]`);
    if (!card) return;

    // Clases is-*: solo una activa a la vez (§7)
    card.classList.remove(...CLASES_ESTADO);
    card.classList.add(`is-${estado}`);

    // Accesibilidad: aria-disabled en bloqueada
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
    }
  });

  // Resolver una sala desbloquea la siguiente: el boton tiene que enterarse en
  // el mismo repintado, si no se queda apagado hasta recargar.
  actualizarBotonSiguiente();
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
// 3. #panel-estacion — seleccionar sala (antes: abrir/cerrar modal, §7.2)
// ---------------------------------------------------------------------------
export async function seleccionarSala(estacionId) {
  const id = Number(estacionId);
  if (!Number.isInteger(id) || id < 1 || id > 5) return;

  // Bloqueada no se selecciona — el servidor es la autoridad, pero evitamos el viaje inútil.
  const card = document.querySelector(`.estacion-card[data-estacion="${id}"]`);
  if (card && card.classList.contains('is-bloqueada')) return;

  estacionActual = id;

  // Marcar cuál sala está activa en la barra lateral (aria-current, §13)
  document.querySelectorAll('#nav-salas .estacion-card[data-estacion]').forEach((c) => {
    c.setAttribute('aria-current', c === card ? 'true' : 'false');
  });

  // Mostrar el panel de contenido, ocultar el estado vacío inicial
  setHidden($('panel-estacion-vacio'), true);
  setHidden($('panel-estacion-contenido'), false);

  // Limpiar feedback previo de la sala anterior
  limpiarFeedbackEstacion();

  // Narrativa/datos/reto/interacción real de estaciones_publicas (§5, §11)
  await pintarEstacionEnPanel(id);

  // Foco al título de la nueva sala — equivalente accesible a lo que hacía el
  // modal, sin el resto del aparataje de diálogo (ya no hace falta atrapar
  // foco ni restaurarlo: el panel es contenido normal de la página, no un overlay).
  const h2 = $('estacion-titulo');
  if (h2) {
    if (!h2.hasAttribute('tabindex')) h2.setAttribute('tabindex', '-1');
    h2.focus();
  }

  actualizarBotonSiguiente();
}

// Boton "Siguiente sala" — vive al lado de Verificar, dentro de #panel-estacion.
// Hasta ahora la unica forma de avanzar era volver a la barra lateral; en
// proyector, con el panel scrolleado hasta el feedback, la barra queda fuera de
// vista y el grupo se quedaba sin saber como seguir.
//
// No decide por su cuenta si la sala siguiente esta disponible: lee el estado
// que ya pinto el servidor en la barra lateral (.is-bloqueada), asi no hay dos
// nociones de "desbloqueada" que se puedan contradecir.
let juegoCerrado = false;

function actualizarBotonSiguiente() {
  const btn = $('btn-siguiente-sala');
  if (!btn) return;
  const motivo = $('siguiente-sala-motivo');

  const siguiente = estacionActual == null ? null : Number(estacionActual) + 1;

  // En la Sala 5 no hay siguiente: el paso es el codigo maestro, que ya tiene
  // su propia seccion. Mostrar un boton muerto ahi solo confunde.
  if (!siguiente || siguiente > TOTAL_ESTACIONES) {
    setHidden(btn, true);
    setHidden(motivo, true);
    delete btn.dataset.destino;
    return;
  }

  const card = document.querySelector(`#nav-salas .estacion-card[data-estacion="${siguiente}"]`);
  const bloqueada = juegoCerrado || !card || card.classList.contains('is-bloqueada');

  setHidden(btn, false);
  btn.dataset.destino = String(siguiente);
  btn.disabled = bloqueada;
  btn.setAttribute('aria-disabled', String(bloqueada));
  btn.setAttribute('aria-label', bloqueada ? `Siguiente sala (Sala ${siguiente}, bloqueada)` : `Ir a la Sala ${siguiente}`);

  // El motivo se dice con texto, no solo con el boton apagado (§13: ningun
  // estado solo por color/forma).
  if (motivo) {
    if (!bloqueada) {
      setHidden(motivo, true);
      motivo.textContent = '';
    } else {
      motivo.textContent = juegoCerrado
        ? 'La sesión está cerrada: ya no se puede avanzar.'
        : `La Sala ${siguiente} se desbloquea cuando resuelvas esta.`;
      setHidden(motivo, false);
    }
  }
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

  // serializarRespuesta() lee el estado interno que dejó el último renderInteraccion()
  // (cl-render, §11-12). Si vino vacío, igual se envía para que el servidor
  // devuelva detalle "vacio" y la pista escalonada; no se bloquea el envío.
  const respuesta = serializarRespuesta();

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
    mostrarFeedbackEstacion(mensajeDeError(error), 'error');
    // El servidor manda {error:'sesion_cerrada'} con status 200, y api.js
    // normaliza eso a {datos:null, error:{codigo}} — no a {datos:{error}}. Por
    // eso la rama de abajo que mira datos.error nunca se alcanzaba para este
    // caso y la partida seguia "viva" despues de cerrada: se veia el aviso
    // pero los controles quedaban habilitados. Hay que leer error.codigo aca.
    const cod = typeof error === 'string' ? error : (error && error.codigo);
    if (cod === 'tiempo_agotado' || cod === 'sesion_cerrada') {
      deshabilitarInteraccionesPorCierre(cod);
    }
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
    // mostrarFeedbackEstacion ya escribe #estacion-intentos vía su parámetro intentosTexto.
    mostrarFeedbackEstacion(feedback, 'ok', intentos);
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
    // mostrarFeedbackEstacion ya escribe #estacion-intentos vía su parámetro intentosTexto.
    mostrarFeedbackEstacion(texto, 'alerta', intentos);
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
    setFeedbackMaestro(mensajeDeError(error), 'error');
    return { ok: false };
  }

  if (datos && datos.error) {
    setFeedbackMaestro(mensajeErrorServidor(datos.error), 'error');
    return { ok: false, error: datos.error };
  }

  if (datos && datos.ok === true) {
    setFeedbackMaestro('¡Código correcto! Veredicto desbloqueado.', 'ok');
    // Revelar veredicto — y ocultar el tablero, antes se quedaban los dos
    // superpuestos porque nada apagaba #pantalla-dashboard acá.
    ocultarPantallasSuperiores();
    const veredicto = $('pantalla-veredicto');
    if (veredicto) {
      veredicto.removeAttribute('hidden');
    }
    const texto = $('texto-veredicto');
    if (texto) {
      texto.removeAttribute('hidden');
      if (datos.veredicto) texto.textContent = datos.veredicto;
    }
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

  // Delegación para seleccionar sala desde la barra lateral (#nav-salas, §7.2)
  const lista = $('nav-salas');
  if (lista) {
    lista.addEventListener('click', (e) => {
      const card = e.target.closest('.estacion-card[data-estacion]');
      if (!card) return;
      if (card.classList.contains('is-bloqueada') || card.getAttribute('aria-disabled') === 'true') return;
      const id = card.getAttribute('data-estacion');
      seleccionarSala(id);
      // En móvil el drawer taparía el panel recién pintado
      if(window.innerWidth < 768) cerrarMenuMobile();
    });
    lista.addEventListener('keydown', (e) => {
      const card = e.target.closest('.estacion-card[data-estacion]');
      if (!card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (card.classList.contains('is-bloqueada')) return;
        seleccionarSala(card.getAttribute('data-estacion'));
        if(window.innerWidth < 768) cerrarMenuMobile();
      }
    });
  }

  // Drawer móvil
  const btnMenu = $('btn-menu-mobile');
  if(btnMenu) btnMenu.addEventListener('click', toggleMenuMobile);
  const btnCerrar = $('btn-cerrar-menu-mobile');
  if(btnCerrar) btnCerrar.addEventListener('click', cerrarMenuMobile);
  const backdrop = $('backdrop-mobile');
  if(backdrop) backdrop.addEventListener('click', cerrarMenuMobile);
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      const nav=$('sidebar-salas');
      if(nav && nav.classList.contains('is-abierta')){ e.preventDefault(); cerrarMenuMobile(); }
    }
  });

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

  // Botón verificar dentro de #panel-estacion
  const btnVerificar = $('btn-verificar-estacion') || $('estacion-verificar') || document.querySelector('[data-accion="verificar-estacion"]');
  if (btnVerificar) btnVerificar.addEventListener('click', verificarEstacion);

  // Botón "Siguiente sala" — el destino lo dejo actualizarBotonSiguiente() en
  // data-destino, para no recalcular aqui una segunda nocion de "la siguiente".
  const btnSiguiente = $('btn-siguiente-sala');
  if (btnSiguiente) btnSiguiente.addEventListener('click', () => {
    if (btnSiguiente.disabled || btnSiguiente.getAttribute('aria-disabled') === 'true') return;
    const destino = Number(btnSiguiente.dataset.destino);
    if (Number.isInteger(destino)) seleccionarSala(destino);
  });

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

  // cl-timer (§7): cuando el cronómetro server-authoritative llega a 0, mostrar
  // el mismo mensaje/estado que usa el error "tiempo_agotado" que ya devuelve
  // el servidor (§4.1). Ya no hay modal que cerrar.
  onTiempoAgotado(() => {
    manejarErrorEstado('tiempo_agotado');
  });
}

// Alias exigido por el contrato §5 — verificarMaestro es verificarCodigoMaestro
export const verificarMaestro = verificarCodigoMaestro;

// Auto-init si el DOM ya está listo y estamos en juego.html
if (typeof document !== 'undefined') {
  const enJuego = $('nav-salas') || $('panel-estacion') || $('sin-equipo');
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
