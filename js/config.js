// js/config.js — Única fuente de SUPABASE_URL / SUPABASE_ANON_KEY para el frontend.
// Este archivo es leído SOLO por js/api.js (CONTRACT §5, §14.1).
// La clave es publicable (anon) y es pública por diseño; RLS es el control real.
// Copiá desde js/config.ejemplo.js si necesitás resetear.

export const SUPABASE_URL = 'https://mdkbgjzvdwqcokuqdvvn.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Oy0DQmiM-GEeZJjyM3u2Aw_-1taQIIy';
export const DOMINIO_INSTITUCIONAL = '@monicaherrera.edu.sv';
