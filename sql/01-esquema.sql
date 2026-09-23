-- =============================================================================
-- El Código del Café — 01-esquema.sql
-- Esquema Render/Node/Postgres (sin Supabase). CONTRACT.md §2. Idempotente.
-- Orden: 00-roles → 01-esquema → 02-rls → 03-funciones → 04-docentes → 05-seed → 06-superadmin
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 2.0 / 2.1 — Identidad y sesión (perfiles ya no depende de auth.users)
-- -----------------------------------------------------------------------------
create table if not exists perfiles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 2 and 80),
  carne       text not null unique check (length(trim(carne)) between 3 and 20),
  correo      text not null unique,
  rol         text not null default 'estudiante' check (rol in ('estudiante','docente')),
  creado_en   timestamptz not null default now()
);

create table if not exists codigos_verificacion (
  correo      text primary key,
  codigo_hash text not null,
  intentos    int  not null default 0,
  expira_en   timestamptz not null,
  creado_en   timestamptz not null default now()
);

create table if not exists sesiones_login (
  token_hash  text primary key,
  perfil_id   uuid not null references perfiles(id) on delete cascade,
  creada_en   timestamptz not null default now(),
  expira_en   timestamptz not null,
  user_agent  text
);
create index if not exists sesiones_login_perfil on sesiones_login(perfil_id);

-- -----------------------------------------------------------------------------
-- 2.3 — Tablas de gobierno
-- -----------------------------------------------------------------------------
create table if not exists docentes_autorizados (
  correo text primary key, nota text, creado_en timestamptz default now()
);
create table if not exists configuracion ( clave text primary key, valor text );
insert into configuracion (clave, valor) values ('dominio_institucional_aviso', '@monicaherrera.edu.sv')
  on conflict (clave) do nothing;

-- -----------------------------------------------------------------------------
-- 2.2 — Tablas de juego
-- -----------------------------------------------------------------------------

-- misiones (2026-09-22) — una misión es UN escape room completo: sus salas, su
-- portada, su código maestro y su veredicto. Antes no existía el concepto: la
-- tabla `estaciones` era una sola tanda global de 5 filas compartida por todas
-- las sesiones de todos los docentes, con `check (id between 1 and 5)`. Eso
-- hacía imposible (a) agregar o quitar salas, (b) tener dos casos vivos a la
-- vez, y (c) editar el contenido de la próxima clase sin alterar lo que ya
-- jugaron las secciones anteriores. Ahora `estaciones` cuelga de acá y
-- `sesiones.mision_id` decide qué se juega ese día.
--
-- `codigo_maestro` nullable a propósito: NULL = se compone juntando los
-- fragmentos `estaciones.codigo` por `orden`. Escribirlo a mano es la
-- excepción, para misiones donde el maestro no es la suma de sus partes.
create table if not exists misiones (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  titulo          text not null,
  subtitulo       text,
  intro           text,
  codigo_maestro  text,
  veredicto       text not null,
  estado          text not null default 'borrador' check (estado in ('borrador','publicada','archivada')),
  autor_id        uuid references perfiles(id),
  creada_en       timestamptz not null default now()
);

create table if not exists sesiones (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  docente_id        uuid not null references perfiles(id),
  duracion_minutos  int  not null default 50 check (duracion_minutos between 5 and 180),
  estado            text not null default 'borrador' check (estado in ('borrador','abierta','cerrada')),
  creada_en         timestamptz not null default now(),
  cerrada_en        timestamptz
);

-- Qué misión se juega en esta sesión de clase. `alter` y no columna en el
-- `create table` de arriba porque esa sentencia ya no corre en instalaciones
-- existentes (la tabla ya existe) — mismo patrón que integrantes.primer_acceso_en.
alter table sesiones add column if not exists mision_id uuid references misiones(id);

-- 2.4 — Nómina (referencia a sesiones, va antes de equipos por orden de FKs; equipos también referencia sesiones)
create table if not exists nomina (
  id         uuid primary key default gen_random_uuid(),
  sesion_id  uuid not null references sesiones(id) on delete cascade,
  nombre     text not null,
  correo     text not null,
  carne      text not null,
  perfil_id  uuid references perfiles(id),
  creada_en  timestamptz not null default now(),
  unique (sesion_id, correo), unique (sesion_id, carne)
);

