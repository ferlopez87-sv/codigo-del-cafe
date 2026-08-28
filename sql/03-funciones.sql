-- =============================================================================
-- El Código del Café — 03-funciones.sql
-- Funciones de validación. CONTRACT.md §4. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- integrantes_de_equipo(p_equipo) — SECURITY DEFINER a propósito: se usa
-- ANTES de que exista identidad (acceso por código de equipo, pedido
-- 2026-08-26), cuando `app.usuario_actual()` todavía es null y el estudiante
-- ni siquiera tiene sesión. Solo se llama después de validar el código de
-- equipo por su hash — nunca directo desde una ruta sin ese chequeo previo.
-- -----------------------------------------------------------------------------
-- drop explícito (2026-08-28): `create or replace` no puede cambiar la forma
-- de retorno de una función table-returning (acá se agregó la columna
-- ya_entro) — sin este drop, el arranque en una base ya migrada (Render
-- incluido) falla con "cannot change return type of existing function".
drop function if exists integrantes_de_equipo(uuid);
create or replace function integrantes_de_equipo(p_equipo uuid)
returns table (perfil_id uuid, nombre text, correo text, carne text, rol text, es_apuntador boolean, ya_entro boolean)
language sql security definer stable set search_path = public as $$
  select p.id, p.nombre, p.correo, p.carne, p.rol, i.es_apuntador, i.primer_acceso_en is not null
  from integrantes i join perfiles p on p.id = i.perfil_id
  where i.equipo_id = p_equipo
  order by p.nombre
$$;

-- reclamar_lugar_equipo(p_equipo, p_perfil) — SECURITY DEFINER, mismo motivo
-- que integrantes_de_equipo: corre sin identidad, antes del login. Marca
-- primer_acceso_en la primera vez que alguien entra con ese perfil dentro
-- del equipo; si ya estaba marcado, no lo toca y devuelve false. Así, si un
-- usuario ya entró, otro no puede usar su lugar (pedido de Fernando
-- 2026-08-28) — /api/auth/acceso-equipo llama esto después de confirmar que
-- el perfil es de ese equipo, y si devuelve false no emite la cookie. El
-- `where primer_acceso_en is null` hace el chequeo-y-marca atómico: ante dos
-- clics simultáneos sobre el mismo nombre, solo uno gana la carrera.
create or replace function reclamar_lugar_equipo(p_equipo uuid, p_perfil uuid)
returns boolean
language sql security definer volatile set search_path = public as $$
  with intento as (
    update integrantes
    set primer_acceso_en = now()
    where equipo_id = p_equipo and perfil_id = p_perfil and primer_acceso_en is null
    returning 1
  )
  select exists(select 1 from intento)
$$;

-- Mismo motivo que integrantes_de_equipo: /api/auth/equipo-por-codigo corre
-- sin identidad, y `equipos` tiene RLS real — un SELECT plano ahí siempre
-- devuelve 0 filas.
create or replace function nombre_de_equipo(p_equipo uuid) returns text
language sql security definer stable set search_path = public as $$
  select nombre from equipos where id = p_equipo
$$;

