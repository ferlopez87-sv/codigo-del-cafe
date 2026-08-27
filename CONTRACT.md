# CONTRACT.md — Contrato de interfaces

Proyecto: **Misión: El código secreto del café** — escape room de auditoría de sostenibilidad (CGC, Cadena Global de Café). Nombre interno de caso/contenido: "El Código del Café"; el título presentado a estudiantes y docentes es el de arriba.
Arquitectura: frontend construido **literalmente** sobre pantallas de **Google Stitch** (HTML/CSS/Tailwind/Google Fonts/imágenes de Stitch, adaptado a los IDs de este contrato) + backend propio en **Node/Express** + **PostgreSQL propio**, en **dos modalidades**: **local** (Docker Compose) y **online** (Render). Correo transaccional (OTP) vía **Resend** en online; en local se degrada a log de consola. **Sin Supabase.**

> Este archivo lo escribe y modifica **solo el harness**. Ningún subagente lo edita.
> Todo subagente trabaja contra este contrato, **no** contra el código de otro subagente.
> Si algo aquí te bloquea, repórtalo al harness; no improvises un nombre distinto.

## Nota de estado (2026-08-26 — pivote decidido por Fernando, lee esto primero)

Cinco decisiones tomadas hoy, todas reflejadas en este archivo:

1. **Supabase queda retirado del proyecto, en cualquier entorno.** Ya no es "arquitectura futura": es la única arquitectura. La versión anterior de este archivo (frontend vanilla + Supabase) queda obsoleta; su respaldo vive en `_src/CONTRACT.offline.md.bak` / historial de git. La arquitectura Render/Node/Postgres que antes vivía "congelada" en `_src/CONTRACT.render-target.md` es ahora la única vigente, y **ya está construida y verificada contra Postgres real** en la rama `render-migration` / worktree `../Scaperoom-render` (ver `progress.md` ahí, entrada "Migración a Render — backend completo"): `sql/00`…`06`, `srv/*`, `package.json`, `render.yaml`. **Pendiente: fusionar esa rama a `main`** — es la primera tarea de la próxima ola, antes de tocar nada del frontend.
2. **La aplicación corre en dos modalidades, mismo código:** **local** (Docker Compose: contenedor Node + contenedor Postgres, para desarrollo y para clase sin depender de que Render esté arriba) y **online** (Render, como hoy). Ver §6 y §7.
3. **El frontend deja de ser "vanilla con inspiración de Stitch".** Ahora es **literalmente** las pantallas que exporta Google Stitch — su HTML, su Tailwind, sus Google Fonts, sus imágenes — adaptadas para que calcen con los IDs/formularios de este contrato y con datos reales. La reconstrucción manual en `styles.css` con tokens propios (§9 de la versión anterior) queda **descartada**. Ver §8 — esta es la reversión explícita de la regla vieja §16.1, que prohibía exactamente esto.
4. **Tope de 15 pantallas de Stitch para toda la aplicación** (auth + juego + docente), navegación completa incluida. Ver §9 con la lista canónica.
5. **Los equipos los arma el docente, y dentro de cada equipo hay un solo apuntador o apuntadora**: la persona designada que envía las respuestas en nombre del equipo. Los otros dos integrantes inician sesión y ven todo, pero no pueden enviar. Ver §2.2, §4.1, §11, §12.

Todo lo demás de la arquitectura Render (esquema, RLS, funciones, rutas HTTP) que ya estaba diseñado y validado en `_src/CONTRACT.render-target.md`/la rama `render-migration` se conserva tal cual salvo los ajustes explícitos de arriba.

---

## 0. Restricciones globales (no negociables)

1. **Dos modalidades obligatorias, mismo código fuente:** local (Docker Compose, §6) y online (Render, §7). Ninguna lógica de negocio se bifurca por modalidad — solo cambian variables de entorno (`DATABASE_URL_APP`, si hay `RESEND_API_KEY` o no) y cómo se levanta el proceso.
2. **Backend en Node.js + Express**, sin ORM pesado: acceso a datos con `pg` directo. Sin TypeScript, sin build step para el servidor.
3. **Un solo proceso Express sirve todo**: estático (`index.html`, `juego.html`, `docente.html`, `styles.css`, `js/*.js`, assets de Stitch) y las rutas de API bajo `/api/*`. Un solo dominio, sin CORS.
4. **Frontend 100% basado en los diseños de Google Stitch, de forma literal.** Todo lo que Stitch entrega — composición, HTML, Tailwind (CDN o compilado), Google Fonts, Material Symbols, imágenes — se usa tal cual, no se reescribe a mano un sistema paralelo. Ver §8. Esto **reemplaza y anula** cualquier restricción anterior de "sin Tailwind/sin Google Fonts/sin CDN" para la capa visual.
5. **Máximo 15 pantallas de Stitch** para toda la aplicación. Ver §9. Nadie genera una pantalla 16 sin retirar antes una de las 15.
6. **Ningún secreto en el frontend.** El navegador no maneja ninguna credencial de base de datos ni de Resend. Su único crédito de acceso es la cookie de sesión httpOnly que el servidor emite. Ver §17.
7. **Toda validación que importe ocurre en el servidor.** El cliente es una interfaz, no una autoridad — incluida la restricción de que solo el apuntador o apuntadora del equipo puede enviar respuestas (§4.1).
8. **Español de El Salvador**, tono de thriller corporativo de auditoría. Lenguaje inclusivo donde el caso lo usa ("persona caficultora").
9. **Requiere conexión al backend propio. No hay modo offline del juego ni modo demo.** Si Resend falla en modalidad online, la app muestra un error claro y honesto — nunca degrada a una sesión falsa. En modalidad local, la ausencia de `RESEND_API_KEY` es el comportamiento **esperado**, no un error (§6.2).
10. **Los equipos los arma el docente. Dentro de cada equipo hay exactamente un apuntador o apuntadora.** Sin autoservicio de equipos, sin código para unirse solo, sin autoselección de quién apunta.

---

## 1. Arquitectura y componentes

```
Navegador                    Proceso Node/Express (mismo código, dos hosts posibles)      PostgreSQL
┌──────────────────┐        ┌─────────────────────────────────────────────┐           ┌──────────────────┐
│ index.html         │        │ srv/index.js — sirve estático + monta rutas  │           │ RLS activo,       │
│ juego.html         │ fetch  │ srv/rutas/auth.js    (registro, OTP, sesión) │  pg Pool  │ FORCE ROW LEVEL   │
│ docente.html       │───────▶│ srv/rutas/juego.js   (mi_equipo, verificar…) │──────────▶│ SECURITY,         │
│ styles.css         │ mismo  │ srv/rutas/docente.js (sesiones, nómina,      │ con rol   │ funciones §4      │
│ js/api.js (fetch    │ origen │   equipos, apuntador…)                       │ app_runtime│ intactas          │
│  same-origin, sin  │        │ srv/middleware/sesion.js — cookie → RLS      │ (no dueño) └──────────────────┘
│  claves)           │        │ srv/email.js — Resend online / log local     │
│ (markup y assets   │        └─────────────────────────────────────────────┘
│  = Stitch literal) │                              │
└──────────────────┘                              ▼ (solo si RESEND_API_KEY existe)
                                              api.resend.com
```

**Dos formas de correr el mismo proceso:**
- **Local (§6):** `docker compose up` levanta un contenedor Postgres + un contenedor Node con `srv/index.js`. Sin `RESEND_API_KEY`, el OTP se loguea en consola del contenedor Node — sirve para desarrollo y para dar clase sin depender de Render ni de internet para el juego en sí (sí hace falta que los celulares/laptops estén en la misma red que el servidor, o exponer el puerto).
- **Online (§7):** Render Web Service (`env: node`) + Render PostgreSQL, con `RESEND_API_KEY` real para que el OTP llegue por correo.

