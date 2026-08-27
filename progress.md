# progress.md — Bitácora del harness

Proyecto: **Misión: El código secreto del café** — escape room de auditoría de sostenibilidad. (Nombre interno de caso/contenido: "El Código del Café", así aparece en las entradas históricas de abajo y en el caso pedagógico fuente — no se reescribe el historial.)
Plan completo: `~/.claude/plans/quizzical-greeting-nygaard.md`. Contrato: `CONTRACT.md`.

---

## 2026-08-25 — Ola 0 cerrada

### Decisiones de arquitectura

El alcance cambió dos veces durante la planificación. Estado final:

| Decisión | Valor |
|---|---|
| Contenido | "El Código del Café", 5 estaciones, orden libre; E5 bloqueada hasta resolver E1–E4 |
| Backend | **Supabase** — Postgres + Auth con código de un solo uso por correo + RLS |
| Frontend | HTML/CSS/JS vanilla contra la API REST vía `fetch`. Sin frameworks, sin SDK, sin CDN |
| Equipos | El **docente** los arma y asigna antes de la clase |
| Calificación | El sistema **no califica**: entrega el desempeño como insumo para la rúbrica del caso |
| Skills de diseño | `impeccable` · `dataviz` · `ui-ux-pro-max` · `high-end-visual-design` |

### Hecho

- `CONTRACT.md` reescrito al modelo cliente-servidor: 16 secciones con esquema de base de datos, RLS, RPC, contrato de la API del cliente, IDs de las tres páginas, tokens de CSS, accesibilidad, seguridad y dirección de diseño.
- `content-agent.md` creado. El harness lo declaraba pero el archivo no existía.
- `harness-agent.md` actualizado. Describía otro juego: "El Cuarto de la Reputación", 4 salas secuenciales. Respaldo en `_src/harness-agent.md.bak`.
- `.gitignore` y `.env.ejemplo` creados.
- Andamiaje `_src/` y directorios `sql/` y `js/`.

### Incidente de seguridad — CERRADO

Se encontró la clave `sb_secret_…` (equivalente a `service_role`, ignora RLS) en `.env`, dentro de una carpeta sincronizada a Google Drive. **Fernando la rotó en el panel el 2026-08-25 y la eliminó del archivo.** La clave expuesta quedó invalidada. Se agregaron `.gitignore` y `.env.ejemplo`.

### Cambio de control de acceso — nómina en vez de dominio

La Escuela no tenía un dominio de correo utilizable al momento de decidir, y se optó por **nómina precargada**: el docente sube la lista del curso y solo esos correos completan el registro. Es más estricto que el dominio, y no agrega trabajo porque la nómina ya hacía falta para asignar equipos.

Consecuencias aplicadas al contrato:
- Tabla `nomina` nueva; el trigger de alta valida contra ella.
- El registro pide **un solo dato**: el correo. Nombre y carné salen de la nómina, lo que elimina errores de digitación en el carné y la suplantación.
- El rechazo por no estar en nómina ocurre al verificar el código, no antes: comprobarlo antes convertiría el formulario en un oráculo para averiguar quién está inscrito.
- El dominio `@monicaherrera.edu.sv` quedó como advertencia al cargar la lista, no como control de acceso.
- Correcciones enviadas en caliente a `db-esquema` y `db-rls`, que estaban corriendo.

### Incidente resuelto — detalle histórico

Se encontró la clave **`sb_secret_…`** de Supabase en `.env`. Equivale a `service_role`: ignora RLS y da acceso total a la base — datos personales de estudiantes, respuestas correctas y calificaciones.

Agravantes: la carpeta es Google Drive, así que el archivo ya se sincronizó; y la clave quedó expuesta en el contexto de la sesión de trabajo.

**Acción pendiente de Fernando:** rotar la clave en *Project Settings → API Keys → Secret keys* y borrarla del `.env`. Este proyecto no la necesita: el frontend usa solo la publicable, y las migraciones se aplican desde el SQL Editor o con el CLI tras `supabase login`.

### Configuración — completa

- `SUPABASE_URL`: `https://mdkbgjzvdwqcokuqdvvn.supabase.co`
- Clave publicable en `.env`. La secreta ya no está y fue rotada.
- Dominio: `@monicaherrera.edu.sv`, en su rol de advertencia.

---

## En curso — Ola 1 (paralelo, 3 subagentes)

| Subagente | Entregable | Estado |
|---|---|---|
| `db-esquema` | `sql/01-esquema.sql` — 9 tablas, 2 vistas, triggers de alta y de progreso | en curso |
| `db-rls` | `sql/02-rls.sql` — RLS en todas las tablas + pruebas negativas | en curso |
| `db-funciones` | `sql/03-funciones.sql` — `verificar_estacion()` y las demás RPC | en curso |

---

## Siguiente — Ola 2 (paralelo, 16)

5 de contenido (`ct-e1`…`ct-e5`, que entregan también su `INSERT` del seed) · 5 de frontend · 3 de autenticación · 3 de panel docente.

## Después

- **Ola 3** (4): la capa cliente — `cl-api`, `cl-juego`, `cl-timer`, `cl-render`.
- **Ola 4**: integración, despliegue del proyecto Supabase, prueba de humo extremo a extremo.
- **Ola 5** (4): QA funcional, de seguridad, de accesibilidad y pedagógico.
- **Ola 6**: fixes del triage.

---

## Riesgo abierto — calendario

El sistema es de otro tamaño que la webapp estática original: base de datos, políticas de seguridad, correo transaccional, panel docente y hospedaje. Además, que el docente asigne los equipos obliga a que **todos los estudiantes se registren antes de la clase**: una dependencia organizativa que no controlamos.

Contingencia si la fecha aprieta: correr esta sesión con la versión offline —diseñada hasta el detalle, se termina rápido— y estrenar la plataforma con cuentas en la siguiente cohorte.

---

## Ola 1 — estado

| Subagente | Entregable | Estado |
|---|---|---|
| `db-esquema` | `sql/01-esquema.sql` (869 líneas) | entregado, en revisión por corrección de arranque |
| `db-rls` | `sql/02-rls.sql` (1090 líneas) | entregado, en revisión por 4 resoluciones |
| `db-funciones` | `sql/03-funciones.sql` | en curso |

Ambos entregados verificaron contra **Postgres 15 real en Docker**, no solo revisión de sintaxis: corridas idempotentes repetidas y pruebas negativas ejecutadas. `db-rls` reporta 32 políticas, 8 funciones auxiliares, `estaciones` con cero políticas y cero políticas concedidas a `anon`.

### Decisiones del harness tomadas durante la Ola 1

**1. Círculo cerrado en el arranque — resuelto con lista de docentes.**
`nomina` cuelga de `sesiones` → `sesiones` exige `docente_id` → el perfil solo nace de `nomina`. En una base nueva nadie podía registrarse jamás.
`db-esquema` propuso un interruptor `configuracion.modo_registro='abierto'`. **Rechazado:** un control que depende de acordarse de apagarlo no es un control; si queda encendido, el registro queda abierto en una base con datos personales y calificaciones.
**Adoptado:** tabla `docentes_autorizados (correo, nota, creado_en)`, simétrica a la nómina. El trigger evalúa: docente autorizado → rol docente; en nómina → rol estudiante con datos de la nómina; ninguna → rechazo. Se cierra solo, sin estado que apagar, y resuelve cómo agregar docentes en el futuro.

**2. Identidad congelada.** El estudiante queda con **SELECT sobre su perfil y nada más**; se le quitó el UPDATE. El carné es la llave con la que se califica: si el estudiante lo reescribe, la nómina deja de ser fuente de verdad. Las correcciones de nombre las hace el docente en la nómina.

**3. Tablas de gobierno sin políticas.** `configuracion` y `docentes_autorizados` van con RLS activo y **cero políticas**. Las lee el trigger, que es `security definer`. Ningún cliente las necesita, y escritura de cliente ahí sería escalada de privilegios directa.

**4. GRANT sobre vistas.** `estaciones_publicas` va sin `security_invoker` (a propósito, si no heredaría la negación de `estaciones` y devolvería cero filas), así que **el GRANT es su único control**. `v_desempeno` sí lleva `security_invoker`. Ambas: `revoke all from anon, public` + `grant select to authenticated`.

**5. Política de guardado en migraciones.** `configuracion` guardada; `nomina` **sin guardar**. Una migración que se cae ruidosamente se arregla; una que deja el directorio del curso con RLS apagado en silencio se descubre cuando ya se filtró.

### Orden de ejecución del SQL (no alterar)

1. `01-esquema.sql` · 2. `02-rls.sql` · 3. `03-funciones.sql`
4. `insert into docentes_autorizados (correo, nota) values ('<correo de Fernando>', 'docente titular');` desde el SQL Editor
5. `05-seed.sql` — **antes de crear equipos**: `inicializar_progreso()` exige que existan las 5 estaciones
6. El docente se registra en la app y cae con rol docente; crea la sesión y carga la nómina

### Para `QA_PLAN.md`

En psql, poner `\set ON_ERROR_ROLLBACK on` antes del bloque de pruebas negativas. Sin eso, el primer error esperado aborta la transacción y las demás pruebas devuelven "current transaction is aborted" en lugar de ejecutarse.

### Limpieza pendiente en la máquina de Fernando

Contenedor Docker huérfano: `docker rm -f rlsreal`. Imagen cacheada: `docker rmi postgres:15-alpine` si no la querés.

### Pendiente de Fernando

- El **CSV del curso** (`nombre,correo,carne`) para probar el flujo con datos reales. — Fernando confirmó 2026-08-25: lo subirá manualmente cuando la plataforma esté terminada.
- Su **correo** para sembrar `docentes_autorizados`: **`fglopez@monicaherrera.edu.sv`** — recibido 2026-08-25. Seed: `insert into docentes_autorizados (correo, nota) values ('fglopez@monicaherrera.edu.sv', 'docente titular');`

---

## 2026-08-25 — Ola 2 lanzada (luego acotada a backend)

Ola 1 cerrada con 3 SQL. Ola 2 se lanzó con 16 subagentes, pero a petición del docente **se acotó a backend únicamente**. Frontend/auth/docente quedan pausados.

## 2026-08-25 — Backend cerrado y validado en Postgres 15 (cc-pg)

