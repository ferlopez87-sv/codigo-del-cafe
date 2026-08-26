-- ============================================================================
-- El Código del Café — sql/03-funciones.sql
-- Dueño: db-funciones. Corre DESPUÉS de 01-esquema.sql y 02-rls.sql.
-- Idempotente: todo es `create or replace`; correr el archivo dos veces no falla.
--
-- Principio rector (§0.4 y §14.2 del contrato): el cliente es una interfaz,
-- no una autoridad. Las respuestas correctas viven en `estaciones.respuesta`,
-- que RLS niega leer, y solo estas funciones `security definer` las tocan.
-- El cliente manda su intento y recibe un veredicto; nunca la respuesta,
-- nunca el arreglo completo de pistas, nunca un timestamp que él controle.
--
-- Toda función `security definer` fija `set search_path = public`: sin eso,
-- quien pueda crear objetos en un esquema del search_path podría secuestrar
-- un nombre de tabla o de función y ejecutar código como el dueño (postgres).
--
-- ---------------------------------------------------------------------------
-- CONTRATO DE `estaciones.respuesta` (lo llena sql/05-seed.sql, ct-e1..ct-e5)
-- Estas funciones NO llevan la respuesta escrita adentro: la leen de la tabla.
-- Claves que cada estación debe traer (las opcionales tienen respaldo §12):
--
--   E1  {"orden": ["cultivo","cosecha","procesamiento","exportacion",
--                  "tostado","venta"],
--        "eslabon": "cultivo"}
--   E2  {"porcentaje": 87,
--        "porcentaje_acepta": [87, 87.5],   -- opcional; si falta se acepta
--                                           --   porcentaje y porcentaje+0.5
--        "rango_min": 85, "rango_max": 90,  -- opcional; banda "va por buen
--                                           --   camino" → porcentaje-fuera-rango
--        "enganosa": "si"}
--   E3  {"porcentaje_min": 4, "porcentaje_max": 4.4,  -- opcional; si faltan
--                                                     --   se usa 4–4.4 (§12)
--        "porcentaje": 4.4,                 -- opcional; siempre se acepta exacto
--        "inconsistencia": "a" | "b" | "c"}
--   E4  {"actores": ["caficultora","hija"]}
--   E5  {"frases": ["sin_evidencia","enganosa","enganosa",
--                   "sin_evidencia","verificable"]}
--
-- Todo se compara en minúsculas y sin espacios en los extremos.
-- ============================================================================


-- ============================================================================
-- 1. AYUDANTES DE COMPARACIÓN
-- Puros (immutable), sin acceso a tablas. No se otorgan a `authenticated`:
-- solo los invoca `verificar_estacion`, que corre como dueño de la función.
-- ============================================================================

