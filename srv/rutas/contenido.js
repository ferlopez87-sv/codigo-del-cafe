// API de contenido — biblioteca de misiones y sus salas (P4,
// plan-motor-misiones.md). Reemplaza el editor de 5 salas fijas que vivía en
// srv/rutas/docente.js (GET/PUT /estaciones + validadores muertos). Montado
// en /api/docente/contenido — todas las rutas detrás de super-admin, defensa
// en profundidad además de RLS (misiones/estaciones son "for all" solo para
// es_super_admin(), que a su vez lee app.usuario_actual(): eso SOLO funciona
// dentro de conSesion(), nunca con el pool crudo — nunca usar `pool` acá).
import { Router } from 'express';
import crypto from 'crypto';
import { conSesion } from '../db.js';
import {
  validarInteraccion, validarRespuesta, validarVisual,
  validarDatos, validarCodigo, validarDesbloqueo, validarFormatoAcotado,
} from '../validadores/contenido.js';

const router = Router();

function esSuperAdmin(perfil) {
  return String(perfil?.correo || '').trim().toLowerCase() === 'fglopez@monicaherrera.edu.sv';
}

// Devuelve true si puede seguir; si no, ya mandó la respuesta 401/403.
function exigirSuperAdmin(req, res) {
  if (!req.perfil) { res.status(401).json({ error: 'no_autorizado' }); return false; }
  if (!esSuperAdmin(req.perfil)) { res.status(403).json({ error: 'no_autorizado' }); return false; }
  return true;
}

// Body completo de una estación (POST y PUT usan la misma forma — nunca hay
// actualización parcial, mismo criterio que el editor viejo). Devuelve el
// nombre del primer campo inválido, o null si todo pasa. La base no se toca
// hasta que esto devuelve null.
// `codigo_maestro` NULL es el caso normal (composición automática), no la
// excepción — pero un editor que muestre la columna cruda le deja al docente
// un campo vacío justo en el caso normal, sin forma de saber qué código va a
// pedir el juego al final. `codigo_maestro_efectivo` es ese cálculo, hecho
// en el servidor con el MISMO criterio que verificar_maestro() (order by
// orden) — nunca en el cliente: Frontend ya encontró el bug de dos
// implementaciones desincronizadas (pintarFragmentos() ordenaba por `id`)
// que esto evita repetir. `codigo_maestro` viaja aparte, sin tocar, para que
// el editor sepa si es override manual o composición automática.
const SELECT_MISIONES_CON_MAESTRO = `
  SELECT m.*,
         (SELECT count(*) FROM estaciones e WHERE e.mision_id = m.id)::int AS salas,
         COALESCE(m.codigo_maestro, (SELECT string_agg(e.codigo, '-' ORDER BY e.orden) FROM estaciones e WHERE e.mision_id = m.id)) AS codigo_maestro_efectivo
  FROM misiones m`;

async function misionConMaestro(c, id) {
  const q = await c.query(`${SELECT_MISIONES_CON_MAESTRO} WHERE m.id=$1`, [id]);
  return q.rows[0] || null;
}

function campoInvalidoDeEstacion(b) {
  for (const campo of ['titulo', 'pilar', 'narrativa', 'reto', 'feedback_ok']) {
    if (typeof b[campo] !== 'string' || !b[campo].trim()) return campo;
  }
  if (!Array.isArray(b.pistas) || !b.pistas.every((p) => typeof p === 'string' && p.trim())) return 'pistas';
  // P5b: lista blanca de formato (solo b/i/ul/li, sin atributos) en los
  // cuatro campos de texto libre — no en titulo/pilar, que no la usan.
  for (const campo of ['narrativa', 'reto', 'feedback_ok']) {
    if (!validarFormatoAcotado(b[campo])) return campo;
  }
  if (!b.pistas.every(validarFormatoAcotado)) return 'pistas';
  if (!validarDatos(b.datos)) return 'datos';
  if (!validarInteraccion(b.interaccion)) return 'interaccion';
  if (!validarCodigo(b.codigo)) return 'codigo';
  if (!validarRespuesta(b.respuesta, b.interaccion)) return 'respuesta';
  if (!validarDesbloqueo(b.desbloqueo)) return 'desbloqueo';
  if (b.icono !== undefined && b.icono !== null && typeof b.icono !== 'string') return 'icono';
  if (!validarVisual(b.visual === undefined ? null : b.visual)) return 'visual';
  return null;
}

