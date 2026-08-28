-- =============================================================================
-- El Código del Café — 05-seed.sql
-- Contenido de las 5 estaciones. Se ejecuta DESPUÉS de 04-docentes.sql y ANTES
-- de crear equipos (inicializar_progreso exige 5 estaciones). Idempotente.
-- Fuente: _src/seed/e1..e5.sql (ct-e1..ct-e5). Concatenado por harness.
-- Orden: 01-esquema → 02-rls → 03-funciones → 04-docentes → 05-seed
-- =============================================================================

-- _src/seed/e1.sql — Estación 1: Sala de Hechos (Cadena de valor)
-- Dueño: ct-e1. Idempotente. Se concatena en sql/05-seed.sql
insert into estaciones (id, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta)
values (
  1,
  'Sala de Hechos',
  'Cadena de valor',
  'Expediente CGC-01 abierto. Sos parte del equipo de auditoría interna de Cadena Global de Café (CGC), la comercializadora que compra café verde a cooperativas centroamericanas y lo revende a tostadoras en Europa y EE. UU. Su junta directiva anunció que en 2027 será <b>"carbono neutral, socialmente justa y 100% trazable"</b>. Un periodista obtuvo acceso parcial a los archivos antes del primer reporte y encontró inconsistencias. La Junta te pide verificar, con evidencia, si esa promesa se sostiene. Tu primera tarea: reconstruir cómo se mueve el café del cafetal a la taza. Sin esa ruta clara, cualquier cifra de sostenibilidad queda sin respaldo.',
  '{"flujo_cgc":"CGC compra café verde a cooperativas centroamericanas a precio de referencia del mercado C. Luego lo transporta, lo almacena, lo exporta y lo vende a tostadoras en Europa y EE. UU. Las tostadoras procesan, empacan y distribuyen el producto final a cafeterías y supermercados.","participacion_valor":"Los países productores reciben en promedio entre el 23% y el 27% del valor total generado por la cadena del café.","concentracion_costos":"Esos mismos países concentran entre el 68% y el 92% de los costos sociales y ambientales asociados a su producción.","fuente":"Datos del expediente CGC — caso base 4.1","nota_auditora":"CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar."}'::jsonb,
  'Ordená los seis eslabones de la cadena de valor en su secuencia real —de la finca a la taza— y señalá en qué eslabón se concentra el menor porcentaje de valor recibido, pero el mayor costo social y ambiental.',
  '{"tipo":"orden","items":[{"id":"cultivo","texto":"Cultivo"},{"id":"cosecha","texto":"Cosecha"},{"id":"procesamiento","texto":"Procesamiento en beneficio"},{"id":"exportacion","texto":"Exportación"},{"id":"tostado","texto":"Tostado"},{"id":"venta","texto":"Venta final"}],"pregunta":"¿En qué eslabón se concentra el menor porcentaje de valor recibido, pero el mayor costo social y ambiental?","opciones":[{"id":"cultivo","texto":"Cultivo"},{"id":"cosecha","texto":"Cosecha"},{"id":"procesamiento","texto":"Procesamiento en beneficio"},{"id":"exportacion","texto":"Exportación"},{"id":"tostado","texto":"Tostado"},{"id":"venta","texto":"Venta final"}]}'::jsonb,
  '["Revisá la secuencia de punta a punta: el café no llega a tostado ni a venta sin pasar por finca, cosecha y beneficio. ¿Qué tres eslabones van primero y cuál es el origen de todo?", "Dato del expediente: los países productores reciben solo 23–27% del valor total pero concentran 68–92% de los costos sociales y ambientales. Preguntate: ¿quién está al inicio de la cadena y carga con esos costos?", "Casi lo tenés: el orden correcto inicia en Cultivo → Cosecha y termina en Venta final, y el eslabón que recibe menos valor pero concentra más costos es el primero: Cultivo, donde produce la persona caficultora."]'::jsonb,
  'Correcto. Orden verificado: Cultivo → Cosecha → Procesamiento en beneficio → Exportación → Tostado → Venta final. El eslabón es Cultivo: los países productores reciben solo entre el 23% y el 27% del valor total generado por la cadena, pero concentran entre el 68% y el 92% de los costos sociales y ambientales. Esa asimetría es la que CGC debe auditar antes de afirmar que es sostenible. Sin corregir esa distribución, el discurso no tiene respaldo. Código: 06-VC.',
  '06-VC',
  '{"orden":["cultivo","cosecha","procesamiento","exportacion","tostado","venta"],"eslabon":"cultivo"}'::jsonb
)
on conflict (id) do update set
  titulo      = excluded.titulo,
  pilar       = excluded.pilar,
  narrativa   = excluded.narrativa,
  datos       = excluded.datos,
  reto        = excluded.reto,
  interaccion = excluded.interaccion,
  pistas      = excluded.pistas,
  feedback_ok = excluded.feedback_ok,
  codigo      = excluded.codigo,
  respuesta   = excluded.respuesta;
