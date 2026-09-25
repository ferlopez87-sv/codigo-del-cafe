// js/docente.js — Panel docente (te-panel / te-equipos / te-export)
// Vanilla type:module, usa Docente/Auth de api.js, textContent siempre (XSS §14.4)
import { Auth, Docente, Contenido } from './api.js';
import { pintarNarrativaEstacion, pintarDatosEstacion, pintarRetoEstacion } from './contenido-render.js';
import { renderInteraccion, serializarRespuesta, marcarRespuesta } from './render.js';
import { crearGrafico } from './dataviz.js';

let sesionActivaId = null;
let sesionActivaEstado = 'borrador';
let equiposActuales = []; // [{id, nombre}] — se repuebla en cada pintarEquipos(), la usan los <select> de asignar y rúbrica
let desempenoActual = []; // filas crudas de Docente.desempeno() (v_desempeno) — la usa la "Evidencia de juego" de la rúbrica, sin pedir nada nuevo al servidor

// Editor de contenido de salas (2026-09-02, solo super-admin) — ver detalle
// junto a cargarContenidoSalas() más abajo.
let estacionesContenido = []; // cache de Docente.estaciones() (las 5 filas completas)
let salaEditandoId = null;
// Copia de trabajo del formulario. `datosLista` (no un objeto plano) para
// poder reordenar/renombrar claves sin perder el resto mientras se edita —
// se convierte a objeto recién al pintar la vista previa o al guardar.
let formContenido = { titulo:'', pilar:'', narrativa:'', reto:'', feedback_ok:'', codigo:'', interaccionRaw:'', respuestaRaw:'', datosLista:[], pistas:[] };

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
  // super-admin: mostrar consola y pestaña Contenido (sección propia debajo de Consola)
  try{
    const correo = (datos?.correo||datos?.email||'').toLowerCase();
    if(correo==='fglopez@monicaherrera.edu.sv'){
      const c=$('consola-super-admin'); if(c) c.removeAttribute('hidden');
      const sc=$('sec-contenido'); if(sc) sc.removeAttribute('hidden');
      const navC=$('nav-contenido'); if(navC) navC.removeAttribute('hidden');
      cargarConsolaSuperAdmin();
      try{ if(typeof cargarContenidoSalas==='function') cargarContenidoSalas(); }catch(e){ console.warn('cargarContenidoSalas stub:', e?.message); }
      try{ if(typeof enlazarEventosContenido==='function') enlazarEventosContenido(); }catch(e){ console.warn('enlazarEventosContenido stub:', e?.message); }
      // P5 nuevo — si existe, inicializa las 3 vistas
      try{ if(typeof initContenidoP5==='function') initContenidoP5(); }catch(e){ console.warn('initContenidoP5:', e?.message); }
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

// ---------------------------------------------------------------------------
// Editor de contenido de las 5 salas (2026-09-02, solo super-admin).
// El texto de las salas vivía solo en sql/05-seed.sql — cualquier edición
// era tocar SQL a mano (con el riesgo real ya visto: un salto de línea
// suelto rompió la migración una vez). `datos`/`pistas` de una sala se
// guardan acá como `datosLista`/array de strings mientras se edita, y solo
// se convierten al objeto/array real de la API al pintar la vista previa o
// al guardar — así se puede renombrar una clave o reordenar sin perder el
// resto del formulario. La vista previa reusa pintarNarrativaEstacion/
// pintarDatosEstacion/pintarRetoEstacion de js/contenido-render.js: es el
// MISMO código que pinta #panel-estacion para el estudiante, no una
// reconstrucción aparte.
// ---------------------------------------------------------------------------

function objetoADatosLista(obj){
  if(!obj || typeof obj!=='object') return [];
  return Object.entries(obj).map(([clave, valor])=>{
    if(Array.isArray(valor)) return { clave, tipo:'lista', items: valor.map((v)=>String(v)) };
    if(valor && typeof valor==='object') return { clave, tipo:'objeto', pares: Object.entries(valor).map(([k,v])=>({ clave:k, valor:String(v) })) };
    return { clave, tipo:'texto', valor: valor==null ? '' : String(valor) };
  });
}
// Filas sin nombre de clave se ignoran al guardar/previsualizar — evita
// mandar `{"": "..."}` al servidor por una fila a medio llenar.
function datosListaAObjeto(lista){
  const out = {};
  (lista||[]).forEach((fila)=>{
    const clave = (fila.clave||'').trim();
    if(!clave) return;
    if(fila.tipo==='lista') out[clave] = (fila.items||[]).slice();
    else if(fila.tipo==='objeto'){
      const sub = {};
      (fila.pares||[]).forEach((p)=>{ const k=(p.clave||'').trim(); if(k) sub[k]=p.valor||''; });
      out[clave] = sub;
    } else out[clave] = fila.valor||'';
  });
  return out;
}

async function cargarContenidoSalas(){
  // LEGACY STUB — el editor viejo de 5 salas fijas fue borrado en P5.
  // Se mantiene como no-op para no romper initDocente si algo aún lo llama.
  // La implementación real es cargarBiblioteca() / initContenidoP5() más abajo.
  return;
}

function seleccionarSalaParaEditar(id){
  const est = estacionesContenido.find((e)=>Number(e.id)===Number(id));
  if(!est) return;
  salaEditandoId = est.id;
  document.querySelectorAll('#lista-salas-contenido button').forEach((b)=>{
    b.setAttribute('aria-pressed', Number(b.dataset.salaId)===Number(id) ? 'true':'false');
  });
  formContenido = {
    titulo: est.titulo||'', pilar: est.pilar||'', narrativa: est.narrativa||'', reto: est.reto||'',
    feedback_ok: est.feedback_ok||'', codigo: est.codigo||'',
    interaccionRaw: est.interaccion ? JSON.stringify(est.interaccion, null, 2) : '',
    respuestaRaw: est.respuesta ? JSON.stringify(est.respuesta, null, 2) : '',
    datosLista: objetoADatosLista(est.datos),
    pistas: Array.isArray(est.pistas) ? est.pistas.slice() : []
  };
  if($('input-titulo-sala')) $('input-titulo-sala').value = formContenido.titulo;
  if($('input-pilar-sala')) $('input-pilar-sala').value = formContenido.pilar;
  if($('input-narrativa-sala')) $('input-narrativa-sala').value = formContenido.narrativa;
  if($('input-reto-sala')) $('input-reto-sala').value = formContenido.reto;
  if($('input-feedback-ok-sala')) $('input-feedback-ok-sala').value = formContenido.feedback_ok;
  if($('input-codigo-sala')) $('input-codigo-sala').value = formContenido.codigo;
  if($('input-interaccion-sala')) $('input-interaccion-sala').value = formContenido.interaccionRaw;
  if($('input-respuesta-sala')) $('input-respuesta-sala').value = formContenido.respuestaRaw;
  renderizarEditorDatos();
  renderizarEditorPistas();
  actualizarVistaPreviaContenido();
  $('form-contenido-sala')?.removeAttribute('hidden');
}

function renderizarEditorDatos(){
  const cont = $('editor-datos-lista');
  if(!cont) return;
  limpiarTabla(cont);
  formContenido.datosLista.forEach((fila, idx)=> cont.appendChild(construirFilaDato(fila, idx)));
}

function construirFilaDato(fila, idx){
  const wrap=document.createElement('div'); wrap.className='fila-dato space-y-2';
  const cabecera=document.createElement('div'); cabecera.className='flex flex-wrap items-center gap-2';

  const inputClave=document.createElement('input'); inputClave.type='text'; inputClave.value=fila.clave;
  inputClave.placeholder='nombre_del_dato';
  inputClave.setAttribute('aria-label','Nombre del dato');
  inputClave.className='flex-1 min-w-[160px] bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
  inputClave.addEventListener('input', ()=>{ fila.clave=inputClave.value; actualizarVistaPreviaContenido(); });

  const selectTipo=document.createElement('select');
  selectTipo.setAttribute('aria-label','Tipo de dato');
  selectTipo.className='bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
  [['texto','Texto'],['lista','Lista'],['objeto','Objeto']].forEach(([v,t])=>{
    const op=document.createElement('option'); op.value=v; op.textContent=t; if(fila.tipo===v) op.selected=true; selectTipo.appendChild(op);
  });
  selectTipo.addEventListener('change', ()=>{
    fila.tipo = selectTipo.value;
    if(fila.tipo==='texto' && fila.valor==null) fila.valor='';
    if(fila.tipo==='lista' && !fila.items) fila.items=[];
    if(fila.tipo==='objeto' && !fila.pares) fila.pares=[];
    renderizarEditorDatos();
    actualizarVistaPreviaContenido();
  });

  const btnQuitar=document.createElement('button'); btnQuitar.type='button'; btnQuitar.textContent='Quitar';
  btnQuitar.className='font-evidence-data text-xs uppercase border border-error text-error px-2 py-1 hover:bg-error hover:text-on-error';
  btnQuitar.addEventListener('click', ()=>{
    formContenido.datosLista.splice(idx,1);
    renderizarEditorDatos();
    actualizarVistaPreviaContenido();
  });

  cabecera.appendChild(inputClave); cabecera.appendChild(selectTipo); cabecera.appendChild(btnQuitar);
  wrap.appendChild(cabecera);
  wrap.appendChild(construirSubEditorDato(fila));
  return wrap;
}

function construirSubEditorDato(fila){
  if(fila.tipo==='lista'){
    const cont=document.createElement('div'); cont.className='space-y-1 pl-2';
    (fila.items||[]).forEach((item, i)=>{
      const filaEl=document.createElement('div'); filaEl.className='flex gap-2';
      const inp=document.createElement('input'); inp.type='text'; inp.value=item; inp.setAttribute('aria-label','Línea de la lista');
      inp.className='flex-1 bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
      inp.addEventListener('input', ()=>{ fila.items[i]=inp.value; actualizarVistaPreviaContenido(); });
      const quitar=document.createElement('button'); quitar.type='button'; quitar.textContent='×'; quitar.setAttribute('aria-label','Quitar línea');
      quitar.className='font-evidence-data text-xs border border-error text-error px-2 hover:bg-error hover:text-on-error';
      quitar.addEventListener('click', ()=>{ fila.items.splice(i,1); renderizarEditorDatos(); actualizarVistaPreviaContenido(); });
      filaEl.appendChild(inp); filaEl.appendChild(quitar); cont.appendChild(filaEl);
    });
    const agregar=document.createElement('button'); agregar.type='button'; agregar.textContent='+ línea';
    agregar.className='font-evidence-data text-xs uppercase text-primary hover:underline';
    agregar.addEventListener('click', ()=>{ fila.items.push(''); renderizarEditorDatos(); });
    cont.appendChild(agregar);
    return cont;
  }
  if(fila.tipo==='objeto'){
    const cont=document.createElement('div'); cont.className='space-y-1 pl-2';
    (fila.pares||[]).forEach((par, i)=>{
      const filaEl=document.createElement('div'); filaEl.className='flex gap-2';
      const inpK=document.createElement('input'); inpK.type='text'; inpK.value=par.clave; inpK.placeholder='clave'; inpK.setAttribute('aria-label','Sub-clave');
      inpK.className='w-1/3 bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
      inpK.addEventListener('input', ()=>{ par.clave=inpK.value; actualizarVistaPreviaContenido(); });
      const inpV=document.createElement('input'); inpV.type='text'; inpV.value=par.valor; inpV.placeholder='valor'; inpV.setAttribute('aria-label','Sub-valor');
      inpV.className='flex-1 bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
      inpV.addEventListener('input', ()=>{ par.valor=inpV.value; actualizarVistaPreviaContenido(); });
      const quitar=document.createElement('button'); quitar.type='button'; quitar.textContent='×'; quitar.setAttribute('aria-label','Quitar par');
      quitar.className='font-evidence-data text-xs border border-error text-error px-2 hover:bg-error hover:text-on-error';
      quitar.addEventListener('click', ()=>{ fila.pares.splice(i,1); renderizarEditorDatos(); actualizarVistaPreviaContenido(); });
      filaEl.appendChild(inpK); filaEl.appendChild(inpV); filaEl.appendChild(quitar); cont.appendChild(filaEl);
    });
    const agregar=document.createElement('button'); agregar.type='button'; agregar.textContent='+ par clave/valor';
    agregar.className='font-evidence-data text-xs uppercase text-primary hover:underline';
    agregar.addEventListener('click', ()=>{ fila.pares.push({ clave:'', valor:'' }); renderizarEditorDatos(); });
    cont.appendChild(agregar);
    return cont;
  }
  // texto
  const cont=document.createElement('div'); cont.className='pl-2';
  const ta=document.createElement('textarea'); ta.rows=2; ta.value=fila.valor||''; ta.setAttribute('aria-label','Valor del dato');
  ta.className='w-full bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
  ta.addEventListener('input', ()=>{ fila.valor=ta.value; actualizarVistaPreviaContenido(); });
  cont.appendChild(ta);
  return cont;
}

function renderizarEditorPistas(){
  const cont = $('editor-pistas-lista');
  if(!cont) return;
  limpiarTabla(cont);
  formContenido.pistas.forEach((texto, i)=>{
    const fila=document.createElement('div'); fila.className='fila-pista flex gap-2 items-start';
    const ta=document.createElement('textarea'); ta.rows=2; ta.value=texto; ta.setAttribute('aria-label', `Pista ${i+1}`);
    ta.className='flex-1 bg-surface-container-low border border-audit-border rounded px-2 py-1 font-evidence-data text-xs text-on-surface';
    ta.addEventListener('input', ()=>{ formContenido.pistas[i]=ta.value; });
    const quitar=document.createElement('button'); quitar.type='button'; quitar.textContent='Quitar';
    quitar.className='font-evidence-data text-xs uppercase border border-error text-error px-2 py-1 hover:bg-error hover:text-on-error self-start';
    quitar.addEventListener('click', ()=>{ formContenido.pistas.splice(i,1); renderizarEditorPistas(); });
    fila.appendChild(ta); fila.appendChild(quitar); cont.appendChild(fila);
  });
}

// Vista previa en vivo: literalmente el mismo renderer que ve el estudiante
// (js/contenido-render.js), nunca una reconstrucción aparte.
function actualizarVistaPreviaContenido(){
  setText('prev-titulo', formContenido.titulo || (salaEditandoId ? `Estación ${salaEditandoId}` : ''));
  setText('prev-pilar', formContenido.pilar);
  pintarNarrativaEstacion($('prev-narrativa'), formContenido.narrativa);
  const datosEl = $('prev-datos');
  if(datosEl) pintarDatosEstacion(datosEl, datosListaAObjeto(formContenido.datosLista));
  pintarRetoEstacion($('prev-reto-texto'), formContenido.reto);
}

async function guardarContenidoSala(){
  if(!salaEditandoId){ mostrarMensajeDocente('Elegí una sala para editar.'); return; }
  const interaccionRaw = ($('input-interaccion-sala')?.value||'').trim();
  const respuestaRaw = ($('input-respuesta-sala')?.value||'').trim();
  const codigoRaw = ($('input-codigo-sala')?.value||'').trim();
  let interaccion, respuesta;
  if(interaccionRaw){
    try{ interaccion = JSON.parse(interaccionRaw); } catch{ mostrarMensajeDocente('Interacción: JSON inválido. Revisá comas, comillas y llaves.'); return; }
  }
  if(respuestaRaw){
    try{ respuesta = JSON.parse(respuestaRaw); } catch{ mostrarMensajeDocente('Respuesta: JSON inválido.'); return; }
  }
  const payload = {
    titulo: ($('input-titulo-sala')?.value||'').trim(),
    pilar: ($('input-pilar-sala')?.value||'').trim(),
    narrativa: $('input-narrativa-sala')?.value||'',
    reto: $('input-reto-sala')?.value||'',
    feedback_ok: $('input-feedback-ok-sala')?.value||'',
    pistas: formContenido.pistas.map((p)=>String(p||'').trim()).filter((p)=>p.length>0),
    datos: datosListaAObjeto(formContenido.datosLista)
  };
  if(interaccion!==undefined) payload.interaccion = interaccion;
  if(codigoRaw) payload.codigo = codigoRaw;
  if(respuesta!==undefined) payload.respuesta = respuesta;
  if(!payload.titulo || !payload.pilar || !payload.narrativa.trim() || !payload.reto.trim() || !payload.feedback_ok.trim()){
    mostrarMensajeDocente('Título, pilar, narrativa, reto y mensaje de acierto no pueden quedar vacíos.');
    return;
  }
  if(Object.keys(payload.datos).length===0){
    mostrarMensajeDocente('Agregá al menos un dato del expediente antes de guardar.');
    return;
  }
  if(!confirm(`¿Guardar cambios en "Sala ${salaEditandoId}"? Esto cambia lo que ven TODOS los equipos de todos los docentes, no solo los tuyos.`)) return;
  const {error} = await Docente.actualizarEstacion(salaEditandoId, payload);
  if(error){ mostrarMensajeDocente(error.mensaje||`No se pudo guardar: ${error.campo||''}`); return; }
  const idGuardado = salaEditandoId;
  await cargarContenidoSalas();
  seleccionarSalaParaEditar(idGuardado);
  mostrarMensajeDocente(`Contenido de "Sala ${idGuardado}" guardado.`, 'ok');
}

function enlazarEventosContenido(){
  // LEGACY STUB — ver cargarContenidoSalas() arriba.
  return;
}

// ===========================================================================
// P5 — Editor de misiones (plan-motor-misiones.md P5 + P5b)
// Dueño: Frontend (*.html + js/**). Todo dentro de #sec-contenido, 3 vistas.
// ===========================================================================

let misionesP5 = [];
let misionActivaP5 = null; // objeto mision completo
let salasP5 = []; // estaciones de la mision activa
let salaActivaP5 = null; // estacion completa seleccionada
let vistaP5 = 'biblioteca'; // biblioteca | mision | reto

// WYSIWYG acotado — instancias por campo
let wysNarrativa = null, wysReto = null, wysFeedback = null;
let wysBrief = null; // P9 — brief de la misión, vive en la Cabecera (Vista 2), no en una sala
let wysPistas = []; // por indice

// P10 — api.js deja en error.mensaje el código crudo del servidor ("dato_invalido");
// acá se traduce a algo que el docente pueda corregir. El campo viene en detalle.campo.
const ETIQUETAS_CAMPO = { narrativa:'Narrativa', reto:'Reto', feedback_ok:'Feedback', pistas:'Pistas', brief_contenido:'Brief' };
// P12 — motivo que manda el backend en los 400 con campo:'respuesta'. Sin
// motivo (backend viejo) se cae al mensaje genérico de campo inválido.
const MOTIVOS_RESPUESTA = {
  respuesta_vacia: 'Falta marcar la respuesta correcta en el widget de «Respuesta correcta».',
  id_inexistente: 'La respuesta marcada apunta a una opción o ítem que ya no existe. Volvé a marcarla.',
  cierre_faltante: 'El reto tiene pregunta de cierre: marcá también la respuesta correcta del cierre.',
  cierre_sobrante: 'Hay una respuesta de cierre marcada, pero el reto no tiene cierre activo.',
  cierre_invalido: 'La respuesta del cierre no coincide con ninguna de sus opciones. Volvé a marcarla.',
  rango_invalido: 'El rango no es válido: revisá que el mínimo no sea mayor que el máximo.',
  orden_incompleto: 'Falta ubicar alguna tarjeta: el orden correcto tiene que incluir todos los ítems.',
  clasificacion_incompleta: 'Falta clasificar algún ítem: cada uno necesita su categoría.',
  formato: 'La respuesta no tiene la forma que espera este tipo de reto. Volvé a marcarla en el widget.',
};
function mensajeError(error, respaldo){
  const codigo = error?.codigo || '';
  const campo = error?.detalle?.campo || '';
  if(codigo==='dato_invalido'){
    if(campo==='respuesta' && MOTIVOS_RESPUESTA[error?.detalle?.motivo]) return MOTIVOS_RESPUESTA[error.detalle.motivo];
    if(ETIQUETAS_CAMPO[campo]) return `El campo «${ETIQUETAS_CAMPO[campo]}» tiene formato no permitido. Solo negrita, cursiva, listas y saltos de línea; ni tablas ni texto pegado con estilos.`;
    if(campo==='slug') return 'Ese slug ya existe o no es válido.';
    if(campo) return `El campo «${campo}» no es válido.`;
  }
  if(codigo==='brief_incompleto') return 'Completá el Brief (título y contenido) antes de publicar.';
  if(codigo==='mision_en_uso') return 'Hay sesiones que usan esta misión. Borrá o reasigná esas sesiones primero.';
  // Un código que no está en el mapa (p. ej. error_interno) no se muestra crudo.
  return (error?.mensaje && error.mensaje !== codigo) ? error.mensaje : respaldo;
}
function mostrarMensajeContenido(texto, tipo){
  const el = $('contenido-mensaje');
  if(!el) return;
  el.textContent = texto;
  el.classList.toggle('border-primary', tipo==='ok');
  el.classList.toggle('text-primary', tipo==='ok');
  el.classList.toggle('bg-primary/10', tipo==='ok');
  el.classList.toggle('border-error', tipo!=='ok');
  el.classList.toggle('text-error', tipo!=='ok');
  el.classList.toggle('bg-error/10', tipo!=='ok');
  el.removeAttribute('hidden');
  setTimeout(()=> el.setAttribute('hidden',''), 8000);
}

function setVistaP5(nombre){
  vistaP5 = nombre;
  $('contenido-vista-biblioteca')?.setAttribute('hidden','');
  $('contenido-vista-mision')?.setAttribute('hidden','');
  $('contenido-vista-reto')?.setAttribute('hidden','');
  if(nombre==='biblioteca') $('contenido-vista-biblioteca')?.removeAttribute('hidden');
  if(nombre==='mision') $('contenido-vista-mision')?.removeAttribute('hidden');
  if(nombre==='reto') $('contenido-vista-reto')?.removeAttribute('hidden');
}

// ---------- WYSIWYG acotado P5b ----------
function slugifyId(texto){
  return String(texto||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,24) || ('id_'+Math.random().toString(36).slice(2,6));
}
function sanitizarHtmlAcotado(html){
  // Solo <b>, <i>, <ul>, <li>, <br> sin atributos. Todo lo demás se descarta
  // conservando su texto. Devuelve un DocumentFragment — NUNCA un string.
  //
  // Versión anterior serializaba el árbol ya limpio a texto (concatenando
  // `ch.textContent` crudo dentro de template strings) y ese string se
  // volvía a asignar con `editable.innerHTML=`. Si el texto original traía
  // entidades HTML (`&lt;img src=x onerror=...&gt;` dentro de un `<b>`
  // permitido), el walk() de abajo las deja pasar tal cual porque son texto
  // legítimo — pero al reserializar quedaban decodificadas como caracteres
  // `<`/`>` literales dentro del string de salida, y ese string, reasignado
  // por innerHTML, se volvía a parsear como HTML real una segunda vez:
  // mutation XSS. Confirmado en Chrome real contra Docker — abrir el editor
  // con ese contenido ejecutaba el `onerror` del `<img>` reconstituido.
  // El árbol de `tpl.content` después de walk() ya es la versión limpia;
  // se entrega tal cual (los que lo consumen usan `replaceChildren()`), sin
  // pasar nunca más por texto.
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html||'');
  const permitidos = new Set(['B','I','UL','LI','BR']);
  function walk(nodo){
    const hijos = Array.from(nodo.childNodes);
    hijos.forEach(h=>{
      if(h.nodeType===1){
        if(!permitidos.has(h.tagName)){
          // Reemplazar por su texto + hijos sanitizados
          const frag = document.createDocumentFragment();
          Array.from(h.childNodes).forEach(ch=> frag.appendChild(ch));
          // Recursivo sobre frag antes de insertar
          Array.from(frag.childNodes).forEach(ch=> { if(ch.nodeType===1) walk(ch); });
          h.replaceWith(frag);
        } else {
          // Limpiar atributos
          while(h.attributes.length) h.removeAttribute(h.attributes[0].name);
          walk(h);
        }
      } else if(h.nodeType===8){ h.remove(); }
    });
  }
  walk(tpl.content);
  return tpl.content;
}
function crearEditorEnriquecido(contId, valorInicial){
  const cont = $(contId);
  if(!cont) return { getValue:()=> '', setValue:()=>{} };
  cont.textContent='';
  const toolbar = document.createElement('div');
  toolbar.className='flex gap-1 mb-1';
  [
    {cmd:'bold', label:'B', title:'Negrita'},
    {cmd:'italic', label:'I', title:'Cursiva'},
    {cmd:'insertUnorderedList', label:'• Lista', title:'Lista con viñetas'},
    // 2026-09-25 (pedido de Fernando): sin esto no había forma de cortar una
    // línea sin volverla un ítem de lista — insertLineBreak mete un <br> de
    // verdad, lo mismo que ahora hace Enter fuera de una lista (ver abajo).
    {cmd:'insertLineBreak', label:'↵ Salto', title:'Salto de línea'},
  ].forEach(b=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.textContent=b.label;
    btn.title=b.title;
    btn.className='px-2 py-1 border border-audit-border text-xs hover:border-primary hover:text-primary';
    // P11-b — sin esto el mousedown le pasa el foco al botón, el editor pierde
    // la selección y execCommand actúa al inicio (Lista: "dosuno"; B: nada).
    btn.addEventListener('mousedown', e=>e.preventDefault());
    btn.addEventListener('click', ()=>{
      if(document.activeElement!==editable) editable.focus(); // respaldo (teclado, foco perdido)
      document.execCommand(b.cmd, false, null);
      // Chrome deja el caret al inicio del ítem dentro del propio execCommand
      // (medido: "uno"@3 → "uno"@0), así que Enter partía antes del texto y daba
      // <li><br></li><li>dosuno</li>. Con selección de varias líneas no se toca.
      if(b.cmd==='insertUnorderedList'){
        const sel=window.getSelection();
        let li=sel.anchorNode;
        while(li && li!==editable && li.nodeName!=='LI') li=li.parentNode;
        if(sel.isCollapsed && li && li.nodeName==='LI' && li.textContent!==''){
          const r=document.createRange();
          r.selectNodeContents(li);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      editable.dispatchEvent(new Event('input', {bubbles:true}));
    });
    toolbar.appendChild(btn);
  });
  const editable=document.createElement('div');
  editable.contentEditable='true';
  editable.className='min-h-[80px] w-full bg-surface-container-low border border-audit-border rounded px-3 py-2 text-on-surface text-sm focus:border-primary outline-none';
  editable.setAttribute('role','textbox');
  editable.setAttribute('aria-multiline','true');
  // Inicializar con html acotado — sanitizarHtmlAcotado ya devuelve el árbol
  // limpio como fragmento, sirve igual para texto plano o con los tags
  // permitidos, no hace falta distinguir casos a mano.
  editable.replaceChildren(sanitizarHtmlAcotado(valorInicial||''));
  editable.addEventListener('paste', (e)=>{
    e.preventDefault();
    const text = (e.clipboardData||window.clipboardData).getData('text/html') || (e.clipboardData||window.clipboardData).getData('text/plain');
    const frag = sanitizarHtmlAcotado(text);
    const sel = window.getSelection();
    if(sel && sel.rangeCount){
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const ultimoNodo = frag.lastChild;
      range.insertNode(frag);
      if(ultimoNodo){
        range.setStartAfter(ultimoNodo);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    editable.dispatchEvent(new Event('input', {bubbles:true}));
  });
  // Enter fuera de una lista NO debe crear un bloque nuevo (Chrome mete un
  // <div>/<p>, que este formato no soporta — no hay <p>/<br> reales para
  // separarlos, así que el "salto" se veía colapsado al guardar). Dentro de
  // una lista, Enter sigue haciendo lo esperado: una viñeta nueva.
  editable.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter' || e.shiftKey) return;
    const sel=window.getSelection();
    if(!sel || !sel.rangeCount) return;
    let nodo = sel.anchorNode;
    if(nodo && nodo.nodeType===3) nodo = nodo.parentElement;
    const dentroDeLista = !!(nodo && nodo.closest && nodo.closest('li'));
    if(dentroDeLista) return;
    e.preventDefault();
    document.execCommand('insertLineBreak');
    editable.dispatchEvent(new Event('input', {bubbles:true}));
  });
  // Vaciar de verdad al borrar todo — sin esto, seleccionar todo y borrar
  // (Ctrl+A + Supr sobre contenido que empezaba con <ul><li><b>...) deja un
  // <ul><li><br></li></ul> residual: sin texto, pero con toda la estructura
  // de lista y negrita todavía ahí. El próximo caracter que se tipea entra
  // DENTRO de ese <li><b>, así que se ve "pegado" en negrita y en viñeta sin
  // que el docente lo haya pedido. Detectado en Chrome real, reproducible.
  // El chequeo es sobre el HTML, no sobre "hay o no un <br>": un <br> suelto
  // (`<br>` o vacío del todo) es un estado legítimo — lo que hay que
  // destruir es la ENVOLTURA (ul/li/b/i) que sobrevive sin contenido.
  // replaceChildren() sola no alcanza: el Range activo puede seguir
  // apuntando al nodo ya destruido, y Chrome arrastra su estilo de tipeo
  // desde ahí. Se arma una selección nueva, colapsada al inicio del div ya
  // limpio, para que lo próximo que se tipee no herede nada.
  // P11-c — solo tras un borrado: "• Lista" con el editor vacío crea un
  // <ul><li><br></li></ul> legítimo y su input nativo (insertUnorderedList)
  // lo destruía en el acto. El input sintético del botón no trae inputType.
  editable.addEventListener('input', (ev)=>{
    if(!String(ev.inputType||'').startsWith('delete')) return;
    if(editable.textContent.trim()) return;
    const html = editable.innerHTML;
    if(html==='' || html==='<br>') return;
    editable.replaceChildren();
    const sel=window.getSelection();
    const range=document.createRange();
    range.selectNodeContents(editable);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  });
  // Actualizar vista previa en vivo al editar
  editable.addEventListener('input', ()=> {
    try{ actualizarVistaPreviaSalaP5(); }catch{}
  });
  editable.addEventListener('keyup', ()=> {
    try{ actualizarVistaPreviaSalaP5(); }catch{}
  });
  cont.appendChild(toolbar);
  cont.appendChild(editable);
  return {
    // Recorre el DOM del editable y serializa a <b>/<i>/<ul><li>/<br> — una
    // sola función recursiva en vez de la misma lógica copiada tres veces
    // (top-level, dentro de un bloque DIV/P, dentro de un LI), que además
    // solo entendía un nivel: un <b> con un <br> adentro perdía el <br>
    // porque cada copia leía `ch.textContent` plano. Recursiva, entiende
    // cualquier combinación válida sin importar cuántos niveles tenga.
    getValue(){
      // P10 — el validador rechaza <br> dentro de <b>/<i> (contenido-render.js
      // no reparsea su interior), pero Chrome lo produce al poner en negrita un
      // texto que cruza un salto. `abiertos` lleva los b/i en curso para que
      // cada BR los cierre y reabra: <b>a<br>b</b> → <b>a</b><br><b>b</b>.
      // Tampoco se anidan b/i (el renderizador leería el interior como texto
      // literal): dentro de uno, el hijo emite solo su contenido y gana el
      // formato exterior. <i>a<b>x<br>y</b></i> → <i>ax</i><br><i>y</i>.
      function envolver(tag, nodo, abiertos){
        if(abiertos.length) return serializarInline(nodo, abiertos);
        return `<${tag}>${serializarInline(nodo, [tag])}</${tag}>`;
      }
      function serializarInline(nodo, abiertos=[]){
        let out='';
        nodo.childNodes.forEach(n=>{
          if(n.nodeType===3) out+=n.textContent;
          else if(n.nodeType===1){
            if(n.tagName==='B'||n.tagName==='STRONG') out+=envolver('b', n, abiertos);
            else if(n.tagName==='I'||n.tagName==='EM') out+=envolver('i', n, abiertos);
            else if(n.tagName==='BR'){
              const cierre = abiertos.slice().reverse().map(t=>`</${t}>`).join('');
              const apertura = abiertos.map(t=>`<${t}>`).join('');
              out+=cierre+'<br>'+apertura;
            }
            else out+=serializarInline(n, abiertos); // span/font/etc. sin permiso: se queda el texto
          }
        });
        return out;
      }
      // Pares que quedan vacíos al partir por un BR (<b></b>, <i><b></b></i>).
      function quitarVacios(html){
        let previo;
        do { previo=html; html=html.replace(/<(b|i)><\/\1>/g, ''); } while(html!==previo);
        return html;
      }
      function serializarLista(ul){
        let out='<ul>';
        Array.from(ul.children).forEach(li=>{
          if(li.tagName==='LI') out+=`<li>${serializarInline(li)}</li>`;
        });
        return out+'</ul>';
      }
      // Nivel superior: además de texto/b/i/br, acepta <ul> y los bloques
      // DIV/P que Chrome crea solo — un DIV/P vacío o con solo un <br> (lo
      // que deja un Enter suelto) no debe imprimir nada.
      function serializarBloque(nodo){
        let out='';
        nodo.childNodes.forEach(n=>{
          if(n.nodeType===3) out+=n.textContent;
          else if(n.nodeType===1){
            if(n.tagName==='DIV'||n.tagName==='P') out+=serializarBloque(n);
            else if(n.tagName==='UL') out+=serializarLista(n);
            else if(n.tagName==='B'||n.tagName==='STRONG') out+=envolver('b', n, []);
            else if(n.tagName==='I'||n.tagName==='EM') out+=envolver('i', n, []);
            else if(n.tagName==='BR') out+='<br>';
            else out+=serializarBloque(n);
          }
        });
        return out;
      }
      return quitarVacios(serializarBloque(editable)).trim();
    },
    setValue(v){
      editable.replaceChildren(sanitizarHtmlAcotado(v||''));
    },
    editable
  };
}

// ---------- INIT P5 ----------
async function initContenidoP5(){
  // Poblar selector de misión en #sec-sesiones (solo fglopez)
  try{
    const sel=$('sesion-mision');
    const campo=$('sesion-mision-campo');
    if(sel && campo){
      const {datos, error} = await Contenido.misiones();
      if(!error && Array.isArray(datos)){
        sel.textContent='';
        const opt0=document.createElement('option'); opt0.value=''; opt0.textContent='— Auto (una sola publicada) —';
        sel.appendChild(opt0);
        datos.forEach(m=>{
          const o=document.createElement('option'); o.value=m.id; o.textContent=`${m.titulo} · ${m.estado} · ${m.salas} salas`;
          sel.appendChild(o);
        });
        campo.removeAttribute('hidden');
        sel.addEventListener('change', ()=>{});
      }
    }
  }catch{}
  await cargarBiblioteca();
  enlazarEventosP5();
}

async function cargarBiblioteca(){
  const cont=$('lista-misiones');
  if(!cont) return;
  cont.textContent='Cargando…';
  const {datos, error} = await Contenido.misiones();
  if(error){ cont.textContent = error.mensaje||'No se pudo cargar.'; return; }
  misionesP5 = Array.isArray(datos)? datos: [];
  renderBiblioteca();
}
function renderBiblioteca(){
  const cont=$('lista-misiones');
  if(!cont) return;
  cont.textContent='';
  if(misionesP5.length===0){
    const p=document.createElement('p'); p.className='font-evidence-data text-sm text-on-surface-variant'; p.textContent='Sin misiones. Creá la primera.';
    cont.appendChild(p); return;
  }
  misionesP5.forEach(m=>{
    const card=document.createElement('div');
    card.className='border border-audit-border bg-surface-container-low p-4 rounded space-y-2';
    const h=document.createElement('h3'); h.className='font-evidence-data font-bold text-sm'; h.textContent=m.titulo;
    const meta=document.createElement('p'); meta.className='font-label-sm text-xs text-on-surface-variant'; meta.textContent=`${m.slug} · ${m.estado} · ${m.salas} salas · ${m.codigo_maestro_efectivo||'—'}`;
    const intro=document.createElement('p'); intro.className='font-body-md text-xs text-on-surface-variant line-clamp-2'; intro.textContent=m.intro||m.subtitulo||'';
    const actions=document.createElement('div'); actions.className='flex flex-wrap gap-2 pt-2';
    const btnEditar=document.createElement('button'); btnEditar.type='button'; btnEditar.textContent='Editar';
    btnEditar.className='px-3 py-1 border border-primary text-primary text-xs uppercase hover:bg-primary hover:text-on-primary';
    btnEditar.addEventListener('click', ()=> abrirMision(m.id));
    const btnDuplicar=document.createElement('button'); btnDuplicar.type='button'; btnDuplicar.textContent='Duplicar';
    btnDuplicar.className='px-3 py-1 border border-audit-border text-on-surface-variant text-xs uppercase hover:border-primary hover:text-primary';
    btnDuplicar.addEventListener('click', ()=> duplicarMision(m.id));
    const btnPublicar=document.createElement('button'); btnPublicar.type='button'; btnPublicar.textContent='Publicar';
    btnPublicar.className='px-3 py-1 border border-audit-border text-on-surface-variant text-xs uppercase hover:border-primary hover:text-primary';
    if(m.estado==='publicada'){ btnPublicar.disabled=true; btnPublicar.classList.add('opacity-40'); }
    btnPublicar.addEventListener('click', ()=> publicarMision(m.id));
    const btnBorrar=document.createElement('button'); btnBorrar.type='button'; btnBorrar.textContent='Borrar';
    btnBorrar.className='px-3 py-1 border border-error text-error text-xs uppercase hover:bg-error hover:text-on-error ml-auto';
    btnBorrar.addEventListener('click', ()=> borrarMision(m.id, m.titulo));
    actions.append(btnEditar, btnDuplicar, btnPublicar, btnBorrar);
    card.append(h, meta, intro, actions);
    cont.appendChild(card);
  });
}
async function crearMision(e){
  if(e) e.preventDefault();
  const slug=$('mision-nueva-slug')?.value.trim();
  const titulo=$('mision-nueva-titulo')?.value.trim();
  const veredicto=$('mision-nueva-veredicto')?.value.trim();
  if(!slug||!titulo||!veredicto){ mostrarMensajeContenido('Slug, título y veredicto son obligatorios.'); return; }
  const {datos, error} = await Contenido.crearMision({slug, titulo, veredicto});
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudo crear.')); return; }
  mostrarMensajeContenido(`Misión "${titulo}" creada.`, 'ok');
  $('form-nueva-mision')?.setAttribute('hidden','');
  await cargarBiblioteca();
  if(datos?.id) abrirMision(datos.id);
}
async function duplicarMision(id){
  if(!confirm('¿Duplicar esta misión?')) return;
  const {datos, error} = await Contenido.duplicarMision(id);
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudo duplicar.')); return; }
  mostrarMensajeContenido('Misión duplicada.', 'ok');
  await cargarBiblioteca();
}
async function publicarMision(id){
  const {error} = await Contenido.publicarMision(id);
  if(error){
    // P9 — el servidor rechaza publicar sin brief con {error:'brief_incompleto'};
    // acá se traduce a un mensaje que dice qué falta, no un 400 genérico.
    mostrarMensajeContenido(mensajeError(error, 'No se pudo publicar.'));
    return;
  }
  mostrarMensajeContenido('Misión publicada.', 'ok');
  await cargarBiblioteca();
  if(misionActivaP5?.id===id) await abrirMision(id);
}
async function borrarMision(id, titulo){
  if(!confirm(`¿Borrar "${titulo||id}" para siempre? Se pierden sus salas. Esto NO se puede deshacer.`)) return;
  const {error} = await Contenido.borrarMision(id);
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudo borrar. Si está en uso por alguna sesión, primero borrá esas sesiones.')); return; }
  mostrarMensajeContenido('Misión borrada.', 'ok');
  if(misionActivaP5?.id===id){ misionActivaP5=null; salasP5=[]; setVistaP5('biblioteca'); }
  await cargarBiblioteca();
}
async function abrirMision(id){
  const {datos: misiones} = await Contenido.misiones();
  const m = (misiones||[]).find(x=> String(x.id)===String(id));
  if(!m){ mostrarMensajeContenido('No se encontró la misión.'); return; }
  misionActivaP5 = m;
  setVistaP5('mision');
  $('mision-titulo').value = m.titulo||'';
  $('mision-subtitulo').value = m.subtitulo||'';
  $('mision-intro').value = m.intro||'';
  $('mision-veredicto').value = m.veredicto||'';
  $('mision-estado-badge').textContent = m.estado||'';
  const briefTituloInput = $('mision-brief-titulo');
  if(briefTituloInput) briefTituloInput.value = m.brief_titulo||'';
  wysBrief = crearEditorEnriquecido('mision-brief-contenido-editor', m.brief_contenido||'');
  const autoChk=$('mision-codigo-auto');
  const codInput=$('mision-codigo-maestro');
  const efectivo=$('mision-codigo-efectivo');
  const esAuto = !m.codigo_maestro;
  if(autoChk) autoChk.checked = esAuto;
  if(codInput){ codInput.value = m.codigo_maestro||''; codInput.disabled = esAuto; }
  if(efectivo) efectivo.textContent = m.codigo_maestro_efectivo||'—';
  await cargarSalasMision(id);
  // Inicializar editores WYSIWYG vacíos — se llenan al seleccionar sala
  // (no hace falta acá, son de la sala no de la misión)
}
async function cargarSalasMision(misionId){
  const {datos, error} = await Contenido.estaciones(misionId);
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudieron cargar las salas.')); return; }
  salasP5 = Array.isArray(datos)? datos.slice().sort((a,b)=> (a.orden||0)-(b.orden||0)) : [];
  renderListaSalas();
  if(salasP5.length) seleccionarSalaP5(salasP5[0].id);
  else {
    salaActivaP5=null;
    $('form-sala')?.setAttribute('hidden','');
  }
}
function renderListaSalas(){
  const ul=$('lista-salas-mision');
  if(!ul) return;
  ul.textContent='';
  salasP5.forEach((s, idx)=>{
    const li=document.createElement('li');
    li.className='flex items-center gap-1';
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='flex-1 text-left px-3 py-2 border border-audit-border rounded text-xs font-evidence-data hover:border-primary hover:bg-surface-container-high '+ (String(s.id)===String(salaActivaP5?.id)?'border-primary bg-primary/10 text-primary':'');
    btn.textContent=`${s.orden}. ${s.titulo} · ${s.desbloqueo}`;
    btn.addEventListener('click', ()=> seleccionarSalaP5(s.id));
    const up=document.createElement('button'); up.type='button'; up.textContent='↑'; up.title='Subir';
    up.className='px-2 py-1 border border-audit-border text-xs hover:border-primary disabled:opacity-30';
    up.disabled = idx===0;
    up.addEventListener('click', ()=> moverSala(s.id, -1));
    const down=document.createElement('button'); down.type='button'; down.textContent='↓'; down.title='Bajar';
    down.className='px-2 py-1 border border-audit-border text-xs hover:border-primary disabled:opacity-30';
    down.disabled = idx===salasP5.length-1;
    down.addEventListener('click', ()=> moverSala(s.id, 1));
    li.append(btn, up, down);
    ul.appendChild(li);
  });
}
async function moverSala(id, dir){
  const idx = salasP5.findIndex(s=> String(s.id)===String(id));
  if(idx<0) return;
  const nuevoIdx = idx+dir;
  if(nuevoIdx<0 || nuevoIdx>=salasP5.length) return;
  const ordenIds = salasP5.map(s=> s.id);
  const tmp = ordenIds[idx]; ordenIds[idx]=ordenIds[nuevoIdx]; ordenIds[nuevoIdx]=tmp;
  const {datos, error} = await Contenido.reordenarEstaciones(misionActivaP5.id, ordenIds);
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudo reordenar.')); return; }
  salasP5 = Array.isArray(datos)? datos.slice().sort((a,b)=> (a.orden||0)-(b.orden||0)) : salasP5;
  renderListaSalas();
  // Refrescar biblioteca para codigo maestro efectivo
  await cargarBiblioteca();
  const mActualizado = misionesP5.find(m=> String(m.id)===String(misionActivaP5.id));
  if(mActualizado){ misionActivaP5=mActualizado; const fe=$('mision-codigo-efectivo'); if(fe) fe.textContent=mActualizado.codigo_maestro_efectivo||'—'; }
}
function seleccionarSalaP5(id){
  const s = salasP5.find(x=> String(x.id)===String(id));
  if(!s) return;
  salaActivaP5 = s;
  renderListaSalas();
  const form=$('form-sala');
  if(form) form.removeAttribute('hidden');
  $('sala-titulo').value = s.titulo||'';
  $('sala-pilar').value = s.pilar||'';
  $('sala-icono').value = s.icono||'';
  $('sala-desbloqueo').value = s.desbloqueo||'libre';
  $('sala-codigo').value = s.codigo||'';
  // WYSIWYG — recrear editores con valor de la sala
  wysNarrativa = crearEditorEnriquecido('sala-narrativa-editor', s.narrativa||'');
  wysReto = crearEditorEnriquecido('sala-reto-editor', s.reto||'');
  wysFeedback = crearEditorEnriquecido('sala-feedback-ok-editor', s.feedback_ok||'');
  // Datos y pistas — reusando helpers generalizados
  renderEditorDatosP5(s.datos);
  renderEditorPistasP5(s.pistas);
  // Vista previa fiel
  actualizarVistaPreviaSalaP5();
  // Resumen del reto
  const resumen=$('sala-reto-resumen');
  if(resumen){
    const t=s.interaccion?.tipo||'—';
    const cierre = s.interaccion?.cierre ? ' + cierre' : '';
    resumen.textContent = `Mecanismo: ${t}${cierre} — editar en Constructor de reto →`;
  }
}
let datosListaP5 = [];
let pistasListaP5 = [];
function renderEditorDatosP5(datosObj){
  datosListaP5 = objetoADatosLista(datosObj||{});
  const cont=$('sala-datos-lista');
  if(!cont) return;
  cont.textContent='';
  datosListaP5.forEach((fila, idx)=> cont.appendChild(construirFilaDatoP5(fila, idx)));
}
function construirFilaDatoP5(fila, idx){
  const wrap=document.createElement('div'); wrap.className='fila-dato space-y-2';
  const cab=document.createElement('div'); cab.className='flex flex-wrap items-center gap-2';
  const inpClave=document.createElement('input'); inpClave.type='text'; inpClave.value=fila.clave; inpClave.placeholder='nombre_del_dato';
  inpClave.className='flex-1 min-w-[160px] bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
  inpClave.addEventListener('input', ()=>{ fila.clave=inpClave.value; actualizarVistaPreviaSalaP5(); });
  const selTipo=document.createElement('select'); selTipo.className='bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
  [['texto','Texto'],['lista','Lista'],['objeto','Objeto']].forEach(([v,t])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=t; if(fila.tipo===v) o.selected=true; selTipo.appendChild(o);
  });
  selTipo.addEventListener('change', ()=>{
    fila.tipo=selTipo.value;
    if(fila.tipo==='texto' && fila.valor==null) fila.valor='';
    if(fila.tipo==='lista' && !fila.items) fila.items=[];
    if(fila.tipo==='objeto' && !fila.pares) fila.pares=[];
    renderEditorDatosP5(datosListaAObjeto(datosListaP5));
    // Reconstruir desde objeto para no perder estado intermedio
    datosListaP5 = objetoADatosLista(datosListaAObjeto(datosListaP5));
    const cont=$('sala-datos-lista'); if(cont){ cont.textContent=''; datosListaP5.forEach((f,i)=> cont.appendChild(construirFilaDatoP5(f,i))); }
    actualizarVistaPreviaSalaP5();
  });
  const btnQ=document.createElement('button'); btnQ.type='button'; btnQ.textContent='Quitar';
  btnQ.className='text-xs border border-error text-error px-2 py-1 hover:bg-error hover:text-on-error';
  btnQ.addEventListener('click', ()=>{ datosListaP5.splice(idx,1); renderEditorDatosP5(datosListaAObjeto(datosListaP5)); actualizarVistaPreviaSalaP5(); });
  cab.append(inpClave, selTipo, btnQ);
  wrap.appendChild(cab);
  wrap.appendChild(construirSubEditorDatoP5(fila));
  return wrap;
}
function construirSubEditorDatoP5(fila){
  if(fila.tipo==='lista'){
    const cont=document.createElement('div'); cont.className='space-y-1 pl-2';
    (fila.items||[]).forEach((item,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2';
      const inp=document.createElement('input'); inp.type='text'; inp.value=item;
      inp.className='flex-1 bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
      inp.addEventListener('input', ()=>{ fila.items[i]=inp.value; actualizarVistaPreviaSalaP5(); });
      const q=document.createElement('button'); q.type='button'; q.textContent='×'; q.className='px-2 border border-error text-error hover:bg-error hover:text-on-error';
      q.addEventListener('click', ()=>{ fila.items.splice(i,1); renderEditorDatosP5(datosListaAObjeto(datosListaP5)); actualizarVistaPreviaSalaP5(); });
      row.append(inp,q); cont.appendChild(row);
    });
    const add=document.createElement('button'); add.type='button'; add.textContent='+ línea'; add.className='text-xs text-primary hover:underline';
    add.addEventListener('click', ()=>{ fila.items.push(''); renderEditorDatosP5(datosListaAObjeto(datosListaP5)); actualizarVistaPreviaSalaP5(); });
    cont.appendChild(add); return cont;
  }
  if(fila.tipo==='objeto'){
    const cont=document.createElement('div'); cont.className='space-y-1 pl-2';
    (fila.pares||[]).forEach((par,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2';
      const k=document.createElement('input'); k.type='text'; k.value=par.clave; k.placeholder='clave';
      k.className='w-1/3 bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
      k.addEventListener('input', ()=>{ par.clave=k.value; actualizarVistaPreviaSalaP5(); });
      const v=document.createElement('input'); v.type='text'; v.value=par.valor; v.placeholder='valor';
      v.className='flex-1 bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
      v.addEventListener('input', ()=>{ par.valor=v.value; actualizarVistaPreviaSalaP5(); });
      const q=document.createElement('button'); q.type='button'; q.textContent='×'; q.className='px-2 border border-error text-error hover:bg-error hover:text-on-error';
      q.addEventListener('click', ()=>{ fila.pares.splice(i,1); renderEditorDatosP5(datosListaAObjeto(datosListaP5)); actualizarVistaPreviaSalaP5(); });
      row.append(k,v,q); cont.appendChild(row);
    });
    const add=document.createElement('button'); add.type='button'; add.textContent='+ par'; add.className='text-xs text-primary hover:underline';
    add.addEventListener('click', ()=>{ fila.pares.push({clave:'',valor:''}); renderEditorDatosP5(datosListaAObjeto(datosListaP5)); actualizarVistaPreviaSalaP5(); });
    cont.appendChild(add); return cont;
  }
  const cont=document.createElement('div'); cont.className='pl-2';
  const ta=document.createElement('textarea'); ta.rows=2; ta.value=fila.valor||'';
  ta.className='w-full bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
  ta.addEventListener('input', ()=>{ fila.valor=ta.value; actualizarVistaPreviaSalaP5(); });
  cont.appendChild(ta); return cont;
}
function renderEditorPistasP5(pistas){
  pistasListaP5 = Array.isArray(pistas)? pistas.slice(): [];
  // wysPistas se maneja como editores enriquecidos por pista — pero para simplicidad inicial,
  // si hay editores ya creados, los limpiamos y recreamos
  const cont=$('sala-pistas-lista');
  if(!cont) return;
  cont.textContent='';
  wysPistas=[];
  pistasListaP5.forEach((texto,i)=>{
    const row=document.createElement('div'); row.className='border border-audit-border bg-surface-container-low p-2 space-y-1';
    const label=document.createElement('div'); label.className='font-label-sm text-xs uppercase text-on-surface-variant'; label.textContent=`Pista ${i+1}`;
    const edCont=document.createElement('div'); edCont.id=`pista-editor-${i}`;
    const quitar=document.createElement('button'); quitar.type='button'; quitar.textContent='Quitar';
    quitar.className='text-xs border border-error text-error px-2 py-1 hover:bg-error hover:text-on-error';
    quitar.addEventListener('click', ()=>{ pistasListaP5.splice(i,1); renderEditorPistasP5(pistasListaP5); });
    row.append(label, edCont, quitar);
    cont.appendChild(row);
    // Crear editor después de attach al DOM
    setTimeout(()=>{
      const ed = crearEditorEnriquecido(`pista-editor-${i}`, texto);
      wysPistas[i]=ed;
    },0);
  });
  // Fallback síncrono para primera pista (si no hay timeout aún, igual funciona porque el div ya está)
  // Para pistas vacías, igual hay editores — el get se hace leyendo wysPistas o fallback
}
function actualizarVistaPreviaSalaP5(){
  setText('sala-prev-titulo', $('sala-titulo')?.value || salaActivaP5?.titulo || '');
  setText('sala-prev-pilar', $('sala-pilar')?.value || '');
  const narrativaVal = wysNarrativa ? wysNarrativa.getValue() : ($('sala-narrativa-editor')?.textContent||'');
  const retoVal = wysReto ? wysReto.getValue() : '';
  pintarNarrativaEstacion($('sala-prev-narrativa'), narrativaVal);
  const datosEl=$('sala-prev-datos');
  if(datosEl) pintarDatosEstacion(datosEl, datosListaAObjeto(datosListaP5));
  pintarRetoEstacion($('sala-prev-reto-texto'), retoVal);
}
async function guardarSalaP5(){
  if(!salaActivaP5){ mostrarMensajeContenido('Elegí una sala.'); return; }
  const titulo=$('sala-titulo')?.value.trim();
  const pilar=$('sala-pilar')?.value.trim();
  const icono=$('sala-icono')?.value.trim();
  const desbloqueo=$('sala-desbloqueo')?.value;
  const codigo=$('sala-codigo')?.value.trim();
  const narrativa = wysNarrativa ? wysNarrativa.getValue() : '';
  const reto = wysReto ? wysReto.getValue() : '';
  const feedback_ok = wysFeedback ? wysFeedback.getValue() : '';
  // Pistas desde wysPistas (si están inicializados) o fallback
  const pistas = wysPistas.length ? wysPistas.map(ed=> ed? ed.getValue().trim(): '').filter(Boolean)
    : pistasListaP5.map(p=> String(p||'').trim()).filter(Boolean);
  // Si algún editor de pista aún no inicializó (timeout), leer fallback
  if(pistas.length===0 && pistasListaP5.length) {
    // intentar leer de DOM directo
    pistasListaP5.forEach((_,i)=>{
      const ed=wysPistas[i];
      if(ed) pistas.push(ed.getValue().trim());
    });
  }
  // Si sigue vacío por timing, usar lista cruda
  const pistasFinal = pistas.length? pistas : pistasListaP5.map(p=> String(p||'').trim()).filter(Boolean);
  if(!titulo||!pilar||!narrativa.trim()||!reto.trim()||!feedback_ok.trim()){ mostrarMensajeContenido('Título, pilar, narrativa, reto y mensaje de acierto son obligatorios.'); return; }
  if(!codigo){ mostrarMensajeContenido('Código del fragmento es obligatorio.'); return; }
  const datos = datosListaAObjeto(datosListaP5);
  if(Object.keys(datos).length===0){ mostrarMensajeContenido('Agregá al menos un dato del expediente.'); return; }
  // Interacción/respuesta/visual se guardan desde el Constructor — acá se conservan tal cual
  const payload = {
    titulo, pilar, narrativa, reto, datos,
    pistas: pistasFinal.length? pistasFinal : ['Pista 1','Pista 2','Pista 3'],
    feedback_ok, codigo, interaccion: salaActivaP5.interaccion, respuesta: salaActivaP5.respuesta,
    desbloqueo: desbloqueo||'libre', icono: icono||null, visual: salaActivaP5.visual||null
  };
  if(!payload.pistas || payload.pistas.length===0) payload.pistas=['Pista 1','Pista 2','Pista 3'];
  // Validación mínima: si no hay interaccion aún, no se puede guardar — pedir constructor
  if(!payload.interaccion){ mostrarMensajeContenido('Esta sala aún no tiene reto interactivo. Usá "Constructor de reto" primero.'); return; }
  if(!confirm(`¿Guardar cambios en "${salaActivaP5.titulo}"?`)) return;
  const {datos: guardada, error} = await Contenido.actualizarEstacion(salaActivaP5.id, payload);
  if(error){ mostrarMensajeContenido(mensajeError(error, `No se pudo guardar: ${error.campo||''}`)); return; }
  mostrarMensajeContenido('Sala guardada.', 'ok');
  // Refrescar cache
  const idx = salasP5.findIndex(s=> String(s.id)===String(guardada.id));
  if(idx>=0) salasP5[idx]=guardada;
  salaActivaP5=guardada;
  renderListaSalas();
  actualizarVistaPreviaSalaP5();
}
async function guardarMisionP5(){
  if(!misionActivaP5){ mostrarMensajeContenido('Ninguna misión seleccionada.'); return; }
  const titulo=$('mision-titulo')?.value.trim();
  const subtitulo=$('mision-subtitulo')?.value.trim();
  const intro=$('mision-intro')?.value.trim();
  const veredicto=$('mision-veredicto')?.value.trim();
  const autoChk=$('mision-codigo-auto')?.checked;
  const codigoRaw=$('mision-codigo-maestro')?.value.trim();
  const briefTitulo=$('mision-brief-titulo')?.value.trim();
  const briefContenido=wysBrief ? wysBrief.getValue() : '';
  if(!titulo||!veredicto){ mostrarMensajeContenido('Título y veredicto son obligatorios.'); return; }
  const payload={
    slug: misionActivaP5.slug, titulo, subtitulo: subtitulo||null, intro: intro||null, veredicto,
    codigo_maestro: autoChk? null : (codigoRaw||null),
    brief_titulo: briefTitulo||null, brief_contenido: briefContenido||null,
  };
  const {datos, error} = await Contenido.actualizarMision(misionActivaP5.id, payload);
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudo guardar la misión.')); return; }
  mostrarMensajeContenido('Misión guardada.', 'ok');
  misionActivaP5=datos;
  const fe=$('mision-codigo-efectivo'); if(fe) fe.textContent=datos.codigo_maestro_efectivo||'—';
  await cargarBiblioteca();
}
async function agregarSalaP5(){
  if(!misionActivaP5){ mostrarMensajeContenido('Elegí una misión primero.'); return; }
  // Crear sala mínima válida con mecanismo por defecto opcion_unica
  const payload={
    titulo:'Nueva sala', pilar:'Pilar', narrativa:'Narrativa de la sala.', reto:'¿Cuál es la respuesta correcta?',
    datos:{ clave:'valor de ejemplo' }, pistas:['Pista 1','Pista 2','Pista 3'], feedback_ok:'¡Correcto! Código: XX',
    codigo:'XX', interaccion:{ tipo:'opcion_unica', enunciado:'Elegí una opción', opciones:[{id:'a', texto:'Opción A'},{id:'b', texto:'Opción B'}] },
    respuesta:{ valor:'a' }, desbloqueo:'libre', icono:'help', visual:null
  };
  const {datos, error} = await Contenido.crearEstacion(misionActivaP5.id, payload);
  if(error){ mostrarMensajeContenido(mensajeError(error, `No se pudo crear la sala: ${error.campo||''}`)); return; }
  mostrarMensajeContenido('Sala creada.', 'ok');
  await cargarSalasMision(misionActivaP5.id);
  seleccionarSalaP5(datos.id);
}
async function borrarSalaP5(){
  if(!salaActivaP5){ mostrarMensajeContenido('Ninguna sala seleccionada.'); return; }
  if(!confirm(`¿Borrar "${salaActivaP5.titulo}" para siempre?`)) return;
  const {error} = await Contenido.borrarEstacion(salaActivaP5.id);
  if(error){ mostrarMensajeContenido(mensajeError(error, 'No se pudo borrar.')); return; }
  mostrarMensajeContenido('Sala borrada.', 'ok');
  await cargarSalasMision(misionActivaP5.id);
}

// ---------- Constructor de reto P5 ----------
let retoState = { tipo:'opcion_unica', enunciado:'', opciones:[], items:[], categorias:[], modo:'texto', placeholder:'', min:null, max:null, paso:null, sufijo:'', cierre:null, visual:null, respuesta:{ valor:null } };
let retoRespuestaExtra = { min:null, max:null }; // para respuesta_corta modo numero por rango
let retoMarcaInicial = null; // P12 — respuesta a marcar en el próximo render (abrir sala)

function initConstructorDesdeSala(){
  const inter = salaActivaP5?.interaccion||{};
  const resp = salaActivaP5?.respuesta||{};
  retoState.tipo = inter.tipo||'opcion_unica';
  retoState.enunciado = inter.enunciado||'';
  retoState.modo = inter.modo||'texto';
  retoState.placeholder = inter.placeholder||'';
  retoState.min = inter.min??null; retoState.max = inter.max??null; retoState.paso = inter.paso??null; retoState.sufijo = inter.sufijo||'';
  // Clonar opciones/items/categorias con ids estables
  retoState.opciones = Array.isArray(inter.opciones)? inter.opciones.map(o=> ({...o})) : [{id:'a', texto:'Opción A'},{id:'b', texto:'Opción B'}];
  retoState.items = Array.isArray(inter.items)? inter.items.map(it=> ({...it})) : [{id:'item1', texto:'Ítem 1'},{id:'item2', texto:'Ítem 2'}];
  retoState.categorias = Array.isArray(inter.categorias)? inter.categorias.map(c=> ({...c})) : [{id:'cat1', texto:'Categoría 1'},{id:'cat2', texto:'Categoría 2'}];
  retoState.barajar = inter.barajar??false;
  retoState.cierre = inter.cierre ? { enunciado: inter.cierre.enunciado||'', opciones: (inter.cierre.opciones||[]).map(o=> ({...o})) } : null;
  if(resp.min!==undefined || resp.max!==undefined){
    retoRespuestaExtra.min = resp.min??null; retoRespuestaExtra.max = resp.max??null;
    retoState.respuesta = { valor: null, min: resp.min, max: resp.max, cierre: resp.cierre };
  } else {
    retoRespuestaExtra.min=null; retoRespuestaExtra.max=null;
    retoState.respuesta = { valor: resp.valor??null, cierre: resp.cierre };
  }
  retoState.visual = salaActivaP5?.visual ? JSON.parse(JSON.stringify(salaActivaP5.visual)) : null;
  $('reto-mecanismo').value = retoState.tipo;
  $('reto-enunciado').value = retoState.enunciado;
  $('reto-cierre-activo').checked = !!retoState.cierre;
  renderSubformReto();
  renderCierreSubform();
  renderVisualForm();
  // P12 — la respuesta guardada se marca en el widget al abrir. {} (no null)
  // para que una sala sin respuesta no herede la marca del widget anterior.
  retoMarcaInicial = salaActivaP5?.respuesta || {};
  actualizarVistaPreviaReto();
}
function renderSubformReto(){
  const cont=$('reto-subform');
  if(!cont) return;
  cont.textContent='';
  const tipo=retoState.tipo;
  if(tipo==='opcion_unica'){
    const wrap=document.createElement('div'); wrap.className='space-y-2';
    const hdr=document.createElement('div'); hdr.className='flex justify-between items-center';
    hdr.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Opciones</span>';
    const add=document.createElement('button'); add.type='button'; add.textContent='+ opción'; add.className='text-xs border border-primary text-primary px-2 py-1 hover:bg-primary hover:text-on-primary';
    add.addEventListener('click', ()=>{ const nid=slugifyId('opcion_'+(retoState.opciones.length+1)); retoState.opciones.push({id:nid, texto:'Nueva opción'}); renderSubformReto(); actualizarVistaPreviaReto(); });
    hdr.appendChild(add); wrap.appendChild(hdr);
    retoState.opciones.forEach((op,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2 items-center';
      const idInput=document.createElement('input'); idInput.type='text'; idInput.value=op.id; idInput.placeholder='id'; idInput.className='w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs'; idInput.disabled=true; idInput.title='ID autogenerado, no editable';
      const txtInput=document.createElement('input'); txtInput.type='text'; txtInput.value=op.texto; txtInput.className='flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      txtInput.addEventListener('input', ()=>{ op.texto=txtInput.value; actualizarVistaPreviaReto(); });
      const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error hover:bg-error hover:text-on-error';
      del.addEventListener('click', ()=>{ retoState.opciones.splice(i,1); renderSubformReto(); actualizarVistaPreviaReto(); });
      row.append(idInput, txtInput, del); wrap.appendChild(row);
    });
    cont.appendChild(wrap);
  } else if(tipo==='respuesta_corta'){
    const wrap=document.createElement('div'); wrap.className='space-y-3';
    const modoRow=document.createElement('div'); modoRow.className='flex gap-2 items-center';
    const selModo=document.createElement('select'); selModo.className='bg-surface-container-low border border-audit-border rounded px-2 py-1 text-xs';
    [['texto','Texto'],['numero','Número']].forEach(([v,t])=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; if(retoState.modo===v) o.selected=true; selModo.appendChild(o); });
    selModo.addEventListener('change', ()=>{ retoState.modo=selModo.value; renderSubformReto(); actualizarVistaPreviaReto(); });
    modoRow.append(document.createTextNode('Modo:'), selModo);
    if(retoState.modo==='numero'){
      const sufInput=document.createElement('input'); sufInput.type='text'; sufInput.placeholder='Sufijo ej. %'; sufInput.value=retoState.sufijo||''; sufInput.className='w-20 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      sufInput.addEventListener('input', ()=>{ retoState.sufijo=sufInput.value; actualizarVistaPreviaReto(); });
      modoRow.append(sufInput);
    }
    wrap.appendChild(modoRow);
    const phRow=document.createElement('label'); phRow.className='block';
    phRow.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Placeholder</span>';
    const phInput=document.createElement('input'); phInput.type='text'; phInput.value=retoState.placeholder||''; phInput.className='mt-1 w-full bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
    phInput.addEventListener('input', ()=>{ retoState.placeholder=phInput.value; actualizarVistaPreviaReto(); });
    phRow.appendChild(phInput); wrap.appendChild(phRow);
    if(retoState.modo==='numero'){
      const numRow=document.createElement('div'); numRow.className='grid grid-cols-3 gap-2';
      [['min','Mín'],['max','Máx'],['paso','Paso']].forEach(([k,label])=>{
        const lab=document.createElement('label'); lab.className='block';
        lab.innerHTML=`<span class="font-label-sm text-xs uppercase text-on-surface-variant">${label}</span>`;
        const inp=document.createElement('input'); inp.type='number'; inp.step='any'; inp.value=retoState[k]??''; inp.className='mt-1 w-full bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
        inp.addEventListener('input', ()=>{ retoState[k]= inp.value===''? null : Number(inp.value); actualizarVistaPreviaReto(); });
        lab.appendChild(inp); numRow.appendChild(lab);
      });
      wrap.appendChild(numRow);
      // Respuesta número por rango (trampa 3 briefing): dos inputs propios para min/max de RESPUESTA
      // separados de los de interaccion y de visual. No confundir con visual-rango.
      const respRow=document.createElement('div'); respRow.className='border border-audit-border p-2 space-y-2';
      respRow.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Respuesta correcta — rango (opcional, deja vacío para valor exacto)</span>';
      const modoResp=document.createElement('div'); modoResp.className='flex gap-2';
      const inpMin=document.createElement('input'); inpMin.type='number'; inpMin.step='any'; inpMin.placeholder='Mín (rango)'; inpMin.value= retoRespuestaExtra.min??'';
      inpMin.className='w-1/2 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      const inpMax=document.createElement('input'); inpMax.type='number'; inpMax.step='any'; inpMax.placeholder='Máx'; inpMax.value= retoRespuestaExtra.max??'';
      inpMax.className='w-1/2 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      inpMin.addEventListener('input', ()=>{ retoRespuestaExtra.min= inpMin.value===''? null : Number(inpMin.value); actualizarResumenRespuesta(); });
      inpMax.addEventListener('input', ()=>{ retoRespuestaExtra.max= inpMax.value===''? null : Number(inpMax.value); actualizarResumenRespuesta(); });
      modoResp.append(inpMin, inpMax);
      respRow.append(modoResp);
      const ayuda=document.createElement('p'); ayuda.className='font-label-sm text-xs text-on-surface-variant'; ayuda.textContent='Si dejás el rango vacío, la respuesta se toma del widget de abajo (valor exacto). Si ponés mín/máx, el widget debe tener un valor dentro del rango al probar, pero al guardar se usará el rango.';
      respRow.appendChild(ayuda);
      wrap.appendChild(respRow);
    } else {
      // Texto: la respuesta se marca en el widget de abajo, no en campo aparte (plan P5)
      const info=document.createElement('p'); info.className='font-label-sm text-xs text-on-surface-variant border border-audit-border bg-surface-container-lowest p-2';
      info.textContent='Escribí la respuesta correcta en el widget de abajo, en «Respuesta correcta». No hay campo aparte.';
      wrap.appendChild(info);
    }
    cont.appendChild(wrap);
  } else if(tipo==='orden'){
    const wrap=document.createElement('div'); wrap.className='space-y-2';
    const hdr=document.createElement('div'); hdr.className='flex justify-between items-center';
    hdr.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Ítems (orden correcto = respuesta)</span>';
    const add=document.createElement('button'); add.type='button'; add.textContent='+ ítem'; add.className='text-xs border border-primary text-primary px-2 py-1';
    add.addEventListener('click', ()=>{ const nid=slugifyId('item_'+(retoState.items.length+1)); retoState.items.push({id:nid, texto:'Nuevo ítem'}); renderSubformReto(); actualizarVistaPreviaReto(); });
    hdr.appendChild(add); wrap.appendChild(hdr);
    retoState.items.forEach((it,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2 items-center';
      const idEl=document.createElement('input'); idEl.type='text'; idEl.value=it.id; idEl.disabled=true; idEl.className='w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs opacity-60';
      const txt=document.createElement('input'); txt.type='text'; txt.value=it.texto; txt.className='flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      txt.addEventListener('input', ()=>{ it.texto=txt.value; actualizarVistaPreviaReto(); });
      const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error';
      del.addEventListener('click', ()=>{ retoState.items.splice(i,1); renderSubformReto(); actualizarVistaPreviaReto(); });
      row.append(idEl, txt, del); wrap.appendChild(row);
    });
    const barajarRow=document.createElement('label'); barajarRow.className='flex items-center gap-2 text-xs';
    const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=!!retoState.barajar;
    chk.addEventListener('change', ()=>{ retoState.barajar=chk.checked; actualizarVistaPreviaReto(); });
    barajarRow.append(chk, document.createTextNode('Barajar al mostrar (recomendado)'));
    wrap.appendChild(barajarRow);
    cont.appendChild(wrap);
  } else if(tipo==='checklist'){
    const wrap=document.createElement('div'); wrap.className='space-y-2';
    const hdr=document.createElement('div'); hdr.className='flex justify-between items-center';
    hdr.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Ítems — marcar los correctos abajo en la vista previa</span>';
    const add=document.createElement('button'); add.type='button'; add.textContent='+ ítem'; add.className='text-xs border border-primary text-primary px-2 py-1';
    add.addEventListener('click', ()=>{ const nid=slugifyId('chk_'+(retoState.items.length+1)); retoState.items.push({id:nid, texto:'Nuevo ítem'}); renderSubformReto(); actualizarVistaPreviaReto(); });
    hdr.appendChild(add); wrap.appendChild(hdr);
    retoState.items.forEach((it,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2 items-center';
      const idEl=document.createElement('input'); idEl.type='text'; idEl.value=it.id; idEl.disabled=true; idEl.className='w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs opacity-60';
      const txt=document.createElement('input'); txt.type='text'; txt.value=it.texto; txt.className='flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      txt.addEventListener('input', ()=>{ it.texto=txt.value; actualizarVistaPreviaReto(); });
      const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error';
      del.addEventListener('click', ()=>{ retoState.items.splice(i,1); renderSubformReto(); actualizarVistaPreviaReto(); });
      row.append(idEl, txt, del); wrap.appendChild(row);
    });
    cont.appendChild(wrap);
  } else if(tipo==='clasificacion'){
    const wrap=document.createElement('div'); wrap.className='space-y-3';
    // Categorías
    const catHdr=document.createElement('div'); catHdr.className='flex justify-between items-center';
    catHdr.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Categorías</span>';
    const addCat=document.createElement('button'); addCat.type='button'; addCat.textContent='+ categoría'; addCat.className='text-xs border border-primary text-primary px-2 py-1';
    addCat.addEventListener('click', ()=>{ const nid=slugifyId('cat_'+(retoState.categorias.length+1)); retoState.categorias.push({id:nid, texto:'Nueva categoría'}); renderSubformReto(); actualizarVistaPreviaReto(); });
    catHdr.appendChild(addCat); wrap.appendChild(catHdr);
    retoState.categorias.forEach((cat,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2 items-center';
      const idEl=document.createElement('input'); idEl.type='text'; idEl.value=cat.id; idEl.disabled=true; idEl.className='w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs opacity-60';
      const txt=document.createElement('input'); txt.type='text'; txt.value=cat.texto; txt.className='flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      txt.addEventListener('input', ()=>{ cat.texto=txt.value; actualizarVistaPreviaReto(); });
      const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error';
      del.addEventListener('click', ()=>{ retoState.categorias.splice(i,1); renderSubformReto(); actualizarVistaPreviaReto(); });
      row.append(idEl, txt, del); wrap.appendChild(row);
    });
    // Ítems
    const itHdr=document.createElement('div'); itHdr.className='flex justify-between items-center';
    itHdr.innerHTML='<span class="font-label-sm text-xs uppercase text-on-surface-variant">Ítems a clasificar — la categoría correcta se marca abajo</span>';
    const addIt=document.createElement('button'); addIt.type='button'; addIt.textContent='+ ítem'; addIt.className='text-xs border border-primary text-primary px-2 py-1';
    addIt.addEventListener('click', ()=>{ const nid=slugifyId('frase_'+(retoState.items.length+1)); retoState.items.push({id:nid, texto:'Nueva frase'}); renderSubformReto(); actualizarVistaPreviaReto(); });
    itHdr.appendChild(addIt); wrap.appendChild(itHdr);
    retoState.items.forEach((it,i)=>{
      const row=document.createElement('div'); row.className='flex gap-2 items-center';
      const idEl=document.createElement('input'); idEl.type='text'; idEl.value=it.id; idEl.disabled=true; idEl.className='w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs opacity-60';
      const txt=document.createElement('input'); txt.type='text'; txt.value=it.texto; txt.className='flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
      txt.addEventListener('input', ()=>{ it.texto=txt.value; actualizarVistaPreviaReto(); });
      const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error';
      del.addEventListener('click', ()=>{ retoState.items.splice(i,1); renderSubformReto(); actualizarVistaPreviaReto(); });
      row.append(idEl, txt, del); wrap.appendChild(row);
    });
    cont.appendChild(wrap);
  }
}
function renderCierreSubform(){
  const cont=$('reto-cierre-opciones-lista');
  const wrap=$('reto-cierre-subform');
  if(!wrap) return;
  if(!retoState.cierre){ wrap.setAttribute('hidden',''); return; }
  wrap.removeAttribute('hidden');
  $('reto-cierre-enunciado').value = retoState.cierre.enunciado||'';
  if(!cont) return;
  cont.textContent='';
  (retoState.cierre.opciones||[]).forEach((op,i)=>{
    const row=document.createElement('div'); row.className='flex gap-2 items-center';
    const idEl=document.createElement('input'); idEl.type='text'; idEl.value=op.id; idEl.disabled=true; idEl.className='w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs opacity-60';
    const txt=document.createElement('input'); txt.type='text'; txt.value=op.texto; txt.className='flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
    txt.addEventListener('input', ()=>{ op.texto=txt.value; actualizarVistaPreviaReto(); });
    const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error';
    del.addEventListener('click', ()=>{ retoState.cierre.opciones.splice(i,1); renderCierreSubform(); actualizarVistaPreviaReto(); });
    row.append(idEl, txt, del); cont.appendChild(row);
  });
}
function construirInteraccionDesdeRetoState(){
  const inter={ tipo: retoState.tipo, enunciado: ($('reto-enunciado')?.value||'').trim() };
  if(!inter.enunciado) inter.enunciado='Pregunta';
  if(retoState.tipo==='opcion_unica'){
    inter.opciones = retoState.opciones.map(o=> ({id:o.id, texto:o.texto}));
  } else if(retoState.tipo==='respuesta_corta'){
    inter.modo = retoState.modo;
    if(retoState.placeholder) inter.placeholder=retoState.placeholder;
    if(retoState.modo==='numero'){
      if(retoState.min!=null) inter.min=retoState.min;
      if(retoState.max!=null) inter.max=retoState.max;
      if(retoState.paso!=null) inter.paso=retoState.paso;
      if(retoState.sufijo) inter.sufijo=retoState.sufijo;
    }
  } else if(retoState.tipo==='orden'){
    inter.items = retoState.items.map(it=> ({id:it.id, texto:it.texto}));
    inter.barajar = !!retoState.barajar;
  } else if(retoState.tipo==='checklist'){
    inter.items = retoState.items.map(it=> ({id:it.id, texto:it.texto}));
  } else if(retoState.tipo==='clasificacion'){
    inter.items = retoState.items.map(it=> ({id:it.id, texto:it.texto}));
    inter.categorias = retoState.categorias.map(c=> ({id:c.id, texto:c.texto}));
  }
  if(retoState.cierre){
    inter.cierre = { enunciado: $('reto-cierre-enunciado')?.value.trim() || retoState.cierre.enunciado, opciones: retoState.cierre.opciones.map(o=> ({id:o.id, texto:o.texto})) };
  }
  return inter;
}
function construirRespuestaDesdeReto(){
  // Lee la respuesta marcada en #reto-widget-marcar vía serializarRespuesta(),
  // con el contenedor explícito: hay otro widget vivo en la misma pantalla
  // ("probar sala"), y depender del "último renderizado" global es la trampa
  // que ya mordió acá (js/render.js, `_porContenedor`).
  const marcada = serializarRespuesta($('reto-widget-marcar'));
  // Para respuesta_corta modo numero con rango, no viene de serializar sino de extra inputs
  if(retoState.tipo==='respuesta_corta' && retoState.modo==='numero' && (retoRespuestaExtra.min!=null || retoRespuestaExtra.max!=null)){
    const out={};
    if(retoRespuestaExtra.min!=null) out.min=retoRespuestaExtra.min;
    if(retoRespuestaExtra.max!=null) out.max=retoRespuestaExtra.max;
    if(marcada.cierre) out.cierre=marcada.cierre;
    return out;
  }
  return marcada;
}
function actualizarVistaPreviaReto(){
  const inter = construirInteraccionDesdeRetoState();
  const widgetMarcar=$('reto-widget-marcar');
  if(widgetMarcar){
    // P12 — reconstruir no borra la marca: se lee antes y se vuelve a aplicar
    // (lo que apunte a ids borrados se descarta solo, ver marcarRespuesta).
    const marca = retoMarcaInicial ?? serializarRespuesta(widgetMarcar);
    retoMarcaInicial = null;
    renderInteraccion(widgetMarcar, inter);
    marcarRespuesta(widgetMarcar, marca);
    actualizarResumenRespuesta();
  }
  const extra=$('reto-widget-extra');
  if(extra){
    extra.textContent='';
    // Para respuesta_corta numero con rango, mostrar nota
    if(retoState.tipo==='respuesta_corta' && retoState.modo==='numero' && (retoRespuestaExtra.min!=null || retoRespuestaExtra.max!=null)){
      const p=document.createElement('p'); p.className='font-label-sm text-xs text-on-surface-variant';
      p.textContent=`Rango configurado: ${retoRespuestaExtra.min??'—'} a ${retoRespuestaExtra.max??'—'} — la vista previa numérica sigue mostrando un input, pero al guardar se usará el rango.`;
      extra.appendChild(p);
    }
  }
  // Visual preview
  const vp=$('visual-preview');
  if(vp){
    vp.textContent='';
    const vis = construirVisualDesdeForm();
    if(vis){
      const g=crearGrafico(vis);
      if(g) vp.appendChild(g);
    }
  }
  // Mostrar bloque de probar si la sala ya existe en servidor (tiene id) y
  // renderizar SU PROPIO widget acá — no en ejecutarProbar(). render.js
  // guarda el estado de cada widget por contenedor (WeakMap), así que este
  // render no pisa el de #reto-widget-marcar de arriba: son dos widgets
  // vivos e independientes. Mismo criterio que ya aplicaba la vista previa
  // de marcar (se reconstruye en cada tecleo, current el reto vigente).
  const probarBloque=$('reto-probar-bloque');
  if(probarBloque){
    if(salaActivaP5?.id){
      probarBloque.removeAttribute('hidden');
      const probarWidget=$('reto-probar-widget');
      if(probarWidget) renderInteraccion(probarWidget, inter);
      const resultadoEl=$('reto-probar-resultado');
      if(resultadoEl) resultadoEl.textContent='Interactuá arriba y luego presioná Probar.';
    } else {
      probarBloque.setAttribute('hidden','');
    }
  }
}
// P12 — resumen legible de lo marcado en #reto-widget-marcar (solo textContent).
function actualizarResumenRespuesta(){
  const el=$('reto-resumen-respuesta');
  if(!el) return;
  const r=construirRespuestaDesdeReto();
  const texto=(lista, id)=> (lista||[]).find(o=> String(o.id).toLowerCase()===String(id))?.texto ?? id;
  const partes=[];
  const v=r.valor;
  if(r.min!=null || r.max!=null) partes.push(`Correcta: rango ${r.min??'—'} a ${r.max??'—'}`);
  else if(v!==undefined && v!==null){
    if(retoState.tipo==='opcion_unica') partes.push(`Correcta: ${texto(retoState.opciones, v)}`);
    else if(retoState.tipo==='respuesta_corta') partes.push(`Correcta: ${v}`);
    else if(retoState.tipo==='orden') partes.push(`Orden: ${v.map(id=> texto(retoState.items, id)).join(' → ')}`);
    else if(retoState.tipo==='checklist') partes.push(`Correctas: ${v.map(id=> texto(retoState.items, id)).join(', ')}`);
    else if(retoState.tipo==='clasificacion'){
      const total=retoState.items.length, hechos=Object.keys(v).length;
      partes.push(`Clasificación (${hechos} de ${total}): ${Object.entries(v).map(([i,c])=> `${texto(retoState.items, i)} → ${texto(retoState.categorias, c)}`).join(' · ')}`);
    }
  }
  if(r.cierre) partes.push(`Cierre: ${texto(retoState.cierre?.opciones, r.cierre)}`);
  el.textContent = partes.length ? partes.join(' · ') : 'Sin respuesta marcada todavía.';
}
function construirVisualDesdeForm(){
  const tipo=$('visual-tipo')?.value||'';
  if(!tipo) return null;
  const titulo=$('visual-titulo')?.value.trim()||'';
  const unidad=$('visual-unidad')?.value.trim()||'';
  const pie=$('visual-pie')?.value.trim()||'';
  const seriesRows=$('visual-series-lista')?.querySelectorAll('.visual-serie-row')||[];
  const series=[];
  seriesRows.forEach(row=>{
    const et=row.querySelector('.visual-serie-etiqueta')?.value.trim()||'';
    const val=Number(row.querySelector('.visual-serie-valor')?.value);
    const nota=row.querySelector('.visual-serie-nota')?.value.trim()||'';
    if(et && !isNaN(val)) series.push({ etiqueta: et, valor: val, ...(nota?{nota}:{}) });
  });
  if(!series.length) return null;
  const rangoMin=$('visual-rango-min')?.value;
  const rangoMax=$('visual-rango-max')?.value;
  const rangoEtiqueta=$('visual-rango-etiqueta')?.value.trim();
  let rango=null;
  if(rangoMin!=='' && rangoMax!=='' && rangoMin!=null && rangoMax!=null && rangoMin!==undefined){
    const mn=Number(rangoMin), mx=Number(rangoMax);
    if(!isNaN(mn) && !isNaN(mx)) rango={ min: mn, max: mx, ...(rangoEtiqueta?{etiqueta:rangoEtiqueta}:{}) };
  }
  return { tipo, titulo, unidad, series, ...(pie?{pie}:{}), ...(rango?{rango}:{}) };
}
function renderVisualForm(){
  const tipoSel=$('visual-tipo');
  const campos=$('visual-campos');
  if(!tipoSel || !campos) return;
  const vis = retoState.visual;
  if(vis){
    tipoSel.value=vis.tipo||'';
    $('visual-titulo').value=vis.titulo||'';
    $('visual-unidad').value=vis.unidad||'';
    $('visual-pie').value=vis.pie||'';
    $('visual-rango-min').value=vis.rango?.min??'';
    $('visual-rango-max').value=vis.rango?.max??'';
    $('visual-rango-etiqueta').value=vis.rango?.etiqueta||'';
    renderSeriesList(vis.series||[]);
  } else {
    renderSeriesList([]);
  }
  if(tipoSel.value) campos.removeAttribute('hidden'); else campos.setAttribute('hidden','');
}
function renderSeriesList(series){
  const cont=$('visual-series-lista');
  if(!cont) return;
  cont.textContent='';
  series.forEach((s,i)=>{
    cont.appendChild(crearFilaSerie(s,i));
  });
}
function crearFilaSerie(s, idx){
  const row=document.createElement('div'); row.className='visual-serie-row flex gap-2 items-center border border-audit-border p-2 rounded';
  const et=document.createElement('input'); et.type='text'; et.value=s.etiqueta||''; et.placeholder='Etiqueta'; et.className='visual-serie-etiqueta flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
  const val=document.createElement('input'); val.type='number'; val.step='any'; val.value=s.valor??''; val.placeholder='Valor'; val.className='visual-serie-valor w-24 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
  const nota=document.createElement('input'); nota.type='text'; nota.value=s.nota||''; nota.placeholder='Nota'; nota.className='visual-serie-nota flex-1 bg-surface-container-lowest border border-audit-border rounded px-2 py-1 text-xs';
  const del=document.createElement('button'); del.type='button'; del.textContent='×'; del.className='px-2 border border-error text-error hover:bg-error hover:text-on-error';
  del.addEventListener('click', ()=>{ row.remove(); actualizarVistaPreviaReto(); });
  [et,val,nota].forEach(inp=> inp.addEventListener('input', ()=> actualizarVistaPreviaReto()));
  row.append(et,val,nota,del); return row;
}
async function ejecutarProbar(){
  // NO re-renderizar acá: el widget ya está vivo desde que se abrió el
  // constructor o desde el último tecleo (actualizarVistaPreviaReto() lo
  // arma). Re-renderizarlo justo antes de serializar era exactamente el bug
  // — borraba lo que el docente acababa de marcar, medio milisegundo antes
  // de leerlo (js/render.js `_porContenedor`, más arriba). serializarRespuesta
  // ahora lee el estado de ESTE contenedor puntual, así que ni siquiera
  // importa qué se haya renderizado después en #reto-widget-marcar.
  const probarWidget=$('reto-probar-widget');
  const respuesta = serializarRespuesta(probarWidget);
  // Si es respuesta_corta numero con rango, usar el rango
  let payload = respuesta;
  if(retoState.tipo==='respuesta_corta' && retoState.modo==='numero' && (retoRespuestaExtra.min!=null || retoRespuestaExtra.max!=null)){
    payload={ min: retoRespuestaExtra.min, max: retoRespuestaExtra.max, ...(respuesta.cierre?{cierre:respuesta.cierre}:{}) };
    // Si no hay valor exacto, payload es el rango; probar con un valor dentro del rango simulado
    // Para probar, enviamos el punto medio del rango como valor
    if(payload.min!=null && payload.max!=null) payload={ valor: (payload.min+payload.max)/2, ...(payload.cierre?{cierre:payload.cierre}:{}) };
  }
  // Si está vacío, igual se envía para que el servidor responda detalle vacio
  const {datos, error} = await Contenido.probarEstacion(salaActivaP5.id, payload);
  const resEl=$('reto-probar-resultado');
  if(!resEl) return;
  if(error){ resEl.textContent=error.mensaje||'Error al probar.'; resEl.className='font-evidence-data text-sm text-error'; return; }
  const ok = datos?.ok || datos?.correcto;
  const detalle = datos?.detalle||'';
  const pista = datos?.pista||'';
  resEl.className='font-evidence-data text-sm '+(ok?'text-primary':'text-on-surface-variant');
  resEl.textContent = ok? `✓ Correcto — ${datos.codigo||''} ${datos.feedback||''}` : `Detalle: ${detalle} ${pista? '· Pista: '+pista: ''}`;
}
async function guardarRetoP5(){
  if(!salaActivaP5){ mostrarMensajeContenido('Ninguna sala seleccionada.'); return; }
  const inter = construirInteraccionDesdeRetoState();
  if(inter.tipo==='opcion_unica' && (!inter.opciones || inter.opciones.length<2)){ mostrarMensajeContenido('Opción única necesita al menos 2 opciones.'); return; }
  if((inter.tipo==='orden' || inter.tipo==='checklist') && (!inter.items || inter.items.length<2)){ mostrarMensajeContenido('Se necesitan al menos 2 ítems.'); return; }
  if(inter.tipo==='clasificacion' && (!inter.items?.length || !inter.categorias?.length)){ mostrarMensajeContenido('Clasificación necesita ítems y categorías.'); return; }
  // Capturar respuesta desde el widget YA renderizado — NO re-renderizar acá
  // porque renderInteraccion() pisa el _estado singleton y borra la marca
  // que el docente acaba de hacer (trampa 1 y 2 del briefing).
  let respuesta = construirRespuestaDesdeReto();
  // Si respuesta está vacía y es opcion_unica/checklist etc, advertir
  if(!respuesta.valor && !(respuesta.min!=null || respuesta.max!=null)){
    if(!confirm('No marcaste ninguna respuesta correcta en la vista previa. ¿Guardar igual? El servidor rechazará si la respuesta no coincide con la interaccion.')) return;
  }
  // Validar que la respuesta apunte a ids existentes (el servidor hará lo mismo, pero avisar antes)
  const visual = construirVisualDesdeForm();
  // Actualizar caches
  retoState.visual = visual;
  salaActivaP5.interaccion = inter;
  salaActivaP5.respuesta = respuesta;
  salaActivaP5.visual = visual;
  // Guardar via PUT estaciones/:id — necesita payload completo de sala, no solo interaccion
  // Reusar datos de la sala actual (titulo etc) — ya están en salaActivaP5
  const payload={
    titulo: salaActivaP5.titulo, pilar: salaActivaP5.pilar, narrativa: salaActivaP5.narrativa, reto: salaActivaP5.reto,
    datos: salaActivaP5.datos, pistas: salaActivaP5.pistas, feedback_ok: salaActivaP5.feedback_ok, codigo: salaActivaP5.codigo,
    interaccion: inter, respuesta: respuesta, desbloqueo: salaActivaP5.desbloqueo, icono: salaActivaP5.icono, visual: visual
  };
  const {datos, error} = await Contenido.actualizarEstacion(salaActivaP5.id, payload);
  if(error){ mostrarMensajeContenido(mensajeError(error, `No se pudo guardar el reto: ${error.campo||''}`)); return; }
  mostrarMensajeContenido('Reto guardado.', 'ok');
  salaActivaP5=datos;
  const idx=salasP5.findIndex(s=> String(s.id)===String(datos.id));
  if(idx>=0) salasP5[idx]=datos;
  setVistaP5('mision');
  // Refrescar preview de la sala
  const resumen=$('sala-reto-resumen');
  if(resumen) resumen.textContent=`Mecanismo: ${inter.tipo}${inter.cierre?' + cierre':''} — guardado ✓`;
}
function enlazarEventosP5(){
  // Evitar doble bind
  if(window._p5EventosBound) return;
  window._p5EventosBound=true;
  $('btn-mostrar-nueva-mision')?.addEventListener('click', ()=> $('form-nueva-mision')?.removeAttribute('hidden'));
  $('btn-cancelar-nueva-mision')?.addEventListener('click', ()=> $('form-nueva-mision')?.setAttribute('hidden',''));
  $('form-nueva-mision')?.addEventListener('submit', crearMision);
  $('btn-volver-biblioteca')?.addEventListener('click', async ()=>{ setVistaP5('biblioteca'); await cargarBiblioteca(); });
  $('btn-guardar-mision')?.addEventListener('click', guardarMisionP5);
  $('mision-codigo-auto')?.addEventListener('change', (e)=>{
    const inp=$('mision-codigo-maestro');
    if(inp) inp.disabled=e.target.checked;
  });
  $('btn-publicar-mision')?.addEventListener('click', ()=>{
    if(!misionActivaP5) return;
    publicarMision(misionActivaP5.id);
  });
  $('btn-duplicar-mision')?.addEventListener('click', async ()=>{
    if(!misionActivaP5) return;
    await duplicarMision(misionActivaP5.id);
  });
  $('btn-borrar-mision')?.addEventListener('click', ()=>{
    if(!misionActivaP5) return;
    borrarMision(misionActivaP5.id, misionActivaP5.titulo);
  });
  $('btn-agregar-sala')?.addEventListener('click', agregarSalaP5);
  $('btn-guardar-sala')?.addEventListener('click', guardarSalaP5);
  $('btn-borrar-sala')?.addEventListener('click', borrarSalaP5);
  $('btn-sala-agregar-dato')?.addEventListener('click', ()=>{
    datosListaP5.push({clave:'', tipo:'texto', valor:''});
    renderEditorDatosP5(datosListaAObjeto(datosListaP5));
    actualizarVistaPreviaSalaP5();
  });
  $('btn-sala-agregar-pista')?.addEventListener('click', ()=>{
    pistasListaP5.push('');
    renderEditorPistasP5(pistasListaP5);
  });
  $('sala-titulo')?.addEventListener('input', actualizarVistaPreviaSalaP5);
  $('sala-pilar')?.addEventListener('input', actualizarVistaPreviaSalaP5);
  $('btn-ir-constructor-reto')?.addEventListener('click', ()=>{
    if(!salaActivaP5){ mostrarMensajeContenido('Elegí una sala primero.'); return; }
    setVistaP5('reto');
    initConstructorDesdeSala();
  });
  $('btn-volver-mision')?.addEventListener('click', ()=>{
    setVistaP5('mision');
    // Al volver, refrescar preview de la sala por si el constructor cambió algo sin guardar
    actualizarVistaPreviaSalaP5();
  });
  $('reto-mecanismo')?.addEventListener('change', (e)=>{
    retoState.tipo=e.target.value;
    // Resetear sub-estado al cambiar de tipo para no mezclar
    retoState.respuesta={valor:null};
    retoRespuestaExtra={min:null,max:null};
    renderSubformReto();
    actualizarVistaPreviaReto();
  });
  $('reto-enunciado')?.addEventListener('input', (e)=>{ retoState.enunciado=e.target.value; actualizarVistaPreviaReto(); });
  $('reto-cierre-activo')?.addEventListener('change', (e)=>{
    if(e.target.checked){
      if(!retoState.cierre) retoState.cierre={ enunciado:'¿Es engañosa?', opciones:[{id:'si', texto:'Sí'},{id:'no', texto:'No'}] };
    } else retoState.cierre=null;
    renderCierreSubform();
    actualizarVistaPreviaReto();
  });
  $('reto-cierre-enunciado')?.addEventListener('input', (e)=>{ if(retoState.cierre) retoState.cierre.enunciado=e.target.value; actualizarVistaPreviaReto(); });
  $('btn-reto-cierre-agregar-opcion')?.addEventListener('click', ()=>{
    if(!retoState.cierre) retoState.cierre={ enunciado:'', opciones:[] };
    const nid=slugifyId('cierre_'+(retoState.cierre.opciones.length+1));
    retoState.cierre.opciones.push({id:nid, texto:'Nueva opción'});
    renderCierreSubform(); actualizarVistaPreviaReto();
  });
  $('btn-reto-actualizar-vista')?.addEventListener('click', actualizarVistaPreviaReto);
  // P12 — el resumen sigue cada cambio del widget. En captura y diferido: las
  // tarjetas de orden cortan la propagación y se mueven después del evento.
  ['change','input','click','drop','keyup'].forEach(tipo=>
    $('reto-widget-marcar')?.addEventListener(tipo, ()=> setTimeout(actualizarResumenRespuesta, 0), true));
  $('btn-visual-agregar-serie')?.addEventListener('click', ()=>{
    const cont=$('visual-series-lista');
    if(!cont) return;
    cont.appendChild(crearFilaSerie({etiqueta:'', valor:0, nota:''}, cont.children.length));
    actualizarVistaPreviaReto();
  });
  $('visual-tipo')?.addEventListener('change', ()=>{
    const campos=$('visual-campos');
    if($('visual-tipo').value) campos?.removeAttribute('hidden'); else campos?.setAttribute('hidden','');
    actualizarVistaPreviaReto();
  });
  ['visual-titulo','visual-unidad','visual-pie','visual-rango-min','visual-rango-max','visual-rango-etiqueta'].forEach(id=>{
    $(id)?.addEventListener('input', actualizarVistaPreviaReto);
  });
  $('btn-visual-actualizar-vista')?.addEventListener('click', actualizarVistaPreviaReto);
  $('btn-probar-sala')?.addEventListener('click', ejecutarProbar);
  $('btn-guardar-reto')?.addEventListener('click', guardarRetoP5);
  // Intervenir crearSesion para mandar mision_id si hay selección
  const formSesion=$('form-sesion');
  if(formSesion){
    formSesion.addEventListener('submit', (e)=>{
      const sel=$('sesion-mision');
      if(sel && sel.value){
        // El handler original crearSesion() lee del DOM — inyectar mision_id ahí
        // Se hace monkey-patch sobre Docente.crearSesion es más limpio, pero
        // interceptamos acá para no tocar logica vieja: si hay valor, lo agregamos al FormData
        // El handler crearSesion() ya fue enlazado; este listener corre después.
        // Necesitamos que crearSesion() lo lea — así que seteamos un atributo que crearSesion pueda leer.
        formSesion.dataset.misionId = sel.value;
      } else {
        delete formSesion.dataset.misionId;
      }
    });
  }
}

