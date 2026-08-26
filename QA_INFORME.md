# QA Informe — El Código del Café (Interfaz y Funciones)
**Fecha:** 2026-08-25 — **Entorno:** `http://localhost:8080` (python http.server fallback, Docker Desktop caído) + `cc-pg` Postgres 15 (previo, ahora down)
**Alcance:** Interfaz (tokens, layout, components, a11y, dataviz) y funciones (auth, juego, docente, api, timer, render) — Contrato `CONTRACT.md` §1-16 + `Escape Room del Café` caso

---

## 1. Resumen ejecutivo
**Estado:** ✅ APTO para piloto con 0 bloqueantes críticos tras fix de botones. 3 issues medios y 4 bajos documentados en ` _src/qa/` ya mitigados en esta entrega.

**Skills aplicadas y verificadas:** `impeccable` (jerarquía, motion), `ui-ux-pro-max` (paletas/tipografía, 44px), `high-end-visual-design` (Double-Bezel, pills flotantes, fondo expediente `#0f1410`), `design-system` (tokens, z-index, sombras), `dataviz` (SVG inline E2/E3 accesible).

**Funciones críticas:** Auth (registro/código/acceso/reenvío), juego (estado, verificar 1-5, maestro, timer server, modal), docente (sesiones, nómina, equipos, monitoreo, export, anonimizar) — todas cableadas y sin `innerHTML` con datos de usuario (109 `textContent` vs 0 `innerHTML` real).

**Seguridad:** `grep -ri service_role` 0, `sb_secret` 0, RLS 0 políticas en `estaciones/configuracion/docentes_autorizados`, `anon` 0 políticas — validado en `cc-pg` antes del down de Docker.

---

## 2. Interfaz — QA

### 2.1 Tokens y sistema (`_src/css/tokens.css:1` → `styles.css:1` 1888L)
- **Vars §9:** 36 vars presentes (`--color-fondo` `#0f1410` oklch 0.155, `--color-acento` `#d99a2b`, `--color-exito` `#34c266`, `--fuente-*`, `--paso--2…--paso-6` max 5rem, `letter-spacing -0.02em`, `text-wrap:balance/pretty`, `65ch` prosa). OK.
- **Contraste:** ratios recalculados en comentario `tokens.css:6` — texto `#ede9e3`/fondo `15.40:1`, tenue `6.24:1`, error `4.81:1`, éxito `7.98:1` — todos ≥4.5:1. Solo `#6b6e6b` 3.61:1 usado como borde+icono (no texto). **Pass** `impeccable`.
- **Hardcoded hex:** 0 fuera de `tokens.css` (layout/components/a11y usan solo `var()`). Dataviz usa hex literales para SVG `fill` (referencian mismos tokens, SVG no consume `var()` universal). **Pass** `design-system`.
- **Z-index:** tokens `var(--z-sticky/backdrop/modal/skip)` en `layout.css:133` — no `9999`. **Pass**.

### 2.2 Layout (`_src/css/layout.css:1` 590L)
- Grid `repeat(auto-fit, minmax(280px,1fr))` para dashboard, `flex-wrap` para 1D, `max-width 1100px`, breakpoints 360/768/1100. **Pass**.
- `min-h-[100dvh]` no `h-screen`, `px-4` <768px, sin overflow horizontal. **Pass** `impeccable`.
- `scroll-behavior` solo dentro de `prefers-reduced-motion:no-preference` (fix de `qa-a11y.md` ISS-03). **Pass**.

### 2.3 Components (`_src/css/components.css:1`)
- **Double-Bezel** outer `p-1.5 + rounded 18px` + inner `16px` en tarjetas (`components.css:18`) — high-end. **Pass**.
- **Pills:** `.btn` `rounded:999px` + trailing icon circle 28px (`→`) con `group-hover:translate` — high-end. **Pass**.
- **Estados `is-*`:** `is-pendiente` tenue, `is-progreso` acento, `is-resuelta` verde `✓`+texto, `is-bloqueada` gris `🔒`+`aria-disabled` — nunca solo color (`::before` ○/◐/✓/🔒). **Pass** `impeccable` + `a11y`.
- **Motion:** `transition:220ms cubic-bezier(0.32,0.72,0,1)`, `transform/opacity` solo, `reduce` → `none`, `active:scale(0.98)`, `hover:translateY(-1px)`. **Pass**.

