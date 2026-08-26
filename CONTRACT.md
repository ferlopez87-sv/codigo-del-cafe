# CONTRACT.md — Contrato de interfaces

Proyecto: **El Código del Café** — escape room de auditoría de sostenibilidad (CGC, Cadena Global de Café).
Arquitectura: frontend estático vanilla + **Supabase** (Postgres, Auth, RLS).

> Este archivo lo escribe y modifica **solo el harness**. Ningún subagente lo edita.
> Todo subagente trabaja contra este contrato, **no** contra el código de otro subagente.
> Si algo aquí te bloquea, repórtalo al harness; no improvises un nombre distinto.

---

## 0. Restricciones globales (no negociables)

1. **Frontend 100% vanilla.** HTML + CSS + JS sin frameworks, sin bundlers, sin SDK, sin CDN, sin Google Fonts, sin imágenes externas. La comunicación con Supabase se hace con `fetch` contra su API REST.
2. **Sin `type="module"` no aplica ya** — el sitio va hospedado por HTTPS, así que los módulos ES **sí** se permiten y son preferibles. Un `import` por archivo, sin herramientas de compilación.
3. **En el cliente solo va la clave publicable (`sb_publishable_…`).** La secreta (`sb_secret_…`) **jamás** toca el frontend, ni un archivo `.env` que se publique, ni un comentario. Ver §14.1.
4. **Toda validación que importe ocurre en el servidor.** El cliente es una interfaz, no una autoridad.
5. **Español de El Salvador**, tono de thriller corporativo de auditoría. Lenguaje inclusivo donde el caso lo usa ("persona caficultora").
6. Requiere conexión. No hay modo offline.

---

## 1. Rutas y archivos

| Ruta | Archivo | Quién entra |
|---|---|---|
| `/` | `index.html` | Público: portada, registro, verificación por código, inicio de sesión |
| `/juego.html` | `juego.html` | Estudiante autenticado y asignado a un equipo |
| `/docente.html` | `docente.html` | Perfil con `rol = 'docente'` |

Guardas de acceso: cada página verifica sesión al cargar y redirige. `juego.html` sin equipo asignado muestra "Tu docente aún no te asignó equipo", nunca una pantalla rota.

Módulos JS: `js/api.js` · `js/auth.js` · `js/juego.js` · `js/docente.js` · `js/contenido.js` · `js/render.js`

---

## 2. Esquema de base de datos

Dueño: **`db-esquema`**. Archivo `sql/01-esquema.sql`.