-- _src/seed/e2.sql — Estación 2: Sala Verde (Ambiental)
-- Dueño: ct-e2. Idempotente. Se concatena en sql/05-seed.sql
insert into estaciones (id, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta)
values (
  2,
  'Sala Verde',
  'Ambiental',
  'Expediente CGC-02 — Sala Verde abierto. Entrás a la sala ambiental. Sobre la mesa: el expediente de huella del café verde que CGC compra a cooperativas. El borrador de reporte de CGC afirma: <b>"Nuestra huella hídrica es baja porque solo usamos agua de lluvia"</b>. Afuera el reloj corre y la Junta espera tu verificación. CGC no es villana —es una empresa cuyo discurso aún no está respaldado— y tu rol es auditar con evidencia, no condenar. ¿Se sostiene esa frase con los números del expediente?',
  '{"huella_carbono_cultivo":"Producir un solo kilo de café genera entre 2,4 y 13 kilos de emisiones de carbono únicamente en la etapa de siembra y cosecha.","huella_carbono_ciclo":"Huella de carbono del ciclo completo: 0.12 a 14.61 kg CO₂eq por kilo.","huella_hidrica_total":["Volumen total requerido: 14,000 m³/t","Agua de lluvia en suelo: 12,180 m³/t","Riego superficial: 700 m³/t","Dilución de efluentes/químicos: 1,120 m³/t"],"huella_verde":"De ese total, 85–90% es huella verde —agua de lluvia almacenada en el suelo—. Agua Verde: Es el agua de lluvia que la planta absorbe de la tierra. Agua Azul: Es el agua que sacamos de ríos o pozos para regar manualmente. Agua Gris: Es el agua limpia que se necesitaría para  diluir la contaminación que dejó el proceso (fertilizantes, desecho del lavado del café).","deforestacion":"El café es el sexto motor más grande de deforestación global. En Brasil se perdieron más de 11 millones de hectáreas de bosque en zonas cafeteras entre 2001 y 2023.","nota_verificacion":"\"Agua de lluvia\" no significa impacto cero: sigue siendo agua que deja de recargar acuíferos o sostener otros ecosistemas si el uso agrícola se intensifica, y no cubre la huella gris (contaminación por fertilizantes y aguas mieles).","fuente":"Datos del expediente CGC — caso base #4.2","nota_auditora":"CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar."}'::jsonb,
  'CGC afirma en su borrador: "Nuestra huella hídrica es baja porque solo usamos agua de lluvia". Calculá qué porcentaje de la huella hídrica total corresponde a agua verde usando el rango 85 – 90% del expediente y decidí si esa afirmación es engañosa.',
  '{"tipo":"numero","campos":[{"id":"porcentaje","etiqueta":"% huella verde","sufijo":"%","min":0,"max":100,"paso":0.5},{"id":"enganosa","etiqueta":"¿Es engañosa?","sufijo":""}],"pregunta":"¿La afirmación de CGC \"Nuestra huella hídrica es baja porque solo usamos agua de lluvia\" es engañosa?","opciones":[{"id":"si","texto":"Sí, es engañosa"},{"id":"no","texto":"No, no es engañosa"}]}'::jsonb,
  '["Revisá el expediente de huella hídrica: no dice que la huella sea baja, dice que 85–90% del total 11,113 – 14,560 m³/ton es huella verde. ¿Qué te dice ese rango sobre la proporción? No busques calcular volumen, solo porcentaje.", "El 85–90% no es poco: es la mayoría del total. Y verde no es inocuo —agua de lluvia que el cultivo retiene deja de recargar acuíferos y no cubre la huella gris por fertilizantes y aguas mieles—. Con eso, ¿\"impacto mínimo\" se sostiene?", "Casi lo tenés: el punto medio del rango 85–90% es 87% (se acepta 87.5%). Ese es el % de huella verde. Y sí, la afirmación es engañosa: concentrar la huella en lluvia no la hace baja ni elimina el impacto."]'::jsonb,
  'Correcto. La huella hídrica total en Colombia es 11,113 – 14,560 m³ por tonelada y entre el 85% y el 90% es huella verde —punto medio 87% (aceptamos 87.5%)—, es decir, la mayoría del total, no un residuo. "Agua de lluvia" no significa impacto cero: retiene agua que deja de recargar acuíferos y no cubre la huella gris por fertilizantes y aguas mieles, por eso la frase de CGC es engañosa (ver tabla de huellas del expediente). Huella de carbono del cultivo 2.4 – 13 kg CO₂eq/kg, ciclo completo 0.12 – 14.61 kg CO₂eq/kg, y deforestación: más de 11 millones de hectáreas perdidas en Brasil entre 2001 y 2023 completan el cuadro ambiental. Código: 87.',
  '87',
  '{"porcentaje":87,"porcentaje_acepta":[87,87.5],"rango_min":85,"rango_max":90,"enganosa":"si"}'::jsonb
)
on conflict (id) do update set
  titulo      = excluded.titulo,
  pilar       = excluded.pilar,
  narrativa   = excluded.narrativa,
  datos       = excluded.datos,
  reto        = excluded.reto,
  interaccion = excluded.interaccion,
  pistas      = excluded.pistas,
  feedback_ok = excluded.feedback_ok,
  codigo      = excluded.codigo,
  respuesta   = excluded.respuesta;
