// _src/js/render.js — cl-render
// Dueño: cl-render. Contrato: CONTRACT.md §11 (tipos), §12 (forma respuesta), §13 (a11y), §14.4 (sanitizacion), §16.2 (dataviz).
// Vanilla JS module. Sin logica de verificacion, solo render + serializacion.
// Todo texto de usuario con textContent + createElement. Nunca usar HTML inyectado para datos.
import { crearGraficoE2, crearGraficoE3 } from './dataviz.js';

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

// Public: render --------------------------------------------------------
export function renderInteraccion(contenedor, interaccion) {
  // Nunca lanzar hacia la interfaz (mismo espíritu que §14.5 para api.js): un
  // contenedor ausente no debe romper la partida, solo no renderizar nada.
  if (!contenedor) {
    if (typeof console !== 'undefined') console.warn('renderInteraccion: contenedor requerido');
    return;
  }
  _estado.contenedor = contenedor;
  _estado.interaccion = interaccion || null;
  _estado.tipo = interaccion?.tipo || null;
  _estado.refs = {};
  _clear(contenedor);

  if (!interaccion || !interaccion.tipo) return;

  switch (interaccion.tipo) {
    case 'orden':
      _renderOrden(contenedor, interaccion);
      break;
    case 'numero':
      _renderNumero(contenedor, interaccion);
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
}

// E1 — orden ------------------------------------------------------------
function _renderOrden(contenedor, interaccion) {
  const items = Array.isArray(interaccion.items) ? interaccion.items : [];
  const pregunta = interaccion.pregunta || '';
  const opciones = Array.isArray(interaccion.opciones) ? interaccion.opciones : [];

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
  const barajados = _ordenBarajar(items);

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

  // Pregunta + select eslabón
  if (pregunta || opciones.length) {
    const field = _mk('div');
    field.className = 'orden-pregunta';
    const label = _mk('label');
    label.setAttribute('for', 'orden-eslabon');
    label.textContent = pregunta || '¿En qué eslabón se concentra el menor valor y mayor costo?';
    const sel = _mk('select');
    sel.id = 'orden-eslabon';
    const ph = _mk('option', { value: '' }, '-- Seleccioná --');
    ph.value = '';
    sel.appendChild(ph);
    opciones.forEach((op) => {
      const o = _mk('option');
      o.value = _norm(op.id);
      o.textContent = String(op.texto ?? '');
      sel.appendChild(o);
    });
    field.appendChild(label);
    field.appendChild(sel);
    contenedor.appendChild(field);
    _estado.refs.eslabon = sel;
  }

  _estado.refs.ordenCasillas = casillas;
  _estado.refs.ordenLista = rejilla;
  _estado.refs.ordenLive = live;
}

// E2/E3 — numero --------------------------------------------------------
function _renderNumero(contenedor, interaccion) {
  const campos = Array.isArray(interaccion.campos) ? interaccion.campos : [];
  const pregunta = interaccion.pregunta || '';
  const opciones = Array.isArray(interaccion.opciones) ? interaccion.opciones : [];

  // Campos numéricos: aquellos con min/max/paso definidos o id porcentaje
  campos.forEach((c) => {
    const hasNumeric = c.min !== undefined || c.max !== undefined || c.paso !== undefined || c.id === 'porcentaje';
    // Si el campo es enganosa sin min/max es en realidad el select, no un input number
    if (!hasNumeric) return;
    const wrap = _mk('div');
    const label = _mk('label');
    const inputId = 'campo-' + _norm(c.id);
    label.setAttribute('for', inputId);
    label.textContent = String(c.etiqueta ?? c.id);

    const input = _mk('input');
    input.type = 'number';
    input.id = inputId;
    input.setAttribute('inputmode', 'decimal');
    if (c.min !== undefined) input.min = String(c.min);
    if (c.max !== undefined) input.max = String(c.max);
    if (c.paso !== undefined) input.step = String(c.paso);
    // aria
    input.setAttribute('aria-describedby', inputId + '-ayuda');
    // ayuda con rango
    const ayuda = _mk('span');
    ayuda.id = inputId + '-ayuda';
    ayuda.style.fontSize = '0.85em';
    if (c.sufijo) {
      const suf = _mk('span');
      suf.setAttribute('aria-hidden', 'true');
      suf.textContent = String(c.sufijo);
      suf.style.marginLeft = '4px';
      wrap.appendChild(label);
      const row = _mk('div');
      row.appendChild(input);
      row.appendChild(suf);
      wrap.appendChild(row);
    } else {
      wrap.appendChild(label);
      wrap.appendChild(input);
    }
    if (!wrap.contains(ayuda) && c.sufijo) {
      // no ayuda extra si no hay
    }
    // Descripción de rango para AT
    if (c.min !== undefined || c.max !== undefined) {
      const desc = _mk('span');
      desc.id = inputId + '-ayuda';
      desc.textContent = `Rango ${c.min ?? '—'} a ${c.max ?? '—'}`;
      desc.style.display = 'none';
      // usar aria-label como respaldo
      input.setAttribute('aria-label', `${String(c.etiqueta ?? c.id)}, de ${c.min ?? '—'} a ${c.max ?? '—'}`);
      wrap.appendChild(desc);
    }
    contenedor.appendChild(wrap);
    // guardar ref por id normalizado
    _estado.refs[_norm(c.id)] = input;
    // alias porcentaje
    if (_norm(c.id) === 'porcentaje') _estado.refs.porcentaje = input;
  });

  // Select para pregunta/opciones (enganosa / inconsistencia)
  if (opciones.length) {
    // Determinar clave: siCampos contiene enganosa -> enganosa, si contiene inconsistencia -> inconsistencia
    // si no, inferir por opciones: si/no -> enganosa, a/b/c -> inconsistencia
    let clave = null;
    const campoIds = campos.map((c) => _norm(c.id));
    if (campoIds.includes('enganosa')) clave = 'enganosa';
    else if (campoIds.includes('inconsistencia')) clave = 'inconsistencia';
    else {
      const optIds = opciones.map((o) => _norm(o.id));
      if (optIds.includes('si') || optIds.includes('no')) clave = 'enganosa';
      else if (optIds.includes('a') || optIds.includes('b') || optIds.includes('c')) clave = 'inconsistencia';
      else clave = 'opcion';
    }

    const preguntaTexto = String(pregunta || 'Seleccioná una opción');
    // 2026-08-28, reportado por Fernando en Sala del Dinero: un <select>
    // nativo no hace wrap del texto de sus <option> — con frases completas
    // (no "sí"/"no" cortos) el popup queda tan angosto como la caja cerrada
    // y el texto no se alcanza a leer, sin importar cuánto se ensanche el
    // <select> mismo. Con opciones largas se arma un grupo de radios en su
    // lugar: cada opción es su propio bloque, que sí puede partirse en
    // varias líneas — mismo patrón que el picker de equipo (js/auth.js).
    const opcionesLargas = opciones.some((op) => String(op.texto ?? '').length > 60);

    if (opcionesLargas) {
      const fs = _mk('fieldset');
      const legend = _mk('legend');
      legend.textContent = preguntaTexto;
      fs.appendChild(legend);
      const nombreGrupo = 'grupo-' + clave;
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
        const texto = _mk('span', null, String(op.texto ?? ''));
        fila.appendChild(radio);
        fila.appendChild(texto);
        fs.appendChild(fila);
        radios.push(radio);
      });
      contenedor.appendChild(fs);
      // .value delega al radio marcado — serializarRespuesta() más abajo lee
      // sel.value sin saber si es un <select> o este objeto; no hace falta
      // tocar esa lógica.
      const refValor = { get value() {
        const marcado = radios.find((r) => r.checked);
        return marcado ? marcado.value : '';
      } };
      _estado.refs[clave] = refValor;
      _estado.refs.juicio = refValor;
      _estado.refs._numeroClave = clave;
    } else {
      const wrap = _mk('div');
      const label = _mk('label');
      const selId = 'campo-' + clave;
      label.setAttribute('for', selId);
      label.textContent = preguntaTexto;

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
      _estado.refs[clave] = sel;
      _estado.refs.juicio = sel;
      _estado.refs._numeroClave = clave;
    }
  }

  // ── Dataviz §16.2 — SVG inline accesible (inyectado al inicio del contenedor)
  // E2: 87% verde /13% resto con rango 85-90 · E3: US$4.00 apilada 0.175 ínfimo
  try {
    // Inferir estación: enganosa → E2, inconsistencia → E3; fallback por clave
    const clave = _estado.refs._numeroClave;
    let viz = null;
    if (clave === 'enganosa') viz = crearGraficoE2();
    else if (clave === 'inconsistencia') viz = crearGraficoE3();
    else {
      const optIds = opciones.map((o) => _norm(o.id));
      if (optIds.includes('si') || optIds.includes('no')) viz = crearGraficoE2();
      else if (optIds.includes('a') || optIds.includes('b') || optIds.includes('c')) viz = crearGraficoE3();
    }
    if (viz) contenedor.prepend(viz);
  } catch (_e) {
    // nunca romper render por dataviz
  }
}

