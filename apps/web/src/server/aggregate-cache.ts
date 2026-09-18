import { aggregateCacheUntil, type Region } from "@wowpvp/core";
import {
  readActiveCharacters,
  readAdoptionFor,
  readBracketSegments,
  readRunPopulation,
  readSegmentSamples,
  type ActiveCharactersRead,
  type AdoptionRead,
  type Queryable,
  type RunPopulationRead,
  type SegmentRead,
  type SegmentSampleRead,
  type VariableKind,
} from "@wowpvp/data";

/**
 * Las lecturas de agregado, recordadas mientras la corrida que las produjo siga
 * siendo la última (ADR 0031).
 *
 * De las diez consultas que cuesta un perfil, tres no son del personaje sino del
 * escalón: los segmentos del bracket y las dos adopciones. Son idénticas para
 * todo el que mire esa spec, y cambian **una vez al día**, cuando
 * `refresh-aggregates` escribe un `computed_at` nuevo (ADR 0007). Volver a
 * pedirlas en cada visita es pagar el pooler por una respuesta que ya sabemos.
 *
 * **La vigencia sale de `computed_at`, no de una TTL elegida a ojo**: cada
 * entrada vive lo que decide `aggregateCacheUntil()` sobre la corrida de la que
 * salió. Si un día se cambia la cadencia, esto la sigue sola.
 *
 * Vive aquí y no en `packages/data`, donde el ADR 0014 supuso que acabaría la
 * caché. Ese paquete lo comparten web y pipeline, y `refresh-aggregates` lee
 * agregados **para escribir los siguientes**: servirle una foto recordada sería
 * calcular la corrida de mañana sobre la de ayer. La web es la única de las dos
 * que solo lee.
 *
 * Y es memoria de proceso, no un caché distribuido: en serverless no sobrevive a
 * la instancia (ADR 0013), así que lo que ahorra es el tráfico de una instancia
 * caliente que sirve varias visitas seguidas. No es poco —es el caso normal— y
 * no promete más que eso.
 */

interface Entry<T> {
  /** Se guarda la promesa, no el valor: dos visitas simultáneas comparten la ida. */
  value: Promise<T>;
  /** Milisegundos absolutos. Se fija cuando se resuelve, con el `computed_at` real. */
  expiresAt: number;
}

/**
 * Techo de entradas por caché.
 *
 * Las claves son finitas —cuarenta specs por dos modalidades, y sus escalones—
 * pero una instancia muy caliente no tiene por qué acumularlas todas en memoria.
 * Al desbordar se tira la más antigua en entrar, que con claves de vida idéntica
 * es también la que menos le queda.
 */
const MAX_ENTRIES = 200;

class AggregateCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(private readonly computedAtOf: (value: T) => Date | null) {}

  /**
   * `knownComputedAt` es para quien ya sabe de qué corrida va a ser la
   * respuesta antes de tenerla. Sin él la fecha se saca del resultado, y eso
   * falla en un caso real: una variable que esa corrida **no calculó** vuelve
   * vacía y sin fecha, así que se quedaría fuera de la caché y se volvería a
   * pedir en cada visita para recibir el mismo vacío. Que una corrida no tenga
   * filas de una variable es un hecho suyo, tan estable como las que sí tiene.
   */
  async read(key: string, load: () => Promise<T>, knownComputedAt?: Date): Promise<T> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    // Pesimista hasta saber de qué corrida es: si la lectura falla, la entrada
    // ya está fuera y la siguiente visita vuelve a intentarlo en vez de heredar
    // una promesa rechazada.
    const value = load();
    const entry: Entry<T> = { value, expiresAt: 0 };
    this.entries.set(key, entry);
    this.evictOverflow();

    try {
      const resolved = await value;
      const computedAt = knownComputedAt ?? this.computedAtOf(resolved);
      // Sin fecha no hay nada que recordar: es un escalón que nunca se calculó,
      // y guardarlo un día entero taparía la primera corrida que lo llene.
      if (computedAt === null) {
        this.entries.delete(key);
        return resolved;
      }
      // `aggregateCacheUntil` y no la caducidad a secas: una corrida retrasada
      // ya nace vencida, y sin el suelo esta caché desaparecería justo el día
      // que el recálculo está caído (ADR 0031).
      entry.expiresAt = aggregateCacheUntil(computedAt, new Date()).getTime();
      return resolved;
    } catch (err) {
      this.entries.delete(key);
      throw err;
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}

/** Cualquier `Provenance` de la fila sirve: las seis traen el mismo `computed_at`. */
const segmentsCache = new AggregateCache<SegmentRead[]>(
  (segments) => segments[0]?.gear.computedAt ?? null,
);

export interface BracketKey {
  region: Region;
  seasonId: number;
  bracket: string;
}

