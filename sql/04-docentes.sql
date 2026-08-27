-- =============================================================================
-- El Código del Café — 04-docentes.sql
-- Lista blanca global de docentes. Se ejecuta DESPUÉS de 01-esquema.sql.
-- Idempotente. Corre desde SQL Editor.
-- Orden (Render admin): 00-roles → 01-esquema → 02-rls → 03-funciones → 04-docentes → 05-seed
-- =============================================================================
-- El docente debe estar en esta lista ANTES de registrarse por primera vez.
-- La función crear_o_recuperar_perfil() lee esta tabla (SECURITY DEFINER) y
-- asigna rol='docente' sin depender de modo_registro ni de update manual.

insert into public.docentes_autorizados (correo, nota)
values ('fglopez@monicaherrera.edu.sv', 'docente titular — FG López')
on conflict (correo) do update set nota = excluded.nota;
