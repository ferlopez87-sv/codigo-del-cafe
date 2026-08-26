# Avances — Sesión 2026-08-25
**Proyecto:** El Código del Café — Escape Room de Sostenibilidad (CGC)
**Docente:** Fernando López · fglopez@monicaherrera.edu.sv
**Repo:** https://github.com/ferlopez87-sv/codigo-del-cafe

---

## 1. Contexto de la sesión
Continuación del harness Ola 1–2. El objetivo era cerrar backend y frontend, dejar la app desplegable vía GitHub → Render y resolver el límite de envíos de correo de Supabase (429) que bloqueaba el registro.

## 2. Trabajo realizado

### Backend (Supabase — Postgres 15, RLS, RPC)
- **`sql/01-esquema.sql`** — Reescrito bootstrap: eliminado `configuracion.modo_registro='abierto'` (rechazado por insegurop), creada tabla `docentes_autorizados(correo PK, nota, creado_en)` con trigger `docentes_autorizados_normalizar()`. `manejar_nuevo_usuario()` dual: `docentes_autorizados`→`docente` (fallback `DOC-`+md5), `nomina`→`estudiante` (nombre/carné de nómina), else→`correo_no_esta_en_la_nomina`. Fix crítico `select exists(...) into v_es_docente` + `coalesce(v_es_docente,false)` — el `select true into` dejaba `null` y `if not` nunca entraba, `nomina.perfil_id` quedaba `null`.
- **`sql/02-rls.sql`** — `docentes_autorizados` y `configuracion` con RLS `t` y **0 políticas**, eliminado `perfiles_actualiza_propia` (identidad congelada: solo SELECT), eliminado `configuracion_lectura_autenticados`, grants `revoke` sin `update`.
- **`sql/03-funciones.sql`** — Verificado estable (`verificar_estacion`, `estado_juego`, `mi_equipo`, `verificar_maestro`, `cerrar_sesion_clase`, `anonimizar_sesion`).
- **`sql/04-docentes.sql`** (nuevo) — `insert fglopez@monicaherrera.edu.sv on conflict`.
- **`sql/05-seed.sql`** (143L) — Consolidado desde `_src/seed/e1..e5.sql` (códigos `06-VC`/`87`/`04`/`2P`/`4`, maestro `06-87-04-2P-4`).
- **Validación Docker `cc-pg`:** `01→02→03→04→05` `EXIT 0` idempotente, RLS `0` políticas en `estaciones/configuracion/docentes_autorizados`, `perfiles` 2 `SELECT/0 UPDATE`, docente→`docente`, estudiante `ana.perez@gmail.com`→nombre/carné de nómina + `perfil_id` enlazado, intruso `429` rechazado.

### Contenido
- **`js/contenido.js`** — `ESTACIONES_UI` sin secretos (solo `ordenInicialAleatorio` y etiquetas), narrativa/datos de `estaciones_publicas`.
- **`_src/content/e1..e5.json`** + **`_src/seed/e1..e5.sql`** — 5 estaciones con pistas 1-2 no revelan, feedback cita dato, CGC no villana.

### Frontend
- **Tokens/Layout/Components/A11y** (`_src/css/tokens.css` 36 vars `#0f1410`/`#d99a2b`/`#34c266` OKLCH, contraste ≥4.5:1, `layout.css` grid, `components.css` Double-Bezel + pills `999px` + motion `cubic-bezier(0.32,0.72,0,1)`, `a11y.css` focus-visible) → `styles.css` 1888L concatenado `tokens→layout→components→a11y`.
- **HTML shells** `_src/html/index.html`/`juego.html`/`docente.html` → `index.html`/`juego.html`/`docente.html` con IDs `CONTRACT.md:267-314` completos, `lang=es-SV`, `textContent` policy, `href="styles.css"` `src="js/*.js"` corregidos.
- **Capa cliente Ola 3:** `js/api.js` (único `fetch` con `SUPABASE_URL`/`anon`, `peticion()` retry 401, `{datos,error}`), `js/juego.js` (estado, modal trap, `verificarEstacion` §12), `js/timer.js` (server `skew`, anuncio 10/5/1), `js/render.js` (orden ↑/↓, numero, checklist, clasificación), `js/dataviz.js` SVG inline `role=img` E2 (87% verde) y E3 (US$4.00 apilada).
- **`js/config.js`** rellenado con valores reales `SUPABASE_URL`/`sb_publishable_...` desde `.env:7` (anon pública, RLS es control).