```sql
-- Perfil extendido; 1:1 con auth.users
create table perfiles (
  id          uuid primary key references auth.users on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 2 and 80),
  carne       text not null unique check (length(trim(carne)) between 3 and 20),
  correo      text not null,
  rol         text not null default 'estudiante' check (rol in ('estudiante','docente')),
  creado_en   timestamptz not null default now()
);

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
  iniciado_en    timestamptz,          -- lo sella el servidor al primer acceso
  finalizado_en  timestamptz,
  motivo_fin     text check (motivo_fin in ('completado','tiempo','cerrado')),
  unique (sesion_id, nombre)
);

create table integrantes (
  equipo_id  uuid not null references equipos(id) on delete cascade,
  perfil_id  uuid not null references perfiles(id) on delete cascade,
  primary key (equipo_id, perfil_id)
);
-- Una persona no puede estar en dos equipos de la misma sesión:
create unique index integrantes_una_por_sesion
  on integrantes (perfil_id, (select sesion_id from equipos where id = equipo_id));

-- Contenido + RESPUESTAS. RLS niega todo select directo.
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

-- Lo único que el cliente puede leer de las estaciones:
create view estaciones_publicas as
  select id, titulo, pilar, narrativa, datos, reto, interaccion from estaciones;

create table intentos (
  id           bigserial primary key,
  equipo_id    uuid not null references equipos(id) on delete cascade,
  estacion_id  int  not null references estaciones(id),
  perfil_id    uuid not null references perfiles(id),
  respuesta    jsonb not null,
  correcto     boolean not null,
  detalle      text,                  -- clave de error, para elegir la pista
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

-- La rúbrica del caso §5, llenada a mano por el docente
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

**Vista de desempeño** (`v_desempeno`): por equipo — nombre, sesión, integrantes, estaciones resueltas, intentos totales, tiempo usado en segundos, motivo de fin. Es lo que exporta el panel docente.

### 2.1 Tablas de gobierno

Dos tablas deciden quién puede existir en el sistema. Ambas van con **RLS activo y cero políticas** (§3): las lee el trigger de alta, que es `security definer`. Se tocan solo desde el SQL Editor.

```sql
create table docentes_autorizados (
  correo text primary key, nota text, creado_en timestamptz default now()
);
create table configuracion ( clave text primary key, valor text );
```

`docentes_autorizados` resuelve el **círculo cerrado del arranque**: `nomina` cuelga de `sesiones`, `sesiones` exige un `docente_id` con perfil, y el perfil solo nace de la nómina — en una base nueva nadie podría registrarse jamás.

Se rechazó explícitamente la alternativa de un interruptor global `modo_registro='abierto'`: un control que depende de que alguien recuerde apagarlo no es un control, y si queda encendido el registro queda abierto a cualquier correo en una base con datos personales y calificaciones. La lista blanca se cierra sola y además resuelve cómo agregar un segundo docente el año que viene.

`configuracion` guarda `dominio_institucional_aviso = '@monicaherrera.edu.sv'`, que es **solo un texto para advertir** al cargar la nómina. No es un control de acceso.

### 2.2 Nómina — la lista blanca de registro

No hay restricción por dominio: el control es la lista del curso que el docente precarga.

```sql
create table nomina (
  id         uuid primary key default gen_random_uuid(),
  sesion_id  uuid not null references sesiones(id) on delete cascade,
  nombre     text not null,
  correo     text not null,          -- normalizado a minúsculas, sin espacios
  carne      text not null,
  perfil_id  uuid references perfiles(id),   -- se llena al registrarse
  creada_en  timestamptz not null default now(),
  unique (sesion_id, correo), unique (sesion_id, carne)
);
```

Cumple dos funciones a la vez: lista blanca de registro, y fuente de datos para que el docente arme los equipos. Por eso cuelga de `sesiones`.

**Trigger de alta** (`on_auth_user_created`), en este orden exacto:
1. ¿El correo está en `docentes_autorizados`? → perfil con `rol='docente'`, nombre de `raw_user_meta_data`, carné derivado (`'DOC-'||substr(md5(correo),1,8)`) porque la columna es NOT NULL y UNIQUE.
2. ¿Está en `nomina`? → perfil con `rol='estudiante'` y **nombre y carné de la fila de nómina**, no de lo que teclee el estudiante: la lista la cargó el docente y es la fuente de verdad de la identidad. Enlaza `nomina.perfil_id`.
3. Ninguna de las dos → `raise exception`.

**`integrantes` lleva una columna `sesion_id` desnormalizada**, rellenada por trigger desde `equipos` e ignorando lo que mande quien inserta, más una FK compuesta `(equipo_id, sesion_id)` que impide que las dos tablas discrepen. Sobre eso va el índice único `(sesion_id, perfil_id)` que garantiza que nadie esté en dos equipos de la misma sesión. Se eligió índice único y no trigger de validación porque un `select … if exists` tiene ventana de carrera: dos docentes asignando a la vez la atraviesan. **Los demás módulos siguen insertando `(equipo_id, perfil_id)`; la columna se llena sola.**

**Vistas — decisión deliberada, no la cambies:** `estaciones_publicas` va **sin** `security_invoker` (con él heredaría la negación de RLS de `estaciones` y devolvería siempre cero filas), así que **su único control es el GRANT**. `v_desempeno` va **con** `security_invoker` para respetar el RLS de quien consulta; sin eso, cualquier estudiante se bajaría el desempeño de todos los equipos.

**El dominio institucional (`@monicaherrera.edu.sv`) NO bloquea el registro.** Se usa solo al cargar la nómina, para advertirle al docente que un correo no parece institucional — atrapa errores de digitación sin dejar a nadie fuera de su propia clase.

**Trigger de progreso:** al insertarse en `progreso` un `estado = 'resuelta'` para las estaciones 1–4, si las cuatro quedan resueltas, la 5 pasa de `bloqueada` a `pendiente`. El cliente no decide esto.

---

## 3. Row Level Security

Dueño: **`db-rls`**. Archivo `sql/02-rls.sql`.

`alter table … enable row level security` en **todas** las tablas. Sin política, no hay acceso: deny by default.

| Tabla | Estudiante | Docente |
|---|---|---|
| `perfiles` | select **solo el propio**. Sin update: identidad congelada | select de los perfiles de sus sesiones |
| `nomina` | select **solo su propia fila** (`perfil_id = auth.uid()`) | CRUD de las de sus sesiones |
| `docentes_autorizados` | **ninguna política — acceso denegado** | ninguna |
| `configuracion` | **ninguna política — acceso denegado** | ninguna |
| `sesiones` | select de aquellas donde tiene equipo | CRUD de las propias (`docente_id = auth.uid()`) |
| `equipos` | select del propio | CRUD de los de sus sesiones |
| `integrantes` | select de los del propio equipo | CRUD de los de sus sesiones |
| `estaciones` | **ninguna política — acceso denegado** | ninguna |
| `estaciones_publicas` | select para autenticados | select |
| `intentos` | select de los del propio equipo. **Sin insert, update ni delete** | select de los de sus sesiones |
| `progreso` | select del propio equipo. **Sin insert, update ni delete** | select de los de sus sesiones |
| `calificaciones` | select del propio equipo | CRUD de las de sus sesiones |

`intentos` y `progreso` se escriben **exclusivamente** desde `verificar_estacion()`, que es `SECURITY DEFINER`. Un estudiante no puede insertar su propio "resuelta". Esa es la razón de ser del diseño.

**Identidad congelada.** El estudiante no tiene UPDATE sobre `perfiles`, ni siquiera de su nombre. El carné es la llave con la que se califica: si puede reescribirlo, la nómina deja de ser fuente de verdad y vuelve el problema que la nómina existía para resolver. El correo tampoco, porque está atado a `auth.users` y a la fila de nómina. Si un nombre está mal escrito, **lo corrige el docente en la nómina**.

**La nómina es la fuga más probable del sistema.** Contiene nombres, correos y carnés de todo el curso. Sin la restricción a la propia fila, cualquier estudiante autenticado se descargaría el directorio completo de sus compañeros.

**GRANT sobre las vistas — no lo omitas.** Las vistas no tienen RLS propio; el control es el privilegio:

```sql
revoke all on estaciones_publicas from anon, authenticated;
grant select on estaciones_publicas to authenticated;
revoke all on v_desempeno from anon, authenticated;
grant select on v_desempeno to authenticated;
```

**Política de guardado en migraciones.** `configuracion` y las tablas de gobierno van dentro de bloques `DO` guardados. **`nomina` va sin guardar, a propósito:** si algún día no existe, es preferible que la migración se caiga ruidosamente a que deje el directorio del curso con RLS apagado en silencio. Un fallo visible se arregla; uno silencioso se descubre cuando ya se filtraron los datos.

**Función auxiliar** `es_docente_de(sesion uuid) returns boolean`, `SECURITY DEFINER`, `stable`, usada por las políticas para evitar recursión de RLS.

---

## 4. Funciones RPC

Dueño: **`db-funciones`**. Archivo `sql/03-funciones.sql`. Todas `SECURITY DEFINER` con `search_path = public` fijado.

### 4.1 `verificar_estacion(p_equipo uuid, p_estacion int, p_respuesta jsonb) returns jsonb`

El corazón del sistema. En orden estricto:

1. `auth.uid()` debe estar en `integrantes` de `p_equipo` → si no, `{"error":"no_autorizado"}`.
2. La sesión debe estar `abierta` → si no, `{"error":"sesion_cerrada"}`.
3. Sella `equipos.iniciado_en = now()` si aún es `null` (primer acceso del equipo).
4. `now() <= iniciado_en + duracion_minutos` → si no, marca `motivo_fin='tiempo'` y devuelve `{"error":"tiempo_agotado"}`.
5. Si `p_estacion = 5`, las estaciones 1–4 deben estar `resuelta` → si no, `{"error":"bloqueada"}`.
6. Si la estación ya está `resuelta`, devuelve el resultado sin registrar intento nuevo.
7. Compara `p_respuesta` contra `estaciones.respuesta` según §12.
8. Inserta en `intentos` y actualiza `progreso` — **con `now()` del servidor, nunca con un timestamp del cliente**.
9. Devuelve:

```json
{ "ok": true,  "parcial": false, "intentos": 2, "codigo": "06-VC", "feedback": "…" }
{ "ok": false, "parcial": true,  "intentos": 2, "detalle": "orden-mal", "pista": "…" }
```

La `pista` se devuelve según el número de intento: 1 → `pistas[0]`, 2 → `pistas[1]`, 3 o más → `pistas[2]`. **El cliente nunca recibe `respuesta` ni el arreglo completo de `pistas`.**

### 4.2 Resto

| Función | Devuelve |
|---|---|
| `mi_equipo()` | equipo, sesión, integrantes y progreso del `auth.uid()`, o `null` |
| `estado_juego(p_equipo uuid)` | progreso de las 5 estaciones + segundos restantes calculados en servidor |
| `verificar_maestro(p_equipo uuid, p_codigo text)` | valida `06-87-04-2P-4` normalizado; al acertar sella `finalizado_en` y `motivo_fin='completado'` |
| `cerrar_sesion_clase(p_sesion uuid)` | solo docente: pasa la sesión a `cerrada` y finaliza los equipos abiertos |
| `anonimizar_sesion(p_sesion uuid)` | solo docente: sustituye nombres y carnés por marcadores, conservando el desempeño |

### 4.3 Orden de ejecución del SQL — no alterar

1. `01-esquema.sql` · 2. `02-rls.sql` · 3. `03-funciones.sql`
4. `insert into docentes_autorizados (correo, nota) values ('<correo del docente>', 'docente titular');` desde el SQL Editor
5. `05-seed.sql` — **antes de crear cualquier equipo**: `inicializar_progreso()` falla si no existen las 5 estaciones
6. El docente se registra en la app y cae con rol docente; crea la sesión y carga la nómina

**Regla de tiempo:** los segundos restantes los calcula **siempre** el servidor como `iniciado_en + duracion - now()`. El cliente los muestra e interpola entre respuestas, pero nunca son su fuente de verdad.

---

## 5. Capa de API del cliente

Dueño: **`cl-api`**. Archivo `js/api.js`. **Único** archivo del frontend que conoce la URL del proyecto y la clave `anon`. Nadie más hace `fetch` a Supabase.

```js
// js/api.js  — exporta:
export const Auth = {
  registrar({ nombre, correo, carne }),   // POST /auth/v1/otp  (shouldCreateUser: true)
  enviarCodigo(correo),                   // reenvío de OTP
  verificarCodigo(correo, token),         // POST /auth/v1/verify  → guarda sesión
  sesion(),                               // sesión vigente o null
  refrescar(),                            // renueva con el refresh token
  salir()
};