### Correcciones aplicadas (Ola 1.1–1.3)
- `sql/01-esquema.sql:38` — bootstrap reescrito: eliminado `configuracion.modo_registro='abierto'` (rechazado), creada `docentes_autorizados(correo PK, nota, creado_en)` con trigger normalizador `docentes_autorizados_normalizar()` y `manejar_nuevo_usuario()` dual (docentes_autorizados→docente, nomina→estudiante, else→rechazo). Fix crítico: `select exists(...) into v_es_docente` + `coalesce(v_es_docente,false)` — el `select true into` dejaba null y `if not v_es_docente` nunca entraba, por lo que `nomina.perfil_id` quedaba null.
- `sql/02-rls.sql:47` — habilitado RLS para `docentes_autorizados` y `configuracion` con **cero políticas**; eliminado `perfiles_actualiza_propia` (identidad congelada: estudiante solo SELECT); eliminado `configuracion_lectura_autenticados`; grants: `perfiles` sin UPDATE, `configuracion`/`docentes_autorizados` con `revoke all` (doble candado).
- `sql/03-funciones.sql` — verificado estable, sin cambios.
- `sql/04-docentes.sql` — creado: `insert into docentes_autorizados values ('fglopez@monicaherrera.edu.sv','docente titular — FG López') on conflict`.
- `sql/05-seed.sql` — consolidado desde `_src/seed/e1..e5.sql` (143 líneas, 5 INSERT on conflict, códigos 06-VC/87/04/2P/4, respuestas CONTRACT §12).

### Validación Docker (`cc-pg`, Postgres 15)
Orden ejecutado: `01`→`02`→`03`→`04`→`05` sin errores, idempotente (segunda corrida sin error). RLS: `configuracion` t/0 políticas, `docentes_autorizados` t/0, `estaciones` t/0, `perfiles` 2 SELECT/0 UPDATE, `intentos`/`progreso` solo SELECT, `anon` 0 políticas. Docente `fglopez@monicaherrera.edu.sv` registrado → rol docente con fallback `DOC-` si faltan metadatos. Estudiante `ana.perez@gmail.com`/`test2@gmail.com` registrado → nombre/carné copiados de `nomina` (ignora metadatos maliciosos) y `nomina.perfil_id` enlazado. Intruso `intruso@x.com` → `correo_no_esta_en_la_nomina_del_curso` rechazado.

### Orden de deploy (no alterar)
1. `01-esquema.sql` · 2. `02-rls.sql` · 3. `03-funciones.sql` · 4. `04-docentes.sql` · 5. `05-seed.sql` (antes de crear equipos)

### Pendiente de Fernando — backend completo
- CSV del curso: lo subirá manualmente en plataforma cuando esté terminada (sin bloqueo).
- Deploy en Supabase: pegar los 5 SQL en SQL Editor en orden, o `supabase db push`.

### Artefactos backend listos
- `sql/01-esquema.sql` (892 líneas), `sql/02-rls.sql`, `sql/03-funciones.sql`, `sql/04-docentes.sql`, `sql/05-seed.sql`
- `_src/content/e1..e5.json` + `_src/seed/e1..e5.sql` (fuente de 05)
- `sql/05-seed.sql` verificado: `select id,codigo from estaciones` → 1:06-VC 2:87 3:04 4:2P 5:4

---

## 2026-08-25 — Ola 2–3 completadas (contenido + capa cliente)

Contenido: `js/contenido.js:1` (ESTACIONES_UI sin secretos) + `sql/05-seed.sql` 5 estaciones validadas pedagógicamente (pistas 1-2 no revelan, feedback cita dato, CGC no villana, números literales).

Capa cliente Ola 3: `_src/js/api.js`→`js/api.js` (único fetch con `SUPABASE_URL`/`anon`, `peticion()` con retry 401, `{datos,error}`, Auth OTP + Juego + Docente), `_src/js/juego.js`→`js/juego.js` (estado, modal, verificar §12), `_src/js/timer.js`→`js/timer.js` (server-authoritative, skew, anuncio 10/5/1), `_src/js/render.js`→`js/render.js` (orden/numero/checklist/clasificacion, `textContent`).

## 2026-08-25 — Frontend retomado y Ola 4 integrada

Frontend: `_src/css/tokens.css:1` (36 vars, contrastes 4.5:1), `layout.css` (590L, grid responsive), `components.css` (variantes `is-*` con icon+texto), `a11y.css` (focus-visible, modal trap, live regions) → concatenados en `styles.css:1` (2376L, orden `tokens→layout→components→a11y` CONTRACT §9). HTML shells `_src/html/index.html`/`juego.html`/`docente.html` (IDs §6-8 completos, `lang=es-SV`, `textContent` policy) → `index.html:1`/`juego.html:1`/`docente.html:1` con `href="styles.css"` y `src="js/*.js"` corregidos (antes `../css/` y `../js/`). `js/config.js:1` rellenado con valores reales `SUPABASE_URL` y `sb_publishable_...` desde `.env:7` (anon es pública, RLS es el control) y `js/config.ejemplo.js:1` como plantilla.

Integración Ola 4: `styles.css` concatenado, 3 HTML copiados, 4 JS copiados, `node --check` OK en 7 archivos, `grep -ri service_role` 0, `grep -rn innerHTML` 0 en `js/`, IDs smoke: `#reg-correo`/`#cod-token`/`#sin-equipo`/`#aviso-conexion`/`#cronometro`/`#lista-estaciones` etc. `cc-pg` validó `estaciones` 5 filas, `docentes_autorizados` 1 fila (`fglopez@monicaherrera.edu.sv`), `perfiles` docente+estudiantes, `styles.css` 2376L.

QA Ola 5 (no bloqueante, ya entregado): `_src/qa/qa-seguridad.md` (9 pruebas negativas), `qa-funcional.md` (OTP, equipos, estaciones, cronómetro), `qa-pedagogico.md` (APTO, 3 MEDIOS: E1-01 código, E5-01 pista 3, G-01 buffer), `qa-a11y.md` (38 casos WCAG, 7 issues). Pendiente cierre dinámico con `axe-core` + Lighthouse + SR.

---

## 2026-08-25 — Ola 1 interrumpida por límite de sesión; documentos sincronizados

Los tres subagentes de base de datos se cortaron por límite de sesión de la API (reinicia 20:50). **Las correcciones del harness alcanzaron a aplicarse antes del corte.** Verificado por inspección directa de los archivos:

| Corrección | Estado |
|---|---|
| `docentes_autorizados` creada y protegida | aplicada (01 y 02) |
| Interruptor `modo_registro` eliminado, con limpieza de migración para bases viejas | aplicada |
| `dominio_institucional_aviso` sembrado como texto, no como control | aplicada |
| GRANT/REVOKE sobre `estaciones_publicas` y `v_desempeno` | aplicada (02, líneas 717–730) |
| Identidad congelada: sin update de `perfiles` para nadie | aplicada (02, línea 733) |
| `security_invoker` — off en `estaciones_publicas`, on en `v_desempeno` | aplicada y documentada en ambos archivos |

Entregables en disco: `01-esquema.sql` (39 KB), `02-rls.sql` (49 KB), `03-funciones.sql` (41 KB).

### Documentos actualizados

- **`harness-agent.md` reescrito por completo.** Seguía describiendo la arquitectura offline de tres archivos con `localStorage` y concatenación desde `_src/`, que quedó obsoleta con el giro a Supabase. Ahora describe el modelo cliente-servidor, los 7 agentes, las 7 olas, el orden de ejecución del SQL y las seis reglas de seguridad que el harness hace cumplir. Respaldo: `_src/harness-agent.offline.bak`.
- **`CONTRACT.md` actualizado** con lo que la Ola 1 dejó decidido: §2.1 tablas de gobierno y el círculo cerrado del arranque; el orden del trigger de alta; la columna `sesion_id` desnormalizada en `integrantes` y por qué se eligió índice único sobre trigger de validación; las decisiones de `security_invoker`; §3 con las filas de `nomina`, `docentes_autorizados` y `configuracion`, identidad congelada, GRANT de vistas y política de guardado; §4.3 orden de ejecución; §8 origen de `#lista-registrados`; §14.1 con los nombres nuevos de las claves de Supabase y el incidente registrado. Respaldo previo: `_src/CONTRACT.pre-ola1.bak`.

### Cierre pendiente de la Ola 1

`db-funciones` alcanzó a reportar que estaba en los últimos casos borde (seeds sin claves de tolerancia opcionales, arreglos de pistas cortos, permisos de funciones auxiliares) pero se cortó antes de confirmar. **Antes de abrir la Ola 2 hay que reanudarlo y verificar `03-funciones.sql` contra Postgres real**, como hicieron los otros dos.

### Siguiente

**Ola 2**, 16 subagentes en paralelo: 5 de contenido (`ct-e1`…`ct-e5`, que entregan también su `INSERT` del seed), 5 de frontend, 3 de autenticación y 3 del panel docente.

---

## 2026-08-25 — MCP de Stitch conectado; 11 pantallas de diseño descargadas; título de la app definido

### Stitch MCP
Registrado como servidor MCP local (`claude mcp add --transport http stitch https://stitch.googleapis.com/mcp -H "X-Goog-Api-Key: …"`), leyendo la clave desde `Stitch_mpc.json`. La CLI reporta `Connected · tools fetch failed` en `claude mcp list`, pero **el endpoint funciona perfecto por JSON-RPC directo** (`initialize` y `tools/call` responden HTTP 200) — el problema es solo del health-checker de la CLI, no del servidor. Se usó `curl`/Python contra el endpoint, tal como pidió el usuario.

### 11 pantallas descargadas
Proyecto Stitch "The Reputation Room Interface" (ID `2901561950178960561`), 11 de sus 21 pantallas (imagen PNG + código HTML + metadata JSON) en `.stitch/designs/`: registro de agente, bienvenida, registro de usuario, definición de equipo, briefing, las 5 salas, y veredicto. Una (Veredicto) falló en el primer intento (`get_screen` sin el campo `name` de recurso completo); se resolvió agregando `name: "projects/{id}/screens/{screenId}"` al llamado, igual que muestra el ejemplo de la skill `stitch-design`.