**Lo que se conserva de la arquitectura destino ya construida y verificada** (rama `render-migration`):
- El esquema de tablas de §2, con el agregado de `integrantes.es_apuntador` (§2.2).
- **Row Level Security completo y forzado** (`FORCE ROW LEVEL SECURITY`), con `app.usuario_actual()` en vez de `auth.uid()` de Supabase.
- Las funciones de validación de §4, con el agregado del chequeo de apuntador en `verificar_estacion`/`verificar_maestro` y la nueva `marcar_apuntador`.
- Autenticación por OTP propio + cookie de sesión httpOnly (§4.3, §17).
- El acceso de auditoría de super-admin para `fglopez@monicaherrera.edu.sv` (`sql/06-superadmin.sql`, ya construido).

**Lo que cambia respecto de lo ya construido en `render-migration`:**
- El frontend deja de ser el HTML/CSS heredado de la era Supabase (con clases `.ficha`/`.exhibit`/tokens propios) y pasa a ser las pantallas de Stitch adaptadas literalmente (§8, §9).
- Se agrega el rol de apuntador/a (§2.2, §4.1, §11, §12).
- Se agrega la modalidad local con Docker Compose (§6) — antes descartada en §17.4 de `render-target` porque el estático puro no necesitaba proceso Node; ahora sí lo necesita, así que Docker vuelve, pero para correr Node, no nginx.

---

## 2. Esquema de base de datos

Dueño: **`bk-esquema`**. Archivos `sql/00-roles.sql` (una sola vez, manual) y `sql/01-esquema.sql` (versionado, repetible, idempotente).

### 2.0 Por qué `perfiles` ya no depende de `auth.users`

Sin Supabase no hay tabla `auth.users` gestionada por GoTrue; `perfiles` es la **tabla raíz de identidad**, genera su propio `id`. Todo lo demás que referencia `perfiles(id)` queda igual, cero renombres en cascada.

```sql
create table perfiles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 2 and 80),
  carne       text not null unique check (length(trim(carne)) between 3 and 20),
  correo      text not null unique,
  rol         text not null default 'estudiante' check (rol in ('estudiante','docente')),
  creado_en   timestamptz not null default now()
);
```

### 2.1 Identidad y sesión — reemplazan lo que hacía GoTrue

```sql
-- Un código pendiente por correo. Se sobrescribe al reenviar.
create table codigos_verificacion (
  correo      text primary key,          -- normalizado a minúsculas, sin espacios
  codigo_hash text not null,             -- HMAC-SHA256(código, COOKIE_SECRET), nunca el código en claro
  intentos    int  not null default 0,   -- verificaciones fallidas; bloquea tras 5
  expira_en   timestamptz not null,      -- 5 minutos desde el envío
  creado_en   timestamptz not null default now()
);

-- Sesiones de navegador (reemplaza el JWT de Supabase Auth).
create table sesiones_login (
  token_hash  text primary key,          -- SHA-256 del token; el token crudo solo vive en la cookie
  perfil_id   uuid not null references perfiles(id) on delete cascade,
  creada_en   timestamptz not null default now(),
  expira_en   timestamptz not null,      -- 30 días
  user_agent  text
);
create index sesiones_login_perfil on sesiones_login(perfil_id);
```

**Excepción documentada, no un descuido:** `codigos_verificacion` y `sesiones_login` corren con **RLS desactivado** (`disable row level security` + `no force`), a diferencia del resto de la §3. El backend, conectado como `app_runtime` (no dueño de las tablas), necesita escribir estas dos sin que RLS se lo impida, y `SECURITY DEFINER` puro no alcanza para todos los caminos (el middleware de sesión hace `select` antes de tener identidad — problema del huevo y la gallina). Su protección real es que **solo `srv/rutas/auth.js` y `srv/middleware/sesion.js` las tocan**, que `DATABASE_URL_APP` nunca llega al cliente, y que ambas guardan **hashes**, no secretos en claro: un volcado de la base no entrega códigos ni sesiones utilizables. `qa-seguridad` verifica que ningún otro módulo de `srv/rutas/*.js` hace `select`/`insert` sobre estas dos tablas.

**Función de alta**, llamada dentro de la transacción de `/api/auth/verificar` (no hay trigger de `auth.users` del cual colgarse):

```sql
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
```

Orden idéntico al trigger que existía en la era Supabase: docente autorizado → nómina → rechazo. La nómina sigue siendo la fuente de verdad de nombre y carné, no lo que teclee el estudiante.

### 2.2 Tablas de juego — esquema sin cambios de fondo, salvo el apuntador

```sql
create table sesiones (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  docente_id        uuid not null references perfiles(id),
  duracion_minutos  int  not null default 50 check (duracion_minutos between 5 and 180),
  estado            text not null default 'borrador' check (estado in ('borrador','abierta','cerrada')),
  creada_en         timestamptz not null default now(),
  cerrada_en        timestamptz
);

create table equipos (
  id             uuid primary key default gen_random_uuid(),
  sesion_id      uuid not null references sesiones(id) on delete cascade,
  nombre         text not null,
  iniciado_en    timestamptz,          -- lo sella el servidor al primer acceso de cualquier integrante
  finalizado_en  timestamptz,
  motivo_fin     text check (motivo_fin in ('completado','tiempo','cerrado')),
  unique (sesion_id, nombre)
);

create table integrantes (
  equipo_id     uuid not null references equipos(id) on delete cascade,
  perfil_id     uuid not null references perfiles(id) on delete cascade,
  sesion_id     uuid,   -- desnormalizada, la rellena un trigger BEFORE INSERT/UPDATE desde equipos.sesion_id
  es_apuntador  boolean not null default false,   -- exactamente uno por equipo; ver nota abajo
  primary key (equipo_id, perfil_id),
  foreign key (equipo_id, sesion_id) references equipos(id, sesion_id)
);
-- equipos necesita este UNIQUE extra como blanco de la FK compuesta de arriba:
-- alter table equipos add unique (id, sesion_id);
-- Postgres no permite subconsultas dentro de una expresión de índice — por
-- eso la columna desnormalizada de arriba, no `(select sesion_id from equipos …)`
-- directo en el índice (error real encontrado y corregido 2026-08-26 al migrar).
-- Una persona no puede estar en dos equipos de la misma sesión:
create unique index integrantes_una_por_sesion
  on integrantes (perfil_id, sesion_id);
-- A lo sumo un apuntador por equipo (el índice impide dos; que exista al menos uno lo exige el flujo docente, §12):
create unique index integrantes_un_apuntador_por_equipo
  on integrantes (equipo_id) where es_apuntador;

create table estaciones (
  id           int primary key check (id between 1 and 5),
  titulo       text not null,
  pilar        text not null,
  narrativa    text not null,
  datos        jsonb not null,
  reto         text not null,
  interaccion  jsonb not null,
  pistas       jsonb not null,        -- 3 pistas escalonadas
  feedback_ok  text not null,
  codigo       text not null,         -- fragmento revelado al acertar
  respuesta    jsonb not null         -- NUNCA sale al cliente
);

create view estaciones_publicas as
  select id, titulo, pilar, narrativa, datos, reto, interaccion from estaciones;

create table intentos (
  id           bigserial primary key,
  equipo_id    uuid not null references equipos(id) on delete cascade,
  estacion_id  int  not null references estaciones(id),
  perfil_id    uuid not null references perfiles(id),   -- siempre el apuntador, verificado en la función
  respuesta    jsonb not null,
  correcto     boolean not null,
  detalle      text,
  creado_en    timestamptz not null default now()
);

create table progreso (
  equipo_id    uuid not null references equipos(id) on delete cascade,
  estacion_id  int  not null references estaciones(id),
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','progreso','resuelta','bloqueada')),
  intentos     int  not null default 0,
  resuelta_en  timestamptz,
  primary key (equipo_id, estacion_id)
);

create table calificaciones (
  equipo_id            uuid primary key references equipos(id) on delete cascade,
  uso_evidencia        int check (uso_evidencia between 1 and 4),
  distincion_dato      int check (distincion_dato between 1 and 4),
  pensamiento_critico  int check (pensamiento_critico between 1 and 4),
  trabajo_equipo       int check (trabajo_equipo between 1 and 4),
  nota_final           numeric(4,2),
  observaciones        text,
  actualizada_en       timestamptz not null default now()
);
```

