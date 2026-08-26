// js/contenido.js — UI helpers sin secretos (CONTRACT §10a)
// Dueños: ct-e1..ct-e5. Lo que puede vivir en el cliente porque no revela nada.
// Enunciados, narrativa, datos y reto se leen de estaciones_publicas, no se duplican aquí.

export const ESTACIONES_UI = {
  1: {
    ordenInicialAleatorio: true,
    etiquetas: {
      titulo: "Sala de Hechos",
      pilar: "Cadena de valor",
      // Interacción tipo "orden": 6 eslabones + pregunta eslabón crítico
      // items/pregunta/opciones vienen de estaciones_publicas.interaccion
    }
  },
  2: {
    etiquetas: {
      titulo: "Sala Verde",
      pilar: "Ambiental",
      // tipo "numero": campos porcentaje + enganosa
    }
  },
  3: {
    etiquetas: {
      titulo: "Sala del Dinero",
      pilar: "Económico",
      // tipo "numero": porcentaje + inconsistencia a/b/c
    }
  },
  4: {
    etiquetas: {
      titulo: "Sala de las Personas",
      pilar: "Social",
      // tipo "checklist": 8 actores
    }
  },
  5: {
    etiquetas: {
      titulo: "Sala de la Verdad",
      pilar: "Síntesis anti-greenwashing",
      // tipo "clasificacion": 5 frases -> 3 categorías
    }
  }
};
