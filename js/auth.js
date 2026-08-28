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
      el.classList.add('active');
      el.setAttribute('aria-hidden','false');
      const h2=el.querySelector('h2');
      if(h2) h2.focus({preventScroll:true});
    } else {
      el.setAttribute('hidden','');
      el.classList.add('is-oculta');
      el.classList.remove('active');
      el.setAttribute('aria-hidden','true');
    }
  });
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

// 2026-08-26: docentes terminaban en juego.html (pantalla de estudiante,
// "tu docente aún no te asignó equipo" — no tiene sentido para quien
// justamente ES el docente). Ambos formularios de código (correo+código y
// OTP) devuelven perfil.rol en la respuesta de /verificar — solo faltaba
// leerlo.
function destinoTrasLogin(datos){
  return datos?.perfil?.rol === 'docente' ? 'docente.html' : 'juego.html';
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
  // Sin Supabase: no hay magic-link con access_token en hash. Se conserva stub
  // por si un correo viejo contiene enlace con token — simplemente informar.
  const hash = window.location.hash || '';
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
  const {error} = await Auth.registrar({correo});
  btn.disabled=false; btn.removeAttribute('aria-busy'); btn.textContent='Registrarme y enviar código';
  if(error){
    const msg=error.mensaje||error.message||'No se pudo enviar el correo.';
    setMensaje(msg,'error');
    setCampoError('reg-correo-error',msg);
    return;
  }
  correoPendiente=correo;
  setMensaje('Correo enviado. Revisá tu bandeja (y spam): hacé clic en el enlace del correo para entrar directamente, o copiá el código de 6 dígitos si tu correo lo muestra e ingresalo abajo.','ok');
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
  const destino = destinoTrasLogin(datos);
  setMensaje(destino==='docente.html' ? '¡Verificado! Redirigiendo a tu panel…' : '¡Verificado! Redirigiendo al juego…', 'ok');
  // Pequeño delay para que SR anuncie
  setTimeout(()=>{ window.location.href=destino; }, 600);
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

// 2026-08-26: este formulario dejó de "pedir un código por correo" (Resend
// en sandbox solo entrega a la propia cuenta dueña — CONTRACT §3.4) y pasó
// a ser un ingreso directo: correo + el código que el docente ya te dio
// (de equipo o el personal). Un solo paso, sin pantalla intermedia — mismo
// endpoint /verificar que usa #form-codigo, así que acepta código personal,
// de equipo o el OTP viejo si alguien todavía tiene uno vigente.
async function handleAcceso(e){
  e.preventDefault();
  const correoEl=$('acc-correo');
  const codigoEl=$('acc-codigo');
  const correo=(correoEl?.value||'').trim().toLowerCase();
  const codigo=(codigoEl?.value||'').trim();
  setCampoError('acc-correo-error','');
  setCampoError('acc-codigo-error','');
  setMensaje('');
  if(!validarEmail(correo)){ setCampoError('acc-correo-error','Ingresá un correo válido.'); correoEl?.focus(); return; }
  if(!codigo){ setCampoError('acc-codigo-error','Ingresá el código que te dio tu docente.'); codigoEl?.focus(); return; }
  const btn=$('btn-acceder');
  btn.disabled=true; btn.textContent='Entrando…';
  const {datos, error} = await Auth.verificarCodigo(correo, codigo);
  btn.disabled=false; btn.textContent='Entrar';
  if(error){
    const msg=error.mensaje||error.message||'Código incorrecto o correo no está en la nómina.';
    setCampoError('acc-codigo-error', msg);
    setMensaje(msg,'error');
    return;
  }
  const destino = destinoTrasLogin(datos);
  setMensaje(destino==='docente.html' ? '¡Verificado! Redirigiendo a tu panel…' : '¡Verificado! Redirigiendo…', 'ok');
  setTimeout(()=>{ window.location.href=destino; }, 500);
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

// ---------------------------------------------------------------------------
// Acceso por código de equipo (2026-08-26) — vía principal para estudiantes.
// Dos pasos: buscar el equipo por su código (revela solo nombres), elegir
// quién sos, entrar. El servidor vuelve a validar todo — esto solo evita
// que alguien intente sin sentido.
// ---------------------------------------------------------------------------
let codigoEquipoPendiente = '';
let perfilEquipoElegido = '';

function alternarTabsAcceso(activo){
  const tabEquipo=$('tab-acceso-equipo'), tabCorreo=$('tab-acceso-correo');
  const panelEquipo=$('modo-acceso-equipo'), panelCorreo=$('modo-acceso-correo');
  const esEquipo = activo==='equipo';
  if(panelEquipo) panelEquipo.hidden = !esEquipo;
  if(panelCorreo) panelCorreo.hidden = esEquipo;
  if(tabEquipo){ tabEquipo.setAttribute('aria-selected', String(esEquipo)); tabEquipo.classList.toggle('border-primary', esEquipo); tabEquipo.classList.toggle('text-primary', esEquipo); tabEquipo.classList.toggle('border-transparent', !esEquipo); tabEquipo.classList.toggle('text-on-surface-variant', !esEquipo); }
  if(tabCorreo){ tabCorreo.setAttribute('aria-selected', String(!esEquipo)); tabCorreo.classList.toggle('border-primary', !esEquipo); tabCorreo.classList.toggle('text-primary', !esEquipo); tabCorreo.classList.toggle('border-transparent', esEquipo); tabCorreo.classList.toggle('text-on-surface-variant', esEquipo); }
}

async function handleBuscarEquipo(e){
  e.preventDefault();
  setCampoError('eq-codigo-error','');
  const input=$('eq-codigo');
  const codigo=(input?.value||'').trim();
  if(!codigo){ setCampoError('eq-codigo-error','Ingresá el código.'); input?.focus(); return; }
  const btn=$('btn-buscar-equipo');
  btn.disabled=true;
  const {datos, error} = await Auth.equipoPorCodigo(codigo);
  btn.disabled=false;
  if(error || !datos?.integrantes){
    setCampoError('eq-codigo-error', error?.mensaje==='codigo_vencido' ? 'Ese código venció. Pedile uno nuevo a tu docente.' : 'Código inválido. Revisalo con tu docente.');
    return;
  }
  codigoEquipoPendiente = codigo;
  perfilEquipoElegido = '';
  $('eq-nombre-equipo').textContent = datos.equipoNombre || 'tu equipo';
  const lista = $('eq-lista-integrantes');
  lista.textContent='';
  datos.integrantes.forEach(p=>{
    const li=document.createElement('li'); li.setAttribute('role','listitem');
    const label=document.createElement('label'); label.className='flex items-center gap-3 p-3 border border-audit-border rounded cursor-pointer hover:border-primary';
    const radio=document.createElement('input'); radio.type='radio'; radio.name='eq-quien-soy'; radio.value=p.perfil_id;
    // 2026-08-28 (pedido de Fernando): si un usuario ya entró, otro no puede
    // usar su lugar — acá se avisa ANTES de que elija (server-side también
    // lo bloquea, esto es solo para que no le salga un error genérico sin
    // entender por qué). El texto visible ("ya entró") es la señal real —
    // el disabled es refuerzo, nunca el único portador (CONTRACT §15).
    if(p.ya_entro){
      label.classList.add('opacity-60','cursor-not-allowed');
      label.classList.remove('cursor-pointer','hover:border-primary');
      radio.disabled = true;
    } else {
      radio.addEventListener('change', ()=>{ perfilEquipoElegido = radio.value; $('btn-eq-entrar').disabled = false; });
    }
    const span=document.createElement('span'); span.className='font-body-md text-body-md text-text-on-document'; span.textContent = p.ya_entro ? `${p.nombre} — ya entró` : p.nombre;
    label.append(radio, span);
    li.appendChild(label);
    lista.appendChild(li);
  });
  $('btn-eq-entrar').disabled = true;
  $('eq-resultado').removeAttribute('hidden');
}

async function handleEntrarEquipo(){
  if(!codigoEquipoPendiente || !perfilEquipoElegido) return;
  const btn=$('btn-eq-entrar');
  btn.disabled=true;
  const {error} = await Auth.accesoEquipo(codigoEquipoPendiente, perfilEquipoElegido);
  if(error){
    btn.disabled=false;
    // lugar_ya_tomado (2026-08-28): la lista ya avisa quién entró, pero dos
    // personas pueden elegir el mismo nombre casi al mismo tiempo — acá cae
    // quien pierde esa carrera. Mensaje distinto del genérico para que
    // entienda qué pasó, no que "algo falló".
    setCampoError('eq-codigo-error', error?.mensaje==='lugar_ya_tomado' ? 'Alguien ya entró como esa persona. Volvé a buscar el equipo y elegí otro nombre, o pedile ayuda a tu docente.' : 'No se pudo entrar. Volvé a buscar el equipo.');
    return;
  }
  setTimeout(()=>{ window.location.href='juego.html'; }, 300);
}

function initAuth(){
  // Si viene de un magic-link con token en hash, manejarlo antes de mostrar vistas
  if(manejarCallbackMagicLink()) return;
  enlazarNav();
  $('form-registro')?.addEventListener('submit', handleRegistro);
  $('form-codigo')?.addEventListener('submit', handleVerificarCodigo);
  $('btn-reenviar-codigo')?.addEventListener('click', handleReenviar);
  $('form-acceso')?.addEventListener('submit', handleAcceso);
  $('tab-acceso-equipo')?.addEventListener('click', ()=> alternarTabsAcceso('equipo'));
  $('tab-acceso-correo')?.addEventListener('click', ()=> alternarTabsAcceso('correo'));
  $('form-equipo-codigo')?.addEventListener('submit', handleBuscarEquipo);
  $('btn-eq-entrar')?.addEventListener('click', handleEntrarEquipo);
  $('eq-codigo')?.addEventListener('input', (e)=>{ e.target.value = e.target.value.toUpperCase(); });
  // acc-codigo acepta código de equipo (letras+dígitos) o personal/OTP (solo
  // dígitos) — mayúscula es no-op para dígitos, así que es seguro aplicarla
  // siempre y mantiene la misma UX que el campo de código de equipo.
  $('acc-codigo')?.addEventListener('input', (e)=>{ e.target.value = e.target.value.toUpperCase(); });
  // Enter en token autotrim
  $('cod-token')?.addEventListener('input', (e)=>{
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,6);
    if(e.target.value.length===6) e.target.setAttribute('aria-invalid','false');
  });
  // Si ya hay sesión (cookie httpOnly válida → /api/auth/sesion 200), sugerir ir a juego
  Auth.sesion().then(r=>{
     const datos=r?.datos;
     const tieneSesion = datos && (datos.perfil || datos.correo || datos.id || datos.sesion || datos.usuario);
     if(tieneSesion){
       const aviso=$('mensaje-auth');
       if(aviso){
         aviso.textContent='Ya tenés sesión activa. Podés ir directo al juego.';
         if(!document.getElementById('btn-ir-juego')){
           const b=document.createElement('a');
           b.id='btn-ir-juego'; b.className='border border-primary text-primary px-3 py-1 text-sm font-evidence-data uppercase'; b.href='juego.html'; b.textContent='Ir al juego';
           b.style.marginLeft='0.75rem';
           aviso.appendChild(b);
         }
       }
     }
   });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initAuth);
else initAuth();
