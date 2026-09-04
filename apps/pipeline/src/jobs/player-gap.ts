import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import {
  ACTIVITY_WINDOWS,
  computePlayerGap,
  foldSlug,
  formatCharacterRef,
  formatSegment,
  isActiveWithin,
  nextSegment,
  parseCharacterRef,
  pickActivityWindow,
  segmentFor,
  shuffleBracketId,
  type ActivityWindowDays,
  type AdoptionRate,
  type PlayerBuild,
  type CharacterRef,
  type PlayerGap,
  type RatingSegment,
  type SpecEntry,
} from "@wowpvp/core";
import { PROFILES_DIR, REPORTS_DIR } from "../config";
import { createPool } from "../db/pool";
import { takeSample } from "../sampling";
import { SPECS_TO_INGEST } from "../specs-to-ingest";

/**
 * Primer Player Gap real con datos completos (issue #9, §32 días 9-11).
 *
 * Este job no calcula nada: carga las dos poblaciones del run muestreado y
 * delega en @wowpvp/core, que es donde vive la fórmula (§13) para que la web de
 * Phase 2 use exactamente la misma. Aquí solo hay SQL y renderizado.
 *
 * Salida: un JSON auditable y un markdown legible por personaje, en reports/.
 * El markdown existe para el criterio de éxito del §32, que es cualitativo —
 * "¿un jugador experto de esta spec reconocería esto como razonable?" — y eso
 * se responde leyendo, no abriendo un JSON.
 */

/** Segmento de entrada de los sujetos por defecto: el único con escalón superior muestreado. */
const DEFAULT_SUBJECT_RATING = 1800;

/** Semilla de la elección de sujetos. Fija, para que el reporte sea reproducible. */
const SUBJECT_SEED = "player-gap";

const VALID_WINDOWS: readonly number[] = Object.values(ACTIVITY_WINDOWS);

interface Options {
  runId: string | null;
  /** El personaje pedido a mano; null = se eligen 3 sujetos. */
  character: CharacterRef | null;
  topDifferences: number;
  topTalentCodes: number;
  subjectRating: number;
  /** Ventana de actividad forzada. null = la elige §13.4 por segmento. */
  window: ActivityWindowDays | null;
  /**
   * Sin filtro de actividad. Existe para reproducir los reportes anteriores a
   * #16 —y para inspeccionar cuánta población se está descartando—, no para
   * ganar muestra: un agregado sin ventana describe a quien jugaba hace meses.
   */
  allActivity: boolean;
}

/** Lo que el reporte necesita de un personaje y que PlayerBuild no lleva (core es agnóstico). */
interface CharacterMeta {
  realmSlug: string;
  nameSlug: string;
  nameDisplay: string;
}

interface Population {
  /** Todas las builds del bracket en este run, sin segmentar. */
  builds: PlayerBuild[];
  meta: Map<string, CharacterMeta>;
  /** item_id → nombre legible. El nombre es para pintar; el id es la clave real. */
  itemNames: Map<number, string>;
  /**
   * character_id → `last_active_snapshot_date` (§27, #16). Ausente no significa
   * "inactivo" sino "no calculado", pero tampoco permite afirmar lo contrario:
   * `selectActive` lo deja fuera de la comparación por no ser demostrable.
   */
  activity: Map<string, Date>;
}

// --- Argumentos ---