**Vista de desempeño** (`v_desempeno`): por equipo — nombre, sesión, integrantes (marcando quién fue el apuntador), estaciones resueltas, intentos totales, tiempo usado, motivo de fin.

**Por qué el apuntador o apuntadora lo designa el docente, no el equipo.** Mismo principio que ya regía la asignación de equipos (§10.1 histórico, "sin autoservicio"): dejar que el equipo elija a su apuntador en vivo abre negociación y demora en medio de la clase, y sobre todo — si cualquiera pudiera apuntarse a sí mismo como apuntador, un estudiante distinto al que el docente quiso designar podría enviar respuestas sin que nadie lo autorizara. El docente ya tiene, al armar equipos, el contexto para decidir (o simplemente asignar por orden de lista). El índice único `integrantes_un_apuntador_por_equipo` impide que haya dos al mismo tiempo; que **exista** uno antes de arrancar lo exige la UI docente (§12) y, del lado servidor, `verificar_estacion` rechaza con `{"error":"sin_apuntador"}` si el equipo no tiene ninguno marcado — nunca deja pasar una respuesta "de nadie en particular".

**Trigger de progreso:** sin cambios — al resolverse las estaciones 1–4, la 5 pasa de `bloqueada` a `pendiente`. El cliente no decide esto.

### 2.3 Tablas de gobierno

```sql
create table docentes_autorizados (
  correo text primary key, nota text, creado_en timestamptz default now()
);
create table configuracion ( clave text primary key, valor text );
```

RLS activo, cero políticas — las lee `crear_o_recuperar_perfil()`, que es `security definer`. `configuracion` guarda `dominio_institucional_aviso = '@monicaherrera.edu.sv'`: solo un texto de advertencia al cargar la nómina, no un control de acceso (se rechazó explícitamente un interruptor `modo_registro='abierto'` por las mismas razones que en la era Supabase — un control que depende de que alguien recuerde apagarlo no es un control).

### 2.4 Nómina — la lista blanca de registro

```sql
create table nomina (
  id         uuid primary key default gen_random_uuid(),
  sesion_id  uuid not null references sesiones(id) on delete cascade,
  nombre     text not null,
  correo     text not null,
  carne      text not null,
  perfil_id  uuid references perfiles(id),
  creada_en  timestamptz not null default now(),
  unique (sesion_id, correo), unique (sesion_id, carne)
);
```

Lista blanca de registro y fuente de datos para armar equipos. `nomina` va **sin guardar** en migraciones a propósito: si algún día no existe, mejor que la migración se caiga ruidosamente a que deje el directorio del curso con RLS apagado en silencio.

---

## 3. Row Level Security

Dueño: **`bk-rls`**. Archivo `sql/02-rls.sql`. `alter table … enable row level security` **y** `force row level security` en todas las tablas de negocio. Deny by default. Todas las políticas van `to public` — no hay roles Postgres `anon`/`authenticated` como en Supabase; quién sos lo dice `app.usuario_actual()`, no el rol de conexión.

```sql
create schema if not exists app;
create or replace function app.usuario_actual() returns uuid
language sql stable as $$
  select nullif(current_setting('app.usuario_actual', true), '')::uuid
$$;
```

Reemplazo exacto de `auth.uid()`: sin nadie autenticado, `null`, y las políticas deniegan igual que antes. **El backend la setea por transacción** (§4.3), nunca por conexión completa.

### 3.1 El punto que rompe todo si se omite: `FORCE ROW LEVEL SECURITY`

En Postgres, RLS no aplica al dueño de la tabla salvo que se lo obligue explícitamente. `sql/00-roles.sql` crea un rol `app_runtime` que **no es dueño** de ninguna tabla:

```sql
create role app_runtime login password '<generado, va solo en la variable de entorno>';
grant usage on schema public, app to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant execute on all functions in schema public, app to app_runtime;
```

`DATABASE_URL` (dueña de las tablas) se usa **solo** para correr las migraciones `00`→`06`. El proceso Express en cualquiera de las dos modalidades usa `DATABASE_URL_APP`, con `app_runtime`. Confundir las dos anula `FORCE ROW LEVEL SECURITY` sin ningún error visible. `qa-seguridad` verifica `select current_user` explícitamente.

### 3.2 Tabla de políticas

| Tabla | Estudiante | Docente | Super-admin (`fglopez@…`) |
|---|---|---|---|
| `perfiles` | select **solo el propio**. Sin update | select de los perfiles de sus sesiones | select de todos |
| `nomina` | select **solo su propia fila** | CRUD de las de sus sesiones | — (accede vía sesión que sí ve) |
| `docentes_autorizados` / `configuracion` | ninguna — acceso denegado | ninguna | ninguna (no hace falta) |
| `codigos_verificacion` / `sesiones_login` | **RLS desactivado** (§2.1) — solo `srv/rutas/auth.js` las toca | — | — |
| `sesiones` | select de aquellas donde tiene equipo | CRUD de las propias | select/CRUD de todas |
| `equipos` | select del propio | CRUD de los de sus sesiones | CRUD de todos |
| `integrantes` (incl. `es_apuntador`) | select de los del propio equipo | CRUD de los de sus sesiones (incluye marcar apuntador, §4.2) | CRUD de todos |
| `estaciones` | **ninguna política — acceso denegado** | ninguna | — |
| `estaciones_publicas` | select | select | select |
| `intentos` | select de los del propio equipo. **Sin insert/update/delete** | select de los de sus sesiones | select de todos |
| `progreso` | select del propio equipo. **Sin insert/update/delete** | select de los de sus sesiones | select de todos |
| `calificaciones` | select del propio equipo | CRUD de las de sus sesiones | select de todas |

`intentos` y `progreso` se escriben **exclusivamente** desde `verificar_estacion()`, y solo cuando quien llama es el apuntador o apuntadora del equipo (§4.1) — un estudiante que no sea apuntador no puede insertar su propio "resuelta" ni aunque lo intente por fuera de la UI.

**GRANT sobre las vistas:**
```sql
alter view estaciones_publicas set (security_invoker = off); -- a propósito: con RLS heredado devolvería 0 filas
grant select on estaciones_publicas to public;
alter view v_desempeno set (security_invoker = on);          -- a propósito: respeta el RLS de quien consulta
grant select on v_desempeno to public;
```

### 3.3 Super-admin — auditoría completa para `fglopez@monicaherrera.edu.sv`

`sql/06-superadmin.sql` (construido y verificado 2026-08-26, ver `es_super_admin()` — `security definer`, compara `perfiles.correo` de `app.usuario_actual()`). Agrega políticas adicionales (`OR` con las de docente/estudiante) en `perfiles/sesiones/equipos/integrantes/nomina/intentos/progreso/calificaciones` para que ese correo vea y gestione todo sin depender de ser `docente_id` de cada sesión. No hay bypass en Express — el privilegio vive enteramente en RLS. Verificado con un segundo docente sintético (vía SQL directo y vía HTTP real): el docente ordinario ve solo su propia sesión; `fglopez` ve la suya **y** la ajena.

### 3.4 El bug que anulaba TODO esto — `app_runtime` no puede ser superusuario ni dueño, ni en local

Encontrado el 2026-08-26 al probar el punto anterior por primera vez con dos docentes reales: `docker-compose.yml` ponía `POSTGRES_USER=app_runtime` en el contenedor de Postgres — eso lo vuelve el rol de **inicialización del clúster**, que Postgres siempre crea como **superusuario y dueño de todo lo que se cree**. Un superusuario **nunca** está sujeto a RLS, con o sin `FORCE ROW LEVEL SECURITY` — es una propiedad del rol, no algo que FORCE pueda revertir. Con esa configuración, **cualquier docente podía ver las sesiones de cualquier otro** en la modalidad local — no por un bug de política, sino porque RLS nunca se aplicaba a nadie que se conectara con ese usuario, es decir, al proceso Express entero.