### Dos conflictos encontrados entre el diseño y lo ya decidido — resueltos con el usuario
1. **Formación de equipos.** La pantalla "Definición de Equipo" mostraba autoservicio (el estudiante crea su equipo y comparte un código tipo "AUD-482" para que se unan sus compañeros) — lo opuesto a "el docente asigna", ya decidido. **El usuario confirmó mantener "el docente asigna".** La pantalla de Stitch se reutiliza como diseño visual, pero se adapta a sala de espera de solo lectura (nombre del equipo e integrantes ya asignados), no como flujo de creación.
2. **Nombre de la app.** Los diseños de Stitch traían "EL CUARTO DE LA REPUTACIÓN" / "CRISIS_ROOM_V2.0" (nombres de trabajo anteriores). **El usuario definió el título final: "Misión: El código secreto del café".** Verificado que el nombre no se usa en ningún lugar como identificador técnico (ni tabla, ni ruta, ni clave de `localStorage`) — solo aparece como texto visible. Aplicado en `index.html`, `juego.html`, `docente.html` (`<title>`, `<meta description>`, `<h1>`), `README.md` y la línea de identidad de `CONTRACT.md` y este archivo. El nombre interno del caso/contenido pedagógico sigue siendo "El Código del Café" (así en el caso fuente y en el historial de arriba) — no se reescribe el historial.

### Observación pendiente, no bloqueante
Al revisar el Veredicto de Stitch (`11-veredicto.png`), sus 5 fases son genéricas ("PHASE_01: RECONOCIMIENTO" … "PHASE_05: REDACCIÓN FINAL") y no los nombres reales de las 5 estaciones del caso. Cuando se aplique el diseño al HTML real, el contenido de cada pantalla debe remapearse a las estaciones reales de `CONTRACT.md` §10/§12 (Sala de Hechos, Sala Verde, Sala del Dinero, Sala de las Personas, Sala de la Verdad) — es una pasada de contenido, no de estructura visual.

### Estado general (recordatorio, no repetido en detalle — ver entradas previas)
- Migración a Render/Node/Postgres propio: **decidida**, `CONTRACT.md` reescrito completo (17 secciones), `js/demo.js` eliminado. Pendiente: dispatchar `mig-backend`/`mig-deploy` (backend aún no construido). `mig-frontend` **en pausa** a pedido del usuario — ahora se retoma vía los diseños de Stitch en vez de la reconstrucción JS pura que tenía planeada.
- Auditoría independiente ya hecha: SQL (era Supabase) sin bugs, verificado contra Postgres real con roles reales. JS (era Supabase) con un bug crítico: el juego no está conectado de punta a punta (`juego.js` nunca llama `Juego.estaciones()`, nunca importa `render.js`/`timer.js`) — pendiente de resolver en la próxima pasada de frontend, junto con la aplicación de los diseños de Stitch.

---

## 2026-08-25 — CONTRACT.md restaurado a Supabase; Render queda documentado como destino futuro

Tras decidir migrar a Render, reescribí `CONTRACT.md` completo para esa arquitectura (17 secciones, ver entrada anterior). Pero el usuario decidió retomar el frontend **sobre Supabase**, aplicando los diseños de Stitch — es decir, el trabajo activo es sobre el código que existe hoy, no sobre la migración.

Dejar `CONTRACT.md` en versión Render mientras se trabaja sobre Supabase habría hecho que cualquier subagente comparara el código contra una especificación que no aplica todavía (rutas `/api/*` que no existen, tablas `codigos_verificacion`/`sesiones_login` que no existen, `app.usuario_actual()` en vez de `auth.uid()`).

**Resuelto así:**
- La versión Render completa se guardó en **`_src/CONTRACT.render-target.md`** (598 líneas) — se retoma tal cual, actualizada a lo que cambie mientras tanto, cuando se reanude esa migración.
- `CONTRACT.md` se restauró a la versión Supabase final (la que ya pasó por Ola 1–4 y las dos auditorías independientes), con tres actualizaciones nuevas:
  - Nota de estado al inicio explicando esta decisión, para que nadie confunda cuál de los dos archivos es la fuente de verdad.
  - Título actualizado a "Misión: El código secreto del café" en la línea de identidad.
  - §8 confirma explícitamente "docente asigna, sin autoservicio" (por los diseños de Stitch que sí traían esa mecánica).
  - §9 nota la fuente visual (`.stitch/designs/`) y agrega la skill `stitch-design` a la tabla de diseño.
  - §11 deja registrado el bug crítico de la auditoría (`juego.js` nunca usa `render.js`/`Juego.estaciones()`) como lo primero que debe resolver la reconstrucción del frontend.
- `harness-agent.md` (que también describía Render completo) recibió la misma nota de estado al inicio, sin reescribirlo: sigue siendo el plan de la migración futura, marcado como no vigente para el trabajo de hoy.

**Regla para el harness de aquí en adelante:** no reescribir `CONTRACT.md` a Render mientras el trabajo activo sea sobre Supabase/Stitch. Cuando se retome la migración, reemplazar `CONTRACT.md` por `_src/CONTRACT.render-target.md` (revisado y actualizado) y anunciarlo explícitamente, tal como se hizo en sentido inverso hoy.

## Siguiente — reconstrucción del frontend con Stitch

Con `CONTRACT.md` ya alineado a Supabase + Stitch + docente-asigna, el trabajo que sigue es:
1. Reconstruir `styles.css` (tokens/layout/components/a11y) usando los 11 HTML/PNG de `.stitch/designs/` como referencia visual — sin copiar su HTML tal cual, traduciendo a los IDs de CONTRACT §6–§8 y los tokens de §9.
2. Remapear el contenido de cada pantalla de Stitch a las 5 estaciones reales (§10/§12) — las fases genéricas del Veredicto de Stitch ("PHASE_01…05") se reemplazan por las 5 estaciones reales.
3. Adaptar "Definición de Equipo" de Stitch a sala de espera de solo lectura (docente ya asignó), no a flujo de creación/código de equipo.
4. Conectar de una vez `juego.js` con `render.js` (`renderInteraccion`/`serializarRespuesta`) y `timer.js` (`iniciarTimer`/`sincronizarDesdeEstado`), y hacer que `juego.js` llame a `Juego.estaciones()` — hoy no lo hace y el juego no funciona.

---

## 2026-08-25 — Regresión urgente corregida + pendiente de nómina cerrado (harness, en paralelo a fe-visual/fe-wiring)

### Regresión propia — cerrada
Al borrar `js/demo.js` (decisión ya tomada) no limpié sus referencias: `js/api.js` seguía con `import {...} from './demo.js'`, y `js/auth.js` con `import('./demo.js')` dinámico en dos handlers. `node --check` no lo detecta (solo valida sintaxis, no resuelve módulos) — en un navegador real esto rompe la carga del script en `index.html`/`juego.html`/`docente.html`. Encontrado antes de que interfiriera con los dos agentes en curso.

**Limpieza aplicada:**
- `js/api.js`: removidos el import, `DEMO_ESTADO_KEY`, la función `mockDemo()` completa, el interceptor `if(estaEnDemo())` dentro de `peticion()`, y el fallback de 429 que activaba una sesión falsa. El caso de límite de correo (429) ahora devuelve un error honesto con mensaje claro ("Se alcanzó el límite de envío de correos…") — nunca una sesión simulada, tal como manda CONTRACT §0.6.
- `js/auth.js`: removidas `mostrarBotonDemo()`, `ofrecerModoDemo()`, las ramas `datos.demo`/`datos.code` en `handleRegistro`/`handleAcceso`, y la detección de "ya está en modo demo" en `initAuth()`. Destructuring de `datos` no usado limpiado en 3 handlers.
- Verificado: `grep -rin demo js/*.js` sin coincidencias reales (solo dos falsos positivos: un comentario de docente.js usando "demo" como sinónimo de "ejemplo", y una variable de timer.js sin relación). `node --check` OK en los 3 archivos.

### Pendiente de la auditoría JS — cerrado (hallazgo #2)
`docente.js` hablaba directo con Supabase para la nómina (`fetch` manual a `/rest/v1/nomina`, `cargarNomina()` era un stub que nunca mostraba lo ya cargado en el servidor). La auditoría lo había dejado pendiente porque requería una decisión de contrato. Resuelto:
- `js/api.js`: agregados `Docente.nomina(sesionId)` (trae la nómina completa de la sesión) y `Docente.agregarANomina(sesionId, {nombre, correo, carne})` (alta, con la misma validación de parámetros que el resto del objeto `Docente`).
- `js/docente.js`: `cargarNomina()` ahora pinta `#tabla-nomina` de verdad al seleccionar sesión (antes quedaba vacía); `handleCargarNomina()` y el alta individual usan `Docente.agregarANomina()` en vez del `fetch` manual + `import('./config.js')` dinámico que tenían. Eliminadas `insertarFilaNomina()` y `renderTablaNominaLocal()` (código muerto tras el cambio).
- `node --check` OK en los 3 archivos tocados.

### Estado de los subagentes en curso
`fe-visual` y `fe-wiring` siguen corriendo — se los ve avanzando en `index.html`/`juego.html`/`docente.html` (sello "Clasificado", badges, títulos). Ninguno toca `js/api.js`/`js/auth.js`/`js/docente.js`, así que este trabajo no interfiere.

### README.md — sección de modo demo corregida
`README.md` documentaba `js/demo.js` como una característica real ("Modo demo sin correo"). Reemplazada por la guía honesta: no hay modo sin correo, el 429 se resuelve con SMTP propio en el panel de Supabase (Authentication → Email → SMTP Settings), con escalonar el registro como alternativa mientras se configura. Este último es un pendiente que requiere que Fernando entre a su propio panel de Supabase — no es algo que el harness pueda hacer.

### Revisado `avances.md`
Confirma el origen del modo demo (workaround del 429) y coincide con el resto de la bitácora. Sin acción adicional: es un log paralelo de la misma sesión de trabajo, ya reflejado acá.

---

## 2026-08-25 — fe-visual completado

Cambios quirúrgicos y aditivos (no reescribió nada): en `layout.css` una textura sutil de fondo (scanlines+viñeta, sin animación, `z-index:-1`); en `components.css` el sello "Clasificado" reutilizable, refuerzo del badge de cabecera, estilos nuevos para `#cronometro.is-alerta/.is-critico` (existían las clases en JS pero sin CSS — gap real cerrado), y **estilos completos para `#tabla-nomina`/`#tabla-monitoreo`, que no tenían ninguna regla** (se veían con el estilo por defecto del navegador). 3 inserciones de HTML (spans `.sello`), ningún ID tocado. Descartó explícitamente login usuario/contraseña, formulario de nombre propio, autoservicio de equipos y la narrativa del video viral que traían los diseños de Stitch — tal como se le indicó.

