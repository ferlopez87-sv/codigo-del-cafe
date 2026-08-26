-- =============================================================================
-- EL CÓDIGO DEL CAFÉ — 01-esquema.sql
-- Tablas, vistas, funciones, triggers e índices.
-- Dueño: subagente `db-esquema`. Contrato: CONTRACT.md §2.
-- =============================================================================
--
-- QUÉ HACE ESTE ARCHIVO
--   Levanta la estructura completa de la base: quién juega, en qué sesión,
--   con qué equipo, qué intentó y cómo le fue. NO define permisos.
--
-- QUÉ *NO* HACE (a propósito)
--   - No activa RLS ni escribe políticas  -> eso vive en sql/02-rls.sql (db-rls).
--   - No define verificar_estacion() ni las demás RPC -> sql/03-funciones.sql.
--   - No inserta el contenido de las estaciones -> sql/05-seed.sql (contenido).
--
-- ORDEN DE EJECUCIÓN EN EL SQL EDITOR DE SUPABASE
--   01-esquema.sql  ->  02-rls.sql  ->  03-funciones.sql  ->  05-seed.sql
--
-- ESTE ARCHIVO ES IDEMPOTENTE: se puede correr las veces que haga falta.
--   Usa `create table if not exists`, `create or replace` en funciones y vistas,
--   y `drop trigger if exists` antes de cada `create trigger`. Correrlo dos
--   veces no borra datos ni tira error.
--
-- REQUISITOS: Postgres 15 o superior (Supabase lo cumple).
--   `gen_random_uuid()` viene incluido en el core desde Postgres 13,
--   así que no hace falta instalar ninguna extensión.
--
-- -----------------------------------------------------------------------------
-- CÓMO SE CONTROLA QUIÉN PUEDE REGISTRARSE (leer esto antes de la primera clase)
-- -----------------------------------------------------------------------------
--   El acceso NO se controla por dominio de correo: la Escuela no tiene un
--   dominio institucional utilizable, y los estudiantes llegan con Gmail,
--   Outlook o lo que sea. Se controla con dos listas blancas disjuntas:
--     · `nomina` (por sesión) → estudiantes. Nombre/carné copiados de la nómina.
--     · `docentes_autorizados` (global) → docentes. Correo autorizado.
--   El trigger de alta (sección 12) evalúa: ¿está en docentes_autorizados?
--   → rol docente; ¿está en nomina? → rol estudiante; ninguna → rechazo.
--   Se cierra solo, sin interruptor que olvidar apagar.
--
--   BOOTSTRAP — el círculo se rompe sembrando el primer docente ANTES del
--   primer registro:
--     insert into docentes_autorizados (correo, nota)
--     values ('fglopez@monicaherrera.edu.sv','docente titular');
--   Luego Fernando se registra normal y cae con rol docente. Ver sección 1 bis.
--   IMPORTANTE para db-rls: `configuracion` y `docentes_autorizados` van con
--   RLS activo y CERO políticas (sección RLS). Las lee solo el trigger
--   SECURITY DEFINER. Si un cliente pudiera escribirlas, se haría docente.
-- =============================================================================


-- =============================================================================
-- 1. CONFIGURACIÓN — parámetros que Fernando puede cambiar sin tocar código
-- =============================================================================
-- Tabla llave/valor pequeña. Hoy vacía; reservada para futuros parámetros
-- (p.ej. duracion por defecto). RLS sin políticas (ver db-rls): nadie la toca
-- desde el cliente, solo triggers SECURITY DEFINER.

create table if not exists configuracion (
  clave           text primary key,
  valor           text not null,
  actualizada_en  timestamptz not null default now()
);

comment on table configuracion is
  'Parámetros editables del juego (llave/valor). Reservada. RLS sin políticas.';

-- Limpieza: versiones antiguas sembraban dominio y modo_registro. Ambos
-- descartados por decisiones del harness Ola 1. Se borran si existen; en base
-- limpia no hacen nada. No se vuelve a sembrar modo_registro: el interruptor
-- que depende de acordarse de apagarlo no es un control.
delete from configuracion where clave = 'dominio_institucional';
delete from configuracion where clave = 'modo_registro';

-- =============================================================================
-- 1 bis. DOCENTES AUTORIZADOS — lista blanca global de docentes
-- =============================================================================
-- Simétrica a `nomina` pero global (no cuelga de sesión): evita el círculo
-- nomina→sesión→docente→perfil. Correo normalizado a minúsculas por trigger.
-- Sin RLS policies (ver 02-rls.sql): solo el trigger la lee.

create table if not exists docentes_autorizados (
  correo     text primary key,
  nota       text,
  creado_en  timestamptz not null default now()
);

