// js/docente.js — Panel docente (te-panel / te-equipos / te-export)
// Vanilla type:module, usa Docente/Auth de api.js, textContent siempre (XSS §14.4)
import { Auth, Docente } from './api.js';

let sesionActivaId = null;
let sesionActivaEstado = 'borrador';
let equiposActuales = []; // [{id, nombre}] — se repuebla en cada pintarEquipos(), la usan los <select> de asignar y rúbrica
let desempenoActual = []; // filas crudas de Docente.desempeno() (v_desempeno) — la usa la "Evidencia de juego" de la rúbrica, sin pedir nada nuevo al servidor

function $(id){ return document.getElementById(id); }
function setText(id, v){ const el=$(id); if(el) el.textContent= v==null?'':String(v); }
function limpiarTabla(tbody){ while(tbody.firstChild) tbody.removeChild(tbody.firstChild); }

// Reemplaza alert() para crear/abrir/cerrar sesión (ver comentario en
// docente.html junto a #docente-mensaje): un confirm() seguido de un
// alert() casi inmediato puede hacer que Chrome descarte el segundo
// diálogo — el error "se veía y se cerraba solo". Este mensaje vive en
// la página, no depende del timing de los diálogos nativos.
let mensajeDocenteTimer = null;
function mostrarMensajeDocente(texto, tipo){
  const el = $('docente-mensaje');
  if(!el) return;
  clearTimeout(mensajeDocenteTimer);
  el.textContent = texto;
  el.classList.toggle('border-primary', tipo==='ok');
  el.classList.toggle('text-primary', tipo==='ok');
  el.classList.toggle('bg-primary/10', tipo==='ok');
  el.classList.toggle('border-error', tipo!=='ok');
  el.classList.toggle('text-error', tipo!=='ok');
  el.classList.toggle('bg-error/10', tipo!=='ok');
  el.removeAttribute('hidden');
  // Bug real reportado 2026-08-26: el scrollIntoView() de acá jalaba la
  // página entera hasta el banner (arriba del todo) CADA VEZ que cualquier
  // botón del panel terminaba una acción — asignar, generar código,
  // cargar nómina, lo que sea. Si estabas trabajando en "Equipos" más
  // abajo, cada clic te mandaba de vuelta arriba. El banner sigue
  // apareciendo (aria-live="assertive" ya lo anuncia a lectores de
  // pantalla sin necesidad de mover el scroll) — solo dejó de forzar la
  // vista.
  // Se mantiene visible; se limpia sola tras un rato para no ensuciar la
  // pantalla en sesiones largas, pero con tiempo de sobra para leerla.
  mensajeDocenteTimer = setTimeout(()=> el.setAttribute('hidden',''), 8000);
}

async function initDocente(){
  const ses = await Auth.sesion().catch(()=>null);
  const datos = ses?.datos;
  // Bug real encontrado 2026-08-26: esta pantalla nunca comprobaba el rol
  // de la sesión activa. Si el navegador tenía la cookie de un ESTUDIANTE
  // (p.ej. quedó logueado como apuntador/a probando el acceso por código de
  // equipo), el panel docente lo mostraba igual — el badge de la barra
  // lateral terminaba con el nombre de un integrante del equipo en vez del
  // docente real. Ahora se exige rol==='docente' para entrar, igual que
  // "sin sesión" — no es un caso silencioso, redirige con aviso.
  if(!datos || ses?.error || datos.rol!=='docente'){
    const aviso=$('sesion-estado');
    if(aviso) aviso.textContent = (datos && datos.rol!=='docente') ? 'Esta cuenta no es de docente.' : 'Necesitás iniciar sesión';
    setTimeout(()=> window.location.href='index.html#vista-acceso', 1200);
    return;
  }
  // Con quién sesión entró debe verse todo el rato, no solo al loguearse —
  // el badge de la barra lateral (antes "CGC · Auditoría" fijo) ahora
  // muestra el correo real, visible en cualquier sección del panel.
  try{
    const etiqueta = $('docente-usuario-actual');
    if(etiqueta && datos?.correo) etiqueta.textContent = (datos.nombre && datos.nombre!==datos.correo) ? `${datos.nombre} · ${datos.correo}` : datos.correo;
  }catch{}
  // super-admin: mostrar consola si es fglopez
  try{
    const correo = (datos?.correo||datos?.email||'').toLowerCase();
    if(correo==='fglopez@monicaherrera.edu.sv'){
      const c=$('consola-super-admin'); if(c) c.removeAttribute('hidden');
      cargarConsolaSuperAdmin();
    }
  }catch{}
  await cargarSesiones();
  enlazarEventos();
  // Auto-refresh monitoreo cada 15s si hay sesión activa.
  // Se pausa cuando la pestaña no está visible (evita llamadas API inútiles
  // en segundo plano) y se refresca de inmediato al volver a primer plano.
  setInterval(()=>{
    if(sesionActivaId && document.visibilityState==='visible') cargarEquiposYMonitoreo();
  }, 15000);
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='visible' && sesionActivaId) cargarEquiposYMonitoreo();
  });
}

