import type pg from "pg";
import { BlizzardClient, blizzardUsage } from "../blizzard/client";
import { formatUsage } from "../blizzard/request-queue";
import { getBlizzardCredentials, getDatabaseUrl } from "../config";
import { createPool } from "../db/pool";

/**
 * Resolución del icono de cada item observado (#67, ADR 0022).
 *
 * Rellena el catálogo `item_media` preguntando a la Media API por los `item_id`
 * que aparecen en el gear equipado y en sus gemas. Es un job y no una lectura
 * bajo demanda desde la web por dos razones que se refuerzan: la regla 4 —toda
 * llamada a Blizzard pasa por `BlizzardClient`, que solo vive aquí— y el ADR
 * 0013, que deja a la web sin cuota propia.
 *
 * Tres cosas que gobiernan lo que hace:
 *
 * - **Solo se guarda la URL, nunca el archivo** (ADR 0015, decisión 7). Este
 *   job no descarga ningún icono; pregunta dónde está y lo apunta.
 * - **Preguntado y sin icono se recuerda.** Un 404 escribe la fila con
 *   `icon_url = null` en vez de dejarla sin escribir. Es la diferencia entre
 *   gastar una petición por item irresoluble cada 30 días y gastarla en cada
 *   corrida, que con un catálogo de miles de items es media corrida tirada.
 * - **Un fallo transitorio no se recuerda.** Un 500 o una caída de red no
 *   escriben nada y el item vuelve a estar pendiente en la corrida siguiente.
 *   Apuntarlo como "sin icono" convertiría un problema de un minuto en un hueco
 *   de treinta días.
 *
 * Los encantamientos quedan fuera, y no por descuido: el 86% de los observados
 * solo trae `enchantment_id`, para el que la Game Data API no publica ninguna
 * ruta de media (ADR 0022, decisión 5).
 */

const MS_PER_DAY = 86_400_000;

/**
 * Días que vale una fila del catálogo antes de volver a preguntar.
 *
 * No sale de que el icono cambie —no cambia—, sino de la cláusula 2.s de la
 * ToU, que obliga a refrescar todo Data cada 30 días sin excluir lo estático
 * (ADR 0022, decisión 3).
 */
export const ITEM_MEDIA_TTL_DAYS = 30;

/**
 * Techo por defecto de una corrida.
 *
 * Es una constante y no una variable de entorno como `PROFILE_REFRESH_BUDGET`
 * porque el trabajo va en dirección contraria: el de perfiles crece con la
 * población de la ladder y hay que poder apretarlo desde el despliegue; este se
 * vacía solo. La primera corrida paga el catálogo entero y a partir de ahí solo
 * quedan los items nuevos de cada parche y la revalidación repartida en 30 días.
 */
const DEFAULT_BUDGET = 3_000;

/** Cada cuántos items resueltos se imprime progreso. */
const PROGRESS_EVERY = 100;

// --- Argumentos ---

export interface Options {
  /** Techo de peticiones de la corrida. Una petición = un item. */
  budget: number;
  /** Días tras los que una fila ya resuelta se vuelve a preguntar. */
  ttlDays: number;
  /** Cuenta lo pendiente e imprime, sin llamar a Blizzard ni escribir. */
  dryRun: boolean;
}

export function parseOptions(args: string[], defaultBudget: number = DEFAULT_BUDGET): Options {
  const options: Options = { budget: defaultBudget, ttlDays: ITEM_MEDIA_TTL_DAYS, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const value = args[++i];
    switch (flag) {
      case "--budget": {
        const parsed = Number(value);
        if (!value || !Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(
            `--budget="${value ?? ""}" debe ser un número de peticiones mayor que 0.`,
          );
        }
        options.budget = parsed;
        break;
      }
      case "--ttl": {
        const parsed = Number(value);
        // 0 es válido y significa "revalida todo": es cómo se fuerza una
        // repasada completa si Blizzard mueve el CDN, sin tocar el código.
        if (!value || !Number.isInteger(parsed) || parsed < 0) {
          throw new Error(`--ttl="${value ?? ""}" debe ser un número de días mayor o igual que 0.`);
        }
        options.ttlDays = parsed;
        break;
      }
      default:
        throw new Error(`Opción desconocida: ${flag}. Disponibles: --budget, --ttl, --dry-run.`);
    }
  }

  return options;
}

