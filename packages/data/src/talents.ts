import type { TalentTree } from "@wowpvp/core";
import type { CharacterKey } from "./characters";
import type { ObservationProvenance } from "./provenance";
import type { Queryable } from "./queryable";

/**
 * Un nodo de talento observado en un personaje, no un agregado.
 *
 * Lleva `ObservationProvenance` por lo mismo que el equipo: es el dato de una
 * persona, así que no hay muestra ni confianza que declarar, hay una fecha y una
 * fuente. Y la fecha importa igual — el loadout es el del día en que se
 * descargó su perfil, que casi nunca es el del rating (ADR 0009).
 */
export interface TalentNodeRead {
  tree: TalentTree;
  /** Id del nodo; en 'pvp', del talento. */
  talentId: number;
  /**
   * El talento elegido en el nodo, que es lo que se compara con el segmento
   * (ADR 0044): en un nodo de elección el id del nodo no dice cuál de los dos
   * lleva. `null` es "no disponible", igual que en el agregado.
   */
  selectedTalentId: number | null;
  /**
   * `null` es "no disponible" (regla 5), no "sin nombre": la API deja algún nodo
   * sin tooltip y ese nodo sí está observado, solo que no sabemos llamarlo.
   */
  talentName: string | null;
  /** Puntos invertidos. `null` en los talentos PvP, que no tienen rangos. */
  rank: number | null;
}

export interface CharacterTalentsRead {
  nodes: TalentNodeRead[];
  provenance: ObservationProvenance;
}

interface TalentRow {
  tree: TalentTree;
  node_id: number;
  selected_talent_id: number | null;
  talent_name: string | null;
  rank: number | null;
  captured_at: Date;
  source: ObservationProvenance["source"];
}

/**
 * Los nodos del último snapshot **que traía nodos** de un personaje en un
 * bracket.
 *
 * Espejo de `readLatestGear()` y por la misma razón, que no es simetría: el
 * leaderboard inserta filas sin loadout cada vez que cambia el rating, así que
 * el snapshot más reciente casi nunca es el del último perfil descargado. Pedir
 * los talentos del último a secas devolvería vacío para casi todo el mundo, y
 * ese vacío se leería como "no lleva talentos" en vez de como "esa observación
 * no traía loadout".
 *
 * Lo que la caja Player Gap hace con esto es marcar qué talentos de la lista
 * lleva ya quien mira. Uno sin marca es "no lo lleva" solo si este read devolvió
 * algo; si devuelve `null`, no se marca ninguno, porque entonces la ausencia de
 * marca sería una afirmación que no hemos observado.
 */
export async function readLatestTalents(
  db: Queryable,
  key: CharacterKey & { bracket: string; seasonId: number },
): Promise<CharacterTalentsRead | null> {
  const { rows } = await db.query<TalentRow>(
    `with latest_with_talents as (
       select s.id, s.captured_at, s.source
         from character_snapshots s
         join characters c on c.id = s.character_id
        where c.region = $1 and c.realm_slug = $2 and c.name_slug = $3
          and s.bracket = $4 and s.season_id = $5
          and exists (select 1 from character_snapshot_talents t where t.snapshot_id = s.id)
        order by s.captured_at desc
        limit 1
     )
     select t.tree, lab.node_id, lab.talent_id as selected_talent_id, lab.name as talent_name,
            sel.rank, l.captured_at, l.source
       from latest_with_talents l
       join character_snapshot_talent_trees t on t.snapshot_id = l.id
       -- Los dos arrays se abren en el mismo unnest y no en dos: es lo que los
       -- empareja posición a posición, que es la única relación que hay entre
       -- una etiqueta y su rango. En 'pvp' ranks es null entero y esta forma
       -- devuelve los nodos con rango null, que es justo lo que significa.
       cross join lateral unnest(t.label_ids, t.ranks) as sel(label_id, rank)
       join talent_labels lab on lab.id = sel.label_id`,
    [key.region, key.realmSlug, key.nameSlug, key.bracket, key.seasonId],
  );

  const first = rows[0];
  if (!first) return null;

  return {
    nodes: rows.map((row) => ({
      tree: row.tree,
      talentId: row.node_id,
      selectedTalentId: row.selected_talent_id,
      talentName: row.talent_name,
      rank: row.rank,
    })),
    provenance: { observedAt: first.captured_at, source: first.source },
  };
}