async function cargarSesiones(){
  const {datos, error} = await Docente.sesiones();
  const lista=$('lista-sesiones');
  if(!lista) return;
  limpiarTabla(lista); // ul, no tbody
  if(error){ lista.textContent = error.mensaje||'Error al cargar sesiones'; return; }
  const sesiones = Array.isArray(datos)? datos : (datos?.data||[]);
  if(sesiones.length===0){
    const li=document.createElement('li'); li.textContent='Sin sesiones. Creá la primera.'; li.setAttribute('role','listitem'); lista.appendChild(li);
    // Sin esto, nómina/registrados/equipos se quedaban en blanco sin
    // ninguna explicación (ni "cargando" ni "vacío") cuando no hay ninguna
    // sesión — parecía que la carga de nómina estaba rota en vez de que
    // simplemente no había dónde cargarla todavía.
    sesionActivaId = null;
    sincronizarBotonVerSesion();
    const tbodyNom=$('tabla-nomina')?.querySelector('tbody');
    if(tbodyNom){ limpiarTabla(tbodyNom); const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=4; td.textContent='Creá una sesión arriba para empezar a cargar nómina.'; tr.appendChild(td); tbodyNom.appendChild(tr); }
    const regs=$('lista-registrados'); if(regs) regs.textContent='Creá una sesión primero.';
    const eqCont=$('lista-equipos'); if(eqCont) eqCont.textContent='Creá una sesión primero.';
    return;
  }
  sesiones.forEach(s=>{
    const li=document.createElement('li');
    li.setAttribute('role','listitem');
    const btn=document.createElement('button');
    // `.btn`/`.btn--ghost` eran de styles.css (era Supabase) — esta página ya
    // no lo importa (Tailwind literal de Stitch, CONTRACT §8), así que esas
    // clases no aplicaban nada: la fila se veía como texto plano, sin
    // apariencia de botón ni indicio visual de cuál sesión está seleccionada
    // (aria-pressed se seteaba bien, pero sin ningún estilo que lo lea).
    btn.className='w-full text-left px-4 py-3 border border-audit-border rounded transition-colors font-evidence-data text-sm hover:border-primary hover:bg-surface-container-high aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary';
    btn.type='button';
    btn.textContent = `${s.nombre} · ${s.estado} · ${s.duracion_minutos||50}′`;
    btn.dataset.sesionId = s.id;
    // cargarSesiones() se vuelve a llamar tras abrir/cerrar para refrescar el
    // texto "· estado ·" de cada fila — reconstruye la lista entera, así que
    // hay que reponer aria-pressed acá o el resaltado desaparecería aunque
    // sesionActivaId siga apuntando a la misma sesión.
    btn.setAttribute('aria-pressed', s.id===sesionActivaId ? 'true':'false');
    btn.addEventListener('click', ()=> seleccionarSesion(s.id, s.estado));
    li.appendChild(btn);
    lista.appendChild(li);
  });
  // Auto-seleccionar la más reciente si no hay activa
  if(!sesionActivaId && sesiones[0]) seleccionarSesion(sesiones[0].id, sesiones[0].estado);
}

// textContent siempre (§14.4) — evita innerHTML incluso para encabezados
// estáticos de tabla, para no romper la convención del resto del archivo.
function construirEncabezadoTabla(caption, columnas){
  const frag=document.createDocumentFragment();
  const cap=document.createElement('caption'); cap.className='sr-only'; cap.textContent=caption;
  frag.appendChild(cap);
  const thead=document.createElement('thead'); thead.className='text-on-surface-variant uppercase text-xs';
  const tr=document.createElement('tr');
  columnas.forEach(c=>{ const th=document.createElement('th'); th.className='p-2 font-normal'; th.textContent=c; tr.appendChild(th); });
  thead.appendChild(tr);
  frag.appendChild(thead);
  return frag;
}

// 2026-08-26: "la consola solo es un adorno" — cierto, #consola-contenido
// nunca se llenaba de nada. Docente.sesiones() ya trae TODAS las sesiones
// de TODOS los docentes para fglopez (RLS de sql/06-superadmin.sql); acá
// se suma el mismo alcance para equipos y se pintan las dos tablas.
async function cargarConsolaSuperAdmin(){
  const cont = $('consola-contenido');
  if(!cont) return;
  cont.textContent='Cargando…';
  const [sesionesR, equiposR] = await Promise.all([Docente.sesiones(), Docente.todosLosEquipos()]);
  cont.textContent='';
  if(sesionesR.error || equiposR.error){
    const p=document.createElement('p'); p.className='text-error'; p.textContent = sesionesR.error?.mensaje||equiposR.error?.mensaje||'No se pudo cargar la consola.';
    cont.appendChild(p);
    return;
  }
  const sesiones = Array.isArray(sesionesR.datos) ? sesionesR.datos : [];
  const equipos = Array.isArray(equiposR.datos) ? equiposR.datos : [];

  const resumen=document.createElement('p'); resumen.className='text-on-surface-variant mb-3';
  resumen.textContent = `${sesiones.length} sesión(es) · ${equipos.length} equipo(s) — todos los docentes.`;
  cont.appendChild(resumen);

  const tablaSesiones=document.createElement('table'); tablaSesiones.className='w-full text-left mb-6';
  tablaSesiones.appendChild(construirEncabezadoTabla('Todas las sesiones', ['Sesión','Docente (id)','Estado','Creada']));
  const tbodyS=document.createElement('tbody'); tbodyS.className='divide-y divide-audit-border';
  sesiones.forEach(s=>{
    const tr=document.createElement('tr');
    [s.nombre, s.docente_id, s.estado, s.creada_en ? new Date(s.creada_en).toLocaleString('es-SV') : ''].forEach(v=>{
      const td=document.createElement('td'); td.className='p-2'; td.textContent=String(v??''); tr.appendChild(td);
    });
    tbodyS.appendChild(tr);
  });
  tablaSesiones.appendChild(tbodyS);
  cont.appendChild(tablaSesiones);

  const tablaEquipos=document.createElement('table'); tablaEquipos.className='w-full text-left';
  tablaEquipos.appendChild(construirEncabezadoTabla('Todos los equipos', ['Equipo','Sesión','Integrantes']));
  const tbodyE=document.createElement('tbody'); tbodyE.className='divide-y divide-audit-border';
  equipos.forEach(eq=>{
    const tr=document.createElement('tr');
    [eq.nombre, eq.sesion_nombre, eq.integrantes].forEach(v=>{
      const td=document.createElement('td'); td.className='p-2'; td.textContent=String(v??''); tr.appendChild(td);
    });
    tbodyE.appendChild(tr);
  });
  tablaEquipos.appendChild(tbodyE);
  cont.appendChild(tablaEquipos);
}

