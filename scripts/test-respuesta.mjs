// Prueba de `motivoRespuestaInvalida` (P12-B) — sin dependencias:
//   node scripts/test-respuesta.mjs
// Imprime OK o FALLO por caso y sale con 1 si alguno falla.
//
// Los nueve códigos son un contrato con Frontend EsC: no se renombran, no se
// agregan. La última comprobación de cada caso es que `validarRespuesta` siga
// diciendo exactamente lo mismo que antes de P12-B (`motivo === null`), que es
// lo único que este cambio no puede romper.

import { motivoRespuestaInvalida, validarRespuesta } from '../srv/validadores/contenido.js';

const CODIGOS = [
  'respuesta_vacia', 'id_inexistente', 'cierre_faltante', 'cierre_sobrante',
  'cierre_invalido', 'rango_invalido', 'orden_incompleto',
  'clasificacion_incompleta', 'formato',
];

// Interacciones mínimas: al validador de respuesta solo le importa `tipo`,
// `modo` y los ids, así que los `texto` son decorativos.
const conIds = (ids) => ids.map((id) => ({ id, texto: id }));
const opciones = (...ids) => conIds(ids);
const cierreDe = (...ids) => ({ enunciado: 'cierre', opciones: conIds(ids) });

const SIN_CIERRE = {
  opcion_unica: { tipo: 'opcion_unica', enunciado: '?', opciones: opciones('a', 'b') },
  con_cierre: { tipo: 'opcion_unica', enunciado: '?', opciones: opciones('a', 'b'), cierre: cierreDe('x', 'y') },
  texto: { tipo: 'respuesta_corta', enunciado: '?', modo: 'texto', placeholder: 'Ej. 6' },
  numero: { tipo: 'respuesta_corta', enunciado: '?', modo: 'numero', min: 0, max: 100, paso: 0.5 },
  orden: { tipo: 'orden', enunciado: '?', items: opciones('a', 'b', 'c') },
  checklist: { tipo: 'checklist', enunciado: '?', items: opciones('a', 'b', 'c') },
  clasificacion: {
    tipo: 'clasificacion', enunciado: '?',
    items: opciones('i1', 'i2'), categorias: opciones('x', 'y'),
  },
};

