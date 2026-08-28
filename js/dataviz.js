// _src/js/dataviz.js — dataviz (ct-e2, ct-e3) + fe-components
// Dueño: dataviz — Vanilla ES module, SVG inline sin librerías
// CONTRACT §16.2: E2 (87% verde / 13% resto, rango 85-90) y E3 (US$4.00 reparto)
// 2026-08-28: cambio de barra 100%/apilada a gráfico de pastel (pedido de
// Fernando) — mismos datos y mismos requisitos de accesibilidad, solo
// cambia la forma. Reqs sin tocar: role=img, <title>/<desc>, tabla
// fallback en <details>, color no es único portador (etiqueta texto en
// cada porción, no solo el relleno).
// Solo usa textContent/createElement, nunca innerHTML con datos dinámicos para sanitización §14.4
// Colores con tokens: --color-exito, --color-acento, bordes sutiles; fondo oscuro expediente #0f1410

const NS = 'http://www.w3.org/2000/svg';

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

// ─────────────────────────────────────────────────────────────────────
// Geometría de pastel — 0° = arriba (12 en punto), crece en sentido horario.
// ─────────────────────────────────────────────────────────────────────
function _polar(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

// Porción completa (del centro al borde y de vuelta) — para las tajadas del pastel.
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

// ─────────────────────────────────────────────────────────────────────
// E2 — Huella hídrica: pastel de 2 porciones, 87% verde / 13% resto,
// con un corchete sobre el borde marcando el rango aceptado 85–90%.
// ─────────────────────────────────────────────────────────────────────
export function crearGraficoE2() {
  const wrap = _mk('div');
  wrap.className = 'dataviz dataviz--e2';
  wrap.setAttribute('data-dataviz', 'e2');

  const cx = 250, cy = 200, r = 118;
  const pctVerde = 87;
  const angVerde = pctVerde * 3.6; // 313.2°
  const ang85 = 85 * 3.6, ang90 = 90 * 3.6;

  const svg = _svgEl('svg', {
    role: 'img',
    'aria-labelledby': 'dataviz-e2-title dataviz-e2-desc',
    viewBox: '0 0 500 430',
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    height: 'auto',
  });

  const title = _svgEl('title', { id: 'dataviz-e2-title' });
  title.textContent = 'Huella hídrica: 87% agua verde (lluvia) y 13% agua azul y gris';
  const desc = _svgEl('desc', { id: 'dataviz-e2-desc' });
  desc.textContent = 'Gráfico de pastel de dos porciones. La porción verde cubre 87% del círculo y representa agua de lluvia. La porción oscura cubre el 13% restante y representa agua azul y gris. Un corchete sobre el borde marca el rango aceptado de 85 a 90%, indicando que la respuesta correcta está dentro de ese intervalo. Cada porción lleva etiqueta de texto; el color no es el único portador de significado.';
  svg.appendChild(title);
  svg.appendChild(desc);

  // Porciones
  svg.appendChild(_svgEl('path', { d: _sectorPath(cx, cy, r, 0, angVerde), fill: '#34c266', stroke: '#0f1410', 'stroke-width': 1.5 }));
  svg.appendChild(_svgEl('path', { d: _sectorPath(cx, cy, r, angVerde, 360), fill: '#3d4640', stroke: '#0f1410', 'stroke-width': 1.5 }));
  // Borde exterior sutil
  svg.appendChild(_svgEl('circle', { cx, cy, r, fill: 'none', stroke: '#2e3430', 'stroke-width': 1 }));

  // Etiqueta dentro de la porción verde (texto oscuro sobre verde — contraste AAA)
  const midVerde = angVerde / 2;
  const pVerde = _polar(cx, cy, r * 0.6, midVerde);
  const tVerde = _svgEl('text', { x: pVerde.x.toFixed(2), y: (pVerde.y - 6).toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 22, 'font-weight': 700, fill: '#0f1410' });
  tVerde.textContent = '87%';
  svg.appendChild(tVerde);
  const tVerde2 = _svgEl('text', { x: pVerde.x.toFixed(2), y: (pVerde.y + 14).toFixed(2), 'text-anchor': 'middle', 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, 'font-weight': 600, fill: '#0f1410' });
  tVerde2.textContent = 'agua verde (lluvia)';
  svg.appendChild(tVerde2);

  // Etiqueta dentro de la porción resto (texto claro sobre gris oscuro)
  const midResto = angVerde + (360 - angVerde) / 2;
  const pResto = _polar(cx, cy, r * 0.72, midResto);
  const tResto = _svgEl('text', { x: pResto.x.toFixed(2), y: (pResto.y - 3).toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 15, 'font-weight': 700, fill: '#ede9e3' });
  tResto.textContent = '13%';
  svg.appendChild(tResto);
  const tResto2 = _svgEl('text', { x: pResto.x.toFixed(2), y: (pResto.y + 12).toFixed(2), 'text-anchor': 'middle', 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 9, fill: '#c2beba' });
  tResto2.textContent = 'azul+gris';
  svg.appendChild(tResto2);

  // Corchete de rango aceptado 85–90%, sobre el borde exterior
  const rBracket = r + 16;
  svg.appendChild(_svgEl('path', { d: _arcPath(cx, cy, rBracket, ang85, ang90), fill: 'none', stroke: '#d99a2b', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  const p85in = _polar(cx, cy, r, ang85), p85out = _polar(cx, cy, rBracket, ang85);
  const p90in = _polar(cx, cy, r, ang90), p90out = _polar(cx, cy, rBracket, ang90);
  svg.appendChild(_svgEl('line', { x1: p85in.x.toFixed(2), y1: p85in.y.toFixed(2), x2: p85out.x.toFixed(2), y2: p85out.y.toFixed(2), stroke: '#d99a2b', 'stroke-width': 1.5 }));
  svg.appendChild(_svgEl('line', { x1: p90in.x.toFixed(2), y1: p90in.y.toFixed(2), x2: p90out.x.toFixed(2), y2: p90out.y.toFixed(2), stroke: '#d99a2b', 'stroke-width': 1.5 }));
  const midRango = (ang85 + ang90) / 2;
  const pLabel = _polar(cx, cy, r + 55, midRango);
  const tRango = _svgEl('text', { x: pLabel.x.toFixed(2), y: pLabel.y.toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, monospace', 'font-size': 12, 'font-weight': 600, fill: '#d99a2b', 'letter-spacing': '0.03em' });
  tRango.textContent = 'rango aceptado 85–90%';
  svg.appendChild(tRango);

  // Leyenda inferior accesible (texto, no solo color)
  const legend = _svgEl('g', { 'aria-hidden': 'true' });
  legend.appendChild(_svgEl('circle', { cx: 40, cy: 372, r: 6, fill: '#34c266', stroke: '#0f1410', 'stroke-width': 1 }));
  const lg1 = _svgEl('text', { x: 52, y: 376, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 13, fill: '#ede9e3' });
  lg1.textContent = 'Agua verde (lluvia) — 87%';
  legend.appendChild(lg1);
  legend.appendChild(_svgEl('circle', { cx: 40, cy: 398, r: 6, fill: '#3d4640', stroke: '#ede9e3', 'stroke-width': 1 }));
  const lg2 = _svgEl('text', { x: 52, y: 402, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 13, fill: '#ede9e3' });
  lg2.textContent = 'Agua azul + gris — 13%';
  legend.appendChild(lg2);
  legend.appendChild(_svgEl('rect', { x: 40, y: 414, width: 16, height: 12, rx: 2, fill: 'none', stroke: '#d99a2b', 'stroke-width': 1.5 }));
  const lg3 = _svgEl('text', { x: 64, y: 424, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 13, fill: '#d99a2b' });
  lg3.textContent = 'Rango aceptado 85–90%';
  legend.appendChild(lg3);
  svg.appendChild(legend);

  wrap.appendChild(svg);

  // Tabla fallback en <details> — accesible, datos idénticos al pastel
  const details = _mk('details');
  const summary = _mk('summary', 'Ver datos en tabla');
  summary.setAttribute('aria-label', 'Ver datos de huella hídrica en tabla');
  details.appendChild(summary);
  const table = _mk('table');
  table.setAttribute('aria-label', 'Huella hídrica por tipo de agua');
  const cap = _mk('caption', 'Huella hídrica — distribución porcentual');
  cap.style.textAlign = 'left';
  cap.style.fontWeight = '600';
  table.appendChild(cap);
  const thead = _mk('thead');
  const trh = _mk('tr');
  ['Tipo de agua', 'Porcentaje', 'Rango aceptado'].forEach((h) => {
    const th = _mk('th', h);
    th.setAttribute('scope', 'col');
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = _mk('tbody');
  [
    ['Agua verde (lluvia)', '87%', '85–90% ✓'],
    ['Agua azul + gris', '13%', '—'],
    ['Total', '100%', '—'],
  ].forEach(([a, b, c]) => {
    const tr = _mk('tr');
    tr.appendChild(_mk('td', a));
    tr.appendChild(_mk('td', b));
    tr.appendChild(_mk('td', c));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  details.appendChild(table);
  const note = _mk('p', 'Nota: 87% es agua de lluvia, no “impacto cero”. El rango 85–90% se acepta como correcto.');
  note.className = 'campo__ayuda';
  note.style.marginTop = '0.5rem';
  details.appendChild(note);
  wrap.appendChild(details);

  return wrap;
}

// ─────────────────────────────────────────────────────────────────────
// E3 — Reparto US$4.00: pastel de 4 porciones (0.175 / 0.40 / 1.10 / 2.325).
// La porción de la caficultora es angularmente diminuta (15.75°): lleva
// etiqueta externa con línea líder, igual espíritu que la barra original.
// ─────────────────────────────────────────────────────────────────────
export function crearGraficoE3() {
  const wrap = _mk('div');
  wrap.className = 'dataviz dataviz--e3';
  wrap.setAttribute('data-dataviz', 'e3');

  const total = 4.0;
  const segmentosBase = [
    { id: 'caficultora', label: 'Caficultora', valor: 0.175, fill: '#d99a2b', textColor: '#0f1410' },
    { id: 'procesamiento', label: 'Procesamiento', valor: 0.40, fill: '#34c266', textColor: '#0f1410' },
    { id: 'tostado', label: 'Tostado y logística', valor: 1.10, fill: '#d9a441', textColor: '#0f1410' },
    { id: 'cafeteria', label: 'Cafetería', valor: 2.325, fill: '#2e3430', textColor: '#ede9e3' },
  ];
  let anguloActual = 0;
  const segmentos = segmentosBase.map((seg) => {
    const pct = (seg.valor / total) * 100;
    const angInicio = anguloActual;
    const angAmplitud = (pct / 100) * 360;
    anguloActual += angAmplitud;
    return { ...seg, pct, angInicio, angFin: anguloActual, angAmplitud };
  });

  const cx = 250, cy = 200, r = 110;

  const svg = _svgEl('svg', {
    role: 'img',
    'aria-labelledby': 'dataviz-e3-title dataviz-e3-desc',
    viewBox: '0 0 530 450',
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    height: 'auto',
  });
  const title = _svgEl('title', { id: 'dataviz-e3-title' });
  title.textContent = 'Reparto de US$4.00: la caficultora recibe US$0.175 (4.4%)';
  const desc = _svgEl('desc', { id: 'dataviz-e3-desc' });
  desc.textContent = 'Gráfico de pastel de cuatro porciones sobre US$4.00. En sentido horario desde arriba: caficultora 0.175 dólares (4.4%, porción ínfima ámbar con etiqueta externa), procesamiento 0.40 (10%), tostado y logística 1.10 (27.5%), cafetería 2.325 (58.1%, porción mayor gris oscuro). La desproporción es el aprendizaje y se ve antes de leerse. Cada porción lleva etiqueta de texto con valor y porcentaje; el color no es el único portador.';
  svg.appendChild(title);
  svg.appendChild(desc);

  // Porciones
  segmentos.forEach((seg) => {
    svg.appendChild(_svgEl('path', { d: _sectorPath(cx, cy, r, seg.angInicio, seg.angFin), fill: seg.fill, stroke: '#0f1410', 'stroke-width': 1.5 }));
  });
  svg.appendChild(_svgEl('circle', { cx, cy, r, fill: 'none', stroke: '#2e3430', 'stroke-width': 1 }));

  // Etiqueta externa con línea líder — para porciones angostas donde ningún
  // texto entra adentro sin desbordar hacia la porción vecina (caficultora
  // 15.75°, procesamiento 36°). `leaderLen` distinto por segmento para que
  // los dos bloques de texto (ambos cerca de la parte superior del pastel)
  // no se pisen entre sí.
  function _etiquetaExterna(seg, mid, leaderLen, colorNombre, lado, nombre) {
    const shortLabel = `US$${seg.valor.toFixed(2)} · ${seg.pct.toFixed(1)}%`;
    const rimPt = _polar(cx, cy, r, mid);
    const leadEnd = _polar(cx, cy, r + leaderLen, mid);
    svg.appendChild(_svgEl('line', { x1: rimPt.x.toFixed(2), y1: rimPt.y.toFixed(2), x2: leadEnd.x.toFixed(2), y2: leadEnd.y.toFixed(2), stroke: colorNombre, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
    svg.appendChild(_svgEl('circle', { cx: rimPt.x.toFixed(2), cy: rimPt.y.toFixed(2), r: 3, fill: colorNombre, stroke: '#0f1410', 'stroke-width': 1 }));
    // 'arriba': porciones cuya bisectriz apunta hacia arriba (caficultora,
    // procesamiento) — la línea líder gana harta separación vertical del
    // aro, así que el bloque de texto centrado y apilado encima funciona.
    // 'derecha': bisectriz casi horizontal (tostado, ~101°) — ahí la línea
    // apenas gana separación vertical (su componente es casi todo
    // horizontal), así que centrar el texto lo deja pegado al marcador;
    // en vez de eso el texto arranca a la derecha del punto, alineado a
    // la izquierda, apilado hacia abajo. Encontrado con Playwright contra
    // el juego real — ver progress.md 2026-08-28.
    let ax, ay1, ay2, anchor;
    if (lado === 'derecha') {
      anchor = 'start';
      ax = leadEnd.x + 8;
      ay1 = leadEnd.y - 2;
      ay2 = leadEnd.y + 12;
    } else {
      anchor = 'middle';
      ax = leadEnd.x;
      ay1 = leadEnd.y - 8;
      ay2 = leadEnd.y - 20;
    }
    const t1 = _svgEl('text', { x: ax.toFixed(2), y: ay1.toFixed(2), 'text-anchor': anchor, 'font-family': 'ui-monospace, monospace', 'font-size': 11, 'font-weight': 700, fill: colorNombre });
    t1.textContent = nombre || seg.label;
    svg.appendChild(t1);
    const t2 = _svgEl('text', { x: ax.toFixed(2), y: ay2.toFixed(2), 'text-anchor': anchor, 'font-family': 'ui-monospace, monospace', 'font-size': 10, fill: '#ede9e3' });
    t2.textContent = shortLabel;
    svg.appendChild(t2);
  }

  segmentos.forEach((seg) => {
    const mid = (seg.angInicio + seg.angFin) / 2;
    if (seg.id === 'caficultora') {
      _etiquetaExterna(seg, mid, 55, '#d99a2b', 'arriba');
    } else if (seg.id === 'procesamiento') {
      _etiquetaExterna(seg, mid, 42, '#34c266', 'arriba');
    } else if (seg.id === 'tostado') {
      // 2026-08-28: probado adentro (verificado con Playwright contra el
      // juego real) — a cualquier radio, "Tostado y logística"/"Tostado/
      // logística" se salía de su propia porción hacia la de cafetería, y
      // ahí el texto oscuro (pensado para leerse sobre ámbar) quedaba casi
      // invisible sobre el gris oscuro vecino. Con 99° de amplitud parece
      // "grande", pero su bisectriz apunta casi horizontal (~101°) y el
      // texto centrado ahí se desborda igual. Línea líder como caficultora/
      // procesamiento, pero hacia la derecha del punto (ver 'derecha' en
      // _etiquetaExterna) — apilar el texto arriba del punto como a esas
      // dos no sirve acá porque la bisectriz casi horizontal no gana
      // separación vertical del aro, y el texto queda pegado al marcador.
      _etiquetaExterna(seg, mid, 30, '#d9a441', 'derecha', 'Tostado/logística');
    } else {
      // Cafetería: 209° de amplitud, la más grande — sí entra completa
      // adentro sin desbordar (verificado visualmente).
      const labelR = r * 0.6;
      const p = _polar(cx, cy, labelR, mid);
      const t1 = _svgEl('text', { x: p.x.toFixed(2), y: (p.y - 6).toFixed(2), 'text-anchor': 'middle', 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, 'font-weight': 700, fill: seg.textColor });
      t1.textContent = seg.label;
      svg.appendChild(t1);
      const t2 = _svgEl('text', { x: p.x.toFixed(2), y: (p.y + 9).toFixed(2), 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 9, fill: seg.textColor, opacity: 0.9 });
      t2.textContent = `US$${seg.valor.toFixed(2)} · ${seg.pct.toFixed(1)}%`;
      svg.appendChild(t2);
    }
  });

  // Anotación del aprendizaje — visible siempre, no solo dentro del <details>
  const note = _svgEl('text', { x: 250, y: 332, 'text-anchor': 'middle', 'font-family': '-apple-system, sans-serif', 'font-size': 12, fill: '#ede9e3', 'font-style': 'italic' });
  note.textContent = 'La porción ámbar (arriba) es la caficultora — 4.4% del precio final.';
  svg.appendChild(note);
  const note2 = _svgEl('text', { x: 250, y: 348, 'text-anchor': 'middle', 'font-family': '-apple-system, sans-serif', 'font-size': 11, fill: '#9a9590' });
  note2.textContent = 'Se ve antes de leerse: esa es la desproporción.';
  svg.appendChild(note2);

  // Leyenda
  const legend = _svgEl('g', { 'aria-hidden': 'true' });
  const cols = [
    { c: '#d99a2b', t: 'Caficultora 4.4%' },
    { c: '#34c266', t: 'Procesamiento 10%' },
    { c: '#d9a441', t: 'Tostado/logística 27.5%' },
    { c: '#2e3430', t: 'Cafetería 58.1%', stroke: '#c2beba' },
  ];
  cols.forEach((col, i) => {
    const y = 374 + i * 20;
    legend.appendChild(_svgEl('rect', { x: 40, y, width: 14, height: 14, rx: 3, fill: col.c, stroke: col.stroke || '#0f1410', 'stroke-width': 1 }));
    const lt = _svgEl('text', { x: 62, y: y + 11, 'font-family': '-apple-system, sans-serif', 'font-size': 12, fill: '#ede9e3' });
    lt.textContent = col.t;
    legend.appendChild(lt);
  });
  svg.appendChild(legend);

  wrap.appendChild(svg);

  // Tabla fallback
  const details = _mk('details');
  const summary = _mk('summary', 'Ver datos en tabla');
  details.appendChild(summary);
  const table = _mk('table');
  table.setAttribute('aria-label', 'Reparto de US$4.00 por eslabón');
  const cap = _mk('caption', 'Reparto de US$4.00 — valor por eslabón');
  cap.style.textAlign = 'left';
  cap.style.fontWeight = '600';
  table.appendChild(cap);
  const thead = _mk('thead');
  const trh = _mk('tr');
  ['Eslabón', 'US$', '% del precio final'].forEach((h) => {
    const th = _mk('th', h);
    th.setAttribute('scope', 'col');
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = _mk('tbody');
  [
    ['Caficultora', '0.175', '4.4%'],
    ['Procesamiento', '0.40', '10.0%'],
    ['Tostado y logística', '1.10', '27.5%'],
    ['Cafetería', '2.325', '58.1%'],
    ['Total', '4.00', '100%'],
  ].forEach(([a, b, c]) => {
    const tr = _mk('tr');
    if (a === 'Caficultora') tr.style.fontWeight = '700';
    tr.appendChild(_mk('td', a));
    const td2 = _mk('td', b);
    td2.style.fontFamily = 'ui-monospace, monospace';
    td2.style.fontVariantNumeric = 'tabular-nums';
    tr.appendChild(td2);
    tr.appendChild(_mk('td', c));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  details.appendChild(table);
  const p = _mk('p', 'Fuente: expediente CGC. Rango correcto para E3: 4–4.4% para la caficultora (el cálculo usa 0.175/4).');
  p.className = 'campo__ayuda';
  p.style.marginTop = '0.5rem';
  details.appendChild(p);
  wrap.appendChild(details);

  return wrap;
}

// Helper para inyectar según id de estación (usado por render.js)
export function inyectarDataviz(contenedor, estacionId) {
  if (!contenedor) return;
  const id = Number(estacionId);
  if (id === 2) contenedor.prepend(crearGraficoE2());
  else if (id === 3) contenedor.prepend(crearGraficoE3());
}
