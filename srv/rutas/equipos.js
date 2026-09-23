// P6-servidor (plan-motor-misiones.md, "Armado aleatorio de equipos") — una
// sola ruta, detrás del gate de docente, que reemplaza crear ~12 equipos a
// mano, ~60 asignaciones y 12 códigos repartidos uno por uno.
import { Router } from 'express';
import { randomInt } from 'crypto';
import { conSesion } from '../db.js';
import { hashCodigo } from '../email.js';
import { generarCodigoEquipo, barajar, calcularNumEquipos, tamañosDeGrupos } from '../util.js';

const router = Router();

// POST /sesiones/:id/armar-equipos { modo, valor, prefijoNombre? }
//   → { equipos: [{ id, nombre, integrantes, apuntador, codigo, expiraEn }] }
//
// Todo en UNA transacción (conSesion ya envuelve el callback en BEGIN…COMMIT):
// si cualquier paso falla — un perfil que no se puede resolver, un equipo que
// no se puede crear — nada de lo hecho hasta ahí queda escrito. Media sección
// repartida es peor que ninguna.
router.post('/sesiones/:id/armar-equipos', async (req, res) => {
  if (!req.perfil) return res.status(401).json({ error: 'no_autorizado' });
  const { modo, valor, horasValidez } = req.body || {};
  const prefijoNombre = (req.body?.prefijoNombre || 'Equipo').trim() || 'Equipo';
  if (modo !== 'por_tamano' && modo !== 'por_cantidad') {
    return res.status(400).json({ error: 'dato_invalido', campo: 'modo' });
  }
  if (!Number.isInteger(valor) || valor < 1) {
    return res.status(400).json({ error: 'dato_invalido', campo: 'valor' });
  }
  const horas = Math.min(Math.max(Number(horasValidez) || 4, 1), 24);

  try {
    const resultado = await conSesion(req.perfil.id, async (c) => {
      // RLS real sobre `sesiones` (policy "for all" del docente dueño, o
      // super-admin) — 0 filas = no existe o no es tuya, mismo criterio que
      // el resto del proyecto (defensa en profundidad, no la única capa).
      const sesionRow = await c.query('SELECT id FROM sesiones WHERE id=$1', [req.params.id]);
      if (!sesionRow.rows.length) return { error: 'no_encontrada' };

      // Mismo filtro que GET /registrados/:sesion (srv/rutas/docente.js):
      // nómina de esta sesión sin equipo todavía — respeta lo ya armado a
      // mano y no toca a nadie ya asignado.
      const libres = await c.query(`
        SELECT n.id, n.nombre, n.correo, n.perfil_id AS "perfilId"
        FROM nomina n
        WHERE n.sesion_id=$1
          AND (n.perfil_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM integrantes i JOIN equipos e ON e.id=i.equipo_id
            WHERE e.sesion_id=$1 AND i.perfil_id=n.perfil_id
          ))
        ORDER BY n.creada_en`, [req.params.id]);

      // por_cantidad no puede pedir más equipos que estudiantes sin asignar
      // (dejaría equipos vacíos). Si ya no queda nadie, el chequeo de abajo
      // (numEquipos=0) resuelve el caso idempotente sin error.
      if (modo === 'por_cantidad' && libres.rows.length > 0 && valor > libres.rows.length) {
        return { error: 'dato_invalido', campo: 'valor' };
      }

      const numEquipos = calcularNumEquipos(libres.rows.length, modo, valor);
      if (!numEquipos) return { equipos: [] }; // nadie sin equipo — idempotente

      const tamaños = tamañosDeGrupos(libres.rows.length, numEquipos);
      const barajados = barajar(libres.rows);

      const equiposCreados = [];
      let cursor = 0;
      for (let i = 0; i < numEquipos; i++) {
        const grupo = barajados.slice(cursor, cursor + tamaños[i]);
        cursor += tamaños[i];

        const eq = await c.query(
          'INSERT INTO equipos (sesion_id, nombre) VALUES ($1,$2) RETURNING *',
          [req.params.id, `${prefijoNombre} ${i + 1}`]);
        const equipoId = eq.rows[0].id;

        const integrantes = [];
        for (const est of grupo) {
          let perfilId = est.perfilId;
          if (!perfilId) {
            // Mismo camino que POST /equipos/:id/asignar (docente.js): resolver
            // por correo y escribir nomina.perfil_id de vuelta — omitir ese
            // UPDATE fue un bug real (los estudiantes volvían a aparecer como
            // "sin equipo" aunque ya estuvieran asignados).
            const pr = await c.query('SELECT (crear_o_recuperar_perfil($1)).*', [est.correo]);
            perfilId = pr.rows[0]?.id;
            if (!perfilId) throw new Error(`no_se_pudo_resolver_perfil:${est.correo}`);
            await c.query('UPDATE nomina SET perfil_id=$1 WHERE id=$2', [perfilId, est.id]);
          }
          await c.query('INSERT INTO integrantes (equipo_id, perfil_id) VALUES ($1,$2)', [equipoId, perfilId]);
          integrantes.push({ perfil_id: perfilId, nombre: est.nombre });
        }

        // Apuntador al azar por equipo — sin esto verificar_estacion() rechaza
        // todo con sin_apuntador y el equipo queda trabado desde la sala 1.
        const apuntador = integrantes[randomInt(integrantes.length)];
        await c.query('SELECT marcar_apuntador($1,$2)', [equipoId, apuntador.perfil_id]);

        // Progreso derivado de la misión de la sesión — misma función que
        // usa POST /equipos (P1), una sola definición para los dos caminos.
        await c.query('SELECT inicializar_progreso_equipo($1)', [equipoId]);

        // Código en claro UNA sola vez — igual que POST /equipos/:id/codigo:
        // solo se guarda el hash, no hay forma de volver a mostrarlo sin
        // regenerarlo. `codigos_equipo` no tiene RLS propio (excepción
        // documentada, sql/02-rls.sql) — el SELECT contra `equipos` de arriba
        // ya validó que este equipo es de este docente antes de escribir acá.
        const codigo = generarCodigoEquipo();
        const hash = hashCodigo(codigo);
        const expira = new Date(Date.now() + horas * 60 * 60 * 1000);
        await c.query(
          `INSERT INTO codigos_equipo (equipo_id, codigo_hash, expira_en, creado_en)
           VALUES ($1,$2,$3, now())`,
          [equipoId, hash, expira]);

        equiposCreados.push({
          id: equipoId,
          nombre: eq.rows[0].nombre,
          integrantes,
          apuntador: { perfil_id: apuntador.perfil_id, nombre: apuntador.nombre },
          codigo,
          expiraEn: expira.toISOString(),
        });
      }

      return { equipos: equiposCreados };
    });

    if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'no_encontrada' });
    if (resultado.error === 'dato_invalido') return res.status(400).json({ error: 'dato_invalido', campo: resultado.campo });
    res.json(resultado);
  } catch (e) { console.error(e); res.status(500).json({ error: 'error_interno' }); }
});

export default router;
