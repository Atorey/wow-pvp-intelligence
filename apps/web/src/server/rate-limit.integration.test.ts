/**
 * El límite por IP contra una Postgres de verdad.
 *
 * El ejecutor falso de `rate-limit.test.ts` prueba qué SQL se emite y qué se
 * hace con lo que vuelve; no puede probar lo único que justifica que el
 * descuento sea una sola sentencia: que **dos peticiones simultáneas de la misma
 * clave no se lleven la misma ficha**, ni que dos que estrenan clave a la vez no
 * se concedan un cubo lleno cada una. Eso solo se ve con conexiones reales.
 *
 * El esquema se monta ejecutando el propio fichero de la migración: `apps/web`
 * no puede importar el runner, que vive en `apps/pipeline`, y la migración es
 * idempotente, así que aplicarla suelta es seguro.
 *
 * Necesita `TEST_DATABASE_URL` apuntando a una Postgres local. No cae de vuelta
 * a `DATABASE_URL` a propósito: `npm test` no puede tocar la base con la que
 * alguien desarrolla.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { BucketLimiter, type RateLimitRules } from "./rate-limit";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "db",
  "migrations",
  "0015_limite_por_ip_del_buscador.sql",
);

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

/** La misma comprobación que hace el seed: `npm test` no toca una base remota. */
const isLocal = (url: string): boolean => /@(localhost|127\.0\.0\.1|\[::1\])/.test(url);

const skip = !TEST_DATABASE_URL
  ? "TEST_DATABASE_URL no está definida: hace falta una Postgres local y desechable"
  : !isLocal(TEST_DATABASE_URL)
    ? "TEST_DATABASE_URL no apunta a esta máquina"
    : false;

/** Ventanas redondas: 60 fichas en 60 s es exactamente una por segundo. */
const RULES: RateLimitRules = {
  submit: { shortCapacity: 2, shortWindowSeconds: 60, longCapacity: 4, longWindowSeconds: 3_600 },
  suggest: { shortCapacity: 60, shortWindowSeconds: 60 },
  "gap-view": { shortCapacity: 60, shortWindowSeconds: 3_600 },
};

describe("límite por IP contra Postgres", { skip }, () => {
  let pool: pg.Pool;
  let limiter: BucketLimiter;

  before(async () => {
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL as string, max: 4, ssl: false });
    await pool.query(await readFile(MIGRATION, "utf8"));
    limiter = new BucketLimiter(pool, RULES);
  });

  after(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query("delete from rate_limit_buckets");
  });

  it("una clave nueva estrena el cubo lleno", async () => {
    assert.deepEqual(await limiter.take("submit", "nueva"), { limited: false });
    assert.deepEqual(await limiter.take("submit", "nueva"), { limited: false });

    const third = await limiter.take("submit", "nueva");
    assert.equal(third.limited, true);
  });

  it("dos peticiones a la vez sobre una clave que no existe no conceden dos cubos", async () => {
    // Sin la sentencia única, un `select` seguido de un `insert` dejaría a las
    // dos creyendo que estrenan cubo, y una de ellas reventaría por unicidad.
    const [first, second] = await Promise.all([
      limiter.take("suggest", "carrera"),
      limiter.take("suggest", "carrera"),
    ]);

    assert.deepEqual([first.limited, second.limited], [false, false]);

    const { rows } = await pool.query<{ short_tokens: string }>(
      "select short_tokens from rate_limit_buckets where scope = 'suggest' and key_hash = 'carrera'",
    );
    assert.equal(Number(rows[0]?.short_tokens), 58, "las dos han gastado, no solo una");
  });

  it("dos peticiones a la vez sobre la última ficha solo conceden una", async () => {
    await pool.query(
      `insert into rate_limit_buckets (scope, key_hash, short_tokens, long_tokens, updated_at)
       values ('suggest', 'ultima', 1, null, clock_timestamp())`,
    );

    const verdicts = await Promise.all([
      limiter.take("suggest", "ultima"),
      limiter.take("suggest", "ultima"),
    ]);

    assert.equal(verdicts.filter((verdict) => !verdict.limited).length, 1);
  });

  it("el cubo se rellena con el tiempo transcurrido, no con un job", async () => {
    // Cubo seco pero con treinta segundos de reloj atrasado: a una ficha por
    // segundo han entrado treinta.
    await pool.query(
      `insert into rate_limit_buckets (scope, key_hash, short_tokens, long_tokens, updated_at)
       values ('suggest', 'reloj', 0, null, clock_timestamp() - interval '30 seconds')`,
    );

    assert.deepEqual(await limiter.take("suggest", "reloj"), { limited: false });

    const { rows } = await pool.query<{ short_tokens: string }>(
      "select short_tokens from rate_limit_buckets where key_hash = 'reloj'",
    );
    assert.ok(Math.abs(Number(rows[0]?.short_tokens) - 29) < 0.5);
  });

  it("la ventana larga limita aunque quede ráfaga", async () => {
    // Cuatro envíos gastan el presupuesto horario; el quinto tiene ficha de
    // minuto y aun así no pasa.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await pool.query(
        "update rate_limit_buckets set updated_at = clock_timestamp() - interval '60 seconds' where key_hash = 'hora'",
      );
      assert.deepEqual(await limiter.take("submit", "hora"), { limited: false });
    }

    await pool.query(
      "update rate_limit_buckets set updated_at = clock_timestamp() - interval '60 seconds' where key_hash = 'hora'",
    );
    const fifth = await limiter.take("submit", "hora");

    assert.equal(fifth.limited, true);
  });

  it("un ámbito de una sola ventana deja la columna larga nula", async () => {
    await limiter.take("gap-view", "una-ventana");

    const { rows } = await pool.query<{ long_tokens: string | null }>(
      "select long_tokens from rate_limit_buckets where scope = 'gap-view'",
    );
    assert.equal(rows[0]?.long_tokens, null);
  });
});
