// js/auth.js — Glue UI para index.html (CONTRACT §6, §14.4)
// Vanilla type:module, usa Auth de api.js, todo textContent, sin innerHTML
import { Auth } from './api.js';

const VISTAS = ['vista-portada','vista-registro','vista-codigo','vista-acceso'];
let correoPendiente = '';
let reenvioTimer = null;
let segundosReenvio = 0;

function $(id){ return document.getElementById(id); }

function mostrarVista(id){
  VISTAS.forEach(v=>{
    const el=$(v);
    if(!el) return;
    if(v===id){
      el.removeAttribute('hidden');
      el.classList.remove('is-oculta');
      el.setAttribute('aria-hidden','false');
      // focus para screen reader
      const h2=el.querySelector('h2');
      if(h2) h2.focus({preventScroll:true});
    } else {
      el.setAttribute('hidden','');
      el.classList.add('is-oculta');
      el.setAttribute('aria-hidden','true');
    }
  });
  // actualizar hash sin scroll brusco
  if(location.hash!==`#${id}`) history.replaceState(null,'',`#${id}`);
}

function setMensaje(msg, tipo='info'){
  const el=$('mensaje-auth');
  if(!el) return;
  el.textContent = msg || '';
  el.dataset.estado = tipo;
  el.removeAttribute('hidden');
  if(!msg) el.setAttribute('hidden','');
}

function setCampoError(idError, msg){
  const el=$(idError);
  if(!el) return;
  el.textContent = msg || '';
  if(msg) el.removeAttribute('hidden'); else el.setAttribute('hidden','');
}

function validarEmail(c){
  return c && c.includes('@') && c.includes('.') && c.length>=5;
}

function iniciarCuentaReenvio(){
  segundosReenvio = 45;
  const span=$('cuenta-reenvio');
  const btn=$('btn-reenviar-codigo');
  if(!span || !btn) return;
  btn.disabled=true;
  btn.setAttribute('aria-disabled','true');
  const tick=()=>{
    if(segundosReenvio<=0){
      span.textContent='Podés reenviar ahora';
      btn.disabled=false;
      btn.removeAttribute('aria-disabled');
      clearInterval(reenvioTimer);
      return;
    }
    span.textContent=`Podés reenviar en ${segundosReenvio}s`;
    segundosReenvio--;
  };
  tick();
  clearInterval(reenvioTimer);
  reenvioTimer=setInterval(tick,1000);
}

function manejarCallbackMagicLink(){
  // Supabase magic-link: puede volver con #access_token=...&refresh_token=... (implicit) o ?code=... (PKCE)
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  // Caso 1: implicit con access_token en hash
  if(hash.includes('access_token')){
    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const expires_in = params.get('expires_in');
    if(access_token){
      const sesion = { access_token, refresh_token, expires_in: expires_in? parseInt(expires_in,10): 3600, token_type:'bearer' };
      try{ localStorage.setItem('cc_sesion', JSON.stringify(sesion)); }catch{}
      // Limpiar hash para no exponer tokens en URL
      history.replaceState(null,'', window.location.pathname + window.location.search);
      setMensaje('¡Sesión iniciada por enlace! Redirigiendo al juego…','ok');
      setTimeout(()=> window.location.href='juego.html', 800);
      return true;
    }
  }
  // Caso 2: PKCE con ?code= en query (requiere code_verifier que no tenemos si no usamos SDK, pero intentamos)
  const qs = new URLSearchParams(search);
  const code = qs.get('code');
  if(code){
    // Intentar intercambiar code por sesión vía GoTrue PKCE — si falla, al menos mostrar mensaje
    // No tenemos code_verifier (lo guarda el SDK en localStorage), pero intentamos sin él para compatibilidad
    // Si falla, el usuario puede usar el código de 6 dígitos del mismo correo
    setMensaje('Enlace detectado. Si no redirige, usá el código de 6 dígitos del correo.','info');
    // No auto-redirigir, dejar que el usuario use el código
  }
  // Caso 3: error en hash (?error=...)
  if(hash.includes('error=')){
    const p = new URLSearchParams(hash.slice(1));
    const err = p.get('error_description') || p.get('error') || 'Error en el enlace';
    setMensaje(err,'error');
    return true;
  }
  return false;
}