-- _src/seed/e3.sql — Estación 3: Sala del Dinero (Pilar Económico)
-- Dueño: ct-e3. Idempotente. Se concatena en sql/05-seed.sql
insert into estaciones (id, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta)
values (
  3,
  'Sala del Dinero',
  'Económico',
  'Expediente CGC-03 — Sala del Dinero. El archivo financiero quedó abierto sobre la mesa. CGC habla de valor compartido y precios justos, pero los números de la taza no cierran. Tu rol como auditoría interna: seguir el rastro de los US$4.00 que paga quien toma el café en la cafetería y verificar cuánto llega realmente a quien lo cultivó. Si el reparto no sostiene el discurso, el reporte no se publica. Tenés 6 minutos antes de que el directorio pida tu veredicto.',
  '{"precio_taza":"US$4.00 — precio de referencia de una taza en cafetería (rango del caso: US$3 a US$5)","reparto_taza":{"persona_caficultora":"US$0.15–0.20","procesamiento_exportacion":"US$0.40","tostado_logistica_internacional":"US$1.10","cafeteria_venta_final":"US$2.30–2.35"},"nota_mercado_c":"El pago a la persona caficultora se fija por el precio del mercado C (bolsa de materias primas), no por sus costos reales de producción.","ingresos_familias":"En 2017, los ingresos de las familias caficultoras en Perú y Etiopía fueron 20% más bajos que en 2005, ubicándose muy por debajo del umbral de pobreza.","participacion_cadena_global":"Los países productores reciben en promedio entre el 23% y el 27% del valor total generado por la cadena del café.","fuente":"Datos del expediente CGC — caso base #4.3","nota_auditora":"CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar."}'::jsonb,
  'Calculá qué porcentaje del precio final (US$4.00) recibe la persona caficultora y señalá la inconsistencia al compararlo con el rango 23–27% de participación que reporta la cadena global en su conjunto.',
  '{"tipo":"numero","campos":[{"id":"porcentaje","etiqueta":"¿Qué porcentaje del precio final (US$4.00) recibe la persona caficultora?","sufijo":"%","min":0,"max":100,"paso":0.1}],"pregunta":"¿Qué inconsistencia revela ese porcentaje al compararlo con el 23–27% de participación de los países productores en la cadena global?","opciones":[{"id":"a","texto":"La participación real en la taza cae por debajo del 5% (aprox. 4.4%), muy inferior al 23–27% promedio de la cadena — la inequidad se agrava en el último eslabón de venta directa al consumidor."},{"id":"b","texto":"La participación en la taza coincide con el 23–27% reportado para la cadena global; no hay brecha adicional en el eslabón final."},{"id":"c","texto":"La persona caficultora recibe más del 10% del precio final, por encima del promedio reportado para los países productores."}]}'::jsonb,
  '["Tomá la calculadora de auditoría: dividí lo que recibe la persona caficultora (US$0.15–0.20) entre los US$4.00 de la taza y pasalo a porcentaje. ¿Qué orden de magnitud te da? No es 20%, no es 10%.", "Ya tenés ese porcentaje. Ahora comparalo con el otro dato del expediente: los países productores reciben 23–27% del valor total de la cadena. ¿Tu resultado está cerca, muy por debajo o por encima de ese rango? Esa distancia es la pista.", "Casi lo tenés: el punto medio del rango de la persona caficultora es US$0.175. Sobre US$4.00 eso es 0.175/4 = 4.375% ≈ 4.4%. Cae por debajo del 5%, muy lejos del 23–27% global. La opción que describe esa caída —la inequidad se agrava en la venta directa— es la que cierra el hallazgo. Código: 04."]'::jsonb,
  'Correcto. Auditoría verificada: la persona caficultora recibe US$0.15–0.20 sobre US$4.00. Con el punto medio US$0.175, el cálculo es 0.175/4 = 4.375% ≈ 4.4%, dentro del rango válido 4–4.4% y por debajo del 5%. Ese 4.4% es muy inferior al 23–27% que los países productores reciben en promedio del valor total de la cadena, lo que demuestra que la inequidad se agrava en el último eslabón de venta directa al consumidor. A eso se suma que, en 2017, los ingresos de familias caficultoras en Perú y Etiopía fueron 20% más bajos que en 2005, muy por debajo del umbral de pobreza. CGC no puede afirmar pago justo sin corregir ese reparto. Código: 04.',
  '04',
  '{"porcentaje_min":4,"porcentaje_max":4.4,"porcentaje":4.4,"inconsistencia":"a"}'::jsonb
)
on conflict (id) do update set
  titulo      = excluded.titulo,
  pilar       = excluded.pilar,
  narrativa   = excluded.narrativa,
  datos       = excluded.datos,
  reto        = excluded.reto,
  interaccion = excluded.interaccion,
  pistas      = excluded.pistas,
  feedback_ok = excluded.feedback_ok,
  codigo      = excluded.codigo,
  respuesta   = excluded.respuesta;