Corregido: el contenedor de Postgres ahora arranca con un usuario administrador **distinto** (`postgres_admin` por defecto, ver `docker-compose.yml`), y `sql/00-roles.sql` crea `app_runtime` como rol de login **sin superusuario y sin ser dueño de nada** — recién ahí `FORCE ROW LEVEL SECURITY` significa algo. `DATABASE_URL` (admin, solo para correr `00`→`06` a mano) y `DATABASE_URL_APP` (`app_runtime`, la única que usa el proceso Express en tiempo de ejecución) quedan explícitamente separadas — confundirlas revive el mismo bug en silencio. Esto aplica igual de fuerte en Render (§7): la base que da Render también entrega credenciales de administrador que **nunca** deben llegar a `DATABASE_URL_APP`.

**Efecto colateral real que este bug enmascaraba:** con `app_runtime` superusuario, `srv/rutas/auth.js` en `/api/auth/verificar` hacía un `SELECT … FROM perfiles WHERE correo=$1` **fuera** de `conSesion()` (sin `app.usuario_actual()` seteado) y "funcionaba" porque RLS estaba anulado. Al corregir el rol, esa consulta empezó a devolver 0 filas siempre (política `perfiles_lectura_propia` exige `id = app.usuario_actual()`, que es `null` ahí) — el login se rompía con `{"error":"no_se_pudo_crear_perfil"}` pese a que el perfil sí se había creado. Corregido usando `(crear_o_recuperar_perfil($1)).*` (expande el composite que la función ya devuelve) en vez del segundo `SELECT` plano. **Regla para cualquier ruta nueva de `srv/`:** todo lo que lea una tabla con RLS debe pasar por `conSesion()`, o por una función `SECURITY DEFINER` como `obtener_perfil_por_token()` — nunca un `pool.query()` directo a una tabla protegida sin identidad seteada.

---

## 4. Funciones de validación

Dueño: **`bk-funciones`**. Archivo `sql/03-funciones.sql` (+ `sql/06-superadmin.sql` para lo del punto anterior). Todas `SECURITY DEFINER` con `search_path = public` fijado, salvo donde se indique lo contrario.

### 4.1 `verificar_estacion(p_equipo uuid, p_estacion int, p_respuesta jsonb) returns jsonb`

El corazón del sistema. En orden estricto:

1. `app.usuario_actual()` debe estar en `integrantes` de `p_equipo` → si no, `{"error":"no_autorizado"}`.
2. **Debe ser el apuntador o apuntadora de ese equipo** (`es_apuntador = true` en su fila de `integrantes`) → si no, `{"error":"no_apuntador", "apuntador": "<nombre de quien sí puede>"}`. Esta comprobación es nueva respecto de la era anterior y es la que hace cumplir §0.10 en el servidor, no solo en la UI.
3. Si el equipo no tiene **ningún** apuntador marcado todavía → `{"error":"sin_apuntador"}` (el docente no completó la asignación; ver §12).
4. La sesión debe estar `abierta` y no vencida → si no, `{"error":"sesion_cerrada"}` / `{"error":"tiempo_agotado"}`.
5. Sella `equipos.iniciado_en = now()` si aún es `null` — **cualquier** integrante puede sellar el inicio con su primer acceso al tablero, no hace falta que sea el apuntador; el reloj del equipo corre para los tres.
6. Si `p_estacion = 5`, exige 1–4 resueltas → si no, `{"error":"bloqueada"}`.
7. Si ya está resuelta, devuelve el resultado sin registrar intento nuevo.
8. Compara contra `estaciones.respuesta` según §14.
9. Inserta en `intentos` (con `perfil_id` = el apuntador que llamó) y actualiza `progreso`, con `now()` del servidor.
10. Devuelve `{ok, parcial, intentos, detalle, codigo?, pista?}` según §14.

### 4.2 Resto de funciones

| Función | Cambios respecto de la era anterior |
|---|---|
| `mi_equipo()` | Ahora también devuelve, por integrante, `es_apuntador`, y un campo `soy_apuntador: boolean` resuelto para `app.usuario_actual()` — el cliente lo usa para decidir si muestra los controles de envío o el aviso de solo-lectura (§11). |
| `estado_juego(p_equipo uuid)` | Sin cambios de fondo: progreso de las 5 estaciones + segundos restantes calculados en servidor. |
| `verificar_maestro(p_equipo uuid, p_codigo text)` | Mismo chequeo de apuntador que `verificar_estacion` (pasos 1–3 de §4.1) antes de validar el código `06-87-04-2P-4`. Al acertar, sella `finalizado_en` y `motivo_fin='completado'`. |
| `marcar_apuntador(p_equipo uuid, p_perfil uuid) returns void` | **Nueva.** Sin `SECURITY DEFINER`: corre con los privilegios de quien llama (el docente, vía RLS de `integrantes`), así que un estudiante no puede invocarla para auto-designarse — RLS ya le niega el `update` de `integrantes` fuera de lo que le permite su política de solo-lectura. Dentro de una transacción: pone `es_apuntador=false` para todo el equipo y luego `true` solo para `p_perfil`, atómico (evita el estado transitorio de "dos apuntadores" o "ninguno"). |
| `cerrar_sesion_clase(p_sesion uuid)` | Sin cambios: solo docente, cierra sesión y finaliza equipos abiertos. |
| `anonimizar_sesion(p_sesion uuid)` | Sin cambios: solo docente, sustituye nombres y carnés conservando desempeño. |
| `obtener_perfil_por_token(p_hash text)` | Ya construida (`06-superadmin.sql`) — helper `security definer` para que el middleware de sesión lea `perfiles` sin el problema del huevo y la gallina de RLS. |

### 4.3 Cómo las invoca el backend

```js
// srv/db.js — patrón obligatorio para CUALQUIER ruta autenticada
async function conSesion(perfilId, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // is_local = true: la variable dura SOLO esta transacción.
    await cliente.query("SELECT set_config('app.usuario_actual', $1, true)", [perfilId]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}
```

`is_local = true` no es negociable: sin esto, la conexión del pool queda pegada a un usuario para quien la reutilice después — fuga de identidad entre estudiantes distintos. `qa-seguridad` tiene un caso de prueba dedicado a esto (§17.6).

### 4.4 Orden de ejecución — no alterar

1. `sql/00-roles.sql` — una sola vez, a mano, con la conexión de administrador.
2. `sql/01-esquema.sql` · 3. `sql/02-rls.sql` · 4. `sql/03-funciones.sql` · 5. `sql/04-docentes.sql` · 6. `sql/05-seed.sql` · 7. `sql/06-superadmin.sql` — todos con la conexión de administrador.
8. A partir de acá, el proceso Express se conecta con `app_runtime` (`DATABASE_URL_APP`), nunca con la de administrador.
9. El docente se registra en la app y cae con rol docente; crea la sesión, carga la nómina, arma equipos **y designa un apuntador por equipo** antes de que la clase empiece a jugar.

---

## 5. Backend HTTP y capa de API del cliente

### 5.1 Rutas Express — dueño `bk-rutas`, archivos `srv/rutas/*.js`

```
POST /api/auth/registrar        { correo }                      → genera y envía OTP
POST /api/auth/reenviar         { correo }                      → limitado: 1 cada 45s por correo
POST /api/auth/verificar        { correo, codigo }               → valida OTP, crea/recupera perfil, cookie httpOnly
POST /api/auth/salir             —                                → invalida la fila en sesiones_login
GET  /api/auth/sesion            —                                → perfil de la cookie vigente, o 401

GET  /api/juego/mi-equipo        —                                → mi_equipo() (incluye es_apuntador/soy_apuntador)
GET  /api/juego/estaciones       —                                → select sobre estaciones_publicas
GET  /api/juego/estado/:equipo   —                                → estado_juego()
POST /api/juego/verificar        { equipo, estacion, respuesta }  → verificar_estacion()
POST /api/juego/verificar-maestro { equipo, codigo }              → verificar_maestro()

GET/POST /api/docente/sesiones, /api/docente/sesiones/:id/abrir|cerrar
GET/POST /api/docente/nomina          (carga bulk + individual)
GET      /api/docente/registrados/:sesion
GET/POST /api/docente/equipos, /api/docente/equipos/:id/asignar|desasignar
POST     /api/docente/equipos/:id/apuntador   { perfilId }        → marcar_apuntador()  [NUEVA]
GET      /api/docente/desempeno/:sesion       → select sobre v_desempeno
POST     /api/docente/calificaciones/:equipo
POST     /api/docente/anonimizar/:sesion
```

