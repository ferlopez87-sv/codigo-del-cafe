-- =============================================================================
-- El Código del Café — 05-seed.sql
-- Contenido de la misión semilla + migración de formato. Idempotente.
-- Orden: 01-esquema → 02-rls → 03-funciones → 04-docentes → 05-seed → 06-superadmin
--
-- 2026-09-22 — ESTE ARCHIVO YA NO PISA EL CONTENIDO EN CADA ARRANQUE.
--
-- Antes cada sala se insertaba con `on conflict (id) do update set titulo=...,
-- narrativa=..., ...`. Como srv/migrar.js corre los 7 .sql en CADA arranque del
-- servidor, todo lo que el docente guardaba desde el editor sobrevivía hasta el
-- siguiente `docker compose up` o deploy, y ahí volvía el texto de este archivo.
-- El editor escribía sobre arena. Ahora el sembrado corre UNA sola vez, cuando
-- la misión no existe; si ya existe, este archivo no toca ni una fila de texto.
--
-- Dos bloques:
--   A. Sembrado de la misión semilla (solo en base sin la misión).
--   B. Migración de formato de retos legacy (solo si quedan filas viejas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BLOQUE A — Misión semilla "El código secreto del café"
-- -----------------------------------------------------------------------------
do $seed$
declare v_mision uuid;
begin
  if exists (select 1 from misiones where slug = 'codigo-del-cafe') then
    raise notice '[seed] la misión codigo-del-cafe ya existe — no se toca nada';
    return;
  end if;

  insert into misiones (slug, titulo, subtitulo, intro, codigo_maestro, veredicto, estado)
  values (
    'codigo-del-cafe',
    'El código secreto del café',
    'Una auditoría de sostenibilidad bajo presión',
    'CGC, Cadena Global de Café, publicó su informe. Tu equipo debe verificar si el discurso tiene respaldo en los datos.',
    null,  -- se compone de los fragmentos por orden: 06-87-04-2P-4
    'CGC no sostiene su promesa 2027 con evidencia suficiente en las áreas auditadas.',
    'publicada'
  ) returning id into v_mision;

  -- Sala 1 — Sala de Hechos (Cadena de valor) · reto: orden + cierre
  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto,
                          interaccion, pistas, feedback_ok, codigo, respuesta,
                          desbloqueo, icono, visual)
  values (v_mision, 1, $tx$Sala de Hechos$tx$, $tx$Cadena de valor$tx$,
          $tx$Expediente CGC-01 abierto. Sos parte del equipo de auditoría interna de Cadena Global de Café (CGC), la comercializadora que compra café verde a cooperativas centroamericanas y lo revende a tostadoras en Europa y EE. UU. Su junta directiva anunció que en 2027 será <b>"carbono neutral, socialmente justa y 100% trazable"</b>. Un periodista obtuvo acceso parcial a los archivos antes del primer reporte y encontró inconsistencias. La Junta te pide verificar, con evidencia, si esa promesa se sostiene. Tu primera tarea: reconstruir cómo se mueve el café del cafetal a la taza. Sin esa ruta clara, cualquier cifra de sostenibilidad queda sin respaldo.$tx$,
          $tx${"fuente": "Datos del expediente CGC — caso base 4.1", "flujo_cgc": "CGC compra café verde a cooperativas centroamericanas a precio de referencia del mercado C. Luego lo transporta, lo almacena, lo exporta y lo vende a tostadoras en Europa y EE. UU. Las tostadoras procesan, empacan y distribuyen el producto final a cafeterías y supermercados.", "nota_auditora": "CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar.", "participacion_valor": "Los países productores reciben en promedio entre el 23% y el 27% del valor total generado por la cadena del café.", "concentracion_costos": "Esos mismos países concentran entre el 68% y el 92% de los costos sociales y ambientales asociados a su producción."}$tx$::jsonb,
          $tx$Ordená los seis eslabones de la cadena de valor en su secuencia real —de la finca a la taza— y señalá en qué eslabón se concentra el menor porcentaje de valor recibido, pero el mayor costo social y ambiental.$tx$,
          $tx${"tipo": "orden", "enunciado": "Ordená los seis eslabones de la cadena de valor en su secuencia real —de la finca a la taza— y señalá en qué eslabón se concentra el menor porcentaje de valor recibido, pero el mayor costo social y ambiental.", "barajar": true, "items": [{"id": "cultivo", "texto": "Cultivo"}, {"id": "cosecha", "texto": "Cosecha"}, {"id": "procesamiento", "texto": "Procesamiento en beneficio"}, {"id": "exportacion", "texto": "Exportación"}, {"id": "tostado", "texto": "Tostado"}, {"id": "venta", "texto": "Venta final"}], "cierre": {"enunciado": "¿En qué eslabón se concentra el menor porcentaje de valor recibido, pero el mayor costo social y ambiental?", "opciones": [{"id": "cultivo", "texto": "Cultivo"}, {"id": "cosecha", "texto": "Cosecha"}, {"id": "procesamiento", "texto": "Procesamiento en beneficio"}, {"id": "exportacion", "texto": "Exportación"}, {"id": "tostado", "texto": "Tostado"}, {"id": "venta", "texto": "Venta final"}]}}$tx$::jsonb,
          $tx$["Revisá la secuencia de punta a punta: el café no llega a tostado ni a venta sin pasar por finca, cosecha y beneficio. ¿Qué tres eslabones van primero y cuál es el origen de todo?", "Dato del expediente: los países productores reciben solo 23–27% del valor total pero concentran 68–92% de los costos sociales y ambientales. Preguntate: ¿quién está al inicio de la cadena y carga con esos costos?", "Casi lo tenés: el orden correcto inicia en Cultivo → Cosecha y termina en Venta final, y el eslabón que recibe menos valor pero concentra más costos es el primero: Cultivo, donde produce la persona caficultora."]$tx$::jsonb,
          $tx$Correcto. Orden verificado: Cultivo → Cosecha → Procesamiento en beneficio → Exportación → Tostado → Venta final. El eslabón es Cultivo: los países productores reciben solo entre el 23% y el 27% del valor total generado por la cadena, pero concentran entre el 68% y el 92% de los costos sociales y ambientales. Esa asimetría es la que CGC debe auditar antes de afirmar que es sostenible. Sin corregir esa distribución, el discurso no tiene respaldo. <b>Código: 06.</b>$tx$,
          $tx$06$tx$, $tx${"valor": ["cultivo", "cosecha", "procesamiento", "exportacion", "tostado", "venta"], "cierre": "cultivo"}$tx$::jsonb, $tx$libre$tx$, $tx$fact_check$tx$, null);

  -- Sala 2 — Sala Verde (Ambiental) · reto: respuesta_corta + cierre
  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto,
                          interaccion, pistas, feedback_ok, codigo, respuesta,
                          desbloqueo, icono, visual)
  values (v_mision, 2, $tx$Sala Verde$tx$, $tx$Ambiental$tx$,
          $tx$Expediente CGC-02 — Sala Verde abierto. Entrás a la sala ambiental. Sobre la mesa: el expediente de huella del café verde que CGC compra a cooperativas. El borrador de reporte de CGC afirma: <b>"Nuestra huella hídrica es baja porque solo usamos agua de lluvia"</b>. Afuera el reloj corre y la Junta espera tu verificación. CGC no es villana —es una empresa cuyo discurso aún no está respaldado— y tu rol es auditar con evidencia, no condenar. ¿Se sostiene esa frase con los números del expediente?$tx$,
          $tx${"fuente": "Datos del expediente CGC — caso base #4.2", "huella_verde": "De ese total, 85–90% es huella verde —agua de lluvia almacenada en el suelo—. Agua Verde: Es el agua de lluvia que la planta absorbe de la tierra. Agua Azul: Es el agua que sacamos de ríos o pozos para regar manualmente. Agua Gris: Es el agua limpia que se necesitaría para  diluir la contaminación que dejó el proceso (fertilizantes, desecho del lavado del café).", "deforestacion": "El café es el sexto motor más grande de deforestación global. En Brasil se perdieron más de 11 millones de hectáreas de bosque en zonas cafeteras entre 2001 y 2023.", "nota_auditora": "CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar.", "nota_verificacion": "\"Agua de lluvia\" no significa impacto cero: sigue siendo agua que deja de recargar acuíferos o sostener otros ecosistemas si el uso agrícola se intensifica, y no cubre la huella gris (contaminación por fertilizantes y aguas mieles).", "huella_carbono_ciclo": "Huella de carbono del ciclo completo: 0.12 a 14.61 kg CO₂eq por kilo.", "huella_hidrica_total": ["Huella verde: Agua de lluvia en suelo: 12,180 m³/t", "Huella azul: Riego superficial: 700 m³/t", "Huella gris: Dilución de efluentes/químicos: 1,120 m³/t", "<b>Huella total: 14,000 m³/t</b>"], "huella_carbono_cultivo": "Producir un solo kilo de café genera entre 2,4 y 13 kilos de emisiones de carbono únicamente en la etapa de siembra y cosecha."}$tx$::jsonb,
          $tx$CGC afirma en su borrador: "Nuestra huella hídrica es baja porque solo usamos agua de lluvia". Calculá qué porcentaje de la huella hídrica total corresponde a agua verde usando el rango 85 – 90% del expediente y decidí si esa afirmación es engañosa.$tx$,
          $tx${"tipo": "respuesta_corta", "modo": "numero", "enunciado": "% huella verde", "sufijo": "%", "min": 0, "max": 100, "paso": 0.5, "placeholder": "0.0", "cierre": {"enunciado": "¿La afirmación de CGC \"Nuestra huella hídrica es baja porque solo usamos agua de lluvia\" es engañosa?", "opciones": [{"id": "si", "texto": "Sí, es engañosa"}, {"id": "no", "texto": "No, no es engañosa"}]}}$tx$::jsonb,
          $tx$["Revisá el expediente de huella hídrica: no dice que la huella sea baja, dice que 85–90% del total 11,113 – 14,560 m³/ton es huella verde. ¿Qué te dice ese rango sobre la proporción? No busques calcular volumen, solo porcentaje.", "El 85–90% no es poco: es la mayoría del total. Y verde no es inocuo —agua de lluvia que el cultivo retiene deja de recargar acuíferos y no cubre la huella gris por fertilizantes y aguas mieles—. Con eso, ¿\"impacto mínimo\" se sostiene?", "Casi lo tenés: el punto medio del rango 85–90% es 87% (se acepta 87.5%). Ese es el % de huella verde. Y sí, la afirmación es engañosa: concentrar la huella en lluvia no la hace baja ni elimina el impacto."]$tx$::jsonb,
          $tx$Correcto. La huella hídrica total en Colombia es 11,113 – 14,560 m³ por tonelada y entre el 85% y el 90% es huella verde —punto medio 87% (aceptamos 87.5%)—, es decir, la mayoría del total, no un residuo. "Agua de lluvia" no significa impacto cero: retiene agua que deja de recargar acuíferos y no cubre la huella gris por fertilizantes y aguas mieles, por eso la frase de CGC es engañosa (ver tabla de huellas del expediente). Huella de carbono del cultivo 2.4 – 13 kg CO₂eq/kg, ciclo completo 0.12 – 14.61 kg CO₂eq/kg, y deforestación: más de 11 millones de hectáreas perdidas en Brasil entre 2001 y 2023 completan el cuadro ambiental. <b>Código: 87.</b>$tx$,
          $tx$87$tx$, $tx${"valor": 87, "acepta": [87.5], "cierre": "si"}$tx$::jsonb, $tx$libre$tx$, $tx$water_drop$tx$, $tx${"tipo": "pastel", "unidad": "%", "titulo": "Huella hídrica del café verde", "series": [{"etiqueta": "Huella verde (agua de lluvia)", "valor": 87, "nota": "rango aceptado 85–90 %"}, {"etiqueta": "Huella azul + gris", "valor": 13}], "rango": {"min": 85, "max": 90, "etiqueta": "rango aceptado"}, "pie": "Fuente: expediente CGC — caso base 4.2"}$tx$::jsonb);

  -- Sala 3 — Sala del Dinero (Económico) · reto: respuesta_corta + cierre
  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto,
                          interaccion, pistas, feedback_ok, codigo, respuesta,
                          desbloqueo, icono, visual)
  values (v_mision, 3, $tx$Sala del Dinero$tx$, $tx$Económico$tx$,
          $tx$Expediente CGC-03 — Sala del Dinero. El archivo financiero quedó abierto sobre la mesa. CGC habla de valor compartido y precios justos, pero los números de la taza no cierran. Tu rol como auditoría interna: seguir el rastro de los US$4.00 que paga quien toma el café en la cafetería y verificar cuánto llega realmente a quien lo cultivó. Si el reparto no sostiene el discurso, el reporte no se publica. Tenés 6 minutos antes de que el directorio pida tu veredicto.$tx$,
          $tx${"fuente": "Datos del expediente CGC — caso base #4.3", "precio_taza": "US$4.00 — precio de referencia de una taza en cafetería (rango del caso: US$3 a US$5)", "reparto_taza": {"persona_caficultora": "US$0.15 – US$0.20", "cafeteria_venta_final": "US$2.30 – US$2.35", "procesamiento_exportacion": "US$0.40", "tostado_logistica_internacional": "US$1.10"}, "nota_auditora": "CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar.", "nota_mercado_c": "El pago a la persona caficultora se fija por el precio del mercado C (bolsa de materias primas), no por sus costos reales de producción.", "ingresos_familias": "En 2017, los ingresos de las familias caficultoras en Perú y Etiopía fueron 20% más bajos que en 2005, ubicándose muy por debajo del umbral de pobreza.", "participacion_cadena_global": "Los países productores reciben en promedio entre el 23% y el 27% del valor total generado por la cadena del café."}$tx$::jsonb,
          $tx$Calculá qué porcentaje del precio final (US$4.00) recibe la persona caficultora y reflexioná si existe una inconsistencia al compararlo con el rango 23 – 27% de participación que reporta la cadena global en su conjunto.$tx$,
          $tx${"tipo": "respuesta_corta", "modo": "numero", "enunciado": "¿Qué porcentaje del precio final (US$4.00) recibe la persona caficultora?", "sufijo": "%", "min": 0, "max": 100, "paso": 0.1, "placeholder": "0.0", "cierre": {"enunciado": "¿Qué inconsistencia revela ese porcentaje al compararlo con el 23 – 27% de participación de los países productores en la cadena global?", "opciones": [{"id": "a", "texto": "La participación real en la taza cae por debajo del 5% (aprox. 4.4%), muy inferior al 23 – 27% promedio de la cadena — la inequidad se agrava en el último eslabón de venta directa al consumidor."}, {"id": "b", "texto": "La participación en la taza coincide con el 23 – 27% reportado para la cadena global; no hay brecha adicional en el eslabón final."}, {"id": "c", "texto": "La persona caficultora recibe más del 10% del precio final, por encima del promedio reportado para los países productores."}]}}$tx$::jsonb,
          $tx$["Tomá la calculadora de auditoría: dividí lo que recibe la persona caficultora (US$0.15 – US$0.20) entre los US$4.00 de la taza y pasalo a porcentaje. ¿Qué orden de magnitud te da? No es 20%, no es 10%.", "Ya tenés ese porcentaje. Ahora comparalo con el otro dato del expediente: los países productores reciben 23 – 27% del valor total de la cadena. ¿Tu resultado está cerca, muy por debajo o por encima de ese rango? Esa distancia es la pista.", "Casi lo tenés: el punto medio del rango de la persona caficultora es US$0.175. Sobre US$4.00 eso es 0.175/4 = 4.375% ≈ 4.4%. Cae por debajo del 5%, muy lejos del 23 – 27% global. La opción que describe esa caída —la inequidad se agrava en la venta directa— es la que cierra el hallazgo. Código: 04."]$tx$::jsonb,
          $tx$Correcto. Auditoría verificada: la persona caficultora recibe US$0.15 – 0.20 sobre US$4.00. Con el punto medio US$0.175, el cálculo es 0.175/4 = 4.375% ≈ 4.4%, dentro del rango válido 4 – 4.4% y por debajo del 5%. Ese 4.4% es muy inferior al 23 – 27% que los países productores reciben en promedio del valor total de la cadena, lo que demuestra que la inequidad se agrava en el último eslabón de venta directa al consumidor. A eso se suma que, en 2017, los ingresos de familias caficultoras en Perú y Etiopía fueron 20% más bajos que en 2005, muy por debajo del umbral de pobreza. CGC no puede afirmar pago justo sin corregir ese reparto. <b>Código: 04.</b>$tx$,
          $tx$04$tx$, $tx${"min": 4, "max": 4.4, "cierre": "a"}$tx$::jsonb, $tx$libre$tx$, $tx$payments$tx$, $tx${"tipo": "pastel", "unidad": "US$", "titulo": "Reparto de una taza de US$4.00", "series": [{"etiqueta": "Persona caficultora", "valor": 0.175, "nota": "4.4 %"}, {"etiqueta": "Procesamiento y exportación", "valor": 0.4, "nota": "10 %"}, {"etiqueta": "Tostado y logística internacional", "valor": 1.1, "nota": "27.5 %"}, {"etiqueta": "Cafetería y venta final", "valor": 2.325, "nota": "58.1 %"}], "pie": "Fuente: expediente CGC — caso base 4.3"}$tx$::jsonb);

  -- Sala 4 — Sala de las Personas (Social) · reto: checklist
  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto,
                          interaccion, pistas, feedback_ok, codigo, respuesta,
                          desbloqueo, icono, visual)
  values (v_mision, 4, $tx$Sala de las Personas$tx$, $tx$Social$tx$,
          $tx$Expediente CGC-04 abierto. Ya viste dónde se concentra el valor y dónde se cargan los costos. Ahora auditás a quiénes golpea esa asimetría. Cerca de 25 millones de personas en más de 80 países cultivan café, mayoritariamente en parcelas menores a 5 hectáreas, y en su mayoría viven en condiciones de pobreza. El trabajo infantil ocurre mayormente en el sector agrícola: cerca del 60% del trabajo infantil global —casi 100 millones de niños y niñas— se concentra en actividades agrícolas, incluyendo cultivos como el café. Y los ingresos insuficientes obligan a muchas familias caficultoras a endeudarse, lo que puede derivar en trabajo infantil o migración forzada. Tu tarea no es opinar quién podría ser vulnerable: es señalar, con evidencia del expediente, quién está en riesgo directo. En auditoría, dato no es suposición. Nota docente: hoy solo identificamos actores y riesgo potencial con la evidencia disponible; el marco completo de derechos, inclusión y trabajo digno se desarrollará en la próxima clase.$tx$,
          $tx${"fuente": "Datos del expediente CGC — caso base #4.4", "deuda_riesgo": "Los ingresos insuficientes obligan a muchas familias caficultoras a endeudarse, lo que puede derivar en trabajo infantil o migración forzada.", "nota_auditora": "CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar. Hoy solo se identifica riesgo con evidencia directa.", "escala_pobreza": "Cerca de 25 millones de personas en más de 80 países cultivan café, mayoritariamente en parcelas menores a 5 hectáreas, y en su mayoría viven en condiciones de pobreza.", "trabajo_infantil": "Cerca del 60% del trabajo infantil global —casi 100 millones de niños y niñas— se concentra en actividades agrícolas, incluyendo cultivos como el café."}$tx$::jsonb,
          $tx$De los 8 actores listados, marcá únicamente a quienes el expediente señala en riesgo directo frente a la inequidad económica. Solo vale lo que tiene evidencia directa y textual —no lo que parece razonable por intuición.$tx$,
          $tx${"tipo": "checklist", "enunciado": "De los 8 actores listados, marcá únicamente a quienes el expediente señala en riesgo directo frente a la inequidad económica. Solo vale lo que tiene evidencia directa y textual —no lo que parece razonable por intuición.", "items": [{"id": "caficultora", "texto": "Persona caficultora"}, {"id": "hija", "texto": "Hija/o de la familia caficultora"}, {"id": "intermediario", "texto": "Intermediario local"}, {"id": "exportador", "texto": "Empresa exportadora"}, {"id": "tostadora", "texto": "Tostadora internacional"}, {"id": "barista", "texto": "Barista"}, {"id": "consumidor", "texto": "Consumidor final"}, {"id": "gobierno", "texto": "Gobierno regulador"}]}$tx$::jsonb,
          $tx$["Revisá el expediente palabra por palabra: ¿para quién hay cifra de pobreza y escala productiva citada? No marques por intuición; en auditoría solo cuenta lo que el documento dice con dato.", "Marcar al intermediario o al gobierno parece razonable —toda cadena tiene esos actores— pero el expediente no les atribuye riesgo directo con evidencia. Es la distinción clave de esta sala: dato vs. suposición. Preguntate: ¿para quién sí hay vínculo explícito entre ingresos insuficientes, deuda y trabajo infantil o migración?", "Casi lo tenés: son solo 2 marcas y ambas están en la finca. La persona caficultora —25 millones en más de 80 países, parcela <5 ha, mayoritariamente en pobreza— y su hija/o —expuesta al 60% del trabajo infantil global, casi 100 millones en agricultura— cuando la familia se endeuda. Esos dos tienen cita directa; los otros seis no."]$tx$::jsonb,
          $tx$Correcto. Riesgo directo con evidencia: persona caficultora e hija/o de la familia caficultora. Cerca de 25 millones de personas en más de 80 países cultivan café en parcelas menores a 5 hectáreas y viven mayoritariamente en pobreza, y cerca del 60% del trabajo infantil global —casi 100 millones de niños y niñas— se concentra en agricultura, incluyendo el café. El expediente vincula ingresos insuficientes con endeudamiento que puede derivar en trabajo infantil o migración forzada. Los otros actores pueden parecer vulnerables —marcar al intermediario o al gobierno es razonable como hipótesis— pero no tienen evidencia directa de riesgo en este expediente: en auditoría, dato no es suposición. CGC no es villana, pero su promesa de ser socialmente justa no tiene respaldo hasta auditar y corregir. <b>Código: 2P.</b>$tx$,
          $tx$2P$tx$, $tx${"valor": ["caficultora", "hija"]}$tx$::jsonb, $tx$libre$tx$, $tx$groups$tx$, null);

  -- Sala 5 — Sala de la Verdad (Síntesis anti-greenwashing) · reto: clasificacion
  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto,
                          interaccion, pistas, feedback_ok, codigo, respuesta,
                          desbloqueo, icono, visual)
  values (v_mision, 5, $tx$Sala de la Verdad$tx$, $tx$Síntesis anti-greenwashing$tx$,
          $tx$Expediente CGC-05 abierto — Sala de la Verdad. Último filtro antes de publicar. El directorio de CGC quiere lanzar su primer reporte con cinco frases que llegaron a tu mesa sin respaldo adjunto: 1) "Seremos carbono neutral en 2027." 2) "Usamos agua de lluvia, por lo que nuestro impacto hídrico es mínimo." 3) "Pagamos precios justos a nuestros productores." 4) "Contribuimos al desarrollo de las comunidades productoras." 5) "Compramos exclusivamente a cooperativas centroamericanas certificadas." El periodista ya tiene acceso parcial al archivo. Si algo se publica sin evidencia, el golpe no será ambiental —será reputacional. Tu auditoría decide qué se sostiene y qué se corrige.$tx$,
          $tx${"fuente": "Expediente CGC — síntesis estaciones 1–4", "contexto": "Borrador de reporte CGC — 5 afirmaciones sin documento soporte adjunto. Tu referencia es la evidencia de las estaciones 1 a 4.", "nota_auditora": "CGC no es villana: es una empresa cuyo discurso aún no está respaldado por evidencia. Tu rol es auditar, no juzgar.", "evidencia_agua": "Huella hídrica total en Colombia: 11,113–14,560 m3/t de café pergamino seco, 85–90% es huella verde (agua de lluvia). La huella verde no implica impacto mínimo; no cubre huella gris por fertilizantes y aguas mieles.", "evidencia_valor": "Países productores reciben 23–27% del valor total pero concentran 68–92% de los costos sociales y ambientales. En taza de US$4.00, la persona caficultora recibe US$0.15–0.20 (~4–5%), precio fijado por mercado C no ligado a costos reales.", "evidencia_carbono": "Huella de carbono del cultivo: 2.4 a 13 kg CO2eq/kg; ciclo completo 0.12 a 14.61 kg CO2eq/kg. No hay plan de reducción, línea base ni metodología presentada para 'carbono neutral 2027'.", "evidencia_desarrollo": "Sin datos en el expediente de programas, montos ni resultados medibles de contribución al desarrollo comunitario.", "evidencia_trazabilidad": "Compra a cooperativas centroamericanas certificadas: potencialmente verificable si CGC presenta listado y certificaciones vigentes."}$tx$::jsonb,
          $tx$Auditoría anti-greenwashing: clasificá cada una de las 5 frases del borrador en Verificable, Engañosa o Sin evidencia suficiente, citando el dato de las estaciones anteriores que sostiene tu decisión.$tx$,
          $tx${"tipo": "clasificacion", "enunciado": "Auditoría anti-greenwashing: clasificá cada una de las 5 frases del borrador en Verificable, Engañosa o Sin evidencia suficiente, citando el dato de las estaciones anteriores que sostiene tu decisión.", "categorias": [{"id": "verificable", "texto": "Verificable"}, {"id": "enganosa", "texto": "Engañosa"}, {"id": "sin_evidencia", "texto": "Sin evidencia suficiente"}], "items": [{"id": "f1", "texto": "Seremos carbono neutral en 2027."}, {"id": "f2", "texto": "Usamos agua de lluvia, por lo que nuestro impacto hídrico es mínimo."}, {"id": "f3", "texto": "Pagamos precios justos a nuestros productores."}, {"id": "f4", "texto": "Contribuimos al desarrollo de las comunidades productoras."}, {"id": "f5", "texto": "Compramos exclusivamente a cooperativas centroamericanas certificadas."}]}$tx$::jsonb,
          $tx$["Volvé al expediente: una frase es verificable solo si hay dato, plan o documento que la respalde en las estaciones 1–4. Sin línea base ni metodología, por más contundente que suene, no se sostiene.", "Aplicá el filtro: 'Engañosa' usa un dato real para minimizar un impacto —pista: 85–90% no es mínimo—; 'Sin evidencia' es cuando el expediente no trae ningún programa, monto o documento que la sostenga.", "Mapeo al límite: la de agua de lluvia y la de precios justos distorsionan datos reales —enganosas—; la de carbono neutral 2027 y la de contribución al desarrollo no tienen respaldo en el expediente —sin evidencia—; solo la de cooperativas certificadas puede verificarse si CGC adjunta el listado."]$tx$::jsonb,
          $tx$Auditoría cerrada. De las 5 afirmaciones del borrador de CGC, solo 1 es potencialmente verificable con evidencia documental adicional —"Compramos exclusivamente a cooperativas centroamericanas certificadas"— si se presenta el listado de certificaciones vigentes. Las otras 4 requieren corrección o eliminación antes de publicarse:
