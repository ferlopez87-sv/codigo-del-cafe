// _src/js/dataviz.js — dataviz (ct-e2, ct-e3) + fe-components
// Dueño: dataviz — Vanilla ES module, SVG inline sin librerías
// CONTRACT §16.2: E2 (87% verde / 13% resto, rango 85-90) y E3 (US$4.00 reparto)
// Reqs: role=img, <title>/<desc>, tabla fallback en <details>, color no es único portador (etiqueta texto en cada segmento)
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
// E2 — Huella hídrica 87% verde / 13% resto, rango 85-90 marcado
// ─────────────────────────────────────────────────────────────────────
export function crearGraficoE2() {
  const wrap = _mk('div');
  wrap.className = 'dataviz dataviz--e2';
  wrap.setAttribute('data-dataviz', 'e2');

  const svg = _svgEl('svg', {
    role: 'img',
    'aria-labelledby': 'dataviz-e2-title dataviz-e2-desc',
    viewBox: '0 0 1000 220',
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    height: 'auto',
  });

  const title = _svgEl('title', { id: 'dataviz-e2-title' });
  title.textContent = 'Huella hídrica: 87% agua verde (lluvia) y 13% agua azul y gris';
  const desc = _svgEl('desc', { id: 'dataviz-e2-desc' });
  desc.textContent = 'Barra horizontal 100%. Segmento verde de 0 a 87% (870 de 1000 unidades) representa agua de lluvia. Segmento oscuro de 87 a 100% representa agua azul y gris (13%). Un corchete superior marca el rango aceptado 85 a 90%, indicando que la respuesta correcta está dentro de ese intervalo. Cada segmento lleva etiqueta de texto; el color no es el único portador de significado.';

  // defs: borde redondeado clip
  const defs = _svgEl('defs');
  const clip = _svgEl('clipPath', { id: 'clip-e2' });
  clip.appendChild(_svgEl('rect', { x: 40, y: 80, width: 920, height: 36, rx: 8, ry: 8 }));
  defs.appendChild(clip);
  svg.appendChild(defs);
  svg.appendChild(title);
  svg.appendChild(desc);

  // fondo pista
  svg.appendChild(_svgEl('rect', { x: 40, y: 80, width: 920, height: 36, rx: 8, ry: 8, fill: '#1c211d', stroke: '#2e3430', 'stroke-width': 1 }));

  // segmentos con clip
  const g = _svgEl('g', { 'clip-path': 'url(#clip-e2)' });
  // 87% verde — usa --color-exito #34c266 (oklch 0.68 0.16 145) — contraste AAA sobre oscuro
  g.appendChild(_svgEl('rect', { x: 40, y: 80, width: 800.4, height: 36, fill: '#34c266' })); // 920*0.87=800.4
  // 13% resto — gris oscuro con textura sutil (diagonal hatch alternativo: color plano #2e3430 con label)
  g.appendChild(_svgEl('rect', { x: 840.4, y: 80, width: 119.6, height: 36, fill: '#3d4640' }));
  svg.appendChild(g);

  // Separador 87%
  svg.appendChild(_svgEl('line', { x1: 840.4, y1: 80, x2: 840.4, y2: 116, stroke: '#0f1410', 'stroke-width': 2, opacity: 0.9 }));

  // Etiquetas dentro de la barra (blanco cálido #ede9e3 sobre verde necesita contraste; usamos texto oscuro sobre verde y claro sobre resto)
  // 87% etiqueta centrada en segmento verde
  const tVerde = _svgEl('text', { x: 440, y: 102, 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 15, 'font-weight': 700, fill: '#0f1410', 'letter-spacing': '0.02em' });
  tVerde.textContent = '87% · agua verde (lluvia)';
  svg.appendChild(tVerde);
  const tResto = _svgEl('text', { x: 900, y: 102, 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': 13, 'font-weight': 600, fill: '#ede9e3' });
  tResto.textContent = '13%';
  svg.appendChild(tResto);
  const tResto2 = _svgEl('text', { x: 900, y: 118, 'text-anchor': 'middle', 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 9, fill: '#c2beba' });
  tResto2.textContent = 'azul+gris';
  svg.appendChild(tResto2);

  // Corchete rango 85-90% (782 a 828 en coords: 40 + 920*0.85 = 822, 40+920*0.90=868 — ajustado)
  const x85 = 40 + 920 * 0.85; // 822
  const x90 = 40 + 920 * 0.90; // 868
  const bracketY = 64;
  // línea superior + ticks
  svg.appendChild(_svgEl('line', { x1: x85, y1: bracketY, x2: x90, y2: bracketY, stroke: '#d99a2b', 'stroke-width': 1.5, 'stroke-linecap': 'round' }));
  svg.appendChild(_svgEl('line', { x1: x85, y1: bracketY, x2: x85, y2: bracketY + 8, stroke: '#d99a2b', 'stroke-width': 1.5 }));
  svg.appendChild(_svgEl('line', { x1: x90, y1: bracketY, x2: x90, y2: bracketY + 8, stroke: '#d99a2b', 'stroke-width': 1.5 }));
  const tRango = _svgEl('text', { x: (x85 + x90) / 2, y: 54, 'text-anchor': 'middle', 'font-family': 'ui-monospace, SFMono-Regular, monospace', 'font-size': 11, 'font-weight': 600, fill: '#d99a2b', 'letter-spacing': '0.03em' });
  tRango.textContent = 'rango aceptado 85–90%';
  svg.appendChild(tRango);
  // marcadores 85 y 90 debajo del corchete (pequeños ticks hacia la barra)
  svg.appendChild(_svgEl('line', { x1: x85, y1: 72, x2: x85, y2: 80, stroke: '#d99a2b', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.9 }));
  svg.appendChild(_svgEl('line', { x1: x90, y1: 72, x2: x90, y2: 80, stroke: '#d99a2b', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.9 }));
  const t85 = _svgEl('text', { x: x85, y: 138, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 10, fill: '#9a9590' });
  t85.textContent = '85%';
  svg.appendChild(t85);
  const t90 = _svgEl('text', { x: x90, y: 138, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 10, fill: '#9a9590' });
  t90.textContent = '90%';
  svg.appendChild(t90);

  // Leyenda inferior accesible (texto, no solo color)
  const legend = _svgEl('g', { 'aria-hidden': 'true' });
  // dot verde + texto
  legend.appendChild(_svgEl('circle', { cx: 40, cy: 168, r: 6, fill: '#34c266', stroke: '#0f1410', 'stroke-width': 1 }));
  const lg1 = _svgEl('text', { x: 52, y: 172, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, fill: '#ede9e3' });
  lg1.textContent = 'Agua verde (lluvia) — 87%';
  legend.appendChild(lg1);
  legend.appendChild(_svgEl('circle', { cx: 280, cy: 168, r: 6, fill: '#3d4640', stroke: '#ede9e3', 'stroke-width': 1 }));
  const lg2 = _svgEl('text', { x: 292, y: 172, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, fill: '#ede9e3' });
  lg2.textContent = 'Agua azul + gris — 13%';
  legend.appendChild(lg2);
  legend.appendChild(_svgEl('rect', { x: 540, y: 162, width: 18, height: 12, rx: 2, fill: 'none', stroke: '#d99a2b', 'stroke-width': 1.5 }));
  const lg3 = _svgEl('text', { x: 566, y: 172, 'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': 12, fill: '#d99a2b' });
  lg3.textContent = 'Rango aceptado 85–90%';
  legend.appendChild(lg3);
  svg.appendChild(legend);

  wrap.appendChild(svg);

  // Tabla fallback en <details> — accesible, datos idénticos a la barra
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
// E3 — Reparto US$4.00: 0.175 / 0.40 / 1.10 / 2.325
// Barra apilada horizontal, caficultora ínfima visible
// ─────────────────────────────────────────────────────────────────────
export function crearGraficoE3() {
  const wrap = _mk('div');
  wrap.className = 'dataviz dataviz--e3';
  wrap.setAttribute('data-dataviz', 'e3');

  const total = 4.0;
  const segmentos = [
    { id: 'caficultora', label: 'Caficultora', valor: 0.175, pct: (0.175 / total) * 100, fill: '#d99a2b', textInside: false, textColor: '#0f1410' },
    { id: 'procesamiento', label: 'Procesamiento', valor: 0.40, pct: (0.40 / total) * 100, fill: '#34c266', textInside: true, textColor: '#0f1410' },
    { id: 'tostado', label: 'Tostado y logística', valor: 1.10, pct: (1.10 / total) * 100, fill: '#d9a441', textInside: true, textColor: '#0f1410' },
    { id: 'cafeteria', label: 'Cafetería', valor: 2.325, pct: (2.325 / total) * 100, fill: '#2e3430', strokeText: '#ede9e3', textInside: true, textColor: '#ede9e3' },
  ];

  const svg = _svgEl('svg', {
    role: 'img',
    'aria-labelledby': 'dataviz-e3-title dataviz-e3-desc',
    viewBox: '0 0 1000 280',
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    height: 'auto',
  });
  const title = _svgEl('title', { id: 'dataviz-e3-title' });
  title.textContent = 'Reparto de US$4.00: la caficultora recibe US$0.175 (4.4%)';
  const desc = _svgEl('desc', { id: 'dataviz-e3-desc' });
  desc.textContent = 'Barra apilada horizontal de 0 a 4 dólares. De izquierda a derecha: caficultora 0.175 dólares (4.4%, segmento ínfimo ámbar), procesamiento 0.40 (10%), tostado y logística 1.10 (27.5%), cafetería 2.325 (58.1%, segmento mayor gris oscuro). La desproporción es el aprendizaje y se ve antes de leerse. Cada segmento lleva etiqueta de texto con valor y porcentaje; el color no es el único portador.';
  svg.appendChild(title);
  svg.appendChild(desc);

  const defs = _svgEl('defs');
  const clip = _svgEl('clipPath', { id: 'clip-e3' });
  clip.appendChild(_svgEl('rect', { x: 40, y: 70, width: 920, height: 44, rx: 8, ry: 8 }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  // fondo
  svg.appendChild(_svgEl('rect', { x: 40, y: 70, width: 920, height: 44, rx: 8, ry: 8, fill: '#1c211d', stroke: '#2e3430', 'stroke-width': 1 }));

  const g = _svgEl('g', { 'clip-path': 'url(#clip-e3)' });
  let curX = 40;
  // grosor mínimo visible para caficultora: clamp a 28px aunque el porcentaje real sea 40.25px (920*0.04375=40.25) — dejamos real para fidelidad, pero con borde y label externa se ve incluso en 320px
  segmentos.forEach((seg) => {
    const w = (920 * seg.pct) / 100;
    // segmento rect
    g.appendChild(_svgEl('rect', { x: curX, y: 70, width: w, height: 44, fill: seg.fill, stroke: '#0f1410', 'stroke-width': 1 }));
    // separador (excepto último)
    curX += w;
  });
  svg.appendChild(g);
  // separadores verticales visibles
  let sepX = 40;
  segmentos.forEach((seg, i) => {
    const w = (920 * seg.pct) / 100;
    sepX += w;
    if (i < segmentos.length - 1) {
      svg.appendChild(_svgEl('line', { x1: sepX, y1: 70, x2: sepX, y2: 114, stroke: '#0f1410', 'stroke-width': 1.5, opacity: 0.95 }));
    }
  });

  // Etiquetas — dentro si cabe, fuera con línea si es ínfimo
  let labelX = 40;
  segmentos.forEach((seg) => {
    const w = (920 * seg.pct) / 100;
    const cx = labelX + w / 2;
    const labelFull = `${seg.label} US$${seg.valor.toFixed(3).replace(/\.?0+$/, '')} · ${seg.pct.toFixed(1)}%`;
    const shortLabel = `US$${seg.valor.toFixed(2)} · ${seg.pct.toFixed(1)}%`;
    if (seg.id === 'caficultora') {
      // segmento ínfimo: etiqueta externa arriba con líder
      const lx = labelX + w / 2;
      // línea líder
      svg.appendChild(_svgEl('line', { x1: lx, y1: 70, x2: lx, y2: 38, stroke: '#d99a2b', 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
      svg.appendChild(_svgEl('circle', { cx: lx, cy: 70, r: 3, fill: '#d99a2b', stroke: '#0f1410', 'stroke-width': 1 }));
      const t1 = _svgEl('text', { x: lx, y: 28, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 11, 'font-weight': 700, fill: '#d99a2b' });
      t1.textContent = 'Caficultora';
      svg.appendChild(t1);
      const t2 = _svgEl('text', { x: lx, y: 16, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 10, fill: '#ede9e3' });
      t2.textContent = `US$0.175 · 4.4%`;
      svg.appendChild(t2);
      // mini etiqueta dentro si cabe (solo porcentaje)
      if (w > 30) {
        const tin = _svgEl('text', { x: cx, y: 96, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 8, 'font-weight': 700, fill: '#0f1410' });
        tin.textContent = '4.4%';
        svg.appendChild(tin);
      }
    } else if (seg.id === 'procesamiento') {
      const t = _svgEl('text', { x: cx, y: 92, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 10, 'font-weight': 700, fill: seg.textColor });
      t.textContent = w > 90 ? 'Procesamiento' : 'Proc.';
      svg.appendChild(t);
      const t2 = _svgEl('text', { x: cx, y: 104, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 9, fill: seg.textColor, opacity: 0.9 });
      t2.textContent = shortLabel;
      svg.appendChild(t2);
    } else if (seg.id === 'tostado') {
      const t = _svgEl('text', { x: cx, y: 92, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 10, 'font-weight': 700, fill: seg.textColor });
      t.textContent = 'Tostado y logística';
      svg.appendChild(t);
      const t2 = _svgEl('text', { x: cx, y: 104, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 9, fill: seg.textColor, opacity: 0.9 });
      t2.textContent = shortLabel;
      svg.appendChild(t2);
    } else if (seg.id === 'cafeteria') {
      const t = _svgEl('text', { x: cx, y: 92, 'text-anchor': 'middle', 'font-family': '-apple-system, sans-serif', 'font-size': 11, 'font-weight': 700, fill: seg.textColor });
      t.textContent = 'Cafetería';
      svg.appendChild(t);
      const t2 = _svgEl('text', { x: cx, y: 104, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 9, fill: '#c2beba' });
      t2.textContent = shortLabel;
      svg.appendChild(t2);
    }
    labelX += w;
    void labelFull;
  });

  // Eje 0–4 con ticks
  [0, 1, 2, 3, 4].forEach((v) => {
    const x = 40 + (920 * v) / 4;
    svg.appendChild(_svgEl('line', { x1: x, y1: 114, x2: x, y2: 122, stroke: '#6b6e6b', 'stroke-width': 1 }));
    const t = _svgEl('text', { x, y: 136, 'text-anchor': 'middle', 'font-family': 'ui-monospace, monospace', 'font-size': 10, fill: '#9a9590' });
    t.textContent = `US$${v}`;
    svg.appendChild(t);
  });
  // etiqueta eje
  const tEje = _svgEl('text', { x: 500, y: 152, 'text-anchor': 'middle', 'font-family': '-apple-system, sans-serif', 'font-size': 11, fill: '#9a9590', 'letter-spacing': '0.02em' });
  tEje.textContent = 'Reparto por US$4.00 de café (precio final)';
  svg.appendChild(tEje);

  // Anotación aprendizaje: flecha hacia el segmento ínfimo
  const note = _svgEl('text', { x: 40, y: 188, 'font-family': '-apple-system, sans-serif', 'font-size': 12, fill: '#ede9e3', 'font-style': 'italic' });
  note.textContent = 'El segmento ámbar (izquierda) es la caficultora — 4.4% del precio final.';
  svg.appendChild(note);
  const note2 = _svgEl('text', { x: 40, y: 204, 'font-family': '-apple-system, sans-serif', 'font-size': 11, fill: '#9a9590' });
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
    const x = 40 + i * 230;
    legend.appendChild(_svgEl('rect', { x, y: 228, width: 14, height: 14, rx: 3, fill: col.c, stroke: col.stroke || '#0f1410', 'stroke-width': 1 }));
    const lt = _svgEl('text', { x: x + 20, y: 239, 'font-family': '-apple-system, sans-serif', 'font-size': 11, fill: '#ede9e3' });
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