comment on table docentes_autorizados is
  'Lista blanca global de docentes. Solo estos correos pueden obtener rol docente al registrarse. RLS sin políticas.';
comment on column docentes_autorizados.correo is 'Correo normalizado a minúsculas (trigger). Llave del registro docente.';

create or replace function public.docentes_autorizados_normalizar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.correo := lower(trim(coalesce(new.correo, '')));
  if position('@' in new.correo) = 0 then
    raise exception 'El correo "%" de docentes_autorizados no parece válido.', new.correo;
  end if;
  new.nota := nullif(trim(coalesce(new.nota,'')), '');
  return new;
end;
$$;

drop trigger if exists trg_docentes_autorizados_normalizar on public.docentes_autorizados;
create trigger trg_docentes_autorizados_normalizar
  before insert or update on public.docentes_autorizados
  for each row
  execute function public.docentes_autorizados_normalizar();


-- =============================================================================
-- 2. PERFILES — la persona detrás de cada cuenta
-- =============================================================================
-- Relación 1:1 con auth.users (la tabla de cuentas que administra Supabase).
-- Ahí no podemos agregar columnas propias, así que el nombre y el carné viven
-- acá. El id es el mismo: si se borra la cuenta, se borra el perfil (cascade).

create table if not exists perfiles (
  id          uuid primary key references auth.users on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 2 and 80),
  carne       text not null unique check (length(trim(carne)) between 3 and 20),
  correo      text not null,
  rol         text not null default 'estudiante' check (rol in ('estudiante','docente')),
  creado_en   timestamptz not null default now()
);

comment on table  perfiles is 'Perfil extendido de cada cuenta de auth.users (1:1).';
comment on column perfiles.carne is 'Carné estudiantil. Único: identifica a la persona en la escuela.';
comment on column perfiles.rol is 'Asignado por el trigger según lista blanca: docentes_autorizados→docente, nomina→estudiante. Nunca viene del cliente.';

-- Alta docente: insertar en docentes_autorizados ANTES de registrarse.
--   insert into docentes_autorizados (correo, nota) values ('fglopez@monicaherrera.edu.sv','docente titular');


-- =============================================================================
-- 3. SESIONES — una clase, un reloj
-- =============================================================================
-- Una sesión es una corrida del escape room con un grupo. Tiene dueño (docente),
-- duración y tres estados: borrador (se arma), abierta (se juega), cerrada.
-- El estado es lo que la RPC verificar_estacion() consulta antes de aceptar
-- cualquier respuesta: con la sesión cerrada, nadie sigue jugando.

create table if not exists sesiones (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  docente_id        uuid not null references perfiles(id),
  duracion_minutos  int  not null default 50 check (duracion_minutos between 5 and 180),
  estado            text not null default 'borrador' check (estado in ('borrador','abierta','cerrada')),
  creada_en         timestamptz not null default now(),
  cerrada_en        timestamptz
);

comment on table  sesiones is 'Una corrida del escape room con un grupo de clase.';
comment on column sesiones.duracion_minutos is
  'Minutos de juego. El tiempo restante SIEMPRE lo calcula el servidor (CONTRACT §4).';


-- =============================================================================
-- 4. NÓMINA — la lista de la clase. Es la puerta de entrada al juego
-- =============================================================================
-- POR QUÉ EXISTE Y POR QUÉ CUELGA DE `sesiones`
--
-- La nómina hace DOS trabajos al mismo tiempo, y por eso está atada a una
-- sesión y no a una lista global:
--
--   1) LISTA BLANCA DE REGISTRO. Solo quien aparece acá puede crear cuenta
--      (lo hace cumplir el trigger de la sección 12). Reemplaza al filtro por
--      dominio de correo: no importa si el estudiante usa Gmail o el correo de
--      su trabajo, importa que esté inscrito en el curso.
--
--   2) FUENTE DE VERDAD DE LA IDENTIDAD. El nombre y el carné del perfil se
--      copian de acá, NO de lo que la persona escriba en el formulario. La
--      nómina la carga el docente desde el listado oficial, así que nadie
--      puede equivocarse al teclear su carné ni ponerse el de otra persona.
--      El formulario de registro pide esos datos por cortesía; el servidor
--      los ignora y usa los de la nómina.
--
-- Al colgar de la sesión, además, el panel docente ya sabe a quién esperar en
-- cada clase: puede armar los equipos con la lista completa desde antes de que
-- el primer estudiante se registre, y ver quién falta por entrar.
--
-- La misma persona puede estar en la nómina de varias sesiones (dos cursos,
-- dos semestres). Por eso las restricciones únicas son por sesión, no globales.