create table if not exists equipos (
  id             uuid primary key default gen_random_uuid(),
  sesion_id      uuid not null references sesiones(id) on delete cascade,
  nombre         text not null,
  iniciado_en    timestamptz,
  finalizado_en  timestamptz,
  motivo_fin     text check (motivo_fin in ('completado','tiempo','cerrado')),
  unique (sesion_id, nombre),
  unique (id, sesion_id) -- necesaria como blanco de la FK compuesta de integrantes, abajo
);

-- integrantes.sesion_id va DESNORMALIZADA (no la manda quien inserta — un
-- trigger la rellena desde equipos). Postgres no permite subconsultas dentro
-- de una expresión de índice, así que "una persona no puede estar en dos
-- equipos de la misma sesión" no se puede expresar como índice único sobre
-- equipos.sesion_id directamente; se necesita la columna propia.
create table if not exists integrantes (
  equipo_id     uuid not null references equipos(id) on delete cascade,
  perfil_id     uuid not null references perfiles(id) on delete cascade,
  sesion_id     uuid, -- la rellena trg_integrantes_sesion antes de cada insert/update
  es_apuntador  boolean not null default false,
  primary key (equipo_id, perfil_id),
  foreign key (equipo_id, sesion_id) references equipos(id, sesion_id)
);

-- 2026-08-28 (pedido de Fernando): "si un usuario ya entró, otro no puede
-- usar su lugar" — el acceso por código de equipo dejaba elegir cualquier
-- nombre de la lista sin marcar que alguien ya lo había reclamado, así que
-- dos personas podían entrar como la misma identidad. `alter table` en vez
-- de meter la columna en el `create table` de arriba porque esa sentencia
-- ya no corre en instalaciones existentes (la tabla ya existe) — así sí
-- llega a Render en el próximo arranque.
alter table integrantes add column if not exists primer_acceso_en timestamptz;

create or replace function trg_integrantes_sesion() returns trigger
language plpgsql as $$
begin
  select sesion_id into NEW.sesion_id from equipos where id = NEW.equipo_id;
  return NEW;
end;
$$;
drop trigger if exists integrantes_sesion_bi on integrantes;
create trigger integrantes_sesion_bi before insert or update of equipo_id on integrantes
  for each row execute function trg_integrantes_sesion();

-- Una persona no puede estar en dos equipos de la misma sesión:
create unique index if not exists integrantes_una_por_sesion
  on integrantes (perfil_id, sesion_id);
-- A lo sumo un apuntador por equipo:
create unique index if not exists integrantes_un_apuntador_por_equipo
  on integrantes (equipo_id) where es_apuntador;

-- Acceso por código de equipo (2026-08-26, pedido de Fernando): reemplaza el
-- correo OTP como vía principal de entrada para estudiantes, porque Resend
-- sin dominio verificado no puede entregarles nada real. El docente genera
-- UN código por equipo y lo distribuye él mismo (correo institucional propio,
-- proyector, lo que sea) — la app nunca envía nada por este camino.
-- Un solo código activo por equipo (PK = equipo_id); regenerar reemplaza el
-- anterior. Igual que codigos_verificacion: se guarda el hash, nunca el
-- código en claro — un volcado de la base no entrega códigos utilizables.
-- Código personal sin vencimiento (2026-08-26, pedido de Fernando): mismo
-- problema de fondo que el de equipo — Resend en sandbox no le entrega OTP
-- ni a su propio correo institucional. En vez de un flujo nuevo, se conecta
-- a /api/auth/verificar como una vía alterna al OTP: si el código enviado no
-- matchea codigos_verificacion, se prueba acá antes de rechazar. Mismo
-- formulario, mismos IDs — cero pantallas nuevas.
-- `expira_en` nullable a propósito: NULL = no vence. Es un código de
-- reingreso repetible (no se borra al usarlo, a diferencia del OTP), así que
-- solo debería generarse para gente de confianza (hoy: el propio docente).
create table if not exists codigos_personales (
  correo       text primary key,
  codigo_hash  text not null,
  expira_en    timestamptz,
  creado_en    timestamptz not null default now()
);

create table if not exists codigos_equipo (
  equipo_id    uuid primary key references equipos(id) on delete cascade,
  codigo_hash  text not null,
  expira_en    timestamptz not null,
  creado_en    timestamptz not null default now()
);