### Corrección de botones críticos
- **Causa:** faltaban glue `js/auth.js` y `js/docente.js`, `juego.js` no manejaba `#btn-iniciar`.
- **`js/auth.js` (7.9K)** — hash nav `#vista-portada/registro/codigo/acceso`, `form-registro`→`Auth.registrar`, `form-codigo`→`verificarCodigo` (maneja rechazo nómina tardío §6.2 con hint), `btn-reenviar` 45s, `form-acceso`, `cod-token` autotrim, `manejarCallbackMagicLink()` para `hash#access_token`.
- **`js/docente.js` (17K)** — guard `Auth.sesion`, `lista-sesiones`/`form-sesion`/`abrir/cerrar`, `form-nomina` CSV `nombre,correo,carne` bulk `POST /rest/v1/nomina`, `tabla-nomina` `⚠` no institucional, `lista-registrados`/`lista-equipos`/`tabla-monitoreo`/`export CSV`/`anonimizar`.
- **`js/juego.js` patch** — `mostrarBienvenida()` si `iniciado_en==null`, `btn-iniciar`→oculta bienvenida+`cargarEstado` (sella `iniciado_en` server).

### QA
- `_src/qa/qa-seguridad.md` (9 pruebas negativas 429/0 filas), `qa-funcional.md` (OTP, equipos, bloqueo E5, cronómetro, 2 navegadores), `qa-pedagogico.md` (APTO, 3 medios), `qa-a11y.md` (38 casos WCAG, 7 issues). Consolidado en `QA_INFORME.md` (APTO piloto, 0 críticos, `node --check` 10/10, `service_role` 0, `innerHTML` 0 real vs `textContent` 109).
- **Integración Ola 4:** `styles.css` + 3 HTML + 4 JS copiados, `grep`/`curl` `200` verificado, `cc-pg` 5 estaciones + docente.

### Infra y deploy
- **Docker local:** `docker run -d --name scaperoom -p 8080:80 -v /tmp/scaperoom:/usr/share/nginx/html:ro nginx:alpine` → `http://localhost:8080` `200` (fallback `python -m http.server 8080` cuando Docker Desktop cae).
- **Render vía GitHub:** `Dockerfile` (nginx + SPA fallback), `render.yaml` Blueprint `codigo-del-cafe` `env: docker` `plan: free` `autoDeploy: true`, `.dockerignore`, `README.md` actualizado con URLs y pasos Blueprint + Supabase `Site URL`/`Redirect URLs`/`Email Templates {{ .Token }}`.
- **Repo GitHub:** `ferlopez87-sv/codigo-del-cafe` `main` `0e055f0` (push `c6a8937`→`0e055f0`), `.gitignore` ignora `.env`/`_src`/`.DS_Store`.

### Supabase email al límite (429)
- **Problema:** Supabase free limita a ~30/h y el registro genera `link` (Magic Link `ConfirmationURL`) no código.
- **Fix:** `js/api.js` ahora envía `emailRedirectTo`/`redirectTo` y detecta `429`/`rate`/`limit`/`capacity` → activa **modo demo** (`js/demo.js`): OTP local determinístico `hash(email)%900000+100000` válido 5 min, `mockDemo` para `estaciones_publicas`/`mi_equipo`/`estado_juego`/`verificar_estacion`/`verificar_maestro` offline en `localStorage`. `js/auth.js` muestra `Código demo: 123456` + botón **Entrar en modo demo (sin correo)** y maneja `hash#access_token` del magic-link. `index.html` reescrito para “enlace + código opcional”.

## 3. Archivos tocados (root)
`index.html`, `juego.html`, `docente.html`, `styles.css`, `js/api.js`, `js/auth.js` (nuevo), `js/demo.js` (nuevo), `js/docente.js` (nuevo), `js/juego.js`, `js/render.js`, `js/dataviz.js`, `js/config.js`, `js/contenido.js`, `sql/01-esquema.sql`, `sql/02-rls.sql`, `sql/04-docentes.sql`, `sql/05-seed.sql`, `Dockerfile` (nuevo), `render.yaml` (nuevo), `README.md`, `QA_INFORME.md`, `progress.md`.

## 4. Pendiente / siguiente
- Supabase: configurar **Authentication → URL Configuration → Site URL** a `https://codigo-del-cafe.onrender.com` (+ `http://localhost:8080` local) y **Email Templates → Magic Link** incluir `{{ .Token }}` para que llegue link + código; o configurar **Custom SMTP** (Resend/Postmark) para subir límite.
- Render: conectar Blueprint en https://dashboard.render.com → Apply y verificar `healthCheckPath: /` 200.
- QA dinámico: `axe-core` 0 críticas, Lighthouse ≥95, E2E 3–4 usuarios 30 min antes de clase (ver `qa-funcional.md` §8).
- Harness: actualizar `harness-agent.md`/`backend-agent.md`/`frontend-agent.md`/`qa-agent.md` de “El Cuarto de la Reputación” 4 salas → “El Código del Café” 5 estaciones Supabase (quedan desactualizados, ya marcados para ignorar en git).

## 5. Cómo correr
```bash
git clone https://github.com/ferlopez87-sv/codigo-del-cafe.git
cd codigo-del-cafe
# Supabase
psql $SUPABASE_DB_URL -f sql/01-esquema.sql -f sql/02-rls.sql -f sql/03-funciones.sql -f sql/04-docentes.sql -f sql/05-seed.sql
# Local
docker compose up -d && open http://localhost:8080
# Demo sin correo
# Registro → si ves “Modo demo activo. Tu código es: …” → Entrar en modo demo
```