// -----------------------------------------------------------------------------
// Misiones
// -----------------------------------------------------------------------------

router.get('/misiones', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  try {
    const rows = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query(`${SELECT_MISIONES_CON_MAESTRO} ORDER BY m.creada_en DESC`);
      return q.rows;
    });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

router.post('/misiones', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  const b = req.body || {};
  for (const campo of ['slug', 'titulo', 'veredicto']) {
    if (typeof b[campo] !== 'string' || !b[campo].trim()) return res.status(400).json({ error: 'dato_invalido', campo });
  }
  for (const campo of ['subtitulo', 'intro', 'codigo_maestro']) {
    if (b[campo] !== undefined && b[campo] !== null && typeof b[campo] !== 'string') return res.status(400).json({ error: 'dato_invalido', campo });
  }
  try {
    const row = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query(
        `INSERT INTO misiones (slug, titulo, subtitulo, intro, codigo_maestro, veredicto, estado, autor_id)
         VALUES ($1,$2,$3,$4,$5,$6,'borrador',$7) RETURNING id`,
        [b.slug.trim(), b.titulo.trim(), b.subtitulo?.trim() || null, b.intro?.trim() || null,
          b.codigo_maestro?.trim() || null, b.veredicto.trim(), req.perfil.id]);
      return misionConMaestro(c, q.rows[0].id);
    });
    res.json(row);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'dato_invalido', campo: 'slug' });
    console.error(e); res.status(500).json({ error: 'error_interno' });
  }
});

router.put('/misiones/:id', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  const b = req.body || {};
  for (const campo of ['slug', 'titulo', 'veredicto']) {
    if (typeof b[campo] !== 'string' || !b[campo].trim()) return res.status(400).json({ error: 'dato_invalido', campo });
  }
  for (const campo of ['subtitulo', 'intro', 'codigo_maestro']) {
    if (b[campo] !== undefined && b[campo] !== null && typeof b[campo] !== 'string') return res.status(400).json({ error: 'dato_invalido', campo });
  }
  if (b.estado !== undefined && !['borrador', 'publicada', 'archivada'].includes(b.estado)) {
    return res.status(400).json({ error: 'dato_invalido', campo: 'estado' });
  }
  try {
    const row = await conSesion(req.perfil.id, async (c) => {
      const sets = ['slug=$1', 'titulo=$2', 'subtitulo=$3', 'intro=$4', 'codigo_maestro=$5', 'veredicto=$6'];
      const vals = [b.slug.trim(), b.titulo.trim(), b.subtitulo?.trim() || null, b.intro?.trim() || null,
        b.codigo_maestro?.trim() || null, b.veredicto.trim()];
      let idx = 7;
      if (b.estado !== undefined) { sets.push(`estado=$${idx}`); vals.push(b.estado); idx++; }
      vals.push(req.params.id);
      const q = await c.query(`UPDATE misiones SET ${sets.join(', ')} WHERE id=$${idx} RETURNING id`, vals);
      if (!q.rows.length) return null;
      return misionConMaestro(c, q.rows[0].id);
    });
    if (!row) return res.status(404).json({ error: 'no_encontrada' });
    res.json(row);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'dato_invalido', campo: 'slug' });
    console.error(e); res.status(500).json({ error: 'error_interno' });
  }
});