async function handleRegistro(e){
  e.preventDefault();
  const correoEl=$('reg-correo');
  const privEl=$('reg-privacidad');
  const btn=$('btn-registrar');
  const correo=(correoEl?.value||'').trim().toLowerCase();
  setCampoError('reg-correo-error','');
  setMensaje('');

  if(!validarEmail(correo)){ setCampoError('reg-correo-error','Ingresá un correo válido.'); correoEl?.focus(); return; }
  if(!privEl?.checked){ setMensaje('Debés aceptar el aviso de privacidad.','error'); privEl?.focus(); return; }

  btn.disabled=true; btn.setAttribute('aria-busy','true'); btn.textContent='Enviando…';
  const {datos, error} = await Auth.registrar({correo});
  btn.disabled=false; btn.removeAttribute('aria-busy'); btn.textContent='Registrarme y enviar código';
  if(error){
    const msg=error.mensaje||error.message||'No se pudo enviar el correo.';
    // Si es rate limit, el backend ya habrá generado código demo y lo devuelve en datos (pero aquí error no es null, así que no lo vemos)
    // El fallback de api.js para 429 devuelve {datos:{demo:true,code}, error:null}, así que este branch no se ejecuta para rate limit.
    // Para otros errores, mostrar y ofrecer modo demo como salida
    setMensaje(msg,'error');
    setCampoError('reg-correo-error',msg);
    // Ofrecer modo demo si parece límite de Supabase
    if(msg.toLowerCase().includes('rate')||msg.toLowerCase().includes('limit')||msg.toLowerCase().includes('capacity')||msg.toLowerCase().includes('exceeded')){
      ofrecerModoDemo(correo);
    }
    return;
  }
  correoPendiente=correo;
  // Si vino de demo (Supabase sin correos), datos.demo contiene el código
  if(datos && datos.demo && datos.code){
    setMensaje(`Modo demo activo (Supabase sin correos). Tu código es: ${datos.code} — válido 5 min. Ingresalo abajo o hacé clic en “Entrar en modo demo”.`,'ok');
    mostrarBotonDemo(correo, datos.code);
  } else {
    setMensaje('Correo enviado. Revisá tu bandeja (y spam): hacé clic en el enlace del correo para entrar directamente, o copiá el código de 6 dígitos si tu correo lo muestra e ingresalo abajo.','ok');
  }
  mostrarVista('vista-codigo');
  iniciarCuentaReenvio();
  $('cod-token')?.focus();
}

async function handleVerificarCodigo(e){
  e.preventDefault();
  const tokenEl=$('cod-token');
  const token=(tokenEl?.value||'').trim();
  setCampoError('cod-token-error','');
  setMensaje('');
  if(!/^\d{6}$/.test(token)){ setCampoError('cod-token-error','El código debe tener 6 dígitos.'); tokenEl?.focus(); return; }
  const correo = correoPendiente || ($('reg-correo')?.value||'').trim().toLowerCase();
  if(!validarEmail(correo)){ setMensaje('No se encontró el correo. Volvé al registro.','error'); mostrarVista('vista-registro'); return; }
  const btn=$('btn-verificar-codigo');
  btn.disabled=true; btn.textContent='Verificando…';
  const {datos, error} = await Auth.verificarCodigo(correo, token);
  btn.disabled=false; btn.textContent='Verificar código';
  if(error){
    // CONTRACT §6.2: el rechazo por nómina ocurre al verificar, debe ser claro
    const msg=error.mensaje||error.message||'Código incorrecto o correo no está en la nómina.';
    // Detectar pista de nómina
    const hint = error.hint || '';
    const isNomina = (error.codigo==='correo_no_esta_en_la_nomina_del_curso') || (msg.includes('nómina')) || hint.includes('nómina');
    const full = isNomina ? `${msg} ${hint} — Contactá a tu docente para que te agregue a la nómina.` : msg;
    setCampoError('cod-token-error', full);
    setMensaje(full,'error');
    tokenEl?.setAttribute('aria-invalid','true');
    return;
  }
  tokenEl?.setAttribute('aria-invalid','false');
  setMensaje('¡Verificado! Redirigiendo al juego…','ok');
  // Pequeño delay para que SR anuncie
  setTimeout(()=>{ window.location.href='juego.html'; }, 600);
}

