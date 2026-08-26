// js/docente.js — Panel docente (te-panel / te-equipos / te-export)
// Vanilla type:module, usa Docente/Auth de api.js, textContent siempre (XSS §14.4)
import { Auth, Docente } from './api.js';

let sesionActivaId = null;
let sesionActivaEstado = 'borrador';

function $(id){ return document.getElementById(id); }
function setText(id, v){ const el=$(id); if(el) el.textContent= v==null?'':String(v); }
function limpiarTabla(tbody){ while(tbody.firstChild) tbody.removeChild(tbody.firstChild); }

async function initDocente(){
  const ses = await Auth.sesion().catch(()=>null);
  const datos = ses?.datos;
  if(!datos || !datos.access_token){
    // No autenticado → volver a index
    // Permitir ver mensaje antes de redirigir
    const aviso=$('sesion-estado');
    if(aviso) aviso.textContent='Necesitás iniciar sesión';
    // delay
    setTimeout(()=> window.location.href='index.html#vista-acceso', 1200);
    return;
  }
  await cargarSesiones();
  enlazarEventos();
  // Auto-refresh monitoreo cada 15s si hay sesión activa
  setInterval(()=>{ if(sesionActivaId) cargarMonitoreo(); }, 15000);
}

async function cargarSesiones(){
  const {datos, error} = await Docente.sesiones();
  const lista=$('lista-sesiones');
  if(!lista) return;
  limpiarTabla(lista); // ul, no tbody
  lista.textContent='';
  if(error){ lista.textContent = error.mensaje||'Error al cargar sesiones'; return; }
  const sesiones = Array.isArray(datos)? datos : (datos?.data||[]);
  if(sesiones.length===0){
    const li=document.createElement('li'); li.textContent='Sin sesiones. Creá la primera.'; li.setAttribute('role','listitem'); lista.appendChild(li); return;
  }
  sesiones.forEach(s=>{
    const li=document.createElement('li');
    li.setAttribute('role','listitem');
    const btn=document.createElement('button');
    btn.className='btn btn--ghost';
    btn.type='button';
    btn.textContent = `${s.nombre} · ${s.estado} · ${s.duracion_minutos||50}′`;
    btn.dataset.sesionId = s.id;
    btn.addEventListener('click', ()=> seleccionarSesion(s.id, s.estado));
    li.appendChild(btn);
    lista.appendChild(li);
  });
  // Auto-seleccionar la más reciente si no hay activa
  if(!sesionActivaId && sesiones[0]) seleccionarSesion(sesiones[0].id, sesiones[0].estado);
}

async function seleccionarSesion(id, estado){
  sesionActivaId=id;
  sesionActivaEstado=estado||'borrador';
  setText('sesion-estado', sesionActivaEstado);
  // Resaltar
  document.querySelectorAll('#lista-sesiones button').forEach(b=>{
    b.setAttribute('aria-pressed', b.dataset.sesionId===id ? 'true':'false');
  });
  await Promise.all([cargarNomina(), cargarRegistrados(), cargarEquipos(), cargarMonitoreo()]);
}

async function crearSesion(e){
  e.preventDefault();
  const nombreEl=$('sesion-nombre');
  const durEl=$('sesion-duracion');
  const nombre=(nombreEl?.value||'').trim();
  const dur=parseInt(durEl?.value||'50',10);
  if(!nombre || nombre.length<3){ alert('Nombre de sesión requerido (≥3)'); nombreEl?.focus(); return; }
  const {datos, error} = await Docente.crearSesion({nombre, duracion_minutos: dur});
  if(error){ alert(error.mensaje||'No se pudo crear sesión'); return; }
  // Docente.sesiones puede devolver objeto con id
  nombreEl.value=''; // limpiar
  await cargarSesiones();
  if(datos?.id) seleccionarSesion(datos.id, datos.estado||'borrador');
}

async function abrirSesion(){
  if(!sesionActivaId){ alert('Seleccioná una sesión'); return; }
  const {error} = await Docente.abrirSesion(sesionActivaId);
  if(error){ alert(error.mensaje||'No se pudo abrir'); return; }
  sesionActivaEstado='abierta';
  setText('sesion-estado','abierta');
  await cargarMonitoreo();
}
async function cerrarSesion(){
  if(!sesionActivaId){ alert('Seleccioná una sesión'); return; }
  if(!confirm('¿Cerrar sesión? Se finalizarán equipos abiertos (motivo cerrado).')) return;
  const {error} = await Docente.cerrarSesion(sesionActivaId);
  if(error){ alert(error.mensaje||'No se pudo cerrar'); return; }
  sesionActivaEstado='cerrada';
  setText('sesion-estado','cerrada');
  await cargarMonitoreo();
}