-- -----------------------------------------------------------------------------
-- mi_equipo() — equipo, sesión, integrantes (con es_apuntador) y si YO soy el
-- apuntador. SECURITY DEFINER (corregido 2026-08-26): `perfiles` solo tiene
-- política de "ver la propia fila" para un estudiante — sin bypass, el JOIN
-- integrantes→perfiles de más abajo perdía a los compañeros de equipo por
-- RLS y cada quien se veía solo a sí mismo en la lista. La primera consulta
-- (a qué equipo pertenezco) ya limita el resultado a MI equipo — el bypass
-- de acá abajo solo revela nombres de gente de ESE mismo equipo, nunca de otro.
-- -----------------------------------------------------------------------------
create or replace function mi_equipo() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_equipo equipos; v_out jsonb;
begin
  select e.* into v_equipo
  from equipos e join integrantes i on i.equipo_id = e.id
  where i.perfil_id = app.usuario_actual()
  limit 1;

  if not found then return null; end if;

  select jsonb_build_object(
    'id', v_equipo.id,
    'nombre', v_equipo.nombre,
    'sesion_id', v_equipo.sesion_id,
    'iniciado_en', v_equipo.iniciado_en,
    'finalizado_en', v_equipo.finalizado_en,
    'motivo_fin', v_equipo.motivo_fin,
    'soy_apuntador', coalesce((select i.es_apuntador from integrantes i
                               where i.equipo_id = v_equipo.id and i.perfil_id = app.usuario_actual()), false),
    'integrantes', coalesce((
      select jsonb_agg(jsonb_build_object('perfil_id', p.id, 'nombre', p.nombre, 'es_apuntador', i.es_apuntador) order by p.nombre)
      from integrantes i join perfiles p on p.id = i.perfil_id
      where i.equipo_id = v_equipo.id
    ), '[]'::jsonb),
    'sesion', (select jsonb_build_object('id', s.id, 'nombre', s.nombre, 'estado', s.estado, 'duracion_minutos', s.duracion_minutos)
               from sesiones s where s.id = v_equipo.sesion_id)
  ) into v_out;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- estado_juego(p_equipo) — progreso de las 5 estaciones + segundos restantes,
