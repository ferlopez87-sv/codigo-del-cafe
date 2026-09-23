import crypto from 'crypto';

// Código de equipo legible: 6 caracteres, mayúsculas+dígitos, sin 0/O/1/I
// (se confunden fácil al leerlo en voz alta o proyectado). No es para
// resistir fuerza bruta a gran escala — es para que un equipo de 3 personas
// lo tipee sin errores; la seguridad real de "quién puede generarlo" está en
// que solo el docente dueño del equipo puede pedirlo (RLS sobre `equipos`).
// Compartido entre srv/rutas/docente.js (POST /equipos/:id/codigo) y
// srv/rutas/equipos.js (P6, un código por equipo armado en lote) — antes
// vivía solo en docente.js; una sola función, nunca dos copias que puedan
// desincronizarse en el alfabeto o el largo.
export function generarCodigoEquipo() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alfabeto[crypto.randomInt(alfabeto.length)];
  return out;
}

// Fisher-Yates con crypto.randomInt — nunca Math.random(), mismo criterio
// que generarCodigoEquipo. Usado para barajar la nómina antes de repartir en
// equipos (P6): con Math.random() el reparto sería predecible/sesgado y,
// peor, es exactamente el tipo de bug que ya rompió una garantía documentada
// del lado del frontend el mismo día que se escribió esto.
export function barajar(lista) {
  const out = lista.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Reparto en `numEquipos` grupos lo más parejos posible: cada equipo recibe
// `base` o `base+1` integrantes (el remanente, nunca un grupo aparte de 1 o
// 2). Puro — sin DB, así se prueba con Node suelto.
export function tamañosDeGrupos(total, numEquipos) {
  const base = Math.floor(total / numEquipos);
  const remanente = total % numEquipos;
  const tamaños = [];
  for (let i = 0; i < numEquipos; i++) tamaños.push(base + (i < remanente ? 1 : 0));
  return tamaños;
}

// modo "por_tamano": floor(total/valor) equipos, con piso de 1 si alcanza
// para al menos uno pero no llena ni un grupo completo del tamaño pedido
// ("el tamaño es objetivo, no límite duro" — plan-motor-misiones.md P6).
// modo "por_cantidad": `valor` equipos directo.
export function calcularNumEquipos(total, modo, valor) {
  if (total <= 0) return 0;
  if (modo === 'por_tamano') return Math.max(1, Math.floor(total / valor));
  if (modo === 'por_cantidad') return Math.min(valor, total);
  return null;
}
