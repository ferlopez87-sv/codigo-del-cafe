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
create table if not exists sesiones (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  docente_id        uuid not null references perfiles(id),
  duracion_minutos  int  not null default 50 check (duracion_minutos between 5 and 180),
  estado            text not null default 'borrador' check (estado in ('borrador','abierta','cerrada')),
  creada_en         timestamptz not null default now(),
  cerrada_en        timestamptz
);

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

create or replace view estaciones_publicas as
  select id, titulo, pilar, narrativa, datos, reto, interaccion from estaciones;

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
     from integrantes i join perfiles p on p.id = i.perfil_id where i.equipo_id = e.id) as integrantes_detalle
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