create table if not exists nomina (
  id         uuid primary key default gen_random_uuid(),
  sesion_id  uuid not null references sesiones(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 2 and 80),
  correo     text not null,
  carne      text not null check (length(trim(carne)) between 3 and 20),
  perfil_id  uuid references perfiles(id),   -- se llena cuando la persona se registra
  creada_en  timestamptz not null default now(),
  unique (sesion_id, correo),
  unique (sesion_id, carne)
);

comment on table nomina is
  'Lista de la clase cargada por el docente. Hace dos cosas: (1) es la lista blanca de registro — solo estos correos pueden crear cuenta — y (2) es la fuente de verdad del nombre y el carné del perfil, para que el estudiante no los escriba mal ni suplante a nadie. Cuelga de sesiones porque cada clase tiene su propia lista.';
comment on column nomina.correo    is 'Siempre en minúsculas y sin espacios (lo fuerza un trigger). Es la llave con la que el registro busca a la persona.';
comment on column nomina.perfil_id is 'Se llena solo: al registrarse la persona, o al cargarla en la nómina si ya tenía cuenta.';

-- -----------------------------------------------------------------------------
-- Normalización del correo — no es cosmética, es lo que hace que la llave sirva
-- -----------------------------------------------------------------------------
-- El correo es la llave de búsqueda del registro. Si el docente pega la lista
-- desde Excel y una celda trae " Ana@Gmail.com " con un espacio invisible
-- adelante, esa estudiante queda fuera de su propia clase y nadie entiende por
-- qué. Se resuelve en un trigger BEFORE y no en el cliente: así vale para la
-- carga por pantalla, por CSV o por SQL a mano.

create or replace function public.nomina_normalizar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.correo := lower(trim(coalesce(new.correo, '')));
  new.nombre := trim(new.nombre);
  new.carne  := trim(new.carne);

  if position('@' in new.correo) = 0 then
    raise exception 'El correo "%" de la nómina no parece un correo válido.', new.correo;
  end if;

  -- Si la persona YA tenía cuenta y se le agrega ahora a una nómina nueva,
  -- se enlaza de una vez. Sin esto, perfil_id quedaría en null para siempre,
  -- porque el enlace normal ocurre al registrarse y eso ya pasó.
  if new.perfil_id is null then
    select p.id into new.perfil_id
      from public.perfiles p
     where p.correo = new.correo
     limit 1;
  end if;

  return new;
end;
$$;

comment on function public.nomina_normalizar() is
  'Deja el correo en minúsculas y sin espacios, y enlaza el perfil si la persona ya tenía cuenta.';

drop trigger if exists trg_nomina_normalizar on public.nomina;
create trigger trg_nomina_normalizar
  before insert or update on public.nomina
  for each row
  execute function public.nomina_normalizar();


-- =============================================================================
-- 5. EQUIPOS — quién compite contra el reloj
-- =============================================================================
-- iniciado_en lo sella el servidor en el primer acceso del equipo, no el
-- cliente: si el reloj lo arrancara el navegador, recargar la página sería
-- una forma trivial de hacer trampa.

create table if not exists equipos (
  id             uuid primary key default gen_random_uuid(),
  sesion_id      uuid not null references sesiones(id) on delete cascade,
  nombre         text not null,
  iniciado_en    timestamptz,
  finalizado_en  timestamptz,
  motivo_fin     text check (motivo_fin in ('completado','tiempo','cerrado')),
  unique (sesion_id, nombre)
);

comment on table  equipos is 'Equipos de una sesión. El nombre no se repite dentro de la misma sesión.';
comment on column equipos.iniciado_en is 'Lo sella el servidor al primer acceso. Nunca lo manda el cliente.';
comment on column equipos.motivo_fin  is 'completado = sacaron el código maestro | tiempo = se acabó | cerrado = el docente cerró la clase.';

-- Clave única auxiliar (id, sesion_id).
-- No sirve para buscar: existe únicamente para que `integrantes` pueda apuntar
-- a ella con una llave foránea compuesta y así garantizar, desde el motor, que
-- la sesión desnormalizada de un integrante siempre coincide con la real de su
-- equipo. Ver la explicación completa en la sección 6.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.equipos'::regclass
       and conname  = 'equipos_id_sesion_uk'
  ) then
    alter table public.equipos
      add constraint equipos_id_sesion_uk unique (id, sesion_id);
  end if;
end
$$;