// "Ver sesión en curso" (2026-08-26): solo tiene sentido cuando hay algo
// en curso — se muestra únicamente con la sesión abierta. Baja a Monitoreo
// en vivo, que ya se refresca solo cada 15s mientras hay sesión activa.
function sincronizarBotonVerSesion(){
  const btn = $('btn-ver-sesion');
  if(btn){
    if(sesionActivaId && sesionActivaEstado==='abierta') btn.removeAttribute('hidden');
    else btn.setAttribute('hidden','');
  }
  // El estado de la sesión ya salía en la lista ("· borrador ·"), pero como
  // dato suelto: no decía que en borrador los estudiantes NO pueden jugar.
  // Desde el lado de ellos el síntoma era "la sesión ya fue cerrada por el
  // docente", que manda a buscar el problema al lado equivocado. Este aviso
  // va pegado a los botones, no en el banner de arriba de la página, porque
  // ahí no se lee.
  const aviso = $('sesion-aviso-estado');
  if(!aviso) return;
  const textos = {
    borrador: 'Esta sesión está en borrador: tus estudiantes todavía no pueden jugar. Pulsá «Abrir sesión» cuando quieras que empiecen.',
    cerrada:  'Esta sesión está cerrada: nadie puede seguir jugando. Podés volver a abrirla con «Abrir sesión».'
  };
  const texto = sesionActivaId ? textos[sesionActivaEstado] : null;
  if(texto){ aviso.textContent = texto; aviso.removeAttribute('hidden'); }
  else { aviso.textContent = ''; aviso.setAttribute('hidden',''); }
}

async function seleccionarSesion(id, estado){
  sesionActivaId=id;
  sesionActivaEstado=estado||'borrador';
  setText('sesion-estado', sesionActivaEstado);
  sincronizarBotonVerSesion();
  // Resaltar
  document.querySelectorAll('#lista-sesiones button').forEach(b=>{
    b.setAttribute('aria-pressed', b.dataset.sesionId===id ? 'true':'false');
  });
  // cargarRegistrados() pinta un <select> de equipos por fila usando
  // equiposActuales (repoblada por cargarEquiposYMonitoreo) — si corrieran
  // en paralelo, el select podía nacer vacío o desactualizado por una
  // carrera de datos. Nómina sí es independiente, esa se queda en paralelo.
  await Promise.all([cargarNomina(), cargarEquiposYMonitoreo()]);
  await cargarRegistrados();
}

async function crearSesion(e){
  e.preventDefault();
  const nombreEl=$('sesion-nombre');
  const durEl=$('sesion-duracion');
  const nombre=(nombreEl?.value||'').trim();
  const dur=parseInt(durEl?.value||'50',10);
  if(!nombre || nombre.length<3){ mostrarMensajeDocente('Nombre de sesión requerido (≥3 caracteres).'); nombreEl?.focus(); return; }
  const {datos, error} = await Docente.crearSesion({nombre, duracion_minutos: dur});
  if(error){ mostrarMensajeDocente(error.mensaje||'No se pudo crear la sesión.'); return; }
  mostrarMensajeDocente(`Sesión "${nombre}" creada.`, 'ok');
  // Docente.sesiones puede devolver objeto con id
  nombreEl.value=''; // limpiar
  await cargarSesiones();
  // cargarSesiones() ya auto-selecciona la primera sesión cuando no había
  // ninguna activa (suele ser la recién creada, por order=creada_en.desc).
  // Solo forzar la selección si terminó en otra distinta, para no disparar
  // una segunda ronda duplicada de llamadas (nómina/registrados/equipos/monitoreo).
  if(datos?.id && sesionActivaId!==datos.id) seleccionarSesion(datos.id, datos.estado||'borrador');
}

