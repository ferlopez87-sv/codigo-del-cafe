// js/contenido-render.js — extraído de js/juego.js el 2026-09-02 (editor de
// contenido del panel docente). Dueño original: cl-juego. Sin estado propio,
// sin llamada de red, sin efectos fuera del `contenedor` que recibe cada
// función — por eso es seguro importarlo tanto desde js/juego.js (pinta
// #panel-estacion para el estudiante) como desde js/docente.js (pinta la
// vista previa del editor de super-admin): es *literalmente* el mismo
// código, nunca una reconstrucción aparte que se puede desincronizar.
// Contrato: CONTRACT.md §14.4 — todo con textContent/createElement, nunca
// innerHTML con datos del servidor.

export function humanizarClave(clave) {
  const s = String(clave ?? '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Reconoce ÚNICAMENTE <b>...</b> en el texto de contenido (CONTRACT §14.4:
// nunca innerHTML con datos dinámicos) y arma <strong>/texto plano a mano —
// cualquier otro `<...>` que aparezca en el contenido queda como texto
// literal, igual que si esta función no existiera. 2026-08-28: antes
// pintarNarrativaEstacion hacía p.textContent = texto directo, así que un
// <b> ya presente en el contenido (Sala de Hechos) se veía literal
// ("&lt;b&gt;...") en vez de negrita real.
export function pintarConNegritas(contenedor, texto) {
  const partes = String(texto || '').split(/<b>(.*?)<\/b>/);
  partes.forEach((parte, i) => {
    if (!parte) return;
    if (i % 2 === 1) {
      const strong = document.createElement('strong');
      strong.textContent = parte;
      contenedor.appendChild(strong);
    } else {
      contenedor.appendChild(document.createTextNode(parte));
    }
  });
}

export function pintarValorDato(contenedorDd, valor) {
  if (Array.isArray(valor)) {
    const ul = document.createElement('ul');
    valor.forEach((item) => {
      const li = document.createElement('li');
      if (item && typeof item === 'object') li.textContent = JSON.stringify(item);
      else pintarConNegritas(li, String(item));
      ul.appendChild(li);
    });
    contenedorDd.appendChild(ul);
  } else if (valor && typeof valor === 'object') {
    const subDl = document.createElement('dl');
    Object.entries(valor).forEach(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = humanizarClave(k);
      const dd = document.createElement('dd');
      pintarValorDato(dd, v);
      subDl.appendChild(dt);
      subDl.appendChild(dd);
    });
    contenedorDd.appendChild(subDl);
  } else {
    pintarConNegritas(contenedorDd, valor == null ? '' : String(valor));
  }
}

// Cada dato del expediente se pinta como una tarjeta .exhibit (Stitch v2,
// diseño "Forensic Audit Protocol" — CSS propio en el <style> inline de
// cada página que lo usa, juego.html y docente.html; styles.css está muerto).
export function pintarDatosEstacion(contenedor, datos) {
  while (contenedor.firstChild) contenedor.removeChild(contenedor.firstChild);
  if (!datos || typeof datos !== 'object') return;
  Object.entries(datos).forEach(([clave, valor]) => {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'exhibit';
    const etiqueta = document.createElement('span');
    etiqueta.className = 'exhibit__etiqueta';
    etiqueta.textContent = humanizarClave(clave);
    const cuerpo = document.createElement('p');
    cuerpo.className = 'exhibit__valor';
    pintarValorDato(cuerpo, valor);
    tarjeta.appendChild(etiqueta);
    tarjeta.appendChild(cuerpo);
    contenedor.appendChild(tarjeta);
  });
}

export function pintarNarrativaEstacion(contenedor, texto) {
  if (!contenedor) return;
  while (contenedor.firstChild) contenedor.removeChild(contenedor.firstChild);
  const p = document.createElement('p');
  pintarConNegritas(p, texto);
  contenedor.appendChild(p);
}

// Conserva el <strong>Reto:</strong> inicial si ya existe en el contenedor
// (juego.html lo trae de fábrica); si no, lo crea — así sirve igual para un
// contenedor recién armado en la vista previa del editor.
export function pintarRetoEstacion(contenedor, texto) {
  if (!contenedor) return;
  const strongPrevio = contenedor.querySelector('strong');
  while (contenedor.firstChild) contenedor.removeChild(contenedor.firstChild);
  if (strongPrevio) {
    contenedor.appendChild(strongPrevio);
  } else {
    const s = document.createElement('strong');
    s.textContent = 'Reto:';
    contenedor.appendChild(s);
  }
  contenedor.appendChild(document.createTextNode(' ' + (texto || '')));
}
