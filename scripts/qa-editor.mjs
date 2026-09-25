// Smoke test del editor WYSIWYG del brief — Tarea 2.b de AGENTS.md.
// Reproduce los bugs ya corregidos para que no vuelvan.
//
// REQUISITOS (el script no los crea):
//   1. Postgres + app locales, levantados con:
//      BOOTSTRAP_DOCENTE_CODIGO=123456 BOOTSTRAP_DOCENTE_CORREO=fglopez@monicaherrera.edu.sv \
//        docker compose up -d --build
//      (el bootstrap siembra el código personal que usa el login de abajo)
//   2. Playwright, que NO está en package.json a propósito — el Dockerfile de
//      Render hace `npm install` y no debe arrastrarlo:
//      npm i --no-save playwright && npx playwright install chromium
//   3. BASE_URL como variable de entorno (default http://localhost:3000).
//
// Corre:  node scripts/qa-editor.mjs
// Deja la base como la encontró: el brief original se restaura en un finally.

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CORREO = 'fglopez@monicaherrera.edu.sv';
const CODIGO = '123456';
const EDITOR = '#mision-brief-contenido-editor [contenteditable]';
const BARRA = '#mision-brief-contenido-editor button';

let fallos = 0;
function check(nombre, ok, detalle = '') {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${nombre}${!ok && detalle ? ` — ${detalle}` : ''}`);
}

// ¿Hay un <br> dentro de un <b>...</b>? El renderizador asigna el interior de
// b/i con textContent, así que ese <br> se vería literal en pantalla.
const brDentroDeNegrita = (txt) => /<b>(?:(?!<\/b>)[\s\S])*?<br/.test(txt);

const navegador = await chromium.launch();
const contexto = await navegador.newContext();
const page = await contexto.newPage();

// El CSS de Tailwind viene por CDN: sin internet no carga y el navegador
// tira "tailwind is not defined". No es un fallo del editor. El 401 que
// aparece en la consola antes del login es normal y no es pageerror.
const errores = [];
page.on('pageerror', (e) => {
  const m = String(e.message ?? e);
  if (!/tailwind/i.test(m)) errores.push(m);
});

let original = null;

try {
  // --- Login del docente -------------------------------------------------
  await page.goto(`${BASE_URL}/docente.html`, { waitUntil: 'domcontentloaded' });
  const login = await page.evaluate(async ({ correo, codigo }) => {
    const r = await fetch('/api/auth/verificar', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, codigo }),
    });
    return { status: r.status, cuerpo: await r.text() };
  }, { correo: CORREO, codigo: CODIGO });
  check('login del docente', login.status === 200, `HTTP ${login.status} ${login.cuerpo.slice(0, 160)}`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sec-contenido:not([hidden])', { timeout: 20000 });

  // --- Abrir la misión de Holcim ----------------------------------------
  const tarjeta = page.locator('#lista-misiones > div')
    .filter({ has: page.locator('h3', { hasText: 'Expediente Holcim' }) });
  check('la misión de Holcim está en la biblioteca', await tarjeta.count() === 1);
  await tarjeta.locator('button').first().click();
  await page.waitForSelector('#contenido-vista-mision:not([hidden])', { timeout: 20000 });
  await page.waitForSelector(EDITOR, { timeout: 20000 });

  // Guardar el brief original ANTES de tocar nada (se restaura al final).
  const misiones = await page.evaluate(async () =>
    (await fetch('/api/docente/contenido/misiones', { credentials: 'include' })).json());
  original = Array.isArray(misiones) ? misiones.find((m) => String(m.titulo || '').includes('Expediente Holcim')) : null;
  check('brief original leído por la API', !!original);

  const editor = page.locator(EDITOR);
  const html = () => editor.evaluate((el) => el.innerHTML);
  // El brief de Holcim es una <ul> de 14 ítems, así que todos los casos
  // arrancan borrando una lista. Chrome no siempre se lleva la estructura:
  // al borrar una selección que cubre la lista entera deja el <ul><li></li>
  // vacío. Se repite el borrado hasta que no queden hijos, con tope para no
  // quedar colgado si algún caso no lo logra.
  const limpiar = async () => {
    await editor.click();
    for (let intento = 0; intento < 3; intento++) {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
      if (await editor.evaluate((el) => el.children.length === 0)) return;
    }
  };
  const boton = (re) => page.locator(BARRA).filter({ hasText: re });
  const repetir = async (tecla, veces) => {
    for (let i = 0; i < veces; i++) await page.keyboard.press(tecla);
  };
  // En macOS Home/End llegan como Fn+←/→ y Chromium los trata como scroll del
  // documento, no como edición: el cursor no se mueve. Se usan flechas.
  const irAlFinalDeLinea = () => repetir('ArrowRight', 30);

  // --- Caso 1: vaciar y tipear limpio ------------------------------------
  await limpiar();
  await page.keyboard.type('limpio');
  check('1 · vaciar y tipear no deja <b>/<ul> residuales', await html() === 'limpio', await html());

  // --- Caso 2: Enter fuera de lista produce <br>, nunca <div> -----------
  await limpiar();
  await page.keyboard.type('a');
  await page.keyboard.press('Enter');
  await page.keyboard.type('b');
  const h2 = await html();
  check('2 · Enter da <br> y no <div>', h2.includes('<br>') && !h2.includes('<div'), h2);

  // --- Caso 3: el botón "↵ Salto" corta la línea -------------------------
  await limpiar();
  await page.keyboard.type('uno');
  await boton(/^↵ Salto$/).click();
  await page.keyboard.type('dos');
  const h3 = await html();
  check('3 · botón Salto da "uno<br>dos"', h3 === 'uno<br>dos', h3);

  // --- Caso 4: "• Lista" sobre la línea seleccionada ---------------------
  // Ctrl+A selecciona la línea entera porque el editor quedó vacío antes; el
  // botón envuelve lo seleccionado en <ul><li>. execCommand deja el cursor al
  // principio del ítem, así que hay que llevarlo al final antes de Enter.
  await limpiar();
  await page.keyboard.type('item uno');
  await page.keyboard.press('ControlOrMeta+a');
  await boton(/^• Lista$/).click();
  await irAlFinalDeLinea();
  await page.keyboard.press('Enter');
  await page.keyboard.type('item dos');
  const h4 = await html();
  check('4 · Lista arma <ul><li>…</li><li>…</li></ul>',
    h4 === '<ul><li>item uno</li><li>item dos</li></ul>', h4);

  // --- Caso 5: negrita que cruza un salto se guarda sin <br> adentro -----
  // Es el caso que arregló T3: el editor tiene que partir la negrita en cada
  // <br> porque el servidor la rechaza.
  await limpiar();
  await page.keyboard.type('uno');
  await boton(/^↵ Salto$/).click();
  await page.keyboard.type('dos');
  await page.keyboard.press('ControlOrMeta+a');
  await boton(/^B$/).click();
  // El id de misión es un UUID: el path termina en un valor alfanumérico, no
  // en dígitos.
  const put = page.waitForResponse((r) =>
    r.request().method() === 'PUT' && /\/api\/docente\/contenido\/misiones\/[^/?]+/.test(r.url()));
  await page.locator('#btn-guardar-mision').click();
  const res = await put;
  check('5 · guardar misión responde 200', res.status() === 200, `HTTP ${res.status()}`);
  let guardado = null;
  try { guardado = await res.json(); } catch { /* si no es JSON, se relee por API */ }
  if (!guardado || typeof guardado.brief_contenido !== 'string') {
    const tras = await page.evaluate(async () =>
      (await fetch('/api/docente/contenido/misiones', { credentials: 'include' })).json());
    guardado = (Array.isArray(tras) ? tras : []).find((m) => m.id === original.id);
  }
  const brief = guardado?.brief_contenido ?? '';
  check('5 · el brief guardado no tiene <br> dentro de <b>', !brDentroDeNegrita(brief), brief);

  // --- Caso 6: el renderizador del estudiante ----------------------------
  const pintado = await page.evaluate(async (h) => {
    const m = await import('/js/contenido-render.js');
    const d = document.createElement('div');
    m.pintarConNegritas(d, h);
    return d.innerHTML;
  }, '<b>T</b><br>c<ul><li>x</li></ul>');
  check('6 · pintarConNegritas usa <br> real y no escapa &lt;',
    pintado.includes('<br>') && !pintado.includes('&lt;'), pintado);

} catch (e) {
  // Que un paso truene no puede saltear la restauración del brief.
  fallos++;
  console.log(`FALLO excepción inesperada — ${String(e.message ?? e).split('\n')[0]}`);
} finally {
  // --- Restaurar el brief original (siempre) -----------------------------
  if (original) {
    const restaurado = await page.evaluate(async (m) => {
      const r = await fetch(`/api/docente/contenido/misiones/${m.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: m.slug, titulo: m.titulo, subtitulo: m.subtitulo, intro: m.intro,
          veredicto: m.veredicto, codigo_maestro: m.codigo_maestro,
          brief_titulo: m.brief_titulo, brief_contenido: m.brief_contenido,
        }),
      });
      return r.status;
    }, original).catch((e) => `error: ${e.message}`);
    check('7 · brief original restaurado', restaurado === 200, `HTTP ${restaurado}`);
  }
  await navegador.close();
}

if (errores.length) {
  console.log(`\nErrores de página inesperados: ${errores.length}`);
  for (const e of errores.slice(0, 5)) console.log(`  ${e}`);
  fallos += errores.length;
}

console.log(`\n${fallos === 0 ? 'Todo en verde' : `${fallos} fallos`}.`);
process.exit(fallos > 0 ? 1 : 0);
