// _src/js/render.js — cl-render
// Dueño: cl-render. Contrato: CONTRACT.md §11 (tipos), §12 (forma respuesta), §13 (a11y), §14.4 (sanitizacion).
// Vanilla JS module. Sin logica de verificacion, solo render + serializacion.
// Todo texto de usuario con textContent + createElement. Nunca usar HTML inyectado para datos.
// El gráfico (estacion.visual) ya no se inyecta desde acá — lo llama el orquestador
// (js/juego.js) explícitamente con js/dataviz.js#crearGrafico(visual). Ver
// plan-motor-misiones.md §1, paquete P2.

// _estado apunta siempre al último renderInteraccion(), para no romper a
// quien llama serializarRespuesta() sin argumento (js/juego.js: un solo
// widget vivo a la vez, sin ambigüedad posible). _porContenedor guarda el
// mismo objeto de estado por contenedor — permite leer un widget específico
// aunque otro se haya renderizado después en otra parte de la página.
//
// Se agregó 2026-09-23: el editor del docente (P5) renderiza DOS widgets
// vivos a la vez —"marcar respuesta" y "probar sala"— y cualquier tecleo en
// el resto del formulario re-renderiza el primero. Con un solo estado
// global, "último renderizado" y "el que quiero leer" dejan de ser lo
// mismo: ya produjo el mismo bug tres veces (guardarReto, un caso
// documentado por opencode, y "Probar sala" que siempre leía vacío porque
// se re-renderizaba a sí mismo justo antes de serializar). La causa era
// estructural, no un caso más para parchear.
const _porContenedor = new WeakMap();
let _estado = {
  tipo: null,
  interaccion: null,
  contenedor: null,
  refs: {},
};

// Helpers ---------------------------------------------------------------
function _norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

function _parseNumero(raw) {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function _clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function _mk(tag, attrs, text) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k.startsWith('aria-') || k === 'role' || k === 'for' || k === 'id') {
        el.setAttribute(k, String(v));
      } else {
        el.setAttribute(k, String(v));
      }
      // For properties that need direct assignment (value, type, etc.)
      if (k === 'value' || k === 'type' || k === 'htmlFor') {
        // keep attribute already, also set property where applicable
        if (k === 'value') el.value = String(v);
        if (k === 'type') el.type = String(v);
      }
    }
  }
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

// Orden helpers ---------------------------------------------------------
// El mecanismo son tarjetas que se colocan sobre casillas numeradas: la
// posición 6 es una casilla real, no "el último de una lista". Antes era una
// lista con botones ↑/↓, donde la posición era implícita.
//
// Se sostienen dos caminos equivalentes sobre el mismo estado del DOM:
//   · puntero — arrastrar y soltar (HTML5 drag & drop)
//   · teclado — Enter/Espacio levanta la tarjeta, Enter/Espacio sobre una
//     casilla la coloca; Escape cancela. Sin esto, quien no pueda arrastrar
//     se queda sin poder resolver la estación.
// _leerRespuesta lee las casillas por orden de índice, así que ninguno de los
// dos caminos necesita mantener una estructura aparte.

