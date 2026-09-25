-- =============================================================================
-- El Código del Café — 07-mision-holcim.sql
-- Misión 'Expediente Holcim': 5 salas sobre riesgo, reputación, greenwashing y
-- terceros creíbles, con datos reales de Holcim El Salvador (Informe Anual 2024 +
-- prensa verificada) y escenarios ficticios marcados como tal en el contenido.
-- Fuente: 'Escape Room Holcim - Contenido de salas.md' (Drive, 2026-09-25).
-- Idempotente: upsert por slug de misión y por (mision_id, orden) de sala.
-- Orden: 00-roles → 01-esquema → 02-rls → 03-funciones → 04-docentes → 05-seed →
--        06-superadmin → 07-mision-holcim
-- =============================================================================

do $mig$
declare
  v_mision uuid;
begin
  insert into misiones (slug, titulo, subtitulo, intro, codigo_maestro, veredicto, estado, brief_titulo, brief_contenido)
  values (
    $q$expediente-holcim$q$,
    $q$Expediente Holcim$q$,
    $q$Riesgo, reputación y terceros creíbles con datos reales de El Salvador$q$,
    $q$Holcim El Salvador cumplió 75 años y dice ir camino a ser carbono neutral. Ustedes son un equipo de Sostenibilidad y Comunicación Corporativa que debe revisar el expediente antes de publicar el Reporte de Sostenibilidad 2025. Cada sala es un problema de confianza. Resuélvanlas con los datos del expediente, no con opiniones. Todo lo marcado como "(ficticio)" es una simulación; el resto son datos reales de Holcim.$q$,
    null,
    $q$Expediente cerrado. Revisaron los datos de Holcim El Salvador como equipo de Sostenibilidad y Comunicación Corporativa. Esto es lo que encontraron:

Sala 1: La reducción real del CO2 por tonelada es 6 %, no el 12 % publicado. El riesgo no es la meta de 2030: es que un tercero lo demuestre en público.

Sala 2: Tres conferencias dieron tres cifras distintas para el mismo producto. Solo la Declaración Ambiental verificada por un tercero se puede comprobar.

Sala 3: Aliados Verdes tiene un dato que Holcim no puede explicar: se procesó más y se evitó menos CO2. Las RRPP se construyen antes de la crisis, no después.

Sala 4: De tres indicadores, solo uno se puede declarar sin inflar. Los otros son doble conteo o proyección.

Sala 5: El discurso del CEO mezcla datos que no cuadran, premios que son de otros y certificaciones sin indicadores. El wobble es la autenticidad.

Veredicto: Holcim El Salvador hace cosas reales, pero las comunica con más confianza de la que sus datos sostienen. El riesgo reputacional no viene de ser una mala empresa: viene de decir algo que no puedes respaldar cuando alguien te lo pregunta. La confianza se construye con datos verificables, terceros creíbles y coherencia entre lo que haces, lo que dices y lo que otros dicen de ti.$q$,
    'publicada',
    $q$Quién es Holcim El Salvador$q$,
    $q$<ul><li><b>75 años en El Salvador.</b> Se fundó como CESSA en 1949 y adoptó la marca Holcim El Salvador en 2010.</li><li><b>Indicadores generales:</b></li><li><b>Instalaciones:</b> 2 plantas de cemento (El Ronco y Maya, en Metapán), 8 plantas fijas y 6 móviles de concreto, 1 planta de coprocesamiento Geocycle, 1 planta de agregados y 1 planta eléctrica.</li><li>736 empleos directos, 17 % de mujeres entre los colaboradores y 755 proveedores.</li><li>3,736 personas beneficiadas a través de Fundación Holcim.</li><li><b>Su estrategia de sostenibilidad:</b> cuatro pilares — economía circular, naturaleza y biodiversidad, clima y energía, y personas y comunidades.</li><li><b>Su compromiso más fuerte: ser carbono neutral.</b> El informe lo menciona sin año. Revista Economía (12 de noviembre de 2025) lo ubica en 2030 — la frase es del periodista, no una cita del CEO.</li><li>Esa misma nota dice que Holcim "ha logrado disminuir entre un 11 % y un 12 % las emisiones de CO2 por tonelada".</li><li>La misma nota: Holcim obtiene "el 20 % de la energía" de una planta solar y sustituye "un 15 % de su combustible" por materiales reutilizados.</li><li>Invertirá $30 millones entre 2025 y 2027, según esa nota.</li><li><b>Quiénes son:</b></li><li><b>Marcelo Arrieta</b> — CEO; 2024 fue su primer año en el cargo.</li><li><b>Rocío Flores</b> — Gerente de Desarrollo Sostenible.</li><li><b>Jorge Peña</b> — Gerente de Geocycle.</li><li><b>Melissa Montalvo</b> — Head de Comunicaciones y Asuntos Corporativos.</li><li><i>Hoy no vamos a decidir si Holcim es buena o mala. Vamos a revisar si lo que dice está respaldado.</i></li></ul>$q$
  )
  on conflict (slug) do update set
    titulo          = excluded.titulo,
    subtitulo       = excluded.subtitulo,
    intro           = excluded.intro,
    veredicto       = excluded.veredicto,
    brief_titulo    = excluded.brief_titulo,
    brief_contenido = excluded.brief_contenido
  returning id into v_mision;

  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
  values (
    v_mision,
    1,
    $q$La cifra que ya salió$q$,
    $q$Gestión de riesgos$q$,
    $q$<b>Expediente HES-01.</b> Holcim dijo en prensa que ya redujo <b>entre 11 % y 12 % el CO2 por tonelada de cemento</b>, camino a ser carbono neutral en 2030. <i>(Ficticio)</i> En 2026 repitió ese 12 % en dos comunicados más, y nadie fuera de la empresa lo ha verificado. Ahora Operaciones les envía su tablero interno. Antes de que el 12 % entre al Reporte de Sostenibilidad 2025, ustedes deben comprobar si es cierto.$q$,
    $q${"Lo que se publicó en prensa": "Holcim \"ha logrado disminuir entre un 11 % y un 12 % las emisiones de CO2 por tonelada\", en línea con su meta de ser carbono neutral en 2030.", "Comunicados de la empresa (ficticio)": "En 2026 la empresa repitió el 12 % en dos comunicados. Nadie fuera de la empresa lo ha verificado.", "Tablero interno de Operaciones (ficticio)": ["CO2 por tonelada de cemento en 2023: <b>600 kg</b>.", "CO2 por tonelada de cemento en 2025: <b>564 kg</b>.", "Nota al pie: \"Dato de gestión. No auditado.\""], "Lo que dice el informe anual": "No reporta emisiones totales ni el año desde el que se mide la reducción."}$q$::jsonb,
    $q$<ul><li><b>Paso 1.</b> Con el tablero interno, calculen en qué porcentaje bajó el CO2 por tonelada entre 2023 y 2025.</li><li><b>Paso 2.</b> Comparen su resultado con el 12 % que ya se publicó.</li><li><b>Paso 3.</b> Respondan: ¿qué es lo que más pone en riesgo la confianza en Holcim?</li></ul>$q$,
    $q${"tipo": "respuesta_corta", "enunciado": "Paso 1. ¿En qué porcentaje bajó el CO2 por tonelada entre 2023 y 2025?", "modo": "numero", "placeholder": "Ej. 10", "min": 0, "max": 100, "paso": 0.5, "sufijo": "%", "cierre": {"enunciado": "Paso 3. Holcim publicó una cifra distinta a la de su tablero. ¿Qué es lo que más pone en riesgo la confianza en Holcim?", "opciones": [{"id": "a", "texto": "Que la empresa no llegue a ser carbono neutral en 2030."}, {"id": "b", "texto": "Que alguien de fuera (un auditor, un regulador o un medio) revise los datos y diga en público que el 12 % no es cierto."}, {"id": "c", "texto": "Que la competencia publique una cifra de reducción mejor."}, {"id": "d", "texto": "Que el Reporte de Sostenibilidad 2025 salga con retraso."}]}}$q$::jsonb,
    $q$["Primero resten: ¿cuántos kilos de CO2 por tonelada bajaron entre 2023 y 2025?", "Ahora una regla de 3: si 600 kg es el 100 %, ¿qué porcentaje son los kilos que bajaron?", "36 × 100 ÷ 600. Para la pregunta del paso 3: el problema no es la meta de 2030, sino que alguien de fuera demuestre que la cifra publicada no es cierta."]$q$::jsonb,
    $q$Correcto: 6 %. El CO2 por tonelada bajó de 600 a 564 kg, es decir, 36 kg menos. Con regla de 3: 36 × 100 ÷ 600 = 6 %. La empresa publicó 12 %, el doble de lo que muestra su propio tablero. La meta de 2030 todavía puede cumplirse; lo que pone en riesgo la confianza es que un tercero revise los datos y demuestre en público que el 12 % no es cierto. Así funciona el riesgo reputacional: un error de datos se convierte en lo que la gente cree de la empresa.$q$,
    $q$06$q$,
    $q${"valor": 6, "cierre": "b"}$q$::jsonb,
    $q$libre$q$,
    $q$warning$q$,
    null
  )
  on conflict (mision_id, orden) do update set
    titulo      = excluded.titulo,
    pilar       = excluded.pilar,
    narrativa   = excluded.narrativa,
    datos       = excluded.datos,
    reto        = excluded.reto,
    interaccion = excluded.interaccion,
    pistas      = excluded.pistas,
    feedback_ok = excluded.feedback_ok,
    codigo      = excluded.codigo,
    respuesta   = excluded.respuesta,
    desbloqueo  = excluded.desbloqueo,
    icono       = excluded.icono,
    visual      = excluded.visual;

  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
  values (
    v_mision,
    2,
    $q$Tres conferencias, tres cifras$q$,
    $q$Greenwashing y terceros creíbles$q$,
    $q$<b>Expediente HES-02.</b> <i>(Ficticio)</i> En un año, Holcim dio tres conferencias de prensa para presentar sus productos bajos en carbono: el concreto <b>ECOPact</b> y los cementos <b>ECOPlanet</b>. Un periodista juntó lo que dijo la vocería en cada una y preguntó en redes por qué las cifras no coinciden. Las frases son reales: Holcim las publicó en distintos medios entre 2024 y 2025. Si el discurso no se sostiene, el producto puede terminar señalado como <i>greenwashing</i>. Antes de la próxima conferencia, la Gerencia les pide revisar el discurso.$q$,
    $q${"Los productos": "ECOPact es la línea de concreto de Holcim con menos CO2. ECOPlanet es su línea de cementos (FUERTE y MAESTRO).", "Conferencia 1 (ficticio)": ["\"ECOPact reduce el CO2 hasta 35 %.\"", "\"En Latinoamérica, Holcim tiene Declaraciones Ambientales de Producto, verificadas por un tercero independiente, para 70 tipos de cemento y más de 5,000 diseños de concreto.\""], "Conferencia 2 (ficticio)": ["\"Nuestros cementos ECOPlanet y concretos ECOPact reducen al menos 30 % de CO2.\"", "\"Garantizamos una huella de carbono cada vez más baja.\""], "Conferencia 3 (ficticio)": ["\"ECOPact reduce hasta un 30 % las emisiones de CO2.\"", "\"Nuestros cementos FUERTE y MAESTRO ECOPlanet tienen menor emisión de CO2.\""], "Qué es una Declaración Ambiental de Producto": "Un documento con datos del impacto ambiental de un producto en todo su ciclo de vida, revisado por un tercero independiente. Está publicado y cualquiera puede consultarlo."}$q$::jsonb,
    $q$<ul><li><b>Paso 1.</b> Lean las seis frases de las tres conferencias y clasifiquen cada una: <b>se puede comprobar con un documento</b>, <b>choca con otra frase</b> o <b>no trae ningún dato</b>.</li><li><b>Paso 2.</b> Escojan la recomendación de comunicación que protege la confianza en el producto.</li></ul>$q$,
    $q${"tipo": "clasificacion", "enunciado": "Paso 1. Clasifiquen cada frase.", "categorias": [{"id": "documento", "texto": "Se puede comprobar con un documento"}, {"id": "choca", "texto": "Choca con otra frase"}, {"id": "sin_dato", "texto": "No trae ningún dato"}], "items": [{"id": "f1", "texto": "Conferencia 1: \"ECOPact reduce el CO2 hasta 35 %.\""}, {"id": "f2", "texto": "Conferencia 1: \"Holcim tiene Declaraciones Ambientales de Producto, verificadas por un tercero independiente, para 70 tipos de cemento.\""}, {"id": "f3", "texto": "Conferencia 2: \"Nuestros cementos ECOPlanet y concretos ECOPact reducen al menos 30 % de CO2.\""}, {"id": "f4", "texto": "Conferencia 2: \"Garantizamos una huella de carbono cada vez más baja.\""}, {"id": "f5", "texto": "Conferencia 3: \"ECOPact reduce hasta un 30 % las emisiones de CO2.\""}, {"id": "f6", "texto": "Conferencia 3: \"Nuestros cementos FUERTE y MAESTRO ECOPlanet tienen menor emisión de CO2.\""}], "cierre": {"enunciado": "Paso 2. ¿Qué recomendación de comunicación protege la confianza en el producto?", "opciones": [{"id": "a", "texto": "Usar el 35 % en todas las conferencias, porque es la cifra más alta."}, {"id": "b", "texto": "Pagarle a un influencer de construcción sostenible para que repita la cifra en redes."}, {"id": "c", "texto": "Publicar una sola cifra, decir contra qué producto se compara y remitir a la Declaración Ambiental verificada por un tercero."}, {"id": "d", "texto": "Dejar de hablar de ECOPact hasta tener un producto perfecto."}]}}$q$::jsonb,
    $q$["Busquen las frases que hablan del mismo producto y del mismo beneficio. ¿Dicen lo mismo en las tres conferencias?", "Fíjense en la palabra que va antes del número: \"hasta\" marca un techo y \"al menos\" marca un piso. ¿Puede el 30 % ser techo y piso a la vez? Y una frase sin número ni documento, ¿qué la respalda?", "Tres frases chocan (la del 35 %, la del \"al menos 30 %\" y la del \"hasta un 30 %\"), una se comprueba con un documento revisado por un tercero, y dos no traen dato. Para el paso 2: un tercero creíble no se compra ni se guioniza; se gana con datos que cualquiera puede revisar."]$q$::jsonb,
    $q$Correcto. Tres frases chocan entre sí: "hasta 35 %", "al menos 30 %" y "hasta un 30 %". "Hasta" es un techo y "al menos" es un piso, así que no pueden describir el mismo beneficio, y ninguna dice contra qué producto se compara. La frase de las Declaraciones Ambientales de Producto es la única que se puede comprobar: las revisó un tercero independiente y están publicadas. "Garantizamos una huella cada vez más baja" y "menor emisión" no traen ningún dato. La recomendación que protege la confianza es publicar una sola cifra, decir contra qué se compara y remitir al documento verificado. Así el mensaje queda alineado con la operación y el tercero creíble habla por los datos, no por la empresa.$q$,
    $q$3C$q$,
    $q${"valor": {"f1": "choca", "f2": "documento", "f3": "choca", "f4": "sin_dato", "f5": "choca", "f6": "sin_dato"}, "cierre": "c"}$q$::jsonb,
    $q$libre$q$,
    $q$campaign$q$,
    null
  )
  on conflict (mision_id, orden) do update set
    titulo      = excluded.titulo,
    pilar       = excluded.pilar,
    narrativa   = excluded.narrativa,
    datos       = excluded.datos,
    reto        = excluded.reto,
    interaccion = excluded.interaccion,
    pistas      = excluded.pistas,
    feedback_ok = excluded.feedback_ok,
    codigo      = excluded.codigo,
    respuesta   = excluded.respuesta,
    desbloqueo  = excluded.desbloqueo,
    icono       = excluded.icono,
    visual      = excluded.visual;

  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
  values (
    v_mision,
    3,
    $q$La aliada incómoda$q$,
    $q$Relaciones públicas$q$,
    $q$<b>Expediente HES-03.</b> <i>(Ficticio)</i> La ONG <b>Aliados Verdes</b> lleva 3 años recogiendo residuos sólidos municipales para que Geocycle los coprocese en su planta de Metapán. La directora de la ONG, <b>Carmen Villalta</b> <i>(ficticia)</i>, acaba de enviar un correo al equipo de Comunicaciones: dice que Holcim nunca reconoció públicamente el trabajo de Aliados Verdes, que ella tiene sus propios datos del programa y que, si no la incluyen en el próximo informe, va a publicar esos datos en redes y en prensa. Ustedes son el equipo que debe evaluar la situación antes de responder.$q$,
    $q${"Correo de Carmen Villalta (ficticio)": ["\"Llevamos 3 años entregándoles residuos. Ustedes publican las toneladas como suyas. Nunca nos mencionan.\"", "\"Tengo las cifras reales. Si no me incluyen en el informe, las publico yo.\""], "Lo que dice la web de Holcim (2023)": ["En 2022, Geocycle procesó más de <b>36 mil toneladas</b> de residuos.", "En 2022, Geocycle evitó más de <b>55 mil toneladas de CO2</b>.", "Para 2023, la meta era procesar <b>90 mil toneladas</b> y triplicar el CO2 evitado."], "Lo que dice el informe anual 2024": ["Geocycle coprocesó <b>52,285 toneladas</b> de residuos.", "Se evitaron <b>12,522.7 toneladas de CO2</b>.", "Residuos sólidos municipales: <b>27,602 toneladas</b>, un <b>+117 %</b> frente a 2023."], "Nota": "Los residuos municipales son los que recoge Aliados Verdes (ficticio). El resto viene de empresas privadas."}$q$::jsonb,
    $q$<ul><li><b>Paso 1.</b> Revisen los datos del expediente. Luego marquen cuáles de las siguientes tareas de RRPP debieron haberse hecho <b>antes</b> de recibir el correo de Carmen.</li><li><b>Paso 2.</b> Respondan: ¿qué dato concreto le da poder a Carmen para dañar la reputación de Holcim?</li></ul>$q$,
    $q${"tipo": "checklist", "enunciado": "Paso 1. ¿Cuáles de estas tareas de RRPP debieron hacerse antes de recibir el correo?", "items": [{"id": "escuchar", "texto": "Escuchar a los aliados que participan en los programas de sostenibilidad."}, {"id": "relaciones", "texto": "Construir una relación con Aliados Verdes antes de que hubiera un conflicto."}, {"id": "explicar", "texto": "Explicar a Carmen los riesgos de publicar datos sin contexto."}, {"id": "alinear", "texto": "Alinear lo que Holcim publica con lo que realmente aporta cada parte."}, {"id": "terceros", "texto": "Incluir a Aliados Verdes como tercero creíble en el informe."}, {"id": "campaña", "texto": "Lanzar una campaña en redes para posicionar a Holcim antes de que Carmen publique."}], "cierre": {"enunciado": "Paso 2. Carmen dice que tiene \"las cifras reales\". ¿Qué dato concreto le da más poder para dañar la reputación de Holcim?", "opciones": [{"id": "a", "texto": "Que Holcim no llegó a las 90 mil toneladas que prometió para 2023."}, {"id": "b", "texto": "Que en 2022 se evitaron 55 mil toneladas de CO2, pero con más residuos procesados el informe reporta solo 12,522 toneladas de CO2 evitadas."}, {"id": "c", "texto": "Que Aliados Verdes no aparece mencionada en el informe anual."}, {"id": "d", "texto": "Que los residuos municipales crecieron 117 % frente a 2023."}]}}$q$::jsonb,
    $q$["Las tareas de RRPP se hacen antes de la crisis, no durante. ¿Cuáles de estas acciones se podían hacer cuando todavía no había conflicto?", "Explicar los riesgos de publicar y lanzar una campaña son reacciones a la amenaza, no trabajo previo. En cambio, escuchar, construir la relación, alinear el mensaje y reconocer al tercero se hacen con tiempo.", "Marquen: escuchar, construir relaciones, alinear el mensaje y reconocer al tercero. Para el paso 2: comparen las cifras de CO2 entre 2022 y el informe. Se procesó más, pero se evitó menos de la cuarta parte. Ese es el dato que no tiene explicación."]$q$::jsonb,
    $q$Correcto. Las cuatro tareas que debieron hacerse antes son: escuchar a los aliados, construir la relación con Aliados Verdes, alinear lo que Holcim publica con lo que cada parte aporta, e incluir a la ONG como tercero creíble. "Explicar los riesgos de publicar" y "lanzar una campaña" son reacciones al conflicto, no trabajo previo: las RRPP construyen relaciones antes de la crisis, no después. El dato que le da más poder a Carmen es la inconsistencia del CO2: en 2022, con 36 mil toneladas procesadas, Geocycle reportó 55 mil toneladas de CO2 evitadas; en el informe, con 52,285 toneladas procesadas, reporta solo 12,522.7 toneladas de CO2 evitadas. Se procesó más y se evitó menos de la cuarta parte. Si Carmen publica eso, la pregunta no es si Holcim recicla, sino si sus cifras de impacto climático son confiables.$q$,
    $q$AV$q$,
    $q${"valor": ["escuchar", "relaciones", "alinear", "terceros"], "cierre": "b"}$q$::jsonb,
    $q$libre$q$,
    $q$groups$q$,
    null
  )
  on conflict (mision_id, orden) do update set
    titulo      = excluded.titulo,
    pilar       = excluded.pilar,
    narrativa   = excluded.narrativa,
    datos       = excluded.datos,
    reto        = excluded.reto,
    interaccion = excluded.interaccion,
    pistas      = excluded.pistas,
    feedback_ok = excluded.feedback_ok,
    codigo      = excluded.codigo,
    respuesta   = excluded.respuesta,
    desbloqueo  = excluded.desbloqueo,
    icono       = excluded.icono,
    visual      = excluded.visual;

  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
  values (
    v_mision,
    4,
    $q$La declaratoria$q$,
    $q$Lógica y evidencia$q$,
    $q$<b>Expediente HES-04.</b> <i>(Ficticio)</i> El equipo de Comunicaciones está preparando la <b>Declaratoria de Avance 2025</b>: un documento de una página donde Holcim quiere demostrar cuánto CO2 ha dejado de emitir. La Gerencia pide que incluyan todas las cifras disponibles. Ustedes deben revisar el borrador antes de que se publique. El problema no es si las cifras son verdaderas: es si se pueden sumar.$q$,
    $q${"Borrador de la declaratoria (ficticio)": "\"En Holcim El Salvador avanzamos hacia nuestra meta de ser carbono neutral. Estas son las toneladas de CO2 que hemos evitado:\"", "Indicador 1": "<b>12,522.7 toneladas de CO2</b> evitadas por usar combustibles alternativos en Geocycle.", "Indicador 2": "<b>165.75 toneladas de CO2</b> evitadas al tratar los plásticos de Alas Doradas en Geocycle.", "Indicador 3": "<b>560 toneladas de CO2</b> que se dejarán de emitir con el camión minero 100 % eléctrico.", "Dato clave sobre el indicador 2": "Los plásticos de Alas Doradas se usan como combustible alternativo en la planta de Geocycle.", "Dato clave sobre el indicador 3": "El informe dice que el camión <b>\"reduciría\"</b> el consumo en \"hasta\" 250,000 litros de diésel al año y <b>\"disminuiría\"</b> la huella en 560 toneladas."}$q$::jsonb,
    $q$<ul><li><b>Paso 1.</b> Lean los tres indicadores y los datos clave. Respondan: ¿cuántas toneladas de CO2 evitadas puede Holcim declarar sin inflar ni repetir?</li><li><b>Paso 2.</b> Respondan: ¿por qué no se pueden sumar los tres indicadores?</li></ul>$q$,
    $q${"tipo": "respuesta_corta", "enunciado": "Paso 1. ¿Cuántas toneladas de CO2 evitadas puede Holcim declarar sin inflar ni repetir?", "modo": "numero", "placeholder": "Ej. 10000", "min": 0, "max": 50000, "paso": 0.1, "sufijo": "t", "cierre": {"enunciado": "Paso 2. ¿Por qué no se pueden sumar los tres indicadores?", "opciones": [{"id": "a", "texto": "Porque las 165.75 t de Alas Doradas ya están dentro de las 12,522.7 t de Geocycle (doble conteo), y las 560 t del camión son una proyección, no un resultado."}, {"id": "b", "texto": "Porque las tres cifras vienen de fuentes distintas y no se pueden mezclar."}, {"id": "c", "texto": "Porque Holcim no tiene un auditor externo que las valide."}, {"id": "d", "texto": "Porque el CO2 evitado no es lo mismo que el CO2 reducido."}]}}$q$::jsonb,
    $q$["Lean el dato clave del indicador 2. Si los plásticos de Alas Doradas se procesan en Geocycle, ¿las 165.75 t ya están contadas en otro indicador?", "Lean el dato clave del indicador 3. Fíjense en los verbos: \"reduciría\" y \"disminuiría\" están en condicional. ¿Eso es un resultado o algo que todavía no ha pasado?", "El indicador 1 (12,522.7 t) es el único resultado limpio. El 2 ya está incluido en el 1 (doble conteo) y el 3 es una proyección (condicional). La respuesta es 12,522.7."]$q$::jsonb,
    $q$Correcto: 12,522.7 toneladas. Es la única cifra que Holcim puede declarar sin inflar ni repetir. Las 165.75 t de Alas Doradas ya están dentro de las 12,522.7 t, porque los plásticos de Alas Doradas se procesan en la misma planta de Geocycle como combustible alternativo: contarlas aparte sería doble conteo. Las 560 t del camión eléctrico son una proyección: el informe usa "reduciría" y "disminuiría" (condicional), no pasado. Sumar un resultado con una proyección y un dato que ya está incluido no demuestra avance; demuestra que el argumento no se sostiene. En el triángulo de Frei, eso es un tambaleo de lógica.$q$,
    $q$R1$q$,
    $q${"valor": 12522.7, "cierre": "a"}$q$::jsonb,
    $q$libre$q$,
    $q$calculate$q$,
    null
  )
  on conflict (mision_id, orden) do update set
    titulo      = excluded.titulo,
    pilar       = excluded.pilar,
    narrativa   = excluded.narrativa,
    datos       = excluded.datos,
    reto        = excluded.reto,
    interaccion = excluded.interaccion,
    pistas      = excluded.pistas,
    feedback_ok = excluded.feedback_ok,
    codigo      = excluded.codigo,
    respuesta   = excluded.respuesta,
    desbloqueo  = excluded.desbloqueo,
    icono       = excluded.icono,
    visual      = excluded.visual;

  insert into estaciones (mision_id, orden, titulo, pilar, narrativa, datos, reto, interaccion, pistas, feedback_ok, codigo, respuesta, desbloqueo, icono, visual)
  values (
    v_mision,
    5,
    $q$El discurso del CEO$q$,
    $q$Confianza y reputación$q$,
    $q$<b>Expediente HES-05.</b> <i>(Ficticio)</i> El CEO de Holcim participa en un foro de sostenibilidad empresarial y presenta cinco logros. Después de su intervención, una activista <i>(ficticia)</i> le hace tres preguntas incómodas en público. Ustedes tienen el expediente completo: lo que dijo el CEO, lo que preguntó la activista y los datos que ya conocen de las salas anteriores. Su trabajo es clasificar cada afirmación del CEO según el triángulo de Frei: ¿dónde tambalea la confianza?$q$,
    $q${"Lo que dijo el CEO en el foro (ficticio)": ["\"Fundación Holcim ha beneficiado a 3,736 personas con 8 proyectos en 4 pilares.\"", "\"Contamos con la certificación ISO 45001 de seguridad y salud ocupacional. La seguridad de nuestra gente es prioridad.\"", "\"Fuimos reconocidos con el premio de la OPAMSS por nuestro compromiso con las comunidades.\"", "\"Recibimos el premio Empresa del Año de la Gala de Derecho y Negocios.\"", "\"Nuestro informe anual demuestra transparencia en todo lo que hacemos.\""], "Lo que preguntó la activista (ficticio)": ["\"Su propia web dice que benefician a más de 9,500 personas. ¿Por qué el informe dice 3,736?\"", "\"Tienen ISO 45001, pero su informe no reporta ni un solo indicador de seguridad laboral. ¿Cero accidentes, o simplemente no lo miden?\"", "\"El premio de la OPAMSS fue para el proyecto Eco Barrio Lab, no para la Planta La Libertad ni para la empresa entera. ¿Por qué lo presentan como un reconocimiento general?\""], "Dato del expediente": ["La web de Holcim y la prensa dicen \"más de 9,500 personas\" beneficiadas. El informe dice 3,736. Si ambas cifras son correctas, hubo una caída del 61 % que nadie explica.", "El informe tiene ISO 45001 certificada y un reconocimiento a los \"Héroes HSE\", pero cero indicadores de seguridad: ni tasa de accidentalidad, ni lesiones, ni incidentes.", "El premio de la OPAMSS es para el proyecto Eco Barrio Lab (pág. 27 del informe). No es un premio a la empresa ni a una planta."]}$q$::jsonb,
    $q$<ul><li><b>Paso 1.</b> Lean las cinco afirmaciones del CEO y las tres preguntas de la activista. Con los datos del expediente, clasifiquen cada afirmación del CEO según qué pilar del triángulo de Frei tambalea: <b>autenticidad</b>, <b>lógica</b> o <b>empatía</b>.</li><li><b>Paso 2.</b> Respondan: ¿cuál es el <i>wobble</i> principal del CEO en este discurso?</li></ul>$q$,
    $q${"tipo": "clasificacion", "enunciado": "Paso 1. Clasifiquen cada afirmación del CEO según el pilar del triángulo de Frei que tambalea.", "categorias": [{"id": "autenticidad", "texto": "Autenticidad: no dice lo que realmente pasa"}, {"id": "logica", "texto": "Lógica: los datos no sostienen el argumento"}, {"id": "empatia", "texto": "Empatía: no le importa lo que le importa al otro"}], "items": [{"id": "a1", "texto": "\"Fundación Holcim ha beneficiado a 3,736 personas con 8 proyectos en 4 pilares.\""}, {"id": "a2", "texto": "\"Contamos con ISO 45001. La seguridad de nuestra gente es prioridad.\""}, {"id": "a3", "texto": "\"Fuimos reconocidos con el premio de la OPAMSS por nuestro compromiso con las comunidades.\""}, {"id": "a4", "texto": "\"Recibimos el premio Empresa del Año de la Gala de Derecho y Negocios.\""}, {"id": "a5", "texto": "\"Nuestro informe anual demuestra transparencia en todo lo que hacemos.\""}], "cierre": {"enunciado": "Paso 2. ¿Cuál es el wobble principal del CEO en este discurso?", "opciones": [{"id": "a", "texto": "Autenticidad: presenta datos que no coinciden con otras publicaciones de la propia empresa y omite lo que no le conviene."}, {"id": "b", "texto": "Lógica: los números están bien, pero los presenta en un orden confuso."}, {"id": "c", "texto": "Empatía: habla de premios sin preguntarse qué le preocupa a la audiencia."}, {"id": "d", "texto": "No hay wobble: todo lo que dijo es verificable."}]}}$q$::jsonb,
    $q$["Para cada afirmación, pregúntense: ¿el dato sostiene lo que dice (lógica)? ¿Dice lo que realmente pasa (autenticidad)? ¿Le importa lo que le importa al otro (empatía)?", "La de los 3,736 beneficiarios tiene un problema de datos (la web dice 9,500). La de ISO 45001 suena bien, pero ¿qué indicador lo respalda? La de la OPAMSS se atribuye un premio que es de otro proyecto. La de Empresa del Año usa un premio de una gala privada como evidencia de sostenibilidad. La de transparencia choca con todo lo que han descubierto en las salas anteriores.", "a1 = lógica (3,736 vs 9,500, los datos no cuadran); a2 = empatía (dice que importa la seguridad, pero no reporta nada de seguridad); a3 = autenticidad (el premio es de Eco Barrio Lab, no de la empresa); a4 = lógica (un premio de una gala no demuestra sostenibilidad); a5 = autenticidad (el informe omite más de lo que muestra). El wobble principal es autenticidad."]$q$::jsonb,
    $q$Correcto. El wobble principal es la autenticidad: el CEO presenta como propios datos que no coinciden con otras publicaciones de la empresa, se atribuye un premio que es de un proyecto específico y llama transparente a un informe que omite indicadores básicos. En detalle: los 3,736 beneficiarios no cuadran con los 9,500 de la web (lógica); decir que la seguridad es prioridad sin reportar un solo indicador es no atender lo que importa (empatía); el premio OPAMSS es de Eco Barrio Lab, no de la empresa (autenticidad); Empresa del Año es un reconocimiento de una gala privada, no evidencia de sostenibilidad (lógica); y llamar transparente a un informe que no reporta emisiones totales, accidentes ni año base rompe la autenticidad. Así funciona el triángulo de Frei: cuando un pilar falla, la confianza se inclina hacia ese lado.$q$,
    $q$FW$q$,
    $q${"valor": {"a1": "logica", "a2": "empatia", "a3": "autenticidad", "a4": "logica", "a5": "autenticidad"}, "cierre": "a"}$q$::jsonb,
    $q$secuencial$q$,
    $q$podium$q$,
    null
  )
  on conflict (mision_id, orden) do update set
    titulo      = excluded.titulo,
    pilar       = excluded.pilar,
    narrativa   = excluded.narrativa,
    datos       = excluded.datos,
    reto        = excluded.reto,
    interaccion = excluded.interaccion,
    pistas      = excluded.pistas,
    feedback_ok = excluded.feedback_ok,
    codigo      = excluded.codigo,
    respuesta   = excluded.respuesta,
    desbloqueo  = excluded.desbloqueo,
    icono       = excluded.icono,
    visual      = excluded.visual;

end $mig$;