-- =============================================================================
-- El Código del Café — 06-superadmin.sql
-- Acceso maestro de auditoría para fglopez@monicaherrera.edu.sv. CONTRACT §3.3.
-- Idempotente. Orden: después de 02-rls.sql y 03-funciones.sql (usa app.usuario_actual()).
-- =============================================================================
-- QUÉ HACE: agrega políticas RLS ADICIONALES (OR con las de docente/estudiante
-- ya existentes) para que ese único correo vea y gestione TODO el sistema,
-- sin depender de ser docente_id de cada sesión.
-- POR QUÉ POR CORREO Y NO POR ROL NUEVO: el esquema no distingue "admin" de
-- "docente" (rol solo admite 'estudiante'/'docente', §2.0) — cambiar eso
-- implicaría una migración de columna. Resolverlo por correo, en RLS, evita
-- esa migración y mantiene la regla de que el control de acceso vive
-- enteramente en RLS, no en un bypass de Express (§0.6 gobierno del proceso).
-- =============================================================================

create or replace function es_super_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from perfiles p
    where p.id = app.usuario_actual()
      and lower(p.correo) = 'fglopez@monicaherrera.edu.sv'
  )
$$;
comment on function es_super_admin() is 'true si app.usuario_actual() es fglopez@monicaherrera.edu.sv. SECURITY DEFINER para leer perfiles por encima de RLS.';

-- perfiles: ver todos
drop policy if exists perfiles_super_admin on perfiles;
create policy perfiles_super_admin on perfiles for select to public using (es_super_admin());

-- sesiones: ver y gestionar todas
drop policy if exists sesiones_super_admin on sesiones;
create policy sesiones_super_admin on sesiones for all to public
  using (es_super_admin()) with check (es_super_admin());

-- equipos
drop policy if exists equipos_super_admin on equipos;
create policy equipos_super_admin on equipos for all to public
  using (es_super_admin()) with check (es_super_admin());

-- integrantes (incluye marcar apuntador de cualquier equipo)
drop policy if exists integrantes_super_admin on integrantes;
create policy integrantes_super_admin on integrantes for all to public
  using (es_super_admin()) with check (es_super_admin());

-- nomina
drop policy if exists nomina_super_admin on nomina;
create policy nomina_super_admin on nomina for all to public
  using (es_super_admin()) with check (es_super_admin());

-- intentos / progreso / calificaciones: solo select (igual que docente; se
-- escriben desde verificar_estacion()/rutas ya existentes, no directo)
drop policy if exists intentos_super_admin on intentos;
create policy intentos_super_admin on intentos for select to public using (es_super_admin());
drop policy if exists progreso_super_admin on progreso;
create policy progreso_super_admin on progreso for select to public using (es_super_admin());
drop policy if exists calificaciones_super_admin on calificaciones;
create policy calificaciones_super_admin on calificaciones for all to public
  using (es_super_admin()) with check (es_super_admin());

-- Confirmar que FORCE sigue activo tras agregar políticas (no debería
-- desactivarse solo, pero se reafirma para que este archivo sea autocontenido).
-- Mismo criterio que 02-rls: solo si el dueño es superusuario. Con un dueño
-- común, FORCE deja ciegas a las funciones SECURITY DEFINER.
do $$
declare
  t text;
  forzar boolean := (select rolsuper from pg_roles where rolname = current_user);
begin
  if forzar then
    foreach t in array array['perfiles','sesiones','equipos','integrantes','nomina',
                              'estaciones','intentos','progreso','calificaciones'] loop
      execute format('alter table %I force row level security', t);
    end loop;
  end if;
end $$;

do $$
declare v boolean;
begin
  select es_super_admin() into v;
  raise notice '06-superadmin: es_super_admin()=% (sin sesión de app.usuario_actual() debe ser false)', v;
end $$;