async function abrirSesion(){
  if(!sesionActivaId){ mostrarMensajeDocente('Seleccioná una sesión primero.'); return; }
  const {error} = await Docente.abrirSesion(sesionActivaId);
  if(error){ mostrarMensajeDocente(error.mensaje||'No se pudo abrir la sesión.'); return; }
  sesionActivaEstado='abierta';
  setText('sesion-estado','abierta');
  sincronizarBotonVerSesion();
  mostrarMensajeDocente('Sesión abierta.', 'ok');
  await cargarSesiones();
  await cargarEquiposYMonitoreo();
}
async function cerrarSesion(){
  if(!sesionActivaId){ mostrarMensajeDocente('Seleccioná una sesión primero.'); return; }
  if(!confirm('¿Cerrar sesión? Se finalizarán equipos abiertos (motivo cerrado).')) return;
  const {error} = await Docente.cerrarSesion(sesionActivaId);
  if(error){ mostrarMensajeDocente(error.mensaje||'No se pudo cerrar la sesión.'); return; }
  sesionActivaEstado='cerrada';
  setText('sesion-estado','cerrada');
  sincronizarBotonVerSesion();
  mostrarMensajeDocente('Sesión cerrada.', 'ok');
  await cargarSesiones();
  await cargarEquiposYMonitoreo();
}

// 2026-08-26: borra la sesión de verdad — distinto de cerrarSesion(), que
// solo cambia el estado y conserva todo. Irreversible (equipos, nómina,
// códigos de esa sesión desaparecen en cascada), por eso el confirm() es
// más explícito que el de cerrar.
async function borrarSesion(){
  if(!sesionActivaId){ mostrarMensajeDocente('Seleccioná una sesión primero.'); return; }
  const nombreSesion = document.querySelector(`#lista-sesiones button[aria-pressed="true"]`)?.textContent?.split('·')[0]?.trim() || 'esta sesión';
  if(!confirm(`¿Borrar "${nombreSesion}" para siempre? Se pierden sus equipos, nómina y códigos de acceso. Esto NO se puede deshacer — si solo querés dejar de usarla, usá "Cerrar" en vez de esto.`)) return;
  const idBorrada = sesionActivaId;
  const {error} = await Docente.borrarSesion(idBorrada);
  if(error){ mostrarMensajeDocente(error.mensaje||'No se pudo borrar la sesión.'); return; }
  mostrarMensajeDocente('Sesión borrada.', 'ok');
  sesionActivaId = null;
  await cargarSesiones(); // auto-selecciona otra si queda alguna; si no, listas vacías abajo
  if(!sesionActivaId){ // no quedó ninguna sesión: limpiar los paneles dependientes a mano
    const regs=$('lista-registrados'); if(regs) limpiarTabla(regs);
    const eqCont=$('lista-equipos'); if(eqCont) eqCont.textContent='Sin equipos creados';
    const tbody=$('tabla-monitoreo')?.querySelector('tbody'); if(tbody) limpiarTabla(tbody);
  }
}

// Nómina: parse CSV nombre,correo,carne
// Bug real encontrado 2026-08-26: una línea sin una de las dos comas (p.ej.
// "Orlando orlando@test1.edu.sv, 2026-002", falta la coma entre nombre y
// correo) caía en `partes.length<3` y se descartaba con un `continue`
// silencioso — ni contaba como fallo ni aparecía en ningún lado. Se veía
// como "parece que no cargó a Orlando" sin ninguna pista de por qué. Ahora
// se devuelven también las líneas inválidas con su número, para señalarlas.
function parseCSV(text){
  const lineas=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const filas=[];
  const invalidas=[];
  lineas.forEach((linea, i)=>{
    const partes=linea.split(',').map(p=>p.trim());
    const [nombre, correo, carne]=partes;
    if(partes.length<3 || !nombre || !correo || !carne){
      invalidas.push(`Línea ${i+1} ("${linea}"): faltan datos o una coma — se esperaba nombre,correo,carne`);
    } else {
      filas.push({nombre, correo: correo.toLowerCase(), carne});
    }
  });
  return { filas, invalidas };
}
// Pinta #tabla-nomina con lo que ya existe en el servidor para la sesión
// activa — vía Docente.nomina() (CONTRACT §5/§8), no un stub local.
async function cargarNomina(){
  if(!sesionActivaId) return;
  const tbody=$('tabla-nomina')?.querySelector('tbody');
  if(!tbody) return;
  limpiarTabla(tbody);
  const {datos, error} = await Docente.nomina(sesionActivaId);
  if(error){
    const tr=document.createElement('tr'); const td=document.createElement('td');
    td.colSpan=4; td.textContent=error.mensaje||'No se pudo cargar la nómina';
    tr.appendChild(td); tbody.appendChild(tr);
    return;
  }
  renderTablaNomina(Array.isArray(datos)? datos : []);
}