// Patch crearSesion para respetar mision_id del select
const _crearSesionOriginal = crearSesion;
async function crearSesionPatched(e){
  e.preventDefault();
  const nombreEl=$('sesion-nombre');
  const durEl=$('sesion-duracion');
  const nombre=(nombreEl?.value||'').trim();
  const dur=parseInt(durEl?.value||'50',10);
  if(!nombre || nombre.length<3){ mostrarMensajeDocente('Nombre de sesión requerido (≥3 caracteres).'); nombreEl?.focus(); return; }
  const misionId = $('sesion-mision')?.value || $('form-sesion')?.dataset.misionId || null;
  const payload={nombre, duracion_minutos: dur};
  if(misionId) payload.mision_id=misionId;
  const {datos, error} = await Docente.crearSesion(payload);
  if(error){ mostrarMensajeDocente(error.mensaje||'No se pudo crear la sesión.'); return; }
  mostrarMensajeDocente(`Sesión "${nombre}" creada.`,'ok');
  nombreEl.value='';
  await cargarSesiones();
  if(datos?.id && sesionActivaId!==datos.id) seleccionarSesion(datos.id, datos.estado||'borrador');
}
// Reemplazar el listener viejo (enlazarEventos ya lo puso) — quitar y poner el parcheado
setTimeout(()=>{
  const form=$('form-sesion');
  if(form){
    // Clonar para quitar todos los listeners viejos es más seguro que removeEventListener sin referencia
    const clone=form.cloneNode(true);
    form.parentNode.replaceChild(clone, form);
    clone.addEventListener('submit', crearSesionPatched);
    // Re-enlazar btn-nueva-sesion que también estaba en enlazarEventos (no afecta)
    $('btn-nueva-sesion')?.addEventListener('click', ()=>{ $('sesion-nombre')?.focus(); window.scrollTo({top:0, behavior:'smooth'}); });
  }
},0);

