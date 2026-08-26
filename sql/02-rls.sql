-- ============================================================================
--  El Código del Café — sql/02-rls.sql
--  Dueño: db-rls   ·   Especificación: CONTRACT.md §3 y §14.2
-- ----------------------------------------------------------------------------
--  Se ejecuta DESPUÉS de 01-esquema.sql y ANTES de 03-funciones.sql.
--  Es idempotente: se puede correr dos veces seguidas sin errores.
--
--  POR QUÉ ESTE ARCHIVO ES EL CONTROL DE ACCESO REAL DEL SISTEMA:
--  el frontend es estático y lleva la clave `anon`, que es pública por diseño.
--  Cualquier persona con esa clave puede hablarle directo a la API REST de
--  Supabase. Lo único que se interpone entre esa persona y los datos
--  personales de sus compañeros, las respuestas correctas del juego y las
--  calificaciones, son las políticas de este archivo. No hay una segunda capa.
--
--  MODELO: deny by default. RLS activo en todas las tablas; sin política, no
--  hay acceso. Las políticas son PERMISIVAS y se combinan con OR, así que cada
--  una se escribe pensando "qué agrega", nunca "qué quita".
--
--  Se separa una política por operación (select / insert / update / delete) en
--  vez de usar `for all`, para poder auditar cada permiso por separado.
-- ============================================================================


-- ============================================================================
--  1. RLS ACTIVO EN TODAS LAS TABLAS
-- ----------------------------------------------------------------------------
--  `enable row level security` es idempotente: repetirlo no falla.
--
--  NO se usa `force row level security` a propósito. `force` aplicaría las
--  políticas también al dueño de la tabla, y eso rompería las funciones
--  SECURITY DEFINER de 03-funciones.sql (verificar_estacion, mi_equipo,
--  anonimizar_sesion) y la vista estaciones_publicas, que necesitan leer y
--  escribir por encima de RLS. El dueño de la tabla nunca es un rol que llegue
--  desde el cliente: `anon` y `authenticated` no son dueños de nada.
-- ============================================================================

alter table public.perfiles        enable row level security;
alter table public.sesiones        enable row level security;
alter table public.equipos         enable row level security;
alter table public.integrantes     enable row level security;
alter table public.nomina          enable row level security;
alter table public.estaciones      enable row level security;
alter table public.intentos        enable row level security;
alter table public.progreso        enable row level security;
alter table public.calificaciones  enable row level security;

-- Tablas de gobierno: RLS activo y CERO políticas (decisión harness Ola 1.3).
-- Las lee solo el trigger SECURITY DEFINER. Bloque guardado para no romper si
-- la tabla no existe aún, pero sin silenciar nómina (ver §6 bis).
do $cfg$
begin
  if to_regclass('public.configuracion') is not null then
    execute 'alter table public.configuracion enable row level security';
  else
    raise notice 'RLS: la tabla public.configuracion no existe; se omite.';
  end if;
  if to_regclass('public.docentes_autorizados') is not null then
    execute 'alter table public.docentes_autorizados enable row level security';
  else
    raise notice 'RLS: la tabla public.docentes_autorizados no existe; se omite.';
  end if;
end
$cfg$;


-- ============================================================================
--  2. FUNCIONES AUXILIARES
-- ----------------------------------------------------------------------------
--  Todas son SECURITY DEFINER + STABLE + `set search_path = public`.
--
--  POR QUÉ SECURITY DEFINER: una política que consulta otra tabla con RLS
--  dispara las políticas de esa otra tabla, y si aquella vuelve a consultar la
--  primera, Postgres aborta con "infinite recursion detected in policy for
--  relation". Estas funciones corren como su dueño, así que leen por encima de
--  RLS y cortan la cadena de recursión de raíz.
--
--  POR QUÉ ES SEGURO QUE LEAN POR ENCIMA DE RLS: ninguna devuelve datos.
--  Devuelven un booleano o un uuid sobre la propia identidad de quien llama
--  (auth.uid()). No hay parámetro que permita preguntar por otra persona.
--
--  Con `auth.uid()` nulo (petición anónima) todas devuelven false o null, así
--  que quien no ha iniciado sesión no pasa ninguna política.
-- ============================================================================

-- ¿El perfil de quien llama tiene rol 'docente'?
create or replace function public.es_docente()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and p.rol = 'docente'
  );
$fn$;

comment on function public.es_docente() is
  'true si auth.uid() tiene rol docente. SECURITY DEFINER para no recursar sobre las políticas de perfiles.';

-- Rol del perfil de quien llama. Lo usa la política de update de perfiles para
-- comprobar que nadie se cambie el rol a sí mismo. Se necesita una función
-- porque una subconsulta a `perfiles` dentro de una política de `perfiles`
-- sería recursión directa.
create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $fn$
  select p.rol
  from public.perfiles p
  where p.id = auth.uid();
$fn$;

comment on function public.mi_rol() is
  'Rol actual de auth.uid(). Sirve para congelar la columna rol en el update del propio perfil.';

-- ¿Quien llama es la persona docente de esta sesión?
create or replace function public.es_docente_de(p_sesion uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.sesiones s
    where s.id = p_sesion
      and s.docente_id = auth.uid()
  );
$fn$;

comment on function public.es_docente_de(uuid) is
  'true si auth.uid() es docente_id de la sesión indicada. Firma exigida por CONTRACT.md §3.';

-- ¿Quien llama es la persona docente de la sesión a la que pertenece este equipo?
-- Atajo de equipo -> sesión -> docente. Sin él, las políticas de equipos,
-- integrantes, intentos, progreso y calificaciones tendrían que consultar
-- `equipos` y `sesiones` con RLS activo, con riesgo de recursión.
create or replace function public.es_docente_del_equipo(p_equipo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.equipos e
    join public.sesiones s on s.id = e.sesion_id
    where e.id = p_equipo
      and s.docente_id = auth.uid()
  );
