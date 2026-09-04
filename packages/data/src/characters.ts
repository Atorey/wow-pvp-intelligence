import { standingWithin } from "@wowpvp/core";
import type { ActivityEvidence, Region, SnapshotSource, Standing } from "@wowpvp/core";
import type { ObservationProvenance } from "./provenance";
import type { Queryable } from "./queryable";

/** Cómo se nombra a un personaje en la URL y en la base: región + reino + nombre. */
export interface CharacterKey {
  region: Region;
  realmSlug: string;
  nameSlug: string;
}

/**
 * La última observación de un personaje en un bracket.
 *
 * Es un dato suyo, no una estimación: por eso lleva `ObservationProvenance` y
 * no `Provenance`. No hay muestra que declarar porque no hay muestra.
 */
export interface CharacterSnapshotRead {
  characterId: string;
  nameDisplay: string;
  realmSlug: string;
  faction: string | null;
  seasonId: number;
  bracket: string;
  classSlug: string;
  specSlug: string;
  rating: number;
  /** Posición en el leaderboard oficial. null por debajo del corte de 5.000. */
  ladderRank: number | null;
  /**
   * Partidas de la temporada según **esta** fuente.
   *
   * Solo se compara con el mismo `source`: el contador del perfil da un número
   * sistemáticamente menor que el del leaderboard para el mismo personaje y
   * bracket, y restarlos fabrica actividad que nadie jugó (ADR 0008).
   */
  matchesPlayed: number | null;
  matchesWon: number | null;
  matchesLost: number | null;
  pvpTierId: number | null;
  /** El equipado. `averageItemLevel` cuenta también lo que lleva en el banco. */
  equippedItemLevel: number | null;
  averageItemLevel: number | null;
  /**
   * Ausente en buena parte de las clases desde el parche 11.2, y de forma
   * desigual entre ellas. `null` es "no disponible", nunca "no lleva talentos".
   */
  talentLoadoutCode: string | null;
  provenance: ObservationProvenance;
}

interface SnapshotRow {
  character_id: string;
  name_display: string;
  realm_slug: string;
  faction: string | null;
  season_id: number;
  bracket: string;
  class_slug: string;
  spec_slug: string;
  rating: number;
  ladder_rank: number | null;
  matches_played: number | null;
  matches_won: number | null;
  matches_lost: number | null;
  pvp_tier_id: number | null;
  equipped_item_level: number | null;
  average_item_level: number | null;
  talent_loadout_code: string | null;
  captured_at: Date;
  source: SnapshotSource;
}

function toSnapshotRead(row: SnapshotRow): CharacterSnapshotRead {
  return {
    characterId: row.character_id,
    nameDisplay: row.name_display,
    realmSlug: row.realm_slug,
    faction: row.faction,
    seasonId: row.season_id,
    bracket: row.bracket,
    classSlug: row.class_slug,
    specSlug: row.spec_slug,
    rating: row.rating,
    ladderRank: row.ladder_rank,
    matchesPlayed: row.matches_played,
    matchesWon: row.matches_won,
    matchesLost: row.matches_lost,
    pvpTierId: row.pvp_tier_id,
    equippedItemLevel: row.equipped_item_level,
    averageItemLevel: row.average_item_level,
    talentLoadoutCode: row.talent_loadout_code,
    provenance: { observedAt: row.captured_at, source: row.source },
  };
}

const SNAPSHOT_COLUMNS = `s.character_id, c.name_display, c.realm_slug, c.faction,
       s.season_id, s.bracket, s.class_slug, s.spec_slug, s.rating, s.ladder_rank,
       s.matches_played, s.matches_won, s.matches_lost, s.pvp_tier_id,
       s.equipped_item_level, s.average_item_level, s.talent_loadout_code,
       s.captured_at, s.source`;

/**
 * La observación más reciente de un personaje en un bracket.
 *
 * "Más reciente" es por `captured_at` y no por `id`, aunque hoy coincidan: desde
 * el ADR 0009 solo se inserta la fila que cambia respecto a la anterior, así que
 * el histórico tiene huecos y su orden es el del reloj, no el del contador.
 *
 * Ojo con lo que **no** contesta: cuántas veces hemos visto a este personaje no
 * se cuenta aquí ni contando filas — eso vive en `character_presence`.
 */