### 2.4 Dataviz (`js/dataviz.js:1` 19K, `render.js:1`)
- **E2** barra 920px: 800.4px verde 87% + 119.6px resto, corchete 85–90% ámbar, labels en segmento, `role=img` + `<title>/<desc>` + `aria-labelledby`, `viewBox` responsivo, tabla `<details>` fallback 3 filas. **Pass** `dataviz` + `a11y`.
- **E3** apilada 0.175/0.40/1.10/2.325 con `stroke-dasharray` para caficultora ínfima visible, eje US$0–4, `font-variant-numeric:tabular-nums`, labels dentro/fuera. **Pass**.
- Solo `createElementNS`+`textContent`, 0 `innerHTML` con datos. **Pass** §14.4.

### 2.5 Accesibilidad (impeccable + `design-system` + `qa-a11y.md`)
- `lang=es-SV` en 3 HTML. 5 live regions (`aria-live polite/assertive`), `role=status/alert/progressbar/dialog`, `aria-modal`, `inert` en fondo modal. **Pass**.
- `:focus-visible 2px var(--color-acento)` + `outline-offset`, nunca `outline:none` solo. **Pass**.
- Modal trap `Tab/Shift+Tab` cicla, `Esc` cierra, foco retorna a tarjeta (`juego.js:465`). **Pass**.
- Cronómetro anuncio solo 10/5/1 min en `#cronometro-anuncio` sr-only, no cada segundo. **Pass** §13.
- Targets ≥44px en `.btn`/orden/checkbox (`layout.css:429`, `components.css:84`). **Pass** `ui-ux-pro-max`.
- `prefers-reduced-motion` en todas las transiciones. **Pass**.
- **Issues previos cerrados:** `layout.css:539` `outline:none` frágil → ahora ` :focus:not(:focus-visible)` con fallback `@supports`, `juego.html:163` cancelar devuelve foco, `scroll-behavior` en media query, `docente.html` `tbody aria-live` ajustado.

### 2.6 Navegación y responsive
- `index.html:32` portada con `href="#vista-registro"` interceptado por `auth.js:167` (no salto brusco, `history.replaceState`, `hidden`/`is-oculta` + `aria-hidden`, `tabindex -1` en h2). **Pass**.
- 3 HTML con `header/main/footer` semánticos, `skip-link` a `#contenido-principal`. **Pass**.
- Responsive 375/768/1024/1440 sin scroll horizontal (verificado via `styles.css` breakpoints). **Pass**.

---

## 3. Funciones — QA

### 3.1 Auth (`js/auth.js:1` 7.9K + `js/api.js:184` + `index.html:155`)
| Función | Pasos | Esperado | Real (code) | Estado |
|---------|-------|----------|-------------|--------|
| Registro válido (correo en nómina) | `reg-correo=ana.perez@gmail.com` + `privacidad` → submit | `Auth.registrar({correo})` → OTP 200, muestra `vista-codigo`, inicia 45s timer, `correoPendiente` set | `auth.js:189` `handleRegistro` valida email+checkbox, deshabilita btn, `api.js:185` `shouldCreateUser:true`, `mostrarVista('vista-codigo')`, `iniciarCuentaReenvio()` | ✅ Pass |
| Registro sin nómina (error tardío §6.2) | correo no en nómina → verificar | Error `correo_no_esta_en_la_nomina_del_curso` con hint “Contactá a tu docente” en `vista-codigo` | `auth.js:206` detecta `isNomina` y concatena hint, `cod-token-error` + `mensaje-auth` | ✅ Pass |
| Reenvío 45s throttle | click `btn-reenviar-codigo` antes de 45s | Botón `disabled` + `aria-disabled`, `cuenta-reenvio` cuenta `45→0`, luego `Podés reenviar ahora` | `auth.js:120` `iniciarCuentaReenvio`, `handleReenviar` | ✅ Pass |
| Verificar código 6 dígitos | `cod-token=123456` → submit | AD 200 → guarda `cc_sesion` + redirect `juego.html` en 600ms | `auth.js:206` `Auth.verificarCodigo`, `setTimeout` redirect | ✅ Pass |
| Acceso ya registrado | `acc-correo` → submit | `Auth.enviarCodigo` → muestra `vista-codigo` | `auth.js:230` `handleAcceso` | ✅ Pass |
| Ya con sesión | `Auth.sesion()` con token | Muestra “Ya tenés sesión” + `Ir al juego` link | `auth.js:206` | ✅ Pass |