Verificado: llaves balanceadas, `xmllint --html` sin errores reales, todos los IDs de CONTRACT §6-8 presentes y únicos, contraste de los pares reusados dentro de lo ya auditado.

Dejó dos hooks opcionales documentados para `fe-wiring`: clases `.ficha-dato`/`__etiqueta`/`__valor` para `#estacion-datos`, y un `<figcaption>` opcional en `.dataviz`. Son CSS inerte si no se usan — no bloquean nada.

Esperando `fe-wiring` (conexión juego.js↔render.js↔timer.js) para integrar ambos y hacer la verificación final conjunta.

### Auditoría de seguridad del repo (proactiva, repo es público)
Verificado: `Stitch_mpc.json` (contiene la API key de Stitch) **nunca** fue trackeado por git ni aparece en ningún commit del historial — no hubo fuga. Pero como el repo `ferlopez87-sv/codigo-del-cafe` es **público**, agregué `Stitch_mpc.json` y `*_mpc.json` a `.gitignore` preventivamente, para que un `git add .` futuro no lo suba por accidente.

Barrido de patrones de secreto (`sb_secret_`, `X-Goog-Api-Key`, `AIza...`, llaves privadas PEM, tokens `ghp_`) sobre **todos** los archivos trackeados en HEAD: cero coincidencias. `js/config.js` sí está trackeado con la clave publicable real de Supabase — correcto, es pública por diseño (RLS la protege, no el secreto).

**Nota para el commit final:** `backend-agent.md`/`content-agent.md`/`frontend-agent.md`/`harness-agent.md`/`qa-agent.md` quedaron trackeados desde el primer commit, antes de que se agregara la regla `*-agent.md` a `.gitignore` en el segundo. Esa regla no destrackea archivos ya versionados — seguirán apareciendo en `git status` como modificados cuando se commiteen los cambios de hoy a `harness-agent.md`. No es un problema, solo algo a tener presente (no se resuelve acá, es decisión de Fernando si quiere `git rm --cached` esos archivos en algún momento).

Corregida además una imprecisión en `README.md`: afirmaba que el `Dockerfile` inyecta variables de entorno de Render en tiempo de build — no es así, es un `COPY` estático plano. Reescrito para reflejar la realidad (`js/config.js` ya trae los valores reales, se edita directo si cambia el proyecto Supabase).

---

## 2026-08-25 — fe-wiring completado + integración verificada

### fe-wiring: el bug crítico está resuelto
Único archivo que necesitó cambios de código: `js/juego.js` (`render.js`/`timer.js`/`contenido.js` ya estaban bien implementados, solo faltaba conectarlos). Cambios:
- `Juego.estaciones()` ahora se llama y se cachea; el modal pinta narrativa/datos/reto reales, no el placeholder estático.
- `#estacion-interaccion` se pinta con `renderInteraccion()` real. Borradas ~180 líneas de código muerto (`construirE1..E5` y helpers de scraping manual).
- `verificarEstacion()` arma la respuesta con `serializarRespuesta()` de `render.js`, no con el scraping propio.
- `timer.js` conectado vía `sincronizarDesdeEstado()`; corregido un orden de inicialización real (registrar `onTiempoAgotado` antes de `cargarEstado()`, no después — si no, un tiempo ya agotado al entrar podía dispararse antes de que hubiera alguien escuchando).
- E1 se baraja del lado cliente solo si `ESTACIONES_UI[1].ordenInicialAleatorio===true` (confirmado que el servidor no lo hace).
- Bug de carrera en el botón "Cancelar" del modal: el `onclick` en línea del HTML corría antes que el listener de `cerrarModal()`, encontraba el modal ya oculto y no limpiaba nada (foco, `inert`, scroll). Corregido neutralizando el `onclick` en línea antes de atar el listener real.
- Verificado con harness `jsdom` aislado (30 aserciones, 0 fallos): estado inicial, cronómetro server-authoritative, contenido real de las 5 estaciones, reordenamiento E1, las 5 formas de respuesta de §12, feedback, limpieza de Cancelar, tiempo agotado.

### Pendiente cerrado por el harness: `#estacion-pilar`
El modal no tenía un elemento dedicado para el pilar de la estación; `juego.js` lo improvisaba como `<span>` sin id colgado del `<h2>` del título (reportado explícitamente, no resuelto por el agente porque agregar IDs no le correspondía). Se agregó `<p id="estacion-pilar">` en `juego.html` justo después del título, `juego.js` apunta ahí directamente, y `CONTRACT.md` §7 lo documenta.

### Integración verificada (fe-visual + fe-wiring + fixes propios, todo junto)
- `node --check` OK en los 10 archivos de `js/`.
- Cero rastros de `demo`, `innerHTML`/`insertAdjacentHTML`/`outerHTML` reales, `service_role`/`sb_secret_` en todo el repo.
- `xmllint --html` sobre los 3 HTML: cero errores estructurales reales (los "Tag X invalid" son solo el DTD antiguo sin reconocer `section`/`header`/`main`/`footer`/`details`/`summary` de HTML5 — no hay tags sin cerrar ni mismatches).
- `styles.css`: 337/337 llaves balanceadas, 2103 líneas (creció desde 1888 por las adiciones de `fe-visual`: tablas de nómina/monitoreo, sello, estados de cronómetro, textura).

**Estado: el juego debería funcionar de punta a punta.** Falta una prueba manual real en navegador (o con Postgres+contenido reales) antes de dar esto por definitivamente listo para clase — la verificación automatizada usó un stub de servidor fiel al contrato, no la base real.

