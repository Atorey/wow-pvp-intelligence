/**
 * El presupuesto compartido contra una Postgres de verdad.
 *
 * El ejecutor falso de `quota.test.ts` prueba qué SQL se emite y qué se hace
 * con lo que vuelve; no puede probar lo único que justifica que el descuento
 * sea una sola sentencia: que **dos procesos compitiendo no se lleven la misma
 * ficha**. Eso solo se ve con dos conexiones reales corriendo a la vez, y es lo
 * que sostiene toda la decisión 3 del
 * [ADR 0013](../../../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md).
 *
 * Necesita `TEST_DATABASE_URL` apuntando a una Postgres local. No cae de vuelta
 * a `DATABASE_URL` a propósito, por la misma razón que el test de integración
 * del schema: `npm test` no puede tocar la base con la que alguien desarrolla.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type pg from "pg";
import { applyMigrations } from "../db/migrate";
import { createPool } from "../db/pool";
import { isLocalDatabase } from "../jobs/seed";
import { QuotaLedger, readSharedToken, writeSharedToken, type QuotaLimits } from "./quota";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

const skip = !TEST_DATABASE_URL
  ? "TEST_DATABASE_URL no está definida: hace falta una Postgres local y desechable"
  : !isLocalDatabase(TEST_DATABASE_URL)
    ? "TEST_DATABASE_URL no apunta a esta máquina"
    : false;

/**
 * Un techo horario pequeño y redondo: 3.600/h es exactamente 1 ficha por
 * segundo, así que el rellenado se puede afirmar con números a mano en vez de
 * con tolerancias.
 */
const LIMITS: QuotaLimits = {
  secondCapacity: 80,
  hourCapacity: 3_600,
  onDemandReserve: 500,
};

describe("presupuesto de cuota contra Postgres", { skip }, () => {
  let pool: pg.Pool;
  let ledger: QuotaLedger;

  before(async () => {
    pool = createPool(TEST_DATABASE_URL as string);
    const log = console.log;
    console.log = (): void => {};
    try {
      await applyMigrations(pool);
    } finally {
      console.log = log;
    }
    ledger = new QuotaLedger(pool, LIMITS);
  });

  after(async () => {
    await pool?.end();
  });

  /**
   * Se fija el estado del bucket en vez de truncar la tabla: la fila la crea la
   * migración y es única, así que borrarla dejaría al resto de tests (y al
   * pipeline, si alguien corre esto contra su base) sin presupuesto.
   */
  async function setBucket(hourTokens: number, secondTokens = 80, idleSeconds = 0): Promise<void> {
    await pool.query(
      `update blizzard_quota
          set hour_tokens = $1,
              second_tokens = $2,
              updated_at = clock_timestamp() - ($3 || ' seconds')::interval
        where id = 1`,
      [hourTokens, secondTokens, idleSeconds],
    );
  }

  async function hourTokens(): Promise<number> {
    const row = (
      await pool.query<{ hour_tokens: string }>("select hour_tokens from blizzard_quota")
    ).rows[0];
    return Number(row?.hour_tokens);
  }

  beforeEach(async () => {
    await setBucket(LIMITS.hourCapacity);
  });

  it("descuenta una ficha por petición concedida", async () => {
    await setBucket(1_000);

    const grant = await ledger.take("on-demand");

    assert.equal(grant.granted, true);
    assert.ok(Math.abs((await hourTokens()) - 999) < 0.1, "queda una ficha menos");
  });

  it("se rellena solo con el tiempo, sin que nadie lo recargue", async () => {
    // Vacío hace diez segundos: a 1 ficha/s han entrado diez.
    await setBucket(0, 80, 10);

    const grant = await ledger.take("on-demand");

    assert.equal(grant.granted, true);
    assert.ok(Math.abs((await hourTokens()) - 9) < 0.2, "diez fichas rellenadas, una gastada");
  });

  it("no rellena por encima de la capacidad", async () => {
    // Lleno y sin tocar desde hace una hora: no se acumula deuda a favor. Es lo
    // que distingue un token bucket de una ventana, que dejaría gastar dos
    // presupuestos enteros a caballo del borde.
    await setBucket(LIMITS.hourCapacity, 80, 3_600);

    await ledger.take("batch");

    assert.ok((await hourTokens()) <= LIMITS.hourCapacity, "el bucket no desborda");
  });

  it("la reserva frena al trabajo de fondo y deja pasar a on-demand", async () => {
    // Justo en el colchón: `batch` necesita 501 fichas y `on-demand` solo una.
    await setBucket(LIMITS.onDemandReserve);

    const background = await ledger.take("aggregate");
    const urgent = await ledger.take("on-demand");

    assert.equal(background.granted, false, "el agregado no toca el colchón");
    assert.equal(urgent.granted, true, "quien tiene a alguien esperando sí");
  });

  it("dice cuánto falta para la siguiente ficha en vez de solo negarse", async () => {
    // Faltan dos fichas para poder gastar por encima del colchón, y entran a 1/s.
    await setBucket(LIMITS.onDemandReserve - 1);

    const grant = await ledger.take("batch");

    assert.equal(grant.granted, false);
    assert.ok(
      grant.granted === false && grant.retryAfterMs >= 1_900 && grant.retryAfterMs <= 2_100,
      `esperaba ~2s, recibió ${grant.granted === false ? grant.retryAfterMs : "concedido"}`,
    );
  });

  it("dos procesos compitiendo por la última ficha: solo uno se la lleva", async () => {
    // El test que justifica que el descuento sea una sola sentencia sin CTE.
    // Con las expresiones repetidas en el `where`, el perdedor de la carrera
    // reevalúa contra la fila ya actualizada; con un CTE se quedaría con el
    // snapshot anterior y gastaría una ficha que ya no existe.
    await setBucket(1);

    const [a, b] = await Promise.all([ledger.take("on-demand"), ledger.take("on-demand")]);

    assert.equal([a, b].filter((g) => g.granted).length, 1, "exactamente una concesión");
    assert.ok((await hourTokens()) < 1, "y el bucket no queda en negativo ni intacto");
  });

  it("veinte peticiones simultáneas no gastan más de lo que hay", async () => {
    await setBucket(5);

    const grants = await Promise.all(Array.from({ length: 20 }, () => ledger.take("on-demand")));

    assert.equal(grants.filter((g) => g.granted).length, 5, "cinco fichas, cinco concesiones");
  });

  describe("token compartido", () => {
    it("va y vuelve por la tabla", async () => {
      const expiresAt = new Date(Date.now() + 86_400_000);

      await writeSharedToken(pool, { value: "token-de-prueba", expiresAt });
      const stored = await readSharedToken(pool);

      assert.equal(stored?.value, "token-de-prueba");
      assert.equal(stored?.expiresAt.getTime(), expiresAt.getTime());
    });

    it("una estampida de arranques en frío deja el token que más dura", async () => {
      const corto = new Date(Date.now() + 60_000);
      const largo = new Date(Date.now() + 86_400_000);

      await writeSharedToken(pool, { value: "largo", expiresAt: largo });
      await writeSharedToken(pool, { value: "corto", expiresAt: corto });

      assert.equal((await readSharedToken(pool))?.value, "largo");
    });
  });
});
