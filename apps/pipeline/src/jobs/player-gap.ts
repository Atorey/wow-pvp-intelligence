import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import {
  computePlayerGap,
  formatSegment,
  nextSegment,
  segmentFor,
  shuffleBracketId,
  type AdoptionRate,
  type PlayerBuild,
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

interface Options {
  runId: string | null;
  /** "realm/nombre" si se pide un personaje concreto; si no, se eligen 3 sujetos. */
  character: string | null;
  topDifferences: number;
  topTalentCodes: number;
  subjectRating: number;
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
}

// --- Argumentos ---

function parseOptions(args: string[]): Options {
  const options: Options = {
    runId: null,
    character: null,
    topDifferences: 5,
    topTalentCodes: 3,
    subjectRating: DEFAULT_SUBJECT_RATING,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
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
        if (!value.includes("/")) {
          throw new Error(`--character="${value}" debe tener la forma reino/nombre.`);
        }
        options.character = value.toLowerCase();
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
      default:
        throw new Error(
          `Opción desconocida: ${flag}. Disponibles: --run, --character, --top, --rating.`,
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
      equippedItemLevel: row.equipped_item_level,
      averageItemLevel: row.average_item_level,
    };
  });

  return { builds, meta, itemNames };
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

interface ReportContext {
  spec: SpecEntry;
  bracket: string;
  runId: string;
  sampledAt: string;
  subject: PlayerBuild;
  meta: CharacterMeta;
  itemNames: Map<number, string>;
  gap: PlayerGap;
}

/**
 * Markdown del reporte, con la plantilla fija de §13.6.
 *
 * Plantilla fija y no texto generado: cada frase es descriptiva y sin verbo de
 * recomendación ("lo lleva el X%", nunca "cámbialo para subir"). El tamaño de
 * muestra va pegado a cada porcentaje, no en una nota al pie (§13.5).
 */
function renderMarkdown(context: ReportContext): string {
  const { spec, bracket, subject, meta, itemNames, gap, runId, sampledAt } = context;
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
      "Esta comparación solo será informativa cuando el loadout se decodifique en nodos " +
        "individuales y cada nodo tenga su propio `adoption_rate` (#24). Hasta entonces, el " +
        "Player Gap se sostiene sobre gear, no sobre talentos.",
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
        "coincidencia exacta solo podría valer 0 o 100 (#24).",
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
    "Fuera de esta comparación: stats secundarias y embellishments (el schema todavía no los " +
      "guarda) y la ventana de actividad de §27 (#16 pendiente) — la población es la muestreada " +
      "en este run, no la activa de los últimos 7 días.",
  );
  lines.push("");

  return lines.join("\n");
}

/** El JSON es el reporte auditable: lleva los denominadores crudos, no solo los porcentajes. */
function toJson(context: ReportContext): unknown {
  const { spec, bracket, subject, meta, itemNames, gap, runId, sampledAt } = context;

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
      "Sin ventana de actividad (§27 / #16): la población es la muestreada en este run.",
      "Sin stats secundarias ni embellishments: el schema no los guarda todavía.",
      "Talentos por coincidencia exacta de talent_loadout_code (#24 pendiente).",
    ],
  };
}

// --- Orquestación ---

async function reportFor(
  pool: pg.Pool,
  manifest: RunManifest,
  spec: SpecEntry,
  options: Options,
  matchesRequested: (meta: CharacterMeta) => boolean,
): Promise<ReportContext | null> {
  const bracket = shuffleBracketId(spec);
  const { builds, meta, itemNames } = await loadPopulation(
    pool,
    manifest.region,
    bracket,
    manifest.sampledAt,
  );
  if (builds.length === 0) return null;

  const requested = options.character
    ? builds.find((build) => {
        const info = meta.get(build.characterId);
        return info ? matchesRequested(info) : false;
      })
    : undefined;
  if (options.character && !requested) return null;

  const ownSegment = requested ? segmentFor(requested.rating) : segmentFor(options.subjectRating);
  const ownPopulation = segmentPopulation(builds, ownSegment);
  const subject = requested ?? pickSubject(ownPopulation, bracket);
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
      ownPopulation,
      targetPopulation: segmentPopulation(builds, targetSegment),
      topDifferences: options.topDifferences,
      topTalentCodes: options.topTalentCodes,
    }),
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
  const [requestedRealm, requestedName] = (options.character ?? "").split("/");
  const matchesRequested = (meta: CharacterMeta): boolean =>
    meta.realmSlug === requestedRealm && meta.nameSlug === requestedName;

  const pool = createPool();
  try {
    console.log(`Run ${manifest.runId} (${manifest.sampledAt}), región ${manifest.region}.\n`);

    const contexts: ReportContext[] = [];
    for (const spec of SPECS_TO_INGEST) {
      const context = await reportFor(pool, manifest, spec, options, matchesRequested);
      if (context) contexts.push(context);
    }

    if (contexts.length === 0) {
      throw new Error(
        options.character
          ? `No hay perfil de "${options.character}" en el run ${manifest.runId}.`
          : `El run ${manifest.runId} no tiene perfiles cargados en Postgres. ` +
              `¿Ejecutaste sample-profiles contra esta base de datos?`,
      );
    }

    for (const context of contexts) {
      const { gap, meta, spec, subject } = context;
      const files = write(context);
      const header = `${meta.nameDisplay}-${meta.realmSlug} · ${spec.label} · ${subject.rating} CR`;

      if (!gap.available) {
        console.log(`⚠️  ${header}`);
        console.log(`   ${gap.reason}`);
      } else {
        console.log(`✅ ${header}`);
        console.log(
          `   ${formatSegment(gap.ownSegment)} → ${formatSegment(gap.targetSegment)} · ` +
            `n=${gap.targetSampleSize} (${gap.confidence})`,
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