-- =============================================================================
-- 6. INTEGRANTES — qué persona está en qué equipo
-- =============================================================================
-- DECISIÓN DE DISEÑO IMPORTANTE (léase esto antes de tocar la tabla)
--
-- El contrato pide una regla: una persona no puede estar en dos equipos de la
-- misma sesión. En CONTRACT.md §2 esa regla aparece escrita así:
--
--     create unique index integrantes_una_por_sesion
--       on integrantes (perfil_id, (select sesion_id from equipos where id = equipo_id));
--
-- Ese índice NO SE PUEDE CREAR. Postgres exige que la expresión de un índice
-- sea inmutable y dependa solo de la fila indexada; una subconsulta a otra
-- tabla no lo es (el resultado podría cambiar sin que la fila cambie, y el
-- índice quedaría mintiendo). El editor de Supabase devuelve directamente
-- «cannot use subquery in index expression».
--
-- SOLUCIÓN ELEGIDA: columna `sesion_id` desnormalizada en `integrantes`,
-- mantenida por el motor, con un índice único común y corriente sobre
-- (sesion_id, perfil_id).
--
-- Se eligió por encima de las otras dos opciones porque:
--   a) Un índice único es declarativo y a prueba de concurrencia. Un trigger
--      de validación que hiciera SELECT ... IF EXISTS puede dejar pasar dos
--      inserciones simultáneas (dos docentes asignando a la vez): entre el
--      SELECT y el INSERT no hay candado. El índice único no tiene esa grieta.
--   b) Una constraint de exclusión (EXCLUDE) necesitaría la extensión btree_gist
--      y sería equivalente pero más lenta y mucho más difícil de leer.
--   c) `sesion_id` además hace baratas dos consultas reales del panel docente:
--      «todos los integrantes de esta sesión» y «quién está sin equipo».
--
-- EL RIESGO DE DESNORMALIZAR (un dato repetido que puede quedar desfasado)
-- está cerrado por dos candados, no por disciplina de quien programa:
--   1. Un trigger BEFORE INSERT rellena sesion_id leyéndolo de `equipos`, e
--      IGNORA lo que mande quien inserta. Nadie puede meter un valor falso.
--   2. Una llave foránea compuesta (equipo_id, sesion_id) -> equipos(id, sesion_id)
--      con ON UPDATE CASCADE: si un equipo se moviera de sesión, Postgres
--      actualiza solo la fila de cada integrante. No hay forma de que las dos
--      tablas discrepen.
--
-- Consecuencia práctica para los demás subagentes: se sigue insertando igual
-- que en el contrato, `insert into integrantes (equipo_id, perfil_id) ...`.
-- La columna sesion_id se llena sola. Nadie tiene que saber que existe.

create table if not exists integrantes (
  equipo_id  uuid not null references equipos(id) on delete cascade,
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  sesion_id  uuid not null,
  primary key (equipo_id, perfil_id)
);

comment on table  integrantes is 'Qué persona juega en qué equipo.';
comment on column integrantes.sesion_id is 'Copia de equipos.sesion_id. La mantiene el motor (trigger + FK compuesta). Existe para poder tener un índice único (sesion_id, perfil_id): Postgres no permite subconsultas dentro de la definición de un índice.';

-- Red de seguridad por si la tabla se creó antes con la definición literal del
-- contrato (sin sesion_id). En una base limpia las tres líneas no hacen nada
-- (psql avisa «column already exists, skipping»: es lo esperado, no un error).
alter table integrantes add column if not exists sesion_id uuid;

update integrantes i
   set sesion_id = e.sesion_id
  from equipos e
 where e.id = i.equipo_id
   and i.sesion_id is distinct from e.sesion_id;

alter table integrantes alter column sesion_id set not null;

-- Llave foránea compuesta: candado #2 de los descritos arriba.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.integrantes'::regclass
       and conname  = 'integrantes_equipo_sesion_fk'
  ) then
    alter table public.integrantes
      add constraint integrantes_equipo_sesion_fk
      foreign key (equipo_id, sesion_id)
      references public.equipos (id, sesion_id)
      on update cascade
      on delete cascade;
  end if;
end
$$;


-- =============================================================================
-- 7. ESTACIONES — el contenido y, sobre todo, LAS RESPUESTAS
-- =============================================================================
-- Esta es la tabla sensible del proyecto. Guarda las respuestas correctas, las
-- pistas y los fragmentos del código maestro. En sql/02-rls.sql se le activa
-- RLS y NO se le escribe ninguna política: sin política no hay acceso, así que
-- ningún cliente puede leerla nunca, ni con la clave anon en la mano.
-- El juego lee el contenido por la vista `estaciones_publicas` (sección 11) y
-- las respuestas solo las toca verificar_estacion(), que corre en el servidor.

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

comment on table  estaciones is
  'Contenido + respuestas de las 5 estaciones. RLS sin políticas: nadie la lee desde el cliente.';