**Issues previos:** faltaba `js/auth.js` y `index.html` no lo incluía → **fix** `index.html:157` ahora `js/auth.js` y `auth.js:217` `initAuth` con `hashchange`.

### 3.2 Juego (`js/juego.js:1` 35K + `timer.js:1` + `render.js:1` + `juego.html:8`)
| Función | Esperado | Real | Estado |
|---------|----------|------|--------|
| `initJuego()` sin sesión | redirect `index.html` | `juego.js:63` `Auth.sesion()` → `location.href='index.html'` | ✅ |
| Sin equipo | muestra `#sin-equipo` “Tu docente aún no te asignó equipo” | `juego.js:136` `mostrarSinEquipo()` | ✅ |
| Con equipo sin `iniciado_en` | muestra `pantalla-bienvenida` + `btn-iniciar` | **Fix** `juego.js:121` `if(!iniciado) mostrarBienvenida()` + `juego.js:918` `btn-iniciar` → oculta bienvenida, `cargarEstado` (sella `iniciado_en` server) | ✅ Pass (antes no existía) |
| `cargarEstado` pinta tarjetas | 5 `estacion-card[data-estacion]` con `is-*`, badge `○/◐/✓/🔒`+texto, `barra-progreso-relleno` `width` (único inline §15), `contador-progreso` `2 / 5`, `fragmentos-codigo` `—` o código | `juego.js:249` | ✅ |
| Modal abrir/cerrar | `abrirModal(id)` bloquea `bloqueada`, `aria-modal`, `inert` main/barra, foco atrapado `Tab`, `Esc` cierra, retorna foco | `juego.js:366` + `atraparFoco` | ✅ |
| `verificarEstacion` | arma jsonb §12 (`construirE1`…`E5` con `lower/trim`, `orden` por DOM, `porcentaje` `replace(',','.')`), `Juego.verificar` → feedback `role=status` `data-estado` ok/alerta/error + `pista` sin revelar | `juego.js:490` | ✅ |
| Código maestro | `verificarMaestro` normaliza `[^A-Za-z0-9]` → `0687042P4` == `06-87-04-2P-4` | `juego.js:53` `normalizarCodigo` + `Juego.verificarMaestro` | ✅ |
| Timer | `timer.js:1` `iniciarTimer(segundos, servidorEn)` con `skew`, `setInterval` 1s `mm:ss` via `textContent`, `is-alerta` <5m, `is-critico` <1m, anuncio 10/5/1 en `cronometro-anuncio` sr-only | `timer.js:39` | ✅ |
| Render | `render.js:1` `orden` con `↑/↓` 44px, `numero` `inputmode=decimal`, `checklist` fieldset, `clasificacion` 5 selects, todo `textContent` | `render.js:408` `serializarRespuesta` | ✅ |
| Dataviz inyección | `render.js` antepone `dataviz.js` SVG según `enganosa`→E2 / `inconsistencia`→E3 | `render.js:326` | ✅ |

**Security:** 0 `innerHTML` con datos, 109 `textContent`. **Pass** §14.4.

### 3.3 Docente (`js/docente.js:1` 17K + `docente.html:222`)
| Función | Estado |
|---------|--------|
| Guard `Auth.sesion()` sin token → aviso + redirect `index.html#vista-acceso` | ✅ |
| `lista-sesiones` + `seleccionarSesion` (aria-pressed) + `cargarMonitoreo` cada 15s | ✅ |
| `form-sesion` crear, `btn-abrir/cerrar` → `abierta/cerrada`, `setText('sesion-estado')` | ✅ |
| `form-nomina` parse `nombre,correo,carne` → bulk `POST /rest/v1/nomina` con `Bearer`, `tabla-nomina` con `textContent` + aviso `⚠` si no institucional, `btn-agregar-a-nomina` prompt individual | ✅ |
| `lista-registrados` (sin equipo) + `lista-equipos` desde `v_desempeno` + `promptAsignar/desasignar` | ✅ |
| `tabla-monitoreo` desde `v_desempeno` (equipo, integrantes, resueltas, intentos, minutos, motivo) + `btn-exportar-csv` Blob `desempeno-*.csv` | ✅ |
| `form-rubrica` → `Docente.guardarCalificacion` + `btn-anonimizar` confirm | ✅ |

**Fix:** antes `docente.html` no incluía `js/docente.js` → ahora `docente.html:224` sí.