Todas (salvo `registrar`/`reenviar`/`verificar`) exigen cookie de sesión vigente (`srv/middleware/sesion.js`) y corren dentro de `conSesion()` (§4.3). **RLS autoriza, el middleware solo identifica.**

### 5.2 `js/api.js` — dueño `fe-wiring`

Mismo contrato de salida (`{datos, error}`, nunca lanza), same-origin, sin URL ni clave que configurar:

```js
export const Auth = { registrar({correo}), reenviar(correo), verificarCodigo(correo, codigo), sesion(), salir() };
export const Juego = { miEquipo(), estaciones(), estado(equipoId), verificar(equipoId, estacionId, respuesta), verificarMaestro(equipoId, codigo) };
export const Docente = {
  sesiones(), crearSesion(d), abrirSesion(id), cerrarSesion(id),
  registrados(sesionId), crearEquipo(sesionId, nombre),
  asignar(equipoId, perfilId), desasignar(equipoId, perfilId),
  marcarApuntador(equipoId, perfilId),                 // NUEVA
  desempeno(sesionId), guardarCalificacion(equipoId, rubrica), anonimizar(sesionId)
};
```

`js/juego.js`, `js/render.js`, `js/timer.js`, `js/docente.js`, `js/dataviz.js` consumen `Auth`/`Juego`/`Docente` por nombre de método, no la URL detrás — ya están construidos así en la rama `render-migration` y no deberían necesitar cambios de fondo salvo lo que exige el apuntador (§11) y el remarcado visual sobre el HTML literal de Stitch (§8).

---

## 6. Modalidad LOCAL — Docker Compose

Dueño: **`ops-local`**. Archivos `docker-compose.yml`, `Dockerfile` (imagen del proceso Node, ya no de nginx), `.env`.

### 6.1 Qué levanta

Dos servicios:
- **`db`**: `postgres:16-alpine`, volumen nombrado para persistir datos entre reinicios, puerto `5432` expuesto solo a la red interna de compose (no al host, salvo que se necesite depurar con `psql` desde afuera).
- **`app`**: build del `Dockerfile` (Node 20+, `npm install`, `node srv/index.js`), puerto `3000` (o `PORT` de `.env`) publicado al host. Depende de `db` (`depends_on` con healthcheck), lee `DATABASE_URL_APP` apuntando a `db:5432` con las credenciales de `app_runtime`.

Las migraciones (`sql/00`→`06`) se corren **una vez**, a mano, contra el contenedor `db` (`docker compose exec db psql …` o un script `npm run migrar` que las aplique en orden con la conexión de administrador) — igual de manual que en Render, por la misma razón: son privilegios de administrador que no debe tener el proceso de la app.

### 6.2 Correo en local — degradación esperada, no un error

`RESEND_API_KEY` normalmente **no** se define en `.env` local. `srv/email.js` ya está construido para este caso: si la variable falta, loguea el código OTP en la consola del contenedor `app` en vez de enviarlo, y responde `{ok:true}` igual — es el comportamiento correcto para desarrollo y para una clase que corre completamente en la red local del aula. Si alguna vez se quiere probar el envío real en local, `RESEND_API_KEY` se puede pegar en `.env` sin tocar código.

### 6.3 Por qué Docker vuelve, y por qué es distinto de la vez anterior

La versión Supabase de este proyecto usó Docker/nginx para servir archivos estáticos — eso se eliminó en la migración a Render porque un backend Node necesita un proceso corriendo, no un servidor de archivos. **Docker no vuelve por lo mismo**: vuelve porque ahora se pide explícitamente una modalidad local, y Docker Compose es la forma estándar de levantar "Node + Postgres" con un solo comando sin instalar Postgres en la máquina de cada quien.

---

## 7. Modalidad ONLINE — Render

Dueño: **`ops-render`**. Archivos `render.yaml`, `package.json`, `.env.ejemplo`.

### 7.1 `render.yaml` — un blueprint, dos recursos

```yaml
databases:
  - name: codigo-del-cafe-db
    plan: free            # ver 7.3 sobre el límite de 30 días
    postgresMajorVersion: 16

services:
  - type: web
    name: codigo-del-cafe
    env: node
    plan: free
    buildCommand: npm install
    startCommand: node srv/index.js
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: DATABASE_URL_APP
        sync: false        # se pega a mano: la del rol app_runtime
      - key: RESEND_API_KEY
        sync: false
      - key: RESEND_FROM
        sync: false
      - key: COOKIE_SECRET
        generateValue: true
      - key: DOMINIO_INSTITUCIONAL
        value: "@monicaherrera.edu.sv"
      - key: NODE_ENV
        value: production
```

Ya construido y probado contra Postgres real en la rama `render-migration` — al fusionar, este archivo reemplaza cualquier `render.yaml` de la era Docker/nginx que quede en `main`.

### 7.2 Primera puesta en marcha (manual, una sola vez)

1. Conectar el repo de GitHub al Blueprint de Render.
2. Render crea `codigo-del-cafe-db` y da una cadena de conexión de **administrador**. Con ella, correr `sql/00`→`06` en orden.
3. Armar `DATABASE_URL_APP` con la contraseña de `app_runtime` del paso 2 y pegarla en Environment del servicio web.
4. Cuenta en Resend, dominio verificado (o el de pruebas mientras tanto), `RESEND_API_KEY`/`RESEND_FROM` en Environment.
5. `COOKIE_SECRET` se genera solo.
6. Deploy. El docente se registra con su correo (ya en `docentes_autorizados`), crea la sesión, carga la nómina, arma equipos y designa apuntador por equipo.

### 7.3 Advertencia de costo — no es letra chica

El plan gratuito de Postgres en Render se elimina a los 30 días, con o sin uso. Para un semestre completo, hace falta el plan pago más económico antes de que se cumplan esos 30 días, o automatizar el respaldo/recreación mensual. Documentado también en `README.md`.

### 7.4 Qué queda eliminado de eras anteriores

El `Dockerfile`/`docker-compose.yml`/`.dockerignore` de la era "nginx sirviendo estático" ya no aplican **para Render** (Render usa `env: node` nativo) — pero un `Dockerfile`/`docker-compose.yml` **sí existen de nuevo**, con otro propósito: la modalidad local de §6. `js/config.js`/`config.ejemplo.js` de la era Supabase se eliminan por completo: no hay nada que configurar en el cliente en ninguna de las dos modalidades.

---

## 8. Diseño obligatorio — Google Stitch, de forma literal

Dueño: **`fe-stitch`**. Esta sección **reemplaza por completo** la regla histórica §16.1 de versiones anteriores de este contrato, que prohibía Tailwind, Google Fonts, Material Symbols y cualquier CDN, y exigía traducir cada pantalla de Stitch a mano en `styles.css` con tokens propios. **Esa regla queda revertida.** Fernando la corrigió el 2026-08-26 porque el resultado de "traducir a mano" nunca terminaba de verse como Stitch — y porque no tiene sentido pagar el costo de reconstruir a mano un sistema de diseño que Stitch ya entrega completo y coherente.

### 8.1 Qué significa "literal"