export const Juego = {
  miEquipo(),                             // rpc mi_equipo
  estaciones(),                           // select sobre estaciones_publicas
  estado(equipoId),                       // rpc estado_juego
  verificar(equipoId, estacionId, respuesta),  // rpc verificar_estacion
  verificarMaestro(equipoId, codigo)
};

export const Docente = {
  sesiones(), crearSesion(d), abrirSesion(id), cerrarSesion(id),
  registrados(sesionId), crearEquipo(sesionId, nombre),
  asignar(equipoId, perfilId), desasignar(equipoId, perfilId),
  desempeno(sesionId),                    // select sobre v_desempeno
  guardarCalificacion(equipoId, rubrica),
  anonimizar(sesionId)
};
```

**Reglas de `api.js`:**
- Un único `peticion()` interno arma cabeceras (`apikey`, `Authorization: Bearer`), reintenta una vez ante 401 refrescando el token, y normaliza errores.
- Devuelve siempre `{ datos, error }`. **Nunca lanza** hacia la interfaz: un fallo de red no debe romper una partida en curso.
- Toda función es `async`. Ningún módulo de interfaz conoce URLs ni claves.
- La configuración vive en `js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DOMINIO_INSTITUCIONAL`), con un `config.ejemplo.js` versionado y el real ignorado.

---

## 6. IDs — `index.html` (registro y acceso). Dueño: `au-registro`

| ID | Elemento |
|---|---|
| `#vista-portada` / `#vista-registro` / `#vista-codigo` / `#vista-acceso` | pantallas, se alternan con `.is-oculta` |
| `#form-registro` | `<form>` |
| `#reg-correo` | `email`, requerido. **Único campo de identidad** |
| `#reg-privacidad` | `checkbox` requerido: "He leído y acepto el aviso de privacidad" |
| `#aviso-privacidad` | `<details open>` con el texto completo |
| `#btn-registrar` | `<button type="submit">` |
| `#form-codigo` | `<form>` de verificación |
| `#cod-token` | `text`, `inputmode=numeric`, `autocomplete="one-time-code"`, 6 dígitos |
| `#btn-verificar-codigo` · `#btn-reenviar-codigo` | botones |
| `#cuenta-reenvio` | `<span>` "Podés reenviar en 45s" |
| `#form-acceso` · `#acc-correo` · `#btn-acceder` | inicio de sesión de quien ya está registrado |
| `#mensaje-auth` | `<div role="alert">` errores y confirmaciones |

