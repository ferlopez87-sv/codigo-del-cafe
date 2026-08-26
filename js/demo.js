// js/demo.js — Modo demo local sin Supabase (fallback cuando email llega al límite)
// Se activa cuando el usuario hace clic en "Entrar en modo demo" o cuando api.js detecta 429.
// Todo en localStorage, sin red, sin correo. Para la clase, no para producción.
// Contrato offline: 3 archivos + localStorage cgc-auditoria-v1, pero aquí lo integramos como fallback
// del stack Supabase para no tener que mantener dos apps.

const DEMO_KEY = 'cc_modo_demo';
const DEMO_SESION_KEY = 'cc_demo_sesion';
const DEMO_OTP_PREFIX = 'cc_demo_otp_';
const DEMO_ESTADO_KEY = 'cc_demo_estado';

export function estaEnDemo(){ try{ return localStorage.getItem(DEMO_KEY)==='1'; }catch{ return false; } }
export function activarDemo(email){
  try{
    localStorage.setItem(DEMO_KEY,'1');
    const e=(email||'demo@local').trim().toLowerCase();
    // Crear sesión demo fake con access_token
    const fake={ access_token:'demo-'+btoa(e).slice(0,16), refresh_token:'demo-refresh', expires_in:3600, token_type:'bearer', user:{email:e, id:'demo-'+btoa(e).slice(0,8)} };
    localStorage.setItem('cc_sesion', JSON.stringify(fake));
    localStorage.setItem(DEMO_SESION_KEY, JSON.stringify({email:e, docente: e.includes('fglopez')||e.includes('docente')}));
    // Inicializar estado demo si no existe
    if(!localStorage.getItem(DEMO_ESTADO_KEY)){
      const estado={
        version:1,
        equipo: e.includes('fglopez')? null : 'Equipo Demo',
        integrantes: [{nombre: e.split('@')[0], carne:'DEMO-001'}],
        iniciadoEn: null,
        duracionMs: 50*60*1000,
        estaciones:{
          "1":{estado:'pendiente', intentos:0, resueltaEn:0},
          "2":{estado:'pendiente', intentos:0, resueltaEn:0},
          "3":{estado:'pendiente', intentos:0, resueltaEn:0},
          "4":{estado:'pendiente', intentos:0, resueltaEn:0},
          "5":{estado:'bloqueada', intentos:0, resueltaEn:0}
        },
        codigoMaestroOk:false
      };
      localStorage.setItem(DEMO_ESTADO_KEY, JSON.stringify(estado));
    }
  }catch{}
}
export function desactivarDemo(){ try{ localStorage.removeItem(DEMO_KEY); }catch{} }

// OTP local: genera código determinístico por email (para que sea predecible en clase)
// Usa hash simple para que el mismo correo siempre dé el mismo código en demo (facilita pruebas)
export function generarCodigoDemo(email){
  const e=(email||'').trim().toLowerCase();
  let h=0;
  for(let i=0;i<e.length;i++){ h=((h<<5)-h + e.charCodeAt(i))|0; }
  const n = Math.abs(h)%900000 + 100000; // 100000-999999
  const code = String(n).padStart(6,'0');
  try{ localStorage.setItem(DEMO_OTP_PREFIX+e, JSON.stringify({code, expira: Date.now()+5*60*1000})); }catch{}
  return code;
}
export function verificarCodigoDemo(email, token){
  const e=(email||'').trim().toLowerCase();
  const raw=localStorage.getItem(DEMO_OTP_PREFIX+e);
  if(!raw) return false;
  try{
    const {code, expira}=JSON.parse(raw);
    if(Date.now()>expira) return false;
    return String(token).trim()===String(code);
  }catch{ return false; }
}
export function obtenerCodigoDemo(email){
  const e=(email||'').trim().toLowerCase();
  const raw=localStorage.getItem(DEMO_OTP_PREFIX+e);
  if(!raw) return null;
  try{ return JSON.parse(raw).code; }catch{ return null; }
}