$fn$;

-- ¿El perfil indicado está en algún equipo de alguna sesión de quien llama?
-- Es el alcance exacto que el contrato le da al docente sobre datos personales.
create or replace function public.es_docente_del_perfil(p_perfil uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.integrantes i
    join public.equipos  e on e.id = i.equipo_id
    join public.sesiones s on s.id = e.sesion_id
    where i.perfil_id = p_perfil
      and s.docente_id = auth.uid()
  );
$fn$;

-- ¿Quien llama tiene equipo en esta sesión? Habilita el select de estudiante
-- sobre `sesiones` sin darle visibilidad de las sesiones de nadie más.
create or replace function public.tengo_equipo_en(p_sesion uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.integrantes i
    join public.equipos e on e.id = i.equipo_id
    where i.perfil_id = auth.uid()
      and e.sesion_id = p_sesion
  );
$fn$;

-- ¿Quien llama es integrante de este equipo? Es el predicado que sostiene
-- TODO el aislamiento entre equipos: intentos, progreso y calificaciones.
-- No filtra por estado de la sesión a propósito: si filtrara, al cerrar la
-- clase el equipo perdería el acceso a su propio resumen (#pantalla-resumen).
create or replace function public.pertenezco_a(p_equipo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.integrantes i
    where i.equipo_id = p_equipo
      and i.perfil_id = auth.uid()
  );
$fn$;

-- Equipo de quien llama en la sesión que está abierta ahora mismo, o null.
-- Es el "equipo en juego". Las políticas NO lo usan (usan pertenezco_a, que no
-- depende del estado de la sesión); queda disponible para 03-funciones.sql y
-- para diagnóstico. Una persona no puede estar en dos equipos de la misma
-- sesión (índice único de §2), pero sí en sesiones distintas: por eso el
-- filtro por estado 'abierta' y el limit 1 determinista.
create or replace function public.mi_equipo_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select i.equipo_id
  from public.integrantes i
  join public.equipos  e on e.id = i.equipo_id
  join public.sesiones s on s.id = e.sesion_id
  where i.perfil_id = auth.uid()
    and s.estado = 'abierta'
  order by e.iniciado_en desc nulls last, e.id
  limit 1;
$fn$;

comment on function public.mi_equipo_id() is
  'Equipo de auth.uid() en la sesión abierta, o null. Las políticas usan pertenezco_a() para no perder el acceso al resumen cuando la sesión se cierra.';


-- ============================================================================
--  3. PERFILES — datos personales (nombre, correo, carné)
-- ----------------------------------------------------------------------------
--  Contrato §3: estudiante select/update SOLO el propio; docente select de los
--  perfiles de sus sesiones. Nadie tiene insert ni delete: los perfiles los
--  crea el trigger de alta de §2 y los borra la cascada de auth.users.
-- ============================================================================

-- Cada persona ve su propio perfil. Protege el correo y el carné de todas las
-- demás personas de la clase.
drop policy if exists perfiles_lectura_propia on public.perfiles;
create policy perfiles_lectura_propia
  on public.perfiles
  for select
  to authenticated
  using (auth.uid() = id);

-- El docente ve los perfiles de quienes están en equipos de SUS sesiones.
-- No ve a estudiantes de otras secciones ni a otros docentes.
drop policy if exists perfiles_lectura_docente on public.perfiles;
create policy perfiles_lectura_docente
  on public.perfiles
  for select
  to authenticated
  using (public.es_docente() and public.es_docente_del_perfil(id));

-- Identidad congelada (decisión harness Ola 1.2): el estudiante NO puede
-- reescribir nombre/carné. El carné es llave de calificación y la nómina es
-- fuente de verdad. Sin política de update: cualquier UPDATE → 0 filas.
-- Correcciones de nombre las hace el docente editando la nómina.
drop policy if exists perfiles_actualiza_propia on public.perfiles;

-- Sin política de insert, update ni delete para perfiles: denegadas.

-- ----------------------------------------------------------------------------
--  NOTA PARA te-panel Y cl-api — de dónde sale `#lista-registrados`.
--  §8 pide "estudiantes registrados sin equipo". Con las políticas de arriba
--  esas personas serían invisibles para el docente: todavía no están en ningún
--  equipo, así que `es_docente_del_perfil()` da false. NO se resuelve abriendo
--  `perfiles`; se resuelve leyendo la NÓMINA (§6 bis), que cuelga de la sesión,
--  ya trae nombre, correo y carné, y sobre la cual el docente tiene lectura
--  completa de sus propias sesiones.
--
--    registrados(sesion) = filas de `nomina` de esa sesión
--                          con perfil_id not null
--                          que no aparecen en `integrantes` de esa sesión
--
--  Ambas tablas son legibles por el docente con las políticas de este archivo,
--  así que la consulta funciona sin agregar ni un permiso más sobre `perfiles`.
--
--  La política alternativa queda escrita y COMENTADA a propósito. Activarla
--  haría que cualquier docente viera los datos personales de todo estudiante
--  sin equipo, aunque fuera de otra sección. No hace falta: no se activa.
--
--  drop policy if exists perfiles_lectura_docente_sin_equipo on public.perfiles;
--  create policy perfiles_lectura_docente_sin_equipo
--    on public.perfiles
--    for select
--    to authenticated
--    using (
--      public.es_docente()
--      and rol = 'estudiante'
--      and not exists (select 1 from public.integrantes i where i.perfil_id = perfiles.id)
--    );
-- ----------------------------------------------------------------------------


-- ============================================================================
--  4. SESIONES
-- ----------------------------------------------------------------------------
--  Contrato §3: estudiante select de aquellas donde tiene equipo;
--  docente CRUD de las propias (docente_id = auth.uid()).
-- ============================================================================

-- El estudiante necesita leer la sesión para saber duración y estado. Solo la
-- suya: no ve las sesiones de otras secciones ni las de otros docentes.
drop policy if exists sesiones_lectura_estudiante on public.sesiones;
create policy sesiones_lectura_estudiante
  on public.sesiones
  for select
  to authenticated
  using (public.tengo_equipo_en(id));

drop policy if exists sesiones_lectura_docente on public.sesiones;
create policy sesiones_lectura_docente
  on public.sesiones
  for select
  to authenticated
  using (docente_id = auth.uid());

-- Solo un perfil con rol docente crea sesiones, y solo a su propio nombre:
-- el `with check` impide crear una sesión asignándosela a otra persona.
drop policy if exists sesiones_insercion_docente on public.sesiones;
create policy sesiones_insercion_docente
  on public.sesiones
  for insert
  to authenticated
  with check (public.es_docente() and docente_id = auth.uid());

-- Abrir y cerrar la clase. El `with check` con la misma condición impide
-- regalarle la sesión a otro docente en el mismo update.
drop policy if exists sesiones_actualiza_docente on public.sesiones;
create policy sesiones_actualiza_docente
  on public.sesiones
  for update
  to authenticated
  using (docente_id = auth.uid())
  with check (docente_id = auth.uid());

drop policy if exists sesiones_borra_docente on public.sesiones;
create policy sesiones_borra_docente
  on public.sesiones
  for delete
  to authenticated
  using (docente_id = auth.uid());


-- ============================================================================
--  5. EQUIPOS
-- ----------------------------------------------------------------------------
--  Contrato §3: estudiante select del propio; docente CRUD de los de sus
--  sesiones.
--
--  Ojo: el estudiante NO tiene update sobre equipos. `iniciado_en`,
--  `finalizado_en` y `motivo_fin` son el reloj de la partida y los sella el
--  servidor desde verificar_estacion(). Si el estudiante pudiera escribirlos,
--  bastaría un PATCH a `iniciado_en = now()` para tener tiempo infinito.
-- ============================================================================

drop policy if exists equipos_lectura_propia on public.equipos;
create policy equipos_lectura_propia
  on public.equipos
  for select
  to authenticated
  using (public.pertenezco_a(id));

drop policy if exists equipos_lectura_docente on public.equipos;
create policy equipos_lectura_docente
  on public.equipos
  for select
  to authenticated
  using (public.es_docente_de(sesion_id));

drop policy if exists equipos_insercion_docente on public.equipos;
create policy equipos_insercion_docente
  on public.equipos
  for insert
  to authenticated
  with check (public.es_docente_de(sesion_id));

-- El `with check` sobre sesion_id impide mover un equipo a la sesión de otro
-- docente, que sería una forma indirecta de robarle datos.
drop policy if exists equipos_actualiza_docente on public.equipos;
create policy equipos_actualiza_docente
  on public.equipos
  for update
  to authenticated
  using (public.es_docente_de(sesion_id))
  with check (public.es_docente_de(sesion_id));

drop policy if exists equipos_borra_docente on public.equipos;
create policy equipos_borra_docente
  on public.equipos
  for delete
  to authenticated
  using (public.es_docente_de(sesion_id));


-- ============================================================================
--  6. INTEGRANTES
-- ----------------------------------------------------------------------------
--  Contrato §3: estudiante select de los del propio equipo; docente CRUD de
--  los de sus sesiones. La asignación ocurre durante la clase (§8), así que el
--  docente escribe aquí en vivo.
--
--  El estudiante no tiene insert: si lo tuviera, se metería solo al equipo que
--  quisiera y con eso leería los intentos, el progreso y las notas ajenas,
--  porque `pertenezco_a` es la llave de todo lo demás.
-- ============================================================================

drop policy if exists integrantes_lectura_equipo on public.integrantes;
create policy integrantes_lectura_equipo
  on public.integrantes
  for select
  to authenticated
  using (public.pertenezco_a(equipo_id));

drop policy if exists integrantes_lectura_docente on public.integrantes;
create policy integrantes_lectura_docente
  on public.integrantes
  for select
  to authenticated
  using (public.es_docente_del_equipo(equipo_id));

drop policy if exists integrantes_insercion_docente on public.integrantes;
create policy integrantes_insercion_docente
  on public.integrantes
  for insert
  to authenticated
  with check (public.es_docente_del_equipo(equipo_id));

drop policy if exists integrantes_actualiza_docente on public.integrantes;
create policy integrantes_actualiza_docente
  on public.integrantes
  for update
  to authenticated
  using (public.es_docente_del_equipo(equipo_id))
  with check (public.es_docente_del_equipo(equipo_id));

drop policy if exists integrantes_borra_docente on public.integrantes;
create policy integrantes_borra_docente
  on public.integrantes
  for delete
  to authenticated
  using (public.es_docente_del_equipo(equipo_id));


-- ============================================================================
--  6 bis. NOMINA — la lista del curso que precarga el docente
-- ----------------------------------------------------------------------------
--  Sustituye a la validación por dominio institucional: la Escuela no tiene un
--  dominio de correo utilizable, así que quien puede registrarse es quien
--  aparece en esta lista. Columnas: id, sesion_id, nombre, correo, carne,
--  perfil_id, creada_en.
--
--  ESTA ES LA TABLA MÁS DELICADA DEL SISTEMA DESPUÉS DE `estaciones`, y por un
--  motivo distinto: contiene el nombre, el correo y el carné de TODO el curso
--  en filas sueltas, sin depender de que nadie se haya registrado todavía. Una
--  sola política de select mal puesta y cualquier persona autenticada se baja
--  el directorio completo de sus compañeros con un GET. Es la fuga de datos
--  personales más probable de todo el proyecto.
--
--  El estudiante ve UNA fila: la suya, la que ya quedó ligada a su perfil.
--  Mientras `perfil_id` sea null, ni siquiera esa: `null = auth.uid()` no es
--  true, así que la fila permanece invisible hasta que el alta la enlaza.
--
--  NO SE AGREGA NINGUNA POLÍTICA PARA `anon`, ni siquiera "para poder validar
--  el correo durante el registro". Esa política sería exactamente la fuga
--  descrita arriba, y encima sin sesión iniciada. Quien consulta la nómina en
--  el alta es el trigger de §2, que es SECURITY DEFINER y atraviesa RLS por
--  diseño: no necesita permiso de cliente y no debe pedirlo.
--
--  El `enable row level security` de esta tabla va SIN guardar en un bloque
--  condicional, a diferencia de `configuracion`. Es deliberado: si db-esquema
--  todavía no creó `nomina`, se prefiere que la migración se caiga de forma
--  ruidosa a que pase de largo y deje el directorio del curso con RLS apagado
--  y los grants por defecto de Supabase abiertos.
-- ============================================================================

-- El estudiante ve su propio renglón y nada más.
drop policy if exists nomina_lectura_propia on public.nomina;
create policy nomina_lectura_propia
  on public.nomina
  for select
  to authenticated
  using (perfil_id = auth.uid());

-- El docente ve la nómina de sus propias sesiones. La de otro docente, no.
drop policy if exists nomina_lectura_docente on public.nomina;
create policy nomina_lectura_docente
  on public.nomina
  for select
  to authenticated
  using (public.es_docente_de(sesion_id));

-- Carga de la lista. El `with check` sobre sesion_id impide sembrar filas en
-- la sesión de otro docente, que serviría para colar a alguien a un curso ajeno.
drop policy if exists nomina_insercion_docente on public.nomina;
create policy nomina_insercion_docente
  on public.nomina
  for insert
  to authenticated
  with check (public.es_docente_de(sesion_id));

-- Corrección de la lista (un carné mal escrito es el caso normal).
drop policy if exists nomina_actualiza_docente on public.nomina;
create policy nomina_actualiza_docente
  on public.nomina
  for update
  to authenticated
  using (public.es_docente_de(sesion_id))
  with check (public.es_docente_de(sesion_id));

drop policy if exists nomina_borra_docente on public.nomina;
create policy nomina_borra_docente
  on public.nomina
  for delete
  to authenticated
  using (public.es_docente_de(sesion_id));

-- Sin insert, update ni delete para el estudiante: si pudiera insertar, se
-- agregaría solo a la nómina y con eso se saltaría el control de matrícula
-- entero, que es justamente lo que esta tabla vino a sostener.


-- ============================================================================
--  7. ESTACIONES — LAS RESPUESTAS CORRECTAS
-- ----------------------------------------------------------------------------
--  RLS ACTIVO Y CERO POLÍTICAS. A propósito. Para nadie: ni estudiante, ni
--  docente, ni la clave anon. La columna `respuesta` (y `codigo`, `pistas`,
--  `feedback_ok`) no sale jamás hacia el cliente.
--
--  NO AGREGUES UNA POLÍTICA DE SELECT AQUÍ. Ni "solo para el docente", ni
--  "solo las columnas públicas". Para las columnas públicas ya existe la vista
--  `estaciones_publicas`. Una sola política de select en esta tabla convierte
--  el escape room en un cuestionario con las respuestas impresas al reverso.
--
--  Quien sí lee esta tabla es verificar_estacion() (03-funciones.sql), que es
--  SECURITY DEFINER y corre como el dueño: RLS no se le aplica porque la tabla
--  no está en modo `force`.
--
--  Además de RLS, se revoca el privilegio de tabla más abajo (§10): dos
--  cerrojos distintos, uno de fila y uno de privilegio.
-- ============================================================================

-- (sin políticas, deliberadamente)


-- ============================================================================
--  8. INTENTOS y PROGRESO — solo lectura para todo el mundo
-- ----------------------------------------------------------------------------
--  Contrato §3 y §14.2: el estudiante tiene SELECT del propio equipo y NADA
--  MÁS. Sin insert, sin update, sin delete. El docente tiene SELECT de los de
--  sus sesiones y tampoco escribe.
--
--  Ambas tablas se escriben EXCLUSIVAMENTE desde verificar_estacion(), que es
--  SECURITY DEFINER. Esa es la razón de ser del diseño: si el estudiante
--  pudiera insertar en `progreso`, se declararía la estación resuelta sin
--  resolverla, se saltaría el bloqueo de la estación 5 y el juego dejaría de
--  medir nada. Y si pudiera insertar en `intentos`, falsearía el conteo del que
--  depende qué pista se entrega.
--
--  Por eso aquí SOLO hay políticas de select. La ausencia de las otras tres no
--  es un olvido: es el control.
-- ============================================================================

drop policy if exists intentos_lectura_equipo on public.intentos;
create policy intentos_lectura_equipo
  on public.intentos
  for select
  to authenticated
  using (public.pertenezco_a(equipo_id));

drop policy if exists intentos_lectura_docente on public.intentos;
create policy intentos_lectura_docente
  on public.intentos
  for select
  to authenticated
  using (public.es_docente_del_equipo(equipo_id));

-- Sin insert / update / delete en intentos. Ver el bloque de arriba.

drop policy if exists progreso_lectura_equipo on public.progreso;
create policy progreso_lectura_equipo
  on public.progreso
  for select
  to authenticated
  using (public.pertenezco_a(equipo_id));

drop policy if exists progreso_lectura_docente on public.progreso;
create policy progreso_lectura_docente
  on public.progreso
  for select
  to authenticated
  using (public.es_docente_del_equipo(equipo_id));

-- Sin insert / update / delete en progreso. Ver el bloque de arriba.


-- ============================================================================
--  9. CALIFICACIONES — la rúbrica del caso §5
-- ----------------------------------------------------------------------------
--  Contrato §3: estudiante select del propio equipo; docente CRUD de las de
--  sus sesiones. La nota de un equipo no la ve ningún otro equipo.
-- ============================================================================

drop policy if exists calificaciones_lectura_equipo on public.calificaciones;
create policy calificaciones_lectura_equipo
  on public.calificaciones
  for select
  to authenticated
  using (public.pertenezco_a(equipo_id));

drop policy if exists calificaciones_lectura_docente on public.calificaciones;
create policy calificaciones_lectura_docente
  on public.calificaciones
  for select
  to authenticated
  using (public.es_docente_del_equipo(equipo_id));

-- El estudiante lee su nota pero no la escribe: sin estas tres políticas
-- restringidas al docente, cualquiera se pondría 4 en los cuatro criterios.
drop policy if exists calificaciones_insercion_docente on public.calificaciones;
create policy calificaciones_insercion_docente
  on public.calificaciones
  for insert
  to authenticated
  with check (public.es_docente_del_equipo(equipo_id));

drop policy if exists calificaciones_actualiza_docente on public.calificaciones;
create policy calificaciones_actualiza_docente
  on public.calificaciones
  for update
  to authenticated
  using (public.es_docente_del_equipo(equipo_id))
  with check (public.es_docente_del_equipo(equipo_id));

drop policy if exists calificaciones_borra_docente on public.calificaciones;
create policy calificaciones_borra_docente
  on public.calificaciones
  for delete
  to authenticated
  using (public.es_docente_del_equipo(equipo_id));


-- ============================================================================
--  9 bis. CONFIGURACION y DOCENTES_AUTORIZADOS — RLS sin políticas
-- ----------------------------------------------------------------------------
--  Decisión harness Ola 1.3: ambas tablas con RLS activo y CERO políticas.
--  Las lee solo el trigger SECURITY DEFINER. Si existiera una política de
--  select/insert, un cliente podría leer la lista blanca o escribir su propio
--  correo como docente. Intencionalmente vacío. Se borra cualquier política
--  previa si existiera de una corrida anterior.
-- ============================================================================

do $cfg2$
begin
  if to_regclass('public.configuracion') is not null then
    execute 'drop policy if exists configuracion_lectura_autenticados on public.configuracion';
  end if;
  if to_regclass('public.docentes_autorizados') is not null then
    execute 'drop policy if exists docentes_autorizados_lectura_autenticados on public.docentes_autorizados';
  end if;
end
$cfg2$;


-- ============================================================================
--  10. PRIVILEGIOS Y VISTAS — la segunda cerradura
-- ----------------------------------------------------------------------------
--  RLS filtra filas; los privilegios (GRANT/REVOKE) filtran tablas y columnas.
--  Son capas independientes y aquí se usan las dos, porque un error en una no
--  debe bastar para abrir la base.
--
--  IMPORTANTE SOBRE LAS VISTAS: en Postgres una vista NO tiene políticas
--  propias. Por omisión corre con los permisos de quien la creó
--  (`security_invoker = off`), o sea POR ENCIMA del RLS de sus tablas. Eso es
--  justo lo que se quiere en `estaciones_publicas` (expone solo las columnas
--  inofensivas de una tabla totalmente cerrada) y es exactamente lo que NO se
--  quiere en `v_desempeno` (mostraría a cualquier estudiante el desempeño de
--  todos los equipos de todas las secciones).
--
--  Todo el bloque va guardado: si los roles de Supabase no existen (por
--  ejemplo en un Postgres local de prueba), se omite con un aviso en vez de
--  reventar la migración.
-- ============================================================================

do $priv$
begin
  if to_regrole('anon') is null or to_regrole('authenticated') is null then
    raise notice 'RLS: no existen los roles anon/authenticated; se omiten GRANT/REVOKE.';
    return;
  end if;

  -- --- estaciones: ni asomarse. Ni siquiera aparece en la API REST. ---------
  execute 'revoke all on table public.estaciones from anon, authenticated';

  -- --- estaciones_publicas: la única puerta al contenido de las estaciones --
  if to_regclass('public.estaciones_publicas') is not null then
    -- security_invoker = off es el default; se declara explícito porque de
    -- ello depende que la vista pueda leer una tabla con RLS cerrado.
    execute 'alter view public.estaciones_publicas set (security_invoker = off)';
    execute 'revoke all on table public.estaciones_publicas from anon, authenticated';
    execute 'grant select on table public.estaciones_publicas to authenticated';
  end if;

  -- --- v_desempeno: hereda el RLS de quien consulta ------------------------
  -- Con security_invoker = on, el docente ve sus sesiones y el equipo ve lo
  -- suyo, porque se aplican las políticas de arriba. Sin esto, la vista sería
  -- una fuga completa de datos personales y notas hacia cualquier estudiante.
  -- REPORTADO AL HARNESS: coordinar con db-esquema. Si v_desempeno llegara a
  -- leer `estaciones` (cerrada para todos), el panel docente devolvería vacío.
  if to_regclass('public.v_desempeno') is not null then
    execute 'alter view public.v_desempeno set (security_invoker = on)';
    execute 'revoke all on table public.v_desempeno from anon, authenticated';
    execute 'grant select on table public.v_desempeno to authenticated';
  end if;

  -- --- perfiles: identidad congelada (Ola 1.2) — sin update para nadie -----
  -- Ni siquiera el propio estudiante puede reescribir su fila. Solo SELECT.
  execute 'revoke insert, update, delete, truncate on table public.perfiles from anon, authenticated';
  execute 'grant  select on table public.perfiles to authenticated';

  -- --- intentos y progreso: lectura y nada más -----------------------------
  -- verificar_estacion() no se ve afectada: es SECURITY DEFINER y escribe con
  -- los privilegios de su dueño, no con los de `authenticated`.
  execute 'revoke insert, update, delete, truncate on table public.intentos from anon, authenticated';
  execute 'revoke insert, update, delete, truncate on table public.progreso from anon, authenticated';
  execute 'grant  select on table public.intentos to authenticated';
  execute 'grant  select on table public.progreso to authenticated';

  -- --- anon no lee nada de las tablas de datos -----------------------------
  -- Sin sesión iniciada no hay nada que ver. Ninguna política es `to anon`,
  -- pero se revoca igual para que estas tablas ni figuren en la API pública.
  execute 'revoke all on table public.perfiles, public.sesiones, public.equipos,
                             public.integrantes, public.intentos, public.progreso,
                             public.calificaciones, public.nomina
           from anon';

  -- `nomina` conserva insert/update/delete para `authenticated` porque el
  -- docente carga y corrige la lista desde el panel, y el docente llega con
  -- ese rol. Quién puede escribir qué fila lo decide RLS, no el privilegio.
  execute 'grant select, insert, update, delete on table public.nomina to authenticated';

  -- --- funciones auxiliares: solo para quien inició sesión -----------------
  -- Están en el esquema public, así que PostgREST las publicaría como RPC.
  -- No filtran datos (hablan solo de auth.uid()), pero no hay razón para que
  -- una petición anónima pueda invocarlas.
  execute 'revoke execute on function public.es_docente()            from public, anon';
  execute 'revoke execute on function public.mi_rol()                from public, anon';
  execute 'revoke execute on function public.es_docente_de(uuid)     from public, anon';
  execute 'revoke execute on function public.es_docente_del_equipo(uuid) from public, anon';
  execute 'revoke execute on function public.es_docente_del_perfil(uuid) from public, anon';
  execute 'revoke execute on function public.tengo_equipo_en(uuid)   from public, anon';
  execute 'revoke execute on function public.pertenezco_a(uuid)      from public, anon';
  execute 'revoke execute on function public.mi_equipo_id()          from public, anon';

  execute 'grant execute on function public.es_docente()                to authenticated';
  execute 'grant execute on function public.mi_rol()                    to authenticated';
  execute 'grant execute on function public.es_docente_de(uuid)         to authenticated';
  execute 'grant execute on function public.es_docente_del_equipo(uuid) to authenticated';
  execute 'grant execute on function public.es_docente_del_perfil(uuid) to authenticated';
  execute 'grant execute on function public.tengo_equipo_en(uuid)       to authenticated';
  execute 'grant execute on function public.pertenezco_a(uuid)          to authenticated';
  execute 'grant execute on function public.mi_equipo_id()              to authenticated';

  -- --- configuracion y docentes_autorizados: nadie desde cliente ----------
  -- RLS sin políticas (Ola 1.3). Doble candado con GRANT: revoke all.
  if to_regclass('public.configuracion') is not null then
    execute 'revoke all on table public.configuracion from anon, authenticated, public';
  end if;
  if to_regclass('public.docentes_autorizados') is not null then
    execute 'revoke all on table public.docentes_autorizados from anon, authenticated, public';
  end if;
end
$priv$;


-- ============================================================================
--  11. DEPENDENCIA CON 01-esquema.sql — leer antes de dar por buena la corrida
-- ----------------------------------------------------------------------------
--  El trigger de alta de §2 inserta en `perfiles` cuando nace un `auth.users`.
--  `perfiles` NO tiene política de insert, y el trigger corre con el rol de
--  GoTrue (supabase_auth_admin), que no es dueño de la tabla. Si esa función
--  de trigger no es SECURITY DEFINER y propiedad del dueño de `perfiles`, el
--  registro de estudiantes falla con "new row violates row-level security
--  policy for table perfiles".
--  No es corregible desde este archivo: es de db-esquema. Queda reportado.
-- ============================================================================


-- ============================================================================
--  PRUEBAS NEGATIVAS OBLIGATORIAS
-- ----------------------------------------------------------------------------
--  Para qa-seguridad. Todas estas consultas DEBEN FALLAR. Una política se da
--  por buena cuando se prueba el acceso que debe ser denegado, no cuando el
--  acceso permitido funciona.
--
--  Fallar significa una de dos cosas, ambas aceptables:
--    a) ERROR 42501 -- permission denied / new row violates row-level security
--    b) 0 filas     -- para SELECT y UPDATE, RLS no lanza error: esconde filas.
--       En un SELECT, "0 filas" ES el resultado correcto de una denegación.
--  Lo que NUNCA es aceptable es que devuelva datos.
--
--  ANTES DE EMPEZAR, EN psql:
--
--    \set ON_ERROR_STOP off
--    \set ON_ERROR_ROLLBACK on
--
--  Sin la segunda línea, el primer error esperado aborta la transacción y
--  todas las pruebas siguientes devuelven "current transaction is aborted"
--  en vez de su resultado real. Se han visto tandas enteras dadas por buenas
--  por este motivo: la primera prueba pasa y las otras veinte ni corren.
--
--  Cómo suplantar a un estudiante dentro de psql (usar `begin` / `rollback`
--  para no dejar rastro, y `set local` para que el rol vuelva solo):
--
--    begin;
--    set local role authenticated;
--    set local request.jwt.claims =
--      '{"sub":"<UUID-DEL-ESTUDIANTE-A>","role":"authenticated"}';
--    -- ... aquí va la prueba ...
--    rollback;
--
--  Se necesitan sembrados de antemano: estudiante A en el equipo A, estudiante
--  B en el equipo B (equipos distintos), y una sesión abierta.
--  Desde el frontend, la prueba equivalente es un fetch con la clave anon y el
--  access_token del estudiante A contra /rest/v1/<tabla>.
-- ============================================================================
--
-- ---------------------------------------------------------------------------
-- PRUEBA 1 — Las respuestas correctas. DEBE FALLAR (permission denied).
-- ---------------------------------------------------------------------------
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
-- select * from public.estaciones;                       -- ERROR 42501 esperado
-- select respuesta from public.estaciones where id = 1;  -- ERROR 42501 esperado
-- select codigo, pistas, feedback_ok from public.estaciones; -- ERROR 42501 esperado
-- rollback;
--
-- Y como docente, que tampoco puede:
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-DOCENTE>","role":"authenticated"}';
-- select * from public.estaciones;                       -- ERROR 42501 esperado
-- rollback;
--
-- Contraprueba positiva (esta SÍ debe devolver las 5 estaciones, y NINGUNA
-- columna llamada respuesta, codigo, pistas ni feedback_ok):
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
-- select * from public.estaciones_publicas;
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 2 — Declararse resuelto sin resolver. DEBE FALLAR.
-- ---------------------------------------------------------------------------
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
--
-- insert into public.progreso (equipo_id, estacion_id, estado, intentos, resuelta_en)
-- values ('<UUID-EQUIPO-A>', 1, 'resuelta', 1, now());   -- ERROR 42501 esperado
--
-- update public.progreso set estado = 'resuelta'
--  where equipo_id = '<UUID-EQUIPO-A>' and estacion_id = 5;  -- 0 filas / ERROR
--
-- -- desbloquear la estación 5 saltándose las cuatro anteriores:
-- update public.progreso set estado = 'pendiente'
--  where equipo_id = '<UUID-EQUIPO-A>' and estacion_id = 5;  -- 0 filas / ERROR
--
-- delete from public.progreso where equipo_id = '<UUID-EQUIPO-A>'; -- 0 filas / ERROR
--
-- -- falsear el conteo de intentos para forzar la pista 3:
-- insert into public.intentos (equipo_id, estacion_id, perfil_id, respuesta, correcto)
-- values ('<UUID-EQUIPO-A>', 1, '<UUID-ESTUDIANTE-A>', '{}'::jsonb, true); -- ERROR 42501
--
-- -- estirar el cronómetro:
-- update public.equipos set iniciado_en = now() where id = '<UUID-EQUIPO-A>'; -- 0 filas
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 3 — Espiar a otro equipo. DEBE DEVOLVER 0 FILAS.
-- ---------------------------------------------------------------------------
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
-- select * from public.intentos  where equipo_id = '<UUID-EQUIPO-B>';  -- 0 filas
-- select * from public.progreso  where equipo_id = '<UUID-EQUIPO-B>';  -- 0 filas
-- select * from public.equipos   where id        = '<UUID-EQUIPO-B>';  -- 0 filas
-- select * from public.integrantes where equipo_id = '<UUID-EQUIPO-B>';-- 0 filas
-- -- sin filtro, para confirmar que solo aparece lo propio:
-- select distinct equipo_id from public.intentos;   -- solo <UUID-EQUIPO-A>
-- select distinct equipo_id from public.progreso;   -- solo <UUID-EQUIPO-A>
-- -- meterse solo a otro equipo (sería la llave de todo lo demás):
-- insert into public.integrantes (equipo_id, perfil_id)
-- values ('<UUID-EQUIPO-B>', '<UUID-ESTUDIANTE-A>');   -- ERROR 42501 esperado
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 4 — Escalada de privilegios a docente. DEBE FALLAR.
-- ---------------------------------------------------------------------------
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
--
-- update public.perfiles set rol = 'docente' where id = '<UUID-ESTUDIANTE-A>';
--   -- ERROR 42501: permission denied for column rol  (o violación de with check)
--
-- -- la variante astuta: cambiar el rol junto con un campo que sí se permite
-- update public.perfiles set nombre = 'X', rol = 'docente'
--  where id = '<UUID-ESTUDIANTE-A>';                  -- ERROR 42501 esperado
--
-- -- editar el perfil de otra persona:
-- update public.perfiles set nombre = 'hackeado' where id = '<UUID-ESTUDIANTE-B>'; -- 0 filas
--
-- -- leer los datos personales de la clase:
-- select id, nombre, correo, carne from public.perfiles;  -- solo la fila propia
--
-- -- crearse un perfil paralelo ya con rol docente:
-- insert into public.perfiles (id, nombre, carne, correo, rol)
-- values (gen_random_uuid(), 'Falso', 'X999', 'x@y.z', 'docente'); -- ERROR 42501
--
-- -- crearse una sesión propia para volverse docente de hecho:
-- insert into public.sesiones (nombre, docente_id)
-- values ('mia', '<UUID-ESTUDIANTE-A>');              -- ERROR 42501 esperado
-- rollback;
--
-- Comprobación posterior obligatoria (fuera de la transacción, como dueño):
-- select id, rol from public.perfiles where id = '<UUID-ESTUDIANTE-A>';
--   -- debe seguir diciendo 'estudiante'
--
-- ---------------------------------------------------------------------------
-- PRUEBA 5 — Notas ajenas y notas propias. DEBE DEVOLVER 0 FILAS / FALLAR.
-- ---------------------------------------------------------------------------
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
-- select * from public.calificaciones where equipo_id = '<UUID-EQUIPO-B>'; -- 0 filas
-- select * from public.calificaciones;                    -- solo el equipo propio
-- -- ponerse la nota:
-- update public.calificaciones
--    set uso_evidencia = 4, distincion_dato = 4,
--        pensamiento_critico = 4, trabajo_equipo = 4, nota_final = 10.00
--  where equipo_id = '<UUID-EQUIPO-A>';                   -- 0 filas / ERROR
-- insert into public.calificaciones (equipo_id, nota_final)
-- values ('<UUID-EQUIPO-A>', 10.00);                      -- ERROR 42501 esperado
-- -- borrar una nota mala:
-- delete from public.calificaciones where equipo_id = '<UUID-EQUIPO-A>'; -- 0 filas / ERROR
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 6 — LA NÓMINA: el directorio del curso. 0 FILAS AJENAS / ERROR.
-- ---------------------------------------------------------------------------
-- Prerrequisito: la nómina de la sesión cargada con al menos tres renglones,
-- uno de ellos con perfil_id = <UUID-ESTUDIANTE-A> y los otros con el
-- perfil_id de otras personas o en null (todavía sin registrarse).
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-ESTUDIANTE-A>","role":"authenticated"}';
--
-- select * from public.nomina;
--   -- DEBE devolver a lo sumo UNA fila: la del propio estudiante A.
--   -- Cualquier correo o carné de otra persona aquí es la fuga de datos
--   -- personales del sistema. Revisar uno por uno los correos devueltos.
--
-- select count(*) from public.nomina;            -- 0 o 1, nunca el total del curso
-- select correo, carne from public.nomina where perfil_id is null;   -- 0 filas
-- select * from public.nomina where correo = '<CORREO-DE-OTRA-PERSONA>'; -- 0 filas
--
-- -- colarse a la matrícula:
-- insert into public.nomina (id, sesion_id, nombre, correo, carne, perfil_id)
-- values (gen_random_uuid(), '<UUID-SESION>', 'Colado', 'colado@x.y', 'Z999',
--         '<UUID-ESTUDIANTE-A>');                -- ERROR 42501 esperado
--
-- -- apropiarse del renglón de otra persona:
-- update public.nomina set perfil_id = '<UUID-ESTUDIANTE-A>'
--  where correo = '<CORREO-DE-OTRA-PERSONA>';    -- 0 filas / ERROR
--
-- delete from public.nomina;                     -- 0 filas / ERROR
-- rollback;
--
-- Y sin sesión iniciada, que es como llega quien se está registrando:
-- begin;
-- set local role anon;
-- select * from public.nomina;                   -- ERROR 42501 esperado
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 7 — Sin sesión iniciada (clave anon a secas). TODO 0 FILAS / ERROR.
-- ---------------------------------------------------------------------------
-- begin;
-- set local role anon;
-- select * from public.perfiles;        -- ERROR 42501 esperado
-- select * from public.estaciones;      -- ERROR 42501 esperado
-- select * from public.calificaciones;  -- ERROR 42501 esperado
-- select * from public.nomina;          -- ERROR 42501 esperado
-- select * from public.v_desempeno;     -- ERROR 42501 esperado
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 8 — Un docente contra la sesión de otro docente. 0 FILAS.
-- ---------------------------------------------------------------------------
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"<UUID-DOCENTE-1>","role":"authenticated"}';
-- select * from public.sesiones where docente_id = '<UUID-DOCENTE-2>';  -- 0 filas
-- select * from public.perfiles;   -- solo el propio y los de SUS sesiones
-- select * from public.nomina;     -- solo la nómina de SUS sesiones
-- select * from public.v_desempeno;-- solo equipos de SUS sesiones
-- update public.sesiones set estado = 'cerrada' where id = '<UUID-SESION-DE-DOCENTE-2>';
--   -- 0 filas
-- rollback;
--
-- ---------------------------------------------------------------------------
-- PRUEBA 9 — Inventario estructural. Se corre como dueño de la base.
-- ---------------------------------------------------------------------------
-- -- (a) Toda tabla del esquema public con RLS activo. `rowsecurity` = true en
-- --     las diez. Cualquier `false` es un agujero abierto:
-- select relname, relrowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'r'
--  order by relname;
--
-- -- (b) `estaciones` debe tener EXACTAMENTE 0 políticas:
-- select count(*) as politicas_en_estaciones
--   from pg_policies where schemaname = 'public' and tablename = 'estaciones';
--   -- resultado esperado: 0
--
-- -- (c) `intentos` y `progreso` deben tener SOLO políticas de cmd = SELECT:
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname = 'public' and tablename in ('intentos','progreso')
--  order by tablename, policyname;
--   -- esperado: cuatro filas, las cuatro con cmd = SELECT
--
-- -- (d) Ninguna política debe estar concedida al rol `anon`:
-- select tablename, policyname, roles
--   from pg_policies where schemaname = 'public' and 'anon' = any(roles);
--   -- resultado esperado: 0 filas
--
-- -- (e) `authenticated` no debe poder actualizar la columna rol:
-- select has_column_privilege('authenticated','public.perfiles','rol','UPDATE');
--   -- resultado esperado: false
--
-- -- (f) `v_desempeno` debe tener security_invoker = on:
-- select reloptions from pg_class
--  where oid = 'public.v_desempeno'::regclass;   -- debe incluir security_invoker=on
--
-- ============================================================================
--  FIN — sql/02-rls.sql
-- ============================================================================