`autocomplete="one-time-code"` no es cosmético: permite que iOS y Android ofrezcan el código desde la notificación.

### 6.1 Por qué el registro pide un solo dato

El nombre y el carné salen de la nómina que cargó el docente, no de lo que teclee el estudiante. Se elimina la posibilidad de errores de digitación en el carné —que es la llave para calificar— y la de suplantar a un compañero.

### 6.2 Por qué el correo fuera de nómina falla tarde, y debe seguir fallando tarde

El código de un solo uso se envía a **cualquier** correo. El rechazo por no estar en la nómina ocurre recién al verificar el código, cuando se dispara el trigger de alta.

Es incómodo y es deliberado. Comprobar la nómina antes de enviar el código convertiría el formulario en un oráculo: cualquiera podría averiguar quién está inscrito en el curso probando correos. **`au-registro` no debe agregar una verificación previa "para mejorar la experiencia".** El mensaje de error al verificar debe ser claro y ofrecer contactar al docente.

---

## 7. IDs — `juego.html`. Dueño: `fe-shell`

Idénticos a la versión previa del contrato, con estos cambios:

- Desaparecen `#input-equipo`, `#lista-integrantes` y `#input-duracion`: el equipo y la duración los define el docente.
- `#pantalla-bienvenida` pasa a ser **sala de espera**: nombre del equipo, integrantes, y `#btn-iniciar` que arranca el cronómetro compartido.
- `#sin-equipo` — `<section>` para quien aún no fue asignado.
- `#aviso-conexion` — `<div role="status">` visible al perder la red.
- Desaparece `#panel-profesor`: el modo docente ahora es una página con rol autenticado.