export async function readLatestSnapshot(
  db: Queryable,
  key: CharacterKey & { bracket: string; seasonId: number },
): Promise<CharacterSnapshotRead | null> {
  const { rows } = await db.query<SnapshotRow>(
    `select ${SNAPSHOT_COLUMNS}
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and c.realm_slug = $2 and c.name_slug = $3
        and s.bracket = $4 and s.season_id = $5
      order by s.captured_at desc
      limit 1`,
    [key.region, key.realmSlug, key.nameSlug, key.bracket, key.seasonId],
  );

  const row = rows[0];
  return row ? toSnapshotRead(row) : null;
}

/**
 * La observación más reciente en **cada** bracket que juegue el personaje.
 *
 * Un personaje puede jugar varias specs y la página de perfil las enseña todas,
 * así que la clave es `(personaje, bracket)` y no el personaje solo.
 */
export async function readLatestSnapshotsByBracket(
  db: Queryable,
  key: CharacterKey & { seasonId: number },
): Promise<CharacterSnapshotRead[]> {
  const { rows } = await db.query<SnapshotRow>(
    `select distinct on (s.bracket) ${SNAPSHOT_COLUMNS}
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and c.realm_slug = $2 and c.name_slug = $3 and s.season_id = $4
      order by s.bracket, s.captured_at desc`,
    [key.region, key.realmSlug, key.nameSlug, key.seasonId],
  );

  return rows.map(toSnapshotRead);
}

/**
 * Hasta dónde se puede demostrar que un personaje ha jugado (§27, ADR 0008).
 *
 * `evidence` no es un detalle interno: distingue "se le vio subir el contador de
 * partidas" de "se le vio aparecer por primera vez". Lo segundo no demuestra que
 * haya jugado, y mientras el histórico sea corto es el caso mayoritario, así que
 * cualquier copy que hable de actividad tiene que poder mirarlo.
 */
export interface ActivityRead {
  lastActiveAt: Date;
  evidence: ActivityEvidence;
  /** Último valor visto del contador de partidas. Solo comparable consigo mismo. */
  lastPlayed: number | null;
  /** Cuántas observaciones sostienen esta fila. */
  observations: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Cuándo se materializó la fila. `refresh-activity` la reconstruye entera. */
  computedAt: Date;
}

interface ActivityRow {
  last_active_at: Date;
  evidence: ActivityEvidence;
  last_played: number | null;
  observations: number;
  first_seen_at: Date;
  last_seen_at: Date;
  computed_at: Date;
}

/**
 * null aquí es "no hay fila de actividad", que **no** es "está inactivo".
 *
 * La distinción es la misma que toman los agregados con su join interno: sin
 * serie no se puede afirmar que alguien haya jugado, pero tampoco lo contrario.
 * El consumidor tiene que decir "no consta", no "lleva sin jugar".
 */
