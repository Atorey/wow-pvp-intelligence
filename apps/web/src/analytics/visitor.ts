/**
 * El identificador con el que se cuenta "usuario único activo semanal" (§35).
 *
 * Es de primera parte, anónimo y caduca. No es una cuenta —el producto no
 * tiene—, no es una cookie —no viaja en ninguna cabecera ni se manda a un
 * tercero— y no se cruza con nada: existe para que la palabra "único" de la
 * métrica sea contable, y para nada más (ADR 0028).
 *
 * Que caduque no es higiene decorativa: un identificador perpetuo convierte una
 * medición agregada en un registro de navegación de años, que es justo lo que
 * la política de privacidad promete que no hay.
 *
 * Lo puro está separado de lo que toca el navegador, como en `recent-searches`:
 * `parseVisitor` y `freshVisitor` son funciones y `visitorId` es la única que
 * sabe que existe `localStorage`.
 */

const KEY = "one-rung:visitor";

/**
 * Noventa días. La ventana de la North Star es de una semana y la de las
 * métricas secundarias de §35 —retención D30— es de un mes: tres meses cubren
 * la más larga con margen y no dejan un identificador vivo más allá de lo que
 * ninguna métrica pregunta.
 */
export const VISITOR_TTL_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

interface Visitor {
  readonly id: string;
  /** Milisegundos epoch en los que este identificador deja de valer. */
  readonly expiresAt: number;
}

function isVisitor(value: unknown): value is Visitor {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry["id"] === "string" && typeof entry["expiresAt"] === "number";
}

/**
 * Lo guardado, si sigue vigente. Devuelve `null` tanto para lo que no reconoce
 * como para lo caducado: las dos cosas se resuelven igual, generando otro.
 */
export function parseVisitor(raw: string | null, now: number): Visitor | null {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isVisitor(parsed)) return null;
  return parsed.expiresAt > now ? parsed : null;
}

export function freshVisitor(id: string, now: number): Visitor {
  return { id, expiresAt: now + VISITOR_TTL_DAYS * DAY_MS };
}

/**
 * El identificador de este navegador, creándolo si hace falta.
 *
 * Devuelve `null` cuando no hay dónde guardarlo —ventana privada,
 * almacenamiento bloqueado, cuota llena—, y entonces el evento no se emite: la
 * medición del Player Gap no puede romper el Player Gap. Se pierde una fila y
 * no se pierde nada más.
 */
export function visitorId(): string | null {
  try {
    const now = Date.now();
    const stored = parseVisitor(window.localStorage.getItem(KEY), now);
    if (stored) return stored.id;

    const created = freshVisitor(crypto.randomUUID(), now);
    window.localStorage.setItem(KEY, JSON.stringify(created));
    return created.id;
  } catch {
    return null;
  }
}