// Nómina: parse CSV nombre,correo,carne
function parseCSV(text){
  const filas=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const out=[];
  for(const linea of filas){
    const partes=linea.split(',').map(p=>p.trim());
    if(partes.length<3) continue;
    const [nombre, correo, carne]=partes;
    if(!nombre || !correo || !carne) continue;
    out.push({nombre, correo: correo.toLowerCase(), carne});
  }
  return out;
}
async function cargarNomina(){
  if(!sesionActivaId) return;
  // Docente.registrados no trae nómina completa; necesitamos fetch directo a nomina via api?
  // Por ahora usamos Docente.registrados como proxy y reconstruimos tabla desde v_desempeno? 
  // Simplificado: pedir a Docente.sesiones y luego fetch a /rest/v1/nomina via api.js si existe, sino mostrar vacío
  // Intentar fetch directo via peticion si Docente no expone
  const tbody=$('tabla-nomina')?.querySelector('tbody');
  if(!tbody) return;
  limpiarTabla(tbody);
  // Intentar obtener nómina via endpoint directo (fallback)
  try{
    const {Docente:_, ...rest} = await import('./api.js');
    // Usar peticion directa si está exportada, sino mostrar placeholder
  }catch{}
  // Por ahora mostrar mensaje para que docente use pegar y cargar
  // Si hay datos previos, el Docente.registrados nos da solo registrados, no toda nómina
}

async function handleCargarNomina(e){
  e.preventDefault();
  const ta=$('nomina-pegar');
  const err=$('nomina-pegar-error');
  const texto=(ta?.value||'').trim();
  if(!texto){ if(err) err.textContent='Pegá al menos una fila nombre,correo,carne'; return; }
  const filas=parseCSV(texto);
  if(filas.length===0){ if(err) err.textContent='Formato esperado: nombre,correo,carne — una fila por estudiante'; return; }
  if(err) err.textContent='';
  // Llamar a Docente API: crear en bulk via múltiples insert (el RLS permite docente insert en nomina)
  // Como Docente no tiene bulk, usamos fetch directo via peticion si disponible
  let ok=0, fail=0;
  for(const r of filas){
    const {error} = await (async()=>{
      // Intentar via api.js peticion directa a /rest/v1/nomina
      const {peticion} = await import('./api.js');
      // peticion es interno, pero si no está exportada, usar Docente como fallback no existe
      // Fallback: usar fetch manual con anon + token
      try{
        const sess = await Auth.sesion();
        const token = sess?.datos?.access_token || '';
        const url = (await import('./config.js')).SUPABASE_URL + '/rest/v1/nomina';
        const anon = (await import('./config.js')).SUPABASE_ANON_KEY;
        const res = await fetch(url, {
          method:'POST',
          headers:{
            'apikey': anon,
            'Authorization': `Bearer ${token}`,
            'Content-Type':'application/json',
            'Prefer':'return=minimal'
          },
          body: JSON.stringify({sesion_id: sesionActivaId, nombre: r.nombre, correo: r.correo, carne: r.carne})
        });
        if(!res.ok){
          const j=await res.json().catch(()=>null);
          return {error:{mensaje: j?.message||j?.hint||`Error ${res.status}`}};
        }
        return {datos:{}, error:null};
      }catch(ex){ return {error:{mensaje: String(ex)}}; }
    })();
    if(error) fail++; else ok++;
  }
  // Refrescar
  await cargarNomina();
  if(err) err.textContent = `Cargados ${ok} de ${filas.length} (${fail} fallidos — revisá duplicados de correo/carné)`;
  ta.value='';
  // Render tabla simple con filas cargadas
  renderTablaNominaLocal(filas.slice(0,20));
}

function renderTablaNominaLocal(filas){
  const tbody=$('tabla-nomina')?.querySelector('tbody');
  if(!tbody) return;
  // No limpiar todo, añadir demo de lo pegado
  filas.forEach(r=>{
    const tr=document.createElement('tr');
    const tdN=document.createElement('td'); tdN.textContent=r.nombre;
    const tdC=document.createElement('td'); tdC.textContent=r.correo;
    const tdCa=document.createElement('td'); tdCa.textContent=r.carne;
    const tdA=document.createElement('td');
    const esInst = r.correo.endsWith('@monicaherrera.edu.sv');
    tdA.textContent = esInst? '✓' : '⚠ no institucional';
    tdA.setAttribute('aria-label', esInst? 'Correo institucional':'Correo no institucional');
    tr.append(tdN, tdC, tdCa, tdA);
    tbody.appendChild(tr);
  });
}