// Barajado estable por contenido. La version anterior era (i*7+3)%n, que para
// n=6 es una rotacion ciclica: dejaba los seis eslabones en su orden relativo
// correcto, solo empezando por otro. Es decir, la secuencia entera se leia de
// corrido en la bandeja — justo lo que el barajado debia evitar.
function _ordenHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function _ordenBarajar(items) {
  return items
    .map((it, i) => ({ it, k: _ordenHash(_norm(it.id) + '#' + i) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);
}

function _ordenTarjetaEnCasilla(casilla) {
  return casilla.querySelector('.orden-tarjeta');
}

// Deja la tarjeta en la casilla. Si la casilla ya tenía una, la desplazada va
// a donde estaba la que entra (intercambio) o vuelve a la bandeja.
function _ordenColocar(tarjeta, destino, bandeja) {
  if (!tarjeta || !destino) return;
  const origen = tarjeta.parentElement;
  if (origen === destino) return;
  const ocupante = destino.classList.contains('orden-casilla') ? _ordenTarjetaEnCasilla(destino) : null;
  destino.appendChild(tarjeta);
  if (ocupante) {
    if (origen && origen.classList.contains('orden-casilla')) origen.appendChild(ocupante);
    else bandeja.appendChild(ocupante);
  }
}

function _ordenSincronizar(casillas, bandeja, live) {
  casillas.forEach((c, i) => {
    const t = _ordenTarjetaEnCasilla(c);
    c.dataset.ocupada = t ? 'true' : 'false';
    c.setAttribute('aria-label', t
      ? `Casilla ${i + 1}: ${t.dataset.texto}. Activá para reemplazar.`
      : `Casilla ${i + 1}, vacía.`);
  });
  const faltan = casillas.filter((c) => !_ordenTarjetaEnCasilla(c)).length;
  if (live) {
    live.textContent = faltan === 0
      ? 'Las seis casillas están completas.'
      : `Faltan ${faltan} casilla${faltan === 1 ? '' : 's'} por completar.`;
  }
  if (bandeja) bandeja.dataset.vacia = bandeja.querySelector('.orden-tarjeta') ? 'false' : 'true';
}

// Selección única (opcion_unica y cierre) --------------------------------
// 2026-08-28, reportado por Fernando en Sala del Dinero: un <select> nativo
// no hace wrap del texto de sus <option> — con frases completas (no "sí"/
// "no" cortos) el popup queda tan angosto como la caja cerrada y el texto no
// se alcanza a leer, sin importar cuánto se ensanche el <select> mismo. Con
// opciones largas se arma un grupo de radios en su lugar: cada opción es su
// propio bloque, que sí puede partirse en varias líneas — mismo patrón que
// el picker de equipo (js/auth.js). Válido tanto para opcion_unica como para
// el bloque de cierre opcional de cualquier tipo.
function _renderSeleccionUnica(contenedor, enunciado, opciones, idPrefix) {
  const texto = String(enunciado || '');
  const opcionesLargas = opciones.some((op) => String(op.texto ?? '').length > 60);

  if (opcionesLargas) {
    const fs = _mk('fieldset');
    const legend = _mk('legend', null, texto);
    fs.appendChild(legend);
    const nombreGrupo = idPrefix + '-grupo';
    const radios = [];
    opciones.forEach((op) => {
      const fila = _mk('label', { class: 'flex items-start gap-3 p-3 mb-2 border border-audit-border rounded cursor-pointer hover:border-primary' });
      const radio = _mk('input');
      radio.type = 'radio';
      radio.name = nombreGrupo;
      radio.value = _norm(op.id);
      radio.style.minWidth = '20px';
      radio.style.minHeight = '20px';
      radio.style.marginTop = '2px';
      radio.style.flexShrink = '0';
      const spanTexto = _mk('span', null, String(op.texto ?? ''));
      fila.appendChild(radio);
      fila.appendChild(spanTexto);
      fs.appendChild(fila);
      radios.push(radio);
    });
    contenedor.appendChild(fs);
    // .value delega al radio marcado — serializarRespuesta() lee ref.value
    // sin saber si es un <select> o este objeto.
    return { get value() {
      const marcado = radios.find((r) => r.checked);
      return marcado ? marcado.value : '';
    } };
  }

  const wrap = _mk('div');
  const label = _mk('label');
  const selId = idPrefix + '-select';
  label.setAttribute('for', selId);
  label.textContent = texto;
  const sel = _mk('select');
  sel.id = selId;
  const ph = _mk('option', { value: '' }, '-- Seleccioná --');
  sel.appendChild(ph);
  opciones.forEach((op) => {
    const o = _mk('option');
    o.value = _norm(op.id);
    o.textContent = String(op.texto ?? '');
    sel.appendChild(o);
  });
  wrap.appendChild(label);
  wrap.appendChild(sel);
  contenedor.appendChild(wrap);
  return sel;
}

// Public: render --------------------------------------------------------
export function renderInteraccion(contenedor, interaccion) {
  // Nunca lanzar hacia la interfaz (mismo espíritu que §14.5 para api.js): un
  // contenedor ausente no debe romper la partida, solo no renderizar nada.
  if (!contenedor) {
    if (typeof console !== 'undefined') console.warn('renderInteraccion: contenedor requerido');
    return;
  }
  // Nuevo objeto de estado por cada render — nunca se reutiliza el anterior,
  // así el de un contenedor viejo no se pisa si alguien todavía lo tiene
  // guardado (no debería, pero WeakMap + objeto nuevo lo hace imposible por
  // construcción en vez de por disciplina).
  const estado = { contenedor, interaccion: interaccion || null, tipo: interaccion?.tipo || null, refs: {} };
  _porContenedor.set(contenedor, estado);
  _estado = estado; // último renderizado global — ver comentario arriba
  _clear(contenedor);

  if (!interaccion || !interaccion.tipo) return;

  switch (interaccion.tipo) {
    case 'opcion_unica':
      _renderOpcionUnica(contenedor, interaccion);
      break;
    case 'respuesta_corta':
      _renderRespuestaCorta(contenedor, interaccion);
      break;
    case 'orden':
      _renderOrden(contenedor, interaccion);
      break;
    case 'checklist':
      _renderChecklist(contenedor, interaccion);
      break;
    case 'clasificacion':
      _renderClasificacion(contenedor, interaccion);
      break;
    default:
      // tipo desconocido: no renderiza, serializar devolverá {}
      break;
  }

  // Cierre — opcional, válido en cualquier tipo (contrato §1.1).
  if (interaccion.cierre) _renderCierre(contenedor, interaccion.cierre);
}

// opcion_unica ------------------------------------------------------------
function _renderOpcionUnica(contenedor, interaccion) {
  const opciones = Array.isArray(interaccion.opciones) ? interaccion.opciones : [];
  const ref = _renderSeleccionUnica(contenedor, interaccion.enunciado, opciones, 'opcion-unica');
  _estado.refs.opcionUnica = ref;
}

// respuesta_corta -----------------------------------------------------------
function _renderRespuestaCorta(contenedor, interaccion) {
  const modoNumero = interaccion.modo === 'numero';
  const wrap = _mk('div');
  const label = _mk('label');
  const inputId = 'respuesta-corta-input';
  label.setAttribute('for', inputId);
  label.textContent = String(interaccion.enunciado || '');

  const input = _mk('input');
  input.id = inputId;
  input.type = modoNumero ? 'number' : 'text';
  if (modoNumero) {
    input.setAttribute('inputmode', 'decimal');
    if (interaccion.min !== undefined) input.min = String(interaccion.min);
    if (interaccion.max !== undefined) input.max = String(interaccion.max);
    if (interaccion.paso !== undefined) input.step = String(interaccion.paso);
  }
  if (interaccion.placeholder) input.setAttribute('placeholder', String(interaccion.placeholder));

  wrap.appendChild(label);
  if (interaccion.sufijo) {
    const suf = _mk('span', { 'aria-hidden': 'true' }, String(interaccion.sufijo));
    suf.style.marginLeft = '4px';
    const row = _mk('div');
    row.appendChild(input);
    row.appendChild(suf);
    wrap.appendChild(row);
  } else {
    wrap.appendChild(input);
  }

  // Descripción de rango para lectores de pantalla (modo numero).
  if (modoNumero && (interaccion.min !== undefined || interaccion.max !== undefined)) {
    const descId = inputId + '-ayuda';
    input.setAttribute('aria-describedby', descId);
    input.setAttribute('aria-label', `${String(interaccion.enunciado || '')}, de ${interaccion.min ?? '—'} a ${interaccion.max ?? '—'}`);
    const desc = _mk('span', null, `Rango ${interaccion.min ?? '—'} a ${interaccion.max ?? '—'}`);
    desc.id = descId;
    desc.style.display = 'none';
    wrap.appendChild(desc);
  }

  contenedor.appendChild(wrap);
  _estado.refs.respuestaCorta = input;
}

// Cierre opcional ---------------------------------------------------------
function _renderCierre(contenedor, cierre) {
  const opciones = Array.isArray(cierre.opciones) ? cierre.opciones : [];
  const zona = _mk('div');
  zona.className = 'cierre-zona';
  contenedor.appendChild(zona);
  const ref = _renderSeleccionUnica(zona, cierre.enunciado, opciones, 'cierre');
  _estado.refs.cierre = ref;
}

// orden -------------------------------------------------------------------
function _renderOrden(contenedor, interaccion) {
  const items = Array.isArray(interaccion.items) ? interaccion.items : [];

  const zona = _mk('div');
  zona.className = 'orden-zona';

  const ayuda = _mk('p');
  ayuda.className = 'orden-ayuda';
  ayuda.id = 'orden-ayuda';
  ayuda.textContent = 'Arrastrá cada tarjeta a su casilla. Con teclado: Enter o Espacio para levantar una tarjeta, y Enter o Espacio sobre la casilla donde va. Escape cancela.';
  zona.appendChild(ayuda);

  const live = _mk('div');
  live.id = 'orden-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  live.className = 'sr-only';
  live.style.position = 'absolute';
  live.style.width = '1px';
  live.style.height = '1px';
  live.style.overflow = 'hidden';
  live.style.clip = 'rect(0,0,0,0)';
  live.style.whiteSpace = 'nowrap';

  // Tarjeta "levantada" por teclado. null = ninguna.
  let levantada = null;

  const casillas = [];
  const rejilla = _mk('ol');
  rejilla.className = 'orden-casillas';
  rejilla.id = 'orden-lista';
  rejilla.setAttribute('role', 'list');

  function anunciar(txt) { live.textContent = txt; }

  function soltarLevantada() {
    if (!levantada) return;
    levantada.classList.remove('is-levantada');
    levantada.setAttribute('aria-grabbed', 'false');
    levantada = null;
    zona.classList.remove('orden-zona--colocando');
  }

  function levantar(tarjeta) {
    if (levantada === tarjeta) { soltarLevantada(); anunciar('Tarjeta soltada.'); return; }
    soltarLevantada();
    levantada = tarjeta;
    tarjeta.classList.add('is-levantada');
    tarjeta.setAttribute('aria-grabbed', 'true');
    zona.classList.add('orden-zona--colocando');
    anunciar(`${tarjeta.dataset.texto} levantada. Elegí una casilla.`);
  }

  function colocarEn(destino) {
    if (!levantada) return;
    const texto = levantada.dataset.texto;
    const t = levantada;
    soltarLevantada();
    _ordenColocar(t, destino, bandeja);
    _ordenSincronizar(casillas, bandeja, live);
    const idx = casillas.indexOf(destino);
    anunciar(idx >= 0 ? `${texto} colocada en la casilla ${idx + 1}.` : `${texto} devuelta a la bandeja.`);
    t.focus();
  }

  function prepararDestino(el) {
    el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.classList.add('is-sobre'); });
    el.addEventListener('dragleave', () => el.classList.remove('is-sobre'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('is-sobre');
      const id = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
      const tarjeta = id ? zona.querySelector(`.orden-tarjeta[data-id="${CSS.escape(id)}"]`) : null;
      if (!tarjeta) return;
      _ordenColocar(tarjeta, el, bandeja);
      _ordenSincronizar(casillas, bandeja, live);
      const idx = casillas.indexOf(el);
      anunciar(idx >= 0 ? `${tarjeta.dataset.texto} colocada en la casilla ${idx + 1}.` : `${tarjeta.dataset.texto} devuelta a la bandeja.`);
    });
    el.addEventListener('click', () => { if (levantada) colocarEn(el); });
    el.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && levantada) { ev.preventDefault(); colocarEn(el); }
    });
  }

  items.forEach((_, i) => {
    const li = _mk('li');
    li.className = 'orden-casilla';
    li.dataset.pos = String(i + 1);
    li.tabIndex = 0;
    li.setAttribute('role', 'listitem');
    li.setAttribute('aria-describedby', 'orden-ayuda');
    const num = _mk('span', { 'aria-hidden': 'true' }, String(i + 1));
    num.className = 'orden-casilla__num';
    li.appendChild(num);
    prepararDestino(li);
    casillas.push(li);
    rejilla.appendChild(li);
  });

  const bandeja = _mk('div');
  bandeja.className = 'orden-bandeja';
  bandeja.id = 'orden-bandeja';
  bandeja.setAttribute('aria-label', 'Tarjetas sin colocar');
  prepararDestino(bandeja);

  // Orden de aparición barajado respecto del de la respuesta: si las tarjetas
  // salen ya ordenadas, la estación se resuelve sin leer la evidencia.
  // Barajado determinista a propósito (hash del id, nunca Math.random): todos
  // los equipos ven el mismo tablero, así la dificultad es la misma para todos
  // y el docente puede reproducir lo que ve un equipo que pide ayuda.
  // `barajar` sale del dato editable (interaccion.barajar) — antes se decidía
  // por número de sala, ver plan-motor-misiones.md §1.
  const barajados = interaccion.barajar ? _ordenBarajar(items) : items;

  barajados.forEach((it) => {
    const t = _mk('div');
    t.className = 'orden-tarjeta';
    t.dataset.id = _norm(it.id);
    t.dataset.texto = String(it.texto ?? '');
    t.textContent = String(it.texto ?? '');
    t.draggable = true;
    t.tabIndex = 0;
    t.setAttribute('role', 'button');
    t.setAttribute('aria-grabbed', 'false');
    t.setAttribute('aria-describedby', 'orden-ayuda');
    t.addEventListener('dragstart', (ev) => {
      if (ev.dataTransfer) { ev.dataTransfer.setData('text/plain', t.dataset.id); ev.dataTransfer.effectAllowed = 'move'; }
      t.classList.add('is-arrastrando');
    });
    t.addEventListener('dragend', () => t.classList.remove('is-arrastrando'));
    // stopPropagation en los dos caminos: la tarjeta vive DENTRO de una casilla
    // (o de la bandeja), y ese contenedor tambien escucha click/keydown para
    // recibir la tarjeta levantada. Sin cortar la propagacion, levantar burbujea
    // al contenedor que la contiene, que la "coloca" donde ya estaba y la suelta
    // en el acto: no se podia levantar ninguna tarjeta, ni con raton ni con
    // teclado. El bug solo aparece en un navegador real, con eventos de verdad.
    t.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Si hay otra levantada, este click la coloca aca (intercambio); si no,
      // levanta esta.
      if (levantada && levantada !== t) { colocarEn(t.parentElement); return; }
      levantar(t);
    });
    t.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        if (levantada && levantada !== t) { colocarEn(t.parentElement); return; }
        levantar(t);
      } else if (ev.key === 'Escape' && levantada) {
        ev.preventDefault();
        ev.stopPropagation();
        soltarLevantada();
        anunciar('Cancelado.');
      }
    });
    bandeja.appendChild(t);
  });

  zona.appendChild(rejilla);
  zona.appendChild(bandeja);
  zona.appendChild(live);
  contenedor.appendChild(zona);
  _ordenSincronizar(casillas, bandeja, live);

  _estado.refs.ordenCasillas = casillas;
  _estado.refs.ordenLista = rejilla;
  _estado.refs.ordenLive = live;
}