// Estaciones demo: datos mínimos para jugar offline (sin Supabase). Se leen de _src/content si está disponible,
// sino se usan los del seed (hardcodeados aquí para demo). Solo narrativa/datos/reto/interacción sin respuestas.
export const ESTACIONES_DEMO = [
  {id:1, titulo:'Sala de Hechos', pilar:'Cadena de valor', codigo:'06-VC'},
  {id:2, titulo:'Sala Verde', pilar:'Ambiental', codigo:'87'},
  {id:3, titulo:'Sala del Dinero', pilar:'Económico', codigo:'04'},
  {id:4, titulo:'Sala de las Personas', pilar:'Social', codigo:'2P'},
  {id:5, titulo:'Sala de la Verdad', pilar:'Síntesis', codigo:'4'}
];

// Validadores demo (replican sql/03-funciones.sql §12 en JS, sin exponer respuestas en claro más de lo necesario)
export function validarDemo(estacionId, respuesta){
  const r=respuesta||{};
  if(estacionId===1){
    const ordenOk = JSON.stringify((r.orden||[]).map(s=>String(s).toLowerCase()))===JSON.stringify(["cultivo","cosecha","procesamiento","exportacion","tostado","venta"]);
    const eslabonOk = String(r.eslabon||'').toLowerCase().trim()==='cultivo';
    if(!r.orden && !r.eslabon) return {ok:false, detalle:'vacio'};
    if(ordenOk && eslabonOk) return {ok:true};
    if(!ordenOk && !eslabonOk) return {ok:false, detalle:'ambos-mal'};
    if(!ordenOk) return {ok:false, detalle:'orden-mal'};
    return {ok:false, detalle:'eslabon-mal'};
  }
  if(estacionId===2){
    const pct = Number(String(r.porcentaje||'').replace(',','.'));
    const eng = String(r.enganosa||'').toLowerCase();
    if(pct!==pct && !eng) return {ok:false, detalle:'vacio'};
    const pctOk = pct===87 || pct===87.5;
    const engOk = eng==='si';
    if(pctOk && engOk) return {ok:true};
    if(!pctOk){
      if(pct>=85 && pct<=90) return {ok:false, detalle:'porcentaje-fuera-rango'};
      return {ok:false, detalle:'porcentaje-mal'};
    }
    return {ok:false, detalle:'juicio-mal'};
  }
  if(estacionId===3){
    const pct = Number(String(r.porcentaje||'').replace(',','.'));
    const inc = String(r.inconsistencia||'').toLowerCase();
    if((pct!==pct) && !inc) return {ok:false, detalle:'vacio'};
    const pctOk = pct>=4 && pct<=4.4;
    const incOk = inc==='a';
    if(pctOk && incOk) return {ok:true};
    if(!pctOk) return {ok:false, detalle:'porcentaje-mal'};
    return {ok:false, detalle:'inconsistencia-mal'};
  }
  if(estacionId===4){
    const acts=(r.actores||[]).map(s=>String(s).toLowerCase());
    if(acts.length===0) return {ok:false, detalle:'vacio'};
    const ok = JSON.stringify(acts.sort())===JSON.stringify(["caficultora","hija"].sort());
    if(ok) return {ok:true};
    const hasCaf=acts.includes('caficultora'), hasHija=acts.includes('hija');
    if(hasCaf && hasHija && acts.length>2) return {ok:false, detalle:'sobre-marcado'};
    if((hasCaf||hasHija) && acts.length<2) return {ok:false, detalle:'sub-marcado'};
    return {ok:false, detalle:'equivocados'};
  }
  if(estacionId===5){
    const frases=(r.frases||[]).map(s=>String(s).toLowerCase());
    if(frases.length===0 || frases.every(f=>!f)) return {ok:false, detalle:'vacio'};
    const ok = JSON.stringify(frases)===JSON.stringify(["sin_evidencia","enganosa","enganosa","sin_evidencia","verificable"]);
    if(ok) return {ok:true};
    let ac=0; const exp=["sin_evidencia","enganosa","enganosa","sin_evidencia","verificable"];
    for(let i=0;i<5;i++) if(frases[i]===exp[i]) ac++;
    return {ok:false, detalle:`parcial-${ac}`};
  }
  return {ok:false, detalle:'vacio'};
}
