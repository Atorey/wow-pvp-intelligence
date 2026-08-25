/**
 * El test que le faltaba a `packages/data`: sus lecturas contra el schema real.
 *
 * El ejecutor falso de ese paquete prueba el mapeo y qué SQL se emite, no que
 * las columnas existan — un `rating_p25` mal escrito pasa el typecheck y los
 * tests y falla en la primera consulta de verdad. Es el hueco que el
 * [ADR 0014](../../../../docs/decisions/0014-capa-de-lectura-compartida.md)
 * dejó anotado y que cierra este issue: aquí se migra una base desechable, se
 * siembra con el dataset de desarrollo, se agregan los segmentos con el job de
 * producción y después se ejecuta **cada** lectura del paquete.
 *
 * Necesita `TEST_DATABASE_URL` apuntando a una Postgres local y **vacía**: la
 * primera cosa que hace es truncarla. No cae de vuelta a `DATABASE_URL` a
 * propósito — `npm test` no puede llevarse por delante la base con la que
 * alguien está desarrollando la web.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type pg from "pg";
import { MIN_SAMPLE_HIGH, shuffleBracketId, requireSpecSlug } from "@wowpvp/core";
import {
  isComparable,
  readActivity,
  readAdoption,
  readBracketSegments,
  readLatestSnapshot,
  readLatestSnapshotsByBracket,
  readSegment,
  readStanding,
  type SegmentRead,
} from "@wowpvp/data";
import { getRegion } from "../config";
import { applyMigrations } from "../db/migrate";
import { createPool } from "../db/pool";
import { refreshAggregates } from "./refresh-aggregates";
import { buildSeedDataset, loadItemCatalog, CURRENT_SEASON, PREVIOUS_SEASON } from "./seed-dataset";
import { isLocalDatabase, resetDatabase, seedDatabase } from "./seed";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

const skip = !TEST_DATABASE_URL
  ? "TEST_DATABASE_URL no está definida: hace falta una Postgres local y desechable"
  : !isLocalDatabase(TEST_DATABASE_URL)
    ? "TEST_DATABASE_URL no apunta a esta máquina, y este test trunca lo que encuentra"
    : false;

const region = getRegion();
const frostMage = shuffleBracketId(requireSpecSlug("frost-mage"));
const restoShaman = shuffleBracketId(requireSpecSlug("restoration-shaman"));

describe("lecturas de @wowpvp/data contra el schema real", { skip }, () => {
  let pool: pg.Pool;

  before(async () => {
    pool = createPool(TEST_DATABASE_URL as string);

    // El ruido de las migraciones y del recálculo no aporta nada al informe de
    // tests; un fallo sigue saliendo porque viaja en la excepción.
    const log = console.log;
    console.log = (): void => {};
    try {
      await applyMigrations(pool);
      await resetDatabase(pool);
      await seedDatabase(
        pool,
        buildSeedDataset({ now: new Date(), seed: "integration", catalog: loadItemCatalog() }),
        region,
      );
      await refreshAggregates([], pool);
    } finally {
      console.log = log;
    }
  });

  after(async () => {
    await pool?.end();
  });

  describe("readSegment", () => {
    it("devuelve el escalón con confianza `high` y su procedencia completa", async () => {
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        segmentId: "2000-2200",
      });

      assert.ok(segment, "no se calculó el escalón 2000-2200 de Frost Mage");
      assert.equal(segment.classSlug, "mage");
      assert.equal(segment.specSlug, "frost");
      assert.equal(segment.segment.min, 2000);
      assert.equal(segment.segment.max, 2200);
      assert.ok(segment.population.sampleSize >= MIN_SAMPLE_HIGH);
      assert.equal(segment.gear.confidence, "high");
      assert.ok(isComparable(segment.gear));
      assert.ok(segment.rating.median !== null && segment.rating.median >= 2000);
      assert.ok(segment.rating.p25 !== null && segment.rating.p75 !== null);
      assert.ok(segment.equippedItemLevelMedian !== null);
      assert.ok(segment.profileData.from instanceof Date);
      assert.ok(segment.profileData.to instanceof Date);
      assert.ok(segment.activity.byDelta + segment.activity.byFirstSeen > 0);
      assert.ok([7, 14, 30].includes(segment.activityWindowDays));
    });

    it("distingue población suficiente de base de comparación suficiente (#76)", async () => {
      // El escalón de 48 personas con 9 perfiles: la columna `confidence` de la
      // tabla diría `medium`, y la comparación no se puede enseñar. Es el caso
      // que obliga a derivar la confianza del denominador de cada cifra.
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        segmentId: "2200-2400",
      });

      assert.ok(segment);
      assert.notEqual(segment.population.confidence, "insufficient");
      assert.equal(segment.gear.confidence, "insufficient");
      assert.equal(isComparable(segment.gear), false);
    });

    it("un escalón sin un solo perfil devuelve fila, no null", async () => {
      // Poder explicar por qué no hay comparación (ADR 0011) exige que la fila
      // exista: una página en blanco no distingue "no llega la muestra" de
      // "nunca se calculó".
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: restoShaman,
        segmentId: "1800-2000",
      });

      assert.ok(segment);
      assert.ok(segment.population.sampleSize > 0);
      assert.equal(segment.gear.sampleSize > 0, true);
      assert.equal(segment.gear.denominator, 0);
      assert.equal(segment.gear.confidence, "insufficient");
      assert.equal(segment.itemLevel.denominator, 0);
      assert.equal(segment.profileData.from, null);
    });

    it("null solo cuando el par no se ha calculado nunca", async () => {
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        segmentId: "2800-3000",
      });
      assert.equal(segment, null);
    });

    it("cuenta los excluidos por venir solo de búsqueda (ADR 0007)", async () => {
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        segmentId: "1600-1800",
      });

      assert.ok(segment);
      assert.ok(segment.excludedSearch >= 2, "no se contó la población que solo vino de búsqueda");
    });
  });

  describe("readBracketSegments", () => {
    it("devuelve los escalones del bracket ordenados y de una sola corrida", async () => {
      const segments = await readBracketSegments(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
      });

      assert.ok(segments.length >= 4);
      const mins = segments.map((segment) => segment.segment.min);
      assert.deepEqual(
        mins,
        [...mins].sort((a, b) => a - b),
      );

      const stamps = new Set(segments.map((segment) => segment.population.computedAt.getTime()));
      assert.equal(stamps.size, 1, "hay escalones de corridas distintas en la misma lista");
    });
  });

  describe("readAdoption", () => {
    let target: SegmentRead;

    before(async () => {
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        segmentId: "2000-2200",
      });
      assert.ok(segment);
      target = segment;
    });

    it("devuelve los items con su denominador y su confianza derivada", async () => {
      const adoption = await readAdoption(pool, target, "gear-item", { limit: 5 });

      assert.equal(adoption.length, 5);
      for (const item of adoption) {
        assert.equal(item.kind, "gear-item");
        assert.ok(item.itemId !== null);
        assert.ok(item.itemName, "el nombre del item se guarda para pintar sin resolver ids");
        assert.ok(item.slotGroup);
        assert.ok(item.rate > 0 && item.rate <= 1);
        assert.equal(item.provenance.denominator, target.gear.denominator);
        assert.equal(item.provenance.confidence, "high");
        assert.ok(item.users <= item.provenance.denominator);
      }

      const rates = adoption.map((item) => item.rate);
      assert.deepEqual(
        rates,
        [...rates].sort((a, b) => b - a),
      );
    });

    it("agrupa los slots intercambiables: TRINKET, nunca TRINKET_1", async () => {
      const adoption = await readAdoption(pool, target, "gear-item");
      const groups = new Set(adoption.map((item) => item.slotGroup));
      assert.ok(groups.has("TRINKET"));
      assert.equal(groups.has("TRINKET_1"), false);
      assert.equal(groups.has("TABARD"), false, "lo cosmético no se agrega");
    });

    it("devuelve también los códigos de talentos, sin slot ni item", async () => {
      const adoption = await readAdoption(pool, target, "talent-code");

      assert.ok(adoption.length > 0);
      for (const code of adoption) {
        assert.equal(code.kind, "talent-code");
        assert.equal(code.slotGroup, null);
        assert.equal(code.itemId, null);
      }
      // El denominador de talentos es menor que el de gear: hay perfiles sin
      // código, y esos salen del denominador en vez de contar como no-adopción.
      assert.ok(target.talents.denominator < target.gear.denominator);
      assert.ok(target.talents.denominator > 0);
    });

    it("no devuelve nada de un escalón sin perfiles, y no falla", async () => {
      const segment = await readSegment(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: restoShaman,
        segmentId: "1800-2000",
      });
      assert.ok(segment);
      assert.deepEqual(await readAdoption(pool, segment, "gear-item"), []);
    });
  });

  describe("lecturas de personaje", () => {
    const valdes = { region, realmSlug: "sanguino", nameSlug: "váldes" };

    it("readLatestSnapshot devuelve la última observación con su procedencia", async () => {
      const snapshot = await readLatestSnapshot(pool, {
        ...valdes,
        bracket: frostMage,
        seasonId: CURRENT_SEASON,
      });

      assert.ok(snapshot, "el personaje documentado del seed no está en la base");
      assert.equal(snapshot.nameDisplay, "Váldes");
      assert.equal(snapshot.realmSlug, "sanguino");
      assert.equal(snapshot.specSlug, "frost");
      assert.ok(snapshot.rating > 0);
      assert.ok(snapshot.provenance.observedAt instanceof Date);
      assert.ok(["leaderboard", "profile", "search"].includes(snapshot.provenance.source));
    });

    it("readLatestSnapshotsByBracket devuelve una fila por bracket jugado", async () => {
      const snapshots = await readLatestSnapshotsByBracket(pool, {
        ...valdes,
        seasonId: CURRENT_SEASON,
      });

      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0]?.bracket, frostMage);
    });

    it("el mismo personaje tiene histórico en la temporada anterior", async () => {
      const previous = await readLatestSnapshotsByBracket(pool, {
        ...valdes,
        seasonId: PREVIOUS_SEASON,
      });

      assert.equal(previous.length, 1);
      assert.equal(previous[0]?.seasonId, PREVIOUS_SEASON);
    });

    it("readActivity dice hasta dónde se puede demostrar que jugó", async () => {
      const snapshot = await readLatestSnapshot(pool, {
        ...valdes,
        bracket: frostMage,
        seasonId: CURRENT_SEASON,
      });
      assert.ok(snapshot);

      const activity = await readActivity(pool, {
        characterId: snapshot.characterId,
        bracket: frostMage,
        seasonId: CURRENT_SEASON,
      });

      assert.ok(activity);
      assert.equal(activity.evidence, "played-delta");
      assert.ok(activity.observations >= 2, "sin dos observaciones no puede haber delta");
      // La presencia va por delante del último cambio: le hemos visto en la
      // lista más veces de las que ha cambiado algo (ADR 0009).
      assert.ok(activity.lastSeenAt >= activity.lastActiveAt);
    });

    it("readActivity devuelve null en la temporada que no se recalculó", async () => {
      const snapshot = await readLatestSnapshot(pool, {
        ...valdes,
        bracket: frostMage,
        seasonId: PREVIOUS_SEASON,
      });
      assert.ok(snapshot);

      // null es "no consta", no "está inactivo": `refresh-activity` reconstruye
      // la temporada vigente, así que de la anterior no hay fila.
      const activity = await readActivity(pool, {
        characterId: snapshot.characterId,
        bracket: frostMage,
        seasonId: PREVIOUS_SEASON,
      });
      assert.equal(activity, null);
    });

    it("readStanding cuenta observados y calcula el percentil", async () => {
      const standing = await readStanding(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        rating: 1900,
      });

      assert.ok(standing.observed > 100);
      assert.ok(standing.below > 0 && standing.below < standing.observed);
      assert.ok(standing.percentile !== null);
      assert.ok(standing.percentile > 0 && standing.percentile < 100);
    });

    it("readStanding no cuenta a quien solo vino de una búsqueda", async () => {
      // Sildrath está a 1451 y solo existe porque alguien lo buscó: la
      // población que cuenta el percentil es la misma que la de los agregados
      // (ADR 0011, punto 5), así que no puede aparecer aquí.
      const standing = await readStanding(pool, {
        region,
        seasonId: CURRENT_SEASON,
        bracket: frostMage,
        rating: 1500,
      });

      const { rows } = await pool.query<{ total: string }>(
        `select count(*)::text as total
           from character_snapshots s
           join characters c on c.id = s.character_id
          where c.name_slug = 'sildrath' and s.source = 'search'`,
      );
      assert.equal(rows[0]?.total, "1", "el personaje de búsqueda no se sembró");
      assert.equal(standing.below, 0);
    });
  });
});