• "Seremos carbono neutral en 2027" — sin plan, línea base ni metodología;
• "Usamos agua de lluvia, por lo que nuestro impacto hídrico es mínimo" — engañosa porque la huella verde es 85–90% del total (11,113–14,560 m3/t) y no implica impacto mínimo ni cubre huella gris;
• "Pagamos precios justos" — contradicha por US$0.15–0.20 sobre US$4.00 (~4–5%) y por la asimetría 23–27% de valor vs 68–92% de costos en origen;
• "Contribuimos al desarrollo" — sin programas, montos ni resultados en el expediente.
CGC no puede afirmar ser sostenible; puede afirmar que está en proceso de auditar y mejorar sus tres pilares. <b>Código: 4. Maestro combina 06-87-04-2P-4.</b>$tx$,
          $tx$4$tx$, $tx${"valor": {"f1": "sin_evidencia", "f2": "enganosa", "f3": "enganosa", "f4": "sin_evidencia", "f5": "verificable"}}$tx$::jsonb, $tx$tras_todas$tx$, $tx$gavel$tx$, null);

  raise notice '[seed] misión codigo-del-cafe sembrada con % salas', (select count(*) from estaciones where mision_id = v_mision);
end $seed$;

-- -----------------------------------------------------------------------------
-- BLOQUE B — Migración de retos en formato legacy
--
-- Una base que ya venía funcionando tiene las salas en el formato viejo, donde
-- la forma de la respuesta era distinta EN CADA SALA (`{orden,eslabon}`,
-- `{porcentaje,enganosa}`, `{porcentaje,inconsistencia}`, `{actores}`,
-- `{frases}`) y el verificador se ramificaba por número de sala. El motor nuevo
-- compara por `interaccion->>'tipo'` con la forma canónica `{valor, cierre?}`,
-- así que esas filas hay que convertirlas o el juego deja de corregir.
--
-- Convierte SOLO `interaccion` y `respuesta`. Ni un texto se toca: titulo,
-- pilar, narrativa, datos, reto, pistas y feedback_ok quedan exactamente como
-- estén en la base, con las ediciones que el docente haya hecho.
--
-- La pregunta de cierre sale de `pregunta` + `opciones`, que en el formato
-- viejo colgaban de la interacción como un apéndice suelto.
-- -----------------------------------------------------------------------------
create or replace function _convertir_reto_legacy(p_i jsonb, p_r jsonb, p_reto text)
returns jsonb language plpgsql immutable as $conv$
declare
  v_tipo  text := p_i->>'tipo';
  v_ni    jsonb;
  v_nr    jsonb;
  v_campo jsonb;
  v_ids   text[];
  v_juicio text;
