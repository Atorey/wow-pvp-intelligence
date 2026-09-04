import { compareGearSlots, parseItemQuality, type ItemQuality } from "@wowpvp/core";
import { toNumber } from "./columns";
import type { CharacterKey } from "./characters";
import type { ObservationProvenance } from "./provenance";
import type { Queryable } from "./queryable";

/**
 * Una pieza equipada tal y como se observó, con su icono ya resuelto.
 *
 * Es un dato de una persona y no un agregado, así que lleva
 * `ObservationProvenance`: no hay muestra ni confianza que declarar, hay una
 * fecha y una fuente. Lo que sí importa de esa fecha es que **no es la de hoy**
 * — el equipo es el del día en que registramos su último cambio, y el desfase
 * con el rating se dice en pantalla en vez de dejarlo suponer.
 */
export interface GearItemRead {
  /** El slot de Blizzard (`'HEAD'`, `'TRINKET_1'`), no su nombre en pantalla. */
  slot: string;
  itemId: number;
  itemName: string | null;
  itemLevel: number | null;
  /** Normalizada al vocabulario de los tokens. `null` es "no disponible". */
  quality: ItemQuality | null;
  /**
   * URL del icono en el CDN de Blizzard (`item_media`, ADR 0022).
   *
   * `null` es "no disponible" —sin resolver todavía, o sin icono publicado— y
   * nunca "este item no tiene icono". Lo que se pinta con un null es el hueco
   * reservado del brief §4.5: la fila no se recoloca porque el nombre y el item
   * level son la información.
   */
  iconUrl: string | null;
}

export interface CharacterGearRead {
  items: GearItemRead[];
  /**
   * El item level equipado **de esa misma observación**.
   *
   * Viaja con el equipo y no se lee del snapshot más reciente porque casi nunca
   * son el mismo: el leaderboard inserta filas sin gear ni item level cada vez
   * que cambia el rating, así que el último snapshot suele traer un null que se
   * leería como "no tiene equipo" al lado de una lista de dieciséis piezas.
   */
  equippedItemLevel: number | null;
  /** De qué observación sale este equipo. Puede ser de días antes que el rating. */
  provenance: ObservationProvenance;
}

interface GearRow {
  equipped_item_level: number | null;
  slot: string;
  item_id: string;
  item_name: string | null;
  item_level: number | null;
  quality: string | null;
  icon_url: string | null;
  captured_at: Date;
  source: ObservationProvenance["source"];
}

/**
 * El equipo del último snapshot **que traía equipo** de un personaje en un
 * bracket.
 *
 * No es "el del último snapshot" sin más, y la diferencia se ve en producción:
 * el leaderboard inserta filas sin gear cada vez que cambia el rating, así que
 * el snapshot más reciente casi nunca es el del último perfil descargado. Pedir
 * el equipo del último a secas devolvería vacío para casi todo el mundo, y ese
 * vacío se leería como "no lleva nada" en vez de como "esa observación no traía
 * equipo".
 *
 * El `left join` con `item_media` es deliberado: un item sin icono resuelto
 * sigue siendo una pieza que hay que enseñar (regla 5 y brief §4.5).
 */
export async function readLatestGear(
  db: Queryable,
  key: CharacterKey & { bracket: string; seasonId: number },
): Promise<CharacterGearRead | null> {
  const { rows } = await db.query<GearRow>(
    `with latest_with_gear as (
       select s.id, s.captured_at, s.source, s.equipped_item_level
         from character_snapshots s
         join characters c on c.id = s.character_id
        where c.region = $1 and c.realm_slug = $2 and c.name_slug = $3
          and s.bracket = $4 and s.season_id = $5
          and exists (select 1 from character_snapshot_gear g where g.snapshot_id = s.id)
        order by s.captured_at desc
        limit 1
     )
     select g.slot, g.item_id, g.item_name, g.item_level, g.quality,
            m.icon_url, l.captured_at, l.source, l.equipped_item_level
       from latest_with_gear l
       join character_snapshot_gear g on g.snapshot_id = l.id
       left join item_media m on m.item_id = g.item_id`,
    [key.region, key.realmSlug, key.nameSlug, key.bracket, key.seasonId],
  );

  const first = rows[0];
  if (!first) return null;

  return {
    // El orden lo pone el dominio y no la base: `character_snapshot_gear` no
    // guarda ninguna posición, y ordenar por el texto del slot dejaría la capa
    // entre el pecho y las muñecas.
    items: [...rows].sort((a, b) => compareGearSlots(a.slot, b.slot)).map(toGearItem),
    equippedItemLevel: first.equipped_item_level,
    provenance: { observedAt: first.captured_at, source: first.source },
  };
}

function toGearItem(row: GearRow): GearItemRead {
  return {
    slot: row.slot,
    // `item_id` es bigint y el driver lo entrega como texto: sin esto, dos
    // items distintos podrían compararse como cadenas en quien lo consuma.
    itemId: toNumber(row.item_id),
    itemName: row.item_name,
    itemLevel: row.item_level,
    quality: parseItemQuality(row.quality),
    iconUrl: row.icon_url,
  };
}