create table if not exists estaciones (
  id           int primary key check (id between 1 and 5),
  titulo       text not null,
  pilar        text not null,
  narrativa    text not null,
  datos        jsonb not null,
  reto         text not null,
  interaccion  jsonb not null,
  pistas       jsonb not null,
  feedback_ok  text not null,
  codigo       text not null,
  respuesta    jsonb not null
);

-- 2026-09-22 — de "5 salas fijas globales" a "N salas de una misión".
--
-- El `check (id between 1 and 5)` de arriba no era una configuración: era una
-- regla de la base que hacía imposible agregar una sexta sala o quitar una.
-- Se retira. El `id` SIGUE siendo `int` a propósito y no pasa a uuid: así no
-- hay que migrar `intentos.estacion_id` ni `progreso.estacion_id` (que lo
-- referencian) ni cambiar la firma de verificar_estacion(uuid,int,jsonb).
-- Lo único que le falta al `id` para servir a salas nuevas es una secuencia,
-- que se agrega abajo.
alter table estaciones drop constraint if exists estaciones_id_check;

alter table estaciones add column if not exists mision_id  uuid references misiones(id) on delete cascade;
alter table estaciones add column if not exists orden      int;
-- desbloqueo — reemplaza el `if p_estacion = 5` que estaba cableado en
-- verificar_estacion (03-funciones.sql). 'libre' = siempre jugable;
-- 'secuencial' = exige resuelta la sala de orden-1; 'tras_todas' = exige
-- todas las de orden menor (es la regla que hoy tiene la Sala de la Verdad).
alter table estaciones add column if not exists desbloqueo text not null default 'libre';
alter table estaciones add column if not exists icono      text;
-- visual — gráfico opcional de la sala, en el formato genérico de
-- plan-motor-misiones.md §1.6. Antes los números de los gráficos de las salas
-- 2 y 3 vivían dentro de js/dataviz.js, así que editar el contenido de la sala
-- no tocaba su gráfico. NULL = sin gráfico.
alter table estaciones add column if not exists visual     jsonb;

-- Los `check` de columnas agregadas por `alter` van aparte y con guarda: en una
-- base ya migrada la columna existe pero la restricción puede no existir, y
-- `add constraint` no acepta `if not exists` en Postgres 16.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'estaciones_desbloqueo_check') then
    alter table estaciones add constraint estaciones_desbloqueo_check
      check (desbloqueo in ('libre','secuencial','tras_todas'));
  end if;
end $$;

-- Secuencia para el `id`: sin esto no se puede insertar una sala nueva sin
-- elegir el número a mano. `setval(..., false)` deja el próximo valor en
-- max(id)+1 — en una base con las 5 filas de CGC, el próximo id es 6.
create sequence if not exists estaciones_id_seq owned by estaciones.id;
alter table estaciones alter column id set default nextval('estaciones_id_seq');
select setval('estaciones_id_seq', coalesce((select max(id) from estaciones), 0) + 1, false);

create unique index if not exists estaciones_mision_orden on estaciones (mision_id, orden);

-- Columnas nuevas AL FINAL, nunca en medio: `create or replace view` no permite
-- reordenar ni insertar columnas en una vista que ya existe, solo agregar al
-- final (mismo error real que ya se encontró en v_desempeno, más abajo).
create or replace view estaciones_publicas as
  select id, titulo, pilar, narrativa, datos, reto, interaccion,
         mision_id, orden, desbloqueo, icono, visual
  from estaciones;

create table if not exists intentos (
  id           bigserial primary key,
  equipo_id    uuid not null references equipos(id) on delete cascade,
  estacion_id  int  not null references estaciones(id),
  perfil_id    uuid not null references perfiles(id),
  respuesta    jsonb not null,
  correcto     boolean not null,
  detalle      text,
  creado_en    timestamptz not null default now()
);

create table if not exists progreso (
  equipo_id    uuid not null references equipos(id) on delete cascade,
  estacion_id  int  not null references estaciones(id),
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','progreso','resuelta','bloqueada')),
  intentos     int  not null default 0,
  resuelta_en  timestamptz,
  primary key (equipo_id, estacion_id)
);