Se mantienen sin cambios: `#pantalla-dashboard`, `#pantalla-veredicto`, `#pantalla-resumen`, `#barra-superior`, `#cronometro`, `#cronometro-anuncio`, `#barra-progreso`, `#barra-progreso-relleno`, `#contador-progreso`, `#lista-estaciones`, las tarjetas `.estacion-card[data-estacion]` con sus estados `is-pendiente`/`is-progreso`/`is-resuelta`/`is-bloqueada`, todo el modal `#modal-estacion` (§ previa 3.5), `#fragmentos-codigo`, `#input-codigo-maestro`, `#btn-verificar-maestro`, `#feedback-maestro`, `#texto-veredicto`, `#resumen-datos`.

---

## 8. IDs — `docente.html`. Dueño: `te-panel`

| ID | Elemento |
|---|---|
| `#lista-sesiones` · `#btn-nueva-sesion` · `#form-sesion` | gestión de sesiones |
| `#sesion-estado` | `borrador` / `abierta` / `cerrada` |
| `#btn-abrir-sesion` · `#btn-cerrar-sesion` | control del reloj de clase |
| `#form-nomina` · `#nomina-pegar` · `#btn-cargar-nomina` | carga de la lista del curso: pegar CSV `nombre,correo,carne` |
| `#tabla-nomina` | lista cargada, con aviso en los correos que no son del dominio institucional |
| `#btn-agregar-a-nomina` | alta individual, para el estudiante que aparece el día de la clase |
| `#lista-registrados` | estudiantes de la nómina que ya se registraron y aún no tienen equipo. **Sale de `nomina` menos `integrantes`, no de `perfiles`:** el docente no puede leer perfiles de estudiantes de otras secciones |
| `#lista-equipos` · `#btn-nuevo-equipo` | equipos de la sesión |
| `#btn-asignar` · `#btn-desasignar` | asignación de integrantes |
| `#tabla-monitoreo` | progreso en vivo por equipo |
| `#btn-exportar-csv` | descarga del desempeño |
| `#form-rubrica` | los 4 criterios del caso §5 + nota final + observaciones |
| `#btn-anonimizar` | borrado de datos personales al cerrar el curso |

