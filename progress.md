# progress.md — Bitácora del harness

Proyecto: **El Código del Café** — escape room de auditoría de sostenibilidad.
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