// DELETE — `estaciones` cascadea desde `misiones` (on delete cascade); una
// misión en uso por alguna sesión no se puede borrar (FK sin cascade en
// sesiones.mision_id, a propósito: no hay partida real que quede sin misión).
router.delete('/misiones/:id', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  try {
    const borrada = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query('DELETE FROM misiones WHERE id=$1 RETURNING id', [req.params.id]);
      return q.rowCount > 0;
    });
    if (!borrada) return res.status(404).json({ error: 'no_encontrada' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') return res.status(400).json({ error: 'mision_en_uso' });
    console.error(e); res.status(500).json({ error: 'error_interno' });
  }
});

// POST /misiones/:id/duplicar — misión + salas en UNA transacción
// (conSesion ya envuelve todo el callback en BEGIN…COMMIT: si el insert de
// salas falla, el insert de la misión también se revierte — nunca queda una
// copia a medias en la biblioteca).
router.post('/misiones/:id/duplicar', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  try {
    const nueva = await conSesion(req.perfil.id, async (c) => {
      const orig = await c.query('SELECT * FROM misiones WHERE id=$1', [req.params.id]);
      if (!orig.rows.length) return null;
      const m = orig.rows[0];
      const slugNuevo = `${m.slug}-copia-${crypto.randomBytes(3).toString('hex')}`;
      const ins = await c.query(
        `INSERT INTO misiones (slug, titulo, subtitulo, intro, codigo_maestro, veredicto, estado, autor_id)
         VALUES ($1,$2,$3,$4,$5,$6,'borrador',$7) RETURNING *`,
        [slugNuevo, m.titulo, m.subtitulo, m.intro, m.codigo_maestro, m.veredicto, req.perfil.id]);
      const misionNueva = ins.rows[0];

      const salas = await c.query('SELECT * FROM estaciones WHERE mision_id=$1 ORDER BY orden', [req.params.id]);
      for (const s of salas.rows) {
        await c.query(
          `INSERT INTO estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [misionNueva.id, s.orden, s.titulo, s.pilar, s.narrativa, JSON.stringify(s.datos), s.reto,
            JSON.stringify(s.interaccion), JSON.stringify(s.pistas), s.feedback_ok, s.codigo,
            JSON.stringify(s.respuesta), s.desbloqueo, s.icono, s.visual === null ? null : JSON.stringify(s.visual)]);
      }
      return misionConMaestro(c, misionNueva.id);
    });
    if (!nueva) return res.status(404).json({ error: 'no_encontrada' });
    res.json(nueva);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

router.post('/misiones/:id/publicar', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  try {
    const row = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query("UPDATE misiones SET estado='publicada' WHERE id=$1 RETURNING id", [req.params.id]);
      if (!q.rows.length) return null;
      return misionConMaestro(c, q.rows[0].id);
    });
    if (!row) return res.status(404).json({ error: 'no_encontrada' });
    res.json(row);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

// -----------------------------------------------------------------------------
// Salas de una misión
// -----------------------------------------------------------------------------

// GET — trae TODO (incluidas pistas/feedback_ok/respuesta, que
// estaciones_publicas oculta a estudiantes) para poblar el editor.
router.get('/misiones/:id/estaciones', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  try {
    const rows = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query('SELECT * FROM estaciones WHERE mision_id=$1 ORDER BY orden', [req.params.id]);
      return q.rows;
    });
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

// POST — crea una sala al final de la misión. `orden` lo asigna el servidor
// (MAX(orden)+1 dentro de la misma transacción de conSesion), nunca lo manda
// el cliente: así no puede chocar con el `unique(mision_id, orden)` ni dejar
// huecos. Reordenar es cosa de POST /reordenar, no de este endpoint.
router.post('/misiones/:id/estaciones', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  const b = req.body || {};
  const campo = campoInvalidoDeEstacion(b);
  if (campo) return res.status(400).json({ error: 'dato_invalido', campo });
  try {
    const row = await conSesion(req.perfil.id, async (c) => {
      const mision = await c.query('SELECT id FROM misiones WHERE id=$1', [req.params.id]);
      if (!mision.rows.length) return null;
      const siguiente = await c.query('SELECT COALESCE(MAX(orden),0)+1 AS n FROM estaciones WHERE mision_id=$1', [req.params.id]);
      const orden = siguiente.rows[0].n;
      const q = await c.query(
        `INSERT INTO estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [req.params.id, orden, b.titulo.trim(), b.pilar.trim(), b.narrativa.trim(), JSON.stringify(b.datos),
          b.reto.trim(), JSON.stringify(b.interaccion), JSON.stringify(b.pistas), b.feedback_ok.trim(),
          b.codigo.trim(), JSON.stringify(b.respuesta), b.desbloqueo, b.icono || null,
          b.visual ? JSON.stringify(b.visual) : null]);
      return q.rows[0];
    });
    if (!row) return res.status(404).json({ error: 'mision_no_encontrada' });
    res.json(row);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

// POST /misiones/:id/reordenar — body { orden: [id1, id2, ...] }, la nueva
// posición es el índice+1. Exige permutación completa de los ids actuales de
// la misión (ni de menos ni de más, sin repetidos).
//
// La trampa real: `unique(mision_id, orden)` no es diferible (índice simple,
// sql/01-esquema.sql), así que reescribir `orden` fila por fila choca a mitad
// de camino aunque el estado final sea válido — pasa los tests con 2 salas y
// explota con 5, porque el orden de aplicación de las filas no está
// garantizado. Solución: desplazar todo a un rango disjunto primero
// (+100000), y recién ahí escribir los valores finales — dos UPDATE, nunca
// puede haber colisión entre ellos.
router.post('/misiones/:id/reordenar', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  const orden = req.body?.orden;
  if (!Array.isArray(orden) || orden.length === 0 || !orden.every((id) => typeof id === 'number' || typeof id === 'string')) {
    return res.status(400).json({ error: 'dato_invalido', campo: 'orden' });
  }
  const idsPedidos = orden.map((id) => String(id));
  if (new Set(idsPedidos).size !== idsPedidos.length) return res.status(400).json({ error: 'dato_invalido', campo: 'orden' });

  try {
    const resultado = await conSesion(req.perfil.id, async (c) => {
      const actuales = await c.query('SELECT id FROM estaciones WHERE mision_id=$1', [req.params.id]);
      const idsActuales = new Set(actuales.rows.map((r) => String(r.id)));
      if (idsActuales.size === 0) return 'mision_no_encontrada';
      if (idsActuales.size !== idsPedidos.length || !idsPedidos.every((id) => idsActuales.has(id))) {
        return 'orden_incompleto';
      }

      await c.query('UPDATE estaciones SET orden = orden + 100000 WHERE mision_id=$1', [req.params.id]);
      for (let i = 0; i < idsPedidos.length; i++) {
        await c.query('UPDATE estaciones SET orden=$1 WHERE id=$2 AND mision_id=$3', [i + 1, idsPedidos[i], req.params.id]);
      }
      const q = await c.query('SELECT * FROM estaciones WHERE mision_id=$1 ORDER BY orden', [req.params.id]);
      return q.rows;
    });
    if (resultado === 'mision_no_encontrada') return res.status(404).json({ error: 'no_encontrada' });
    if (resultado === 'orden_incompleto') return res.status(400).json({ error: 'dato_invalido', campo: 'orden' });
    res.json(resultado);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

// PUT /estaciones/:id — valida el body ANTES de tocar la base. Si algo no
// valida: 400 { error:'dato_invalido', campo } y la base ni se toca — nunca
// un 500 genérico ni un guardado parcial. No cambia mision_id ni orden (eso
// es POST /reordenar) — mismo criterio que el editor viejo, generalizado.
router.put('/estaciones/:id', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  const b = req.body || {};
  const campo = campoInvalidoDeEstacion(b);
  if (campo) return res.status(400).json({ error: 'dato_invalido', campo });
  try {
    const row = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query(
        `UPDATE estaciones SET titulo=$1, pilar=$2, narrativa=$3, reto=$4, datos=$5, pistas=$6, feedback_ok=$7,
                                interaccion=$8, codigo=$9, respuesta=$10, desbloqueo=$11, icono=$12, visual=$13
         WHERE id=$14 RETURNING *`,
        [b.titulo.trim(), b.pilar.trim(), b.narrativa.trim(), b.reto.trim(), JSON.stringify(b.datos),
          JSON.stringify(b.pistas), b.feedback_ok.trim(), JSON.stringify(b.interaccion), b.codigo.trim(),
          JSON.stringify(b.respuesta), b.desbloqueo, b.icono || null, b.visual ? JSON.stringify(b.visual) : null,
          req.params.id]);
      return q.rows[0];
    });
    if (!row) return res.status(404).json({ error: 'no_encontrada' });
    res.json(row);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

// DELETE /estaciones/:id — recompacta `orden` de la misión que queda para no
// dejar huecos (decisión explícita, plan-motor-misiones.md P4 lo dejó abierto:
// "cualquiera sirve, pero elegí una y dejala escrita"). Un hueco (1,2,4,5) es
// válido para el `unique`, pero un insert nuevo en la posición 4 chocaría —
// recompactar acá es más simple que hacer que cada POST de sala nueva calcule
// alrededor de huecos. Frontend puede asumir que `orden` siempre es 1..N
// contiguo. Mismo truco del rango disjunto que /reordenar, por la misma razón.
router.delete('/estaciones/:id', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  try {
    const resultado = await conSesion(req.perfil.id, async (c) => {
      const previa = await c.query('SELECT mision_id FROM estaciones WHERE id=$1', [req.params.id]);
      if (!previa.rows.length) return false;
      const misionId = previa.rows[0].mision_id;
      await c.query('DELETE FROM estaciones WHERE id=$1', [req.params.id]);
      await c.query('UPDATE estaciones SET orden = orden + 100000 WHERE mision_id=$1', [misionId]);
      await c.query(`
        UPDATE estaciones e SET orden = ranked.nuevo_orden
        FROM (SELECT id, row_number() OVER (ORDER BY orden) AS nuevo_orden FROM estaciones WHERE mision_id=$1) ranked
        WHERE e.id = ranked.id`, [misionId]);
      return true;
    });
    if (!resultado) return res.status(404).json({ error: 'no_encontrada' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

// POST /estaciones/:id/probar — llama evaluar_reto() directo con la
// respuesta del editor. NUNCA pasa por verificar_estacion(): esa función
// escribe en intentos/progreso y exige equipo+apuntador+sesión abierta, nada
// de lo cual existe todavía cuando el docente está probando una sala nueva.
//
// La primera versión de esta ruta llamaba comparar_mecanismo() directo, que
// SOLO conoce un mecanismo — no sabe nada de `cierre` (verificado por SQL:
// con cierre mal y mecanismo bien devolvía `correcto:true`, ignorándolo por
// completo). Repliqué la combinación en JS y funcionaba, pero eso dejaba dos
// implementaciones de la misma regla — el mismo patrón que ya mordió acá dos
// veces (orden por `id` vs por `orden`, maestro compuesto en cliente vs
// servidor). La coordinadora extrajo evaluar_reto() a sql/03-funciones.sql,
// que ahora usan tanto verificar_estacion() como esta ruta: el editor y el
// juego corrigen con el mismo código por construcción.
router.post('/estaciones/:id/probar', async (req, res) => {
  if (!exigirSuperAdmin(req, res)) return;
  const respuestaEnviada = req.body?.respuesta || {};
  try {
    const resultado = await conSesion(req.perfil.id, async (c) => {
      const q = await c.query(
        'SELECT evaluar_reto(interaccion, respuesta, $1) AS datos FROM estaciones WHERE id=$2',
        [respuestaEnviada, req.params.id]);
      return q.rows[0]?.datos ?? null;
    });
    if (!resultado) return res.status(404).json({ error: 'no_encontrada' });
    res.json(resultado);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

export default router;