async function handleReenviar(){
  const correo = correoPendiente || ($('reg-correo')?.value||'').trim().toLowerCase();
  if(!validarEmail(correo)){ setMensaje('Ingresá primero un correo válido en el registro.','error'); return; }
  const btn=$('btn-reenviar-codigo');
  btn.disabled=true;
  const {error} = await Auth.enviarCodigo(correo);
  if(error){ setMensaje(error.mensaje||'No se pudo reenviar.','error'); btn.disabled=false; return; }
  setMensaje('Correo reenviado. Revisá tu bandeja y hacé clic en el enlace o copiá el código.','ok');
  iniciarCuentaReenvio();
}

async function handleAcceso(e){
  e.preventDefault();
  const correoEl=$('acc-correo');
  const correo=(correoEl?.value||'').trim().toLowerCase();
  setCampoError('acc-correo-error','');
  setMensaje('');
  if(!validarEmail(correo)){ setCampoError('acc-correo-error','Ingresá un correo válido.'); correoEl?.focus(); return; }
  const btn=$('btn-acceder');
  btn.disabled=true; btn.textContent='Enviando…';
  const {datos, error} = await Auth.enviarCodigo(correo);
  btn.disabled=false; btn.textContent='Enviar código de acceso';
  if(error){ setMensaje(error.mensaje||'No se pudo enviar el correo.','error'); if((error.mensaje||'').toLowerCase().includes('rate')||String(error.estado)=='429') ofrecerModoDemo(correo); return; }
  correoPendiente=correo;
  if(datos && datos.demo && datos.code){
    setMensaje(`Modo demo activo. Tu código es: ${datos.code} — válido 5 min.`,'ok');
    mostrarBotonDemo(correo, datos.code);
  } else {
    setMensaje('Correo enviado. Revisá tu bandeja: hacé clic en el enlace para acceder, o copiá el código si lo ves.','ok');
  }
  mostrarVista('vista-codigo');
  iniciarCuentaReenvio();
}

function enlazarNav(){
  // Interceptar links internos #vista-*
  document.querySelectorAll('a[href^="#vista-"]').forEach(a=>{
    a.addEventListener('click', (e)=>{
      const href=a.getAttribute('href')||'';
      const id=href.replace('#','');
      if(VISTAS.includes(id)){
        e.preventDefault();
        mostrarVista(id);
      }
    });
  });
  // Footer links también
  // Hash inicial
  const hash=(location.hash||'').replace('#','');
  if(VISTAS.includes(hash)) mostrarVista(hash);
  else mostrarVista('vista-portada');
  window.addEventListener('hashchange', ()=>{
    const h=(location.hash||'').replace('#','');
    if(VISTAS.includes(h)) mostrarVista(h);
  });
}

