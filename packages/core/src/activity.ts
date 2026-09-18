/**
 * Ventana de actividad: quién cuenta como "activo" (docs/product-plan.md §27, #16).
 *
 * §27 lo pide en una línea y con una consecuencia grande: "todo cálculo de
 * AggregateSnapshot filtra por `last_active_snapshot_date` dentro de una
 * ventana", porque un personaje que llegó a 2400 hace ocho meses y no ha vuelto
 * a jugar no describe el meta de hoy. La API no tiene campo "last seen" (§30),
 * así que la actividad hay que **derivarla**: lo único que Blizzard mueve
 * cuando alguien juega es `season_match_statistics.played`.
 *
 * Aquí vive esa derivación, pura y en core, por el mismo motivo que el resto
 * del dominio: la web de Phase 2 tiene que decidir "activo" igual que el
 * pipeline. Si el filtro se relajara en una capa y no en la otra, el n que
 * sostiene la confianza declarada (ADR 0003) dejaría de significar lo mismo en
 * los dos sitios.
 *
 * Lo que este módulo NO decide: cuántos días dura la ventana (eso es
 * `ACTIVITY_WINDOWS` y `pickActivityWindow` en confidence.ts) ni de dónde salen
 * las observaciones.
 */
import type { ActivityWindowDays } from "./types";

const MS_PER_DAY = 86_400_000;

/**
 * De qué está hecha la fecha de actividad. Se transporta con el dato, no se
 * deduce después, porque las dos no valen lo mismo y quien las lea tiene que
 * poder separarlas:
 *
 * - `played-delta`: le hemos visto subir el contador de partidas entre dos
 *   observaciones nuestras. Es evidencia de que jugó, y sabemos cuándo.
 * - `first-seen`: nunca le hemos visto subir el contador, así que lo único
 *   demostrable es que en algún momento **antes** de que apareciera en nuestros
 *   datos jugó lo suficiente para estar en el ladder. Se fecha en la primera
 *   observación, que es la cota más antigua defendible.
 */
export type ActivityEvidence = "played-delta" | "first-seen";

/** Una observación nuestra del contador de partidas de un personaje en un bracket. */
export interface ActivityObservation {
  capturedAt: Date;
  /** null = "no disponible" (regla 5 del proyecto), nunca "no ha jugado". */
  matchesPlayed: number | null;
  /**
   * De dónde sale el contador. Dos contadores de origen distinto **no se
   * comparan entre sí**, y esto no es una precaución teórica: el perfil devuelve
   * un número sistemáticamente menor que el leaderboard para el mismo personaje,
   * bracket y rating (595 de 595 casos medidos en agosto de 2026). No cuentan lo
   * mismo, así que restarlos fabrica subidas y bajadas que nadie jugó.
   *
   * Core no sabe qué orígenes existen —eso es del pipeline—; solo que hay que
   * comparar cada uno consigo mismo.
   */
  counterSource: string;
}

/** La actividad derivada de toda la serie de observaciones de un personaje. */
export interface CharacterActivity {
  /** `last_active_snapshot_date` de §27: la fecha por la que se filtra. */
  lastActiveAt: Date;
  evidence: ActivityEvidence;
  /**
   * Contador de la observación más reciente que lo traía. Es un dato de
   * diagnóstico, no una cifra comparable entre personajes: puede venir de un
   * origen distinto al de otro personaje y no cuentan lo mismo.
   */
  lastPlayed: number | null;
  /** Cuántas observaciones sostienen esto: 1 nunca puede dar `played-delta`. */
  observations: number;
  firstSeenAt: Date;
  /**
   * Última vez que le vimos en el ladder. Es el proxy que usábamos antes de
   * #16; se conserva para poder medir la diferencia entre "le hemos visto" y
   * "ha jugado" en vez de tener que creérsela.
   */
  lastSeenAt: Date;
}