-- Convierte texto a numeric sin reventar: devuelve null si no es un número.
-- Acepta coma decimal porque un teclado en español la ofrece primero.
create or replace function _cc_num_txt(p_txt text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_s text;
begin
  if p_txt is null then
    return null;
  end if;
  v_s := btrim(replace(p_txt, ',', '.'));
  if v_s = '' then
    return null;
  end if;
  begin
    return v_s::numeric;
  exception when others then
    return null;   -- basura del cliente = dato ausente, no error de servidor
  end;
end;
$$;

-- Lee una clave numérica de un jsonb. Tolera que venga como número o como
-- cadena ("87" y 87 valen igual); cualquier otra cosa es null.
create or replace function _cc_num(p_j jsonb, p_clave text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_j is null then
    return null;
  end if;
  v := p_j -> p_clave;
  if v is null or jsonb_typeof(v) not in ('number', 'string') then
    return null;
  end if;
  return _cc_num_txt(v #>> '{}');
end;
$$;

-- Lee una clave de texto normalizada: minúsculas, sin espacios en los bordes.
-- Ausente o nula devuelve '' (cadena vacía), nunca null, para simplificar
-- las comparaciones de más abajo.
create or replace function _cc_txt(p_j jsonb, p_clave text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(btrim(coalesce(p_j ->> p_clave, '')));
$$;

-- Lee una clave que debe ser un arreglo de textos y la devuelve normalizada
-- y en orden. Si la clave falta o no es arreglo, devuelve el arreglo vacío.
create or replace function _cc_lista(p_j jsonb, p_clave text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce((
    select array_agg(lower(btrim(t.x)) order by t.ord)
      from jsonb_array_elements_text(
             case when jsonb_typeof(p_j -> p_clave) = 'array'
                  then p_j -> p_clave
                  else '[]'::jsonb
             end
           ) with ordinality as t(x, ord)
     where t.x is not null
  ), '{}'::text[]);
$$;

-- Igual que _cc_lista pero para arreglos numéricos (E2: porcentaje_acepta).
create or replace function _cc_lista_num(p_j jsonb, p_clave text)
returns numeric[]
language sql
immutable
set search_path = public
as $$
  select coalesce((
    select array_agg(s.n order by s.ord)
      from (
        select _cc_num_txt(t.e #>> '{}') as n, t.ord
          from jsonb_array_elements(
                 case when jsonb_typeof(p_j -> p_clave) = 'array'
                      then p_j -> p_clave
                      else '[]'::jsonb
                 end
               ) with ordinality as t(e, ord)
         where jsonb_typeof(t.e) in ('number', 'string')
      ) s
     where s.n is not null
  ), '{}'::numeric[]);
$$;

-- Forma común del veredicto de cada comparador:
--   {"correcto": bool, "detalle": text|null, "aciertos": int, "total": int}
-- `aciertos`/`total` los usa verificar_estacion para decidir `parcial`.
create or replace function _cc_veredicto(p_correcto boolean, p_detalle text,
                                         p_aciertos int, p_total int)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
           'correcto', p_correcto,
           'detalle',  case when p_correcto then null else p_detalle end,
           'aciertos', p_aciertos,
           'total',    p_total);
$$;


-- ----------------------------------------------------------------------------
-- E1 — La cadena de valor (§12): orden exacto de 6 eslabones + eslabón elegido.
-- Claves: orden-mal · eslabon-mal · ambos-mal · vacio
-- ----------------------------------------------------------------------------
create or replace function _cc_cmp_e1(p_env jsonb, p_ok jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_orden_env text[] := _cc_lista(p_env, 'orden');
  v_orden_ok  text[] := _cc_lista(p_ok,  'orden');
  v_esl_env   text   := _cc_txt(p_env, 'eslabon');
  v_esl_ok    text   := _cc_txt(p_ok,  'eslabon');
  v_orden_bien boolean;
  v_esl_bien   boolean;
  v_ac int := 0;
begin
  -- Sin orden y sin eslabón: no mandó nada evaluable.
  if cardinality(v_orden_env) = 0 and v_esl_env = '' then
    return _cc_veredicto(false, 'vacio', 0, 2);
  end if;

  -- El orden se compara posición por posición: la secuencia ES la respuesta.
  -- (cardinality(v_orden_ok) > 0 evita dar por bueno un seed incompleto.)
  v_orden_bien := cardinality(v_orden_ok) > 0 and v_orden_env = v_orden_ok;
  v_esl_bien   := v_esl_ok <> '' and v_esl_env = v_esl_ok;

  if v_orden_bien then v_ac := v_ac + 1; end if;
  if v_esl_bien   then v_ac := v_ac + 1; end if;

  if v_orden_bien and v_esl_bien then
    return _cc_veredicto(true, null, 2, 2);
  elsif not v_orden_bien and not v_esl_bien then
    return _cc_veredicto(false, 'ambos-mal', v_ac, 2);
  elsif not v_orden_bien then
    return _cc_veredicto(false, 'orden-mal', v_ac, 2);
  else
    return _cc_veredicto(false, 'eslabon-mal', v_ac, 2);
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- E2 — Huella hídrica (§12): porcentaje (87, acepta 87.5) + juicio "engañosa".
-- Claves: porcentaje-fuera-rango · porcentaje-mal · juicio-mal · vacio
-- `porcentaje-fuera-rango` es el caso pedagógico: cayó dentro de la banda
-- 85–90 pero no en el punto medio; va por buen camino, aún no es el dato.
-- ----------------------------------------------------------------------------
create or replace function _cc_cmp_e2(p_env jsonb, p_ok jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pct_env numeric   := _cc_num(p_env, 'porcentaje');
  v_pct_ok  numeric   := _cc_num(p_ok,  'porcentaje');
  v_acepta  numeric[] := _cc_lista_num(p_ok, 'porcentaje_acepta');
  v_rmin    numeric   := coalesce(_cc_num(p_ok, 'rango_min'), 85);
  v_rmax    numeric   := coalesce(_cc_num(p_ok, 'rango_max'), 90);
  v_jui_env text      := _cc_txt(p_env, 'enganosa');
  v_jui_ok  text      := _cc_txt(p_ok,  'enganosa');
  v_pct_bien boolean;
  v_jui_bien boolean;
  v_ac int := 0;
begin
  -- Ni número ni juicio: no mandó nada evaluable.
  if v_pct_env is null and v_jui_env = '' then
    return _cc_veredicto(false, 'vacio', 0, 2);
  end if;

  -- Valores aceptados: el canónico de la tabla más los que el seed declare.
  -- Si el seed no declara `porcentaje_acepta`, se aplica la tolerancia de §12
  -- ("87, acepta 87.5") como canónico y canónico + 0.5.
  if cardinality(v_acepta) = 0 and v_pct_ok is not null then
    v_acepta := array[v_pct_ok, v_pct_ok + 0.5];
  elsif v_pct_ok is not null then
    v_acepta := v_acepta || v_pct_ok;
  end if;

  v_pct_bien := v_pct_env is not null
                and cardinality(v_acepta) > 0
                and v_pct_env = any (v_acepta);
  v_jui_bien := v_jui_ok <> '' and v_jui_env = v_jui_ok;

  if v_pct_bien then v_ac := v_ac + 1; end if;
  if v_jui_bien then v_ac := v_ac + 1; end if;

  if v_pct_bien and v_jui_bien then
    return _cc_veredicto(true, null, 2, 2);
  end if;

  -- Prioridad de la clave de error: primero el dato, después el juicio.
  if not v_pct_bien then
    if v_pct_env is not null and v_pct_env >= v_rmin and v_pct_env <= v_rmax then
      return _cc_veredicto(false, 'porcentaje-fuera-rango', v_ac, 2);
    else
      return _cc_veredicto(false, 'porcentaje-mal', v_ac, 2);
    end if;
  end if;

  return _cc_veredicto(false, 'juicio-mal', v_ac, 2);
end;
$$;


-- ----------------------------------------------------------------------------
-- E3 — El reparto de los US$4.00 (§12): porcentaje entre 4 y 4.4 inclusive
-- + la inconsistencia correcta ("a" | "b" | "c").
-- Claves: porcentaje-mal · inconsistencia-mal · vacio
-- ----------------------------------------------------------------------------
create or replace function _cc_cmp_e3(p_env jsonb, p_ok jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pct_env numeric := _cc_num(p_env, 'porcentaje');
  v_pct_ok  numeric := _cc_num(p_ok,  'porcentaje');
  -- Rango declarado por el seed; si falta, el de §12: 4 – 4.4 inclusive.
  v_min numeric := coalesce(_cc_num(p_ok, 'porcentaje_min'), 4);
  v_max numeric := coalesce(_cc_num(p_ok, 'porcentaje_max'), 4.4);
  v_inc_env text := _cc_txt(p_env, 'inconsistencia');
  v_inc_ok  text := _cc_txt(p_ok,  'inconsistencia');
  v_pct_bien boolean;
  v_inc_bien boolean;
  v_ac int := 0;
begin
  if v_pct_env is null and v_inc_env = '' then
    return _cc_veredicto(false, 'vacio', 0, 2);
  end if;

  -- Vale cualquier valor dentro del rango, y también el canónico exacto
  -- (por si el seed declara un `porcentaje` fuera de los límites que fijó).
  v_pct_bien := v_pct_env is not null
                and ( (v_pct_env >= v_min and v_pct_env <= v_max)
                      or (v_pct_ok is not null and v_pct_env = v_pct_ok) );
  v_inc_bien := v_inc_ok <> '' and v_inc_env = v_inc_ok;

  if v_pct_bien then v_ac := v_ac + 1; end if;
  if v_inc_bien then v_ac := v_ac + 1; end if;

  if v_pct_bien and v_inc_bien then
    return _cc_veredicto(true, null, 2, 2);
  elsif not v_pct_bien then
    return _cc_veredicto(false, 'porcentaje-mal', v_ac, 2);
  else
    return _cc_veredicto(false, 'inconsistencia-mal', v_ac, 2);
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- E4 — Quién carga el riesgo (§12): el conjunto EXACTO ["caficultora","hija"],
-- sin importar el orden, ni uno más ni uno menos.
-- Claves: sobre-marcado · sub-marcado · equivocados · vacio
-- ----------------------------------------------------------------------------
create or replace function _cc_cmp_e4(p_env jsonb, p_ok jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_env text[] := _cc_lista(p_env, 'actores');
  v_ok  text[] := _cc_lista(p_ok,  'actores');
  v_env_u text[];   -- sin repetidos: marcar dos veces no suma
  v_ok_u  text[];
  v_inter int;      -- aciertos
  v_extra int;      -- marcados de más
  v_falta int;      -- marcados de menos
begin
  if cardinality(v_env) = 0 then
    return _cc_veredicto(false, 'vacio', 0, greatest(cardinality(v_ok), 1));
  end if;

  select coalesce(array_agg(distinct x), '{}'::text[]) into v_env_u
    from unnest(v_env) as x;
  select coalesce(array_agg(distinct x), '{}'::text[]) into v_ok_u
    from unnest(v_ok) as x;

  select count(*) into v_inter from unnest(v_env_u) as x where x = any (v_ok_u);
  select count(*) into v_extra from unnest(v_env_u) as x where not (x = any (v_ok_u));
  select count(*) into v_falta from unnest(v_ok_u)  as x where not (x = any (v_env_u));

  if v_extra = 0 and v_falta = 0 and cardinality(v_ok_u) > 0 then
    return _cc_veredicto(true, null, v_inter, cardinality(v_ok_u));
  elsif v_falta = 0 and v_extra > 0 then
    -- Tiene a los dos correctos, pero además señaló a quien no carga el riesgo.
    return _cc_veredicto(false, 'sobre-marcado', v_inter, cardinality(v_ok_u));
  elsif v_falta > 0 and v_extra = 0 then
    -- Solo señaló correctos, pero le falta alguno.
    return _cc_veredicto(false, 'sub-marcado', v_inter, cardinality(v_ok_u));
  else
    -- Le falta alguno Y marcó de más (incluye el caso "todo mal").
    return _cc_veredicto(false, 'equivocados', v_inter, cardinality(v_ok_u));
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- E5 — Clasificación de las 5 frases (§12). Se compara posición por posición.
-- Clave: parcial-{n}, con n = cantidad de aciertos (también parcial-0).
-- ----------------------------------------------------------------------------
create or replace function _cc_cmp_e5(p_env jsonb, p_ok jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_env text[] := _cc_lista(p_env, 'frases');
  v_ok  text[] := _cc_lista(p_ok,  'frases');
  v_total int := cardinality(v_ok);
  v_ac int := 0;
  i int;
begin
  if cardinality(v_env) = 0 then
    return _cc_veredicto(false, 'vacio', 0, greatest(v_total, 1));
  end if;

  -- Una frase sin clasificar (posición faltante) simplemente no acierta.
  for i in 1 .. v_total loop
    if i <= cardinality(v_env) and v_env[i] is not null and v_env[i] = v_ok[i] then
      v_ac := v_ac + 1;
    end if;
  end loop;

  if v_total > 0 and v_ac = v_total and cardinality(v_env) = v_total then
    return _cc_veredicto(true, null, v_ac, v_total);
  end if;

  -- El detalle dice CUÁNTAS acertó, nunca CUÁLES: orienta sin revelar.
  return _cc_veredicto(false, 'parcial-' || v_ac::text, v_ac, greatest(v_total, 1));
end;
$$;


-- ============================================================================
-- 2. verificar_estacion — el corazón del sistema (§4.1)
-- El cliente nunca conoce las respuestas: las manda aquí y esta función decide.
-- Orden de validaciones ESTRICTO, tal como lo fija §4.1.
-- ============================================================================
create or replace function verificar_estacion(p_equipo uuid, p_estacion int,
                                              p_respuesta jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil  uuid := auth.uid();
  v_ahora   timestamptz := now();          -- ÚNICA fuente de tiempo. Nunca el cliente.
  v_equipo  equipos%rowtype;
  v_sesion  sesiones%rowtype;
  v_est     estaciones%rowtype;
  v_prog    progreso%rowtype;
  v_env     jsonb := coalesce(p_respuesta, '{}'::jsonb);
  v_limite  timestamptz;
  v_resueltas int;
  v_cmp     jsonb;
  v_correcto boolean;
  v_parcial  boolean;
  v_detalle  text;
  v_aciertos int;
  v_intentos int;
  v_pista    text;
  v_idx      int;
  v_npistas  int;
begin
  ---------------------------------------------------------------------------
  -- (1) ¿Quien llama pertenece a este equipo? Sin sesión de Auth no hay nada
  -- que discutir. La pertenencia se lee de `integrantes`, no de un parámetro.
  ---------------------------------------------------------------------------
  if v_perfil is null or p_equipo is null then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  if not exists (select 1
                   from integrantes i
                  where i.equipo_id = p_equipo
                    and i.perfil_id = v_perfil) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  -- Guarda de cordura del parámetro (no está en §4.1, pero evita un error
  -- crudo de Postgres si el cliente manda una estación inexistente).
  if p_estacion is null or p_estacion < 1 or p_estacion > 5 then
    return jsonb_build_object('error', 'estacion_invalida');
  end if;

  -- `for update` serializa los envíos simultáneos de dos integrantes del mismo
  -- equipo: sin esto, dos respuestas a la vez podrían contar un solo intento.
  select * into v_equipo from equipos e where e.id = p_equipo for update;
  if not found then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  ---------------------------------------------------------------------------
  -- (2) La sesión de clase debe estar abierta. Cerrada o en borrador, nadie
  -- juega: ni antes de que el docente abra, ni después de que cierre.
  ---------------------------------------------------------------------------
  select * into v_sesion from sesiones s where s.id = v_equipo.sesion_id;
  if not found or v_sesion.estado <> 'abierta' then
    return jsonb_build_object('error', 'sesion_cerrada');
  end if;

  ---------------------------------------------------------------------------
  -- (3) Primer acceso del equipo: el servidor sella el arranque del reloj.
  -- El cronómetro del navegador es decorado; este timestamp es la verdad.
  ---------------------------------------------------------------------------
  if v_equipo.iniciado_en is null then
    update equipos
       set iniciado_en = v_ahora
     where id = p_equipo
    returning * into v_equipo;
  end if;

  ---------------------------------------------------------------------------
  -- (4) ¿Venció el tiempo? Se calcula con la duración de la sesión y `now()`.
  -- Al vencer se sella el fin del equipo y no se acepta ni un intento más.
  ---------------------------------------------------------------------------
  v_limite := v_equipo.iniciado_en + make_interval(mins => v_sesion.duracion_minutos);
  if v_ahora > v_limite then
    update equipos
       set finalizado_en = coalesce(finalizado_en, v_limite),
           motivo_fin    = coalesce(motivo_fin, 'tiempo')   -- no pisa 'completado'
     where id = p_equipo;
    return jsonb_build_object('error', 'tiempo_agotado');
  end if;

  ---------------------------------------------------------------------------
  -- (5) La estación 5 exige las cuatro anteriores resueltas. Se comprueba
  -- contra `progreso`, que solo escribe esta función: el cliente no decide.
  ---------------------------------------------------------------------------
  if p_estacion = 5 then
    select count(*) into v_resueltas
      from progreso pr
     where pr.equipo_id = p_equipo
       and pr.estacion_id between 1 and 4
       and pr.estado = 'resuelta';
    if v_resueltas < 4 then
      return jsonb_build_object('error', 'bloqueada');
    end if;
  end if;

  -- Contenido y respuesta de la estación. `estaciones` no tiene política de
  -- select (§3): solo se lee desde aquí, por ser security definer.
  select * into v_est from estaciones es where es.id = p_estacion;
  if not found then
    return jsonb_build_object('error', 'estacion_invalida');
  end if;

  ---------------------------------------------------------------------------
  -- (6) Si ya está resuelta se devuelve el mismo resultado sin registrar un
  -- intento nuevo: reabrir la tarjeta no ensucia las estadísticas del equipo.
  ---------------------------------------------------------------------------
  select * into v_prog
    from progreso pr
   where pr.equipo_id = p_equipo
     and pr.estacion_id = p_estacion
   for update;

  if found and v_prog.estado = 'resuelta' then
    return jsonb_build_object(
             'ok',       true,
             'parcial',  false,
             'intentos', v_prog.intentos,
             'codigo',   v_est.codigo,
             'feedback', v_est.feedback_ok);
  end if;

  ---------------------------------------------------------------------------
  -- (7) Comparación contra `estaciones.respuesta` según §12. La lógica de
  -- cada estación vive en su ayudante; aquí solo se despacha.
  ---------------------------------------------------------------------------
  v_cmp := case p_estacion
             when 1 then _cc_cmp_e1(v_env, v_est.respuesta)
             when 2 then _cc_cmp_e2(v_env, v_est.respuesta)
             when 3 then _cc_cmp_e3(v_env, v_est.respuesta)
             when 4 then _cc_cmp_e4(v_env, v_est.respuesta)
             when 5 then _cc_cmp_e5(v_env, v_est.respuesta)
           end;

  v_correcto := coalesce((v_cmp ->> 'correcto')::boolean, false);
  v_detalle  := v_cmp ->> 'detalle';
  v_aciertos := coalesce((v_cmp ->> 'aciertos')::int, 0);
  -- parcial = al menos un acierto pero no todos: "vas por buen camino"
  -- sin decir cuál acertó.
  v_parcial  := (not v_correcto) and v_aciertos >= 1;

  ---------------------------------------------------------------------------
  -- (8) Bitácora del intento y avance del progreso, siempre con `now()` del
  -- servidor. Estas dos tablas son de solo lectura para el estudiante (§3):
  -- este es el único camino por el que se escriben.
  ---------------------------------------------------------------------------
  insert into intentos (equipo_id, estacion_id, perfil_id, respuesta,
                        correcto, detalle, creado_en)
  values (p_equipo, p_estacion, v_perfil, v_env,
          v_correcto, v_detalle, v_ahora);

  insert into progreso (equipo_id, estacion_id, estado, intentos, resuelta_en)
  values (p_equipo, p_estacion,
          case when v_correcto then 'resuelta' else 'progreso' end,
          1,
          case when v_correcto then v_ahora else null end)
  on conflict (equipo_id, estacion_id) do update
     set intentos    = progreso.intentos + 1,
         estado      = case when v_correcto then 'resuelta' else 'progreso' end,
         resuelta_en = case when v_correcto then v_ahora else progreso.resuelta_en end
  returning intentos into v_intentos;

  ---------------------------------------------------------------------------
  -- (9) Respuesta al cliente. Al acertar viaja el fragmento del código y el
  -- feedback; al fallar viaja UNA pista y la clave de error. Jamás la
  -- respuesta correcta ni el arreglo completo de pistas.
  ---------------------------------------------------------------------------
  if v_correcto then
    return jsonb_build_object(
             'ok',       true,
             'parcial',  false,
             'intentos', v_intentos,
             'codigo',   v_est.codigo,
             'feedback', v_est.feedback_ok);
  end if;

  -- Pista escalonada: intento 1 → pistas[0], 2 → pistas[1], 3 o más → pistas[2].
  v_idx := least(coalesce(v_intentos, 1), 3) - 1;
  if jsonb_typeof(v_est.pistas) = 'array' then
    v_npistas := jsonb_array_length(v_est.pistas);
    if v_npistas > 0 then
      -- Si el seed trae menos de 3 pistas, se repite la última disponible.
      v_pista := v_est.pistas ->> least(v_idx, v_npistas - 1);
    end if;
  elsif jsonb_typeof(v_est.pistas) = 'object' then
    -- Respaldo por si las pistas vinieran como objeto {"1":…,"2":…,"3":…}.
    v_pista := v_est.pistas ->> (v_idx + 1)::text;
  end if;

  return jsonb_build_object(
           'ok',       false,
           'parcial',  v_parcial,
           'intentos', v_intentos,
           'detalle',  coalesce(v_detalle, 'vacio'),
           'pista',    coalesce(v_pista, ''));
end;
$$;


-- ============================================================================
-- 3. estado_juego (§4.2) — progreso de las 5 estaciones + segundos restantes
-- calculados en el servidor (§4: "el cliente los muestra, nunca es su fuente
-- de verdad"). Lo puede consultar un integrante del equipo o su docente.
-- ============================================================================
create or replace function estado_juego(p_equipo uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil uuid := auth.uid();
  v_ahora  timestamptz := now();
  v_equipo equipos%rowtype;
  v_sesion sesiones%rowtype;
  v_limite timestamptz;
  v_seg    int;
  v_res    int;
  v_estaciones jsonb;
begin
  if v_perfil is null or p_equipo is null then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  select * into v_equipo from equipos e where e.id = p_equipo;
  if not found then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  select * into v_sesion from sesiones s where s.id = v_equipo.sesion_id;

  -- Integrante del equipo, o docente dueño de la sesión. Nadie más.
  if not exists (select 1 from integrantes i
                  where i.equipo_id = p_equipo and i.perfil_id = v_perfil)
     and coalesce(v_sesion.docente_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_perfil then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  -- Cuántas de las cuatro primeras están resueltas: define si la 5 sigue bloqueada.
  select count(*) into v_res
    from progreso pr
   where pr.equipo_id = p_equipo
     and pr.estacion_id between 1 and 4
     and pr.estado = 'resuelta';

  -- Segundos restantes = iniciado_en + duración − now(), calculado aquí.
  if v_equipo.iniciado_en is null then
    -- Aún no arranca el reloj: le queda la duración completa.
    v_seg := coalesce(v_sesion.duracion_minutos, 0) * 60;
  else
    v_limite := v_equipo.iniciado_en
                + make_interval(mins => coalesce(v_sesion.duracion_minutos, 0));
    if v_equipo.finalizado_en is not null then
      -- Partida cerrada: el reloj queda congelado en el momento del cierre.
      v_seg := greatest(0, floor(extract(epoch from (v_limite - v_equipo.finalizado_en))))::int;
    else
      v_seg := greatest(0, floor(extract(epoch from (v_limite - v_ahora))))::int;
    end if;
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'estacion_id', g.id,
             'estado', case
                         when pr.estado = 'resuelta' then 'resuelta'
                         when g.id = 5 and v_res < 4 then 'bloqueada'
                         when g.id = 5 and coalesce(pr.estado, 'pendiente') = 'bloqueada'
                              then 'pendiente'
                         else coalesce(pr.estado, 'pendiente')
                       end,
             'intentos', coalesce(pr.intentos, 0),
             'resuelta_en', pr.resuelta_en,
             -- El fragmento del código solo viaja si ya se ganó.
             'codigo', case when pr.estado = 'resuelta' then es.codigo else null end)
           order by g.id)
    into v_estaciones
    from generate_series(1, 5) as g(id)
    left join progreso pr
           on pr.equipo_id = p_equipo and pr.estacion_id = g.id
    left join estaciones es on es.id = g.id;

  return jsonb_build_object(
    'equipo', jsonb_build_object(
                'id',            v_equipo.id,
                'nombre',        v_equipo.nombre,
                'iniciado_en',   v_equipo.iniciado_en,
                'finalizado_en', v_equipo.finalizado_en,
                'motivo_fin',    v_equipo.motivo_fin),
    'sesion', jsonb_build_object(
                'id',               v_sesion.id,
                'nombre',           v_sesion.nombre,
                'estado',           v_sesion.estado,
                'duracion_minutos', v_sesion.duracion_minutos),
    'estaciones',         coalesce(v_estaciones, '[]'::jsonb),
    'resueltas',          v_res + (case when exists (select 1 from progreso pr
                                                      where pr.equipo_id = p_equipo
                                                        and pr.estacion_id = 5
                                                        and pr.estado = 'resuelta')
                                        then 1 else 0 end),
    'segundos_restantes', v_seg,
    'tiempo_agotado',     (v_equipo.iniciado_en is not null and v_seg = 0),
    'servidor_en',        v_ahora);
end;
$$;


-- ============================================================================
-- 4. mi_equipo (§4.2) — equipo, sesión, integrantes y progreso de quien llama,
-- o `null` si el docente todavía no lo asignó (caso normal, no error: la
-- interfaz muestra "Tu docente aún no te asignó equipo", §1).
-- ============================================================================
create or replace function mi_equipo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil uuid := auth.uid();
  v_equipo_id uuid;
  v_integrantes jsonb;
  v_estado jsonb;
begin
  if v_perfil is null then
    return null;
  end if;

  -- Una persona puede haber jugado en varias sesiones a lo largo del curso:
  -- gana la sesión abierta y, entre varias, la más reciente.
  select e.id into v_equipo_id
    from integrantes i
    join equipos e  on e.id = i.equipo_id
    join sesiones s on s.id = e.sesion_id
   where i.perfil_id = v_perfil
   order by (s.estado = 'abierta') desc, s.creada_en desc
   limit 1;

  if v_equipo_id is null then
    return null;   -- todavía sin equipo
  end if;

  select jsonb_agg(jsonb_build_object('id', pf.id, 'nombre', pf.nombre)
                   order by pf.nombre)
    into v_integrantes
    from integrantes i
    join perfiles pf on pf.id = i.perfil_id
   where i.equipo_id = v_equipo_id;

  -- Reutiliza estado_juego para no duplicar el cálculo del reloj ni del progreso.
  v_estado := estado_juego(v_equipo_id);
  if (v_estado ->> 'error') is not null then
    return v_estado;
  end if;

  return v_estado || jsonb_build_object('integrantes', coalesce(v_integrantes, '[]'::jsonb));
end;
$$;


-- ============================================================================
-- 5. verificar_maestro (§4.2, §12) — valida el código maestro 06-87-04-2P-4.
-- Normaliza mayúsculas, espacios y guiones (y cualquier otro separador que
-- alguien escriba a mano). Al acertar sella finalizado_en y 'completado'.
-- ============================================================================
create or replace function verificar_maestro(p_equipo uuid, p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil uuid := auth.uid();
  v_ahora  timestamptz := now();
  v_equipo equipos%rowtype;
  v_sesion sesiones%rowtype;
  v_limite timestamptz;
  v_env    text;
  v_esperado text;
  v_fragmentos text;
  v_acierto boolean;
begin
  -- (1) Pertenencia al equipo.
  if v_perfil is null or p_equipo is null then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  if not exists (select 1 from integrantes i
                  where i.equipo_id = p_equipo and i.perfil_id = v_perfil) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  select * into v_equipo from equipos e where e.id = p_equipo for update;
  if not found then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  -- Normalización: fuera todo lo que no sea letra o dígito, y a mayúsculas.
  -- Así "06 87 04 2p 4", "06-87-04-2P-4" y "0687042p4" son el mismo código.
  v_env := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));

  -- El código esperado se arma con los fragmentos de las 5 estaciones; si el
  -- seed aún no está completo, se cae al valor del contrato (§12).
  select string_agg(es.codigo, '' order by es.id) into v_fragmentos from estaciones es;
  v_esperado := upper(regexp_replace(coalesce(v_fragmentos, ''), '[^A-Za-z0-9]', '', 'g'));

  v_acierto := v_env <> ''
               and ( (v_esperado <> '' and v_env = v_esperado)
                     or v_env = upper(regexp_replace('06-87-04-2P-4', '[^A-Za-z0-9]', '', 'g')) );

  -- Si el equipo ya ganó no se vuelve a sellar nada, pero el veredicto sobre el
  -- código sigue siendo honesto: mal escrito es mal escrito.
  if v_equipo.motivo_fin = 'completado' then
    return jsonb_build_object(
             'ok', v_acierto,
             'detalle', case when v_acierto then null
                             when v_env = '' then 'vacio'
                             else 'codigo-mal' end,
             'finalizado_en', v_equipo.finalizado_en);
  end if;

  -- (2) Sesión abierta.
  select * into v_sesion from sesiones s where s.id = v_equipo.sesion_id;
  if not found or v_sesion.estado <> 'abierta' then
    return jsonb_build_object('error', 'sesion_cerrada');
  end if;

  -- (3) y (4) Reloj: mismo criterio que verificar_estacion.
  if v_equipo.iniciado_en is null then
    update equipos set iniciado_en = v_ahora where id = p_equipo
    returning * into v_equipo;
  end if;

  v_limite := v_equipo.iniciado_en + make_interval(mins => v_sesion.duracion_minutos);
  if v_ahora > v_limite then
    update equipos
       set finalizado_en = coalesce(finalizado_en, v_limite),
           motivo_fin    = coalesce(motivo_fin, 'tiempo')
     where id = p_equipo;
    return jsonb_build_object('error', 'tiempo_agotado');
  end if;

  -- Veredicto sobre el código. No se registra intento: `intentos` es por
  -- estación (FK 1–5) y el maestro no es una estación.
  if not v_acierto then
    return jsonb_build_object('ok', false,
                              'detalle', case when v_env = '' then 'vacio'
                                              else 'codigo-mal' end);
  end if;

  -- Acierto: se sella el fin de la partida con la hora del servidor.
  update equipos
     set finalizado_en = coalesce(finalizado_en, v_ahora),
         motivo_fin    = 'completado'
   where id = p_equipo
  returning * into v_equipo;

  return jsonb_build_object(
           'ok', true,
           'finalizado_en', v_equipo.finalizado_en,
           'segundos_restantes',
           greatest(0, floor(extract(epoch from (v_limite - v_equipo.finalizado_en))))::int);
end;
$$;


-- ============================================================================
-- 6. cerrar_sesion_clase (§4.2) — solo el docente dueño. Cierra la sesión y
-- finaliza los equipos que quedaron abiertos (motivo 'cerrado').
-- ============================================================================
create or replace function cerrar_sesion_clase(p_sesion uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil uuid := auth.uid();
  v_ahora  timestamptz := now();
  v_equipos int := 0;
begin
  -- La propiedad de la sesión es la única credencial que vale aquí.
  if v_perfil is null or p_sesion is null then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  if not exists (select 1 from sesiones s
                  where s.id = p_sesion and s.docente_id = v_perfil) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  update sesiones
     set estado    = 'cerrada',
         cerrada_en = coalesce(cerrada_en, v_ahora)
   where id = p_sesion;

  -- Los equipos que no terminaron quedan sellados con la hora del servidor.
  with cerrados as (
    update equipos
       set finalizado_en = v_ahora,
           motivo_fin    = 'cerrado'
     where sesion_id = p_sesion
       and finalizado_en is null
    returning 1)
  select count(*) into v_equipos from cerrados;

  return jsonb_build_object('ok', true,
                            'cerrada_en', v_ahora,
                            'equipos_finalizados', v_equipos);
end;
$$;


-- ============================================================================
-- 7. anonimizar_sesion (§4.2, §14.3) — solo el docente dueño. Sustituye
-- nombre, carné y correo por marcadores estables, sin borrar una sola fila de
-- intentos, progreso ni calificaciones: el desempeño se conserva íntegro.
-- Idempotente: un perfil ya anonimizado no se vuelve a tocar.
-- ============================================================================
create or replace function anonimizar_sesion(p_sesion uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perfil uuid := auth.uid();
  v_n int := 0;
begin
  if v_perfil is null or p_sesion is null then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  if not exists (select 1 from sesiones s
                  where s.id = p_sesion and s.docente_id = v_perfil) then
    return jsonb_build_object('error', 'no_autorizado');
  end if;

  -- El marcador se deriva del id del perfil: es estable entre corridas y
  -- respeta el `unique` de carné sin necesidad de un contador.
  with objetivo as (
    select distinct i.perfil_id
      from integrantes i
      join equipos e on e.id = i.equipo_id
     where e.sesion_id = p_sesion
  ), anonimizados as (
    update perfiles p
       set nombre = 'Participante ' || upper(substr(md5(p.id::text), 1, 4)),
           carne  = 'ANON-' || upper(substr(md5(p.id::text), 1, 8)),
           correo = 'anon-' || substr(md5(p.id::text), 1, 12) || '@anonimo.invalid'
      from objetivo o
     where p.id = o.perfil_id
       and p.rol = 'estudiante'          -- el docente no se anonimiza a sí mismo
       and p.carne not like 'ANON-%'     -- ya anonimizado: no se toca
    returning 1)
  select count(*) into v_n from anonimizados;

  return jsonb_build_object('ok', true, 'perfiles_anonimizados', v_n);
end;
$$;


-- ============================================================================
-- 8. PERMISOS
-- Deny by default también aquí: se revoca a PUBLIC y se otorga solo a
-- `authenticated`. Los ayudantes de comparación no se otorgan a nadie: los
-- invoca `verificar_estacion`, que corre con los privilegios de su dueño.
-- ============================================================================

revoke execute on function _cc_num_txt(text)              from public;
revoke execute on function _cc_num(jsonb, text)           from public;
revoke execute on function _cc_txt(jsonb, text)           from public;
revoke execute on function _cc_lista(jsonb, text)         from public;
revoke execute on function _cc_lista_num(jsonb, text)     from public;
revoke execute on function _cc_veredicto(boolean, text, int, int) from public;
revoke execute on function _cc_cmp_e1(jsonb, jsonb)       from public;
revoke execute on function _cc_cmp_e2(jsonb, jsonb)       from public;
revoke execute on function _cc_cmp_e3(jsonb, jsonb)       from public;
revoke execute on function _cc_cmp_e4(jsonb, jsonb)       from public;
revoke execute on function _cc_cmp_e5(jsonb, jsonb)       from public;

revoke execute on function verificar_estacion(uuid, int, jsonb) from public;
grant  execute on function verificar_estacion(uuid, int, jsonb) to authenticated;

revoke execute on function estado_juego(uuid) from public;
grant  execute on function estado_juego(uuid) to authenticated;

revoke execute on function mi_equipo() from public;
grant  execute on function mi_equipo() to authenticated;

revoke execute on function verificar_maestro(uuid, text) from public;
grant  execute on function verificar_maestro(uuid, text) to authenticated;

revoke execute on function cerrar_sesion_clase(uuid) from public;
grant  execute on function cerrar_sesion_clase(uuid) to authenticated;

revoke execute on function anonimizar_sesion(uuid) from public;
grant  execute on function anonimizar_sesion(uuid) to authenticated;

comment on function verificar_estacion(uuid, int, jsonb) is
  'Corazón del juego: valida pertenencia, sesión, reloj y bloqueo; compara contra estaciones.respuesta (§12); registra intento y progreso con now() del servidor; devuelve veredicto con UNA pista, nunca la respuesta.';
comment on function estado_juego(uuid) is
  'Progreso de las 5 estaciones y segundos restantes calculados en el servidor.';
comment on function mi_equipo() is
  'Equipo, sesión, integrantes y progreso de auth.uid(); null si aún no tiene equipo.';
comment on function verificar_maestro(uuid, text) is
  'Valida el código maestro normalizado; al acertar sella finalizado_en y motivo_fin = completado.';
comment on function cerrar_sesion_clase(uuid) is
  'Solo docente dueño: cierra la sesión y finaliza los equipos abiertos.';
comment on function anonimizar_sesion(uuid) is
  'Solo docente dueño: sustituye nombre, carné y correo por marcadores conservando el desempeño.';

-- Fin de sql/03-funciones.sql