comment on column estaciones.pistas      is '3 pistas escalonadas. Intento 1 -> pistas[0], 2 -> pistas[1], 3 o más -> pistas[2].';
comment on column estaciones.codigo      is 'Fragmento del código maestro que se revela al acertar.';
comment on column estaciones.respuesta   is 'NUNCA sale al cliente. Solo la compara verificar_estacion().';
comment on column estaciones.interaccion is 'Define el tipo de widget: orden | numero | checklist | clasificacion (CONTRACT §11).';


-- =============================================================================
-- 8. INTENTOS — la bitácora de todo lo que se respondió
-- =============================================================================
-- Es el insumo de la evaluación: cuántas veces intentaron, qué se equivocaron,
-- quién respondió. Solo escribe aquí verificar_estacion(); el estudiante tiene
-- lectura y nada más (CONTRACT §3). Por eso no hay UPDATE ni DELETE previstos:
-- una bitácora que se puede editar no es una bitácora.

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

comment on table  intentos is 'Bitácora de respuestas. Solo la escribe verificar_estacion().';
comment on column intentos.detalle   is 'Clave de error de CONTRACT §12 (orden-mal, porcentaje-mal, ...). Decide qué pista mostrar.';
comment on column intentos.creado_en is 'Hora del servidor. Nunca un timestamp mandado por el navegador.';


-- =============================================================================
-- 9. PROGRESO — en qué va cada equipo, estación por estación
-- =============================================================================
-- 5 filas por equipo, creadas automáticamente (sección 13). La 5 nace
-- 'bloqueada' y solo se abre cuando las cuatro anteriores están resueltas;
-- eso lo decide un trigger del servidor, no el cliente (sección 15).

create table if not exists progreso (
  equipo_id    uuid not null references equipos(id) on delete cascade,
  estacion_id  int  not null references estaciones(id),
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','progreso','resuelta','bloqueada')),
  intentos     int  not null default 0,
  resuelta_en  timestamptz,
  primary key (equipo_id, estacion_id)
);

comment on table  progreso is 'Estado de cada estación por equipo. Solo lo escribe verificar_estacion().';
comment on column progreso.estado is
  'pendiente = disponible | progreso = ya intentaron y fallaron | resuelta = acertaron | bloqueada = aún no se habilita.';


-- =============================================================================
-- 10. CALIFICACIONES — la rúbrica del caso, llenada a mano por el docente
-- =============================================================================
-- Una fila por equipo (por eso equipo_id es la llave primaria). Los cuatro
-- criterios van de 1 a 4 según la rúbrica del caso §5. nota_final se escribe
-- a mano: el sistema mide desempeño, no pone notas solo.

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

comment on table calificaciones is 'Rúbrica del caso §5. La llena el docente en docente.html.';


-- =============================================================================
-- 11. VISTAS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 11.1 estaciones_publicas — lo ÚNICO que el cliente puede leer de las estaciones
-- -----------------------------------------------------------------------------
-- Expone 7 columnas y deja fuera las 4 sensibles: respuesta, pistas, codigo y
-- feedback_ok. Si alguien agrega una columna a esta vista, se acabó el juego.
--
-- Ojo técnico: la vista se deja SIN `security_invoker`. Esa es la decisión
-- correcta acá y es deliberada. La tabla `estaciones` tiene RLS sin políticas
-- (nadie la lee); una vista con security_invoker heredaría esa negación y
-- devolvería siempre cero filas. Al quedar en el modo por defecto, la vista
-- consulta con los permisos de su dueño y sirve exactamente las 7 columnas
-- inocuas. Es el patrón estándar de Supabase para exponer un subconjunto
-- seguro de una tabla cerrada.
-- El permiso de lectura (grant a `authenticated`) lo maneja sql/02-rls.sql.

create or replace view estaciones_publicas as
  select id, titulo, pilar, narrativa, datos, reto, interaccion
    from estaciones;

comment on view estaciones_publicas is
  'Contenido visible de las estaciones. JAMÁS incluir respuesta, pistas, codigo ni feedback_ok.';


-- -----------------------------------------------------------------------------
-- 11.2 v_desempeno — una fila por equipo. Es lo que exporta el panel docente a CSV
-- -----------------------------------------------------------------------------
-- Acá SÍ va `security_invoker = true`: la vista debe respetar el RLS de quien
-- consulta. Con eso, el docente ve los equipos de sus sesiones y un estudiante
-- vería a lo sumo el suyo, sin que haya que escribir un filtro de seguridad
-- dentro de la consulta (que sería fácil de olvidar y difícil de auditar).
--
-- Las subconsultas van en el SELECT y no como JOIN a propósito: con JOINs, un
-- equipo de 4 personas y 12 intentos multiplicaría filas y los conteos saldrían
-- inflados. Así cada número se calcula por separado y es correcto.

