# El Código del Café — Escape Room de Sostenibilidad

Webapp vanilla (HTML/CSS/JS) + Supabase (Postgres/Auth/RLS) para la materia Sostenibilidad — Escuela Mónica Herrera.

## Deploy rápido (Docker)
```bash
docker compose up -d
# o
docker run -d --name scaperoom -p 8080:80 -v $(pwd):/usr/share/nginx/html:ro nginx:alpine
```
Abrir http://localhost:8080

## Configuración Supabase
Copiar `js/config.ejemplo.js` → `js/config.js` y completar `SUPABASE_URL` y `SUPABASE_ANON_KEY` (solo anon, nunca service_role). Ver `.env.ejemplo`.

SQL en orden: `sql/01-esquema.sql` → `02-rls.sql` → `03-funciones.sql` → `04-docentes.sql` → `05-seed.sql` (Supabase SQL Editor).

Docente: `fglopez@monicaherrera.edu.sv` (en `docentes_autorizados`), nómina por CSV `nombre,correo,carne`.

## Modo demo sin correo
Si Supabase llega a `429 Email rate limit`, la app activa `js/demo.js` (código local determinístico, válido 5 min) y permite `Entrar en modo demo` sin correo — para la clase.