// --- Respuesta de Blizzard ---

/** `/data/wow/media/item/{id}`, parcial: solo lo que consumimos. */
export interface ItemMediaResponse {
  assets?: { key?: string; value?: string }[];
}

/**
 * La URL del icono dentro de la respuesta, o null si no hay ninguna.
 *
 * La respuesta trae una lista de assets con clave, y solo el de clave `icon` es
 * el cuadrado que pinta la fila de gear. Coger `assets[0]` funcionaría hoy y
 * fallaría el día que Blizzard añada un asset por delante.
 */
export function iconFrom(media: ItemMediaResponse | null): string | null {
  const icon = media?.assets?.find((asset) => asset.key === "icon");
  return icon?.value ?? null;
}

// --- Qué está pendiente ---

/** Un item por resolver, con la razón por la que lo está. */
export interface PendingItem {
  itemId: number;
  /** true = nunca se ha preguntado; false = tenía fila y ha caducado. */
  isNew: boolean;
}

interface PendingRow {
  item_id: string;
  is_new: boolean;
}

/**
 * Los items observados que hoy no tienen icono utilizable, en el orden en que
 * conviene gastarse el presupuesto.
 *
 * Los nunca preguntados van primero: con el presupuesto justo, un item que
 * ninguna página puede pintar vale más que revalidar uno cuya URL sigue
 * funcionando. La revalidación es una obligación con plazo de 30 días, no una
 * urgencia del día.
 *
 * Gemas e items de equipo salen de la misma consulta porque son la misma cosa
 * —una gema es un item, con su `item_id` y su icono— y comparten catálogo.
 */
export async function loadPending(
  pool: pg.Pool,
  cutoff: Date,
  limit: number,
): Promise<PendingItem[]> {
  const { rows } = await pool.query<PendingRow>(
    `with used as (
       select item_id from character_snapshot_gear
       union
       select gem::bigint from character_snapshot_gear, unnest(gem_item_ids) as gem
     )
     select u.item_id, (m.item_id is null) as is_new
       from used u
       left join item_media m on m.item_id = u.item_id
      where m.item_id is null or m.resolved_at < $1
      order by is_new desc, u.item_id
      limit $2`,
    [cutoff.toISOString(), limit],
  );

  return rows.map((row) => ({ itemId: Number(row.item_id), isNew: row.is_new }));
}

/** Cuántos items hay pendientes en total, se vayan a resolver o no en esta corrida. */
export async function countPending(pool: pg.Pool, cutoff: Date): Promise<number> {
  const { rows } = await pool.query<{ pending: string }>(
    `with used as (
       select item_id from character_snapshot_gear
       union
       select gem::bigint from character_snapshot_gear, unnest(gem_item_ids) as gem
     )
     select count(*) as pending
       from used u
       left join item_media m on m.item_id = u.item_id
      where m.item_id is null or m.resolved_at < $1`,
    [cutoff.toISOString()],
  );

  return Number(rows[0]?.pending ?? 0);
}

// --- Escritura ---

/**
 * Lo mínimo que hace falta para escribir el catálogo: mandar una consulta con
 * parámetros. Un `pg.Pool` lo cumple, y un doble de test también — que es la
 * razón de que el tipo sea este y no `pg.Pool`, cuyas seis sobrecargas no se
 * pueden implementar de mentira sin arrastrar medio driver.
 */
export interface CatalogWriter {
  query(text: string, values: unknown[]): Promise<unknown>;
}

/**
 * Guarda lo resuelto. El `update` del conflicto es deliberado: el catálogo no
 * es append-only, y revalidar significa exactamente pisar la fila anterior con
 * la respuesta de hoy (ADR 0022, decisión 2).
 */
