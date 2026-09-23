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
-- misiones_publicas() — catálogo de misiones para ELEGIR, no para espiar.
--
-- `misiones` es deny-all salvo super-admin (06-superadmin.sql), igual que
-- `estaciones`. Correcto para el editor, pero deja sin salida a un caso
-- legítimo: cualquier docente que crea una sesión de clase tiene que poder
-- elegir qué misión se juega, y un SELECT plano le devuelve 0 filas — no un
-- error, que es peor: la ruta lo leería como "no hay ninguna misión".
--
-- SECURITY DEFINER acotado a lo que NO es spoiler: nunca devuelve
-- `codigo_maestro` (el código que el equipo tiene que descubrir) ni
-- `veredicto` (el desenlace). Solo lo necesario para poblar un desplegable.
-- Exige rol docente: un estudiante no tiene por qué ver el catálogo.
-- -----------------------------------------------------------------------------
drop function if exists misiones_publicas();
create or replace function misiones_publicas()
returns table (id uuid, slug text, titulo text, subtitulo text, estado text, salas int)
language sql security definer stable set search_path = public as $$
  select m.id, m.slug, m.titulo, m.subtitulo, m.estado,
         (select count(*)::int from estaciones e where e.mision_id = m.id)
    from misiones m
   where m.estado = 'publicada'
     and coalesce((select p.rol = 'docente' from perfiles p where p.id = app.usuario_actual()), false)
   order by m.titulo
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
               from sesiones s where s.id = v_equipo.sesion_id),
    -- 'mision' (2026-09-22): el tablero del estudiante necesita el nombre de la
    -- misión en su cabecera, y `misiones` es deny-all. mi_equipo() ya es
    -- SECURITY DEFINER, así que viaja por acá en vez de abrir una ruta nueva.
    -- Solo campos no-spoiler: nunca codigo_maestro ni veredicto.
    'mision', (select jsonb_build_object('id', m.id, 'titulo', m.titulo, 'subtitulo', m.subtitulo, 'intro', m.intro)
               from sesiones s join misiones m on m.id = s.mision_id
              where s.id = v_equipo.sesion_id)
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
        'estacion_id', pr.estacion_id, 'id', pr.estacion_id, 'orden', e.orden, 'estado', pr.estado, 'intentos', pr.intentos,
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
-- normalizar_texto(p_txt) — comparación indulgente de texto libre: minúsculas,
-- sin acentos, sin espacios de más. Un estudiante que escribe "Agua  Verde",
-- "agua verde" o "AGUA VERDE" acierta igual. Se usa en respuesta_corta modo
-- texto y para comparar ids (que el cliente ya manda normalizados, pero no se
-- depende de eso: el servidor nunca confía en la normalización del cliente).
-- -----------------------------------------------------------------------------
create or replace function normalizar_texto(p_txt text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           translate(lower(trim(coalesce(p_txt, ''))),
                     'áàäâãéèëêíìïîóòöôõúùüûñç',
                     'aaaaaeeeeiiiiooooouuuunc'),
           '\s+', ' ', 'g')
$$;

-- -----------------------------------------------------------------------------
-- comparar_mecanismo(tipo, interaccion, esperada, enviada) → {correcto, parcial, detalle}
--
-- El corazón del motor de corrección (2026-09-22). REEMPLAZA el `case
-- p_estacion when 1 ... when 5` que vivía dentro de verificar_estacion: la
-- lógica se ramificaba por NÚMERO DE SALA, así que cambiar el tipo de reto de
-- una sala desde el editor la dejaba imposible de resolver — el estudiante
-- respondía bien y el sistema le decía que estaba mal. Ahora se ramifica por
-- `interaccion.tipo`, que es lo que el editor realmente controla.
--
-- Pura e `immutable` a propósito: se puede probar con un `select` suelto desde
-- psql, sin montar sesión + equipo + apuntador. La lógica anterior era
-- imposible de probar sin una partida completa, que es la razón por la que
-- nadie notó nunca sus casos borde.
--
-- Formas de `esperada` y `enviada`: plan-motor-misiones.md §1.2 y §1.3.
-- Nunca lanza: una forma inesperada devuelve incorrecto con detalle, no una
-- excepción que el cliente vería como "Error de red".
-- -----------------------------------------------------------------------------
create or replace function comparar_mecanismo(
  p_tipo        text,
  p_interaccion jsonb,
  p_esperada    jsonb,
  p_enviada     jsonb
) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_env  jsonb;
  v_esp  jsonb;
  v_ok   boolean := false;
  v_parc boolean := false;
  v_det  text    := null;