// checklist -----------------------------------------------------------------
function _renderChecklist(contenedor, interaccion) {
  const items = Array.isArray(interaccion.items) ? interaccion.items : [];
  const fs = _mk('fieldset');
  const legend = _mk('legend', null, interaccion.enunciado || 'Seleccioná las opciones correspondientes');
  fs.appendChild(legend);

  const refs = [];
  items.forEach((it) => {
    const id = 'check-' + _norm(it.id);
    const wrap = _mk('div');
    const cb = _mk('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.value = _norm(it.id);
    // tamaño táctil mínimo
    cb.style.minWidth = '20px';
    cb.style.minHeight = '20px';

    const label = _mk('label');
    label.setAttribute('for', id);
    label.textContent = String(it.texto ?? '');
    // label táctil 44px via padding (CSS hace el resto, pero asegurar cursor)
    label.style.minHeight = '44px';
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';

    wrap.appendChild(cb);
    wrap.appendChild(label);
    fs.appendChild(wrap);
    refs.push(cb);
  });

  contenedor.appendChild(fs);
  _estado.refs.checklist = refs;
  _estado.refs.fieldset = fs;
}

// clasificacion ---------------------------------------------------------------
function _renderClasificacion(contenedor, interaccion) {
  const items = Array.isArray(interaccion.items) ? interaccion.items : [];
  const categorias = Array.isArray(interaccion.categorias) ? interaccion.categorias : [];

  const fs = _mk('fieldset');
  const legend = _mk('legend', null, interaccion.enunciado || 'Clasificá cada elemento');
  fs.appendChild(legend);

  const refs = [];
  items.forEach((it) => {
    const row = _mk('div');
    row.style.marginBottom = '8px';

    const label = _mk('label');
    const selId = 'frase-' + _norm(it.id);
    label.setAttribute('for', selId);
    label.textContent = String(it.texto ?? '');

    const sel = _mk('select');
    sel.id = selId;
    sel.dataset.frase = _norm(it.id);

    const ph = _mk('option', { value: '' }, '-- Seleccioná --');
    sel.appendChild(ph);
    categorias.forEach((cat) => {
      const o = _mk('option');
      o.value = _norm(cat.id);
      o.textContent = String(cat.texto ?? '');
      sel.appendChild(o);
    });

    row.appendChild(label);
    row.appendChild(sel);
    fs.appendChild(row);
    refs.push(sel);
  });

  contenedor.appendChild(fs);
  _estado.refs.clasificacion = refs;
  _estado.refs.categorias = categorias;
}

// Serialización ---------------------------------------------------------
// Forma canónica {valor, cierre?} — contrato §1.2/§1.3. Clave ausente si no
// hay respuesta aun, nunca un valor vacío/[] — así el servidor responde
// 'vacio' y no compara contra una respuesta a medio dar.
// `contenedor` es opcional: sin él, lee el último renderInteraccion() global
// (lo que ya usaba js/juego.js, donde solo hay un widget vivo a la vez, sin
// ambigüedad). Con un contenedor, lee el estado de ESE widget puntual, sin
// importar qué se haya renderizado después en cualquier otra parte de la
// página — es lo que necesita el editor del docente, que puede tener dos
// widgets vivos a la vez ("marcar respuesta" y "probar sala").
export function serializarRespuesta(contenedor) {
  const estado = contenedor ? (_porContenedor.get(contenedor) || { tipo: null, interaccion: null, refs: {} }) : _estado;
  const t = estado.tipo;
  const inter = estado.interaccion;
  const out = {};

  if (t) {
    switch (t) {
      case 'opcion_unica': {
        const ref = estado.refs.opcionUnica;
        const v = ref ? _norm(ref.value) : '';
        if (v) out.valor = v;
        break;
      }
      case 'respuesta_corta': {
        const input = estado.refs.respuestaCorta;
        const raw = input ? String(input.value ?? '').trim() : '';
        if (raw !== '') {
          if (inter && inter.modo === 'numero') {
            const n = _parseNumero(raw);
            if (n !== null) out.valor = n;
          } else {
            out.valor = _norm(raw);
          }
        }
        break;
      }
      case 'orden': {
        // Las casillas son la fuente de verdad del orden: se leen por indice.
        const casillas = estado.refs.ordenCasillas || [];
        const orden = casillas
          .map((c) => _ordenTarjetaEnCasilla(c))
          .filter(Boolean)
          .map((t) => _norm(t.dataset.id));
        if (orden.length) out.valor = orden;
        break;
      }
      case 'checklist': {
        const cbs = estado.refs.checklist || [];
        const marcados = cbs.filter((cb) => cb.checked).map((cb) => _norm(cb.value));
        if (marcados.length) out.valor = marcados;
        break;
      }
      case 'clasificacion': {
        const sels = estado.refs.clasificacion || [];
        const mapa = {};
        let algo = false;
        sels.forEach((s) => {
          const v = _norm(s.value);
          if (v) { mapa[s.dataset.frase] = v; algo = true; }
        });
        if (algo) out.valor = mapa;
        break;
      }
      default:
        break;
    }
  }

  const cierreRef = estado.refs.cierre;
  if (cierreRef) {
    const v = _norm(cierreRef.value);
    if (v) out.cierre = v;
  }

  return out;
}

// Helpers de test / reset (no afectan contrato) ------------------------
export function _getEstado() {
  return _estado;
}
