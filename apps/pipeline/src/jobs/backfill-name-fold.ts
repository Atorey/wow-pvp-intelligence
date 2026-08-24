/**
 * Rellena `characters.name_fold` en las filas que vienen de antes de #70.
 *
 * Existe como job y no como `update` dentro de la migración por la razón del
 * ADR 0017: la regla de plegado es `foldSlug()` de `packages/core` y no puede
 * tener una segunda escritura en SQL. `unaccent` de Postgres daría un resultado
 * distinto —no conoce `ø`, `æ` ni `ß`, que son 20.081 nombres de la población
 * acumulada— y la búsqueda fallaría justo en los nombres que motivaron el
 * issue, sin que nada rompiera.
 *
 * Es idempotente y se puede parar a media faena: solo toca las filas cuyo
 * plegado guardado no coincide con el que calcula `foldSlug()` hoy, así que
 * también es la forma de propagar un cambio en la tabla de equivalencias.
 */
import { foldSlug } from "@wowpvp/core";
import type pg from "pg";
import { createPool } from "../db/pool";

/** Filas por lote. Ni una a una (127k viajes) ni todas de golpe (todo en RAM). */
const BATCH_SIZE = 5_000;

interface CharacterRow {
  id: string;
  name_slug: string;
  name_fold: string | null;
}

export async function backfillNameFold(args: string[] = []): Promise<void> {
  const dryRun = args.includes("--dry-run");
  const pool = createPool();

  try {
    const { rows } = await pool.query<CharacterRow>(
      "select id, name_slug, name_fold from characters order by id",
    );

    const stale = rows.filter((row) => row.name_fold !== foldSlug(row.name_slug));
    const nuevas = stale.filter((row) => row.name_fold === null).length;

    console.log(
      `${rows.length} personajes; ${stale.length} por plegar (${nuevas} sin plegar aún).`,
    );

    if (stale.length === 0) {
      console.log("Nada que hacer.");
      return;
    }

    if (dryRun) {
      console.log("\nMuestra de lo que se escribiría:");
      for (const row of stale.slice(0, 10)) {
        console.log(`  ${row.name_slug} → ${foldSlug(row.name_slug)}`);
      }
      console.log("\n--dry-run: no se ha escrito nada.");
      return;
    }

    let done = 0;
    for (let i = 0; i < stale.length; i += BATCH_SIZE) {
      const batch = stale.slice(i, i + BATCH_SIZE);
      await updateBatch(pool, batch);
      done += batch.length;
      console.log(`  ${done}/${stale.length}`);
    }

    console.log(`\n${done} personaje(s) plegado(s).`);
  } finally {
    await pool.end();
  }
}

async function updateBatch(pool: pg.Pool, batch: readonly CharacterRow[]): Promise<void> {
  await pool.query(
    `update characters c
        set name_fold = u.name_fold
       from unnest($1::uuid[], $2::text[]) as u(id, name_fold)
      where c.id = u.id`,
    [batch.map((row) => row.id), batch.map((row) => foldSlug(row.name_slug))],
  );
}
