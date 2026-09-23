// _src/js/dataviz.js — dataviz (motor de gráficos genérico)
// Dueño: Frontend Escape Room — P2. Vanilla ES module, SVG inline sin librerías.
// CONTRACT §16.2 / plan-motor-misiones.md §1.6: dibuja desde estaciones.visual
// (dato editable), nunca desde constantes cableadas por sala o por id.
// Solo usa textContent/createElement/createElementNS — nunca innerHTML con
// datos dinámicos (§14.4).
//
// Dos lecciones del proyecto que este renderer conserva (CLAUDE.md, 2026-08-28):
//  1. Para porciones angostas o de bisectriz lateral (~90°/270°), línea líder
//     externa por defecto, no etiqueta adentro. Una porción "grande" por
//     ángulo puede no tener espacio horizontal si su bisectriz apunta al
//     costado — el ancho disponible depende de la orientación, no solo de
//     la amplitud. Verificar con recorte 2× del SVG y getBBox() contra el
//     viewBox, no con un vistazo al screenshot.
//  2. Todo elemento que el JS agrega al DOM necesita su CSS explícito en el
//     <style> inline de la página. styles.css (74 KB) está muerto.

const NS = 'http://www.w3.org/2000/svg';
let _contadorGrafico = 0;

function _svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function _mk(tag, text) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = String(text);
  return el;
}