-- _src/seed/e4.sql — Estación 4: Sala de las Personas (Pilar Social)
-- Dueño: ct-e4. Idempotente. Se concatena en sql/05-seed.sql
insert into estaciones (id, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta)
values (
  4,
  'Sala de las Personas',
  'Social',
  'Expediente CGC-04 abierto. Ya viste dónde se concentra el valor y dónde se cargan los costos. Ahora auditás a quiénes golpea esa asimetría. Cerca de 25 millones de personas en más de 80 países cultivan café, mayoritariamente en parcelas menores a 5 hectáreas, y en su mayoría viven en condiciones de pobreza. El trabajo infantil ocurre mayormente en el sector agrícola: cerca del 60% del trabajo infantil global —casi 100 millones de niños y niñas— se concentra en actividades agrícolas, incluyendo cultivos como el café. Y los ingresos insuficientes obligan a muchas familias caficultoras a endeudarse, lo que puede derivar en trabajo infantil o migración forzada. Tu tarea no es opinar quién podría ser vulnerable: es señalar, con evidencia del expediente, quién está en riesgo directo. En auditoría, dato no es suposición. Nota docente: hoy solo identificamos actores y riesgo potencial con la evidencia disponible; el marco completo de derechos, inclusión y trabajo digno se desarrollará en la próxima clase.',
  '{"escala_pobreza":"Cerca de 25 millones de personas en más de 80 países cultivan café, mayoritariamente en parcelas menores a 5 hectáreas, y en su mayoría viven en condiciones de pobreza.","trabajo_infantil":"Cerca del 60% del trabajo infantil global —casi 100 millones de niños y niñas— se concentra en actividades agrícolas, incluyendo cultivos como el café.","deuda_riesgo":"Los ingresos insuficientes obligan a muchas familias caficultoras a endeudarse, lo que puede derivar en trabajo infantil o migración forzada.","fuente":"Datos del expediente CGC — caso base #4.4","nota_auditora":"CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar. Hoy solo se identifica riesgo con evidencia directa."}'::jsonb,
  'De los 8 actores listados, marcá únicamente a quienes el expediente señala en riesgo directo frente a la inequidad económica. Solo vale lo que tiene evidencia directa y textual —no lo que parece razonable por intuición.',
  '{"tipo":"checklist","items":[{"id":"caficultora","texto":"Persona caficultora"},{"id":"hija","texto":"Hija/o de la familia caficultora"},{"id":"intermediario","texto":"Intermediario local"},{"id":"exportador","texto":"Empresa exportadora"},{"id":"tostadora","texto":"Tostadora internacional"},{"id":"barista","texto":"Barista"},{"id":"consumidor","texto":"Consumidor final"},{"id":"gobierno","texto":"Gobierno regulador"}]}'::jsonb,
  '["Revisá el expediente palabra por palabra: ¿para quién hay cifra de pobreza y escala productiva citada? No marques por intuición; en auditoría solo cuenta lo que el documento dice con dato.", "Marcar al intermediario o al gobierno parece razonable —toda cadena tiene esos actores— pero el expediente no les atribuye riesgo directo con evidencia. Es la distinción clave de esta sala: dato vs. suposición. Preguntate: ¿para quién sí hay vínculo explícito entre ingresos insuficientes, deuda y trabajo infantil o migración?", "Casi lo tenés: son solo 2 marcas y ambas están en la finca. La persona caficultora —25 millones en más de 80 países, parcela <5 ha, mayoritariamente en pobreza— y su hija/o —expuesta al 60% del trabajo infantil global, casi 100 millones en agricultura— cuando la familia se endeuda. Esos dos tienen cita directa; los otros seis no."]'::jsonb,
  'Correcto. Riesgo directo con evidencia: persona caficultora e hija/o de la familia caficultora. Cerca de 25 millones de personas en más de 80 países cultivan café en parcelas menores a 5 hectáreas y viven mayoritariamente en pobreza, y cerca del 60% del trabajo infantil global —casi 100 millones de niños y niñas— se concentra en agricultura, incluyendo el café. El expediente vincula ingresos insuficientes con endeudamiento que puede derivar en trabajo infantil o migración forzada. Los otros actores pueden parecer vulnerables —marcar al intermediario o al gobierno es razonable como hipótesis— pero no tienen evidencia directa de riesgo en este expediente: en auditoría, dato no es suposición. CGC no es villana, pero su promesa de ser socialmente justa no tiene respaldo hasta auditar y corregir. Código: 2P.',
  '2P',
  '{"actores":["caficultora","hija"]}'::jsonb
)
on conflict (id) do update set
  titulo      = excluded.titulo,
  pilar       = excluded.pilar,
  narrativa   = excluded.narrativa,
  datos       = excluded.datos,
  reto        = excluded.reto,
  interaccion = excluded.interaccion,
  pistas      = excluded.pistas,
  feedback_ok = excluded.feedback_ok,
  codigo      = excluded.codigo,
  respuesta   = excluded.respuesta;