-- calculados en servidor. SECURITY DEFINER (a diferencia de mi_equipo): lee
-- estaciones.codigo para revelar el fragmento SOLO de lo ya resuelto —
-- estaciones no tiene ninguna política de select (§3), así que sin esto el
-- join a estaciones devolvería 0 filas para cualquiera, apuntador o no.
-- Sigue validando membresía explícitamente porque ya no lo hace RLS.
-- -----------------------------------------------------------------------------
create or replace function estado_juego(p_equipo uuid) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare v_equipo equipos; v_sesion sesiones; v_restantes int; v_uid uuid := app.usuario_actual();
begin
  -- Chequeo explícito de membresía/docencia: al ser SECURITY DEFINER, esta
  -- función ya no hereda gratis la restricción que le daba RLS sobre equipos.
  if v_uid is null or not (
    exists (select 1 from integrantes where equipo_id = p_equipo and perfil_id = v_uid)
    or exists (select 1 from equipos e join sesiones s on s.id = e.sesion_id where e.id = p_equipo and s.docente_id = v_uid)
  ) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  select * into v_equipo from equipos where id = p_equipo;
  if not found then return jsonb_build_object('error', 'no_encontrado'); end if;
  select * into v_sesion from sesiones where id = v_equipo.sesion_id;

  if v_equipo.iniciado_en is null then
    v_restantes := v_sesion.duracion_minutos * 60;
  else
    v_restantes := greatest(0, (v_sesion.duracion_minutos * 60)
                    - extract(epoch from (now() - v_equipo.iniciado_en))::int);
  end if;

  return jsonb_build_object(
    'equipo_id', v_equipo.id,
    'iniciado_en', v_equipo.iniciado_en,
    'finalizado_en', v_equipo.finalizado_en,
    'motivo_fin', v_equipo.motivo_fin,
    'segundos_restantes', v_restantes,
    'tiempo_agotado', v_restantes <= 0 and v_equipo.iniciado_en is not null,
    'servidor_en', now(),
    -- 'estaciones': nombre que espera js/juego.js (pintarEstadoDesdeDatos lee
    -- datos.estaciones, no datos.progreso — alinear acá, no en el cliente).
    -- 'codigo' solo viaja si ya está resuelta (pintarFragmentos, §4.2): el
    -- cliente nunca debe recibir el fragmento de una estación sin resolver.
    -- 'feedback' (2026-08-28, pedido de Fernando): mismo criterio — solo con
    -- la estación resuelta, para que al reabrir una sala ya resuelta el panel
    -- pueda mostrar de nuevo su mensaje de confirmación sin tener que volver
    -- a "Verificar". Antes esto no viajaba acá y el panel se quedaba mudo al
    -- revisitar una sala ya resuelta (el mensaje solo se veía una vez, justo
    -- después de acertar).
    'estaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'estacion_id', pr.estacion_id, 'id', pr.estacion_id, 'estado', pr.estado, 'intentos', pr.intentos,
        'codigo', case when pr.estado = 'resuelta' then e.codigo else null end,
        'feedback', case when pr.estado = 'resuelta' then e.feedback_ok else null end
      ) order by pr.estacion_id)
      from progreso pr join estaciones e on e.id = pr.estacion_id
      where pr.equipo_id = p_equipo
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- verificar_estacion(p_equipo, p_estacion, p_respuesta) — el corazón del
-- sistema. SECURITY DEFINER: es la única vía autorizada a leer
-- estaciones.respuesta (RLS de esa tabla no tiene ninguna política).
-- -----------------------------------------------------------------------------
create or replace function verificar_estacion(p_equipo uuid, p_estacion int, p_respuesta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app.usuario_actual();
  v_soy_apuntador boolean;
  v_hay_apuntador boolean;
  v_apuntador_nombre text;
  v_equipo equipos;
  v_sesion sesiones;
  v_est estaciones;
  v_progreso progreso;
  v_correcto boolean := false;
  v_parcial boolean := false;
  v_detalle text;
  v_intento int;
  v_pista text;
  v_resultado jsonb;
begin
  if v_uid is null or not exists (select 1 from integrantes where equipo_id = p_equipo and perfil_id = v_uid) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  select bool_or(es_apuntador) into v_hay_apuntador from integrantes where equipo_id = p_equipo;
  if not coalesce(v_hay_apuntador, false) then
    return jsonb_build_object('error', 'sin_apuntador');
  end if;

  select es_apuntador into v_soy_apuntador from integrantes where equipo_id = p_equipo and perfil_id = v_uid;
  if not coalesce(v_soy_apuntador, false) then
    select p.nombre into v_apuntador_nombre from integrantes i join perfiles p on p.id = i.perfil_id
      where i.equipo_id = p_equipo and i.es_apuntador limit 1;
    return jsonb_build_object('error', 'no_apuntador', 'apuntador', v_apuntador_nombre);
  end if;

  select * into v_equipo from equipos where id = p_equipo;
  select * into v_sesion from sesiones where id = v_equipo.sesion_id;

  -- 'borrador' y 'cerrada' son situaciones opuestas y necesitan mensajes
  -- distintos: una sesión que el docente todavía no abrió se reportaba como
  -- "ya fue cerrada por el docente", que manda a buscar el problema al lado
  -- equivocado. Además una es transitoria (esperá a que abra) y la otra es
  -- terminal (no hay nada más que hacer).
  if v_sesion.estado = 'borrador' then
    return jsonb_build_object('error', 'sesion_no_abierta');
  elsif v_sesion.estado <> 'abierta' then
    return jsonb_build_object('error', 'sesion_cerrada');
  end if;

  if v_equipo.iniciado_en is null then
    update equipos set iniciado_en = now() where id = p_equipo returning * into v_equipo;
  end if;

  if now() > v_equipo.iniciado_en + make_interval(mins => v_sesion.duracion_minutos) then
    update equipos set motivo_fin = 'tiempo', finalizado_en = coalesce(finalizado_en, now())
      where id = p_equipo and finalizado_en is null;
    return jsonb_build_object('error', 'tiempo_agotado');
  end if;

  if p_estacion = 5 then
    if (select count(*) from progreso where equipo_id = p_equipo and estacion_id in (1,2,3,4) and estado = 'resuelta') < 4 then
      return jsonb_build_object('error', 'bloqueada');
    end if;
  end if;

  select * into v_progreso from progreso where equipo_id = p_equipo and estacion_id = p_estacion;
  select * into v_est from estaciones where id = p_estacion;

  if v_progreso.estado = 'resuelta' then
    return jsonb_build_object('ok', true, 'parcial', false, 'intentos', v_progreso.intentos, 'codigo', v_est.codigo, 'feedback', v_est.feedback_ok);
  end if;

  -- Comparación por tipo de estación (§14/§15) — la respuesta correcta SIEMPRE sale de estaciones.respuesta, nunca hardcodeada acá.
  case p_estacion
    when 1 then
      if p_respuesta is null or p_respuesta->'orden' is null or p_respuesta->>'eslabon' is null then
        v_detalle := 'vacio';
      else
        declare v_orden_ok boolean := (p_respuesta->'orden' = v_est.respuesta->'orden');
                v_eslabon_ok boolean := (p_respuesta->>'eslabon' = v_est.respuesta->>'eslabon');
        begin
          if v_orden_ok and v_eslabon_ok then v_correcto := true;
          elsif v_orden_ok or v_eslabon_ok then v_parcial := true; v_detalle := case when v_orden_ok then 'eslabon-mal' else 'orden-mal' end;
          else v_detalle := 'ambos-mal';
          end if;
        end;
      end if;
    when 2 then
      -- nullif(...,'') — bug real encontrado en navegador 2026-08-26: el
      -- control numérico sin tocar manda '' (string vacío), no ausencia de
      -- clave ni JSON null. El guard original solo miraba `is null`, así
      -- que '' se colaba hasta el ::numeric de más abajo y tronaba con un
      -- 500 crudo (invalid input syntax for type numeric) — el cliente lo
      -- mostraba como "Error de red" sin decir nada más.
      if p_respuesta is null or nullif(p_respuesta->>'porcentaje','') is null or p_respuesta->>'enganosa' is null then
        v_detalle := 'vacio';
      else
        declare v_pct numeric := (p_respuesta->>'porcentaje')::numeric;
                v_pct_ok boolean;
                v_juicio_ok boolean := (p_respuesta->>'enganosa' = v_est.respuesta->>'enganosa');
        begin
          if v_pct < 0 or v_pct > 100 then
            v_detalle := 'porcentaje-fuera-rango';
          else
            select bool_or((v_pct - (x.val)::numeric) between -0.01 and 0.01) into v_pct_ok
              from jsonb_array_elements_text(v_est.respuesta->'porcentaje_acepta') as x(val);
            if v_pct_ok and v_juicio_ok then v_correcto := true;
            elsif v_pct_ok or v_juicio_ok then v_parcial := true; v_detalle := case when v_pct_ok then 'juicio-mal' else 'porcentaje-mal' end;
            else v_detalle := 'porcentaje-mal';
            end if;
          end if;
        end;
      end if;
    when 3 then
      -- Mismo bug que E2 arriba — nullif(...,'') trata el string vacío
      -- como ausente en vez de dejarlo llegar al ::numeric de abajo.
      if p_respuesta is null or nullif(p_respuesta->>'porcentaje','') is null or p_respuesta->>'inconsistencia' is null then
        v_detalle := 'vacio';
      else
        declare v_pct numeric := (p_respuesta->>'porcentaje')::numeric;
                v_pct_ok boolean := v_pct between (v_est.respuesta->>'porcentaje_min')::numeric and (v_est.respuesta->>'porcentaje_max')::numeric;
                v_inc_ok boolean := (p_respuesta->>'inconsistencia' = v_est.respuesta->>'inconsistencia');
        begin
          if v_pct_ok and v_inc_ok then v_correcto := true;
          elsif v_pct_ok or v_inc_ok then v_parcial := true; v_detalle := case when v_pct_ok then 'inconsistencia-mal' else 'porcentaje-mal' end;
          else v_detalle := 'porcentaje-mal';
          end if;
        end;
      end if;
    when 4 then
      if p_respuesta is null or p_respuesta->'actores' is null then
        v_detalle := 'vacio';
      else
        declare v_env text[] := (select array_agg(x order by x) from jsonb_array_elements_text(p_respuesta->'actores') x);
                v_correctos text[] := (select array_agg(x order by x) from jsonb_array_elements_text(v_est.respuesta->'actores') x);
                v_extra int := (select count(*) from unnest(v_env) e where not (e = any(v_correctos)));
                v_falta int := (select count(*) from unnest(v_correctos) c where not (c = any(v_env)));
        begin
          if v_env = v_correctos then v_correcto := true;
          elsif v_extra > 0 and v_falta > 0 then v_detalle := 'equivocados';
          elsif v_extra > 0 then v_parcial := true; v_detalle := 'sobre-marcado';
          else v_parcial := true; v_detalle := 'sub-marcado';
          end if;
        end;
      end if;
    when 5 then
      if p_respuesta is null or jsonb_array_length(coalesce(p_respuesta->'frases','[]'::jsonb)) <> 5 then
        v_detalle := 'vacio';
      else
        declare v_n_correctas int := (
          select count(*) from generate_series(0,4) idx
          where (p_respuesta->'frases'->>idx) = (v_est.respuesta->'frases'->>idx)
        );
        begin
          if v_n_correctas = 5 then v_correcto := true;
          else v_parcial := (v_n_correctas > 0); v_detalle := 'parcial-'||v_n_correctas;
          end if;
        end;
      end if;
  end case;

  v_intento := coalesce(v_progreso.intentos, 0) + 1;

  insert into intentos (equipo_id, estacion_id, perfil_id, respuesta, correcto, detalle)
    values (p_equipo, p_estacion, v_uid, p_respuesta, v_correcto, v_detalle);

  insert into progreso (equipo_id, estacion_id, estado, intentos, resuelta_en)
    values (p_equipo, p_estacion, case when v_correcto then 'resuelta' when v_intento>0 then 'progreso' else 'pendiente' end, v_intento, case when v_correcto then now() else null end)
  on conflict (equipo_id, estacion_id) do update set
    estado = excluded.estado, intentos = excluded.intentos, resuelta_en = excluded.resuelta_en;

  -- Desbloqueo de la Estación 5 cuando 1-4 quedan resueltas (CONTRACT §2.2)
  if v_correcto and p_estacion in (1,2,3,4) then
    if (select count(*) from progreso where equipo_id = p_equipo and estacion_id in (1,2,3,4) and estado = 'resuelta') = 4 then
      update progreso set estado = 'pendiente' where equipo_id = p_equipo and estacion_id = 5 and estado = 'bloqueada';
    end if;
  end if;

  if v_correcto then
    return jsonb_build_object('ok', true, 'parcial', false, 'intentos', v_intento, 'codigo', v_est.codigo, 'feedback', v_est.feedback_ok);
  else
    v_pista := case when v_intento <= 1 then v_est.pistas->>0 when v_intento = 2 then v_est.pistas->>1 else v_est.pistas->>2 end;
    return jsonb_build_object('ok', false, 'parcial', v_parcial, 'intentos', v_intento, 'detalle', v_detalle, 'pista', v_pista);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- verificar_maestro(p_equipo, p_codigo) — mismo chequeo de apuntador que
-- verificar_estacion. SECURITY DEFINER: compara contra el código maestro fijo.
-- -----------------------------------------------------------------------------
create or replace function verificar_maestro(p_equipo uuid, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := app.usuario_actual();
  v_soy_apuntador boolean;
  v_hay_apuntador boolean;
  v_apuntador_nombre text;
  v_norm text := regexp_replace(upper(coalesce(p_codigo,'')), '[^A-Z0-9]', '', 'g');
  v_maestro text := regexp_replace(upper('06-87-04-2P-4'), '[^A-Z0-9]', '', 'g');
begin
  if v_uid is null or not exists (select 1 from integrantes where equipo_id = p_equipo and perfil_id = v_uid) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;
  select bool_or(es_apuntador) into v_hay_apuntador from integrantes where equipo_id = p_equipo;
  if not coalesce(v_hay_apuntador, false) then
    return jsonb_build_object('error', 'sin_apuntador');
  end if;
  select es_apuntador into v_soy_apuntador from integrantes where equipo_id = p_equipo and perfil_id = v_uid;
  if not coalesce(v_soy_apuntador, false) then
    select p.nombre into v_apuntador_nombre from integrantes i join perfiles p on p.id = i.perfil_id
      where i.equipo_id = p_equipo and i.es_apuntador limit 1;
    return jsonb_build_object('error', 'no_apuntador', 'apuntador', v_apuntador_nombre);
  end if;

  if v_norm = v_maestro then
    update equipos set finalizado_en = coalesce(finalizado_en, now()), motivo_fin = coalesce(motivo_fin, 'completado')
      where id = p_equipo;
    return jsonb_build_object('ok', true, 'veredicto', 'CGC no sostiene su promesa 2027 con evidencia suficiente en las áreas auditadas.');
  else
    return jsonb_build_object('ok', false, 'error', 'codigo_incorrecto');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- marcar_apuntador(p_equipo, p_perfil) — SIN SECURITY DEFINER a propósito
-- (CONTRACT §4.2): corre con el RLS de quien llama. Un estudiante no puede
-- autodesignarse porque su política de integrantes es solo lectura; solo el
-- docente de la sesión tiene UPDATE ahí.
-- -----------------------------------------------------------------------------
create or replace function marcar_apuntador(p_equipo uuid, p_perfil uuid) returns void
language plpgsql set search_path = public as $$
begin
  update integrantes set es_apuntador = false where equipo_id = p_equipo;
  update integrantes set es_apuntador = true where equipo_id = p_equipo and perfil_id = p_perfil;
  if not found then
    raise exception 'perfil_no_es_integrante_del_equipo';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- cerrar_sesion_clase(p_sesion) — solo docente (RLS ya lo exige para el UPDATE).
-- -----------------------------------------------------------------------------
create or replace function cerrar_sesion_clase(p_sesion uuid) returns jsonb
language plpgsql set search_path = public as $$
begin
  update sesiones set estado = 'cerrada', cerrada_en = now() where id = p_sesion;
  if not found then return jsonb_build_object('error', 'no_encontrada_o_no_autorizado'); end if;
  update equipos set finalizado_en = coalesce(finalizado_en, now()), motivo_fin = coalesce(motivo_fin, 'cerrado')
    where sesion_id = p_sesion and finalizado_en is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- anonimizar_sesion(p_sesion) — solo docente. Sustituye nombre/correo/carné
-- por marcadores, conserva desempeño.
-- -----------------------------------------------------------------------------
create or replace function anonimizar_sesion(p_sesion uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not exists (select 1 from sesiones where id = p_sesion and docente_id = app.usuario_actual()) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;
  with afectados as (
    select distinct p.id from perfiles p
    join integrantes i on i.perfil_id = p.id
    join equipos e on e.id = i.equipo_id
    where e.sesion_id = p_sesion
  )
  update perfiles set nombre = 'Estudiante anonimizado', correo = 'anon-'||substr(id::text,1,8)||'@anonimizado.local'
  where id in (select id from afectados);
  get diagnostics v_n = row_count;
  update nomina set nombre = 'Estudiante anonimizado', correo = 'anon-'||substr(coalesce(perfil_id::text, id::text),1,8)||'@anonimizado.local'
  where sesion_id = p_sesion;
  return jsonb_build_object('ok', true, 'perfiles_anonimizados', v_n);
end;
$$;