create table if not exists calificaciones (
  equipo_id            uuid primary key references equipos(id) on delete cascade,
  uso_evidencia        int check (uso_evidencia between 1 and 4),
  distincion_dato      int check (distincion_dato between 1 and 4),
  pensamiento_critico  int check (pensamiento_critico between 1 and 4),
  trabajo_equipo       int check (trabajo_equipo between 1 and 4),
  nota_final           numeric(4,2),
  observaciones        text,
  actualizada_en       timestamptz not null default now()
);

-- Vista de desempeño — dueño del panel docente (CONTRACT §2.2 / §5.1: WHERE sesion_id=$1)
create or replace view v_desempeno as
select
  e.id as equipo_id,
  e.sesion_id,
  e.nombre as equipo_nombre,
  (select coalesce(array_agg(p.nombre order by p.nombre), '{}')
     from integrantes i join perfiles p on p.id = i.perfil_id where i.equipo_id = e.id) as integrantes,
  (select p.nombre from integrantes i join perfiles p on p.id = i.perfil_id
     where i.equipo_id = e.id and i.es_apuntador limit 1) as apuntador,
  (select count(*) from progreso pr where pr.equipo_id = e.id and pr.estado = 'resuelta') as estaciones_resueltas,
  (select coalesce(sum(pr.intentos), 0) from progreso pr where pr.equipo_id = e.id) as intentos_totales,
  case when e.iniciado_en is not null then
    extract(epoch from (coalesce(e.finalizado_en, now()) - e.iniciado_en))::int
  else null end as tiempo_usado_segundos,
  e.motivo_fin,
  e.iniciado_en,
  e.finalizado_en,
  -- Detalle estructurado para la pantalla de administrar equipos (2026-08-26):
  -- `integrantes` de arriba es solo nombres en texto (para el CSV de
  -- exportación); esto es lo que necesita el panel para poder marcar
  -- apuntador o quitar a alguien sin tener que copiar un id a mano. Va AL
  -- FINAL a propósito: CREATE OR REPLACE VIEW no permite reordenar ni
  -- insertar columnas en medio de una vista que ya existe, solo agregar al
  -- final (error real encontrado al aplicar esto, corregido moviendo la
  -- columna).
   (select coalesce(jsonb_agg(jsonb_build_object('perfil_id', p.id, 'nombre', p.nombre, 'es_apuntador', i.es_apuntador) order by p.nombre), '[]'::jsonb)
      from integrantes i join perfiles p on p.id = i.perfil_id where i.equipo_id = e.id) as integrantes_detalle,
  (select count(*) from estaciones e2 join sesiones s on s.mision_id = e2.mision_id where s.id = e.sesion_id) as total_salas
 from equipos e;

-- -----------------------------------------------------------------------------
-- Función de alta — reemplaza el trigger on_auth_user_created de la era Supabase
-- -----------------------------------------------------------------------------
create or replace function crear_o_recuperar_perfil(p_correo text) returns perfiles
language plpgsql security definer set search_path = public as $$
declare v_perfil perfiles; v_correo text := lower(trim(p_correo));
begin
  select * into v_perfil from perfiles where correo = v_correo;
  if found then return v_perfil; end if;

  if exists (select 1 from docentes_autorizados where correo = v_correo) then
    insert into perfiles (nombre, carne, correo, rol)
    values (v_correo, 'DOC-'||substr(md5(v_correo),1,8), v_correo, 'docente')
    returning * into v_perfil;
    return v_perfil;
  end if;

  if exists (select 1 from nomina where correo = v_correo) then
    insert into perfiles (nombre, carne, correo, rol)
    select nombre, carne, v_correo, 'estudiante' from nomina where correo = v_correo limit 1
    returning * into v_perfil;
    update nomina set perfil_id = v_perfil.id where correo = v_correo;
    return v_perfil;
  end if;

  raise exception 'correo_no_esta_en_la_nomina_del_curso' using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Backfill de misiones (2026-09-22) — SOLO para bases que ya estaban migradas
-- con las 5 estaciones sueltas de CGC, de antes de que existiera `misiones`.
--
-- Guarda doble a propósito:
--   · `not exists (select 1 from misiones)` — corre una sola vez en la vida.
--   · `exists (... estaciones where mision_id is null)` — no crea una misión
--     vacía en una base recién nacida, donde el sembrado lo hace 05-seed.sql.
--
-- CONSERVA EL CONTENIDO. Esto engancha filas y rellena columnas nuevas; nunca
-- escribe sobre titulo/narrativa/datos/reto/pistas/feedback_ok/interaccion/
-- respuesta. Si Fernando editó una sala desde el panel, esa edición sobrevive.
-- La única excepción es la corrección del fragmento de la Sala 1 (abajo), y va
-- condicionada a que el valor siga siendo exactamente el del seed original.
-- -----------------------------------------------------------------------------
do $$
declare
  v_mision uuid;
  v_iconos text[] := array['fact_check','water_drop','payments','groups','gavel'];
