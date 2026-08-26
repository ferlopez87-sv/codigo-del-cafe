// js/config.ejemplo.js — versionado. Copiar a js/config.js y completar.
// Ver CONTRACT.md §5 y §14.1 — en el frontend va ÚNICAMENTE la clave anon/publicable.
// La clave secreta con bypass de RLS JAMÁS toca el frontend ni el repositorio.

export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_TU_CLAVE_PUBLICA_AQUI';
export const DOMINIO_INSTITUCIONAL = '@monicaherrera.edu.sv';

// Cómo obtener los valores (Supabase Dashboard):
// 1. Project Settings → API → Project URL  → SUPABASE_URL
// 2. Project Settings → API → Publishable key (sb_publishable_...) → SUPABASE_ANON_KEY
// No agregues aquí la clave secreta (secret key) — ignora RLS y expone toda la base.