-- _src/seed/e5.sql — Estación 5: Sala de la Verdad (Síntesis anti-greenwashing)
-- Dueño: ct-e5. Idempotente. Se concatena en sql/05-seed.sql
insert into estaciones (id, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta)
values (
  5,
  'Sala de la Verdad',
  'Síntesis anti-greenwashing',
  'Expediente CGC-05 abierto — Sala de la Verdad. Último filtro antes de publicar. El directorio de CGC quiere lanzar su primer reporte con cinco frases que llegaron a tu mesa sin respaldo adjunto: 1) "Seremos carbono neutral en 2027." 2) "Usamos agua de lluvia, por lo que nuestro impacto hídrico es mínimo." 3) "Pagamos precios justos a nuestros productores." 4) "Contribuimos al desarrollo de las comunidades productoras." 5) "Compramos exclusivamente a cooperativas centroamericanas certificadas." El periodista ya tiene acceso parcial al archivo. Si algo se publica sin evidencia, el golpe no será ambiental —será reputacional. Tu auditoría decide qué se sostiene y qué se corrige.',
  '{"contexto":"Borrador de reporte CGC — 5 afirmaciones sin documento soporte adjunto. Tu referencia es la evidencia de las estaciones 1 a 4.","evidencia_carbono":"Huella de carbono del cultivo: 2.4 a 13 kg CO2eq/kg; ciclo completo 0.12 a 14.61 kg CO2eq/kg. No hay plan de reducción, línea base ni metodología presentada para ''carbono neutral 2027''.","evidencia_agua":"Huella hídrica total en Colombia: 11,113–14,560 m3/t de café pergamino seco, 85–90% es huella verde (agua de lluvia). La huella verde no implica impacto mínimo; no cubre huella gris por fertilizantes y aguas mieles.","evidencia_valor":"Países productores reciben 23–27% del valor total pero concentran 68–92% de los costos sociales y ambientales. En taza de US$4.00, la persona caficultora recibe US$0.15–0.20 (~4–5%), precio fijado por mercado C no ligado a costos reales.","evidencia_desarrollo":"Sin datos en el expediente de programas, montos ni resultados medibles de contribución al desarrollo comunitario.","evidencia_trazabilidad":"Compra a cooperativas centroamericanas certificadas: potencialmente verificable si CGC presenta listado y certificaciones vigentes.","fuente":"Expediente CGC — síntesis estaciones 1–4","nota_auditora":"CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar."}'::jsonb,
  'Auditoría anti-greenwashing: clasificá cada una de las 5 frases del borrador en Verificable, Engañosa o Sin evidencia suficiente, citando el dato de las estaciones anteriores que sostiene tu decisión.',
  '{"tipo":"clasificacion","categorias":[{"id":"verificable","texto":"Verificable"},{"id":"enganosa","texto":"Engañosa"},{"id":"sin_evidencia","texto":"Sin evidencia suficiente"}],"items":[{"id":"f1","texto":"Seremos carbono neutral en 2027."},{"id":"f2","texto":"Usamos agua de lluvia, por lo que nuestro impacto hídrico es mínimo."},{"id":"f3","texto":"Pagamos precios justos a nuestros productores."},{"id":"f4","texto":"Contribuimos al desarrollo de las comunidades productoras."},{"id":"f5","texto":"Compramos exclusivamente a cooperativas centroamericanas certificadas."}]}'::jsonb,
  '["Volvé al expediente: una frase es verificable solo si hay dato, plan o documento que la respalde en las estaciones 1–4. Sin línea base ni metodología, por más contundente que suene, no se sostiene.", "Aplicá el filtro: ''Engañosa'' usa un dato real para minimizar un impacto —pista: 85–90% no es mínimo—; ''Sin evidencia'' es cuando el expediente no trae ningún programa, monto o documento que la sostenga.", "Mapeo al límite: la de agua de lluvia y la de precios justos distorsionan datos reales —enganosas—; la de carbono neutral 2027 y la de contribución al desarrollo no tienen respaldo en el expediente —sin evidencia—; solo la de cooperativas certificadas puede verificarse si CGC adjunta el listado."]'::jsonb,
  'Auditoría cerrada. De las 5 afirmaciones del borrador de CGC, solo 1 es potencialmente verificable con evidencia documental adicional —"Compramos exclusivamente a cooperativas centroamericanas certificadas"— si se presenta el listado de certificaciones vigentes. Las otras 4 requieren corrección o eliminación antes de publicarse: "Seremos carbono neutral en 2027" sin plan, línea base ni metodología; "Usamos agua de lluvia, por lo que nuestro impacto hídrico es mínimo" engañosa porque la huella verde es 85–90% del total (11,113–14,560 m3/t) y no implica impacto mínimo ni cubre huella gris; "Pagamos precios justos" contradicha por US$0.15–0.20 sobre US$4.00 (~4–5%) y por la asimetría 23–27% de valor vs 68–92% de costos en origen; "Contribuimos al desarrollo" sin programas, montos ni resultados en el expediente. CGC no puede afirmar ser sostenible; puede afirmar que está en proceso de auditar y mejorar sus tres pilares. Código: 4. Maestro combina 06-87-04-2P-4.',
  '4',
  '{"frases":["sin_evidencia","enganosa","enganosa","sin_evidencia","verificable"]}'::jsonb
)
on conflict (id) do update set
  titulo      = excluded.titulo,
  pilar       = excluded.pilar,
  narrativa   = excluded.narrativa,
  datos       = excluded.datos,
  reto        = excluded.reto,
  interaccion = excluded.interaccion,
  pistas      = excluded.pistas,
  feedback_ok = excluded.feedback_ok,
  codigo      = excluded.codigo,
  respuesta   = excluded.respuesta;