const CASOS = [
  // --- forma general -----------------------------------------------------
  ['sin objeto', null, SIN_CIERRE.opcion_unica, 'respuesta_vacia'],
  ['no es objeto', 'a', SIN_CIERRE.opcion_unica, 'respuesta_vacia'],
  ['es un array', [], SIN_CIERRE.opcion_unica, 'respuesta_vacia'],
  ['objeto vacío', {}, SIN_CIERRE.opcion_unica, 'respuesta_vacia'],
  ['interacción de tipo desconocido', { valor: 'a' }, { tipo: 'inventado' }, 'formato'],
  ['sin interacción', { valor: 'a' }, null, 'formato'],

  // --- opcion_unica ------------------------------------------------------
  ['opción válida', { valor: 'a' }, SIN_CIERRE.opcion_unica, null],
  ['opción que no existe', { valor: 'z' }, SIN_CIERRE.opcion_unica, 'id_inexistente'],
  ['opción vacía', { valor: '' }, SIN_CIERRE.opcion_unica, 'respuesta_vacia'],
  ['valor que no es texto', { valor: 5 }, SIN_CIERRE.opcion_unica, 'respuesta_vacia'],

  // --- cierre ------------------------------------------------------------
  ['cierre válido', { valor: 'a', cierre: 'x' }, SIN_CIERRE.con_cierre, null],
  ['falta el cierre que sí existe', { valor: 'a' }, SIN_CIERRE.con_cierre, 'cierre_faltante'],
  ['cierre que no es opción del cierre', { valor: 'a', cierre: 'z' }, SIN_CIERRE.con_cierre, 'cierre_invalido'],
  ['cierre en blanco', { valor: 'a', cierre: '' }, SIN_CIERRE.con_cierre, 'cierre_faltante'],
  ['cierre sobrante', { valor: 'a', cierre: 'x' }, SIN_CIERRE.opcion_unica, 'cierre_sobrante'],
  ['el cierre se revisa antes que el valor', { valor: 'z' }, SIN_CIERRE.con_cierre, 'cierre_faltante'],

  // --- respuesta_corta, modo texto ---------------------------------------
  ['texto válido', { valor: 'sí' }, SIN_CIERRE.texto, null],
  ['texto con lista de aceptadas', { valor: 'sí', acepta: ['si', 'claro'] }, SIN_CIERRE.texto, null],
  ['texto con lista vacía (todo vale)', { valor: 'sí', acepta: [] }, SIN_CIERRE.texto, null],
  ['texto vacío', { valor: '' }, SIN_CIERRE.texto, 'respuesta_vacia'],
  ['acepta que no es texto', { valor: 'sí', acepta: [1] }, SIN_CIERRE.texto, 'formato'],
  ['rango en modo texto', { valor: 'sí', min: 1 }, SIN_CIERRE.texto, 'formato'],

  // --- respuesta_corta, modo número --------------------------------------
  ['número válido', { valor: 6 }, SIN_CIERRE.numero, null],
  ['número con lista de aceptadas', { valor: 6, acepta: [6.5] }, SIN_CIERRE.numero, null],
  ['rango válido', { min: 4, max: 4.4 }, SIN_CIERRE.numero, null],
  ['valor y rango a la vez', { valor: 6, min: 4, max: 4.4 }, SIN_CIERRE.numero, 'rango_invalido'],
  ['ni valor ni rango', { acepta: [1] }, SIN_CIERRE.numero, 'rango_invalido'],
  ['min mayor que max', { min: 5, max: 4 }, SIN_CIERRE.numero, 'rango_invalido'],
  ['valor que no es número', { valor: '6' }, SIN_CIERRE.numero, 'formato'],
  ['acepta vacío con valor', { valor: 6, acepta: [] }, SIN_CIERRE.numero, 'formato'],
  ['acepta que no es número', { valor: 6, acepta: ['x'] }, SIN_CIERRE.numero, 'formato'],
  ['acepta en modo rango', { min: 4, max: 4.4, acepta: [4.2] }, SIN_CIERRE.numero, 'formato'],

  // --- orden -------------------------------------------------------------
  ['orden completo', { valor: ['a', 'b', 'c'] }, SIN_CIERRE.orden, null],
  ['orden incompleto', { valor: ['a', 'b'] }, SIN_CIERRE.orden, 'orden_incompleto'],
  ['orden vacío', { valor: [] }, SIN_CIERRE.orden, 'orden_incompleto'],
  ['orden con id repetido', { valor: ['a', 'a', 'b'] }, SIN_CIERRE.orden, 'formato'],
  ['orden con id inexistente', { valor: ['a', 'b', 'z'] }, SIN_CIERRE.orden, 'id_inexistente'],
  ['orden sin valor', {}, SIN_CIERRE.orden, 'respuesta_vacia'],
  ['orden que no es lista', { valor: 'abc' }, SIN_CIERRE.orden, 'formato'],

  // --- checklist ---------------------------------------------------------
  ['checklist válido', { valor: ['a', 'b'] }, SIN_CIERRE.checklist, null],
  ['checklist sin valor', {}, SIN_CIERRE.checklist, 'respuesta_vacia'],
  ['checklist vacío', { valor: [] }, SIN_CIERRE.checklist, 'respuesta_vacia'],
  ['checklist con id inexistente', { valor: ['a', 'z'] }, SIN_CIERRE.checklist, 'id_inexistente'],
  ['checklist con id repetido', { valor: ['a', 'a'] }, SIN_CIERRE.checklist, 'formato'],

  // --- clasificacion -----------------------------------------------------
  ['clasificación válida', { valor: { i1: 'x', i2: 'y' } }, SIN_CIERRE.clasificacion, null],
  ['clasificación sin valor', {}, SIN_CIERRE.clasificacion, 'respuesta_vacia'],
  ['clasificación con un ítem menos', { valor: { i1: 'x' } }, SIN_CIERRE.clasificacion, 'clasificacion_incompleta'],
  ['clasificación con categoría inexistente', { valor: { i1: 'x', i2: 'z' } }, SIN_CIERRE.clasificacion, 'clasificacion_incompleta'],
  ['clasificación con ítem inexistente', { valor: { i1: 'x', z: 'y' } }, SIN_CIERRE.clasificacion, 'id_inexistente'],
  ['clasificación que no es objeto', { valor: ['i1'] }, SIN_CIERRE.clasificacion, 'formato'],
];

