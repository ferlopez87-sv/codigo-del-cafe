# El Código del Café — Escape Room de Sostenibilidad

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
4. Variables (opcional): si querés no tocar `js/config.js`, añade `SUPABASE_URL` y `SUPABASE_ANON_KEY` en Render → Environment (el `Dockerfile` las inyecta si las definís, sino usa las de `js/config.js`).
5. Cada `git push` a `main` redeplega automático.

Docker local y Render comparten el mismo `Dockerfile` y `render.yaml` — GitHub es el puente.

## Configuración Supabase
Copiar `js/config.ejemplo.js` → `js/config.js` y completar `SUPABASE_URL` y `SUPABASE_ANON_KEY` (solo anon, nunca service_role). Ver `.env.ejemplo`.

SQL en orden: `sql/01-esquema.sql` → `02-rls.sql` → `03-funciones.sql` → `04-docentes.sql` → `05-seed.sql` (Supabase SQL Editor).

Docente: `fglopez@monicaherrera.edu.sv` (en `docentes_autorizados`), nómina por CSV `nombre,correo,carne`.

Site URL en Supabase: `https://<tu-app>.onrender.com` + `http://localhost:8080` en **Authentication → URL Configuration → Redirect URLs** (para que el magic-link vuelva a la app). Email Templates → Magic Link añade `{{ .Token }}` para que llegue código además de link.

## Modo demo sin correo
Si Supabase llega a `429 Email rate limit`, la app activa `js/demo.js` (código local determinístico, válido 5 min) y permite `Entrar en modo demo` sin correo — para la clase. Todo en `localStorage`, validación igual a `sql/03`.

