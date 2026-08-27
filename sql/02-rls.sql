-- =============================================================================
-- El Código del Café — 02-rls.sql
-- Row Level Security. CONTRACT.md §3. Idempotente.
-- =============================================================================

create schema if not exists app;
-- app_runtime (sql/00-roles.sql) no es dueño de este esquema — sin este GRANT
-- explícito no puede ni ejecutar app.usuario_actual(), que es la base de
-- absolutamente todas las políticas de abajo.
grant usage on schema app to app_runtime;

create or replace function app.usuario_actual() returns uuid
language sql stable as $$
  select nullif(current_setting('app.usuario_actual', true), '')::uuid
$$;
grant execute on function app.usuario_actual() to app_runtime;

-- Helpers SECURITY DEFINER — evitan recursión de RLS al consultar otras tablas protegidas.
create or replace function es_docente() returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select rol = 'docente' from perfiles where id = app.usuario_actual()), false)
$$;

create or replace function es_docente_de(p_sesion uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from sesiones where id = p_sesion and docente_id = app.usuario_actual())
$$;

create or replace function es_docente_del_equipo(p_equipo uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from equipos e join sesiones s on s.id = e.sesion_id
    where e.id = p_equipo and s.docente_id = app.usuario_actual()
  )
$$;

create or replace function es_docente_del_perfil(p_perfil uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from integrantes i join equipos e on e.id = i.equipo_id join sesiones s on s.id = e.sesion_id
    where i.perfil_id = p_perfil and s.docente_id = app.usuario_actual()
  )
$$;

create or replace function tengo_equipo_en(p_equipo uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from integrantes where equipo_id = p_equipo and perfil_id = app.usuario_actual())
$$;

-- Helper de sesión (usado por el middleware, bypasa RLS de perfiles: §5.1/§14 —
-- sin esto, el middleware no puede resolver la identidad porque perfiles ya
-- exige app.usuario_actual() para leerse, y ese valor todavía no existe.)
create or replace function obtener_perfil_por_token(p_hash text)
returns table (perfil_id uuid, expira_en timestamptz, id uuid, nombre text, correo text, carne text, rol text)
language sql security definer set search_path = public as $$
  select s.perfil_id, s.expira_en, p.id, p.nombre, p.correo, p.carne, p.rol
  from sesiones_login s join perfiles p on p.id = s.perfil_id
  where s.token_hash = p_hash and s.expira_en > now()
$$;