begin
  if p_enviada is null or p_esperada is null then
    return jsonb_build_object('correcto', false, 'parcial', false, 'detalle', 'vacio');
  end if;

  v_env := p_enviada->'valor';
  v_esp := p_esperada->'valor';

  -- Clave ausente o JSON null = todavía no respondió. Distinto de responder mal.
  if v_env is null or jsonb_typeof(v_env) = 'null' then
    return jsonb_build_object('correcto', false, 'parcial', false, 'detalle', 'vacio');
  end if;

  case p_tipo

  -- OPCIÓN ÚNICA -------------------------------------------------------------
  when 'opcion_unica' then
    if nullif(trim(v_env #>> '{}'), '') is null then
      v_det := 'vacio';
    elsif normalizar_texto(v_env #>> '{}') = normalizar_texto(v_esp #>> '{}') then
      v_ok := true;
    else
      v_det := 'mecanismo-mal';
    end if;

  -- RESPUESTA CORTA ----------------------------------------------------------
  when 'respuesta_corta' then
    declare
      v_modo   text    := coalesce(p_interaccion->>'modo', 'texto');
      v_raw    text    := nullif(trim(v_env #>> '{}'), '');
      v_num    numeric;
      v_min    numeric := nullif(p_esperada->>'min', '')::numeric;
      v_max    numeric := nullif(p_esperada->>'max', '')::numeric;
      v_acepta jsonb;
    begin
      -- nullif(...,'') — bug real 2026-08-26: un <input type=number> sin tocar
      -- manda '' (string vacío), no ausencia de clave ni JSON null. Sin este
      -- guard el '' llegaba al ::numeric y tronaba con un 500 crudo que el
      -- cliente mostraba como "Error de red", sin decir nada más.
      if v_raw is null then
        v_det := 'vacio';

      elsif v_modo = 'numero' then
        begin
          v_num := replace(v_raw, ',', '.')::numeric;
        exception when others then
          v_num := null;
        end;

        if v_num is null then
          v_det := 'mecanismo-mal';
        elsif v_min is not null and v_max is not null then
          -- Respuesta por rango (la Sala del Dinero: 4 a 4.4 %)
          if v_num between v_min and v_max then v_ok := true;
          else v_det := 'fuera-de-rango';
          end if;
        else
          -- Respuesta por valor + variantes aceptadas, tolerancia ±0.01
          v_acepta := coalesce(p_esperada->'acepta', '[]'::jsonb) || jsonb_build_array(v_esp);
          select coalesce(bool_or(abs(v_num - x::numeric) <= 0.01), false)
            into v_ok
            from jsonb_array_elements_text(v_acepta) as t(x)
           where x ~ '^-?[0-9]+(\.[0-9]+)?$';
          if not v_ok then v_det := 'mecanismo-mal'; end if;
        end if;

      else
        v_acepta := coalesce(p_esperada->'acepta', '[]'::jsonb) || jsonb_build_array(v_esp);
        select coalesce(bool_or(normalizar_texto(x) = normalizar_texto(v_raw)), false)
          into v_ok
          from jsonb_array_elements_text(v_acepta) as t(x);
        if not v_ok then v_det := 'mecanismo-mal'; end if;
      end if;
    end;

  -- ORDENAR ------------------------------------------------------------------
  when 'orden' then
    declare
      v_a text[];
      v_b text[];
    begin
      if jsonb_typeof(v_env) <> 'array' or jsonb_array_length(v_env) = 0 then
        v_det := 'vacio';
      else
        select array_agg(normalizar_texto(x) order by ord) into v_a
          from jsonb_array_elements_text(v_env) with ordinality as t(x, ord);
        select array_agg(normalizar_texto(x) order by ord) into v_b
          from jsonb_array_elements_text(v_esp) with ordinality as t(x, ord);
        if v_a = v_b then v_ok := true; else v_det := 'mecanismo-mal'; end if;
      end if;
    end;

  -- SELECCIÓN MÚLTIPLE -------------------------------------------------------
  when 'checklist' then
    declare
      v_a     text[];
      v_b     text[];
      v_extra int;
      v_falta int;
    begin
      if jsonb_typeof(v_env) <> 'array' or jsonb_array_length(v_env) = 0 then
        v_det := 'vacio';
      else
        select array_agg(v order by v) into v_a
          from (select distinct normalizar_texto(x) v from jsonb_array_elements_text(v_env) x) s;
        select array_agg(v order by v) into v_b
          from (select distinct normalizar_texto(x) v from jsonb_array_elements_text(v_esp) x) s;
        v_a := coalesce(v_a, '{}'); v_b := coalesce(v_b, '{}');

        select count(*) into v_extra from unnest(v_a) e where not (e = any(v_b));
        select count(*) into v_falta from unnest(v_b) c where not (c = any(v_a));

        if v_a = v_b then v_ok := true;
        elsif v_extra > 0 and v_falta > 0 then v_det := 'equivocados';
        elsif v_extra > 0 then v_parc := true; v_det := 'sobre-marcado';
        else v_parc := true; v_det := 'sub-marcado';
        end if;
      end if;
    end;

  -- CLASIFICAR ---------------------------------------------------------------
  -- Mapa ítem→categoría, no arreglo posicional (que era la forma vieja de la
  -- Sala de la Verdad). Así reordenar las frases en el editor no invalida la
  -- respuesta correcta.
  when 'clasificacion' then
    declare
      v_items text[];
      v_total int;
      v_resp  int;
      v_bien  int;
    begin
      select array_agg(x->>'id') into v_items
        from jsonb_array_elements(coalesce(p_interaccion->'items', '[]'::jsonb)) x;
      v_total := coalesce(array_length(v_items, 1), 0);

      if v_total = 0 or jsonb_typeof(v_env) <> 'object' then
        v_det := 'vacio';
      else
        select
          count(*) filter (where nullif(trim(coalesce(v_env->>i, '')), '') is not null),
          count(*) filter (where nullif(trim(coalesce(v_env->>i, '')), '') is not null
                             and normalizar_texto(v_env->>i) = normalizar_texto(coalesce(v_esp->>i, '')))
          into v_resp, v_bien
          from unnest(v_items) i;

        if v_resp = 0 then v_det := 'vacio';
        elsif v_bien = v_total then v_ok := true;
        else v_parc := v_bien > 0; v_det := 'parcial-' || v_bien;
        end if;
      end if;
    end;

  else
    -- Tipo que el motor no conoce. Nunca debería llegar (el validador de la
    -- ruta de contenido lo rechaza antes de guardar), pero si llega no se
    -- rompe la partida: se reporta y ya.
    v_det := 'tipo-desconocido';
  end case;

  return jsonb_build_object('correcto', v_ok, 'parcial', coalesce(v_parc, false), 'detalle', v_det);
end;
$$;

-- -----------------------------------------------------------------------------
-- evaluar_reto(interaccion, esperada, enviada) → {correcto, parcial, detalle}
--
-- UNA sala = UN mecanismo + (opcional) UNA pregunta de cierre de opción única.
-- Esta función combina las dos comparaciones; comparar_mecanismo() sola no sabe
-- nada de `cierre` y nunca lo mira.
--
-- Existe como función propia (2026-09-22) porque la necesitan DOS caminos: el
-- juego real (verificar_estacion) y el botón "Probar sala" del editor, que
-- corrige sin escribir en intentos ni progreso. Escribir la combinación dos
-- veces —una en plpgsql y otra en JS— es pedir que se desincronicen: el editor
-- le diría al docente que su sala funciona y el juego la rechazaría. Ya pasó
-- dos veces hoy con reglas duplicadas (el orden de los fragmentos del código
-- maestro, y la composición del maestro mismo). Una sola fuente de verdad.
-- -----------------------------------------------------------------------------
create or replace function evaluar_reto(p_interaccion jsonb, p_esperada jsonb, p_enviada jsonb)
returns jsonb language plpgsql immutable set search_path = public as $ev$
declare
  v_mec    jsonb;
  v_cie    jsonb;
  v_hay_c  boolean := (p_interaccion ? 'cierre');
  v_mec_ok boolean;
  v_cie_ok boolean;
begin
  v_mec := comparar_mecanismo(p_interaccion->>'tipo', p_interaccion, p_esperada, p_enviada);
  v_mec_ok := (v_mec->>'correcto')::boolean;

  if not v_hay_c then
    return v_mec;
  end if;

  v_cie := comparar_mecanismo(
             'opcion_unica',
             p_interaccion->'cierre',
             jsonb_build_object('valor', p_esperada->'cierre'),
             jsonb_build_object('valor', p_enviada->'cierre'));
  v_cie_ok := (v_cie->>'correcto')::boolean;

  if (v_mec->>'detalle') = 'vacio' and (v_cie->>'detalle') = 'vacio' then
    return jsonb_build_object('correcto', false, 'parcial', false, 'detalle', 'vacio');
  elsif v_mec_ok and v_cie_ok then
    return jsonb_build_object('correcto', true, 'parcial', false, 'detalle', null);
  elsif v_mec_ok then
    return jsonb_build_object('correcto', false, 'parcial', true, 'detalle', 'cierre-mal');
  elsif v_cie_ok then
    return jsonb_build_object('correcto', false, 'parcial', true,
                              'detalle', coalesce(nullif(v_mec->>'detalle',''), 'mecanismo-mal'));
  else
    return jsonb_build_object(
      'correcto', false,
      'parcial',  coalesce((v_mec->>'parcial')::boolean, false),
      'detalle',  case when coalesce((v_mec->>'parcial')::boolean, false)
                       then v_mec->>'detalle' else 'ambos-mal' end);
  end if;
end;
$ev$;

-- -----------------------------------------------------------------------------
-- inicializar_progreso_equipo(p_equipo) — crea una fila de `progreso` por cada
-- sala de la misión que juega ese equipo. Reemplaza el `for(let i=1;i<=5;i++)`
-- que estaba cableado en srv/rutas/docente.js. Vive acá y no en la ruta porque
-- el repartidor de equipos en lote (P6) necesita exactamente lo mismo, y dos
-- copias de esta regla en dos rutas distintas se desincronizan.
-- -----------------------------------------------------------------------------
create or replace function inicializar_progreso_equipo(p_equipo uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into progreso (equipo_id, estacion_id, estado)
  select p_equipo, e.id,
         case when e.desbloqueo = 'libre' then 'pendiente' else 'bloqueada' end
    from equipos eq
    join sesiones s   on s.id = eq.sesion_id
    join estaciones e on e.mision_id = s.mision_id
   where eq.id = p_equipo
  on conflict (equipo_id, estacion_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
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

  select * into v_est from estaciones where id = p_estacion;
  if not found then return jsonb_build_object('error', 'estacion_invalida'); end if;

  -- Desbloqueo por regla de la SALA, no por su número (2026-09-22). Antes acá
  -- estaba escrito `if p_estacion = 5 ... estacion_id in (1,2,3,4)`, que ataba
  -- el diseño del juego a que hubiera exactamente 5 salas y a que la última
  -- fuera la 5. Ahora cada sala declara su propio `desbloqueo`.
  if v_est.desbloqueo = 'secuencial' then
    if exists (select 1 from estaciones e
                 left join progreso pr on pr.estacion_id = e.id and pr.equipo_id = p_equipo
                where e.mision_id = v_est.mision_id
                  and e.orden = v_est.orden - 1
                  and coalesce(pr.estado, 'pendiente') <> 'resuelta') then
      return jsonb_build_object('error', 'bloqueada');
    end if;
  elsif v_est.desbloqueo = 'tras_todas' then
    if exists (select 1 from estaciones e
                 left join progreso pr on pr.estacion_id = e.id and pr.equipo_id = p_equipo
                where e.mision_id = v_est.mision_id
                  and e.orden < v_est.orden
                  and coalesce(pr.estado, 'pendiente') <> 'resuelta') then
      return jsonb_build_object('error', 'bloqueada');
    end if;
  end if;

  select * into v_progreso from progreso where equipo_id = p_equipo and estacion_id = p_estacion;

  if v_progreso.estado = 'resuelta' then
    return jsonb_build_object('ok', true, 'parcial', false, 'intentos', v_progreso.intentos, 'codigo', v_est.codigo, 'feedback', v_est.feedback_ok);
  end if;

  -- Comparación POR TIPO DE RETO, no por número de sala (2026-09-22).
  -- Acá vivía un `case p_estacion when 1 ... when 5` de ~90 líneas: la sala 1
  -- exigía {orden,eslabon}, la 2 y la 3 {porcentaje,...}, la 4 {actores}, la 5
  -- exactamente 5 frases. Por eso cambiar el tipo de reto de una sala desde el
  -- editor la dejaba imposible de resolver.
  --
  -- La regla completa (mecanismo + cierre opcional) vive en evaluar_reto(), que
  -- también usa el botón "Probar sala" del editor. No se duplica acá.
  declare v_ev jsonb;
  begin
    v_ev := evaluar_reto(v_est.interaccion, v_est.respuesta, p_respuesta);
    v_correcto := (v_ev->>'correcto')::boolean;
    v_parcial  := coalesce((v_ev->>'parcial')::boolean, false);
    v_detalle  := v_ev->>'detalle';
  end;

  v_intento := coalesce(v_progreso.intentos, 0) + 1;

  insert into intentos (equipo_id, estacion_id, perfil_id, respuesta, correcto, detalle)
    values (p_equipo, p_estacion, v_uid, p_respuesta, v_correcto, v_detalle);

  insert into progreso (equipo_id, estacion_id, estado, intentos, resuelta_en)
    values (p_equipo, p_estacion, case when v_correcto then 'resuelta' when v_intento>0 then 'progreso' else 'pendiente' end, v_intento, case when v_correcto then now() else null end)
  on conflict (equipo_id, estacion_id) do update set
    estado = excluded.estado, intentos = excluded.intentos, resuelta_en = excluded.resuelta_en;

  -- Desbloqueo en cascada (2026-09-22): al acertar, se revisa qué salas
  -- BLOQUEADAS de la misma misión ya cumplen su condición. Antes esto era
  -- `if p_estacion in (1,2,3,4) ... estacion_id = 5`, cableado a las 5 salas.
  if v_correcto then
    update progreso pr set estado = 'pendiente'
      from estaciones e
     where pr.equipo_id = p_equipo
       and pr.estacion_id = e.id
       and pr.estado = 'bloqueada'
       and e.mision_id = v_est.mision_id
       and not exists (
         select 1 from estaciones prev
           left join progreso pp on pp.estacion_id = prev.id and pp.equipo_id = p_equipo
          where prev.mision_id = e.mision_id
            and coalesce(pp.estado, 'pendiente') <> 'resuelta'
            and case when e.desbloqueo = 'secuencial' then prev.orden = e.orden - 1
                     when e.desbloqueo = 'tras_todas' then prev.orden < e.orden
                     else false end
       );
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
  -- 2026-09-22: antes acá estaba el literal '06-87-04-2P-4'. Ahora sale de la
  -- misión que juega este equipo. `codigo_maestro` NULL = se compone juntando
  -- los fragmentos de las salas por orden, que es el caso por defecto.
  v_mision misiones;
  v_maestro text;
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

  select m.* into v_mision
    from equipos e join sesiones s on s.id = e.sesion_id
    join misiones m on m.id = s.mision_id
   where e.id = p_equipo;
  if not found then return jsonb_build_object('error', 'sin_mision'); end if;

  v_maestro := regexp_replace(upper(coalesce(
                 v_mision.codigo_maestro,
                 (select string_agg(es.codigo, '-' order by es.orden)
                    from estaciones es where es.mision_id = v_mision.id),
                 '')), '[^A-Z0-9]', '', 'g');

  if v_maestro <> '' and v_norm = v_maestro then
    update equipos set finalizado_en = coalesce(finalizado_en, now()), motivo_fin = coalesce(motivo_fin, 'completado')
      where id = p_equipo;
    return jsonb_build_object('ok', true, 'veredicto', v_mision.veredicto);
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