/**
 * Deriva la actividad de un personaje en un bracket y una temporada.
 *
 * La regla es un aumento **estricto** del contador de partidas **frente a la
 * observación anterior del mismo origen**: igual no es actividad (el
 * leaderboard republica lo mismo cada pocas horas aunque nadie juegue) y menos
 * tampoco. Una bajada dentro de un mismo origen no debería existir; si aparece,
 * se toma como que el contador se reinició y la serie arranca de nuevo desde
 * ahí — dar por bueno el valor viejo se tragaría las subidas siguientes hasta
 * recuperar el máximo anterior.
 *
 * Los huecos (`matchesPlayed === null`) no interrumpen la comparación: se
 * compara contra el último valor conocido, porque "no disponible" no es una
 * observación de que no jugó.
 *
 * Devuelve null si no hay observaciones: sin ninguna, un personaje no está
 * inactivo, es que no sabemos nada de él, y esas dos cosas no se escriben igual.
 */
export function deriveActivity(
  observations: readonly ActivityObservation[],
): CharacterActivity | null {
  if (observations.length === 0) return null;

  // Se ordena aquí en vez de exigirlo al llamante: el orden es parte de la
  // definición del delta, y un `order by` olvidado en una query daría
  // silenciosamente una fecha de actividad inventada.
  const series = [...observations].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  const first = series[0];
  const last = series[series.length - 1];
  // Inalcanzable con length > 0; el compilador no lo sabe (noUncheckedIndexedAccess).
  if (!first || !last) return null;

  // Un listón por origen: el delta solo tiene sentido contra el contador
  // anterior del mismo sitio (ver ActivityObservation.counterSource).
  const lastKnownBySource = new Map<string, number>();
  let lastKnownPlayed: number | null = null;
  let lastActiveAt: Date | null = null;

  for (const observation of series) {
    const played = observation.matchesPlayed;
    if (played === null) continue;
    const previous = lastKnownBySource.get(observation.counterSource);
    if (previous !== undefined && played > previous) lastActiveAt = observation.capturedAt;
    lastKnownBySource.set(observation.counterSource, played);
    lastKnownPlayed = played;
  }

  if (lastActiveAt !== null) {
    return {
      lastActiveAt,
      evidence: "played-delta",
      lastPlayed: lastKnownPlayed,
      observations: series.length,
      firstSeenAt: first.capturedAt,
      lastSeenAt: last.capturedAt,
    };
  }

  return {
    // La primera observación, no la última: fecharlo en la última sería volver
    // al proxy que #16 sustituye ("sigue saliendo en el leaderboard"), que nunca
    // caduca y por tanto nunca dejaría inactivo a nadie. Fechándolo en la
    // primera, quien no vuelve a dar señales sale solo de la ventana.
    lastActiveAt: first.capturedAt,
    evidence: "first-seen",
    lastPlayed: lastKnownPlayed,
    observations: series.length,
    firstSeenAt: first.capturedAt,
    lastSeenAt: last.capturedAt,
  };
}

/**
 * Dónde empieza la ventana: la fecha a partir de la cual una actividad cuenta.
 *
 * Existe porque el mismo recorte se aplica de dos formas que tienen que dar lo
 * mismo — fila a fila en memoria con `isActiveWithin()`, y de golpe en un
 * `where` de SQL, que necesita el límite como fecha y no como predicado. Con
 * dos restas escritas por separado, una ventana de 7 días abierta en `>=` y
 * otra en `>` son dos poblaciones distintas que nadie decidió que lo fueran.
 */
export function activityWindowStart(now: Date, days: ActivityWindowDays): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/**
 * Única puerta para decidir si una fecha de actividad cae dentro de la ventana.
 *
 * Aislada como `canShowComparison()`: nada de comparar milisegundos suelto por
 * ahí, porque entonces la ventana de la web y la del pipeline serían dos reglas
 * distintas que casualmente coinciden.
 */
export function isActiveWithin(
  activity: Pick<CharacterActivity, "lastActiveAt">,
  now: Date,
  days: ActivityWindowDays,
): boolean {
  return activity.lastActiveAt >= activityWindowStart(now, days);
}