export async function saveResolved(
  db: CatalogWriter,
  itemId: number,
  iconUrl: string | null,
  resolvedAt: Date,
): Promise<void> {
  await db.query(
    `insert into item_media (item_id, icon_url, resolved_at)
     values ($1, $2, $3)
     on conflict (item_id) do update
        set icon_url = excluded.icon_url, resolved_at = excluded.resolved_at`,
    [itemId, iconUrl, resolvedAt.toISOString()],
  );
}

// --- Corrida ---

export interface RunReport {
  withIcon: number;
  withoutIcon: number;
  /** Fallos transitorios: no se han escrito y vuelven a estar pendientes. */
  errors: number;
}

/**
 * Resuelve una tanda de items.
 *
 * Separado del job para poder probarlo con un cliente y una base falsos: aquí
 * vive la única regla de negocio real —qué respuesta se recuerda y cuál no— y
 * comprobarla no debería exigir ni la API ni Postgres.
 */
export async function resolveItems(
  client: Pick<BlizzardClient, "tryGet">,
  db: CatalogWriter,
  pending: readonly PendingItem[],
  resolvedAt: Date,
  onProgress?: (done: number) => void,
): Promise<RunReport> {
  const report: RunReport = { withIcon: 0, withoutIcon: 0, errors: 0 };

  for (const [index, item] of pending.entries()) {
    const res = await client.tryGet<ItemMediaResponse>(
      `/data/wow/media/item/${item.itemId}`,
      "static",
    );

    if (res.ok) {
      const iconUrl = iconFrom(res.data);
      await saveResolved(db, item.itemId, iconUrl, resolvedAt);
      if (iconUrl === null) report.withoutIcon++;
      else report.withIcon++;
    } else if (res.status === 404) {
      // El item ya no está en la API o no publica media. Es una respuesta, no
      // un fallo: se recuerda para no volver a preguntar hasta que caduque.
      await saveResolved(db, item.itemId, null, resolvedAt);
      report.withoutIcon++;
    } else {
      report.errors++;
    }

    if (onProgress && (index + 1) % PROGRESS_EVERY === 0) onProgress(index + 1);
  }

  return report;
}

// --- Job ---

export async function resolveItemMedia(args: string[] = []): Promise<void> {
  const options = parseOptions(args);
  const now = new Date();
  const cutoff = new Date(now.getTime() - options.ttlDays * MS_PER_DAY);

  if (!options.dryRun) getBlizzardCredentials();
  getDatabaseUrl();

  console.log("Catálogo de iconos de item (#67, ADR 0022)\n");
  console.log(`TTL ${options.ttlDays}d · presupuesto ${options.budget} peticiones (1 por item).\n`);

  const pool = createPool();
  try {
    const total = await countPending(pool, cutoff);
    if (total === 0) {
      console.log("Catálogo al día: ningún item observado sin icono resuelto.");
      return;
    }

    const pending = await loadPending(pool, cutoff, options.budget);
    const nuevos = pending.filter((item) => item.isNew).length;

    console.log(
      `${total} item(s) pendiente(s); esta corrida resuelve ${pending.length} ` +
        `(${nuevos} sin preguntar nunca, ${pending.length - nuevos} por revalidar).`,
    );
    if (total > pending.length) {
      console.log(
        `Quedan ${total - pending.length} para la próxima corrida, o antes con --budget.`,
      );
    }

    if (options.dryRun) {
      console.log("\n--dry-run: no se ha llamado a Blizzard ni se ha escrito nada.");
      return;
    }

    // La prioridad más baja de §28: nadie espera delante de un icono, y la
    // búsqueda de un usuario tiene que pasarle por delante siempre.
    const client = new BlizzardClient({ priority: "aggregate" });
    const report = await resolveItems(client, pool, pending, now, (done) =>
      console.log(`  ${done}/${pending.length}`),
    );

    console.log(
      `\n${report.withIcon} con icono · ${report.withoutIcon} sin icono disponible · ` +
        `${report.errors} con error (vuelven a estar pendientes).`,
    );
    console.log(`Cuota: ${formatUsage(blizzardUsage())}`);
  } finally {
    await pool.end();
  }
}