async function handleCargarNomina(e){
  e.preventDefault();
  if(!sesionActivaId){ mostrarMensajeDocente('Seleccioná o creá una sesión arriba antes de cargar nómina.'); return; }
  const ta=$('nomina-pegar');
  const err=$('nomina-pegar-error');
  const texto=(ta?.value||'').trim();
  if(!texto){ if(err) err.textContent='Pegá al menos una fila nombre,correo,carne'; return; }
  const { filas, invalidas } = parseCSV(texto);
  if(filas.length===0){
    if(err) err.textContent = invalidas.length
      ? `Ninguna línea tiene el formato correcto. ${invalidas.join(' · ')}`
      : 'Formato esperado: nombre,correo,carne — una fila por estudiante';
    return;
  }
  if(err) err.textContent='';
  let ok=0; const fallos=[];
  for(const r of filas){
    const {error} = await Docente.agregarANomina(sesionActivaId, r);
    // Antes solo se contaba (fail++) — no decía a quién ni por qué, así que
    // un duplicado real de correo/carné era indistinguible de una línea mal
    // formada que ni siquiera había llegado a intentarse.
    if(error) fallos.push(`${r.nombre} (${r.correo}): ${error.mensaje||'no se pudo guardar'}`); else ok++;
  }
  // Los estudiantes recién agregados a la nómina también deben aparecer en
  // "Registrados sin equipo" de inmediato — antes solo se refrescaba la
  // tabla de nómina, y "sin equipo" se quedaba con lo que tenía cargado
  // desde la última vez que se seleccionó la sesión (parecía que no se
  // habían guardado hasta recargar la página o cambiar de sesión y volver).
  await Promise.all([cargarNomina(), cargarRegistrados()]);
  const partes = [`Cargados ${ok} de ${filas.length} líneas con formato válido.`];
  if(invalidas.length) partes.push(`${invalidas.length} línea(s) ignorada(s) por formato: ${invalidas.join(' · ')}`);
  if(fallos.length) partes.push(`${fallos.length} fallaron al guardar: ${fallos.join(' · ')}`);
  if(err) err.textContent = partes.join(' ');
  ta.value='';
}

function renderTablaNomina(filas){
  const tbody=$('tabla-nomina')?.querySelector('tbody');
  if(!tbody) return;
  limpiarTabla(tbody);
  if(filas.length===0){
    const tr=document.createElement('tr'); const td=document.createElement('td');
    td.colSpan=4; td.textContent='Sin nómina cargada todavía.';
    tr.appendChild(td); tbody.appendChild(tr);
    return;
  }
  filas.forEach(r=>{
    const tr=document.createElement('tr');
    const tdN=document.createElement('td'); tdN.textContent=r.nombre;
    const tdC=document.createElement('td'); tdC.textContent=r.correo;
    const tdCa=document.createElement('td'); tdCa.textContent=r.carne;
    const tdA=document.createElement('td');
    const esInst = String(r.correo||'').endsWith('@monicaherrera.edu.sv');
    tdA.textContent = esInst? '✓' : '⚠ no institucional';
    tdA.setAttribute('aria-label', esInst? 'Correo institucional':'Correo no institucional');
    tr.append(tdN, tdC, tdCa, tdA);
    tbody.appendChild(tr);
  });
}

