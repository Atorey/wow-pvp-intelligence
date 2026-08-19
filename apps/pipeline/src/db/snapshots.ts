import type pg from "pg";
import type { SpecEntry } from "@wowpvp/core";
import type { GearRow } from "../jobs/profile-mapping";

/**
 * Inserción de snapshots de perfil (los que traen gear/talentos, a diferencia de
 * los de leaderboard, que se insertan en bloque durante la ingesta).
 *
 * Compartido por el muestreo por segmento y por la búsqueda bajo demanda: la
 * única diferencia entre ambos es el `source`, y tener dos copias de este INSERT
 * significaría que un cambio en el modelo (una columna nueva de gear, otra regla
 * de idempotencia) se aplicaría a una fuente de población y no a la otra.
 */

export interface ProfileSnapshotInput {
  characterId: string;
  /** Marca temporal de la captura. Nunca now(): ver comentario de idempotencia. */
  capturedAt: string;
  /** 'profile' = muestreo nuestro; 'search' = lo trajo una búsqueda de usuario (§12). */
  source: "profile" | "search";
  seasonId: number;
  bracket: string;
  spec: SpecEntry;
  rating: number;
  matchesPlayed: number | null;
  matchesWon: number | null;
  matchesLost: number | null;
  pvpTierId: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  talentCode: string | null;
  gear: readonly GearRow[];
}

export interface ProfileSnapshotResult {
  /** null solo si el snapshot no existía y tampoco se pudo insertar. */
  snapshotId: string | null;
  /** false si ya existía: reanudación de un run o búsqueda repetida. */
  isNew: boolean;
}

/**
 * Inserta el snapshot y su gear. Siempre INSERT, nunca UPDATE (append-only,
 * ADR 0002): un update sobre rating/gear/talentos destruiría el histórico, que
 * es el moat del producto.
 *
 * Recibe un client con transacción abierta: el snapshot y su gear entran juntos
 * o no entran, y quien llama suele meter también la identidad en la misma.
 */
export async function insertProfileSnapshot(
  client: pg.PoolClient,
  input: ProfileSnapshotInput,
): Promise<ProfileSnapshotResult> {
  const inserted = await client.query<{ id: string }>(
    `insert into character_snapshots
       (character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
        rating, matches_played, matches_won, matches_lost, pvp_tier_id,
        average_item_level, equipped_item_level, talent_loadout_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (character_id, bracket, captured_at) do nothing
     returning id`,
    [
      input.characterId,
      input.capturedAt,
      input.source,
      input.seasonId,
      input.bracket,
      input.spec.classSlug,
      input.spec.specSlug,
      input.rating,
      // ladder_rank se queda a null: el perfil no da posición de ladder, y
      // copiarla del snapshot de leaderboard mezclaría fuentes.
      input.matchesPlayed,
      input.matchesWon,
      input.matchesLost,
      input.pvpTierId,
      input.averageItemLevel,
      input.equippedItemLevel,
      input.talentCode,
    ],
  );

  const isNew = (inserted.rowCount ?? 0) > 0;

  // Si el snapshot ya existía, puede ser de un intento anterior que murió entre
  // el snapshot y su gear. Se recupera el id para completarlo en vez de dejarlo
  // a medias.
  let snapshotId = inserted.rows[0]?.id ?? null;
  if (!snapshotId) {
    const existing = await client.query<{ id: string }>(
      `select id from character_snapshots
        where character_id = $1 and bracket = $2 and captured_at = $3`,
      [input.characterId, input.bracket, input.capturedAt],
    );
    snapshotId = existing.rows[0]?.id ?? null;
  }

  // Una fila por slot, no un unnest en bloque: enchantment_ids, gem_item_ids y
  // bonus_list son int[], y unnest sobre un array de arrays los aplanaría en
  // una sola dimensión, mezclando las gemas de un item con las del siguiente.
  // Son ~16 slots por personaje dentro de la misma transacción.
  for (const item of snapshotId ? input.gear : []) {
    await client.query(
      `insert into character_snapshot_gear
         (snapshot_id, slot, item_id, item_name, item_level, quality,
          enchantment_ids, gem_item_ids, bonus_list)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (snapshot_id, slot) do nothing`,
      [
        snapshotId,
        item.slot,
        item.itemId,
        item.itemName,
        item.itemLevel,
        item.quality,
        item.enchantmentIds,
        item.gemItemIds,
        item.bonusList,
      ],
    );
  }

  return { snapshotId, isNew };
}