### Siguiente sugerido (no urgente, sin decisión pendiente)
- Prueba manual end-to-end contra un Supabase real (o Docker Postgres local) con las 5 estaciones sembradas.
- Actualizar `QA_INFORME.md`/crear `QA_PLAN.md` reflejando que el juego ya está conectado (el informe anterior tenía "✅ Pass" en varias filas que en realidad fallaban).
- Commit a git de todo este bloque de trabajo (rename, restauración de CONTRACT, demo.js eliminado, fix de nómina, fe-visual, fe-wiring, fix de #estacion-pilar) — pendiente de que Fernando lo pida o confirme.

---

## 2026-08-25 — CHECKPOINT (90% de tokens) — leer esto primero al retomar

### Corrección en curso: fe-visual no usó de verdad el diseño de Stitch

Fernando revisó `index.html` renderizado y señaló, con razón, que no se parecía a las pantallas de Stitch — solo tenía detalles cosméticos (sello, badge reforzado) sobre la estructura HTML vieja. Causa: la instrucción original de CONTRACT §16.1 ("referencia visual, no copiar tal cual") se interpretó como "dejar la maqueta como está, solo tomar color/tipografía" — demasiado conservador. Fernando aclaró la intención real: **descartar el contenido de texto y los flujos ya rechazados, pero reconstruir la composición visual fielmente** (tarjetas con pestaña de carpeta, inputs subrayados tipo terminal, sellos de esquina, jerarquía). `CONTRACT.md` §16.1 ya quedó reescrito con esta corrección explícita, y §16.3 documenta el componente concreto.

### Lo que YA está hecho (verificado, no romper)

- **`styles.css`**: agregado el componente `.ficha` / `.ficha__pestana` / `.ficha__estampa` / `form.campo--terminal` (después de `.sello`, sección "8.1b/8.1c"). Reusa tokens existentes, no agrega hex nuevos, no toca el `outline` de foco (§13 intacto).
- **`index.html`**: `#vista-registro` ya envuelto en `.ficha` con pestaña "Reg_Investigador", estampa "Nómina req.", y `<form id="form-registro">` con clase `campo--terminal`. **Verificado balanceado** (`div` 11/11, `section` 4/4, `form` 3/3) y sin errores estructurales reales en `xmllint`.

### Lo que FALTA — siguiente sesión empieza acá

1. **`index.html`**: aplicar el mismo patrón `.ficha` a `#vista-codigo` (pestaña sugerida: "Verificación") y `#vista-acceso` (pestaña sugerida: "Acceso"). Mismo patrón que `#vista-registro`: envolver el contenido interior de la `<section>` en `<div class="ficha">…</div>`, agregar `<span class="ficha__pestana" aria-hidden="true">…</span>` como primer hijo, `class="campo--terminal"` en el `<form>` correspondiente (`#form-codigo`, `#form-acceso`), y opcionalmente una `.ficha__estampa` si suma (no es obligatoria en las tres, Stitch tampoco la repite siempre).
2. **`juego.html`**: no se tocó nada de este patrón todavía. Revisar `.stitch/designs/06-sala1-hechos-opiniones.png`+`.html` (y las otras 4 salas) para ver qué composición usan las tarjetas de estación / el modal — probablemente valga aplicar `.ficha` o un derivado al modal de estación (`#modal-estacion`), y a las tarjetas del dashboard.
3. **`docente.html`**: mismo trabajo — revisar si el panel docente tiene un patrón de Stitch que valga trasladar (no había una pantalla de Stitch específica para el panel docente entre las 11 descargadas, así que ahí el criterio es mantener consistencia con el lenguaje visual ya establecido en `index.html`/`juego.html`, no traducir una pantalla puntual).
4. Tras aplicar todo: **repetir la verificación de integración completa** (la que se hizo después de fe-visual+fe-wiring): `node --check` en los 10 JS, `xmllint --html` en los 3 HTML, llaves balanceadas en `styles.css`, grep de `demo`/`innerHTML`/`service_role` limpio, y confirmar que ningún ID de CONTRACT §6-8 se rompió.
5. **Mostrarle a Fernando el resultado antes de asumir que está bien** — este mismo checkpoint existe porque la vez anterior el harness dio por bueno un trabajo que el usuario, al verlo, no aceptó. No repetir ese error: pedir confirmación visual (describir o, si es posible, ofrecer capturar/mostrar) antes de dar la tarea de Stitch por cerrada.

### Todo lo anterior (backend Supabase, fix de demo.js, nómina API, fe-wiring del juego, migración a Render) sigue vigente tal como está documentado arriba en este archivo — este checkpoint es solo sobre el trabajo de estética de Stitch, que es lo único que quedó a medias.

### Estado de archivos en este momento (para orientarse rápido)
- `CONTRACT.md`: versión Supabase vigente (NO la de Render — esa vive en `_src/CONTRACT.render-target.md`, congelada hasta que se retome esa migración). §16.1/§16.3 recién actualizadas.
- `harness-agent.md`: nota de estado al inicio dice "trabajo activo es sobre Supabase + Stitch", sigue siendo correcta, no requiere cambio adicional en este checkpoint.
- Repo git: **sin commitear** todavía el bloque de trabajo de hoy completo (rename de título, restauración de CONTRACT, demo.js eliminado, fix de nómina, fe-visual, fe-wiring, fix de #estacion-pilar, y ahora el trabajo de ficha en curso). Esperar a que el punto 1-4 de arriba esté terminado y verificado antes de proponer el commit.

---

## 2026-08-25 — Continuación del checkpoint: `.ficha` aplicado a index.html completo + juego.html parcial

### `index.html` — completo
`#vista-registro`, `#vista-codigo` y `#vista-acceso` ahora usan `.ficha` (pestaña de carpeta + `campo--terminal` en el form). `#vista-registro` además con `.ficha__estampa` ("Nómina req."). Verificado balanceado (div 13/13 antes de tocar juego.html).

### `juego.html` — dos cambios, uno revertido a tiempo
1. **Corregidos los títulos/pilares de las 5 tarjetas del dashboard**, que tenían nombres genéricos ("La cadena del café", "Huellas y espejismos", "Voces invisibles") sin relación con las estaciones reales del caso. Confirmé con grep que `js/juego.js` **nunca** sobreescribe `.estacion-card__titulo`/`.estacion-card__pilar` — son estáticos para siempre, no placeholders — así que era un bug de contenido real, no cosmético. Ahora dicen Sala de Hechos / Sala Verde / Sala del Dinero / Sala de las Personas / Sala de la Verdad, con su pilar correcto.
2. **Intenté aplicar `.ficha`/`.ficha__pestana` al `.modal__panel` y lo revertí** al detectar un conflicto técnico real antes de dejarlo roto: `#modal-estacion > .modal__panel` tiene `overflow-y:auto` sin `overflow-x` explícito — por la spec de CSS, eso hace que `overflow-x` se compute como `auto` también, lo que recorta cualquier hijo posicionado fuera de la caja (como la pestaña, que sobresale con `top` negativo). En su lugar usé `<span class="badge badge--acento">Expediente_Sala</span>` en flujo normal, mismo lenguaje visual (mono, mayúsculas, acento), sin el riesgo de recorte.

### Lo que NO se hizo — decisión explícita, no fue un olvido
Las pantallas de Stitch para las salas (06-sala1 y análogas, 07-10) muestran un **diseño de tablero completo**: barra lateral con navegación entre salas + cronómetro + checklist de progreso, panel central de "evidencia recopilada" tipo tarjetas, columnas de clasificación (verde/amarillo/rojo), nota adhesiva del analista, botón de verificación — es una composición de página completa, no un modal. Replicar esto de verdad es un **rediseño de la interacción**, no un ajuste de estilo: cambiaría cómo se navega entre salas (de modal a panel persistente) y tocaría la lógica ya reparada de `juego.js`/`render.js`/`timer.js`. Dado el tamaño y el riesgo de tocar algo que la auditoría recién dejó funcionando, **no lo intenté sin decisión explícita** — se aplicó el mismo lenguaje visual (badges, tipografía mono, tokens) al modal existente, pero la composición de "tablero de evidencia" de Stitch 06-10 sigue pendiente si Fernando la quiere de verdad.

`docente.html` no tiene una pantalla específica de Stitch entre las 11 descargadas (no se diseñó un panel docente ahí), así que se mantiene con el lenguaje visual ya aplicado por `fe-visual` (tablas, badges, sello) sin una pantalla puntual que traducir.

### Verificación de integración final (los 3 HTML + CSS + 10 JS juntos)
- `index.html`/`juego.html`/`docente.html`: div balanceados (0 de diferencia en los 3), `section` 7/7 en juego.html, cero errores estructurales reales en `xmllint`.
- `styles.css`: 343/343 llaves.
- Los 10 archivos de `js/`: `node --check` OK en todos.

### Pendiente real para la próxima sesión (en orden de prioridad)
1. **Mostrarle esto a Fernando y preguntar si quiere el rediseño completo de "tablero de evidencia" para las salas** (Stitch 06-10) — es la pieza más grande que falta y cambia la interacción, no solo el estilo.
2. Prueba manual en navegador real (o Docker Postgres) del flujo completo — sigue sin hacerse, todo lo verificado hasta ahora es estático (sintaxis, balance) o con un stub de servidor.
3. Commit a git de todo el bloque de hoy (todavía sin hacer).

---

## 2026-08-26 — Rediseño completo del tablero de sala: hecho y verificado

Fernando eligió la opción de mayor riesgo/esfuerzo (rediseño completo tipo tablero, en vez de mantener el modal o el punto medio), a sabiendas de que tocaba `juego.js`/`render.js`/`timer.js` recién reparados. Se hizo con la misma disciplina que el resto del proyecto: contrato primero, respaldos antes de tocar nada, implementación, verificación real.

### Contrato actualizado primero
`CONTRACT.md` §7 reescrito completo (§7.1/§7.2): de modal a tablero persistente. Documentado el punto clave que bajó el riesgo real: `render.js`/`timer.js` reciben un contenedor por parámetro o solo necesitan que exista `#cronometro` — no les importa si viven dentro de un modal o de un panel fijo. Eso significó que casi todos los IDs de **contenido** de la estación sobrevivieron idénticos; solo cambió el contenedor (de diálogo modal a panel siempre visible) y la navegación (de "abrir modal" a "elegir en la barra lateral").

### Respaldos antes de tocar nada
`_src/juego.html.pre-tablero.bak`, `_src/juego.js.pre-tablero.bak`, `_src/styles.css.pre-tablero.bak` — por si hay que revertir.

### Cambios reales
- **`juego.html`**: `#pantalla-dashboard` pasó de grilla-de-tarjetas-que-abren-modal a `.tablero` (`#sidebar-salas` + `#panel-estacion`). `#sidebar-salas` absorbió lo que antes vivía en `#barra-superior` (equipo, cronómetro, progreso) más `#nav-salas` (las 5 `.estacion-card`, mismas clases de estado que antes). `#panel-estacion` reemplaza `#modal-estacion`: mismo contenido interno (`#estacion-narrativa`, `#estacion-datos`, `#estacion-reto`, `#estacion-interaccion`, `#estacion-feedback`, `#estacion-intentos`), pero ya no es un diálogo — sin `role="dialog"`, sin `#modal-backdrop`, sin `#btn-cerrar-modal`. Renombrado `#modal-estacion-titulo` → `#estacion-titulo` (ya no tiene sentido el prefijo "modal").
- **`js/juego.js`**: `abrirModal()`/`cerrarModal()` reemplazados por `seleccionarSala()` — sin foco atrapado, sin `inert`, sin backdrop, sin `body.is-modal-abierto`. Se mueve el foco a `#estacion-titulo` al seleccionar (equivalente de accesibilidad, sin el resto del aparataje de diálogo). Se eliminó `atraparFoco()` y el manejo de Esc (ya no aplica). Todo lo demás (pintado de contenido real, `verificarEstacion()`, código maestro) quedó intacto.
- **`js/timer.js`**: encontré y corregí una referencia viva a `#modal-estacion`/`#modal-backdrop` en `_dispararTiempoAgotado()` que fe-wiring no había tocado (no le tocaba, en ese momento el modal seguía existiendo). El bloqueo de inputs al agotarse el tiempo ahora apunta a `#panel-estacion` en vez del modal desaparecido — si no lo corregía, esa función habría dejado de bloquear nada al agotarse el tiempo.
- **`styles.css`**: nueva sección `.tablero`/`#sidebar-salas`/`#panel-estacion` (responsive: columna en mobile, fila desde 768px, sidebar `sticky`). Limpiadas ~15 referencias muertas a `#modal-estacion`/`#modal-backdrop`/`#barra-superior`/`#lista-estaciones` repartidas en capas, print, `prefers-reduced-motion`, focus-visible y el efecto "Double-Bezel" (que dependía de un `<li>` que ya no existe — se reprodujo el mismo anillo teñido por estado directo sobre `.estacion-card`, sin perder la señal visual).

### Verificación — no solo estática esta vez
Además de balance de HTML (0 en los 3 archivos), `xmllint` sin errores reales, `styles.css` con 325/325 llaves, y `node --check` 10/10: se armó un **smoke test funcional con jsdom**, cargando los módulos reales (`juego.js`, `render.js`, `timer.js`, `contenido.js`, `dataviz.js`) contra el `juego.html` real y un stub de API con el contenido **literal** de `sql/05-seed.sql` (Estación 1, "Sala de Hechos"). 18 aserciones, **todas pasaron**: dashboard visible, 5 salas con estado correcto, clic en Sala 1 pinta título/pilar/reto reales (no placeholder), foco se mueve a `#estacion-titulo`, `render.js` pinta "Cultivo" real, verificar funciona y muestra feedback, cronómetro corriendo con tiempo real (no el "50:00" estático), y Sala 5 bloqueada resiste el clic.

### Pendiente — honesto, no una omisión
- **Prueba visual real en navegador** (o al menos captura de pantalla): todo lo de arriba prueba que la lógica y el DOM son correctos, no que se vea bien. Sigue sin hacerse — es lo próximo si Fernando quiere confirmarlo antes de dar esto por cerrado del todo.
- **`docente.html`** no recibió ningún cambio de estructura en esta pasada — no tenía una pantalla de Stitch específica que traducir (ver entrada anterior).
- Commit a git de todo el bloque de trabajo (desde el rename de título hasta este rediseño): sigue sin hacerse, pendiente de que Fernando lo confirme.

---

## 2026-08-26 — App corriendo en Docker + prueba real en navegador (Playwright) + bug real encontrado y corregido

### Docker levantado
Limpiados contenedores viejos parados (`scaperoom`, `rlsreal`, `cc-pg`, `cafe-test`, sobrantes de auditorías anteriores). `docker compose up -d` — sirviendo en `http://localhost:8080`. Los 3 HTML y todos los `js/*.js` responden 200.

### Prueba con navegador real (Playwright + Chromium headless), no solo jsdom/stubs
Instalado vía `npx` en el scratchpad (no se tocó el proyecto). Se navegó la app real contra el Supabase real (no un stub) — y esto encontró un bug genuino que ningún test estático o con stubs había detectado.

### Bug real encontrado: el guard de sesión de `juego.html` nunca redirigía
`initJuego()` hacía `if (!sesion)` sobre el objeto que devuelve `Auth.sesion()` — pero esa función siempre devuelve un objeto `{datos, error}`, que **nunca es falsy en JS aunque `datos` sea `null`**. Resultado: sin sesión, `juego.html` igual llamaba a `Juego.miEquipo()` contra el Supabase real, que devolvía 404. `docente.js` no tenía este bug — ya desenvolvía `.datos` correctamente (`const datos = ses?.datos; if(!datos || !datos.access_token)`). Se corrigió `juego.js` con el mismo patrón.

**Por qué ningún test previo lo agarró:** tanto mi smoke test de jsdom como el de `fe-wiring` usaban un stub de `Auth.sesion()` que siempre devolvía una sesión válida — nunca ejercitaron el camino "sin sesión". Recién al probar contra el Supabase real, sin iniciar sesión, apareció. Es la razón de ser de probar con navegador real y credenciales reales en vez de solo stubs: los stubs prueban lo que vos programaste que probaran.

**Verificado el fix:** reiniciado el contenedor, repetida la prueba — `juego.html` y `docente.html` ahora redirigen limpio a `index.html#vista-portada`/`#vista-acceso` sin sesión, cero errores de consola o red.

### Capturas — el diseño de Stitch se ve como se esperaba
Portada (sello "Clasificado", badge reforzado, tipografía serif) y Registro (ficha con pestaña de carpeta "REG_INVESTIGADOR", input subrayado estilo terminal, etiqueta mono en mayúsculas, sello de esquina "NÓMINA REQ.") — verificado en desktop (1280px) y mobile (390px), sin scroll horizontal, sin errores de consola. Enviadas a Fernando.

### Lo que sigue sin probarse — requiere acción de Fernando
El flujo de registro/OTP real no se puede completar de forma autónoma: requiere un correo de la nómina real y acceso a esa bandeja para copiar el código o hacer clic en el enlace mágico. Eso es lo próximo si Fernando quiere ver el flujo completo (registro → código → dashboard real → resolver una sala → veredicto) en vivo.

---

## 2026-08-26 — Trabajo en paralelo: OpenCode retoma Render, Claude Code sigue con el frontend Stitch v2

Fernando aclaró que la decisión de migrar a Render sigue en pie — lo que se había pausado fue el ORDEN (aplicar antes los diseños de Stitch v2 sobre Supabase). Para no elegir entre las dos cosas, decidió correrlas en paralelo:

- **OpenCode** trabaja la migración a Render, aislado en `git worktree add ../Scaperoom-render -b feature/render-migration` (rama separada, carpeta separada) para no chocar con las ediciones en vivo de este agente sobre `index.html`/`juego.html`/`docente.html`/`styles.css`. Instrucciones completas en el prompt entregado a Fernando (`_src/CONTRACT.render-target.md` como spec, SQL ya auditado como base, mismo estándar de verificación con Postgres real).
- **Este agente (Claude Code)** sigue con el rediseño visual sobre la arquitectura Supabase actual, usando el segundo set de diseños de Stitch ("Forensic Audit Protocol" — grafito + esmeralda + esquinas rectas + tarjetas de evidencia color papel).

**Al terminar ambos, queda pendiente decidir cuál arquitectura se conserva** — no se decide sola. Cuando OpenCode reporte, hay que revisar su trabajo antes de mergear la rama.

### Estado del rediseño visual (en curso)
`styles.css` §tokens reescrito: paleta grafito `#131313`/esmeralda `#88d982`/documento papel `#f5f5dc`, radios a 0 (esquinas rectas — cambio deliberado, documentado en el propio archivo), tipografía título de serif a sans (mismo stack que cuerpo, diferenciado por peso, como el Hanken Grotesk del sistema original). Contrastes recalculados con la fórmula real de luminancia relativa, no estimados — todos ≥4.5:1 salvo el ya documentado `bloqueado` que solo se usa de forma no-textual. Falta: componentes (`.btn`, `.ficha`, `.sello`, `.exhibit` nuevo para tarjetas de evidencia), barra de progreso segmentada, y la verificación completa (balance HTML, contraste, jsdom) que se hizo la vez anterior.

---

## 2026-08-26 — Rediseño "Forensic Audit Protocol" (Stitch v2) — tokens y componentes base, verificado

Continuación del rediseño en paralelo con la migración a Render que ahora hace OpenCode (ver entrada anterior).

### Cambios aplicados
- **Paleta**: grafito `#131313`/`#1e1e1e` (antes `#0f1410` ámbar), acento verde esmeralda `#88d982` (antes ámbar `#d99a2b` — la misma familia de verde sirve para "éxito", igual que en el sistema original, que no distingue primary de success). Contrastes recalculados con la fórmula real de luminancia relativa (no estimados): todos ≥4.5:1, documentado en el header de `styles.css`.
- **Radios a 0** — esquinas rectas en todo: botones, tarjetas, sellos, fichas. Cambio deliberado del sistema ("Shape: Sharp"), no un olvido.
- **Tipografía título**: de serif a sans (mismo stack que el cuerpo, diferenciado por peso 800/700) — así es como el sistema original usa una sola familia (Hanken Grotesk) para todo, variando el peso.
- **Botones reescritos**: de pill+relleno sólido+insignia circular a grafito con borde y texto esmeralda, mayúsculas mono — sin relleno sólido de color (`#2e7d32` con texto encima no llega a 4.5:1, quedó documentado para que nadie lo use así sin querer).
- **Componente nuevo `.exhibit`**: tarjeta de evidencia color papel (`#f5f5dc`/`#121212`), reemplaza el hook `.ficha-dato` que `fe-visual` había dejado sin conectar la vez anterior. **Esta vez sí está conectado**: `pintarDatosEstacion()` en `js/juego.js` arma una tarjeta por dato real del expediente, no un `<dl>` plano.
- Barra de progreso segmentada (5 tramos, vía `::after` con gradiente repetido) — puramente visual, cero cambio de JS.

### Bug propio encontrado y corregido en el camino
Al reescribir `pintarDatosEstacion()` dejé una línea huérfana (`contenedor.appendChild(dl)` con `dl` ya no declarado) que habría tirado un `ReferenceError` en el navegador. Lo encontré releyendo el archivo antes de dar el cambio por bueno, no con una herramienta — recordatorio de por qué la relectura importa incluso en cambios que "solo" tocan una función.

### Verificado
`styles.css` 330/330 llaves, los 3 HTML balanceados (0 de diferencia), los 10 JS con `node --check` limpio, y un smoke test funcional con jsdom (8/8 aserciones): dashboard, selección de sala, y sobre todo — **las tarjetas `.exhibit` aparecen con el contenido real** de `sql/05-seed.sql` (huella hídrica 11,113 m³, huella verde 85–90%), no con texto de relleno.

### Pendiente de esta pasada
- Prueba visual real en navegador (Docker + Playwright) — todo lo de arriba es DOM/CSS correcto verificado, no necesariamente "se ve bien". Es el mismo paso que se hizo la vez anterior con capturas — falta repetirlo con esta paleta.
- Aplicar el mismo lenguaje visual a `docente.html` (6 pantallas de Stitch v2 alineadas funcionalmente, revisadas, pendiente de traducir el CSS/estructura).
- Sala 5: las frases de ejemplo del veredicto de Stitch v2 son distintas a las 5 reales del caso — ya sabíamos que el contenido real gana, solo falta confirmar que `sql/05-seed.sql` (que no se tocó) sigue siendo la fuente, no hace falta ningún cambio ahí.

---

## 2026-08-26 — Ola 0: pivote de arquitectura — CONTRACT.md y harness-agent.md reescritos completos

Fernando cerró de una vez la decisión que `progress.md` había dejado pendiente ("Al terminar ambos [Supabase-Stitch y render-migration], queda pendiente decidir cuál arquitectura se conserva") y sumó tres decisiones más en el mismo pedido. Este harness reescribió `CONTRACT.md` y `harness-agent.md` por completo para reflejar las cinco:

1. **Supabase retirado, sin excepción.** Gana la arquitectura Render/Node/Postgres que `_src/CONTRACT.render-target.md` describía como destino y que **ya está construida y verificada contra Postgres real** en la rama `render-migration` (worktree `../Scaperoom-render`, commit `7e96262`): `sql/00`…`06` (incluye `06-superadmin.sql`, ya con `app.es_super_admin()` para `fglopez@monicaherrera.edu.sv`), `srv/{index,db,email}.js` + `srv/rutas/{auth,juego,docente}.js` + `srv/middleware/sesion.js`, `package.json`, `render.yaml`. Nada de esto se tocó todavía en este harness — solo se leyó para que el contrato nuevo describa con precisión lo que ya existe, no una reconstrucción hipotética.
2. **Dos modalidades obligatorias, mismo código:** local (Docker Compose — vuelve, pero para levantar Node+Postgres, no nginx como en la era Supabase) y online (Render, tal cual ya está en `render-migration`). `CONTRACT.md` §6–§7.
3. **Frontend literal de Stitch.** Se revierte la regla histórica §16.1 (que prohibía Tailwind/Google Fonts/CDN y exigía traducir cada pantalla a mano en `styles.css`) — ahora es la regla opuesta: se usa el HTML/Tailwind/fuentes/imágenes que exporta Stitch tal cual, adaptado solo con los IDs del contrato. `CONTRACT.md` §8.
4. **Tope de 15 pantallas Stitch para toda la app**, pedido mid-turno por Fernando. `designs-v2/` tenía 16 pantallas reales (sin contar `11-design-system.json`, que no es pantalla); se armó una lista canónica de 15 retirando las 4 pantallas de estación individuales (`01`, `03`, `09`, `12`) de la cuenta de "pantallas navegables" — pasan a ser referencia de layout para los 4 tipos de interacción dentro del tablero único (pantalla 6), no pantallas propias — y dejando un "monitoreo" docente (pantalla 12 de la lista) sin generación de Stitch todavía si hiciera falta usar la última pieza del presupuesto. `CONTRACT.md` §9.
5. **Apuntador o apuntadora por equipo**, pedido mid-turno: el docente arma equipos y designa quién de los tres envía respuestas; los otros dos inician sesión y ven todo pero no pueden enviar. Diseñado de punta a punta: columna `integrantes.es_apuntador` + índice único parcial (a lo sumo uno por equipo), chequeo nuevo en `verificar_estacion`/`verificar_maestro` (`no_apuntador`/`sin_apuntador`), función `marcar_apuntador()` sin `SECURITY DEFINER` (corre con el RLS del docente, un estudiante no puede autodesignarse), ruta `POST /api/docente/equipos/:id/apuntador`, y en el cliente: `#aviso-solo-apuntador` + controles deshabilitados para quien no apunta (cortesía de UX; la autoridad real es el rechazo del servidor), `#control-apuntador`/`#aviso-sin-apuntador` en el panel docente. `CONTRACT.md` §2.2, §4.1, §4.2, §11, §12, §16.6.

### Qué NO se tocó en esta ola
Nada de código — ni `main` ni la rama `render-migration`. Es trabajo puro de contrato (Ola 0, harness). `frontend-agent.md`/`backend-agent.md`/`content-agent.md`/`qa-agent.md` en la raíz **siguen describiendo una iteración muy anterior** del proyecto (4 salas, "El Cuarto de la Reputación", sin backend real) y quedaron marcados como desactualizados en `harness-agent.md` §3 — no se reescribieron todavía porque no era parte de este pedido, pero cualquiera que los use como briefing debe releerlos contra `CONTRACT.md` primero.

### Siguiente (Ola 1, no arrancada — requiere decisión/confirmación antes de tocar git)
Fusionar `render-migration` a `main`. Punto de fricción esperado: `main` avanzó en paralelo con el rediseño visual Stitch v2 (tokens `.ficha`/`.exhibit`, grafito/esmeralda) sobre el HTML/CSS de la era Supabase — ese trabajo visual se descarta en la fusión (la Ola 4 de `harness-agent.md` reconstruye el frontend desde cero sobre markup literal de Stitch), así que el conflicto de fondo es simple de resolver en una dirección, pero hay que hacerlo con `git merge`/`git diff` reales, no asumido.

---

## 2026-08-26 — Sesión en vivo: `main` ya tenía frontend Stitch literal + backend Node construidos en paralelo por Fernando; probado en Docker real, encontrados y corregidos 5 bugs reales

Fernando pidió lanzar la app en Docker para probar el frontend en el que había avanzado. Al revisar `main` (no la rama `render-migration`), resultó que **ya existía, hecho en paralelo mientras el harness escribía el contrato**, casi todo lo que `CONTRACT.md` pedía: `index.html`/`juego.html` reescritos con markup Tailwind **literal** de Stitch (paleta "Forensic Audit Protocol"), `srv/{index,db,email}.js` + `srv/rutas/{auth,juego,docente}.js` en Node/Express ya con la lógica de **apuntador** (`marcar_apuntador`, chequeo `no_apuntador`/`sin_apuntador` en `/api/juego/verificar`), `docker-compose.yml`/`Dockerfile` nuevos (Node + Postgres, `app_runtime` como usuario del contenedor), y `sql/04-docentes.sql`/`05-seed.sql` ya adaptados (mencionan `crear_o_recuperar_perfil()`, orden `00→06`). Lo que faltaba: `sql/01-esquema.sql`/`02-rls.sql`/`03-funciones.sql` seguían siendo la versión Supabase vieja (`auth.users`), y el propio frontend tenía bugs de cableado nunca probados en navegador real.

### Bug 1 — `index.html`: `mostrarVista()` no aplicaba `.active`
El CSS inline de `index.html` usa `.view-state{display:none} .view-state.active{display:flex}`, pero `js/auth.js`'s `mostrarVista()` solo tocaba `hidden`/`.is-oculta`, nunca `.active` — cualquier navegación fuera de la portada (Registro/Código/Acceso) quedaba en negro. **Fernando lo corrigió él mismo en paralelo** mientras yo lo diagnosticaba (mismo archivo, mismo minuto) — solo hizo falta reconstruir el contenedor Docker para que tomara el cambio (no había volumen montado, `Dockerfile` copia en build).

### Reconstrucción de `sql/01-esquema.sql` / `02-rls.sql` / `03-funciones.sql`
Escritos desde cero para la arquitectura Render (sin Supabase), verificados contra el Postgres real del `docker-compose.yml` de `main` (no un stub). Ajustes reales encontrados al correrlos, no al leerlos:
- **Bug 2 — índice único con subconsulta:** `integrantes_una_por_sesion` intentaba `unique index … (perfil_id, (select sesion_id from equipos where id=equipo_id))` — Postgres no permite subconsultas en expresiones de índice. Corregido con el patrón ya documentado en la era Supabase: columna `integrantes.sesion_id` desnormalizada + trigger `BEFORE INSERT/UPDATE` que la rellena desde `equipos`, más FK compuesta `(equipo_id, sesion_id) references equipos(id, sesion_id)`. `CONTRACT.md` §2.2 estaba escrito con el mismo bug — corregido ahí también.
- `obtener_perfil_por_token()` (SECURITY DEFINER) agregada porque `srv/middleware/sesion.js` hacía `SELECT … FROM perfiles WHERE id=$1` **directo**, sin pasar por `conSesion()` — con RLS activo (`select solo el propio`, exige `app.usuario_actual()`) esa consulta siempre habría devuelto 0 filas y roto el login de todo el mundo aunque la cookie fuera válida. Corregido también `srv/middleware/sesion.js` para usar el helper.
- Helpers `security definer` (`es_docente`, `es_docente_de`, `es_docente_del_equipo`, `es_docente_del_perfil`, `tengo_equipo_en`) para que las políticas de RLS no recursen sobre sí mismas.

### Verificación real contra Postgres (no un stub), con curl end-to-end
Registrado un docente (`fglopez@monicaherrera.edu.sv`), creada una sesión de clase, cargados 2 estudiantes en nómina, registrados los dos, asignados a un equipo, marcado uno como apuntador. Confirmado con casos **positivos y negativos**: el no-apuntador (`est2`) llamando `POST /api/juego/verificar` recibe `{"error":"no_apuntador","apuntador":"Estudiante Uno"}` y no se inserta nada en `intentos`/`progreso`; el apuntador (`est1`) con la respuesta correcta de la Estación 1 recibe `{"ok":true,"codigo":"06-VC",...}` con el feedback real del caso.

### Bug 3, 4, 5 — encontrados recién al mirar el navegador real, no con curl
Con Chrome headed (Playwright, visible en pantalla a pedido de Fernando) navegando el flujo real (Registrarme → código del log del contenedor → `juego.html`):
- **Bug 3:** `#aviso-conexion` y `#aviso-solo-apuntador` en `juego.html` tenían `display:flex` incondicional en el `<style>` inline de la página, sin regla `[hidden]{display:none}` — el banner "Sin conexión" se mostraba siempre, aunque la conexión funcionara perfecto. `styles.css` sí tenía el guard correcto, pero **`juego.html` no importa `styles.css`** (es Tailwind+estilo propio, por diseño de la nueva arquitectura) — el guard vivía en el archivo equivocado. Agregado el guard directo en el `<style>` de `juego.html`.
- **Bug 4:** `#pantalla-veredicto` y `#pantalla-resumen` no tenían `hidden` en el HTML inicial, y ninguna función de `js/juego.js` las ocultaba nunca — se veían **siempre superpuestas** al tablero, desde el primer render. Agregado `hidden` inicial + un helper único `ocultarPantallasSuperiores()` que ahora usan `mostrarSinEquipo`/`mostrarBienvenida`/`mostrarDashboard`/el éxito de `verificarCodigoMaestro` para que las 5 pantallas de nivel superior sean mutuamente excluyentes de verdad.
- **Bug 5, el más importante:** el tablero mostraba **"0 / 5" y "Pendiente" en la Sala 1 aunque la base ya tenía esa estación resuelta** (confirmado con `select * from progreso` antes de sospechar del frontend). Causa: mi `estado_juego()` devolvía la clave `"progreso"`, pero `js/juego.js`'s `pintarEstadoDesdeDatos()` lee `datos.estaciones` — nombre distinto, nunca documentado con precisión en ningún contrato anterior. Corregido en el SQL (no en el JS, que ya estaba probado): la función ahora devuelve `estaciones` con `codigo` revelado solo si `estado='resuelta'` (lo que exigió volver `estado_juego()` `SECURITY DEFINER`, con su propio chequeo explícito de membresía/docencia porque al ser DEFINER ya no hereda gratis la restricción de RLS sobre `equipos`), más `servidor_en` para que `timer.js` calcule el *skew* real en vez de asumirlo en cero.

Repetida la prueba en el navegador tras cada fix: banner de conexión oculto, veredicto/resumen ocultos, `"1 / 5"` y `"✓ Resuelta"` en la Sala 1, cronómetro corriendo con el tiempo real del servidor, fragmento `06-VC` revelado en la barra inferior, y el panel de la Sala 1 pintado con el contenido real del expediente (narrativa, datos, nota auditora — no *placeholders*). Capturas enviadas a Fernando.

### Estado al cerrar esta sesión
- `sql/01-esquema.sql`, `02-rls.sql`, `03-funciones.sql` reescritos y verificados contra Postgres real (Docker local). `04-docentes.sql`/`05-seed.sql` no se tocaron — ya estaban bien.
- `srv/middleware/sesion.js`, `js/juego.js`, `juego.html` con los fixes de arriba.
- `CONTRACT.md` §2.2 corregido para que el esquema documentado coincida con el que realmente corre.
- Contenedor `app` devuelto a modo online (Resend real) al cerrar — durante la sesión se usó `RESEND_API_KEY=` (modo local/log) para poder leer los OTP de estudiantes de prueba sin depender del límite de Resend en modo test (que solo entrega al correo verificado del dueño de la cuenta).
- **Sin commitear.** `sql/00-roles.sql` y `sql/06-superadmin.sql` (rol `app_runtime` separado del dueño, acceso de auditoría de `fglopez@…`) siguen sin existir en `main` — localmente `app_runtime` es también el dueño de las tablas (lo crea el propio `docker-compose.yml`), así que `FORCE ROW LEVEL SECURITY` no se puede probar de verdad en esta modalidad todavía; para Render sí hace falta el rol separado.
- No se auditó `docente.html` con el mismo detalle (se revisó que no tiene el mismo patrón de bug de `display` incondicional, pero no se probó su flujo completo en navegador con datos reales).
- Las nóminas reales (`Listado-Sección E.xlsx`, `Listado-Sección F.xlsx`) están en la raíz del repo, listas para cargar cuando se pruebe el flujo de nómina del panel docente — no usadas todavía en esta sesión.

---

## 2026-08-26 — Acceso super-admin real para fglopez + bug fundamental de RLS local encontrado y corregido

Fernando pidió configurar `fglopez@monicaherrera.edu.sv` como admin con acceso a toda la plataforma. `sql/06-superadmin.sql` (política RLS adicional `es_super_admin()`) ya estaba diseñado en `CONTRACT.md` §3.3 desde la Ola 0 — faltaba construirlo para `main` y, sobre todo, **probarlo con un segundo docente real**, algo que nunca se había hecho.

### El hallazgo grande: `app_runtime` era superusuario en Docker local — RLS nunca se aplicó a nadie
Al simular un "Docente B" y comparar qué ve cada quien, **Docente B veía la sesión de fglopez además de la suya** — no debía. Causa raíz: `docker-compose.yml` ponía `POSTGRES_USER=app_runtime` en el contenedor de Postgres, lo que Postgres convierte automáticamente en **superusuario y dueño de todo** — un superusuario nunca está sujeto a RLS, ni con `FORCE ROW LEVEL SECURITY` (es una propiedad del rol). En la práctica, **ningún docente estaba realmente aislado del resto en la modalidad local** desde que se reconstruyó el backend — la Estación 5, `verificar_estacion`, etc. seguían protegidos porque esos son chequeos explícitos en la función, pero cualquier `SELECT` directo sobre `sesiones`/`equipos`/`nomina`/`integrantes` no tenía ninguna restricción real.

**Corregido de raíz, no parchado:**
- `docker-compose.yml`: el contenedor de Postgres ahora arranca con `postgres_admin` (superusuario real, solo para migraciones a mano). `sql/00-roles.sql` (nuevo) crea `app_runtime` como rol de login **sin superusuario, sin ser dueño de nada** — recién ahí `DATABASE_URL_APP` (con quien corre el proceso Express) queda genuinamente restringido.
- Reset completo del volumen de Postgres (`docker compose down -v`) y las 7 migraciones (`00`→`06`, incluido `06-superadmin.sql` nuevo) corridas de cero como `postgres_admin`.
- **Efecto colateral que este bug enmascaraba:** `srv/rutas/auth.js` en `/api/auth/verificar` hacía un `SELECT … FROM perfiles` fuera de `conSesion()` (sin `app.usuario_actual()` seteado) que "funcionaba" solo porque RLS estaba anulado por el superusuario. Al corregir el rol, el login se rompió con `{"error":"no_se_pudo_crear_perfil"}` — corregido usando `(crear_o_recuperar_perfil($1)).*` (el composite que la función ya devuelve) en vez de un segundo SELECT plano contra una tabla con RLS real.

### Verificación — positiva y negativa, por SQL directo y por HTTP real
Con `set_config('app.usuario_actual', …)` simulando identidades: Docente B (sintético, `docenteb@test.com`) ve exactamente 1 sesión (la suya); fglopez ve esa misma sesión aunque no es suya. Repetido **end-to-end por HTTP real** (registro → OTP del log → verificar → cookie → `GET /api/docente/sesiones`): mismo resultado, confirmado también visualmente en Chrome real (`#consola-super-admin` visible, `docente.html` mostrando "Sección de Docente B" con la sesión de otro docente en la lista).

### Resend real, a pedido de Fernando
Se dejó de usar el override `RESEND_API_KEY=` (modo log) salvo durante las pruebas puntuales de arriba; el contenedor quedó en modo online real. Se agregó `f.lopez.ideas@gmail.com` a `docentes_autorizados` (cuenta personal de Fernando, útil para seguir probando) y se disparó un envío real — Resend lo aceptó y lo entregó (log: `[email] OTP enviado a f.lopez.ideas@gmail.com`, sin el error de sandbox). **Nota para quien retome esto:** Resend en modo de prueba (sin dominio verificado) solo entrega a la dirección dueña de la cuenta (`f.lopez.ideas@gmail.com`) — enviar a `fglopez@monicaherrera.edu.sv` u otra dirección real sigue devolviendo el error de validación hasta que se verifique un dominio en resend.com/domains.

### Estado / pendiente
- `sql/00-roles.sql` y `sql/06-superadmin.sql` nuevos en `main`, sin commitear junto con el resto de esta sesión.
- Datos de prueba en la base local: perfil `docenteb@test.com` + su sesión "Sección de Docente B" — son *fixtures* de desarrollo, no datos reales; se pueden borrar en cualquier momento (`docker compose down -v` los elimina junto con todo lo demás).
- `#consola-contenido` (el cuadro bajo "Consola de control / super-admin" en `docente.html`) sigue vacío — la lista de sesiones de arriba ya cumple la función (fglopez ve todo ahí), así que no bloqueó nada, pero si se quiere un resumen dedicado ahí, falta escribirlo en `js/docente.js`.

---

## 2026-08-26 — Equipo de prueba real (María/Orlando/Renata) + 2 bugs más encontrados probando con datos reales

Fernando pidió armar un equipo real de prueba (3 estudiantes, `@test1.edu.sv`, sesión "Sección E", Renata como apuntadora) para ver el comportamiento real de un equipo. Se subió todo por la API real (no inserts directos): sesión "Sección E" creada y abierta, nómina cargada, los 3 registrados con su propio código OTP (modo local — `test1.edu.sv` no es un dominio real y Resend en sandbox solo entrega a la cuenta verificada de Fernando, así que no había forma de que un correo real les llegara), equipo "Equipo E1" armado, Renata marcada apuntadora vía `POST /api/docente/equipos/:id/apuntador`.

### Bug — cada estudiante se veía solo a sí mismo en la lista de integrantes
`mi_equipo()` no era `SECURITY DEFINER`; el JOIN `integrantes→perfiles` perdía a los compañeros porque la política de `perfiles` solo permite ver la fila propia (o la de un docente). María, con la función vieja, veía un array de 1 solo integrante (ella misma) en vez de los 3. Corregido: `mi_equipo()` ahora es `SECURITY DEFINER` (la primera consulta ya limita todo a MI equipo, así que el bypass de RLS de ahí en más no puede filtrar a nadie de otro equipo). Verificado por HTTP real: María ahora ve a María/Orlando/Renata, con Renata marcada `es_apuntador:true`.

### Bug — panel "Sesiones" del docente ilegible, sin indicar cuál está seleccionada
Fernando reportó "algo no está funcionando bien" en el administrador de sesiones. Probado en Chrome real: crear/abrir/cerrar sesión **sí funcionaba** (el estado cambiaba correctamente), pero la lista de sesiones (`#lista-sesiones`) se veía como texto plano sin ningún borde ni resalte — imposible saber a simple vista cuál sesión controlaban los botones "Abrir"/"Cerrar" de abajo. Causa: `js/docente.js` seguía usando `btn.className='btn btn--ghost'`, clases del viejo `styles.css` (era Supabase) que `docente.html` ya no importa (es Tailwind literal de Stitch, CONTRACT §8) — esas clases no existían para el navegador, cero estilo aplicado. El código sí seteaba `aria-pressed` correctamente, pero no había ningún CSS que lo leyera. Corregido con clases Tailwind reales, incluida la variante `aria-pressed:` (soportada nativamente por Tailwind) para resaltar la sesión activa con borde y fondo verde — confirmado visualmente. Mismo fix aplicado al botón "Asignar →" de `#lista-registrados`, que tenía el mismo problema.

### Estado
Datos de prueba reales en la base local: sesión "Sección E" con equipo "Equipo E1" (María, Orlando, Renata — apuntadora Renata). Sin commitear, junto con el resto.

### Bug — "no se pueden cerrar las sesiones, el error se ve y se cierra solo"
Reportado por Fernando después del fix anterior. Probado con Chrome real y automatización: crear/abrir/cerrar sesión **sí funcionaban** de fondo (confirmado con 5 sesiones distintas, cero errores HTTP) — el problema era la UX del error, no la lógica. Causa: `js/docente.js` usa `alert()`/`confirm()` del navegador en cascada — un `confirm()` seguido casi inmediatamente por un `alert()` (el flujo exacto de "cerrar sesión") puede hacer que Chrome descarte el segundo diálogo (protección anti-spam de diálogos nativos del navegador), así que un error real podía "aparecer y cerrarse solo" sin que hubiera forma de leerlo.

**Corregido:** nuevo `#docente-mensaje` (banner persistente en la página, `role="alert"`, con auto-ocultado a los 8s — tiempo de sobra para leerlo, no depende de ningún timing de diálogos) reemplaza los `alert()` de crear/abrir/cerrar sesión. De paso, `abrirSesion()`/`cerrarSesion()` ahora refrescan `#lista-sesiones` después de la acción (antes el estado del badge global se actualizaba pero la fila de la lista se quedaba con el texto viejo hasta el próximo refresh manual), y se repuso `aria-pressed` en cada reconstrucción de la lista para que el resaltado de "cuál está seleccionada" (fix anterior) no desaparezca al refrescar. Verificado en Chrome real: cerrar "Sección E" (con el equipo de prueba adentro) muestra "Sesión cerrada." de forma clara y persistente, el badge y la fila coinciden, el mensaje se autolimpia a los 8s sin quedar pegado. **Nota:** el resto de los `alert()` de `docente.js` (nómina, equipos, calificaciones, etc.) no se tocaron — mismo riesgo teórico, pero fuera del reporte puntual de hoy.

`sql/03-funciones.sql` — `mi_equipo()` reescrita para `SECURITY DEFINER` (bug de compañeros de equipo invisibles). `docker-compose.yml` con el fix de rol admin/`app_runtime`. Sesión "Sección E" quedó reabierta después de las pruebas para no dejar el equipo de María/Orlando/Renata bloqueado.
