// Prueba del validador de formato acotado (P10/T4) — sin dependencias:
//   node scripts/test-validador.mjs
// Imprime OK o FALLO por caso y sale con 1 si alguno falla.
//
// La lista de anidados prohibidos no es arbitraria: js/contenido-render.js
// asigna el interior de b/i con textContent (no lo vuelve a parsear) y
// matchea <li> con un regex no recursivo, así que todo anidado se ve literal
// en la pantalla del estudiante. El validador rechaza, nunca corrige.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validarFormatoAcotado } from '../srv/validadores/contenido.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEBEN_PASAR = [
  'texto',
  '<b>a</b> b',
  '<b>a</b><i>b</i>',
  'a<br>b',
  'a<br/>b',
  '<ul><li><b>a</b><br>b</li></ul>',
  '<i>x</i><ul><li>y</li></ul>',
];

const DEBEN_FALLAR = [
  '<b>x<ul><li>y</li></ul></b>',      // <ul> dentro de <b>
  '<ul><li>a<ul><li>b</li></ul></li></ul>', // <ul> dentro de <li>
  '<i>a<b>x</b></i>',                 // b dentro de i
  '<b>a<i>x</i></b>',                 // i dentro de b
  '<b>a<br>b</b>',                    // <br> dentro de <b> (regla previa)
  '<ul><br><li>a</li></ul>',          // <br> como hijo directo de <ul> (regla previa)
  '<B>a</B>',                         // mayúscula
  '<b class=x>a</b>',                 // atributo
  'a</br>b',                          // cierre de un tag vacío
  '<script>x</script>',               // fuera de la lista blanca
];

let fallos = 0;

for (const caso of DEBEN_PASAR) {
  if (validarFormatoAcotado(caso)) {
    console.log(`OK    acepta  ${caso}`);
  } else {
    console.log(`FALLO acepta  ${caso}`);
    fallos++;
  }
}

for (const caso of DEBEN_FALLAR) {
  if (!validarFormatoAcotado(caso)) {
    console.log(`OK    rechaza ${caso}`);
  } else {
    console.log(`FALLO rechaza ${caso}`);
    fallos++;
  }
}

// Regresión: todo el contenido real de la misión de Holcim tiene que seguir
// aceptándose. Si algo falla, NO se edita el SQL — se reporta: significa que
// el validador quedó más estricto de lo que el contenido real necesita.
const rutaSql = join(RAIZ, 'sql/07-mision-holcim.sql');
const sql = readFileSync(rutaSql, 'utf8');
const regexq = /\$q\$([\s\S]*?)\$q\$/g;
let match;
let revisados = 0;
while ((match = regexq.exec(sql)) !== null) {
  const texto = match[1];
  if (!texto.includes('<')) continue; // sin marcado, no hay nada que validar
  revisados++;
  if (validarFormatoAcotado(texto)) {
    console.log(`OK    regresión #${revisados}`);
  } else {
    console.log(`FALLO regresión #${revisados}: ${JSON.stringify(texto.slice(0, 160))}`);
    fallos++;
  }
}

console.log(`\n${DEBEN_PASAR.length + DEBEN_FALLAR.length + revisados} casos, ${fallos} fallos.`);
process.exit(fallos > 0 ? 1 : 0);