/** Los escalones del bracket, de una sola corrida y recordados hasta la siguiente. */
export function cachedBracketSegments(db: Queryable, key: BracketKey): Promise<SegmentRead[]> {
  return segmentsCache.read(`${key.region}|${key.seasonId}|${key.bracket}`, () =>
    readBracketSegments(db, key),
  );
}

/**
 * Sin extractor: la fecha la pone siempre quien llama, que la tiene en los
 * escalones. Sin escalones no hay consulta que hacer, así que tampoco caché.
 */
const adoptionCache = new AggregateCache<Map<string, AdoptionRead[]>>(() => null);

/**
 * Las adopciones de un par de escalones, recordadas por los ids de sus filas.
 *
 * La clave es el `rowId`, que identifica **la fila de una corrida concreta**, no
 * el escalón. Eso hace que la invalidación sea automática y no haya que
 * escribirla: la corrida de mañana trae ids nuevos, así que pregunta por una
 * clave que no existe y las viejas caducan solas.
 */
export function cachedAdoptionFor(
  db: Queryable,
  segments: readonly SegmentRead[],
  kind: VariableKind | readonly VariableKind[],
): Promise<Map<string, AdoptionRead[]>> {
  const kinds = typeof kind === "string" ? kind : [...kind].join("+");
  const key = `${segments.map((segment) => segment.rowId).join(",")}|${kinds}`;
  // La fecha se toma de los escalones y no del resultado: los nodos de talento
  // todavía vuelven vacíos en muchos segmentos (ADR 0026), y sacarla del
  // resultado dejaría fuera de la caché justo esos.
  const computedAt = segments[0]?.gear.computedAt;
  return adoptionCache.read(key, () => readAdoptionFor(db, segments, kind), computedAt);
}

const runCache = new AggregateCache<RunPopulationRead | null>((run) => run?.computedAt ?? null);

/**
 * La población de todos los brackets de la última corrida de una región.
 *
 * La piden todas las páginas de spec —de ella salen la temporada y el puesto de
 * la spec en la modalidad— y es la misma para las cuarenta, así que es una sola
 * entrada por región que vive lo que viva su corrida.
 */
export function cachedRunPopulation(
  db: Queryable,
  region: Region,
): Promise<RunPopulationRead | null> {
  return runCache.read(region, () => readRunPopulation(db, { region }));
}

/** Sin extractor: la fecha es la de la corrida, y la trae quien llama. */
const activeCache = new AggregateCache<ActiveCharactersRead>(() => null);

/**
 * Cuánta gente distinta hay dentro de la ventana de actividad de la modalidad.
 *
 * La ventana se ancla al `computed_at` de la corrida y no al reloj de la
 * visita, y por eso la fecha entra en la clave. `refresh-aggregates` reconstruye
 * `character_activity` al empezar y escribe los escalones después, en la misma
 * corrida y con el mismo instante: contar los 7 días anteriores a esa fecha es
 * contar sobre la tabla tal y como quedó. Medirlos contra `Date.now()` daría una
 * cifra que se mueve sola entre dos visitas sin que haya entrado un dato nuevo,
 * y que no casaría con la fecha que la propia portada declara debajo.
 */
export function cachedActiveCharacters(
  db: Queryable,
  key: {
    region: Region;
    seasonId: number;
    brackets: readonly string[];
    /** La corrida sobre la que se cuenta: lo que fecha la respuesta y su vigencia. */
    computedAt: Date;
    /** Dónde empieza la ventana, ya resuelta por `activityWindowStart()`. */
    since: Date;
  },
): Promise<ActiveCharactersRead> {
  return activeCache.read(
    // La fecha de la corrida entra en la clave: la de mañana pregunta por una
    // clave que no existe y la de hoy caduca sola, sin invalidación escrita.
    `${key.region}|${key.seasonId}|${key.computedAt.getTime()}`,
    () => readActiveCharacters(db, key),
    key.computedAt,
  );
}

const samplesCache = new AggregateCache<SegmentSampleRead[]>(
  (samples) => samples[0]?.gear.computedAt ?? null,
);

/**
 * Las bases de comparación de todos los escalones, para decidir qué se indexa.
 *
 * La lee el sitemap, que es la única página que se recorre entera de una vez y
 * a la que llama un rastreador tantas veces como quiera. Su respuesta cambia
 * cuando cambia una corrida y no cuando pasa un rastreador, así que recordarla
 * hasta la corrida siguiente es exactamente su vigencia.
 *
 * No hay clave: es una sola consulta sin parámetros.
 */
export function cachedSegmentSamples(db: Queryable): Promise<SegmentSampleRead[]> {
  return samplesCache.read("all", () => readSegmentSamples(db));
}