// "Ver sesión en curso" (2026-08-26): solo tiene sentido cuando hay algo
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
  cargarCalificacionEquipo();
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
    ['Estaciones resueltas', `${fila.estaciones_resueltas ?? 0} / ${fila.total_salas ?? '—'}`],
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

async function cargarCalificacionEquipo(){
  const sel = $('rubrica-equipo');
  const equipoId = sel?.value || '';
  const form = $('form-rubrica');
  if(!form) return;
  // limpiar primero para no mostrar calificación vieja de otro equipo
  form.reset();
  if(!equipoId) return;
  const {datos, error} = await Docente.calificacion(equipoId);
  if(error || !datos) return; // sin calificación previa
  // pre-llenar radios y campos
  for(const campo of ['uso_evidencia','distincion_dato','pensamiento_critico','trabajo_equipo']){
    const val = datos[campo];
    if(val!=null){
      const radio = form.querySelector(`input[name="${campo}"][value="${val}"]`);
      if(radio) radio.checked = true;
    }
  }
  if(datos.nota_final!=null) $('rubrica-nota').value = datos.nota_final;
  if(datos.observaciones!=null) $('rubrica-observaciones').value = datos.observaciones;
  // marcar como vinculada: dejar evidencia visible con estado
  const cont = $('rubrica-evidencia-contenido');
  if(cont){
    const badge=document.createElement('p'); badge.className='mt-3 font-evidence-data text-xs text-primary border border-primary/30 bg-primary/10 px-2 py-1';
    const f = datos.actualizada_en ? new Date(datos.actualizada_en).toLocaleString('es-SV') : '';
    badge.textContent = `Calificación vinculada a este equipo${f?' — actualizada '+f:''}.`;
    cont.appendChild(badge);
  }
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

// P6-interfaz: Armar equipos automáticamente
function mostrarMensajeArmar(texto, tipo){
  const el=$('armar-mensaje');
  if(!el) return;
  el.textContent=texto;
  el.classList.toggle('border-primary', tipo==='ok');
  el.classList.toggle('text-primary', tipo==='ok');
  el.classList.toggle('bg-primary/10', tipo==='ok');
  el.classList.toggle('border-error', tipo!=='ok');
  el.classList.toggle('text-error', tipo!=='ok');
  el.classList.toggle('bg-error/10', tipo!=='ok');
  el.classList.toggle('border-audit-border', false);
  el.removeAttribute('hidden');
  // no scrollIntoView — el banner está en la misma sección, ya visible
}
function calcularPreviewEquipos(total, modo, valor){
  if(!total || !valor) return 0;
  if(modo==='por_cantidad') return Math.min(valor, total) || 1;
  const n=Math.floor(total/valor);
  return n>0 ? n : 1;
}
async function handleArmarEquipos(){
  if(!sesionActivaId){ mostrarMensajeArmar('Seleccioná una sesión arriba.'); return; }
  const modoEl=$('armar-modo');
  const valorEl=$('armar-valor');
  const modo=modoEl?.value;
  const valor=parseInt(valorEl?.value,10);
  if(!modo || !valor || valor<1){ mostrarMensajeArmar('Elegí modo y valor válido (≥1).'); return; }
  const btn=$('btn-armar-equipos');
  if(btn) btn.disabled=true;
  // Obtener conteo real de sin equipo para el confirm
  let totalSinEquipo=0;
  try{
    const r=await Docente.registrados(sesionActivaId);
    totalSinEquipo=Array.isArray(r.datos)? r.datos.length : 0;
  }catch{ totalSinEquipo=0; }
  if(totalSinEquipo===0){
    mostrarMensajeArmar('No queda nadie sin equipo en esta sesión.');
    if(btn) btn.disabled=false;
    return;
  }
  const numEquipos=calcularPreviewEquipos(totalSinEquipo, modo, valor);
  const mensajeConfirm= modo==='por_tamano'
    ? `Se van a repartir ${totalSinEquipo} estudiantes sin equipo en ${numEquipos} equipos. ¿Continuar?`
    : `Se van a repartir ${totalSinEquipo} estudiantes sin equipo en ${numEquipos} equipos (por cantidad). ¿Continuar?`;
  if(!confirm(mensajeConfirm)){ if(btn) btn.disabled=false; return; }
  const {datos, error}=await Docente.armarEquipos(sesionActivaId, {modo, valor});
  if(btn) btn.disabled=false;
  if(error){
    mostrarMensajeArmar(error.mensaje||'No se pudo armar equipos.');
    return;
  }
  const equipos=Array.isArray(datos?.equipos)? datos.equipos : (Array.isArray(datos)? datos : []);
  if(equipos.length===0){
    mostrarMensajeArmar('No se armó ningún equipo nuevo: no quedaba nadie sin equipo.', 'ok');
    const res=$('armar-resultado'); if(res) res.setAttribute('hidden','');
    return;
  }
  mostrarMensajeArmar(`Se armaron ${equipos.length} equipos.`, 'ok');
  pintarResultadoArmar(equipos);
  // Refrescar listas existentes (equipos, registrados, monitoreo)
  await cargarEquiposYMonitoreo();
  await cargarRegistrados();
}
function pintarResultadoArmar(equipos){
  const cont=$('armar-resultado');
  const tbody=document.querySelector('#tabla-armar tbody');
  if(!cont || !tbody) return;
  // Limpiar
  while(tbody.firstChild) tbody.removeChild(tbody.firstChild);
  equipos.forEach(eq=>{
    const tr=document.createElement('tr');
    const tdEquipo=document.createElement('td'); tdEquipo.textContent=eq.nombre||eq.id;
    const tdIntegrantes=document.createElement('td'); tdIntegrantes.textContent=Array.isArray(eq.integrantes)? eq.integrantes.map(i=> typeof i==='string'? i : (i.nombre||i.correo||'')).join(', ') : '';
    const tdApuntador=document.createElement('td');
    const apuntador=eq.apuntador || (Array.isArray(eq.integrantes)? eq.integrantes.find(i=> i.es_apuntador) : null);
    tdApuntador.textContent= apuntador ? (apuntador.nombre||apuntador.correo||'') : (eq.apuntador?.nombre||'');
    if(apuntador) tdApuntador.textContent+=' ★';
    const tdCodigo=document.createElement('td'); tdCodigo.textContent=eq.codigo||''; tdCodigo.className='font-mono';
    tdCodigo.setAttribute('aria-label','Código de acceso');
    tr.append(tdEquipo, tdIntegrantes, tdApuntador, tdCodigo);
    tbody.appendChild(tr);
  });
  cont.removeAttribute('hidden');
  // Guardar para copiar
  cont._equiposCache=equipos;
}
async function handleCopiarArmar(){
  const cont=$('armar-resultado');
  const equipos=cont?._equiposCache||[];
  if(!equipos.length) return;
  const texto=equipos.map(eq=>{
    const integrantes=Array.isArray(eq.integrantes)? eq.integrantes.map(i=> typeof i==='string'? i : (i.nombre||i.correo||'')).join(', ') : '';
    const apuntador=eq.apuntador?.nombre||eq.apuntador?.correo||'';
    return `${eq.nombre}\t${integrantes}\t${apuntador}\t${eq.codigo||''}`;
  }).join('\n');
  const header='Equipo\tIntegrantes\tApuntador\tCódigo\n';
  try{
    await navigator.clipboard.writeText(header+texto);
    mostrarMensajeArmar('Copiado al portapapeles.', 'ok');
  }catch{
    // Fallback: prompt con texto
    prompt('Copiá manualmente:', header+texto);
  }
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
  $('btn-armar-equipos')?.addEventListener('click', handleArmarEquipos);
  $('btn-copiar-armar')?.addEventListener('click', handleCopiarArmar);
  $('rubrica-equipo')?.addEventListener('change', ()=>{ pintarEvidenciaRubrica(); cargarCalificacionEquipo(); });
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
    else {
      mostrarMensajeDocente(`Calificación de "${nombreEquipo}" vinculada y guardada.`, 'ok');
      // recarga el vínculo para que quede visible sin tener que cambiar de equipo
      await cargarCalificacionEquipo();
    }
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initDocente);
else initDocente();
