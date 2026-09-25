// Validador de `interaccion` / `respuesta` / `visual` — contrato canónico de
// plan-motor-misiones.md §1, reescrito desde cero para P4 ("Validación —
// reescribir de cero"). Reemplaza srv/rutas/docente.js:327-348, donde
// validarInteraccion terminaba en `... || true` (no rechazaba nada) y
// validarRespuesta en `return true` (idem). Módulo puro (sin DB) a propósito:
// se puede escribir y probar con Node solo, sin esperar a P0.

const TIPOS = ['opcion_unica', 'respuesta_corta', 'orden', 'checklist', 'clasificacion'];
const TIPOS_VISUAL = ['pastel', 'barras_apiladas'];
const DESBLOQUEOS = ['libre', 'secuencial', 'tras_todas'];

// Migradas tal cual desde srv/rutas/docente.js (P4 — antes de la reescritura,
// única parte del validador viejo que sí validaba de verdad). Nunca
// relajarlas: las tres formas que aceptan son exactamente las que existen en
// el contenido real (sql/05-seed.sql) — relajarlas reabre el bug del salto de
// línea que rompió esa migración.
function formaValidaDeDato(valor) {
  if (typeof valor === 'string') return true;
  if (Array.isArray(valor)) return valor.every((v) => typeof v === 'string');
  if (valor && typeof valor === 'object') return Object.values(valor).every((v) => typeof v === 'string');
  return false;
}
function validarDatos(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return false;
  return Object.values(datos).every(formaValidaDeDato);
}
function validarCodigo(codigo) {
  return typeof codigo === 'string' && codigo.trim().length >= 1 && codigo.trim().length <= 20;
}
function validarDesbloqueo(desbloqueo) {
  return DESBLOQUEOS.includes(desbloqueo);
}

function esTextoNoVacio(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function esNumero(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Requisito 3 (plan §"Validación"): ids de items/opciones/categorias únicos
// y no vacíos. `{id, texto}` es la forma común a las cuatro colecciones de §1.1.
function listaConIdsValidos(lista, minimo) {
  if (!Array.isArray(lista) || lista.length < minimo) return false;
  const ids = new Set();
  for (const el of lista) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return false;
    if (!esTextoNoVacio(el.id) || !esTextoNoVacio(el.texto)) return false;
    if (ids.has(el.id)) return false;
    ids.add(el.id);
  }
  return true;
}

function idsDe(lista) {
  return new Set((lista || []).map((el) => el.id));
}

// `cierre` es válido en cualquier tipo (§1.1): opción única embebida debajo
// del mecanismo principal.
function validarCierre(cierre) {
  if (cierre === undefined) return true;
  if (!cierre || typeof cierre !== 'object' || Array.isArray(cierre)) return false;
  if (!esTextoNoVacio(cierre.enunciado)) return false;
  return listaConIdsValidos(cierre.opciones, 2);
}

// Requisitos 1-3: forma de `estaciones.interaccion` por tipo (§1.1).
function validarInteraccion(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (!TIPOS.includes(obj.tipo)) return false;
  if (!esTextoNoVacio(obj.enunciado)) return false;
  if (!validarCierre(obj.cierre)) return false;

  if (obj.tipo === 'opcion_unica') {
    return listaConIdsValidos(obj.opciones, 2);
  }
  if (obj.tipo === 'respuesta_corta') {
    if (obj.modo !== 'texto' && obj.modo !== 'numero') return false;
    if (obj.placeholder !== undefined && typeof obj.placeholder !== 'string') return false;
    if (obj.modo === 'numero') {
      for (const campo of ['min', 'max', 'paso']) {
        if (obj[campo] !== undefined && !esNumero(obj[campo])) return false;
      }
      if (obj.sufijo !== undefined && typeof obj.sufijo !== 'string') return false;
    }
    return true;
  }
  if (obj.tipo === 'orden') {
    if (obj.barajar !== undefined && typeof obj.barajar !== 'boolean') return false;
    return listaConIdsValidos(obj.items, 2);
  }
  if (obj.tipo === 'checklist') {
    return listaConIdsValidos(obj.items, 2);
  }
  if (obj.tipo === 'clasificacion') {
    return listaConIdsValidos(obj.categorias, 2) && listaConIdsValidos(obj.items, 2);
  }
  return false;
}

// Requisitos 4-7: forma de `estaciones.respuesta` (§1.2) más integridad
// referencial (todo id en `valor`/`cierre` existe en `interaccion`) y
// completitud, ambas cruzadas contra la `interaccion` de la misma sala.
function validarRespuesta(obj, interaccion) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (Object.keys(obj).length === 0) return false;
  if (!interaccion || !TIPOS.includes(interaccion.tipo)) return false;

  // Req. 4, mitad `cierre`: si la interaccion no define cierre, la respuesta
  // tampoco debe traer uno — no hay contra qué validarlo referencialmente.
  if (interaccion.cierre === undefined) {
    if (obj.cierre !== undefined) return false;
  } else {
    if (!esTextoNoVacio(obj.cierre)) return false;
    if (!idsDe(interaccion.cierre.opciones).has(obj.cierre)) return false;
  }

  const tipo = interaccion.tipo;

  if (tipo === 'opcion_unica') {
    if (!esTextoNoVacio(obj.valor)) return false;
    return idsDe(interaccion.opciones).has(obj.valor); // req. 4
  }

  if (tipo === 'respuesta_corta') {
    if (interaccion.modo === 'texto') {
      if (!esTextoNoVacio(obj.valor)) return false;
      if (obj.acepta !== undefined && (!Array.isArray(obj.acepta) || !obj.acepta.every(esTextoNoVacio))) return false;
      if (obj.min !== undefined || obj.max !== undefined) return false; // rango: solo modo numero
      return true;
    }
    // modo numero — req. 7: valor(+acepta) XOR min/max, nunca ambos ni ninguno.
    const tieneValor = obj.valor !== undefined;
    const tieneRango = obj.min !== undefined || obj.max !== undefined;
    if (tieneValor === tieneRango) return false;
    if (tieneValor) {
      if (!esNumero(obj.valor)) return false;
      if (obj.acepta !== undefined && (!Array.isArray(obj.acepta) || obj.acepta.length === 0 || !obj.acepta.every(esNumero))) return false;
      return true;
    }
    if (!esNumero(obj.min) || !esNumero(obj.max) || obj.min > obj.max) return false;
    if (obj.acepta !== undefined) return false;
    return true;
  }

  if (tipo === 'orden') {
    // Req. 5: `valor` es permutación completa de los ids de `items`.
    if (!Array.isArray(obj.valor)) return false;
    const idsItems = idsDe(interaccion.items);
    if (obj.valor.length !== idsItems.size) return false;
    const vistos = new Set();
    for (const id of obj.valor) {
      if (!idsItems.has(id) || vistos.has(id)) return false;
      vistos.add(id);
    }
    return true;
  }

  if (tipo === 'checklist') {
    // Req. 4: cada id de `valor` existe en `items`; ids únicos, al menos uno.
    if (!Array.isArray(obj.valor) || obj.valor.length === 0) return false;
    const idsItems = idsDe(interaccion.items);
    const vistos = new Set();
    for (const id of obj.valor) {
      if (!idsItems.has(id) || vistos.has(id)) return false;
      vistos.add(id);
    }
    return true;
  }

  if (tipo === 'clasificacion') {
    // Req. 6: una entrada por ítem, cada valor es un id de categoría válido.
    if (!obj.valor || typeof obj.valor !== 'object' || Array.isArray(obj.valor)) return false;
    const idsItems = idsDe(interaccion.items);
    const idsCategorias = idsDe(interaccion.categorias);
    const claves = Object.keys(obj.valor);
    if (claves.length !== idsItems.size) return false;
    for (const itemId of claves) {
      if (!idsItems.has(itemId)) return false;
      if (!idsCategorias.has(obj.valor[itemId])) return false; // req. 4
    }
    return true;
  }

  return false;
}