**La asignación debe poder hacerse durante la clase.** Un estudiante que llega sin equipo es el caso normal, no la excepción.

---

## 9. Tokens de CSS. Dueño: `fe-tokens`

Sin cambios respecto de la versión previa:

```
--color-fondo, --color-fondo-elevado, --color-fondo-modal
--color-borde, --color-borde-fuerte
--color-texto, --color-texto-suave, --color-texto-tenue
--color-acento, --color-acento-suave
--color-exito, --color-exito-fondo
--color-error, --color-error-fondo
--color-alerta, --color-alerta-fondo
--color-bloqueado
--fuente-titulo, --fuente-cuerpo, --fuente-mono
--paso--2 … --paso-5      --espacio-1 … --espacio-8
--radio-sm/md/lg          --sombra-sm/md
--transicion              --ancho-max: 1100px
```

Cada par texto/fondo debe alcanzar **4.5:1** (3:1 desde 24px). Los ratios calculados se documentan en un comentario al inicio del archivo; se auditan en la Ola 5.
Concatenación de `styles.css`: `tokens` → `layout` → `components` → `a11y`.

---

## 10. Contenido de las estaciones

Dueños: `ct-e1` … `ct-e5`. Cada subagente entrega **dos** piezas:

**a) `js/contenido.js`** — lo que puede vivir en el cliente porque no revela nada:
```js
export const ESTACIONES_UI = {
  1: { ordenInicialAleatorio: true, etiquetas: { … } }
};
```
Enunciados, narrativa, datos y reto **se leen de `estaciones_publicas`**, no se duplican aquí.

**b) `sql/05-seed.sql`** — el `INSERT` de su estación, con narrativa, datos, reto, interacción, las 3 pistas, el feedback de acierto, el código y la **respuesta**.