// Regresión: las salas reales de Holcim, leídas de la base. Fixture reducido a
// los ids porque es lo único que el validador de respuesta lee; `respuesta` es
// la de verdad, sin tocar. Si esto falla, NO se edita el SQL — se reporta.
const SALAS_HOLCIM = [
  { orden: 1, tipo: 'orden', items: ['cultivo', 'cosecha', 'procesamiento', 'exportacion', 'tostado', 'venta'], cierre: ['cultivo', 'cosecha', 'procesamiento', 'exportacion', 'tostado', 'venta'], respuesta: { valor: ['cultivo', 'cosecha', 'procesamiento', 'exportacion', 'tostado', 'venta'], cierre: 'cultivo' } },
  { orden: 1, tipo: 'respuesta_corta', modo: 'numero', cierre: ['a', 'b', 'c', 'd'], respuesta: { valor: 6, cierre: 'b' } },
  { orden: 2, tipo: 'clasificacion', items: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'], categorias: ['documento', 'choca', 'sin_dato'], cierre: ['a', 'b', 'c', 'd'], respuesta: { valor: { f1: 'choca', f2: 'documento', f3: 'choca', f4: 'sin_dato', f5: 'choca', f6: 'sin_dato' }, cierre: 'c' } },
  { orden: 2, tipo: 'respuesta_corta', modo: 'numero', cierre: ['si', 'no'], respuesta: { valor: 87, acepta: [87.5], cierre: 'si' } },
  { orden: 3, tipo: 'respuesta_corta', modo: 'numero', cierre: ['a', 'b', 'c'], respuesta: { max: 4.4, min: 4, cierre: 'a' } },
  { orden: 3, tipo: 'checklist', items: ['escuchar', 'relaciones', 'explicar', 'alinear', 'terceros', 'campaña'], cierre: ['a', 'b', 'c', 'd'], respuesta: { valor: ['escuchar', 'relaciones', 'alinear', 'terceros'], cierre: 'b' } },
  { orden: 4, tipo: 'checklist', items: ['caficultora', 'hija', 'intermediario', 'exportador', 'tostadora', 'barista', 'consumidor', 'gobierno'], respuesta: { valor: ['caficultora', 'hija'] } },
  { orden: 4, tipo: 'respuesta_corta', modo: 'numero', cierre: ['a', 'b', 'c', 'd'], respuesta: { valor: 12522.7, cierre: 'a' } },
  { orden: 5, tipo: 'clasificacion', items: ['a1', 'a2', 'a3', 'a4', 'a5'], categorias: ['autenticidad', 'logica', 'empatia'], cierre: ['a', 'b', 'c', 'd'], respuesta: { valor: { a1: 'logica', a2: 'empatia', a3: 'autenticidad', a4: 'logica', a5: 'autenticidad' }, cierre: 'a' } },
  { orden: 5, tipo: 'clasificacion', items: ['f1', 'f2', 'f3', 'f4', 'f5'], categorias: ['verificable', 'enganosa', 'sin_evidencia'], respuesta: { valor: { f1: 'sin_evidencia', f2: 'enganosa', f3: 'enganosa', f4: 'sin_evidencia', f5: 'verificable' } } },
];

function interaccionDeSala(s) {
  const i = { tipo: s.tipo, enunciado: '?' };
  if (s.modo) i.modo = s.modo;
  if (s.tipo === 'opcion_unica') i.opciones = conIds(s.opciones || []);
  if (s.tipo === 'orden' || s.tipo === 'checklist') i.items = conIds(s.items || []);
  if (s.tipo === 'clasificacion') {
    i.items = conIds(s.items || []);
    i.categorias = conIds(s.categorias || []);
  }
  // Sin `cierre` en la sala significa que la interacción no lo define — que es
  // justo lo que hace que una respuesta con `cierre` sea sobrante.
  if (s.cierre && s.cierre.length) i.cierre = cierreDe(...s.cierre);
  return i;
}

let fallos = 0;

function revisar(nombre, respuesta, interaccion, esperado) {
  const motivo = motivoRespuestaInvalida(respuesta, interaccion);
  const problemas = [];
  if (motivo !== esperado) problemas.push(`esperaba ${esperado}, dio ${motivo}`);
  if (motivo !== null && !CODIGOS.includes(motivo)) problemas.push(`"${motivo}" no es un código del contrato`);
  if (validarRespuesta(respuesta, interaccion) !== (motivo === null)) {
    problemas.push('validarRespuesta no coincide con el motivo');
  }
  if (problemas.length) {
    console.log(`FALLO ${nombre} — ${problemas.join('; ')}`);
    fallos++;
  } else {
    console.log(`OK    ${nombre} → ${motivo ?? 'válida'}`);
  }
}

for (const [nombre, respuesta, interaccion, esperado] of CASOS) {
  revisar(nombre, respuesta, interaccion, esperado);
}

for (const sala of SALAS_HOLCIM) {
  revisar(`regresión sala ${sala.orden} (${sala.tipo})`, sala.respuesta, interaccionDeSala(sala), null);
}

console.log(`\n${CASOS.length + SALAS_HOLCIM.length} casos, ${fallos} fallos.`);
process.exit(fallos > 0 ? 1 : 0);