// E4 — checklist --------------------------------------------------------
function _renderChecklist(contenedor, interaccion) {
  const items = Array.isArray(interaccion.items) ? interaccion.items : [];
  const fs = _mk('fieldset');
  const legend = _mk('legend');
  legend.textContent = 'Seleccioná los actores en riesgo directo según el expediente';
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

// E5 — clasificacion ----------------------------------------------------
function _renderClasificacion(contenedor, interaccion) {
  const items = Array.isArray(interaccion.items) ? interaccion.items : [];
  const categorias = Array.isArray(interaccion.categorias) ? interaccion.categorias : [];

  const fs = _mk('fieldset');
  const legend = _mk('legend');
  legend.textContent = 'Clasificá cada frase del borrador de CGC';
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
export function serializarRespuesta() {
  const t = _estado.tipo;
  const inter = _estado.interaccion;
  if (!t) return {};

  switch (t) {
    case 'orden': {
      // Las casillas son la fuente de verdad del orden: se leen por indice.
      // Antes esto buscaba li[data-id], que era la forma de la lista con
      // botones arriba/abajo. En el tablero de casillas el data-id vive en la
      // tarjeta anidada, no en el <li>, asi que devolvia [] siempre y la
      // estacion quedaba imposible de resolver por mas bien colocada que
      // estuviera. Se encontro probando en navegador, no leyendo el codigo.
      const casillas = _estado.refs.ordenCasillas || [];
      const sel = _estado.refs.eslabon;
      const orden = casillas
        .map((c) => _ordenTarjetaEnCasilla(c))
        .filter(Boolean)
        .map((t) => _norm(t.dataset.id));
      const eslabon = sel ? _norm(sel.value) : '';
      // Sin ninguna tarjeta colocada se omite la clave para que el servidor
      // responda detalle 'vacio' (§12). Enviar [] lo haria comparar el arreglo
      // y contestar 'orden-mal', que no es lo que pasa: no hay respuesta aun.
      return orden.length ? { orden, eslabon } : { eslabon };
    }
    case 'numero': {
      const out = {};
      // porcentaje numérico: enviar como número si hay valor, si no string vacío para que servidor detecte vacio
      const inp = _estado.refs.porcentaje || _estado.refs['porcentaje'] || null;
      if (inp) {
        const raw = String(inp.value ?? '').trim();
        if (raw === '') {
          // dejar clave ausente o vacía no importa; usamos null para que _cc_num -> null
          // pero enviamos "" para ser explícito con vacio
          out.porcentaje = '';
        } else {
          const n = _parseNumero(raw);
          out.porcentaje = n !== null ? n : _norm(raw);
        }
      }
      // juicio: enganosa o inconsistencia
      const clave = _estado.refs._numeroClave || null;
      const sel = clave ? _estado.refs[clave] : _estado.refs.juicio;
      if (sel) {
        const v = _norm(sel.value);
        if (clave === 'enganosa' || (!clave && (v === 'si' || v === 'no' || v === ''))) {
          out.enganosa = v;
          // si el contrato espera inconsistencia pero el usuario está en E2, no enviar inconsistencia
          // Si clave era enganosa, no enviar inconsistencia
        } else if (clave === 'inconsistencia' || (!clave && (v === 'a' || v === 'b' || v === 'c' || v === ''))) {
          out.inconsistencia = v;
        } else if (clave) {
          out[clave] = v;
        } else {
          // fallback genérico: si no sabemos clave, inferir
          if (inter && Array.isArray(inter.opciones)) {
            const ids = inter.opciones.map((o) => _norm(o.id));
            if (ids.includes('si')) out.enganosa = v;
            else if (ids.includes('a')) out.inconsistencia = v;
            else out.opcion = v;
          } else {
            out.valor = v;
          }
        }
      } else {
        // No hay clave inferida: revisar ambas refs por si existen
        if (_estado.refs.enganosa) out.enganosa = _norm(_estado.refs.enganosa.value);
        if (_estado.refs.inconsistencia) out.inconsistencia = _norm(_estado.refs.inconsistencia.value);
      }
      return out;
    }
    case 'checklist': {
      const cbs = _estado.refs.checklist || [];
      const actores = cbs.filter((cb) => cb.checked).map((cb) => _norm(cb.value));
      return { actores };
    }
    case 'clasificacion': {
      const sels = _estado.refs.clasificacion || [];
      const frases = sels.map((s) => _norm(s.value));
      return { frases };
    }
    default:
      return {};
  }
}

// Helpers de test / reset (no afectan contrato) ------------------------
export function _getEstado() {
  return _estado;
}