// Requisito 8: `estaciones.visual` (§1.6). `null`/`undefined` ⇒ sin gráfico,
// forma válida.
function validarVisual(visual) {
  if (visual === null || visual === undefined) return true;
  if (typeof visual !== 'object' || Array.isArray(visual)) return false;
  if (!TIPOS_VISUAL.includes(visual.tipo)) return false;
  if (!esTextoNoVacio(visual.titulo)) return false;
  if (visual.unidad !== undefined && typeof visual.unidad !== 'string') return false;
  if (visual.pie !== undefined && typeof visual.pie !== 'string') return false;
  if (!Array.isArray(visual.series) || visual.series.length === 0) return false;
  for (const serie of visual.series) {
    if (!serie || typeof serie !== 'object' || Array.isArray(serie)) return false;
    if (!esTextoNoVacio(serie.etiqueta)) return false;
    if (!esNumero(serie.valor)) return false;
    if (serie.nota !== undefined && typeof serie.nota !== 'string') return false;
  }
  return true;
}

// P5b (plan-motor-misiones.md, "WYSIWYG acotado") — lista blanca de formato
// para `narrativa`, `reto`, `pistas[]` y `feedback_ok`. El cliente sanitiza
// al pegar por usabilidad; esto es la capa que de verdad importa, porque un
// PUT directo por API salta esa capa entera — mismo criterio que el resto
// del sistema (defensa en profundidad, RLS no es la única capa tampoco).
//
// Solo cuatro formatos, cinco tags: negrita, cursiva, lista con viñetas y
// salto de línea. Sin atributos en ninguno — ni siquiera `class`: el estilo
// vive en el CSS de la página, nunca en el contenido. `js/contenido-render.js`
// (el mismo parser que pinta la pantalla del estudiante y la vista previa del
// editor) solo reconoce estos tags; cualquier otro que hoy no se rechace se
// vería literal como texto, así que rechazarlo acá es lo que evita que el
// docente guarde una sala que después se ve rota.
const TAGS_FORMATO_ACOTADO = ['b', 'i', 'ul', 'li', 'br'];

