import type { Legal } from "./en";

export const es: Legal = {
  title: "Privacidad",
  lead: "Qué recoge este sitio, por qué, y cómo pedir que deje de hacerlo.",

  site: {
    heading: "Qué es este sitio",
    paragraphs: [
      "One Rung publica analítica de PvP de World of Warcraft, construida sobre datos que Blizzard hace públicos a través de sus Developer APIs. No hay cuentas, no hay inicio de sesión y no hay nada a lo que registrarse.",
      "One Rung no está afiliado a Blizzard Entertainment, Inc. ni cuenta con su respaldo ni con su patrocinio. Los datos vienen de las APIs de Blizzard y se muestran tal como llegan, sin garantía sobre su exactitud, su integridad ni su disponibilidad: se ofrecen «tal cual».",
    ],
  },

  character: {
    heading: "Datos de personaje",
    paragraphs: [
      "Guardamos lo que Blizzard publica de un personaje: nombre, reino, región, clase, especialización, rating, partidas jugadas, y el equipo y los talentos que enseña su perfil. De esas observaciones conservamos histórico, porque describir cómo cambia el dato con el tiempo es la razón de ser del sitio.",
      "No recogemos nada que ate un personaje a una persona. Ni cuenta de Battle.net, ni correo, ni identidad real, ni agrupación de varios personajes como si fueran del mismo jugador. La página de un personaje describe un personaje y ahí se acaba.",
      "La base legal es el interés legítimo: devolver a la comunidad que lo genera el dato público del juego, en forma agregada. Esta política se escribe como complemento de la política de privacidad de Blizzard, no como sustituta.",
      "Las condiciones de la API de Blizzard exigen refrescar el dato al menos cada treinta días. Lo hacemos comprobando que cada personaje sigue existiendo; la información de un personaje que ha dejado de existir se borra y deja de mostrarse.",
    ],
  },

  measurement: {
    heading: "Medición de uso",
    paragraphs: [
      "Guardamos una fila cada vez que se enseña la caja Player Gap, con cómo acabó: si pudimos mostrar la comparación y con qué nivel de confianza. Esa única cifra es la que nos dice si el sitio sirve de algo y si nuestra cobertura de datos da o no da.",
      "Esa fila lleva el desenlace, la especialización, la modalidad y el segmento de rating, el idioma y un identificador anónimo del navegador. No lleva tu dirección IP, ni el identificador de tu navegador, ni qué personaje estabas mirando. Quién lee la página de quién no es una métrica de producto.",
      "El identificador se genera en tu navegador, se guarda solo ahí, caduca a los noventa días y no se comparte con nadie. Existe únicamente por una razón: que las vistas de una semana se puedan contar como personas y no como cargas de página.",
      "Es medición propia y solo estadística agregada: nada sale de nuestros servidores, no hay publicidad, ni perfilado, ni seguimiento entre sitios, ni servicio de analítica de terceros. Por eso este sitio no tiene banner de cookies: no hay nada que consentir.",
      "La base legal es el interés legítimo. Si quieres eliminar el identificador, borra los datos de este sitio en tu navegador; en la siguiente visita se crea otro, y las filas antiguas ya no se pueden enlazar con él.",
    ],
  },

  abuse: {
    heading: "Mantener el sitio en pie",
    paragraphs: [
      "Cada personaje que consultamos por ti es una petición a Blizzard, contra un presupuesto que se comparte con todo lo demás que hace el sitio. Así que contamos cuántas peticiones llegan desde cada conexión, y cuando una se va muy por encima de lo que necesitaría una persona buscando, le pedimos que espere.",
      "Para contarlas hace falta distinguir conexiones, no saber de quién son. Lo que se guarda es una huella corta derivada de tu dirección IP con una clave secreta que solo tiene nuestro servidor. La dirección no se escribe nunca, ni en esa tabla ni en un registro, y de la huella no se puede recuperar.",
      "La huella no se cruza con nada: ni con la medición de arriba, ni con una página de personaje, ni con una búsqueda. Es un contador y nada más.",
      "La base legal es el interés legítimo — mantener el servicio disponible es el ejemplo que da el propio RGPD. El contador se rellena de forma continua, así que una huella deja de contar para nada a los pocos minutos de tu última petición.",
    ],
  },

  storage: {
    heading: "Qué se queda en tu navegador",
    paragraphs: [
      "Tres cosas, todas en almacenamiento local y ninguna de ellas una cookie: el tema que elegiste, tus últimas búsquedas y el identificador de medición del apartado anterior.",
      "Las dos primeras no salen nunca de tu navegador: no podemos leerlas. El único que viaja es el identificador, y solo unido a la medición descrita arriba. Los tres desaparecen si borras los datos de este sitio.",
    ],
  },

  thirdParties: {
    heading: "Terceros",
    paragraphs: [
      "En este sitio no hay servicio de analítica, ni red publicitaria, ni widget social. Las tipografías se sirven desde nuestro propio dominio y no desde un proveedor de fuentes.",
      "Hay una excepción, y conviene nombrarla: los iconos de item se cargan directamente desde los servidores de Blizzard, porque sus condiciones no nos permiten re-alojarlos. Cuando una página enseña el icono de un item, tu navegador le pide esa imagen a Blizzard, y esa petición se rige por la política de privacidad de Blizzard.",
      "El sitio se ejecuta en Netlify y su base de datos está alojada en Supabase. Los dos actúan como proveedores por cuenta nuestra y ninguno usa los datos con fines propios.",
    ],
  },

  rights: {
    heading: "Tus derechos",
    paragraphs: [
      "Puedes preguntarnos qué tenemos, pedir que lo rectifiquemos, pedir que lo suprimamos u oponerte al tratamiento. Eso incluye pedir que retiremos un personaje del conjunto de datos, lo que hacemos borrando su información y su histórico.",
      "También puedes presentar una reclamación ante tu autoridad de protección de datos.",
    ],
    contact: (address: string) => `Escribe a ${address}.`,
    contactPending:
      "La dirección a la que dirigir estas solicitudes todavía no está publicada, porque el sitio todavía no está abierto al público. Estará aquí antes de que lo esté.",
  },

  changes: {
    heading: "Cambios en esta política",
    paragraphs: [
      "Las condiciones de la API de Blizzard pueden cambiar sin aviso, y esta política depende de ellas. Cuando cambie, cambia con ella la fecha de abajo.",
    ],
    updated: (date: string) => `Última actualización: ${date}.`,
  },
};