function mostrarBotonDemo(correo, code){
  const cont=$('vista-codigo');
  if(!cont) return;
  let box=document.getElementById('demo-box');
  if(!box){
    box=document.createElement('div');
    box.id='demo-box';
    box.className='card';
    box.style.marginTop='1rem';
    box.style.padding='1rem';
    box.style.border='1px solid var(--color-acento)';
    box.style.background='var(--color-acento-suave)';
    cont.appendChild(box);
  }
  box.textContent='';
  const p=document.createElement('p');
  p.textContent=`Código demo para ${correo}: ${code}`;
  p.style.fontWeight='600';
  p.style.fontFamily='var(--fuente-mono)';
  const btn=document.createElement('button');
  btn.className='btn btn--primario';
  btn.type='button';
  btn.textContent='Entrar en modo demo (sin correo)';
  btn.addEventListener('click', async ()=>{
    // Generar/activar demo y verificar directo
    const {activarDemo}=await import('./demo.js');
    activarDemo(correo);
    // Guardar sesión demo directa sin pasar por verify
    localStorage.setItem('cc_sesion', JSON.stringify({access_token:'demo-'+btoa(correo).slice(0,16), refresh_token:'demo', user:{email:correo}}));
    setMensaje('Modo demo activo — entrando al juego…','ok');
    setTimeout(()=> window.location.href='juego.html', 400);
  });
  const codeBtn=document.createElement('button');
  codeBtn.className='btn btn--ghost';
  codeBtn.type='button';
  codeBtn.textContent='Copiar código';
  codeBtn.style.marginLeft='0.5rem';
  codeBtn.addEventListener('click', ()=>{ navigator.clipboard?.writeText(code); const t=$('cod-token'); if(t) t.value=code; });
  box.append(p, btn, codeBtn);
}

function ofrecerModoDemo(correo){
  // Cuando Supabase devuelve 429, ofrecer entrar en demo
  const codePrompt = prompt(`Supabase alcanzó el límite de correos (429). ¿Querés entrar en modo demo sin correo para la clase?\n\nIngresá tu correo para generar un código demo (o cancelá):`, correo||'');
  if(!codePrompt) return;
  const c=(codePrompt||correo||'').trim().toLowerCase();
  if(!c || !c.includes('@')) return;
  import('./demo.js').then(({activarDemo, generarCodigoDemo})=>{
    activarDemo(c);
    const code=generarCodigoDemo(c);
    correoPendiente=c;
    mostrarVista('vista-codigo');
    mostrarBotonDemo(c, code);
    setMensaje(`Modo demo activo para ${c}. Código: ${code} — podés entrar directo sin esperar correo.`,'ok');
  });
}

function initAuth(){
  // Si viene de un magic-link con token en hash, manejarlo antes de mostrar vistas
  if(manejarCallbackMagicLink()) return;
  // Detectar si ya está en demo y mostrar aviso
  try{
    if(localStorage.getItem('cc_modo_demo')==='1'){
      const sesRaw=localStorage.getItem('cc_demo_sesion');
      if(sesRaw){
        const j=JSON.parse(sesRaw);
        setTimeout(()=> setMensaje(`Estás en modo demo (${j.email||'demo'}). Podés entrar sin correo.`,'info'), 400);
      }
    }
  }catch{}
  enlazarNav();
  $('form-registro')?.addEventListener('submit', handleRegistro);
  $('form-codigo')?.addEventListener('submit', handleVerificarCodigo);
  $('btn-reenviar-codigo')?.addEventListener('click', handleReenviar);
  $('form-acceso')?.addEventListener('submit', handleAcceso);
  // Enter en token autotrim
  $('cod-token')?.addEventListener('input', (e)=>{
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,6);
    if(e.target.value.length===6) e.target.setAttribute('aria-invalid','false');
  });
  // Si ya hay sesión, sugerir ir a juego
  Auth.sesion().then(r=>{
    const datos=r?.datos;
    if(datos && datos.access_token){
      const aviso=$('mensaje-auth');
      if(aviso){
        aviso.textContent='Ya tenés sesión activa. Podés ir directo al juego.';
        // Añadir botón dinámico si no existe
        if(!document.getElementById('btn-ir-juego')){
          const b=document.createElement('a');
          b.id='btn-ir-juego'; b.className='btn btn--primario'; b.href='juego.html'; b.textContent='Ir al juego';
          b.style.marginLeft='0.75rem';
          aviso.appendChild(b);
        }
      }
    }
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initAuth);
else initAuth();
