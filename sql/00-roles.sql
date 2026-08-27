-- =============================================================================
-- El Código del Café — 00-roles.sql
-- Rol restringido para el proceso Express. CONTRACT §3.1. Corre UNA SOLA VEZ,
-- a mano, con la conexión de administrador (postgres_admin en local,
-- la que da Render al crear la base en online). Idempotente.
-- =============================================================================
-- POR QUÉ EXISTE: en Postgres, RLS nunca restringe al dueño de una tabla ni a
-- un rol SUPERUSER, con o sin FORCE ROW LEVEL SECURITY — es una propiedad del
-- rol, no una excepción que FORCE pueda revertir. Si el proceso Express se
-- conectara con el mismo rol que creó las tablas (o con un superusuario),
-- toda la Sección 3 de CONTRACT.md sería cosmética. app_runtime es un rol de
-- login SIN superusuario y SIN ser dueño de nada — condición necesaria, no
-- opcional, para que RLS proteja de verdad.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login password 'app_runtime_pw';
  end if;
end $$;

grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;
grant execute on all functions in schema public to app_runtime;

-- Las tablas/funciones de 01→06 todavía no existen cuando esto corre (00 va
-- primero) — sin esto, app_runtime se quedaría sin acceso a nada creado
-- después. ALTER DEFAULT PRIVILEGES cubre lo que cree el rol de admin de
-- acá en adelante en este esquema.
alter default privileges in schema public grant select, insert, update, delete on tables to app_runtime;
alter default privileges in schema public grant usage, select on sequences to app_runtime;
alter default privileges in schema public grant execute on functions to app_runtime;

do $$
begin
  raise notice '00-roles: app_runtime listo. superuser=%, cualquier tabla que cree = false (no crea tablas)',
    (select rolsuper from pg_roles where rolname='app_runtime');
end $$;
