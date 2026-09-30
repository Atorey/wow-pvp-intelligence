import type pg from "pg";
import {
  BlizzardClient,
  blizzardUsage,
  eraseCharacters,
  formatUsage,
  type BlizzardResponse,
  type ErasureReason,
} from "@wowpvp/blizzard";
import { getRegion, getRevalidationBudget } from "../config";
import {
  DATA_TTL_DAYS,
  MISSING_CONFIRM_HOURS,
  MS_PER_DAY,
  MS_PER_HOUR,
  REVALIDATE_AFTER_DAYS,
} from "../data-ttl";
import { createPool } from "../db/pool";

/**
 * El barrido de la revalidación de 30 días (ADR 0015, decisión 2; ADR 0043).
 *
 * Quien sale en una publicación del leaderboard queda revalidado por ese mismo
 * hecho, igual que quien acaba de devolver su perfil. Esto es para los demás:
 * los que entraron por búsqueda, los que cayeron de la lista y los de una
 * temporada cerrada. Cada uno cuesta una petición al endpoint de estado, que
 * existe justo para esto:
 *
 * - **200 con `is_valid` y el mismo id**: existe. Cuenta como prueba.
 * - **200 con `is_valid: false`**, o **con otro id**: no es el que teníamos.
 *   Blizzard pide borrarlo, y se borra.
 * - **404**: no existe con ese nombre. Un renombre o una transferencia también
 *   dan 404 al nombre viejo, y eso también es un borrado: el id sigue vivo,
 *   pero la identidad que guardamos ya no apunta a nadie (ADR 0017). Si el
 *   leaderboard le vio con su nombre nuevo antes, la ingesta ya había movido la
 *   fila y este barrido ni lo pregunta.
 * - **Cualquier otra cosa** es «no se pudo mirar», que no es «no existe»: no
 *   cuenta como prueba ni como ausencia, y se vuelve a preguntar mañana.
 *
 * Un 404 **no borra a la primera**: se anota en `missing_since` y se confirma en
 * la corrida siguiente. Un borrado no tiene vuelta atrás —si el personaje sigue
 * existiendo, vuelve como otra persona sin histórico—, y un 404 suelto puede ser
 * de Blizzard y no del personaje.
 */

export interface Options {
  /** Techo de peticiones de la corrida: una por personaje. */
  budget: number;
  /** Cuenta los pendientes y no pregunta nada. */
  dryRun: boolean;
}