- El **HTML/CSS que exporta cada pantalla de Stitch** (`.stitch/designs-v2/NN-nombre.html`) es la base real de la página correspondiente, no una referencia visual. Se parte de ese archivo, no de una reconstrucción.
- **Tailwind se usa tal cual lo trae Stitch** — vía el `<script src="https://cdn.tailwindcss.com...">` y el bloque `tailwind.config` con la paleta/tipografía del proyecto ("Forensic Audit Protocol": grafito `#131313`, esmeralda `#88d982`, documento `#f5f5dc`, ver `.stitch/designs-v2/11-design-system.json`), o compilado a un archivo CSS propio si el rendimiento en producción lo exige — decisión de `fe-stitch`, documentada si se toma, pero **nunca** reescrito a clases custom.
- **Google Fonts se usa tal cual**: `Hanken Grotesk` (cuerpo/títulos) y `JetBrains Mono` (etiquetas/datos), vía el `<link>` de Google Fonts que Stitch ya incluye. Material Symbols igual, si una pantalla lo usa. Esto es la excepción explícita a cualquier regla general de "sin fuentes externas" que aparezca en otros documentos del repo (skills, plantillas) — **aquí manda este contrato**.
- **Las imágenes que Stitch genera** (`.stitch/designs-v2/NN-nombre.png` y las URLs de `screenshot.downloadUrl` en cada `.meta.json`) se descargan y sirven como asset propio del proyecto (`assets/` o similar, dueño `fe-stitch`) cuando la pantalla las usa como fondo/textura/ilustración — no se sustituyen por CSS generado a mano ni se linkean en caliente contra `googleusercontent.com`.

### 8.2 Qué sí se adapta (y qué no)

**Se descarta:** el copy/texto de ejemplo de Stitch (narrativas ajenas al caso CGC), y cualquier flujo que el contrato ya rechazó explícitamente — login usuario/contraseña, nombre tecleado por el estudiante, autoservicio de equipos con código para compartir (§0.10), autoselección de apuntador.

**Se conserva literal:** la composición, el markup, las clases Tailwind, las fuentes, las imágenes, la paleta, el shape "sharp" (esquinas rectas), los sellos rotados, las tarjetas de evidencia — todo lo visual.

**Se inserta sin tocar el sistema visual:** los IDs y `name`/`for` de formulario que exige este contrato (§10–§12), para que `js/api.js`/`juego.js`/`docente.js`/`render.js`/`timer.js` puedan engancharse — se agregan como atributos sobre el markup de Stitch, no se reemplaza el markup por uno propio. Donde Stitch no cubre un estado que el contrato necesita (p. ej. el aviso de "no sos el apuntador de tu equipo", §11), `fe-stitch` diseña ese estado **con los mismos tokens Tailwind/tipografía/paleta** del resto de la pantalla — coherencia visual, no una pantalla nueva de Stitch (eso consumiría presupuesto de §9 sin necesidad).

### 8.3 Regla práctica de aceptación

Si al terminar, la pantalla renderizada es indistinguible de la captura (`.png`/`screenshot`) de Stitch salvo por el contenido real del caso y los pequeños estados nuevos descritos arriba, está bien. Si alguien reconstruyó la composición "a su manera" aunque se parezca, no alcanza — hay que volver al HTML exportado y partir de ahí.

---

## 9. Presupuesto de pantallas — máximo 15 para toda la aplicación

Dueño: **`fe-stitch`**, hace cumplir el harness. Cuenta como "pantalla" una **vista navegable** de la aplicación — un lugar donde la persona usuaria puede estar y percibir que cambió de página/paso. **No cuentan contra el tope:** estados vacíos, banners de error/conexión, modales de confirmación, ni las variantes de layout que una misma pantalla usa para pintar contenido distinto (p. ej. las 4 formas de interacción de una estación dentro del mismo panel — eso es una sola pantalla con contenido dinámico, no cuatro).

### 9.1 Lista canónica (15 de 15 — no hay margen para agregar sin retirar una)

**Acceso público — `index.html` (4)**
1. Portada — `15-portal-de-acceso`
2. Registro — `05-registro-acceso`
3. Verificar código — `07-verificar-codigo`
4. Acceso (ya registrado) — `06-acceso-existente`

**Estudiante — `juego.html` (4)**
5. Sala de espera / bienvenida (equipo, integrantes, quién es el apuntador, botón iniciar). El estado "aún sin equipo asignado" es una variante de esta misma pantalla, no una nueva.
6. Tablero (sidebar de 5 salas + panel de estación) — `13-dashboard-estudiante`. Las 4 estaciones con pantalla de referencia propia en Stitch v2 (`01-sala-verde-ambiental`, `03-sala4-personas-afectadas`, `09-cadena-del-dinero`, `12-sala5-verdad`) **no son pantallas independientes de la app** — son referencia de layout para cómo se ve cada tipo de interacción (`orden`/`numero`/`checklist`/`clasificacion`, §14) **dentro** del panel de esta única pantalla 6. Ver §9.2.
7. Veredicto (código maestro) — `08-veredicto-auditoria-final`
8. Resumen final (desempeño, fragmentos de código)

**Docente — `docente.html` (7)**
9. Gestión de sesiones — `04-gestion-sesiones-docente`
10. Nómina — `02-nomina-docente`
11. Gestión de equipos (crear equipo, asignar/desasignar integrantes, **marcar apuntador**) — `10-gestion-equipos-docente`
12. Monitoreo (progreso en vivo de todos los equipos) — sin pantalla propia generada todavía; se construye con los mismos tokens que 9–11 y 13–15 (§8.2), no consume una generación nueva de Stitch salvo que haga falta — si se genera, es la única "reserva" del presupuesto y no puede sumarse una pantalla 16.
13. Rúbrica / calificación — `14-rubrica-evaluacion-docente`
14. Cierre y seguridad (cerrar sesión de clase, anonimizar) — `16-cierre-seguridad-docente`
15. Consola de control / super-admin (`fglopez@…`) — `17-consola-control-docente`

### 9.2 Qué hacer con las 4 pantallas de estación individuales de `designs-v2`

`01-sala-verde-ambiental`, `03-sala4-personas-afectadas`, `09-cadena-del-dinero`, `12-sala5-verdad` se **retiran de la cuenta de pantallas navegables** pero **no se descartan como diseño**: son la fuente literal (§8) de cómo debe verse cada tipo de interacción cuando se pinta dentro de `#panel-estacion` en la pantalla 6. No existe una pantalla de Stitch dedicada a la Estación 1 (Sala de Hechos, interacción `orden`) — `fe-stitch` la deriva del mismo lenguaje visual que las otras cuatro (misma paleta, misma tipografía, mismo patrón de "expediente"), sin generar una pantalla nueva.

### 9.3 Si hace falta una pantalla que no está en la lista

Se retira una de las 15 antes de agregar otra, y se actualiza esta sección. Nadie decide esto por su cuenta — es cambio de contrato, lo hace el harness.

---

## 10. IDs — `index.html`. Dueño: `fe-stitch` (markup) + `fe-wiring` (JS)

| ID | Elemento |
|---|---|
| `#vista-portada` / `#vista-registro` / `#vista-codigo` / `#vista-acceso` | pantallas 1–4 de §9, se alternan con `.is-oculta` |
| `#form-registro` | `<form>` |
| `#reg-correo` | `email`, requerido. **Único campo de identidad** |
| `#reg-privacidad` | `checkbox` requerido |
| `#aviso-privacidad` | `<details open>` con el texto completo |
| `#btn-registrar` | `<button type="submit">` |
| `#form-codigo` | `<form>` de verificación |
| `#cod-token` | `text`, `inputmode=numeric`, `autocomplete="one-time-code"`, 6 dígitos |
| `#btn-verificar-codigo` · `#btn-reenviar-codigo` | botones |
| `#cuenta-reenvio` | "Podés reenviar en 45s" |
| `#form-acceso` · `#acc-correo` · `#btn-acceder` | inicio de sesión de quien ya está registrado |
| `#mensaje-auth` | `role="alert"` errores y confirmaciones |

Sin cambios de fondo respecto de la era anterior — el nombre y carné siguen viniendo de la nómina (§2.4), el correo fuera de nómina sigue fallando recién al verificar el código (nunca antes, para no convertir el formulario en oráculo de quién está inscrito).

---

## 11. IDs — `juego.html`. Dueño: `fe-stitch` (markup) + `fe-wiring` (JS)

Estructura de tablero persistente (sidebar + panel), heredada tal cual de la última reconstrucción verificada:

- `#pantalla-bienvenida` — pantalla 5 de §9: nombre del equipo, `#lista-integrantes` (cada fila con nombre y, si aplica, un indicador visual de quién es el apuntador — `.integrante--apuntador` o equivalente del sistema Stitch), `#btn-iniciar`.
- `#sin-equipo` — variante de la pantalla 5, para quien aún no fue asignado.
- `#aviso-conexion` — banner, no pantalla, visible al perder la red.
- `#pantalla-dashboard` — pantalla 6: `#sidebar-salas` (equipo activo, `#cronometro`/`#cronometro-anuncio`, `#barra-progreso`/`#barra-progreso-relleno`/`#contador-progreso`, `#nav-salas` con `button.nav-sala[data-estacion="1".."5"]`) + `#panel-estacion` (`#panel-estacion-vacio`, `#estacion-titulo`, `#estacion-pilar`, `#estacion-narrativa`, `#estacion-datos`, `#estacion-reto`/`#estacion-reto-texto`, `#estacion-interaccion`, `#estacion-feedback`, `#estacion-intentos`, `#btn-verificar-estacion`).
- **Nuevo — control de apuntador dentro de `#panel-estacion`:** `#aviso-solo-apuntador` (`role="status"`), visible únicamente cuando `mi_equipo().soy_apuntador === false`: muestra el texto "Solo <nombre del apuntador> puede enviar la respuesta de tu equipo. Podés seguir el expediente y discutirlo con tu equipo." En ese mismo caso, `#btn-verificar-estacion` (y los controles de captura de respuesta que arma `render.js`) quedan `disabled` — visibles, para que el resto del equipo siga la evidencia, pero no interactivos. Esto es una capa de UI: la autoridad real es el `{"error":"no_apuntador"}` del servidor (§4.1); la UI evita que alguien intente en vano, no reemplaza la validación.
- `#pantalla-veredicto` — pantalla 7: `#input-codigo-maestro`, `#btn-verificar-maestro` (mismo disabled/aviso para quien no es apuntador), `#feedback-maestro`, `#texto-veredicto`.
- `#pantalla-resumen` — pantalla 8: `#resumen-datos`, `#fragmentos-codigo`.

No hay `#panel-profesor`: el modo docente es una página aparte con rol autenticado.

---

## 12. IDs — `docente.html`. Dueño: `fe-stitch` (markup) + `fe-wiring` (JS)

| ID | Elemento |
|---|---|
| `#lista-sesiones` · `#btn-nueva-sesion` · `#form-sesion` | pantalla 9 |
| `#sesion-estado` | `borrador` / `abierta` / `cerrada` |
| `#btn-abrir-sesion` · `#btn-cerrar-sesion` | control del reloj de clase |
| `#form-nomina` · `#nomina-pegar` · `#btn-cargar-nomina` | pantalla 10, carga CSV `nombre,correo,carne` |
| `#tabla-nomina` | lista cargada, con aviso en correos fuera del dominio institucional |
| `#btn-agregar-a-nomina` | alta individual |
| `#lista-registrados` | estudiantes de la nómina ya registrados y sin equipo. Sale de `nomina` menos `integrantes`, no de `perfiles` |
| `#lista-equipos` · `#btn-nuevo-equipo` | pantalla 11 |
| `#btn-asignar` · `#btn-desasignar` | asignación de integrantes |
| **`#control-apuntador`** | **Nuevo.** Dentro de cada equipo en `#lista-equipos`: un control (radio o equivalente Tailwind del mismo sistema) por integrante ya asignado, `name="apuntador-{equipoId}"`, que llama a `Docente.marcarApuntador(equipoId, perfilId)` al cambiar. Exactamente uno seleccionable a la vez por equipo — el índice único del servidor (§2.2) es la autoridad; este control solo refleja y envía el cambio. |
| `#aviso-sin-apuntador` | Visible en la fila de un equipo que tiene integrantes pero **ningún** apuntador marcado — bloquea (visualmente, con texto) la idea de que ese equipo puede empezar a jugar así. |
| `#tabla-monitoreo` | pantalla 12, progreso en vivo por equipo, incluye columna de quién es el apuntador |
| `#btn-exportar-csv` | descarga del desempeño |
| `#form-rubrica` | pantalla 13: los 4 criterios del caso + nota final + observaciones |
| `#btn-anonimizar` | pantalla 14: borrado de datos personales al cerrar el curso |
| `#consola-super-admin` | pantalla 15, visible solo si `perfil.correo === 'fglopez@monicaherrera.edu.sv'`: listado de todas las sesiones/equipos del sistema, no solo los propios |

**La asignación (incluida la de apuntador) debe poder hacerse durante la clase.** Un estudiante que llega sin equipo, o un equipo sin apuntador todavía marcado el primer minuto, es el caso normal, no la excepción.

---

## 13. Contenido de las estaciones

Dueños: `ct-e1` … `ct-e5`. Sin cambios de fondo respecto de eras anteriores: vive en `sql/05-seed.sql` (narrativa, datos, reto, interacción, 3 pistas escalonadas, feedback, código, respuesta) y se expone vía `estaciones_publicas` / `/api/juego/estaciones`. `js/contenido.js` solo lleva lo que no revela nada (`ESTACIONES_UI`, orden aleatorio, etiquetas).

**Reglas de contenido — sin cambios:**
- Las pistas 1 y 2 reorientan; **no revelan**. La 3 puede acercarse mucho.
- `feedback_ok` **siempre** cita el dato del caso que sustenta la respuesta.
- Todo número sale literalmente del caso. Nada inventado.
- CGC no es villana: es una empresa cuyo discurso no está respaldado. Sin moralina.

---

## 14. Tipos de interacción y forma de las respuestas

Dueño render: `js/render.js` (`fe-wiring`). Sin cambios de fondo en la forma de los datos; el **layout visual** de cada tipo lo define ahora la pantalla Stitch correspondiente (§9.2), no CSS propio.

```js
// "orden" (E1) — reordenar con botones ↑/↓, nunca arrastrar y soltar
{ tipo:"orden", items:[{id,texto}], pregunta, opciones:[{id,texto}] }
// "numero" (E2, E3)
{ tipo:"numero", campos:[{id,etiqueta,sufijo,min,max,paso}], pregunta, opciones:[{id,texto}] }
// "checklist" (E4)
{ tipo:"checklist", items:[{id,texto}] }
// "clasificacion" (E5)
{ tipo:"clasificacion", categorias:[{id,texto}], items:[{id,texto}] }
```

| Est. | `respuesta` enviada | Correcto | Claves de `detalle` |
|---|---|---|---|
| 1 | `{orden:[ids], eslabon:"cultivo"}` | `["cultivo","cosecha","procesamiento","exportacion","tostado","venta"]` y `cultivo` | `orden-mal`, `eslabon-mal`, `ambos-mal`, `vacio` |
| 2 | `{porcentaje:n, enganosa:"si"\|"no"}` | 87 (acepta 87.5) y `si` | `porcentaje-fuera-rango`, `porcentaje-mal`, `juicio-mal`, `vacio` |
| 3 | `{porcentaje:n, inconsistencia:"a"\|"b"\|"c"}` | 4–4.4 y la opción correcta | `porcentaje-mal`, `inconsistencia-mal`, `vacio` |
| 4 | `{actores:[ids]}` | exactamente `["caficultora","hija"]` | `sobre-marcado`, `sub-marcado`, `equivocados`, `vacio` |
| 5 | `{frases:[5]}` | `["sin_evidencia","enganosa","enganosa","sin_evidencia","verificable"]` | `parcial-{n}`, `vacio` |

**Claves de error a nivel de envío (no de contenido), agregadas por el apuntador:** `no_autorizado` (no es del equipo), `no_apuntador` (es del equipo pero no es quien apunta), `sin_apuntador` (el equipo no tiene apuntador designado todavía), `sesion_cerrada`, `tiempo_agotado`, `bloqueada`.