create or replace view v_desempeno
with (security_invoker = true) as
  select
    e.id                as equipo_id,
    e.nombre            as equipo,
    s.id                as sesion_id,
    s.nombre            as sesion,

    -- Integrantes en una sola celda, listos para el CSV: "Ana Ruiz (MH-1001), ..."
    coalesce(
      (select string_agg(p.nombre || ' (' || p.carne || ')', ', ' order by p.nombre)
         from integrantes it
         join perfiles p on p.id = it.perfil_id
        where it.equipo_id = e.id),
      ''
    ) as integrantes,

    (select count(*)
       from integrantes it
      where it.equipo_id = e.id) as total_integrantes,

    (select count(*)
       from progreso pr
      where pr.equipo_id = e.id
        and pr.estado = 'resuelta') as estaciones_resueltas,

    (select count(*)
       from intentos i
      where i.equipo_id = e.id) as intentos_totales,

    -- Segundos jugados. Si el equipo terminó, se cuenta hasta finalizado_en;
    -- si sigue jugando, hasta ahora. Si nunca arrancó, 0.
    case
      when e.iniciado_en is null then 0
      else greatest(
             0,
             floor(extract(epoch from (coalesce(e.finalizado_en, now()) - e.iniciado_en)))::int
           )
    end as segundos_usados,

    e.motivo_fin,
    e.iniciado_en,
    e.finalizado_en
  from equipos e
  join sesiones s on s.id = e.sesion_id;

comment on view v_desempeno is
  'Desempeño por equipo para el panel docente y la exportación a CSV (CONTRACT §2 y §8).';


-- =============================================================================
-- 12. ALTA DE USUARIOS — perfil automático, con dos listas blancas
-- =============================================================================
-- Se evalúa en orden: 1) docentes_autorizados → rol docente (nombre/carné de
-- metadatos o fallback), 2) nomina → rol estudiante (nombre/carné de la nómina),
-- 3) ninguna → excepción y la cuenta no nace (transacción abortada).
-- Por qué acá y no en el formulario: validación en navegador es cosmética,
-- se salta con consola. Acá es excepción de BD, irrodeable (CONTRACT §14.3).
-- Se cierra solo, sin interruptor modo_registro (rechazado Ola 1.1).

create or replace function public.manejar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo text;
  v_nombre text;
  v_carne  text;
  v_rol    text := 'estudiante';
  v_es_docente boolean := false;
begin
  v_correo := lower(trim(coalesce(new.email, '')));

  if v_correo = '' then
    raise exception 'La cuenta no trae correo. El registro del escape room requiere uno.';
  end if;

  -- ¿Docente autorizado? (lista blanca global, simétrica a nómina)
  select exists(select 1 from public.docentes_autorizados d where d.correo = v_correo) into v_es_docente;

  if v_es_docente then
    v_rol := 'docente';
    -- Nombre/carné del docente: preferencia metadatos del registro; fallback
    -- a correo/carné sintético si vienen vacíos (no bloquea el alta; el docente
    -- puede corregir luego, pero nunca nace como estudiante por falta de dato).
    v_nombre := nullif(trim(coalesce(new.raw_user_meta_data ->> 'nombre', '')), '');
    v_carne  := nullif(trim(coalesce(new.raw_user_meta_data ->> 'carne', '')), '');
    if v_nombre is null or length(v_nombre) < 2 then
      v_nombre := split_part(v_correo, '@', 1);
    end if;
    if v_carne is null or length(v_carne) < 3 then
      v_carne := 'DOC-' || upper(substr(md5(v_correo),1,6));
    end if;
  else
    -- Estudiante: debe estar en nómina, nombre/carné copiados de ella
    select trim(n.nombre), trim(n.carne)
      into v_nombre, v_carne
      from public.nomina n
     where n.correo = v_correo
     order by n.creada_en desc, n.id desc
     limit 1;

    if not found then
      raise exception 'correo_no_esta_en_la_nomina_del_curso'
        using hint = 'Pedile a tu docente que agregue tu correo a la nómina de la sesión.';
    end if;
  end if;

  -- Validaciones de forma con mensajes legibles
  if length(v_nombre) < 2 or length(v_nombre) > 80 then
    raise exception 'El nombre debe tener entre 2 y 80 caracteres. Recibido: "%".', v_nombre;
  end if;

  if length(v_carne) < 3 or length(v_carne) > 20 then
    raise exception 'El carné debe tener entre 3 y 20 caracteres. Recibido: "%".', v_carne;
  end if;

  if exists (select 1 from public.perfiles p
              where p.carne = v_carne and p.id <> new.id) then
    raise exception 'El carné % ya está registrado con otra cuenta. Revisá la nómina: hay dos filas con el mismo carné.', v_carne;
  end if;

  -- Alta del perfil con rol resuelto por lista blanca
  insert into public.perfiles (id, nombre, carne, correo, rol)
  values (new.id, v_nombre, v_carne, v_correo, v_rol)
  on conflict (id) do nothing;

  -- Enlaza nómina si era estudiante (docente no tiene fila en nómina)
  if coalesce(v_es_docente, false) = false then
    update public.nomina
       set perfil_id = new.id
     where correo = v_correo
       and perfil_id is distinct from new.id;
  end if;

  return new;
