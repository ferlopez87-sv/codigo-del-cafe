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
function _ordenUpdateAria(ol) {
  const items = [...ol.children];
  items.forEach((li, i) => {
    const up = li.querySelector('[data-dir="up"]');
    const down = li.querySelector('[data-dir="down"]');
    const isFirst = i === 0;
    const isLast = i === items.length - 1;
    if (up) {
      up.disabled = isFirst;
      up.setAttribute('aria-disabled', String(isFirst));
    }
    if (down) {
      down.disabled = isLast;
      down.setAttribute('aria-disabled', String(isLast));
    }
  });
}

// Public: render --------------------------------------------------------
export function renderInteraccion(contenedor, interaccion) {
  if (!contenedor) throw new Error('renderInteraccion: contenedor requerido');
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

  // Lista ordenable con botones ↑/↓
  const ol = _mk('ol');
  ol.setAttribute('role', 'list');
  ol.id = 'orden-lista';

  // Live region para anunciar movimientos (a11y §13, checklist 7.18)
  const live = _mk('div');
  live.id = 'orden-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  live.className = 'sr-only';
  // sr-only inline fallback si no existe clase
  live.style.position = 'absolute';
  live.style.width = '1px';
  live.style.height = '1px';
  live.style.overflow = 'hidden';
  live.style.clip = 'rect(0,0,0,0)';
  live.style.whiteSpace = 'nowrap';

  items.forEach((it) => {
    const li = _mk('li');
    li.setAttribute('role', 'listitem');
    li.dataset.id = _norm(it.id);

    const span = _mk('span');
    span.textContent = String(it.texto ?? '');
    span.id = 'orden-texto-' + _norm(it.id);

    const ctrl = _mk('div');
    ctrl.setAttribute('aria-hidden', 'false');

    const btnUp = _mk('button', { type: 'button', 'data-dir': 'up' }, '↑');
    btnUp.setAttribute('aria-label', `Mover ${String(it.texto ?? _norm(it.id))} hacia arriba`);
    btnUp.style.minWidth = '44px';
    btnUp.style.minHeight = '44px';

    const btnDown = _mk('button', { type: 'button', 'data-dir': 'down' }, '↓');
    btnDown.setAttribute('aria-label', `Mover ${String(it.texto ?? _norm(it.id))} hacia abajo`);
    btnDown.style.minWidth = '44px';
    btnDown.style.minHeight = '44px';

    function mover(dir) {
      const siblings = [...ol.children];
      const idx = siblings.indexOf(li);
      if (dir === 'up' && idx > 0) {
        ol.insertBefore(li, siblings[idx - 1]);
      } else if (dir === 'down' && idx < siblings.length - 1) {
        const next = siblings[idx + 1];
        // insertar después de next
        if (next.nextSibling) ol.insertBefore(li, next.nextSibling);
        else ol.appendChild(li);
      } else {
        return;
      }
      _ordenUpdateAria(ol);
      const newIdx = [...ol.children].indexOf(li) + 1;
      const total = ol.children.length;
      live.textContent = `${String(it.texto ?? _norm(it.id))} movido a posición ${newIdx} de ${total}`;
      // Foco permanece en el ítem movido (en el botón que se pulsó)
      // Mantener foco en el botón que originó el movimiento
      const target = dir === 'up' ? btnUp : btnDown;
      // Si el botón quedó disabled tras mover, mover foco al otro botón del mismo li
      if (target.disabled) {
        const alt = dir === 'up' ? btnDown : btnUp;
        alt.focus();
      } else {
        target.focus();
      }
    }

    btnUp.addEventListener('click', () => mover('up'));
    btnDown.addEventListener('click', () => mover('down'));

    ctrl.appendChild(btnUp);
    ctrl.appendChild(btnDown);
    li.appendChild(span);
    li.appendChild(ctrl);
    ol.appendChild(li);
  });

  _ordenUpdateAria(ol);
  contenedor.appendChild(ol);
  contenedor.appendChild(live);

  // Pregunta + select eslabón
  if (pregunta || opciones.length) {
    const field = _mk('div');
    const label = _mk('label');
    label.setAttribute('for', 'orden-eslabon');
    label.textContent = pregunta || '¿En qué eslabón se concentra el menor valor y mayor costo?';
    const sel = _mk('select');
    sel.id = 'orden-eslabon';
    // opción vacía placeholder
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

  _estado.refs.ordenLista = ol;
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

    const wrap = _mk('div');
    const label = _mk('label');
    const selId = 'campo-' + clave;
    label.setAttribute('for', selId);
    label.textContent = String(pregunta || 'Seleccioná una opción');

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
      const ol = _estado.refs.ordenLista;
      const sel = _estado.refs.eslabon;
      const orden = ol ? [...ol.querySelectorAll('li[data-id]')].map((li) => _norm(li.dataset.id)) : [];
      const eslabon = sel ? _norm(sel.value) : '';
      return { orden, eslabon };
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