`parcial: true` cuando hay ≥1 acierto pero no todos. Código maestro `06-87-04-2P-4`; `verificar_maestro` normaliza mayúsculas, espacios y guiones.

---

## 15. Accesibilidad

Auditoría: `qa-ux-a11y`. Sin cambios de principio, ahora aplicados sobre markup de Stitch en vez de HTML propio:

- `:focus-visible` con contorno de 2px en el color de acento del sistema Stitch. Nunca `outline:none` a secas — si Tailwind lo resetea en algún componente, `fe-stitch` lo repone explícitamente.
- Feedback en `role="status" aria-live="polite"`. El cronómetro se anuncia **solo** a los 10, 5 y 1 minuto.
- Transiciones dentro de `@media (prefers-reduced-motion: no-preference)`.
- Objetivos táctiles ≥44×44px. Cuerpo ≥16px, legible en proyector a 3 metros.
- Ningún estado se comunica solo por color: acierto, error, y **el estado "no sos el apuntador"** llevan icono y texto, no solo un cambio de tono.
- El foco se mueve a `#estacion-titulo` al seleccionar una sala (§11), equivalente de accesibilidad heredado del rediseño de tablero.

---

## 16. Seguridad y protección de datos

`qa-seguridad` verifica cada punto con un caso **negativo**, no solo el positivo.

### 16.1 Sesión

Cookie httpOnly, `Secure` (en online), `SameSite=Strict`, token de 32 bytes aleatorios cuyo **hash** se guarda en `sesiones_login`. JavaScript del navegador no puede leerla. Expira a los 30 días; `Auth.salir()` borra la fila del lado servidor. `COOKIE_SECRET` y `RESEND_API_KEY` viven solo en variables de entorno del proceso (`.env` local / panel de Render), nunca en el repositorio ni en el frontend.
Verificación de cierre: `grep -riE "RESEND_API_KEY|COOKIE_SECRET" js/*.js *.html` → cero coincidencias.

**Incidente histórico (2026-08-25, era Supabase):** una clave secreta apareció en `.env` dentro de esta carpeta sincronizada a Google Drive. Fue rotada de inmediato. La arquitectura actual no tiene un equivalente que pueda filtrarse desde el cliente, pero `RESEND_API_KEY`/`COOKIE_SECRET` merecen el mismo cuidado.

### 16.2 Autorización

- RLS activo **y forzado** en todas las tablas de negocio (§3.1).
- `app_runtime` no es dueño de ninguna tabla.
- `estaciones`, `codigos_verificacion` y `sesiones_login` sin acceso desde el "mundo RLS" normal — las tocan únicamente las rutas de `srv/rutas/auth.js`.
- `intentos`/`progreso` de solo lectura para el estudiante; se escriben solo desde `verificar_estacion()`, y solo si quien llama es el apuntador del equipo.

### 16.3 Identidad y datos personales

- Registro restringido por nómina (o `docentes_autorizados`), verificado en `crear_o_recuperar_perfil()`, no en el cliente.
- RLS permite a cada estudiante ver **solo su propia fila** de `nomina`.
- Consentimiento explícito antes de crear la cuenta, aviso de privacidad abierto y legible.
- El docente puede `anonimizar_sesion()` al cerrar el curso.
- Sin analítica, sin telemetría, sin terceros — ni Resend ve el contenido del juego, solo el correo y el código.
- **El apuntador no es un dato más sensible que el resto** — es visible para todo el equipo (para que sepan a quién le toca) y para el docente; no requiere anonimización especial más allá de la que ya aplica a `nombre`/`correo`/`carné`.

### 16.4 Sanitización

**Todo texto escrito por una persona se pinta con `textContent`. Nunca con `innerHTML`, `insertAdjacentHTML` ni `outerHTML`.** Esto aplica también al nombre del apuntador cuando se muestra a sus compañeros de equipo.

### 16.5 Robustez

- `js/api.js` devuelve `{datos, error}` y nunca lanza hacia la interfaz.
- Pérdida de red: `#aviso-conexion`, reintento, el progreso ya confirmado no se pierde.
- Si Resend falla en modalidad online, `/api/auth/registrar` responde `{error:"correo_no_enviado"}` — nunca una vía alternativa que finja éxito. En modalidad local sin `RESEND_API_KEY`, el log en consola **es** el camino correcto (§6.2), no una degradación de error.

### 16.6 Casos negativos obligatorios para `qa-seguridad`

- `select current_user` con `app_runtime` ≠ rol dueño de las tablas.
- Con `app_runtime`, `select * from estaciones` → falla (RLS forzado, sin políticas).
- Dos requests concurrentes de dos perfiles reutilizando el mismo cliente del pool sin pasar por `conSesion()` → confirmar que el patrón correcto (`is_local=true`) evita la fuga.
- Cookie adulterada → 401.
- Golpear `/api/auth/registrar` con un correo fuera de nómina repetidamente → nunca filtra si el correo existe en la nómina antes de intentar verificar un código.
- Resend forzado a fallar → error honesto, nunca un camino alterno que finja éxito.
- **Nuevo — apuntador:** un estudiante del equipo que **no** es el apuntador llama `POST /api/juego/verificar` directamente (sin pasar por la UI, con Postman/curl y su propia cookie válida) → `{"error":"no_apuntador"}`, y **no** se inserta fila en `intentos` ni cambia `progreso`. Un estudiante intenta `marcar_apuntador` sobre su propio equipo → falla por RLS (no es docente de esa sesión). Un equipo sin apuntador marcado intenta verificar (con cualquier integrante) → `{"error":"sin_apuntador"}`.

---

## 17. Política de colisiones

- **Un archivo, un dueño.** Nadie edita un archivo ajeno; pide el cambio al harness.
- Nadie inventa rutas HTTP, nombres de tabla, firmas de función ni IDs fuera de este contrato.
- Solo `js/api.js` hace `fetch`. Ningún otro módulo llama a `/api/*` por su cuenta.
- Solo `srv/db.js` abre conexiones a Postgres. Ninguna ruta de `srv/rutas/*.js` instancia su propio `Pool`.
- Los subagentes de contenido no escriben lógica; los de lógica no escriben contenido pedagógico.
- `fe-stitch` no reescribe la lógica de `fe-wiring` y viceversa: uno entrega markup+assets fieles a Stitch, el otro los conecta a `Auth`/`Juego`/`Docente`.
- Nadie genera una pantalla 16 de Stitch sin retirar antes una de las 15 (§9.3).

---

## 18. Dirección de diseño y uso de skills

| Skill | Quién la carga | Para qué |
|---|---|---|
| `stitch-design` | `fe-stitch` | Sincronizar/editar pantallas vía Stitch MCP, sintetizar `.stitch/DESIGN.md` si hace falta |
| `design-md` | `fe-stitch` | Analizar el proyecto Stitch y documentar el sistema semántico ya extraído en `11-design-system.json` |
| `impeccable` | `fe-wiring`, `qa-ux-a11y` | Jerarquía, carga cognitiva, estados vacíos, microinteracciones **dentro** del markup de Stitch — no para rediseñar la composición |
| `dataviz` | `fe-wiring`, `ct-e2`, `ct-e3` | Los dos gráficos de §18.1, construidos como SVG inline dentro del componente de evidencia que ya trae Stitch |

**El filtro cambió de sentido.** Las skills de arriba (y cualquier otra que se use) se cargan por sus principios de jerarquía/accesibilidad/datos — **nunca** para justificar reescribir la composición visual que Stitch ya resolvió. Si una skill sugiere una estructura distinta a la de la pantalla Stitch correspondiente, se descarta la sugerencia de estructura, se conserva el principio (contraste, tamaño de blanco, orden de lectura).

### 18.1 Visualizaciones (SVG inline, dentro del componente de evidencia de Stitch)

1. **E3** — reparto de los US$4.00: barra apilada, caficultora `0.175` visualmente ínfima.
2. **E2** — huella hídrica: barra proporcional 87% verde / 13% resto, rango 85–90% marcado.

Color nunca como único portador de significado, `role="img"` + `<title>`/`<desc>`, tabla equivalente en `<details>`.
