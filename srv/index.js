import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { sesionMiddleware } from './middleware/sesion.js';
import authRutas from './rutas/auth.js';
import juegoRutas from './rutas/juego.js';
import docenteRutas from './rutas/docente.js';
import { aplicarMigraciones } from './migrar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit:'100kb' }));
app.use(cookieParser());
app.use(sesionMiddleware);

// API
app.use('/api/auth', authRutas);
app.use('/api/juego', juegoRutas);
app.use('/api/docente', docenteRutas);

app.get('/health', (req,res)=> res.json({ ok:true, t: new Date().toISOString() }));

// estático — mismo origen §0.3
app.use(express.static(root, { index:false, maxAge: process.env.NODE_ENV==='production' ? '1h' : 0 }));
for(const f of ['index.html','juego.html','docente.html']){
  app.get(`/${f}`, (req,res)=> res.sendFile(path.join(root,f)));
}
app.get('/', (req,res)=> res.sendFile(path.join(root,'index.html')));

// SPA fallback (evita 404 en refresh de rutas con hash)
app.use((req,res)=> res.status(404).json({ error:'no_encontrado' }));

function levantar(){
  app.listen(PORT, ()=> console.log(`[srv] escuchando en :${PORT} — modo ${process.env.RESEND_API_KEY? 'online (Resend activo)':'local (OTP en log)'} — DB ${process.env.DATABASE_URL_APP? 'app_runtime':'? define DATABASE_URL_APP'}`));
}

// Migraciones antes de escuchar. Si algún .sql falla se levanta igual: sin
// Shell en Render, un proceso muerto no deja leer nada más que el stack —
// con el server arriba quedan los logs y /health para diagnosticar. Solo si
// la base es inalcanzable (aplicarMigraciones rechaza) se corta.
aplicarMigraciones().then(
  (r) => {
    if(!r.ok) console.error('[srv] ⚠️  arrancando con migraciones incompletas — la app puede fallar');
    levantar();
  },
  (err) => {
    console.error('[srv] ❌ no se pudo conectar a la base:', err.message);
    process.exit(1);
  }
);
