import type { MethodologyDocument, Thresholds } from "./en";

export function es(t: Thresholds): MethodologyDocument {
  return {
    title: "Metodología",
    lead: "De dónde salen los datos, cómo se calculan los segmentos y los percentiles, y qué significa cada nivel de confianza.",

    sections: {
      sources: {
        heading: "De dónde salen los datos",
        paragraphs: [
          "Cada cifra de este sitio viene de las Blizzard® Developer APIs, la interfaz pública que Blizzard Entertainment, Inc. publica de World of Warcraft®. Trabajan dos endpoints: el leaderboard de Solo Shuffle, que lista la parte alta de la clasificación por especialización, y el perfil de personaje, que devuelve el equipo y los talentos con los que se vio al personaje por última vez.",
          "Aquí no hay nada que venga de un addon, de un parseador de logs ni de una página raspada de otro sitio, y ninguna cifra se teclea a mano. Un número que la API no devuelve es un número que este sitio no tiene.",
          "One Rung no está afiliado a Blizzard Entertainment, Inc. ni cuenta con su respaldo ni con su patrocinio. El dato llega como llega, y así es como sale.",
        ],
      },

      observed: {
        heading: "Qué significa «observado»",
        paragraphs: [
          "Este sitio dice observados, nunca jugadores. Un personaje está observado desde que ha aparecido en el leaderboard que leemos, o desde que alguien lo ha buscado aquí. Todos los demás quedan fuera de cada recuento de esta página, y cuántos son no se puede saber: Blizzard no publica el tamaño de la población.",
          "El leaderboard publica 5.000 personajes por especialización y modalidad. Dónde cae ese corte se mueve con la temporada: en una madura, las especializaciones más jugadas llenan sus 5.000 plazas muy por encima de los ratings bajos, y los personajes de debajo no entran nunca por la vía de la clasificación. De ahí el buscador: un personaje consultado aquí se suma a la población observada.",
          "Consultar a alguien, eso sí, no mueve los porcentajes. Las observaciones que llegan por búsqueda se guardan y se cuentan aparte, fuera de los agregados, de modo que una especialización no puede parecer más común solo porque quien lee sobre ella haya ido a buscarla.",
          `La posición dentro de una especialización es un recuento y no una estimación: cuántos personajes observados de esa especialización quedan por debajo de un rating, sobre cuántos se observaron en total. El percentil es una etiqueta encima de esa fracción, y solo aparece cuando la modalidad llega a ${t.medium} personajes observados. Por debajo sale la fracción sola.`,
        ],
      },

      segments: {
        heading: "Cómo se forman los tramos",
        paragraphs: [
          `Los ratings se agrupan en tramos de ${t.segmentSize} puntos: 1600-1800, 1800-2000, y así hasta un tramo abierto arriba del todo. Un tramo incluye su límite inferior y excluye el superior, así que un rating de 2000 exacto pertenece a 2000-2200 y no a 1800-2000.`,
          "La comparación va siempre contra el tramo inmediatamente superior, nunca contra la cima de la clasificación. Cuando ese tramo no se puede describir —y muchas veces no se puede—, la comparación no se desvía en silencio hacia otro tramo más alto que casualmente esté mejor cubierto.",
          "Quien está en el tramo abierto de arriba no tiene escalón por encima, y la página lo dice en vez de compararlo consigo mismo.",
        ],
      },

      confidence: {
        heading: "Qué significa la confianza",
        paragraphs: [
          `Tres niveles, y los tres son recuentos antes que juicios. Alta: ${t.high} perfiles o más detrás de la cifra. Media: al menos ${t.medium}. Por debajo de ${t.medium} no se enseña ninguna comparación, y en su lugar la página explica qué pieza falta.`,
          "El recuento que decide esto es el de esa cifra concreta, no el tamaño del segmento. Un tramo puede tener miles de personajes y no tener equipo legible en ninguno de ellos: población no es base de comparación, y las dos cosas se cuentan aparte.",
          "El umbral no se baja por llenar una pantalla vacía. Una comparación sacada de doce perfiles describe a doce personas, y decirlo en voz alta es la razón de ser de esta página.",
        ],
      },

      numbers: {
        heading: "Cómo se forma un porcentaje",
        paragraphs: [
          "Cada porcentaje viaja con la fracción de la que sale: 74 % (89/120), nunca un 74 % a secas. La fracción es la cifra que aguanta el peso; el porcentaje va al lado porque se lee más rápido.",
          "Ausente no es cero. Cuando un perfil no devuelve equipo legible, o no devuelve talentos, ese perfil sale del denominador de esa cifra y al lado se declara cuántos salieron. Contarlo como «no lo usa» sería inventarse una respuesta que nadie dio.",
          "Cifras distintas se apoyan en denominadores distintos, y no son intercambiables: el equipo, los nodos de talento y los talentos PvP se leen de partes distintas del mismo perfil, y uno puede faltar mientras los otros están.",
          `Las diferencias de menos de ${t.deltaPoints} puntos porcentuales no se listan. Con estas muestras una diferencia así no se distingue del ruido del muestreo, de modo que una lista corta es un resultado y no un hueco de maquetación.`,
        ],
      },

      correlation: {
        heading: "Correlación, no consejo",
        paragraphs: [
          "Lo que este sitio cuenta es qué lleva y qué juega el tramo de arriba, y cuántos de ellos lo hacen. No cuenta qué hace subir a nadie, porque el dato no responde a eso: aquí nada compara a un jugador consigo mismo antes y después de una decisión, y en una clasificación caben motivos que ningún perfil registra.",
          "De ahí que la redacción sea descriptiva a propósito. «El 74 % de 2000-2200 lleva esto» es algo que se ha contado. «Llévalo y subirás» sería algo inventado, y en cuanto una página lo dice, cada número de alrededor se convierte en una afirmación que no puede sostener.",
          "La misma regla vale en el otro sentido: cuando una comparación no se puede enseñar, la página nombra el recuento que falta en vez de rellenar el hueco con algo más flojo.",
        ],
      },
    },

    updated: (date: string) => `Última revisión: ${date}.`,
  };
}