export async function readActivity(
  db: Queryable,
  key: { characterId: string; bracket: string; seasonId: number },
): Promise<ActivityRead | null> {
  const { rows } = await db.query<ActivityRow>(
    `select last_active_at, evidence, last_played, observations,
            first_seen_at, last_seen_at, computed_at
       from character_activity
      where character_id = $1 and bracket = $2 and season_id = $3`,
    [key.characterId, key.bracket, key.seasonId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    lastActiveAt: row.last_active_at,
    evidence: row.evidence,
    lastPlayed: row.last_played,
    observations: row.observations,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    computedAt: row.computed_at,
  };
}

/**
 * Dónde cae un rating dentro de la población **observada** de su bracket, con el
 * máximo de esa misma población al lado.
 *
 * La regla —qué es el percentil y desde cuándo se puede escribir— vive en
 * `standingWithin()` de `packages/core`, no aquí: es dominio compartido y la
 * regla 2 del proyecto no admite dos copias. Lo que esta capa añade es lo que sí
 * es asunto suyo, que es de dónde sale el recuento.
 */
export interface StandingRead extends Standing {
  /**
   * El rating más alto de **esta misma** población observada.
   *
   * Sale de aquí y no de `population_segments` por una razón que se ve en
   * pantalla: los segmentos cuentan con ventana de actividad, así que su máximo
   * puede quedar por debajo del rating del propio jugador que se está mirando.
   * Un "rating más alto observado: 2545" debajo de alguien con 2595 no es un
   * matiz metodológico, es una contradicción (punto 5 del ADR 0011).
   *
   * `null` cuando no hay ninguna observación en ese bracket.
   */
  highest: number | null;
}

interface StandingRow {
  observed: number;
  below: number;
  highest: number | null;
}

/**
 * La población que se cuenta es la misma que la de los agregados, con la misma
 * exclusión: fuera los snapshots de `source = 'search'` (ADR 0007, punto 8).
 * Una página no puede tener dos poblaciones distintas según el bloque que la
 * pinte (ADR 0011, punto 5).
 *
 * Lo que **no** se aplica aquí es la ventana de actividad. Los agregados la usan
 * porque describen el meta actual; esto describe cuánta gente hemos visto en la
 * temporada, que es lo que significa la palabra "observados" del punto 6 del ADR
 * 0011. Recortarlo a siete días daría un percentil que se mueve solo cada noche
 * sin que el jugador haya hecho nada.
 *
 * Tampoco se usa `ACTIVITY_WINDOWS.seasonActive`, aunque exista y aunque la §27
 * del plan la reserve precisamente para un ranking: ese ranking de temporada es
 * una página que el ADR 0020 dejó declarada y sin código. Traerla aquí le daría
 * a este bloque una tercera población, distinta de la de los agregados y de la
 * que ya enseña, que es lo que el punto 5 del ADR 0011 prohíbe.
 */
export async function readStanding(
  db: Queryable,
  key: { region: Region; seasonId: number; bracket: string; rating: number },
): Promise<StandingRead> {
  const { rows } = await db.query<StandingRow>(
    `with latest as (
       select distinct on (s.character_id) s.character_id, s.rating
         from character_snapshots s
         join characters c on c.id = s.character_id
        where c.region = $1 and s.season_id = $2 and s.bracket = $3
          and s.source <> 'search'
        order by s.character_id, s.captured_at desc
     )
     select count(*)::int as observed,
            count(*) filter (where rating < $4)::int as below,
            max(rating)::int as highest
       from latest`,
    [key.region, key.seasonId, key.bracket, key.rating],
  );

  const row = rows[0] ?? { observed: 0, below: 0, highest: null };
  return { ...standingWithin(row), highest: row.highest };
}

/**
 * La temporada más reciente en la que hemos observado a un personaje.
 *
 * La web no puede preguntarle a Blizzard cuál es la temporada en curso —eso
 * cuesta dos llamadas y una ficha de cuota por visita—, y tampoco le sirve: lo
 * que la página de perfil enseña es lo último que sabemos de **este**
 * personaje, y decir "temporada 42" sobre alguien a quien solo vimos en la 41
 * sería fechar mal un dato real.
 *
 * `null` es "no consta en la población", que no es "no existe": puede estar por
 * debajo del corte de 5.000 del leaderboard y no haberlo buscado nadie todavía.
 */
export async function readLatestObservedSeason(
  db: Queryable,
  key: CharacterKey,
): Promise<number | null> {
  const { rows } = await db.query<{ season_id: number | null }>(
    `select max(s.season_id) as season_id
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and c.realm_slug = $2 and c.name_slug = $3`,
    [key.region, key.realmSlug, key.nameSlug],
  );

  return rows[0]?.season_id ?? null;
}

/**
 * El rating más alto que le hemos visto a un personaje en un bracket.
 *
 * Es "el más alto observado", no "el más alto que alcanzó": desde el ADR 0009
 * solo se inserta la fila cuyo rating cambia respecto a la anterior, así que
 * entre dos observaciones pudo subir y volver a bajar sin que quede rastro. Se
 * cuenta sobre el histórico entero de la temporada y no sobre la última fila,
 * que es lo que lo distingue del rating actual.
 */
export async function readPeakRating(
  db: Queryable,
  key: { characterId: string; bracket: string; seasonId: number },
): Promise<number | null> {
  const { rows } = await db.query<{ peak: number | null }>(
    `select max(rating) as peak
       from character_snapshots
      where character_id = $1 and bracket = $2 and season_id = $3`,
    [key.characterId, key.bracket, key.seasonId],
  );

  return rows[0]?.peak ?? null;
}