// 2026-09-25 (pedido de Fernando): sin `<br>`, la única forma de separar
// visualmente dos ideas dentro de un mismo campo era volverlas <li> de una
// lista — un salto de línea real no existía. `<br>` es la excepción a "todo
// tag abierto tiene su cierre": es un elemento vacío (nunca tiene contenido
// ni cierre propio), igual que en HTML real.
const TAGS_VACIOS = ['br'];

// QA adversarial (2026-09-23, Back EsC) encontró dos huecos: el renderizador
// del estudiante (js/contenido-render.js) es case-sensitive y no tolera que
// un tag se reabra dentro de sí mismo, pero este validador no exigía
// ninguna de las dos cosas — contenido que pasaba el PUT se veía literal y
// roto en pantalla. Criterio de la coordinadora: el validador se aprieta,
// el renderizador no se toca (un editor real, vía DOM, siempre serializa en
// minúscula sin autoanidar; mayúscula o autoanidado solo llegan por un PUT
// directo o un pegado raro — justo lo que esta lista blanca existe para
// frenar). Rechazar, nunca normalizar: un validador no debe mutar lo que
// valida.
function validarFormatoAcotado(texto) {
  if (typeof texto !== 'string') return false;
  // Comentarios (`<!--`), doctype/CDATA (`<!`) y directivas de proceso
  // (`<?`) no empiezan con una letra, así que el regex de tags de abajo los
  // ignora en vez de rechazarlos — quedaban colados. No son un tag en el
  // sentido léxico, pero siguen siendo marcado fuera de la lista blanca.
  if (/<[!?]/.test(texto)) return false;
  const pila = [];
  const regexTag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let match;
  let cursor = 0;
  while ((match = regexTag.exec(texto)) !== null) {
    // Texto suelto directamente dentro de un <ul> (fuera de cualquier <li>)
    // no es una lista válida — <ul> solo debe contener <li>.
    if (pila[pila.length - 1] === 'ul' && texto.slice(cursor, match.index).trim().length > 0) return false;
    cursor = match.index + match[0].length;

    const [, esCierre, nombreCrudo, resto] = match;
    // Minúscula exacta, sin normalizar: <B>/<Ul> quedan fuera de la lista
    // blanca (que es toda minúscula) en vez de colarse como si fueran <b>/<ul>.
    const tag = nombreCrudo;
    if (!TAGS_FORMATO_ACOTADO.includes(tag)) return false; // <script>, <div>, <B>, etc.
    const autoCierre = /\/\s*$/.test(resto);
    const atributos = resto.replace(/\/\s*$/, '').trim();
    if (atributos.length > 0) return false; // sin onerror=, style=, class=, nada
    if (TAGS_VACIOS.includes(tag)) {
      if (esCierre) return false; // "</br>" no existe: <br> nunca se cierra
      // js/contenido-render.js reconoce <b>/<i> con un regex de un solo nivel
      // (`el.textContent = grupoCapturado`, sin volver a parsear ese interior):
      // un <br> adentro de <b>/<i> se guardaría bien pero se vería literal
      // ("<br>" como texto) en pantalla. Mismo motivo por el que <ul> tampoco
      // anida ahí. <ul> solo contiene <li> — ni siquiera un <br> suelto.
      if (pila.includes('b') || pila.includes('i')) return false;
      if (pila[pila.length - 1] === 'ul') return false;
      // <br> y <br/> son equivalentes acá — nunca va a la pila: no espera
      // cierre ni puede contener nada.
      continue;
    }
    if (esCierre) {
      if (autoCierre) return false; // "</b/>" no es una forma válida
      if (pila.length === 0 || pila[pila.length - 1] !== tag) return false; // desbalanceado o mal anidado
      pila.pop();
    } else {
      if (autoCierre) return false; // ninguno de estos 4 tags se auto-cierra en este formato
      if (tag === 'li' && pila[pila.length - 1] !== 'ul') return false; // <li> solo dentro de <ul>
      if ((tag === 'b' || tag === 'i') && pila.includes(tag)) return false; // sin reabrir el mismo formato adentro de sí mismo
      pila.push(tag);
    }
  }
  if (pila[pila.length - 1] === 'ul' && texto.slice(cursor).trim().length > 0) return false;
  return pila.length === 0; // todo tag abierto tiene su cierre
}

export {
  validarInteraccion, validarRespuesta, validarVisual,
  formaValidaDeDato, validarDatos, validarCodigo, validarDesbloqueo,
  validarFormatoAcotado, TAGS_FORMATO_ACOTADO,
  TIPOS, TIPOS_VISUAL, DESBLOQUEOS,
};