**Reglas de contenido (se auditan en la Ola 5):**
- Las pistas 1 y 2 reorientan; **no revelan**. La 3 puede acercarse mucho.
- `feedback_ok` **siempre** cita el dato del caso que sustenta la respuesta.
- Todo número sale literalmente del caso. Nada inventado.
- CGC no es villana: es una empresa cuyo discurso no está respaldado. Sin moralina.

---

## 11. Tipos de interacción. Render: `cl-render`

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

---

## 12. Forma de las respuestas y claves de error

Lo evalúa `verificar_estacion` en Postgres; el cliente solo arma el `jsonb`.

| Est. | `respuesta` enviada | Correcto | Claves de `detalle` |
|---|---|---|---|
| 1 | `{orden:[ids], eslabon:"cultivo"}` | `["cultivo","cosecha","procesamiento","exportacion","tostado","venta"]` y `cultivo` | `orden-mal`, `eslabon-mal`, `ambos-mal`, `vacio` |
| 2 | `{porcentaje:n, enganosa:"si"\|"no"}` | 87 (acepta 87.5) y `si` | `porcentaje-fuera-rango`, `porcentaje-mal`, `juicio-mal`, `vacio` |
| 3 | `{porcentaje:n, inconsistencia:"a"\|"b"\|"c"}` | 4–4.4 y la opción correcta | `porcentaje-mal`, `inconsistencia-mal`, `vacio` |
| 4 | `{actores:[ids]}` | exactamente `["caficultora","hija"]` | `sobre-marcado`, `sub-marcado`, `equivocados`, `vacio` |
| 5 | `{frases:[5]}` | `["sin_evidencia","enganosa","enganosa","sin_evidencia","verificable"]` | `parcial-{n}`, `vacio` |

`parcial: true` cuando hay ≥1 acierto pero no todos: permite decir "vas por buen camino" sin revelar cuál.
Código maestro `06-87-04-2P-4`; `verificar_maestro` normaliza mayúsculas, espacios y guiones.

---

## 13. Accesibilidad. Auditoría: `fe-a11y` y `qa-ux-a11y`

- `:focus-visible` con contorno de 2px en `--color-acento`. Nunca `outline:none` a secas.
- Modal: foco atrapado, `Esc` cierra, el foco vuelve a la tarjeta que lo abrió.
- Feedback en `role="status" aria-live="polite"`. El cronómetro se anuncia **solo** a los 10, 5 y 1 minuto: anunciarlo cada segundo hace inusable un lector de pantalla.
- Transiciones dentro de `@media (prefers-reduced-motion: no-preference)`.
- Objetivos táctiles ≥44×44px. Cuerpo ≥16px, legible en proyector a 3 metros.
- Ningún estado se comunica solo por color: acierto y error llevan icono y texto.

---

## 14. Seguridad y protección de datos

Se almacenan datos personales de estudiantes. Estas reglas son obligatorias y `qa-seguridad` las verifica con casos **negativos**, no solo positivos.

### 14.1 Claves
**En el frontend va únicamente la clave publicable (`sb_publishable_…`, antes `anon`).** La secreta (`sb_secret_…`, antes `service_role`) ignora RLS y expone la base entera: no entra al repositorio, ni al HTML, ni a un comentario, ni a un `config.js` publicado. La `anon` es pública por diseño y eso está bien: **el control de acceso es RLS, no el secreto de la clave.**
Verificación de cierre: `grep -riE "service_role|sb_secret_[A-Za-z0-9]" .` → cero coincidencias.

**Incidente registrado (2026-08-25):** la clave secreta apareció en `.env`, dentro de una carpeta sincronizada a Google Drive. Fue rotada y eliminada. `.gitignore` excluye `.env`; `.env.ejemplo` es la plantilla.

### 14.2 Autorización
- RLS activo en todas las tablas, deny by default (§3).
- `estaciones` no tiene ninguna política de select: las respuestas no salen jamás.
- `intentos` y `progreso` son de solo lectura para el estudiante; se escriben solo desde la RPC.
- Cada política se prueba intentando el acceso que **debe** fallar.