export function parseOptions(args: string[], defaultBudget: number): Options {
  const options: Options = { budget: defaultBudget, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--budget") {
      const raw = args[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--budget pide un entero positivo, no ${raw}.`);
      }
      options.budget = value;
      continue;
    }
    throw new Error(`Opción desconocida: ${flag}. Disponibles: --budget, --dry-run.`);
  }
  return options;
}

/** Lo que devuelve `/profile/wow/character/{realm}/{name}/status`. */
export interface CharacterStatusResponse {
  id?: number;
  is_valid?: boolean;
}

export type Verdict =
  | { kind: "exists"; blizzardId: number | null }
  | { kind: "missing" }
  | { kind: "gone"; reason: Exclude<ErasureReason, "not-found"> }
  | { kind: "unknown"; detail: string };

/**
 * Qué dice una respuesta del endpoint de estado de un personaje del que
 * teníamos `storedId`.
 *
 * Solo `is_valid: true` es prueba de existencia. Una respuesta 200 que no lo
 * trae no es un sí: la regla 5 vale también aquí, y lo que no se sabe no se
 * redondea hacia ningún lado.
 */
export function statusVerdict(
  response: BlizzardResponse<CharacterStatusResponse>,
  storedId: number | null,
): Verdict {
  if (response.ok && response.data) {
    const { id, is_valid: isValid } = response.data;
    if (isValid === false) return { kind: "gone", reason: "invalid" };
    if (typeof id === "number" && storedId !== null && id !== storedId) {
      return { kind: "gone", reason: "id-changed" };
    }
    if (isValid === true) return { kind: "exists", blizzardId: typeof id === "number" ? id : null };
    return { kind: "unknown", detail: "respuesta sin is_valid" };
  }
  // Un 404 es de Blizzard. Que no hubiera cuota o tiempo para preguntar es
  // nuestro, y llega con status 0.
  if (response.status === 404 && !response.unavailable) return { kind: "missing" };
  return { kind: "unknown", detail: response.unavailable ?? `HTTP ${response.status}` };
}

export type Action =
  | { kind: "verify"; blizzardId: number | null }
  | { kind: "strike" }
  | { kind: "erase"; reason: ErasureReason }
  | { kind: "none" };

/**
 * Qué se hace con un veredicto, sabiendo si ya había un 404 anotado.
 *
 * El segundo 404 solo confirma si llega con `MISSING_CONFIRM_HOURS` de
 * distancia: dos seguidos en la misma caída de Blizzard no son dos pruebas.
 */
export function actionFor(verdict: Verdict, missingSince: Date | null, now: Date): Action {
  switch (verdict.kind) {
    case "exists":
      return { kind: "verify", blizzardId: verdict.blizzardId };
    case "gone":
      return { kind: "erase", reason: verdict.reason };
    case "missing":
      if (missingSince === null) return { kind: "strike" };
      return now.getTime() - missingSince.getTime() >= MISSING_CONFIRM_HOURS * MS_PER_HOUR
        ? { kind: "erase", reason: "not-found" }
        : { kind: "none" };
    case "unknown":
      return { kind: "none" };
  }
}

/** La ruta del endpoint de estado. El nombre ya es el canónico de Blizzard (ADR 0017). */
export function statusPath(realmSlug: string, nameSlug: string): string {
  return (
    `/profile/wow/character/${encodeURIComponent(realmSlug)}/` +
    `${encodeURIComponent(nameSlug)}/status`
  );
}

interface Candidate {
  id: string;
  realm_slug: string;
  name_slug: string;
  /** `bigint` llega de `pg` como texto. */
  blizzard_character_id: string | null;
  missing_since: Date | null;
}

export interface RevalidationReport {
  /** Sin prueba de existencia en `REVALIDATE_AFTER_DAYS` días, antes de empezar. */
  due: number;
  /** De ellos, los que ya pasan del plazo de la ToU. */
  overdue: number;
  checked: number;
  verified: number;
  strikes: number;
  erased: Record<ErasureReason, number>;
  unknown: number;
  /** Los motivos de los «no se pudo mirar», contados. */
  unknownDetails: Map<string, number>;
}

/**
 * Peticiones en vuelo a la vez. La cola espacia de verdad (ADR 0005); esto solo
 * evita esperar cada respuesta antes de pedir la siguiente, que es lo que dejó
 * el ritmo de perfiles en una cuarta parte del techo.
 */
const CONCURRENCY = 16;

const MISSING_CONFIRM_MS = MISSING_CONFIRM_HOURS * MS_PER_HOUR;

export async function revalidateCharacters(args: string[] = []): Promise<void> {
  const options = parseOptions(args, getRevalidationBudget());
  const region = getRegion();
  const pool = createPool();

  try {
    const report = await revalidate(pool, region, options, new Date());
    printReport(report, options);
    if (!options.dryRun) console.log(`\nCuota: ${formatUsage(blizzardUsage())}`);
  } finally {
    await pool.end();
  }
}

export async function revalidate(
  pool: pg.Pool,
  region: string,
  options: Options,
  now: Date,
): Promise<RevalidationReport> {
  const threshold = new Date(now.getTime() - REVALIDATE_AFTER_DAYS * MS_PER_DAY);
  const ttl = new Date(now.getTime() - DATA_TTL_DAYS * MS_PER_DAY);

  const { rows: counts } = await pool.query<{ due: string; overdue: string }>(
    `select count(*) filter (where verified_at < $2) as due,
            count(*) filter (where verified_at < $3) as overdue
       from characters where region = $1`,
    [region, threshold, ttl],
  );
  const report: RevalidationReport = {
    due: Number(counts[0]?.due ?? 0),
    overdue: Number(counts[0]?.overdue ?? 0),
    checked: 0,
    verified: 0,
    strikes: 0,
    erased: { "not-found": 0, invalid: 0, "id-changed": 0 },
    unknown: 0,
    unknownDetails: new Map(),
  };
  if (options.dryRun) return report;

  // Los más viejos primero: si el presupuesto no alcanza, que se quede fuera
  // quien más margen tiene hasta el plazo. Y fuera quien tenga un 404 de hace
  // menos de `MISSING_CONFIRM_HOURS`, que no se puede confirmar todavía.
  const { rows: candidates } = await pool.query<Candidate>(
    `select id, realm_slug, name_slug, blizzard_character_id, missing_since
       from characters
      where region = $1
        and verified_at < $2
        and (missing_since is null or missing_since < $3)
      order by verified_at, id
      limit $4`,
    [region, threshold, new Date(now.getTime() - MISSING_CONFIRM_MS), options.budget],
  );
  if (candidates.length === 0) return report;

  const client = new BlizzardClient({ priority: "batch", db: pool });
  for (let start = 0; start < candidates.length; start += CONCURRENCY) {
    const chunk = candidates.slice(start, start + CONCURRENCY);
    const responses = await Promise.all(
      chunk.map((candidate) =>
        client.tryGet<CharacterStatusResponse>(
          statusPath(candidate.realm_slug, candidate.name_slug),
          "profile",
        ),
      ),
    );
    const askedAt = new Date();
    const actions = chunk.map((candidate, index) => {
      const response = responses[index] as BlizzardResponse<CharacterStatusResponse>;
      const verdict = statusVerdict(response, storedId(candidate));
      if (verdict.kind === "unknown") {
        report.unknownDetails.set(
          verdict.detail,
          (report.unknownDetails.get(verdict.detail) ?? 0) + 1,
        );
      }
      return { candidate, action: actionFor(verdict, candidate.missing_since, askedAt) };
    });
    await apply(pool, actions, askedAt, threshold, report);
    report.checked += chunk.length;
    if (report.checked % 2_000 < CONCURRENCY) {
      console.log(`  ${fmt(report.checked)}/${fmt(candidates.length)}`);
    }
  }

  return report;
}

function storedId(candidate: Candidate): number | null {
  return candidate.blizzard_character_id === null ? null : Number(candidate.blizzard_character_id);
}

/**
 * Escribe lo que ha dicho Blizzard de un grupo de personajes.
 *
 * Tanto el 404 anotado como el borrado exigen que el personaje siga sin prueba
 * desde `threshold`: la ingesta del leaderboard pudo verle mientras se esperaba
 * la respuesta, y entonces el 404 era de un nombre que ya no es el suyo.
 */
async function apply(
  pool: pg.Pool,
  actions: readonly { candidate: Candidate; action: Action }[],
  askedAt: Date,
  threshold: Date,
  report: RevalidationReport,
): Promise<void> {
  const verified = actions.filter(({ action }) => action.kind === "verify");
  const strikes = actions.filter(({ action }) => action.kind === "strike");
  report.unknown += actions.filter(({ action }) => action.kind === "none").length;

  if (verified.length > 0) {
    await pool.query(
      `update characters
          set verified_at = greatest(verified_at, $2::timestamptz), missing_since = null
        where id = any($1::uuid[])`,
      [verified.map(({ candidate }) => candidate.id), askedAt],
    );
    // El id se completa solo donde faltaba, y no si ya lo tiene otra fila: el
    // índice único lo impediría, y esa otra fila es un personaje con nombre
    // propio que no hay que tocar desde aquí.
    const learned = verified.flatMap(({ candidate, action }) =>
      action.kind === "verify" && action.blizzardId !== null && storedId(candidate) === null
        ? [{ id: candidate.id, blizzardId: action.blizzardId }]
        : [],
    );
    if (learned.length > 0) {
      await pool.query(
        `update characters c
            set blizzard_character_id = u.blizzard_character_id
           from unnest($1::uuid[], $2::bigint[]) as u(id, blizzard_character_id)
          where c.id = u.id
            and c.blizzard_character_id is null
            and not exists (select 1 from characters o
                             where o.region = c.region
                               and o.blizzard_character_id = u.blizzard_character_id)`,
        [learned.map((row) => row.id), learned.map((row) => row.blizzardId)],
      );
    }
    report.verified += verified.length;
  }

  if (strikes.length > 0) {
    const { rowCount } = await pool.query(
      `update characters set missing_since = $2
        where id = any($1::uuid[]) and missing_since is null and verified_at < $3`,
      [strikes.map(({ candidate }) => candidate.id), askedAt, threshold],
    );
    report.strikes += rowCount ?? 0;
  }

  const byReason = new Map<ErasureReason, string[]>();
  for (const { candidate, action } of actions) {
    if (action.kind !== "erase") continue;
    byReason.set(action.reason, [...(byReason.get(action.reason) ?? []), candidate.id]);
  }
  if (byReason.size === 0) return;

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const [reason, ids] of byReason) {
      const erased = await eraseCharacters(client, ids, reason, { verifiedBefore: threshold });
      report.erased[reason] += erased.length;
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const fmt = (value: number): string => value.toLocaleString("es-ES");

function printReport(report: RevalidationReport, options: Options): void {
  console.log(
    `${fmt(report.due)} personajes sin prueba de existencia en ${REVALIDATE_AFTER_DAYS} días; ` +
      `${fmt(report.overdue)} de ellos pasan de ${DATA_TTL_DAYS}.`,
  );
  if (options.dryRun) {
    console.log(
      `--dry-run: no se ha preguntado nada. Con --budget ${options.budget} se comprobarían ` +
        `${fmt(Math.min(report.due, options.budget))}.`,
    );
    return;
  }

  const erased = Object.values(report.erased).reduce((sum, n) => sum + n, 0);
  console.log(`\nComprobados: ${fmt(report.checked)}`);
  console.log(`  existen: ${fmt(report.verified)}`);
  console.log(`  primer 404, pendiente de confirmar: ${fmt(report.strikes)}`);
  console.log(
    `  borrados: ${fmt(erased)} (404 confirmado ${fmt(report.erased["not-found"])}, ` +
      `is_valid falso ${fmt(report.erased.invalid)}, otro id ${fmt(report.erased["id-changed"])})`,
  );
  console.log(`  no se pudo mirar: ${fmt(report.unknown)}`);
  for (const [detail, n] of report.unknownDetails) console.log(`    ${detail}: ${fmt(n)}`);

  const left = report.due - report.checked;
  if (left > 0) {
    console.log(
      `\nQuedan ${fmt(left)} sin comprobar por presupuesto; la corrida de mañana sigue por ` +
        `los más antiguos. check-freshness avisa si alguno pasa de ${DATA_TTL_DAYS} días.`,
    );
  }
  if (erased > 0) {
    console.log(
      "Lo archivado de los borrados sale de Storage con purge-archive, que corre detrás del archivado.",
    );
  }
}