function _polar(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function _sectorPath(cx, cy, r, startAngle, endAngle) {
  const s = _polar(cx, cy, r, startAngle);
  const e = _polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`;
}

// Solo el arco (sin ir al centro) — para el corchete de rango aceptado.
function _arcPath(cx, cy, r, startAngle, endAngle) {
  const s = _polar(cx, cy, r, startAngle);
  const e = _polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

// Paleta categórica fija, pensada para el fondo oscuro del expediente
// (#0f1410). El color se asigna por índice de serie, no por contenido: el
// contrato §1.6 no trae un campo de color, así que no hay forma de
// reproducir un cableado semántico por sala sin volver a un preset — eso es
// justo lo que este paquete retira.
const PALETTE = ['#34c266', '#d99a2b', '#5b9bd9', '#c2607a', '#8a6fd1', '#d9a441', '#4fb8c4', '#c9a86a'];

function _colorSerie(i) {
  return PALETTE[i % PALETTE.length];
}

function _textoContraste(hex) {
  const c = String(hex).replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#0f1410' : '#ede9e3';
}

function _formatoValor(valor, unidad) {
  const n = Number(valor) || 0;
  if (unidad === '%') return `${Number(n.toFixed(2))}%`;
  if (unidad) {
    // 3 decimales (hay valores de sub-centavo, ej. 0.175) y se recorta el
    // último si es 0, para no mostrar "0.400" cuando "0.40" alcanza. Usar
    // toFixed(2) de entrada perdía precisión real: (0.175).toFixed(2) da
    // "0.17" por representación binaria de punto flotante.
    let s = n.toFixed(3);
    if (s.endsWith('0')) s = s.slice(0, -1);
    return `${unidad}${s}`;
  }
  return String(n);
}

function _anchoEstimado(texto, tamPx) {
  return String(texto ?? '').length * tamPx * 0.62;
}

// Envuelve texto libre (etiqueta de serie, longitud arbitraria del editor)
// en líneas de a lo sumo `maxChars`, para que una etiqueta larga no se
// salga del viewBox en vez de recortarse a ciegas.
function _envolverTexto(texto, maxChars) {
  const palabras = String(texto ?? '').split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  palabras.forEach((p) => {
    const cand = actual ? `${actual} ${p}` : p;
    if (cand.length > maxChars && actual) {
      lineas.push(actual);
      actual = p;
    } else {
      actual = cand;
    }
  });
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

// Arma las líneas de una etiqueta externa (nombre + valor/nota), envolviendo
// cada bloque por separado — la nota es dato libre del editor y puede ser
// tan larga como la etiqueta.
function _lineasEtiquetaExterna(etiqueta, principal, nota, color) {
  const lineaValor = nota ? `${principal} · ${nota}` : principal;
  return [
    ..._envolverTexto(etiqueta || '', 20).map((texto) => ({ texto, fill: color, peso: 700, tam: 11 })),
    ..._envolverTexto(lineaValor, 22).map((texto) => ({ texto, fill: '#ede9e3', peso: 400, tam: 10 })),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Pastel — distribución angular y decisión de etiqueta interna/externa
// ─────────────────────────────────────────────────────────────────────
function _totalSerie(series) {
  return series.reduce((s, x) => s + Math.abs(Number(x.valor) || 0), 0) || 1;
}

function _distribuirSectores(series) {
  const total = _totalSerie(series);
  let ang = 0;
  return series.map((s, i) => {
    const valor = Number(s.valor) || 0;
    const pct = (valor / total) * 100;
    const angAmplitud = (pct / 100) * 360;
    const angInicio = ang;
    const angFin = ang + angAmplitud;
    ang = angFin;
    return { ...s, i, valor, pct, angInicio, angFin, angAmplitud, mid: (angInicio + angFin) / 2, color: _colorSerie(i) };
  });
}

// Lección 2026-08-28: una porción angosta, o una porción de bisectriz
// lateral (~90°/270°) aunque sea angularmente grande, no tiene espacio
// horizontal para su etiqueta — el ancho disponible depende de la
// orientación de la bisectriz respecto del eje vertical, no solo de la
// amplitud del ángulo. `factorVertical` cae a 0 cuanto más lateral apunta.
function _necesitaExterna(sec, r, unidad) {
  if (sec.angAmplitud < 20) return true;
  const midRad = (sec.mid * Math.PI) / 180;
  const factorVertical = Math.abs(Math.cos(midRad));
  // Semiángulo capado a 90°: una porción de más de 180° (ej. 313°) no es más
  // angosta que una de 180° en su bisectriz — sin el tope, sin(halfRad) cae
  // otra vez para halfRad>90° y el cálculo confunde "casi todo el círculo"
  // con "porción angosta". Solo la etiqueta PRINCIPAL entra en esta cuenta:
  // la nota (más larga, opcional) se acomoda aparte una vez que se sabe que
  // hay espacio para el bloque.
  const halfRad = Math.min(((sec.angAmplitud / 2) * Math.PI) / 180, Math.PI / 2);
  const radioEtiqueta = r * 0.62;
  // La penalidad por bisectriz lateral (factorVertical bajo) solo aplica a
  // porciones de amplitud moderada, que es donde de verdad falta ancho en
  // una sola dirección (ej. 99°, ver Sala del Dinero). Una porción muy
  // grande (>140°) ya tiene espacio de sobra cerca de su bisectriz en
  // cualquier orientación — sin este atenuante, una porción de 209° podía
  // salir "angosta" solo por apuntar hacia el costado.
  const pesoAmplitud = Math.min(1, sec.angAmplitud / 140);
  const factorEfectivo = factorVertical + (1 - factorVertical) * pesoAmplitud;
  const anchoDisponible = 2 * radioEtiqueta * Math.sin(halfRad) * (0.3 + 0.7 * factorEfectivo);
  const principal = _formatoValor(sec.valor, unidad);
  const anchoTexto = _anchoEstimado(principal, 13);
  return anchoDisponible < anchoTexto + 8;
}

function _etiquetaInterna(svg, cx, cy, r, sec, unidad) {
  const radioEtiqueta = r * (sec.angAmplitud > 150 ? 0.5 : 0.65);
  const p = _polar(cx, cy, radioEtiqueta, sec.mid);
  const fill = _textoContraste(sec.color);
  const principal = _formatoValor(sec.valor, unidad);
  const nota = sec.nota ? String(sec.nota) : '';
  // Apilado vertical simple, con espacio de sobra entre las dos líneas — la
  // separación puramente radial (misma dirección, distinto radio) no sirve
  // en bisectrices laterales: ahí el desplazamiento cae más en x que en y,
  // y las cajas de texto (centradas, ambas anchas) se siguen solapando.
  const t1 = _svgEl('text', { x: p.x.toFixed(2), y: (p.y - (nota ? 7 : 0)).toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 13, 'font-weight': 700, fill });
  t1.textContent = principal;
  svg.appendChild(t1);
  if (nota) {
    const t2 = _svgEl('text', { x: p.x.toFixed(2), y: (p.y + 16).toFixed(2), 'text-anchor': 'middle', 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 10, fill });
    t2.textContent = nota;
    svg.appendChild(t2);
  }
}

// Etiqueta externa con línea líder. `factorVertical` decide si el bloque de
// texto se apila arriba/abajo del punto (bisectriz cerca de vertical) o se
// pega al costado (bisectriz lateral) — mismo criterio que costó encontrar
// en Sala del Dinero (99° de amplitud, bisectriz ~101°: "grande" pero sin
// espacio horizontal porque apunta casi al costado).
function _etiquetaExterna(svg, cx, cy, r, sec, unidad) {
  const midRad = (sec.mid * Math.PI) / 180;
  const factorVertical = Math.abs(Math.cos(midRad));
  // Dos porciones angostas vecinas (bisectrices cercanas entre sí) que
  // terminan las dos afuera se pisan si usan el mismo largo de línea líder
  // — se alterna por índice de serie para separarlas radialmente, mismo
  // espíritu que el offset manual que costó encontrar en Sala del Dinero.
  const leaderLen = 32 + Math.max(0, 20 - sec.angAmplitud) + (sec.i % 2) * 20;
  const rimPt = _polar(cx, cy, r, sec.mid);
  const leadEnd = _polar(cx, cy, r + leaderLen, sec.mid);
  svg.appendChild(_svgEl('line', { x1: rimPt.x.toFixed(2), y1: rimPt.y.toFixed(2), x2: leadEnd.x.toFixed(2), y2: leadEnd.y.toFixed(2), stroke: sec.color, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
  svg.appendChild(_svgEl('circle', { cx: rimPt.x.toFixed(2), cy: rimPt.y.toFixed(2), r: 3, fill: sec.color, stroke: '#0f1410', 'stroke-width': 1 }));

  const principal = _formatoValor(sec.valor, unidad);
  const lineHeight = 14;

  // Ángulo con signo, 0 = arriba, -180..180: define hacia qué lado del eje
  // vertical cae la porción — dos porciones vecinas de bisectriz casi
  // vertical (ej. 8° y 34°, ambas "arriba") igual quedan a lados
  // ligeramente distintos del eje, así que abanicarlas horizontalmente en
  // esa dirección (en vez de centrarlas a las dos en el mismo x) es lo que
  // evita que sus bloques de texto se encimen.
  const signedMid = sec.mid > 180 ? sec.mid - 360 : sec.mid;

  let anchor, ax, crecerHaciaArriba;
  if (factorVertical >= 0.5) {
    crecerHaciaArriba = Math.abs(signedMid) < 90;
    if (Math.abs(signedMid) < 8) {
      anchor = 'middle';
      ax = leadEnd.x;
    } else {
      anchor = signedMid > 0 ? 'start' : 'end';
      ax = anchor === 'start' ? leadEnd.x + 6 : leadEnd.x - 6;
    }
  } else {
    // Bisectriz lateral (~90°/270°): el texto se pega al costado del punto,
    // alineado hacia afuera, siempre apilado hacia abajo — apilarlo hacia
    // arriba ahí no gana separación vertical del aro (ver nota en
    // _necesitaExterna).
    anchor = Math.sin(midRad) >= 0 ? 'start' : 'end';
    ax = anchor === 'start' ? leadEnd.x + 8 : leadEnd.x - 8;
    crecerHaciaArriba = false;
  }

  const lineas = _lineasEtiquetaExterna(sec.etiqueta, principal, sec.nota, sec.color);

  const y0 = crecerHaciaArriba ? leadEnd.y - lineHeight * lineas.length : leadEnd.y + lineHeight * 0.4;
  lineas.forEach((linea, idx) => {
    const y = y0 + lineHeight * (idx + 1);
    const t = _svgEl('text', { x: ax.toFixed(2), y: y.toFixed(2), 'text-anchor': anchor, 'font-family': 'ui-monospace, monospace', 'font-size': linea.tam, 'font-weight': linea.peso, fill: linea.fill });
    t.textContent = linea.texto;
    svg.appendChild(t);
  });
}

// `visual.rango` (plan-motor-misiones.md §1.6, agregado 2026-09-22): corchete
// sobre el borde marcando un intervalo aceptado, no decoración — comunica
// que la respuesta correcta es un rango, no un número exacto (lo que evalúa
// la Sala Verde). min/max están en la misma escala que `series.valor`, así
// que se convierten a ángulo con el mismo `total` que reparte las porciones.
function _dibujarRango(svg, cx, cy, r, rango, total, unidad) {
  if (!rango || rango.min === undefined || rango.max === undefined) return;
  const angMin = (Number(rango.min) / total) * 360;
  const angMax = (Number(rango.max) / total) * 360;
  const rBracket = r + 16;
  svg.appendChild(_svgEl('path', { d: _arcPath(cx, cy, rBracket, angMin, angMax), fill: 'none', stroke: '#d99a2b', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  const pMinIn = _polar(cx, cy, r, angMin), pMinOut = _polar(cx, cy, rBracket, angMin);
  const pMaxIn = _polar(cx, cy, r, angMax), pMaxOut = _polar(cx, cy, rBracket, angMax);
  svg.appendChild(_svgEl('line', { x1: pMinIn.x.toFixed(2), y1: pMinIn.y.toFixed(2), x2: pMinOut.x.toFixed(2), y2: pMinOut.y.toFixed(2), stroke: '#d99a2b', 'stroke-width': 1.5 }));
  svg.appendChild(_svgEl('line', { x1: pMaxIn.x.toFixed(2), y1: pMaxIn.y.toFixed(2), x2: pMaxOut.x.toFixed(2), y2: pMaxOut.y.toFixed(2), stroke: '#d99a2b', 'stroke-width': 1.5 }));
  const midAng = (angMin + angMax) / 2;
  const pLabel = _polar(cx, cy, r + 55, midAng);
  const rangoTexto = unidad === '%' ? `${rango.min}–${rango.max}%` : unidad ? `${unidad}${rango.min}–${rango.max}` : `${rango.min}–${rango.max}`;
  const t = _svgEl('text', { x: pLabel.x.toFixed(2), y: pLabel.y.toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 12, 'font-weight': 600, fill: '#d99a2b', 'letter-spacing': '0.03em' });
  t.textContent = `${rango.etiqueta || 'rango aceptado'} ${rangoTexto}`;
  svg.appendChild(t);
}

function _leyendaPastel(svg, cx, cy, r, sectores, unidad, xIzq) {
  const legendY0 = cy + r + 40;
  sectores.forEach((s, i) => {
    const y = legendY0 + i * 20;
    svg.appendChild(_svgEl('rect', { x: xIzq, y: y - 10, width: 14, height: 14, rx: 3, fill: s.color, stroke: '#0f1410', 'stroke-width': 1 }));
    const lt = _svgEl('text', { x: xIzq + 22, y, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, fill: '#ede9e3' });
    lt.textContent = `${s.etiqueta || ''} — ${_formatoValor(s.valor, unidad)}${s.nota ? ' (' + s.nota + ')' : ''}`;
    svg.appendChild(lt);
  });
}

function _tabla(visual, filas, encabezados) {
  const details = _mk('details');
  const summary = _mk('summary', 'Ver datos en tabla');
  summary.setAttribute('aria-label', `Ver datos de ${visual.titulo || 'este gráfico'} en tabla`);
  details.appendChild(summary);
  const table = _mk('table');
  table.setAttribute('aria-label', visual.titulo || 'Datos del gráfico');
  if (visual.titulo) {
    const cap = _mk('caption', visual.titulo);
    cap.style.textAlign = 'left';
    cap.style.fontWeight = '600';
    table.appendChild(cap);
  }
  const thead = _mk('thead');
  const trh = _mk('tr');
  encabezados.forEach((h) => {
    const th = _mk('th', h);
    th.setAttribute('scope', 'col');
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = _mk('tbody');
  filas.forEach((fila) => {
    const tr = _mk('tr');
    fila.forEach((c) => tr.appendChild(_mk('td', c)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  details.appendChild(table);
  if (visual.pie) {
    const p = _mk('p', visual.pie);
    p.className = 'campo__ayuda';
    p.style.marginTop = '0.5rem';
    details.appendChild(p);
  }
  return details;
}

function _crearPastel(visual, seriesRaw) {
  const wrap = _mk('div');
  wrap.className = 'dataviz dataviz--pastel';
  wrap.setAttribute('data-dataviz', 'pastel');
  const uid = 'dv' + (++_contadorGrafico);

  const cx = 250, cy = 200, r = 118;
  const sectores = _distribuirSectores(seriesRaw);
  const alturaLeyenda = 24 + sectores.length * 20;
  const alturaTotal = cy + r + 60 + alturaLeyenda;

  const svg = _svgEl('svg', {
    role: 'img',
    'aria-labelledby': `${uid}-title ${uid}-desc`,
    viewBox: `0 0 500 ${alturaTotal}`,
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
  });
  // `height="auto"` como ATRIBUTO de presentación no es un <length> SVG
  // válido (Chrome lo rechaza con error de consola, aunque renderiza igual
  // por el fallback) — como propiedad CSS sí es válida y es lo que hace
  // falta para que el alto siga al ancho según el aspect ratio del viewBox.
  svg.style.height = 'auto';

  const title = _svgEl('title', { id: `${uid}-title` });
  title.textContent = visual.titulo || 'Gráfico de pastel';
  const desc = _svgEl('desc', { id: `${uid}-desc` });
  const partes = sectores.map((s) => `${s.etiqueta || 'serie'} ${_formatoValor(s.valor, visual.unidad)} (${s.pct.toFixed(1)}%)${s.nota ? ', ' + s.nota : ''}`);
  desc.textContent = `Gráfico de pastel de ${sectores.length} porciones. ${partes.join('. ')}. Cada porción lleva etiqueta de texto; el color no es el único portador de significado.`;
  svg.appendChild(title);
  svg.appendChild(desc);

  sectores.forEach((s) => {
    svg.appendChild(_svgEl('path', { d: _sectorPath(cx, cy, r, s.angInicio, s.angFin), fill: s.color, stroke: '#0f1410', 'stroke-width': 1.5 }));
  });
  svg.appendChild(_svgEl('circle', { cx, cy, r, fill: 'none', stroke: '#2e3430', 'stroke-width': 1 }));

  sectores.forEach((s) => {
    if (_necesitaExterna(s, r, visual.unidad)) _etiquetaExterna(svg, cx, cy, r, s, visual.unidad);
    else _etiquetaInterna(svg, cx, cy, r, s, visual.unidad);
  });

  if (visual.rango) _dibujarRango(svg, cx, cy, r, visual.rango, _totalSerie(seriesRaw), visual.unidad);

  _leyendaPastel(svg, cx, cy, r, sectores, visual.unidad, 40);

  wrap.appendChild(svg);
  wrap.appendChild(_tabla(
    visual,
    sectores.map((s) => [s.etiqueta || '', _formatoValor(s.valor, visual.unidad), `${s.pct.toFixed(1)}%`, s.nota || '—']),
    ['Serie', 'Valor', '% del total', 'Nota'],
  ));
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────
// Barra apilada — sigue siendo tipo válido de §1.6 para misiones nuevas
// aunque ninguna sala de CGC lo use hoy (las dos son pastel, §1.8.1).
// ─────────────────────────────────────────────────────────────────────
function _crearBarrasApiladas(visual, seriesRaw) {
  const wrap = _mk('div');
  wrap.className = 'dataviz dataviz--barras';
  wrap.setAttribute('data-dataviz', 'barras_apiladas');
  const uid = 'dv' + (++_contadorGrafico);

  const total = seriesRaw.reduce((s, x) => s + Math.abs(Number(x.valor) || 0), 0) || 1;
  const anchoTotal = 500;
  const margenX = 30;
  const anchoBarra = anchoTotal - margenX * 2;
  const altoBarra = 60;
  const yBarra = 90;

  let x = margenX;
  const segmentos = seriesRaw.map((s, i) => {
    const valor = Number(s.valor) || 0;
    const pct = (valor / total) * 100;
    const w = (pct / 100) * anchoBarra;
    const seg = { ...s, i, valor, pct, x, w, color: _colorSerie(i) };
    x += w;
    return seg;
  });

  const alturaLeyenda = 24 + segmentos.length * 20;
  const alturaTotal = yBarra + altoBarra + 50 + alturaLeyenda;

  const svg = _svgEl('svg', {
    role: 'img',
    'aria-labelledby': `${uid}-title ${uid}-desc`,
    viewBox: `0 0 ${anchoTotal} ${alturaTotal}`,
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
  });
  svg.style.height = 'auto'; // ver nota en _crearPastel — no es un atributo válido

  const title = _svgEl('title', { id: `${uid}-title` });
  title.textContent = visual.titulo || 'Gráfico de barra apilada';
  const desc = _svgEl('desc', { id: `${uid}-desc` });
  const partes = segmentos.map((s) => `${s.etiqueta || 'serie'} ${_formatoValor(s.valor, visual.unidad)} (${s.pct.toFixed(1)}%)${s.nota ? ', ' + s.nota : ''}`);
  desc.textContent = `Barra apilada dividida en ${segmentos.length} segmentos, de izquierda a derecha: ${partes.join('; ')}. Cada segmento lleva etiqueta de texto; el color no es el único portador de significado.`;
  svg.appendChild(title);
  svg.appendChild(desc);

  segmentos.forEach((s) => {
    svg.appendChild(_svgEl('rect', { x: s.x.toFixed(2), y: yBarra, width: Math.max(s.w, 0.01).toFixed(2), height: altoBarra, fill: s.color, stroke: '#0f1410', 'stroke-width': 1 }));
  });
  svg.appendChild(_svgEl('rect', { x: margenX, y: yBarra, width: anchoBarra, height: altoBarra, fill: 'none', stroke: '#2e3430', 'stroke-width': 1 }));

  // Mismo criterio de espacio disponible que en el pastel, medido en ancho
  // de segmento en vez de ancho de cuerda angular: adentro si entra, si no,
  // línea líder hacia arriba con el texto apilado.
  segmentos.forEach((s) => {
    const principal = _formatoValor(s.valor, visual.unidad);
    const anchoTexto = Math.max(_anchoEstimado(principal, 12), _anchoEstimado(s.etiqueta || '', 11));
    const cxSeg = s.x + s.w / 2;
    if (s.w >= anchoTexto + 12) {
      const fill = _textoContraste(s.color);
      const t1 = _svgEl('text', { x: cxSeg.toFixed(2), y: (yBarra + altoBarra / 2 - 4).toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 12, 'font-weight': 700, fill });
      t1.textContent = principal;
      svg.appendChild(t1);
      const t2 = _svgEl('text', { x: cxSeg.toFixed(2), y: (yBarra + altoBarra / 2 + 12).toFixed(2), 'text-anchor': 'middle', 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 10, fill });
      t2.textContent = s.etiqueta || '';
      svg.appendChild(t2);
    } else {
      const leadEnd = yBarra - 24;
      svg.appendChild(_svgEl('line', { x1: cxSeg.toFixed(2), y1: yBarra, x2: cxSeg.toFixed(2), y2: leadEnd, stroke: s.color, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
      svg.appendChild(_svgEl('circle', { cx: cxSeg.toFixed(2), cy: yBarra, r: 3, fill: s.color, stroke: '#0f1410', 'stroke-width': 1 }));
      const lineHeight = 14;
      const lineas = _lineasEtiquetaExterna(s.etiqueta, principal, s.nota, s.color);
      const y0 = leadEnd - lineHeight * lineas.length;
      // Segmentos cerca del borde del gráfico: el texto centrado en cxSeg
      // puede salirse del viewBox aunque esté envuelto en líneas cortas —
      // se recorta el x del texto (no el del marcador/línea líder) a un
      // margen seguro.
      const axTexto = Math.min(Math.max(cxSeg, margenX + 75), anchoTotal - margenX - 75);
      lineas.forEach((linea, idx) => {
        const y = y0 + lineHeight * (idx + 1);
        const t = _svgEl('text', { x: axTexto.toFixed(2), y: y.toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': linea.tam, 'font-weight': linea.peso, fill: linea.fill });
        t.textContent = linea.texto;
        svg.appendChild(t);
      });
    }
  });

  const legendY0 = yBarra + altoBarra + 40;
  segmentos.forEach((s, i) => {
    const y = legendY0 + i * 20;
    svg.appendChild(_svgEl('rect', { x: margenX, y: y - 10, width: 14, height: 14, rx: 3, fill: s.color, stroke: '#0f1410', 'stroke-width': 1 }));
    const lt = _svgEl('text', { x: margenX + 22, y, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, fill: '#ede9e3' });
    lt.textContent = `${s.etiqueta || ''} — ${_formatoValor(s.valor, visual.unidad)}${s.nota ? ' (' + s.nota + ')' : ''}`;
    svg.appendChild(lt);
  });

  wrap.appendChild(svg);
  wrap.appendChild(_tabla(
    visual,
    segmentos.map((s) => [s.etiqueta || '', _formatoValor(s.valor, visual.unidad), `${s.pct.toFixed(1)}%`, s.nota || '—']),
    ['Segmento', 'Valor', '% del total', 'Nota'],
  ));
  return wrap;
}

// Público -----------------------------------------------------------------
// Único punto de entrada. No hay presets por sala ni por id — todo sale de
// `visual` (estaciones.visual, §1.6). El orquestador (js/juego.js, P3) es
// quien decide cuándo llamarlo, con estacion.visual.
export function crearGrafico(visual) {
  if (!visual || !visual.tipo) return null;
  const series = Array.isArray(visual.series) ? visual.series : [];
  if (!series.length) return null;
  if (visual.tipo === 'pastel') return _crearPastel(visual, series);
  if (visual.tipo === 'barras_apiladas') return _crearBarrasApiladas(visual, series);
  return null;
}