### 14.3 Identidad y datos personales
- Registro restringido por **nómina** en el trigger de alta, no en el cliente. El dominio institucional es solo una advertencia al cargar la lista, no un control de acceso.
- La nómina contiene nombres, correos y carnés de todo el curso: RLS debe permitir a cada estudiante ver **solo su propia fila**. Es la fuga de datos personales más probable del sistema.
- Consentimiento explícito antes de crear la cuenta, con el aviso de privacidad abierto y legible: qué se guarda, para qué, cuánto tiempo, quién lo ve.
- El docente puede `anonimizar_sesion()` al cerrar el curso. El plazo de retención se documenta en el README.
- Sin analítica, sin telemetría, sin terceros.

### 14.4 Sanitización
**Todo texto escrito por una persona se pinta con `textContent`. Nunca con `innerHTML`, `insertAdjacentHTML` ni `outerHTML`.** Aplica a nombres, correos, carnés y nombres de equipo. Importa especialmente en `docente.html`: ahí el nombre que escribió un estudiante se le muestra al docente, y un `innerHTML` en ese camino es un XSS almacenado con entrega dirigida.
`innerHTML` se permite solo con literales del propio código.

### 14.5 Robustez
- `api.js` devuelve `{datos, error}` y nunca lanza hacia la interfaz.
- Pérdida de red: `#aviso-conexion`, reintento, y el progreso ya confirmado por el servidor no se pierde.
- Un `JSON.parse` de respuesta malformada se descarta con mensaje claro, sin romper la partida.

---

## 15. Política de colisiones

- **Un archivo, un dueño.** Nadie edita un archivo ajeno; pide el cambio al harness.
- Nadie inventa IDs, nombres de tabla ni firmas de función fuera de este contrato.
- Solo `js/api.js` habla con Supabase. Ningún módulo de interfaz hace `fetch` por su cuenta.
- Los subagentes de contenido no escriben lógica; los de lógica no escriben contenido pedagógico.
- Ningún módulo de interfaz escribe estilos en línea, salvo `style.width` de la barra de progreso y `hidden`.

---

## 16. Dirección de diseño y uso de skills

| Skill | Quién la carga | Para qué |
|---|---|---|
| `ui-ux-pro-max` | `fe-tokens` | Dirección visual, paleta y par tipográfico antes del primer token |
| `high-end-visual-design` | `fe-components` | Espaciado, sombras, estructura de tarjetas |
| `impeccable` | `fe-layout`, `fe-a11y`, `qa-ux-a11y` | Jerarquía, carga cognitiva, a11y, microinteracciones, estados vacíos |
| `dataviz` | `fe-components`, `ct-e2`, `ct-e3` | Los dos gráficos de §16.2 |

### 16.1 El filtro innegociable
Estas skills suelen asumir Tailwind, shadcn, React o Google Fonts. **Las cuatro están prohibidas aquí.** Traducir siempre a: CSS plano con las variables de §9, font stacks del sistema, efectos baratos (sombras y transformaciones sí; blur pesado y animación continua no), todo bajo `prefers-reduced-motion`.
**Si una skill sugiere una dependencia, se descarta la sugerencia, no la restricción.**

### 16.2 Visualizaciones (`dataviz`, SVG inline)
1. **E3 — el reparto de los US$4.00.** Barra apilada horizontal: caficultora `0.175` · procesamiento `0.40` · tostado y logística `1.10` · cafetería `2.325`. El segmento de la persona caficultora queda visualmente ínfimo: ese es el aprendizaje, y se ve antes de leerse.
2. **E2 — huella hídrica.** Barra proporcional 87% verde / 13% resto, con el rango 85–90% marcado, para entender que "agua de lluvia" es la mayoría del total, no un impacto cero.

SVG inline, sin librerías. El color nunca es el único portador de significado: etiqueta de texto en cada segmento, `role="img"` con `<title>` y `<desc>`, y una tabla equivalente detrás de un `<details>`.