function parseOptions(args: string[]): Options {
  const options: Options = {
    runId: null,
    character: null,
    topDifferences: 5,
    topTalentCodes: 3,
    subjectRating: DEFAULT_SUBJECT_RATING,
    window: null,
    allActivity: false,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--all") {
      options.allActivity = true;
      continue;
    }
    const value = args[i + 1];
    if (!flag?.startsWith("--")) continue;
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`La opción ${flag} necesita un valor.`);
    }
    i++;

    switch (flag) {
      case "--run":
        options.runId = value;
        break;
      case "--character":
        options.character = parseCharacterRef(value);
        break;
      case "--top": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`--top="${value}" debe ser un entero positivo.`);
        }
        options.topDifferences = parsed;
        break;
      }
      case "--rating": {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new Error(`--rating="${value}" debe ser un número.`);
        }
        options.subjectRating = parsed;
        break;
      }
      case "--window": {
        const parsed = Number(value);
        if (!VALID_WINDOWS.includes(parsed)) {
          throw new Error(
            `--window="${value}" debe ser una de las ventanas de §27: ${VALID_WINDOWS.join(", ")}.`,
          );
        }
        options.window = parsed as ActivityWindowDays;
        break;
      }
      default:
        throw new Error(
          `Opción desconocida: ${flag}. Disponibles: --run, --character, --top, --rating, ` +
            `--window, --all.`,
        );
    }
  }

  return options;
}

// --- Run muestreado ---

interface RunManifest {
  runId: string;
  sampledAt: string;
  region: string;
}

/**
 * El manifiesto del run fija `sampledAt`, que es el captured_at de todos sus
 * snapshots. Se compara contra un run concreto y no contra "lo último que haya
 * en la tabla" porque mezclar dos runs mezclaría dos fotos del ladder tomadas
 * en momentos distintos, y los porcentajes dejarían de describir un instante.
 */