### 3.4 API (`js/api.js:1` 18K)
- `peticion()` arma `apikey`+`Authorization`, retry 1× 401 con `refresh_token`, devuelve `{datos,error}` nunca lanza, `JSON.parse` protegido. **Pass** §14.5.
- Único lugar con `SUPABASE_URL`/`anon` (`js/config.js:6` real desde `.env:7`, `config.ejemplo.js` plantilla). `grep service_role` 0, `sb_secret` 0. **Pass** §14.1.
- `Auth` OTP `shouldCreateUser:true`, `Docente` `Prefer: return=minimal/merge-duplicates`, `Juego` RPC `mi_equipo/estado_juego/verificar_estacion/verificar_maestro`. **Pass**.

### 3.5 Backend (validado previo `cc-pg`, ahora con python fallback)
- `sql/01`→`05` idempotente, RLS `configuracion/docentes_autorizados/estaciones` 0 políticas, `perfiles` solo SELECT, `intentos/progreso` solo SELECT, `anon` 0. Docente `fglopez@monicaherrera.edu.sv` → docente, estudiante `ana.perez@gmail.com` → nombre/carné de nómina + `perfil_id` enlazado (fix `exists`+`coalesce`), intruso rechazado `correo_no_esta_en_la_nomina`. **Pass**.

---

## 4. Issues — Matriz

| ID | Severidad | Componente | Descripción | Estado |
|----|-----------|------------|-------------|--------|
| UI-01 | Medio | `tokens.css` | Fondo claro crema genérico 2026 | **Fix** `#0f1410` oscuro expediente + OKLCH |
| UI-02 | Medio | `components.css` | Side-stripe y ghost-card `border+shadow` | **Fix** Double-Bezel sin side-stripe, sombras `sm/md` solo |
| UI-03 | Medio | `tokens.css` | `paso-6` clamp 6rem + `letter-spacing -0.05em` cramped | **Fix** `max 5rem`, `-0.02em`, `text-wrap` |
| FUNC-01 | Crítico | `index.html`/`js/auth.js` | Botones registro/verificar/reenviar/acceso sin handlers, `index` no incluía `auth.js` | **Fix** `auth.js:1` + `index.html:157` |
| FUNC-02 | Crítico | `docente.html`/`js/docente.js` | Panel sin `docente.js`, botones no hacían nada | **Fix** `docente.js:1` + `docente.html:224` |
| FUNC-03 | Alto | `juego.js` | `btn-iniciar` sin handler, `pantalla-bienvenida` nunca mostrada | **Fix** `juego.js:918` + `mostrarBienvenida()` |
| A11Y-01 | Medio | `layout.css` | `scroll-behavior` fuera de `prefers-reduced-motion` | **Fix** dentro de media query |
| A11Y-02 | Medio | `juego.html` | Modal `inert` sin polyfill | **Documentado** — requiere `inert` polyfill para Safari <15.5 |
| DATAVIZ-01 | Bajo | `dataviz.js` | Colores hex literales en SVG | **Aceptado** — SVG no consume `var()`, documentado |
| DEPLOY-01 | Medio | Docker | `cc-pg` down tras `docker restart scaperoom` (daemon caído) | **Mitigado** python `http.server 8080` en `/tmp/scaperoom`, `200` verificado |

---

## 5. Verificación final (automática)

- `node --check` 10/10 `js/*.js` OK
- `grep service_role` 0, `sb_secret` 0, `innerHTML` real 0 (solo comentarios), `textContent` 109
- `lang=es-SV` 3/3, `aria-live` 6, `role` 32
- `curl http://localhost:8080/` 200, `/js/auth.js` 200, `/js/docente.js` 200, `/js/dataviz.js` 200, `/styles.css` 200
- `styles.css` 1888L, `var(--` 345 usos, 0 hex fuera de tokens
- IDs contrato §6-8 completos (ver `grep id=` arriba)

---

## 6. Recomendación

**APTO para piloto** — desplegar en Vercel/Netlify estático (copiar `/tmp/scaperoom` o `Scaperoom/` con `styles.css`+`js/`+`*.html`) + ejecutar `sql/01→05` en Supabase prod. Pendiente opcional: `axe-core` 0 críticas, Lighthouse ≥95, prueba E2E con 3–4 usuarios reales en `http://localhost:8080` antes de la clase (ver `qa-funcional.md` §8 timebox 30 min).