end;
$$;

comment on function public.manejar_nuevo_usuario() is
  'Crea el perfil al darse de alta. Docentes_autorizados→rol docente; nomina→estudiante; ninguna→rechazo. Sin modo_registro.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.manejar_nuevo_usuario();


-- =============================================================================
-- 13. ALTA DE EQUIPOS — las 5 filas de progreso se crean solas
-- =============================================================================
-- Un equipo sin progreso inicializado es un equipo con la pantalla en blanco.
-- En vez de confiar en que el panel docente se acuerde de crear las 5 filas,
-- las crea la base al insertarse el equipo.

create or replace function public.inicializar_progreso(p_equipo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estaciones int;
begin
  if p_equipo is null then
    raise exception 'inicializar_progreso() necesita un id de equipo.';
  end if;

  -- progreso.estacion_id apunta a estaciones(id): si el contenido todavía no
  -- se sembró, el INSERT fallaría con un error de llave foránea ilegible.
  -- Mejor decirlo con todas sus letras.
  select count(*) into v_estaciones
    from public.estaciones
   where id between 1 and 5;

  if v_estaciones < 5 then
    raise exception
      'Faltan estaciones en la base (hay %, se esperan 5). Corré sql/05-seed.sql antes de crear equipos.',
      v_estaciones;
  end if;

  -- Estaciones 1 a 4 disponibles; la 5 bloqueada hasta resolver las cuatro.
  insert into public.progreso (equipo_id, estacion_id, estado)
  select p_equipo,
         g.i,
         case when g.i = 5 then 'bloqueada' else 'pendiente' end
    from generate_series(1, 5) as g(i)
  on conflict (equipo_id, estacion_id) do nothing;   -- idempotente
end;
$$;

comment on function public.inicializar_progreso(uuid) is
  'Crea las 5 filas de progreso de un equipo: 1-4 pendientes, 5 bloqueada.';

-- Función puente: un trigger no puede llamar directo a inicializar_progreso()
-- porque un trigger no recibe argumentos; necesita un envoltorio que le pase new.id.
create or replace function public.equipos_tras_insertar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inicializar_progreso(new.id);
  return new;
end;
$$;

drop trigger if exists trg_equipos_inicializar_progreso on public.equipos;
create trigger trg_equipos_inicializar_progreso
  after insert on public.equipos
  for each row
  execute function public.equipos_tras_insertar();


-- =============================================================================
-- 14. INTEGRANTES — el trigger que rellena sesion_id (candado #1 de la sección 6)
-- =============================================================================
-- BEFORE INSERT: pisa cualquier valor que venga de afuera y pone el verdadero,
-- leído de la tabla equipos. Nadie puede insertar una sesión falsa ni por
-- error ni a propósito.

create or replace function public.integrantes_fijar_sesion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion uuid;
begin
  select e.sesion_id into v_sesion
    from public.equipos e
   where e.id = new.equipo_id;

  if v_sesion is null then
    raise exception 'El equipo % no existe.', new.equipo_id;
  end if;

  new.sesion_id := v_sesion;   -- se ignora a propósito lo que mandó quien inserta
  return new;
end;
$$;

comment on function public.integrantes_fijar_sesion() is
  'Rellena integrantes.sesion_id desde equipos. Permite el índice único (sesion_id, perfil_id).';

drop trigger if exists trg_integrantes_fijar_sesion on public.integrantes;
create trigger trg_integrantes_fijar_sesion
  before insert or update of equipo_id on public.integrantes
  for each row
  execute function public.integrantes_fijar_sesion();


-- =============================================================================
-- 15. DESBLOQUEO DE LA ESTACIÓN 5
-- =============================================================================
-- Regla del contrato §2: cuando las estaciones 1 a 4 de un equipo quedan
-- resueltas, la 5 pasa de 'bloqueada' a 'pendiente'. Lo decide el servidor.
-- Si lo decidiera el cliente, bastaría con editar una variable en la consola
-- para saltarse las cuatro primeras estaciones y llegar al veredicto.
--
-- Sobre la recursión: este trigger hace UPDATE sobre la misma tabla que lo
-- dispara, así que se dispara otra vez. No hay ciclo infinito porque la
-- segunda pasada trae estado = 'pendiente' y la cláusula WHEN ya no se cumple.

create or replace function public.desbloquear_estacion_5()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resueltas int;
begin
  select count(*) into v_resueltas
    from public.progreso p
   where p.equipo_id = new.equipo_id
     and p.estacion_id between 1 and 4
     and p.estado = 'resuelta';

  if v_resueltas = 4 then
    update public.progreso
       set estado = 'pendiente'
     where equipo_id   = new.equipo_id
       and estacion_id = 5
       and estado      = 'bloqueada';
  end if;

  return null;   -- trigger AFTER: el valor de retorno se ignora
end;
$$;

comment on function public.desbloquear_estacion_5() is
  'Abre la estación 5 cuando las cuatro anteriores del equipo están resueltas.';

drop trigger if exists trg_progreso_desbloquear_5 on public.progreso;
create trigger trg_progreso_desbloquear_5
  after insert or update of estado on public.progreso
  for each row
  when (new.estado = 'resuelta' and new.estacion_id between 1 and 4)
  execute function public.desbloquear_estacion_5();


-- =============================================================================
-- 16. ÍNDICES — para las consultas que el juego hace de verdad
-- =============================================================================
-- Un índice de más no es gratis: ocupa espacio y hace más lenta cada escritura.
-- Por eso acá solo están los accesos reales del sistema, y se anota cuáles ya
-- venían cubiertos por una llave primaria o una restricción única (Postgres
-- crea un índice automáticamente detrás de cada una de ellas).

-- (a) INTENTOS POR EQUIPO — el panel de monitoreo y el conteo de intentos por
--     estación (para elegir la pista). No había índice: intentos.id es la PK,
--     que no ayuda a filtrar por equipo.
create index if not exists idx_intentos_equipo
  on intentos (equipo_id, estacion_id, creado_en desc);

-- (b) PROGRESO POR EQUIPO — el filtro `equipo_id` ya lo resuelve la llave
--     primaria (equipo_id, estacion_id), porque equipo_id va de primero.
--     Lo que NO cubre es contar por estado ("¿ya resolvieron las cuatro?"),
--     que es justo lo que preguntan el trigger de desbloqueo y v_desempeno.
create index if not exists idx_progreso_equipo_estado
  on progreso (equipo_id, estado);

-- (c) INTEGRANTES POR PERFIL — es la consulta de arranque de cada estudiante
--     ("¿en qué equipo estoy?", RPC mi_equipo). La PK es (equipo_id, perfil_id),
--     y con perfil_id de segundo no sirve para buscar por persona.
create index if not exists idx_integrantes_perfil
  on integrantes (perfil_id);

-- (d) EQUIPOS POR SESIÓN — cubierto por la restricción unique (sesion_id, nombre)
--     de la tabla equipos: sesion_id va de primero, así que su índice ya sirve
--     para "dame los equipos de esta sesión". No se crea uno duplicado.

-- (e) NÓMINA POR CORREO — la consulta del trigger de alta, que corre en cada
--     registro. La restricción unique (sesion_id, correo) NO sirve para esto:
--     tiene sesion_id de primero y el trigger busca solo por correo, sin saber
--     la sesión. Por eso necesita índice propio.
create index if not exists idx_nomina_correo
  on nomina (correo);

--     Y para el panel docente: "¿quién de mi lista todavía no se registra?"
create index if not exists idx_nomina_sesion_perfil
  on nomina (sesion_id, perfil_id);

-- Índice único que hace cumplir la regla de la sección 6:
-- una persona, un solo equipo por sesión. También cubre la consulta
-- "¿quiénes ya tienen equipo en esta sesión?" del panel docente.
create unique index if not exists integrantes_una_por_sesion
  on integrantes (sesion_id, perfil_id);

-- Extras baratos y con uso real en el panel docente:
create index if not exists idx_sesiones_docente
  on sesiones (docente_id, creada_en desc);

create index if not exists idx_perfiles_correo
  on perfiles (correo);


-- =============================================================================
-- 17. CIERRE
-- =============================================================================
-- Le avisa a PostgREST (la API REST de Supabase) que el esquema cambió, para
-- que las tablas y vistas nuevas estén disponibles de inmediato y no haya que
-- esperar a que refresque su caché.
notify pgrst, 'reload schema';

-- Siguiente paso: sql/02-rls.sql (políticas de seguridad).
-- Este archivo NO activó RLS. Hasta que corra el 02, las tablas están abiertas.