-- -----------------------------------------------------------------------------
-- Activar y FORZAR RLS en todas las tablas de negocio (§3.1: sin FORCE, el
-- dueño de la tabla lo salta. En local, app_runtime suele ser también el
-- dueño — ver nota en README/CONTRACT §6 sobre esta limitación de dev local.)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['perfiles','sesiones','equipos','integrantes','nomina',
                            'estaciones','intentos','progreso','calificaciones'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- docentes_autorizados / configuracion: RLS activo, cero políticas (deny by default)
alter table docentes_autorizados enable row level security;
alter table docentes_autorizados force row level security;
alter table configuracion enable row level security;
alter table configuracion force row level security;

-- codigos_verificacion / sesiones_login: EXCEPCIÓN DOCUMENTADA (§2.1) — sin RLS,
-- a propósito. Solo srv/rutas/auth.js y srv/middleware/sesion.js las tocan;
-- guardan hashes, no secretos en claro.
alter table codigos_verificacion disable row level security;
alter table codigos_verificacion no force row level security;
alter table sesiones_login disable row level security;
alter table sesiones_login no force row level security;

-- codigos_equipo: misma excepción. La ruta que lo escribe (generar) ya
-- verificó por su cuenta que el docente es dueño del equipo (consultando
-- `equipos`, que sí tiene RLS real) antes de tocar esta tabla; la ruta que
-- lo lee (acceso por código) es necesariamente pre-identidad, igual que
-- codigos_verificacion — nadie "es nadie" todavía en ese punto.
alter table codigos_equipo disable row level security;
alter table codigos_equipo no force row level security;

alter table codigos_personales disable row level security;
alter table codigos_personales no force row level security;

-- -----------------------------------------------------------------------------
-- perfiles
-- -----------------------------------------------------------------------------
drop policy if exists perfiles_lectura_propia on perfiles;
create policy perfiles_lectura_propia on perfiles for select to public
  using (id = app.usuario_actual());
drop policy if exists perfiles_lectura_docente on perfiles;
create policy perfiles_lectura_docente on perfiles for select to public
  using (es_docente_del_perfil(id));

-- -----------------------------------------------------------------------------
-- sesiones
-- -----------------------------------------------------------------------------
drop policy if exists sesiones_lectura_estudiante on sesiones;
create policy sesiones_lectura_estudiante on sesiones for select to public
  using (exists (select 1 from equipos e join integrantes i on i.equipo_id = e.id
                 where e.sesion_id = sesiones.id and i.perfil_id = app.usuario_actual()));
drop policy if exists sesiones_docente on sesiones;
create policy sesiones_docente on sesiones for all to public
  using (docente_id = app.usuario_actual())
  with check (docente_id = app.usuario_actual());

-- -----------------------------------------------------------------------------
-- equipos
-- -----------------------------------------------------------------------------
drop policy if exists equipos_lectura_propia on equipos;
create policy equipos_lectura_propia on equipos for select to public
  using (tengo_equipo_en(id));
drop policy if exists equipos_docente on equipos;
create policy equipos_docente on equipos for all to public
  using (es_docente_de(sesion_id))
  with check (es_docente_de(sesion_id));

-- -----------------------------------------------------------------------------
-- integrantes
-- -----------------------------------------------------------------------------
drop policy if exists integrantes_lectura_equipo on integrantes;
create policy integrantes_lectura_equipo on integrantes for select to public
  using (tengo_equipo_en(equipo_id));
drop policy if exists integrantes_docente on integrantes;
create policy integrantes_docente on integrantes for all to public
  using (es_docente_del_equipo(equipo_id))
  with check (es_docente_del_equipo(equipo_id));

-- -----------------------------------------------------------------------------
-- nomina
-- -----------------------------------------------------------------------------
drop policy if exists nomina_lectura_propia on nomina;
create policy nomina_lectura_propia on nomina for select to public
  using (perfil_id = app.usuario_actual());
drop policy if exists nomina_docente on nomina;
create policy nomina_docente on nomina for all to public
  using (es_docente_de(sesion_id))
  with check (es_docente_de(sesion_id));

-- -----------------------------------------------------------------------------
-- estaciones — ninguna política: acceso denegado siempre (las respuestas
-- solo se leen desde funciones SECURITY DEFINER). estaciones_publicas es la
-- única puerta de lectura.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- intentos / progreso — solo lectura para estudiante y docente; la escritura
-- ocurre exclusivamente dentro de verificar_estacion() (SECURITY DEFINER).
-- -----------------------------------------------------------------------------
drop policy if exists intentos_lectura_equipo on intentos;
create policy intentos_lectura_equipo on intentos for select to public
  using (tengo_equipo_en(equipo_id));
drop policy if exists intentos_lectura_docente on intentos;
create policy intentos_lectura_docente on intentos for select to public
  using (es_docente_del_equipo(equipo_id));

drop policy if exists progreso_lectura_equipo on progreso;
create policy progreso_lectura_equipo on progreso for select to public
  using (tengo_equipo_en(equipo_id));
drop policy if exists progreso_lectura_docente on progreso;
create policy progreso_lectura_docente on progreso for select to public
  using (es_docente_del_equipo(equipo_id));
-- progreso también lo inserta directamente /api/docente/equipos al crear el equipo (5 filas iniciales):
drop policy if exists progreso_insercion_docente on progreso;
create policy progreso_insercion_docente on progreso for insert to public
  with check (es_docente_del_equipo(equipo_id));

-- -----------------------------------------------------------------------------
-- calificaciones
-- -----------------------------------------------------------------------------
drop policy if exists calificaciones_lectura_equipo on calificaciones;
create policy calificaciones_lectura_equipo on calificaciones for select to public
  using (tengo_equipo_en(equipo_id));
drop policy if exists calificaciones_docente on calificaciones;
create policy calificaciones_docente on calificaciones for all to public
  using (es_docente_del_equipo(equipo_id))
  with check (es_docente_del_equipo(equipo_id));

-- -----------------------------------------------------------------------------
-- Vistas — estaciones_publicas SIN security_invoker (a propósito: con RLS
-- heredado de `estaciones` devolvería siempre 0 filas). v_desempeno CON
-- security_invoker (respeta el RLS del equipo/docente que consulta).
-- -----------------------------------------------------------------------------
alter view estaciones_publicas set (security_invoker = off);
grant select on estaciones_publicas to public;
alter view v_desempeno set (security_invoker = on);
grant select on v_desempeno to public;