begin
  if exists (select 1 from misiones) then return; end if;
  if not exists (select 1 from estaciones where mision_id is null) then return; end if;

  insert into misiones (slug, titulo, subtitulo, intro, codigo_maestro, veredicto, estado)
  values (
    'codigo-del-cafe',
    'El código secreto del café',
    'Una auditoría de sostenibilidad bajo presión',
    'CGC, Cadena Global de Café, publicó su informe. Tu equipo debe verificar si el discurso tiene respaldo en los datos.',
    -- NULL = se compone de los fragmentos por orden. Con la corrección de la
    -- Sala 1 de más abajo, eso da exactamente '06-87-04-2P-4', el mismo código
    -- que hoy está cableado en verificar_maestro. Comportamiento idéntico.
    null,
    'CGC no sostiene su promesa 2027 con evidencia suficiente en las áreas auditadas.',
    'publicada'
  )
  returning id into v_mision;

  update estaciones set
    mision_id  = v_mision,
    orden      = id,
    -- La Sala 5 (síntesis) es la única que hoy se desbloquea al final; el
    -- resto siempre estuvo libre. Se preserva exactamente esa regla.
    desbloqueo = case when id = 5 then 'tras_todas' else 'libre' end,
    icono      = coalesce(icono, v_iconos[id])
  where mision_id is null;

  -- Corrección del fragmento de la Sala 1 (plan §0.1): el estudiante recogía
  -- '06-VC' pero el código maestro usa solo '06', así que tenía que teclear
  -- algo distinto de lo que le habían dado. Se corrige en la columna y en el
  -- texto del feedback. Condicionado al valor exacto del seed: si alguien ya
  -- lo cambió a otra cosa, no se toca.
  update estaciones
     set codigo = '06',
         feedback_ok = replace(feedback_ok, 'Código: 06-VC', 'Código: 06')
   where mision_id = v_mision and orden = 1 and codigo = '06-VC';

  -- Los gráficos de las salas 2 y 3 dejan de vivir en js/dataviz.js y pasan a
  -- ser dato editable (plan §1.8.1). Los valores son los que hoy dibuja el
  -- código, verificados contra js/dataviz.js: los DOS son pastel — la Sala 3
  -- pasó de barra apilada a pastel de 4 porciones el 2026-08-28.
  update estaciones set visual = '{
    "tipo":"pastel","unidad":"%","titulo":"Huella hídrica del café verde",
    "series":[
      {"etiqueta":"Huella verde (agua de lluvia)","valor":87,"nota":"rango aceptado 85–90 %"},
      {"etiqueta":"Huella azul + gris","valor":13}
    ],
    "rango":{"min":85,"max":90,"etiqueta":"rango aceptado"},
    "pie":"Fuente: expediente CGC — caso base 4.2"}'::jsonb
   where mision_id = v_mision and orden = 2 and visual is null;

  update estaciones set visual = '{
    "tipo":"pastel","unidad":"US$","titulo":"Reparto de una taza de US$4.00",
    "series":[
      {"etiqueta":"Persona caficultora","valor":0.175,"nota":"4.4 %"},
      {"etiqueta":"Procesamiento y exportación","valor":0.40,"nota":"10 %"},
      {"etiqueta":"Tostado y logística internacional","valor":1.10,"nota":"27.5 %"},
      {"etiqueta":"Cafetería y venta final","valor":2.325,"nota":"58.1 %"}
    ],
    "pie":"Fuente: expediente CGC — caso base 4.3"}'::jsonb
   where mision_id = v_mision and orden = 3 and visual is null;

  -- Toda sesión de clase existente apuntaba implícitamente a este contenido.
  update sesiones set mision_id = v_mision where mision_id is null;

  raise notice '[backfill] misión codigo-del-cafe creada con % salas', (select count(*) from estaciones where mision_id = v_mision);
end $$;