begin
  if v_tipo = 'orden' then
    v_ni := jsonb_build_object('tipo','orden','enunciado',p_reto,'barajar',true,'items',p_i->'items');
    v_nr := jsonb_build_object('valor', p_r->'orden');
    if p_r ? 'eslabon' then v_nr := v_nr || jsonb_build_object('cierre', p_r->>'eslabon'); end if;

  elsif v_tipo = 'checklist' then
    v_ni := jsonb_build_object('tipo','checklist','enunciado',p_reto,'items',p_i->'items');
    v_nr := jsonb_build_object('valor', p_r->'actores');

  elsif v_tipo = 'clasificacion' then
    v_ni := jsonb_build_object('tipo','clasificacion','enunciado',p_reto,
                               'categorias',p_i->'categorias','items',p_i->'items');
    -- Arreglo posicional -> mapa por id de ítem, para que reordenar las frases
    -- en el editor no invalide la respuesta correcta.
    select array_agg(x->>'id' order by ord) into v_ids
      from jsonb_array_elements(p_i->'items') with ordinality as t(x, ord);
    select jsonb_build_object('valor', coalesce(jsonb_object_agg(v_ids[i], p_r->'frases'->>(i-1)), '{}'::jsonb))
      into v_nr
      from generate_series(1, coalesce(array_length(v_ids,1),0)) i
     where p_r->'frases'->>(i-1) is not null;

  elsif v_tipo = 'numero' then
    -- El campo numérico real es el que trae min/max/paso (o se llama
    -- 'porcentaje'); el otro "campo" del formato viejo era en realidad el
    -- select de juicio, que ahora es la pregunta de cierre.
    select x into v_campo from jsonb_array_elements(coalesce(p_i->'campos','[]'::jsonb)) x
     where x ? 'min' or x ? 'max' or x ? 'paso' or x->>'id' = 'porcentaje' limit 1;

    v_ni := jsonb_strip_nulls(jsonb_build_object(
              'tipo','respuesta_corta','modo','numero',
              'enunciado', coalesce(v_campo->>'etiqueta', p_reto),
              'sufijo', v_campo->'sufijo', 'min', v_campo->'min',
              'max', v_campo->'max',      'paso', v_campo->'paso'));

    if p_r ? 'porcentaje_min' then
      v_nr := jsonb_build_object('min', p_r->'porcentaje_min', 'max', p_r->'porcentaje_max');
    else
      v_nr := jsonb_build_object('valor', p_r->'porcentaje');
      if p_r ? 'porcentaje_acepta' then
        v_nr := v_nr || jsonb_build_object('acepta', (
          select coalesce(jsonb_agg(x), '[]'::jsonb)
            from jsonb_array_elements(p_r->'porcentaje_acepta') x
           where x <> p_r->'porcentaje'));
      end if;
    end if;
    v_juicio := coalesce(p_r->>'enganosa', p_r->>'inconsistencia');
    if v_juicio is not null then v_nr := v_nr || jsonb_build_object('cierre', v_juicio); end if;

  else
    return null;  -- ya está en formato canónico, o es un tipo que no se convierte
  end if;

  -- Cierre: la pregunta suelta del formato viejo pasa a ser primera clase.
  if (p_i ? 'pregunta') and (p_i ? 'opciones') then
    v_ni := v_ni || jsonb_build_object('cierre',
              jsonb_build_object('enunciado', p_i->>'pregunta', 'opciones', p_i->'opciones'));
  end if;

  return jsonb_build_object('interaccion', v_ni, 'respuesta', v_nr);
end;
$conv$;

do $mig$
declare v_n int := 0; v_fila record; v_conv jsonb;
begin
  for v_fila in
    select id, interaccion, respuesta, reto from estaciones
     where interaccion->>'tipo' in ('numero')                      -- tipo retirado
        or (interaccion->>'tipo' in ('orden','checklist','clasificacion')
            and not (respuesta ? 'valor'))                          -- forma vieja
  loop
    v_conv := _convertir_reto_legacy(v_fila.interaccion, v_fila.respuesta, v_fila.reto);
    if v_conv is not null then
      update estaciones
         set interaccion = v_conv->'interaccion',
             respuesta   = v_conv->'respuesta'
       where id = v_fila.id;
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    raise notice '[seed] % sala(s) migradas del formato legacy al canónico', v_n;
  end if;
end $mig$;

drop function if exists _convertir_reto_legacy(jsonb, jsonb, text);
