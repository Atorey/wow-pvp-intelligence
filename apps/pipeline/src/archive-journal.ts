import type pg from "pg";
import type { Queryable } from "@wowpvp/data";
import { deleteObjects, type Fetch, type StorageConfig } from "@wowpvp/storage";

/**
 * Lo que comparten los jobs que escriben en el bucket del archivo: un candado
 * para no pisarse y un diario de lo que sobra (ADR 0043).
 *
 * El archivo no se sobrescribe nunca (ADR 0034). Desde que hay que borrar de él
 * a quien ya no existe, eso significa que un lote se reescribe en una ruta
 * nueva y la vieja se borra, y entre las dos cosas cabe un corte. El diario es
 * lo que hace que ningún corte deje datos atrás: quien va a subir anota antes la
 * ruta en `archive_garbage`, y la desanota en la misma transacción que la apunta
 * desde la bitácora. Lo que queda anotado no lo lee nadie y se puede borrar.
 */

/**
 * El candado de los jobs que escriben en el archivo.
 *
 * Hace falta porque el diario solo es seguro con un escritor a la vez: una
 * ruta anotada puede ser la de una subida que otro proceso está a punto de
 * confirmar, y si alguien recogiera la basura en ese momento se llevaría un
 * lote cuyas filas ya no están en Postgres. Es un candado de sesión, así que va
 * sobre el client que hace el trabajo y se suelta al cerrarlo.
 */
const ARCHIVE_LOCK = "wowpvp:archive";

/** Toma el candado o falla: dos escritores a la vez no se esperan, se avisan. */
export async function takeArchiveLock(client: pg.PoolClient): Promise<void> {
  const { rows } = await client.query<{ locked: boolean }>(
    "select pg_try_advisory_lock(hashtext($1)) as locked",
    [ARCHIVE_LOCK],
  );
  if (!rows[0]?.locked) {
    throw new Error(
      "Otro proceso está escribiendo en el archivo (archive-snapshots, purge-archive o " +
        "backfill-rating-history). Espera a que termine y vuelve a lanzarlo.",
    );
  }
}

export async function releaseArchiveLock(client: pg.PoolClient): Promise<void> {
  await client.query("select pg_advisory_unlock(hashtext($1))", [ARCHIVE_LOCK]);
}

/** Anota rutas que van a subirse, antes de subirlas. Se confirma aparte, fuera de cualquier transacción. */
export async function noteGarbage(db: Queryable, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  await db.query(
    `insert into archive_garbage (object_path)
     select * from unnest($1::text[])
     on conflict (object_path) do nothing`,
    [paths],
  );
}

/** Desanota rutas: va en la transacción que las apunta desde una bitácora. */
export async function forgetGarbage(db: Queryable, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  await db.query("delete from archive_garbage where object_path = any($1::text[])", [paths]);
}

/**
 * Borra de Storage lo anotado y después lo desanota. Devuelve cuántas rutas
 * había.
 *
 * En ese orden: si el borrado se corta, las rutas siguen anotadas y la próxima
 * corrida lo repite, y borrar lo que ya no está no es un error.
 */
export async function collectGarbage(
  db: Queryable,
  storage: StorageConfig,
  fetchFn: Fetch = fetch,
): Promise<number> {
  const { rows } = await db.query<{ object_path: string }>(
    "select object_path from archive_garbage order by object_path",
  );
  const paths = rows.map((row) => row.object_path);
  if (paths.length === 0) return 0;

  await deleteObjects(storage, paths, fetchFn);
  await forgetGarbage(db, paths);
  return paths.length;
}