async function cargarRegistrados(){
  if(!sesionActivaId) return;
  const ul=$('lista-registrados');
  if(!ul) return;
  ul.textContent='';
  const {datos, error} = await Docente.registrados(sesionActivaId);
  if(error){ ul.textContent = error.mensaje||'Sin registrados'; return; }
  const arr = Array.isArray(datos)? datos : [];
  if(arr.length===0){ ul.textContent='Sin estudiantes sin equipo'; return; }
  arr.forEach(p=>{
    const li=document.createElement('li');
    li.setAttribute('role','listitem');
    li.textContent = `${p.nombre||p.correo} · ${p.correo} · ${p.carne||''}`;
    const btn=document.createElement('button');
    btn.className='btn btn--ghost';
    btn.textContent='Asignar →';
    btn.addEventListener('click', ()=> promptAsignar(p));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

async function cargarEquipos(){
  if(!sesionActivaId) return;
  const cont=$('lista-equipos');
  if(!cont) return;
  cont.textContent='';
  // Usar Docente.desempeno como fuente de equipos (v_desempeno)
  const {datos, error} = await Docente.desempeno(sesionActivaId);
  if(error){ cont.textContent='Sin equipos'; return; }
  const arr = Array.isArray(datos)? datos : [];
  // Datos tiene equipo_id, equipo, integrantes, etc — deducir equipos únicos
  const equiposMap=new Map();
  arr.forEach(row=>{
    if(!equiposMap.has(row.equipo_id)) equiposMap.set(row.equipo_id, row);
  });
  if(equiposMap.size===0){ cont.textContent='Sin equipos creados'; return; }
  equiposMap.forEach(eq=>{
    const div=document.createElement('div');
    div.setAttribute('role','group');
    div.className='card card--equipo';
    const h=document.createElement('h4'); h.textContent=eq.equipo||eq.equipo_id;
    const p=document.createElement('p'); p.className='campo__ayuda'; p.textContent=eq.integrantes||'Sin integrantes';
    const actions=document.createElement('div'); actions.className='grupo-botones';
    const b1=document.createElement('button'); b1.className='btn btn--ghost'; b1.textContent='Ver';
    const b2=document.createElement('button'); b2.className='btn btn--ghost'; b2.textContent='Quitar';
    b2.addEventListener('click', ()=> desasignarPrompt(eq.equipo_id));
    actions.append(b1,b2);
    div.append(h,p,actions);
    cont.appendChild(div);
  });
}

function promptAsignar(perfil){
  const equipoId = prompt('ID del equipo (copiá el id de la lista de equipos):');
  if(!equipoId) return;
  Docente.asignar(equipoId.trim(), perfil.perfil_id||perfil.id).then(r=>{
    if(r.error) alert(r.error.mensaje||'No se pudo asignar');
    else { cargarRegistrados(); cargarEquipos(); cargarMonitoreo(); }
  });
}
function desasignarPrompt(equipoId){
  const perfilId = prompt('ID del perfil a quitar:');
  if(!perfilId) return;
  Docente.desasignar(equipoId, perfilId.trim()).then(r=>{
    if(r.error) alert(r.error.mensaje||'No se pudo desasignar');
    else { cargarRegistrados(); cargarEquipos(); cargarMonitoreo(); }
  });
}

async function cargarMonitoreo(){
  if(!sesionActivaId) return;
  const tbody=$('tabla-monitoreo')?.querySelector('tbody');
  if(!tbody) return;
  limpiarTabla(tbody);
  const {datos, error} = await Docente.desempeno(sesionActivaId);
  if(error){ const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=6; td.textContent=error.mensaje||'Sin datos'; tr.appendChild(td); tbody.appendChild(tr); return; }
  const arr=Array.isArray(datos)? datos: [];
  arr.forEach(row=>{
    const tr=document.createElement('tr');
    const vals=[row.equipo||row.equipo_id, row.integrantes||'', row.estaciones_resueltas??row.resueltas??'', row.intentos_totales??row.intentos??'', row.segundos_usados!=null? `${Math.floor((row.segundos_usados||0)/60)}m`:'', row.motivo_fin||row.estado||''];
    vals.forEach(v=>{
      const td=document.createElement('td'); td.textContent=String(v); tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function handleNuevoEquipo(){
  if(!sesionActivaId){ alert('Seleccioná una sesión primero'); return; }
  const nombre=prompt('Nombre del nuevo equipo:');
  if(!nombre) return;
  const {error} = await Docente.crearEquipo(sesionActivaId, nombre.trim());
  if(error) alert(error.mensaje||'No se pudo crear equipo');
  else { await cargarEquipos(); await cargarMonitoreo(); }
}

async function handleExportarCSV(){
  if(!sesionActivaId) return;
  const {datos, error} = await Docente.desempeno(sesionActivaId);
  if(error){ alert(error.mensaje||'No hay datos para exportar'); return; }
  const arr=Array.isArray(datos)? datos: [];
  if(arr.length===0){ alert('Sin datos'); return; }
  const headers=['equipo','integrantes','resueltas','intentos','segundos','motivo'];
  const rows=arr.map(r=>[
    `"${String(r.equipo||'').replace(/"/g,'""')}"`,
    `"${String(r.integrantes||'').replace(/"/g,'""')}"`,
    r.estaciones_resueltas??r.resueltas??0,
    r.intentos_totales??r.intentos??0,
    r.segundos_usados??0,
    r.motivo_fin||''
  ].join(','));
  const csv=[headers.join(','), ...rows].join('\n');
  const blob=new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`desempeno-${sesionActivaId}.csv`; a.click();
  URL.revokeObjectURL(url);
}

async function handleAnonimizar(){
  if(!sesionActivaId) return;
  if(!confirm('¿Anonimizar esta sesión? Se reemplazarán nombres/carnés/correos por marcadores. No se puede deshacer.')) return;
  const {datos, error} = await Docente.anonimizar(sesionActivaId);
  if(error) alert(error.mensaje||'Error al anonimizar');
  else alert(`Anonimizados ${datos?.perfiles_anonimizados??'–'} perfiles`);
}

function enlazarEventos(){
  $('form-sesion')?.addEventListener('submit', crearSesion);
  $('btn-nueva-sesion')?.addEventListener('click', ()=>{ $('sesion-nombre')?.focus(); window.scrollTo({top:0, behavior:'smooth'}); });
  $('btn-abrir-sesion')?.addEventListener('click', abrirSesion);
  $('btn-cerrar-sesion')?.addEventListener('click', cerrarSesion);
  $('form-nomina')?.addEventListener('submit', handleCargarNomina);
  $('btn-agregar-a-nomina')?.addEventListener('click', ()=>{
    const nombre=prompt('Nombre completo:'); if(!nombre) return;
    const correo=prompt('Correo:'); if(!correo) return;
    const carne=prompt('Carné:'); if(!carne) return;
    handleCargarNomina({preventDefault:()=>{}}); // fallback usa textarea, pero insertamos directo
    // Insert directo para el individual
    (async()=>{
      const {peticion} = await import('./api.js').catch(()=>({peticion:null}));
      if(peticion){
        const {error} = await (async()=>{
          const sess=await Auth.sesion(); const token=sess?.datos?.access_token||'';
          const cfg=await import('./config.js'); const url=cfg.SUPABASE_URL+'/rest/v1/nomina';
          const res=await fetch(url,{method:'POST', headers:{'apikey':cfg.SUPABASE_ANON_KEY,'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Prefer':'return=minimal'}, body: JSON.stringify({sesion_id: sesionActivaId, nombre: nombre.trim(), correo: correo.trim().toLowerCase(), carne: carne.trim()})});
          if(!res.ok){ const j=await res.json().catch(()=>null); return {error:{mensaje:j?.message||'Error'}}; } return {error:null};
        })();
        if(error) alert(error.mensaje); else cargarNomina();
      }
    })();
  });
  $('btn-nuevo-equipo')?.addEventListener('click', handleNuevoEquipo);
  $('btn-exportar-csv')?.addEventListener('click', handleExportarCSV);
  $('btn-anonimizar')?.addEventListener('click', handleAnonimizar);
  // Asignar/desasignar genéricos (por si hay selección)
  $('btn-asignar')?.addEventListener('click', ()=> alert('Seleccioná un estudiante sin equipo y luego Asignar →'));
  $('btn-desasignar')?.addEventListener('click', ()=> alert('Usá Quitar en cada equipo'));
  $('form-rubrica')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const rubrica=Object.fromEntries(fd.entries());
    // Requiere equipo seleccionado — por ahora tomar primer equipo
    const equipoId = document.querySelector('#lista-equipos [data-equipo-id]')?.dataset?.equipoId || prompt('ID del equipo a calificar:');
    if(!equipoId){ alert('Indicá el equipo'); return; }
    const {error} = await Docente.guardarCalificacion(equipoId, rubrica);
    if(error) alert(error.mensaje||'No se guardó'); else alert('Calificación guardada');
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initDocente);
else initDocente();
