# Misión: El código secreto del café — Escape Room de Sostenibilidad

Webapp vanilla (HTML/CSS/JS) + Supabase (Postgres/Auth/RLS) para la materia Sostenibilidad — Escuela Mónica Herrera.

## URLs
- **GitHub:** https://github.com/ferlopez87-sv/codigo-del-cafe
- **Render:** conecta el repo en https://dashboard.render.com → New → Blueprint → selecciona `render.yaml`

## Deploy rápido (Docker local)
```bash
docker compose up -d
# o
docker run -d --name scaperoom -p 8080:80 -v $(pwd):/usr/share/nginx/html:ro nginx:alpine
```
Abrir http://localhost:8080

## Deploy en Render (GitHub como puente)
1. Push a `main` (ya hecho) → Render detecta `render.yaml` y hace autodeploy.
2. En Render Dashboard → New → Blueprint → conecta `ferlopez87-sv/codigo-del-cafe` → Apply.
3. Servicio `codigo-del-cafe` tipo **Docker** (usa `Dockerfile`), plan Free, `healthCheckPath: /`, `autoDeploy: true`.
   - Alternativa sin Docker: comenta el bloque `docker` en `render.yaml` y descomenta el bloque `static` (Static Site, `staticPublishPath: .`).
4. `js/config.js` ya trae `SUPABASE_URL` y la clave publicable reales — es lo que lee el navegador, y está bien que sea pública (RLS la protege, no el secreto). El `Dockerfile` solo copia archivos estáticos: no hay variables de entorno de Render que inyectar en tiempo de build. Si cambiás de proyecto Supabase, editá `js/config.js` directamente antes de hacer push.
5. Cada `git push` a `main` redeplega automático.

Docker local y Render comparten el mismo `Dockerfile` y `render.yaml` — GitHub es el puente.

## Configuración Supabase
Copiar `js/config.ejemplo.js` → `js/config.js` y completar `SUPABASE_URL` y `SUPABASE_ANON_KEY` (solo anon, nunca service_role). Ver `.env.ejemplo`.

SQL en orden: `sql/01-esquema.sql` → `02-rls.sql` → `03-funciones.sql` → `04-docentes.sql` → `05-seed.sql` (Supabase SQL Editor).

Docente: `fglopez@monicaherrera.edu.sv` (en `docentes_autorizados`), nómina por CSV `nombre,correo,carne`.

Site URL en Supabase: `https://<tu-app>.onrender.com` + `http://localhost:8080` en **Authentication → URL Configuration → Redirect URLs** (para que el magic-link vuelva a la app). Email Templates → Magic Link añade `{{ .Token }}` para que llegue código además de link.

## Límite de envío de correos (429)

El plan gratuito de Supabase Auth limita el envío de OTP a muy pocos correos por hora — se agota rápido con una clase completa registrándose a la vez. **No hay modo sin correo**: si Supabase devuelve `429`, la app muestra un error honesto y pide esperar o contactar al docente (CONTRACT §0.6 — se descartó a propósito un "modo demo" que simulaba sesiones, porque el progreso de esos estudiantes nunca llegaba a la base y el rol de docente se podía obtener con solo poner "docente" en el correo).

**La solución real:** configurar un proveedor SMTP propio en *Supabase → Authentication → Email → SMTP Settings* (Resend, Postmark, etc. — cualquiera con un plan gratuito de unos miles de correos al mes alcanza de sobra para una clase). Esto saca el envío de la cuota compartida de Supabase y el problema desaparece. Es una configuración de 5 minutos en el panel, no requiere tocar código.

Alternativa mientras se configura el SMTP: escalonar el registro (abrirlo el día anterior en vez de todos a la vez en clase) para no agotar la cuota compartida de una sola vez.