// 2026-08-26: reemplaza promptAsignar() (prompt() nativo pidiendo escribir
// un número de una lista) por un <select> real por fila — bug reportado
// "no puedo asignar a X" que no se podía reproducir por API/servidor (el
// backend asignaba bien); el sospechoso era ese prompt: cualquier typo,
// click en Cancelar, o escribir el nombre en vez del número lo mandaba a
// "Número inválido." sin más pista. Un <select> con los nombres reales no
// deja margen para escribir mal nada.
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
    li.className='flex flex-wrap items-center gap-2';
    const label=document.createElement('span');
    label.className='flex-1 min-w-[10rem]';
    label.textContent = `${p.nombre||p.correo} · ${p.correo} · ${p.carne||''}`;
    li.appendChild(label);

    const select=document.createElement('select');
    select.className='bg-surface-graphite border border-audit-border text-on-surface font-evidence-data text-xs rounded px-2 py-1.5 max-w-[9rem]';
    select.setAttribute('aria-label', `Equipo para ${p.nombre||p.correo}`);
    if(equiposActuales.length===0){
      const opt=document.createElement('option'); opt.textContent='Sin equipos'; opt.disabled=true; opt.selected=true;
      select.appendChild(opt);
    } else {
      equiposActuales.forEach(eq=>{
        const opt=document.createElement('option'); opt.value=eq.id; opt.textContent=eq.nombre;
        select.appendChild(opt);
      });
    }
    li.appendChild(select);

    const btn=document.createElement('button');
    btn.className='px-3 py-1.5 border border-primary text-primary rounded text-xs font-evidence-data uppercase hover:bg-primary hover:text-surface-graphite transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
    btn.type='button';
    btn.textContent='Asignar →';
    btn.disabled = equiposActuales.length===0;
    btn.addEventListener('click', async ()=>{
      const equipoId = select.value;
      if(!equipoId){ mostrarMensajeDocente('Elegí un equipo primero.'); return; }
      const equipo = equiposActuales.find(e=>e.id===equipoId);
      btn.disabled=true;
      const body = p.perfilId ? { perfilId: p.perfilId } : { nominaId: p.nominaId };
      const {error} = await Docente.asignar(equipoId, body);
      btn.disabled=false;
      if(error) mostrarMensajeDocente(error.mensaje||'No se pudo asignar.');
      else {
        mostrarMensajeDocente(`${p.nombre||p.correo} asignado a "${equipo?.nombre||''}".`, 'ok');
        await cargarEquiposYMonitoreo();
        await cargarRegistrados();
      }
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function pintarEquipos(datos, error){
  const cont=$('lista-equipos');
  if(!cont) return;
  cont.textContent='';
  const avisoSin = $('aviso-sin-apuntador');
  if(error){ cont.textContent='Sin equipos'; if(avisoSin) avisoSin.setAttribute('hidden',''); equiposActuales=[]; return; }
  const arr = Array.isArray(datos)? datos : [];
  const equiposMap=new Map();
  arr.forEach(row=>{
    const id = row.equipo_id || row.id;
    if(!id) return;
    // v_desempeno trae el nombre como `equipo_nombre` (§2.2) — antes esto
    // leía `row.equipo`/`row.nombre`, que no existen ahí, y terminaba
    // mostrando el UUID crudo como "nombre" del equipo.
    if(!equiposMap.has(id)) equiposMap.set(id, { equipo_id:id, equipo: row.equipo_nombre||row.equipo||row.nombre||id, miembros: Array.isArray(row.integrantes_detalle) ? row.integrantes_detalle : [] });
  });
  equiposActuales = Array.from(equiposMap.values()).map(eq=>({ id: eq.equipo_id, nombre: eq.equipo }));
  if(equiposMap.size===0){ cont.textContent='Sin equipos creados'; if(avisoSin) avisoSin.setAttribute('hidden',''); return; }
  let algunoSinApuntador = false;
  equiposMap.forEach(eq=>{
    const div=document.createElement('div');
    div.setAttribute('role','group');
    div.setAttribute('aria-labelledby', `equipo-${eq.equipo_id}-nombre`);
    div.className='bg-surface-container border border-audit-border rounded p-3 space-y-2';
    const h=document.createElement('h4'); h.id=`equipo-${eq.equipo_id}-nombre`; h.className='font-evidence-data font-bold'; h.textContent=eq.equipo;
    div.appendChild(h);
    // Integrantes
    const miembros = Array.isArray(eq.miembros) ? eq.miembros : null;
    if(miembros && miembros.length){
      const tieneApuntador = miembros.some(m=> m.es_apuntador);
      if(!tieneApuntador) algunoSinApuntador = true;
      miembros.forEach(m=>{
        const row=document.createElement('div'); row.className='flex items-center justify-between py-1';
        const label=document.createElement('label'); label.className='flex items-center gap-2 cursor-pointer';
        const radio=document.createElement('input'); radio.type='radio'; radio.name=`apuntador-${eq.equipo_id}`; radio.value=m.perfil_id||m.id;
        radio.checked = !!m.es_apuntador;
        radio.setAttribute('aria-label', `Marcar ${m.nombre||m.correo} como apuntador de ${eq.equipo}`);
        radio.addEventListener('change', async()=>{
          if(!radio.checked) return;
          radio.disabled=true;
          const {error} = await Docente.marcarApuntador(eq.equipo_id, radio.value);
          radio.disabled=false;
          if(error) alert(error.mensaje||'No se pudo marcar apuntador');
          else await cargarEquiposYMonitoreo();
        });
        // también usar id para control-apuntador: el primero marca el container
        radio.id = `control-apuntador-${eq.equipo_id}-${radio.value}`;
        // para contrato: al menos un control con id control-apuntador (usamos el del apuntador o primero)
        if(!div.querySelector('#control-apuntador')) radio.id = 'control-apuntador';
        label.appendChild(radio);
        const span=document.createElement('span'); span.className='font-evidence-data text-sm'; span.textContent = `${m.nombre||m.correo}${m.es_apuntador?' ★ apuntador/a':''}`;
        label.appendChild(span);
        row.appendChild(label);
        const btnQ=document.createElement('button'); btnQ.type='button'; btnQ.className='text-on-surface-variant hover:text-error p-1'; btnQ.title='Quitar';
        const ico=document.createElement('span'); ico.className='material-symbols-outlined text-sm'; ico.textContent='close'; btnQ.appendChild(ico);
        // Quitar a alguien de un equipo debe devolverlo a "Registrados sin
        // equipo" de inmediato — antes solo se refrescaban los equipos, así
        // que la persona quitada desaparecía de todos lados hasta recargar.
        btnQ.addEventListener('click', async ()=>{ const r = await Docente.desasignar(eq.equipo_id, m.perfil_id||m.id); if(r.error) alert(r.error.mensaje); else { await cargarEquiposYMonitoreo(); await cargarRegistrados(); } });
        row.appendChild(btnQ);
        div.appendChild(row);
      });
      if(!tieneApuntador){
        const warn=document.createElement('p'); warn.className='font-label-sm text-error'; warn.textContent='Sin apuntador — marca uno.'; div.appendChild(warn);
      }
    } else {
      const p=document.createElement('p'); p.className='font-evidence-data text-sm text-on-surface-variant'; p.textContent='Sin integrantes';
      div.appendChild(p);
      algunoSinApuntador = true;
      const warn=document.createElement('p'); warn.className='font-label-sm text-error'; warn.textContent='Sin apuntador'; div.appendChild(warn);
    }
    const actions=document.createElement('div'); actions.className='flex gap-2 pt-2 border-t border-audit-border mt-2';
    const bQ=document.createElement('button'); bQ.type='button'; bQ.className='text-sm border border-audit-border px-3 py-1 hover:border-primary hover:text-primary'; bQ.textContent='Quitar integrante'; bQ.addEventListener('click', ()=> desasignarPrompt(eq.equipo_id));
    actions.appendChild(bQ);
    // 2026-08-26: no existía ninguna forma de borrar un equipo entero (solo
    // integrante por integrante) — "tampoco se pueden eliminar los
    // equipos". Irreversible (integrantes, progreso, código de acceso de
    // ESE equipo desaparecen en cascada), por eso el confirm() explícito.
    const bBorrar=document.createElement('button'); bBorrar.type='button'; bBorrar.className='text-sm border border-error text-error px-3 py-1 hover:bg-error hover:text-on-error'; bBorrar.textContent='Borrar equipo';
    bBorrar.addEventListener('click', async ()=>{
      if(!confirm(`¿Borrar "${eq.equipo}" para siempre? Se pierden sus integrantes, progreso y código de acceso. Esto NO se puede deshacer.`)) return;
      const {error} = await Docente.borrarEquipo(eq.equipo_id);
      if(error) mostrarMensajeDocente(error.mensaje||'No se pudo borrar el equipo.');
      else { mostrarMensajeDocente(`Equipo "${eq.equipo}" borrado.`, 'ok'); await cargarEquiposYMonitoreo(); await cargarRegistrados(); }
    });
    actions.appendChild(bBorrar);
    div.appendChild(actions);

    // Código de acceso del equipo (2026-08-26) — reemplaza el correo OTP para
    // estudiantes. El código en claro solo existe en la respuesta de este
    // POST; después queda solo su hash en la base, sin forma de volver a
    // mostrarlo sin regenerarlo (por eso la caja de abajo se queda pintada
    // en la página hasta que el docente la cierre, no es un toast que pasa).
    const codigoBox=document.createElement('div'); codigoBox.className='pt-2 border-t border-audit-border mt-2';
    const btnCod=document.createElement('button');
    btnCod.type='button';
    btnCod.className='w-full border border-primary text-primary rounded py-2 text-sm font-evidence-data uppercase hover:bg-primary hover:text-surface-graphite transition-colors flex items-center justify-center gap-2';
    const icoCod=document.createElement('span'); icoCod.className='material-symbols-outlined text-sm'; icoCod.setAttribute('aria-hidden','true'); icoCod.textContent='vpn_key';
    btnCod.append(icoCod, 'Generar código de acceso');
    const resultado=document.createElement('div'); resultado.className='mt-2 hidden';
    btnCod.addEventListener('click', async ()=>{
      btnCod.disabled=true;
      const {datos, error} = await Docente.generarCodigoEquipo(eq.equipo_id);
      btnCod.disabled=false;
      if(error || !datos?.codigo){ mostrarMensajeDocente(error?.mensaje||'No se pudo generar el código.'); return; }
      resultado.classList.remove('hidden');
      resultado.textContent='';
      const venceTxt = new Date(datos.expiraEn).toLocaleString('es-SV', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
      const cajaCodigo=document.createElement('div');
      cajaCodigo.className='bg-surface-document text-text-on-document p-3 rounded space-y-1';
      const etiqueta=document.createElement('p'); etiqueta.className='font-label-sm text-label-sm uppercase text-on-surface-variant'; etiqueta.textContent=`Código de "${eq.equipo}" — copialo y mandalo vos por tu correo. Vence ${venceTxt}.`;
      const codigoGrande=document.createElement('p'); codigoGrande.className='font-stamp-lg text-2xl tracking-widest'; codigoGrande.textContent=datos.codigo;
      cajaCodigo.append(etiqueta, codigoGrande);
      resultado.appendChild(cajaCodigo);
      mostrarMensajeDocente(`Código generado para "${eq.equipo}".`, 'ok');
    });
    codigoBox.append(btnCod, resultado);
    div.appendChild(codigoBox);

    cont.appendChild(div);
  });
  if(avisoSin){
    if(algunoSinApuntador) avisoSin.removeAttribute('hidden'); else avisoSin.setAttribute('hidden','');
  }
}

function desasignarPrompt(equipoId){
  const perfilId = prompt('ID del perfil a quitar:');
  if(!perfilId) return;
  Docente.desasignar(equipoId, perfilId.trim()).then(async r=>{
    if(r.error) alert(r.error.mensaje||'No se pudo desasignar');
    else { await cargarEquiposYMonitoreo(); await cargarRegistrados(); }
  });
}

function pintarMonitoreo(datos, error){
  const tbody=$('tabla-monitoreo')?.querySelector('tbody');
  if(!tbody) return;
  limpiarTabla(tbody);
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

// `lista-equipos` y `tabla-monitoreo` se construyen ambos a partir de
// Docente.desempeno() (v_desempeno): antes cada uno pedía el mismo endpoint
// por separado (cargarEquipos + cargarMonitoreo), duplicando la llamada a la
// API cada vez que se refrescaban juntos. Ahora se pide una sola vez y se
// pinta en las dos vistas.
async function cargarEquiposYMonitoreo(){
  if(!sesionActivaId) return;
  const {datos, error} = await Docente.desempeno(sesionActivaId);
  desempenoActual = Array.isArray(datos) ? datos : [];
  pintarEquipos(datos, error);
  pintarMonitoreo(datos, error);
  sincronizarSelectRubrica();
}

// 2026-08-26: "la rúbrica debería ser por equipo, se debería poder
// seleccionar el equipo". Antes el submit buscaba un `data-equipo-id` que
// NINGÚN elemento del DOM tenía — siempre caía al prompt() pidiendo un
// UUID a mano. Este <select> reemplaza eso con los equipos reales; se
// repuebla junto con equiposActuales para no quedar desactualizado.
function sincronizarSelectRubrica(){
  const sel = $('rubrica-equipo');
  if(!sel) return;
  const previo = sel.value;
  sel.textContent='';
  const optVacia=document.createElement('option'); optVacia.value=''; optVacia.textContent='— Elegí un equipo —';
  sel.appendChild(optVacia);
  equiposActuales.forEach(eq=>{
    const opt=document.createElement('option'); opt.value=eq.id; opt.textContent=eq.nombre;
    sel.appendChild(opt);
  });
  // conservar la selección si el equipo elegido sigue existiendo tras el refresco
  if(previo && equiposActuales.some(eq=>eq.id===previo)) sel.value=previo;
  pintarEvidenciaRubrica();
}

// Progreso real del equipo elegido — reutiliza desempenoActual (ya venía
// de Docente.desempeno() para pintar Equipos/Monitoreo), sin pedir nada
// nuevo al servidor.
function pintarEvidenciaRubrica(){
  const cont = $('rubrica-evidencia-contenido');
  if(!cont) return;
  const equipoId = $('rubrica-equipo')?.value || '';
  cont.textContent='';
  if(!equipoId){
    const p=document.createElement('p'); p.className='font-label-sm text-on-surface-variant'; p.textContent='Seleccioná un equipo para ver su progreso y luego calificá con la rúbrica.';
    cont.appendChild(p);
    return;
  }
  const fila = desempenoActual.find(r => r.equipo_id===equipoId);
  if(!fila){
    const p=document.createElement('p'); p.className='font-label-sm text-on-surface-variant'; p.textContent='Sin datos de este equipo todavía.';
    cont.appendChild(p);
    return;
  }
  const filas = [
    ['Integrantes', Array.isArray(fila.integrantes) ? fila.integrantes.join(', ') : (fila.integrantes||'—')],
    ['Estaciones resueltas', `${fila.estaciones_resueltas ?? 0} / 5`],
    ['Intentos totales', fila.intentos_totales ?? 0],
    ['Tiempo usado', fila.tiempo_usado_segundos!=null ? `${Math.floor(fila.tiempo_usado_segundos/60)} min` : '—'],
    ['Estado', fila.motivo_fin || (fila.finalizado_en ? 'finalizado' : (fila.iniciado_en ? 'en curso' : 'sin iniciar'))],
  ];
  filas.forEach(([etiqueta, valor])=>{
    const row=document.createElement('div'); row.className='flex justify-between gap-3 text-sm border-b border-audit-border/30 pb-1';
    const k=document.createElement('span'); k.className='text-on-surface-variant'; k.textContent=etiqueta;
    const v=document.createElement('span'); v.className='font-evidence-data font-bold'; v.textContent=String(valor);
    row.append(k,v);
    cont.appendChild(row);
  });
}

async function handleNuevoEquipo(){
  if(!sesionActivaId){ mostrarMensajeDocente('Seleccioná o creá una sesión arriba antes de crear equipos.'); return; }
  const nombre=prompt('Nombre del nuevo equipo:');
  if(!nombre) return;
  const {error} = await Docente.crearEquipo(sesionActivaId, nombre.trim());
  if(error) alert(error.mensaje||'No se pudo crear equipo');
  else { await cargarEquiposYMonitoreo(); }
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
  $('btn-ver-sesion')?.addEventListener('click', ()=> $('sec-monitoreo')?.scrollIntoView({ behavior:'smooth', block:'start' }));
  $('btn-cerrar-sesion')?.addEventListener('click', cerrarSesion);
  $('btn-borrar-sesion')?.addEventListener('click', borrarSesion);
  $('form-nomina')?.addEventListener('submit', handleCargarNomina);
  $('btn-agregar-a-nomina')?.addEventListener('click', async ()=>{
    if(!sesionActivaId){ mostrarMensajeDocente('Seleccioná o creá una sesión arriba antes de agregar estudiantes.'); return; }
    const nombre=prompt('Nombre completo:'); if(!nombre) return;
    const correo=prompt('Correo:'); if(!correo) return;
    const carne=prompt('Carné:'); if(!carne) return;
    const {error} = await Docente.agregarANomina(sesionActivaId, { nombre: nombre.trim(), correo: correo.trim().toLowerCase(), carne: carne.trim() });
    if(error) alert(error.mensaje||'No se pudo agregar'); else await Promise.all([cargarNomina(), cargarRegistrados()]);
  });
  $('btn-nuevo-equipo')?.addEventListener('click', handleNuevoEquipo);
  $('btn-exportar-csv')?.addEventListener('click', handleExportarCSV);
  $('btn-anonimizar')?.addEventListener('click', handleAnonimizar);
  $('rubrica-equipo')?.addEventListener('change', pintarEvidenciaRubrica);
  $('form-rubrica')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const rubrica=Object.fromEntries(fd.entries());
    const selEquipo = $('rubrica-equipo');
    const equipoId = selEquipo?.value || '';
    if(!equipoId){ mostrarMensajeDocente('Elegí a qué equipo calificás, arriba en "Evidencia de juego".'); selEquipo?.focus(); return; }
    const nombreEquipo = equiposActuales.find(eq=>eq.id===equipoId)?.nombre || '';
    const {error} = await Docente.guardarCalificacion(equipoId, rubrica);
    if(error) mostrarMensajeDocente(error.mensaje||'No se pudo guardar la calificación.');
    else mostrarMensajeDocente(`Calificación de "${nombreEquipo}" guardada.`, 'ok');
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initDocente);
else initDocente();