function loadManifest(runId: string | null): RunManifest {
  const resolved = runId ?? latestRunId();
  const file = path.join(PROFILES_DIR, resolved, "manifest.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No existe el run "${resolved}" (falta ${file}).`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as RunManifest;
}

function latestRunId(): string {
  const runs = fs.existsSync(PROFILES_DIR)
    ? fs
        .readdirSync(PROFILES_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

  const latest = runs[runs.length - 1];
  if (!latest) {
    throw new Error(
      `No hay ningún run en ${PROFILES_DIR}. Ejecuta antes: npm run pipeline -- sample-profiles`,
    );
  }
  return latest;
}

// --- Carga de la población ---

/**
 * Carga las builds de un bracket en un run.
 *
 * Dos consultas y no un join con arrays: el gear son ~16 filas por personaje y
 * agruparlo en memoria es más simple de leer que un array_agg con json.
 */
async function loadPopulation(
  pool: pg.Pool,
  region: string,
  bracket: string,
  capturedAt: string,
): Promise<Population> {
  const { rows: snapshots } = await pool.query<{
    id: string;
    character_id: string;
    rating: number;
    average_item_level: number | null;
    equipped_item_level: number | null;
    talent_loadout_code: string | null;
    realm_slug: string;
    name_slug: string;
    name_display: string;
  }>(
    `select s.id, s.character_id, s.rating, s.average_item_level, s.equipped_item_level,
            s.talent_loadout_code,
            c.realm_slug, c.name_slug, c.name_display
       from character_snapshots s
       join characters c on c.id = s.character_id
      where s.source = 'profile' and s.bracket = $1 and s.captured_at = $2 and c.region = $3
      order by s.id`,
    [bracket, capturedAt, region],
  );

  const { rows: gear } = await pool.query<{
    snapshot_id: string;
    slot: string;
    item_id: string;
    item_name: string | null;
  }>(
    `select g.snapshot_id, g.slot, g.item_id, g.item_name
       from character_snapshot_gear g
       join character_snapshots s on s.id = g.snapshot_id
      where s.source = 'profile' and s.bracket = $1 and s.captured_at = $2
      order by g.snapshot_id, g.slot`,
    [bracket, capturedAt],
  );

  // La actividad se lee de la tabla materializada (refresh-activity) y se cruza
  // por (personaje, bracket, temporada): la temporada sale del propio snapshot
  // del run porque un run viejo puede ser de la temporada anterior, y el
  // contador de partidas se reinicia con ella.
  const { rows: activityRows } = await pool.query<{
    character_id: string;
    last_active_at: Date;
  }>(
    `select a.character_id, a.last_active_at
       from character_activity a
       join character_snapshots s
         on s.character_id = a.character_id and s.bracket = a.bracket
        and s.season_id = a.season_id
      where s.source = 'profile' and s.bracket = $1 and s.captured_at = $2`,
    [bracket, capturedAt],
  );

  const gearBySnapshot = new Map<string, Map<string, number>>();
  const itemNames = new Map<number, string>();
  for (const row of gear) {
    const itemId = Number(row.item_id);
    let slots = gearBySnapshot.get(row.snapshot_id);
    if (!slots) {
      slots = new Map<string, number>();
      gearBySnapshot.set(row.snapshot_id, slots);
    }
    slots.set(row.slot, itemId);
    if (row.item_name && !itemNames.has(itemId)) itemNames.set(itemId, row.item_name);
  }

  const meta = new Map<string, CharacterMeta>();
  const builds: PlayerBuild[] = snapshots.map((row) => {
    meta.set(row.character_id, {
      realmSlug: row.realm_slug,
      nameSlug: row.name_slug,
      nameDisplay: row.name_display,
    });
    return {
      characterId: row.character_id,
      rating: row.rating,
      gearBySlot: gearBySnapshot.get(row.id) ?? new Map<string, number>(),
      talentLoadoutCode: row.talent_loadout_code,
      // Este reporte compara por código exacto y no lee nodos: el ADR 0026
      // publica la agregación por nodo, y llevarla a la comparación es #18.
      talents: null,
      heroTalentTree: null,
      pvpTalents: null,
      equippedItemLevel: row.equipped_item_level,
      averageItemLevel: row.average_item_level,
    };
  });

  return {
    builds,
    meta,
    itemNames,
    activity: new Map(activityRows.map((row) => [row.character_id, row.last_active_at])),
  };
}

// --- Ventana de actividad ---

export interface ActiveSegment {
  /** null = se pidió --all: la población no está filtrada por actividad. */
  window: ActivityWindowDays | null;
  population: PlayerBuild[];
  /** Cuántos del segmento quedaron fuera por no haber jugado en la ventana. */
  excludedInactive: number;
}

/**
 * Recorta un segmento a su población activa (§27, #16).
 *
 * La ventana se elige por segmento con la regla de §13.4 (7 días si llegan a
 * n=30, si no 14), igual que en refresh-aggregates: el trade-off entre frescura
 * y muestra no es el mismo en 1800-2000 que en 2600-2800.
 *
 * Quien no tiene fila de actividad **no entra**. Es la misma decisión que toma
 * el agregado con su join interno: sin serie no se puede afirmar que alguien
 * haya jugado, y colarlo "porque está en el run" sería volver al proxy que #16
 * sustituye. Se cuenta aparte para que el reporte pueda decir cuánta población
 * ha perdido en vez de enseñar un n más pequeño sin explicación.
 */
export function selectActive(
  population: readonly PlayerBuild[],
  activity: ReadonlyMap<string, Date>,
  at: Date,
  options: { window: ActivityWindowDays | null; allActivity: boolean },
): ActiveSegment {
  if (options.allActivity) {
    return { window: null, population: [...population], excludedInactive: 0 };
  }

  const inWindow = (days: ActivityWindowDays): PlayerBuild[] =>
    population.filter((build) => {
      const lastActiveAt = activity.get(build.characterId);
      return lastActiveAt !== undefined && isActiveWithin({ lastActiveAt }, at, days);
    });

  const window =
    options.window ??
    pickActivityWindow({
      7: inWindow(ACTIVITY_WINDOWS.default).length,
      14: inWindow(ACTIVITY_WINDOWS.fallback).length,
    }).window;

  const active = inWindow(window);
  return { window, population: active, excludedInactive: population.length - active.length };
}

/**
 * Reparte la población por segmento a partir del rating **del snapshot de
 * perfil**, no del bucket con el que se muestreó.
 *
 * No es lo mismo: entre la descarga del leaderboard y la del perfil pasan días,
 * y hay quien ha cambiado de segmento. Segmentar por el bucket original metería
 * en "1800-2000" a gente que hoy está en 2200, inflando la comparación con
 * jugadores que ya no pertenecen a ese escalón.
 */
function segmentPopulation(builds: readonly PlayerBuild[], segment: RatingSegment): PlayerBuild[] {
  return builds.filter((build) => segmentFor(build.rating).id === segment.id);
}

// --- Elección de sujetos ---

/**
 * Sujeto de un reporte: un personaje del segmento de entrada, elegido de forma
 * aleatoria pero reproducible.
 *
 * Aleatorio y no "el primero de la lista" por lo mismo que en sample-profiles:
 * el primero por character_id no representa al segmento. Reproducible para que
 * el hallazgo se pueda auditar con la misma semilla.
 */
function pickSubject(population: readonly PlayerBuild[], bracket: string): PlayerBuild | undefined {
  return takeSample(population, 1, `${SUBJECT_SEED}|${bracket}`)[0];
}

// --- Renderizado ---

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function adoption(rate: AdoptionRate): string {
  return `${percent(rate.value)} (${rate.users}/${rate.denominator})`;
}

/** 'TRINKET_1' → 'Trinket 1'. Solo para leer; la clave sigue siendo el slot crudo. */
function slotLabel(slot: string): string {
  return slot
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function itemLabel(itemId: number, itemNames: Map<number, string>): string {
  return itemNames.get(itemId) ?? `item ${itemId}`;
}

/**
 * Cómo se declara la ventana en el reporte.
 *
 * Con `first-seen` dominando la población —el caso normal mientras el histórico
 * sea de días— decir "los que han jugado esta semana" sería falso, así que el
 * texto dice lo que de verdad se filtró: quien no ha dado señal de actividad en
 * la ventana no está en la comparación.
 */
function activityNote(activity: ReportContext["activity"]): string {
  if (activity.window === null) {
    return (
      "⚠️ Sin ventana de actividad (`--all`): la población incluye a quien no ha jugado en " +
      "semanas, así que estos porcentajes no describen el meta actual (§27)."
    );
  }

  const excluded = activity.excludedFromTarget + activity.excludedFromOwn;
  return (
    `Ventana de actividad: **${activity.window} días** (§27) — entra quien ha dado señal de ` +
    `actividad dentro de ella: una subida observada de su contador de partidas o, si nunca se ` +
    `le ha visto subirlo, su primera observación. ` +
    `${excluded} perfil(es) del run se quedan fuera por no darla.`
  );
}

interface ReportContext {
  spec: SpecEntry;
  bracket: string;
  runId: string;
  sampledAt: string;
  subject: PlayerBuild;
  meta: CharacterMeta;
  itemNames: Map<number, string>;
  gap: PlayerGap;
  /**
   * Con qué ventana de actividad se recortó cada segmento y a cuánta gente dejó
   * fuera. Va en el reporte, no solo en el log: §28 exige que ningún número se
   * enseñe sin poder trazar de dónde sale, y la ventana es parte de su
   * definición tanto como el tamaño de muestra.
   */
  activity: {
    window: ActivityWindowDays | null;
    excludedFromTarget: number;
    excludedFromOwn: number;
  };
}

/**
 * Markdown del reporte, con la plantilla fija de §13.6.
 *
 * Plantilla fija y no texto generado: cada frase es descriptiva y sin verbo de
 * recomendación ("lo lleva el X%", nunca "cámbialo para subir"). El tamaño de
 * muestra va pegado a cada porcentaje, no en una nota al pie (§13.5).
 */
function renderMarkdown(context: ReportContext): string {
  const { spec, bracket, subject, meta, itemNames, gap, runId, sampledAt, activity } = context;
  const lines: string[] = [];

  lines.push(`# Player Gap — ${meta.nameDisplay}-${meta.realmSlug}`);
  lines.push("");
  lines.push(`**${spec.label} · Solo Shuffle · ${subject.rating} CR**`);
  lines.push("");
  lines.push(
    `Tu segmento: **${formatSegment(gap.ownSegment)}** → siguiente segmento: ` +
      `**${formatSegment(gap.targetSegment)}**`,
  );
  lines.push("");
  lines.push(`Run \`${runId}\` · muestreado ${sampledAt} · bracket \`${bracket}\``);
  lines.push("");
  lines.push(activityNote(activity));
  lines.push("");

  if (!gap.available) {
    lines.push("## Sin comparación");
    lines.push("");
    lines.push(gap.reason);
    lines.push("");
    lines.push(
      "No se muestra una comparación degradada: por debajo de n=30 el producto explica " +
        "por qué no hay dato, no rebaja el umbral para llenar la pantalla (§13.4).",
    );
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `Muestra: **n=${gap.targetSampleSize}** en ${formatSegment(gap.targetSegment)} ` +
      `(confianza: **${gap.confidence}**) · n=${gap.ownSampleSize} en ` +
      `${formatSegment(gap.ownSegment)}.`,
  );
  if (gap.confidence === "medium") {
    lines.push("");
    lines.push("> ⚠️ Muestra reducida (30 ≤ n < 100): los porcentajes son menos estables.");
  }
  lines.push("");

  lines.push("## Alineación");
  lines.push("");
  lines.push(
    gap.gear.score === null
      ? "- **Gear**: sin slots comparables."
      : `- **Gear**: ${percent(gap.gear.score)} — tus items los lleva de media ese % de ` +
          `${formatSegment(gap.targetSegment)}, sobre ${gap.gear.comparedItems} items.`,
  );

  const { itemLevel } = gap;
  if (itemLevel.player !== null && itemLevel.targetMedian !== null) {
    lines.push(
      `- **Item level equipado**: ${itemLevel.player} · mediana de ${formatSegment(gap.targetSegment)}: ` +
        `${itemLevel.targetMedian} (n=${itemLevel.targetSample}) · mediana de ` +
        `${formatSegment(gap.ownSegment)}: ${itemLevel.ownMedian ?? "—"} (n=${itemLevel.ownSample}).`,
    );
  }
  lines.push("");

  lines.push("## Mayores diferencias de gear");
  lines.push("");
  if (gap.differences.length === 0) {
    lines.push(
      `Ninguna diferencia de gear alcanza el mínimo para considerarse discriminante entre ` +
        `${formatSegment(gap.ownSegment)} y ${formatSegment(gap.targetSegment)}. Las diferencias ` +
        `pequeñas se ocultan en vez de mostrarse por completitud (§13.5).`,
    );
  } else {
    for (const difference of gap.differences) {
      lines.push(
        `- **${itemLabel(difference.itemId, itemNames)}** (${slotLabel(difference.slotGroup)}) ` +
          `lo lleva el ${adoption(difference.target)} de ${formatSegment(gap.targetSegment)} ` +
          `frente al ${adoption(difference.own)} de ${formatSegment(gap.ownSegment)}` +
          `${difference.playerHasIt ? " — lo llevas" : ""}.`,
      );
    }
  }
  lines.push("");

  lines.push("## Talentos");
  lines.push("");
  const { talents } = gap;
  const denominator = talents.topCodes[0]?.adoption.denominator ?? 0;

  // Cuando no hay build mayoritaria, la limitación va primero. Enseñar el top-3
  // y explicar después invita a leer un 3% como si fuera el consenso del
  // segmento, que es exactamente la conclusión engañosa que prohíbe §13.5.
  if (!talents.hasUsableSignal) {
    lines.push(
      `**Sin señal utilizable por coincidencia exacta de código.** En ` +
        `${formatSegment(gap.targetSegment)} hay **${talents.distinctCodes} códigos distintos ` +
        `entre ${denominator} perfiles**, y el más repetido lo llevan ` +
        `${talents.topCodes[0]?.adoption.users ?? 0}. No existe una "build del segmento" que ` +
        `describir: comparar el código completo distingue builds que difieren en un único nodo, ` +
        `así que casi todo el mundo resulta único.`,
    );
    lines.push("");
    lines.push(
      "La comparación informativa es la de nodos, que desde el ADR 0026 tienen su propio " +
        "`adoption_rate` por segmento. Este reporte sigue siendo el del código exacto: el " +
        "Player Gap se sostiene sobre gear mientras no la levante #18.",
    );
  } else {
    if (talents.playerCode === null) {
      lines.push(
        "Tu `talent_loadout_code` no está disponible, así que no hay comparación posible.",
      );
    } else if (talents.playerCodeAdoption) {
      lines.push(
        `Tu código exacto lo lleva el ${adoption(talents.playerCodeAdoption)} de ` +
          `${formatSegment(gap.targetSegment)}.`,
      );
    }
    lines.push("");
    lines.push(
      `Códigos más frecuentes en ${formatSegment(gap.targetSegment)} ` +
        `(${talents.distinctCodes} códigos distintos entre ${denominator} perfiles` +
        `${talents.unavailable > 0 ? `, ${talents.unavailable} sin código fuera del denominador` : ""}):`,
    );
    lines.push("");
    for (const entry of talents.topCodes) {
      const mine = entry.code === talents.playerCode ? " — es el tuyo" : "";
      lines.push(`- \`${entry.code}\` — ${adoption(entry.adoption)}${mine}`);
    }
    lines.push("");
    lines.push(
      "La coincidencia es **exacta** sobre el código completo: dos builds que difieran en un " +
        "solo nodo cuentan como distintas. No hay un “% de talentos alineados” porque con " +
        "coincidencia exacta solo podría valer 0 o 100.",
    );
  }
  lines.push("");

  lines.push("## Cómo leer esto");
  lines.push("");
  lines.push(
    "Esto describe qué lleva el segmento de arriba, no qué hacer. **Que un item o una build " +
      "sean más frecuentes arriba no significa que adoptarlos suba el rating**: la causalidad " +
      "puede ir en sentido contrario (más rating → más acceso a ese item) o venir de una " +
      "tercera variable.",
  );
  lines.push("");
  lines.push(
    "Fuera de esta comparación: stats secundarias y embellishments, que el schema todavía no " +
      "guarda.",
  );
  lines.push("");

  return lines.join("\n");
}

/** El JSON es el reporte auditable: lleva los denominadores crudos, no solo los porcentajes. */
function toJson(context: ReportContext): unknown {
  const { spec, bracket, subject, meta, itemNames, gap, runId, sampledAt, activity } = context;

  const withNames = (itemId: number) => ({ itemId, itemName: itemNames.get(itemId) ?? null });

  return {
    runId,
    sampledAt,
    bracket,
    spec: { label: spec.label, classSlug: spec.classSlug, specSlug: spec.specSlug },
    player: {
      characterId: subject.characterId,
      name: meta.nameDisplay,
      realmSlug: meta.realmSlug,
      rating: subject.rating,
      equippedItemLevel: subject.equippedItemLevel,
      averageItemLevel: subject.averageItemLevel,
      talentLoadoutCode: subject.talentLoadoutCode,
    },
    ownSegment: gap.ownSegment,
    targetSegment: gap.targetSegment,
    activityWindow: {
      days: activity.window,
      excludedFromTarget: activity.excludedFromTarget,
      excludedFromOwn: activity.excludedFromOwn,
    },
    ...(gap.available
      ? {
          available: true,
          confidence: gap.confidence,
          ownSampleSize: gap.ownSampleSize,
          targetSampleSize: gap.targetSampleSize,
          gearAlignment: gap.gear,
          itemLevel: gap.itemLevel,
          differences: gap.differences.map((difference) => ({
            slotGroup: difference.slotGroup,
            ...withNames(difference.itemId),
            delta: difference.delta,
            target: difference.target,
            own: difference.own,
            playerHasIt: difference.playerHasIt,
          })),
          talents: gap.talents,
        }
      : { available: false, confidence: gap.confidence, reason: gap.reason }),
    caveats: [
      "El item level comparado es el equipado; average_item_level cuenta también el banco.",
      activity.window === null
        ? "Sin ventana de actividad (--all): la población incluye personajes inactivos (§27)."
        : `Población filtrada por actividad a ${activity.window} días (§27), medida desde el ` +
          `momento del run: subida observada de season_match_statistics.played o, a falta de ` +
          `ella, primera observación del personaje.`,
      "Sin stats secundarias ni embellishments: el schema no los guarda todavía.",
      "Talentos por coincidencia exacta de talent_loadout_code: este reporte no lee los " +
        "nodos que agrega el ADR 0026.",
    ],
  };
}

// --- Orquestación ---

/**
 * Los dos criterios con los que se busca al personaje pedido en `--character`,
 * en el orden en que se aplican.
 *
 * Son dos y no uno porque el plegado no distingue a personajes que sí lo son:
 * en la población acumulada hay 1.626 grupos que colisionan al plegar los
 * acentos. Sin el criterio exacto delante, pedir `--character magtheridon/
 * artháslegend` podría reportar a cualquiera de los otros tres Arthaslegend de
 * ese reino.
 */
export interface RequestedMatch {
  exact: (meta: CharacterMeta) => boolean;
  folded: (meta: CharacterMeta) => boolean;
}

export function matchersFor(ref: CharacterRef | null): RequestedMatch {
  if (!ref) return { exact: () => false, folded: () => false };

  const folded = { realm: foldSlug(ref.realmSlug), name: foldSlug(ref.nameSlug) };

  return {
    exact: (meta) => meta.realmSlug === ref.realmSlug && meta.nameSlug === ref.nameSlug,
    folded: (meta) =>
      foldSlug(meta.realmSlug) === folded.realm && foldSlug(meta.nameSlug) === folded.name,
  };
}

async function reportFor(
  pool: pg.Pool,
  manifest: RunManifest,
  spec: SpecEntry,
  options: Options,
  requestedMatch: RequestedMatch,
): Promise<ReportContext | null> {
  const bracket = shuffleBracketId(spec);
  const { builds, meta, itemNames, activity } = await loadPopulation(
    pool,
    manifest.region,
    bracket,
    manifest.sampledAt,
  );
  if (builds.length === 0) return null;

  // Se busca primero la forma canónica y solo después la plegada: el plegado
  // casa varios personajes reales y distintos (`artháslegend` y `arthaslegend`
  // son dos personas), así que quien escriba el nombre exacto tiene que recibir
  // al suyo y no al primero que se le parezca.
  const findBy = (matches: (meta: CharacterMeta) => boolean): PlayerBuild | undefined =>
    builds.find((build) => {
      const info = meta.get(build.characterId);
      return info ? matches(info) : false;
    });

  const requested = options.character
    ? (findBy(requestedMatch.exact) ?? findBy(requestedMatch.folded))
    : undefined;
  if (options.character && !requested) return null;

  const ownSegment = requested ? segmentFor(requested.rating) : segmentFor(options.subjectRating);
  // La ventana se mide desde el momento del run, no desde "ahora": un reporte
  // de hace un mes tiene que poder reproducirse tal cual se publicó, y con el
  // reloj de hoy su población iría vaciándose sola.
  const at = new Date(manifest.sampledAt);
  const own = selectActive(segmentPopulation(builds, ownSegment), activity, at, options);
  // El sujeto pedido a mano no se filtra: es la persona que pregunta, no parte
  // de la población de referencia contra la que se compara.
  const subject = requested ?? pickSubject(own.population, bracket);
  if (!subject) return null;

  const targetSegment = nextSegment(ownSegment);
  if (!targetSegment) {
    throw new Error(
      `${spec.label}: ${formatSegment(ownSegment)} es el tramo abierto de arriba; no hay ` +
        `segmento superior contra el que comparar (§13.5).`,
    );
  }

  const subjectMeta = meta.get(subject.characterId);
  if (!subjectMeta) return null;

  const target = selectActive(segmentPopulation(builds, targetSegment), activity, at, options);

  return {
    spec,
    bracket,
    runId: manifest.runId,
    sampledAt: manifest.sampledAt,
    subject,
    meta: subjectMeta,
    itemNames,
    gap: computePlayerGap({
      player: subject,
      ownSegment,
      targetSegment,
      ownPopulation: own.population,
      targetPopulation: target.population,
      topDifferences: options.topDifferences,
      topTalentCodes: options.topTalentCodes,
    }),
    activity: {
      window: target.window,
      excludedFromTarget: target.excludedInactive,
      excludedFromOwn: own.excludedInactive,
    },
  };
}

function write(context: ReportContext): { json: string; markdown: string } {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const base = `player-gap-${context.runId}-${context.meta.realmSlug}-${context.meta.nameSlug}`;
  const json = path.join(REPORTS_DIR, `${base}.json`);
  const markdown = path.join(REPORTS_DIR, `${base}.md`);

  fs.writeFileSync(json, JSON.stringify(toJson(context), null, 2));
  fs.writeFileSync(markdown, renderMarkdown(context));
  return { json, markdown };
}

export async function playerGap(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const manifest = loadManifest(options.runId);
  const requestedMatch = matchersFor(options.character);

  const pool = createPool();
  try {
    console.log(`Run ${manifest.runId} (${manifest.sampledAt}), región ${manifest.region}.\n`);

    const contexts: ReportContext[] = [];
    for (const spec of SPECS_TO_INGEST) {
      const context = await reportFor(pool, manifest, spec, options, requestedMatch);
      if (context) contexts.push(context);
    }

    if (contexts.length === 0) {
      throw new Error(
        options.character
          ? `No hay perfil de "${formatCharacterRef(options.character)}" en el run ${manifest.runId}.`
          : `El run ${manifest.runId} no tiene perfiles cargados en Postgres. ` +
              `¿Ejecutaste sample-profiles contra esta base de datos?`,
      );
    }

    for (const context of contexts) {
      const { gap, meta, spec, subject, activity } = context;
      const files = write(context);
      const header = `${meta.nameDisplay}-${meta.realmSlug} · ${spec.label} · ${subject.rating} CR`;

      if (!gap.available) {
        console.log(`⚠️  ${header}`);
        console.log(`   ${gap.reason}`);
      } else {
        console.log(`✅ ${header}`);
        console.log(
          `   ${formatSegment(gap.ownSegment)} → ${formatSegment(gap.targetSegment)} · ` +
            `n=${gap.targetSampleSize} (${gap.confidence}) · ` +
            `${activity.window === null ? "sin ventana de actividad" : `ventana ${activity.window}d`}`,
        );
        console.log(
          `   Gear alineado: ${gap.gear.score === null ? "—" : percent(gap.gear.score)} · ` +
            `${gap.differences.length} diferencias discriminantes`,
        );
        console.log(
          `   Talentos: ${gap.talents.distinctCodes} códigos distintos arriba` +
            `${gap.talents.hasUsableSignal ? "" : " — sin señal utilizable por código exacto"}`,
        );
      }
      console.log(`   ${files.markdown}`);
      console.log("");
    }
  } finally {
    await pool.end();
  }
}
