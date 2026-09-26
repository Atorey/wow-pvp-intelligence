import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToRatingHistoryShard,
  emptyRatingHistoryShard,
  groupByRatingHistoryObject,
  mergeRatingPoints,
  parseRatingHistoryShard,
  ratingHistoryPath,
  ratingHistoryShard,
  serializeRatingHistoryShard,
  seriesKey,
  type RatingObservation,
} from "./rating-history";

const MAGE = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PRIEST = "3F000000-0000-4000-8000-000000000000";
const OTHER = "a1b2c3d4-0000-4000-8000-000000000000";

const at = (day: number, hour = 12): Date => new Date(Date.UTC(2026, 7, day, hour));

function observation(
  characterId: string,
  day: number,
  rating: number,
  bracket = "shuffle-mage-frost",
): RatingObservation {
  return { characterId, bracket, seasonId: 42, at: at(day), rating };
}

test("el shard son los dos primeros dígitos del id, sin distinguir mayúsculas", () => {
  assert.equal(ratingHistoryShard(MAGE), "3f");
  assert.equal(ratingHistoryShard(PRIEST), "3f");
  assert.equal(ratingHistoryShard(OTHER), "a1");
  assert.throws(() => ratingHistoryShard("zz-no-es-un-uuid"), /hexadecimales/);
});

test("cada temporada tiene su carpeta dentro del índice", () => {
  assert.equal(ratingHistoryPath(42, "3f"), "rating-history/s42/3f.json.gz");
});

test("la unión ordena por fecha y no cuenta dos veces la misma observación", () => {
  const archived = [
    { at: at(3), rating: 1800 },
    { at: at(1), rating: 1700 },
  ];
  // El pico sigue caliente en Postgres y está también en el índice.
  const hot = [
    { at: at(3), rating: 1800 },
    { at: at(20), rating: 1850 },
  ];

  assert.deepEqual(
    mergeRatingPoints(archived, hot).map((point) => point.rating),
    [1700, 1800, 1850],
  );
  // Da igual el orden de los trozos y cuántas veces se junte el mismo.
  assert.deepEqual(mergeRatingPoints(hot, archived, archived), mergeRatingPoints(archived, hot));
});

test("dos observaciones del mismo día con fecha distinta son dos puntos", () => {
  // Entre dos lecturas del leaderboard de un mismo día el rating se mueve, y
  // quedarse con una por día escondería el pico que enseña la ficha.
  const points = mergeRatingPoints([
    { at: at(5, 3), rating: 1900 },
    { at: at(5, 21), rating: 1860 },
  ]);
  assert.equal(points.length, 2);
});

test("un shard se funde con lo que ya tenía y vuelve igual del disco", () => {
  const shard = emptyRatingHistoryShard(42, "3f");
  addToRatingHistoryShard(shard, [observation(MAGE, 1, 1700), observation(MAGE, 2, 1750)]);
  const touched = addToRatingHistoryShard(shard, [
    observation(MAGE, 2, 1750),
    observation(MAGE, 3, 1720),
    observation(PRIEST, 1, 2100, "shuffle-priest-holy"),
  ]);

  assert.equal(touched, 2);
  assert.deepEqual(
    shard.series.get(seriesKey(MAGE, "shuffle-mage-frost"))?.map((point) => point.rating),
    [1700, 1750, 1720],
  );

  const back = parseRatingHistoryShard(serializeRatingHistoryShard(shard));
  assert.equal(back.seasonId, 42);
  assert.equal(back.shard, "3f");
  assert.deepEqual(back.series, shard.series);
});

test("el mismo contenido da siempre el mismo fichero", () => {
  const one = emptyRatingHistoryShard(42, "3f");
  addToRatingHistoryShard(one, [observation(MAGE, 1, 1700), observation(PRIEST, 1, 2100)]);
  const other = emptyRatingHistoryShard(42, "3f");
  addToRatingHistoryShard(other, [observation(PRIEST, 1, 2100), observation(MAGE, 1, 1700)]);

  assert.equal(serializeRatingHistoryShard(one), serializeRatingHistoryShard(other));
});

test("un shard no admite observaciones que no son suyas", () => {
  const shard = emptyRatingHistoryShard(42, "3f");
  assert.throws(
    () => addToRatingHistoryShard(shard, [observation(OTHER, 1, 1700)]),
    /no pertenece/,
  );
  assert.throws(
    () => addToRatingHistoryShard(shard, [{ ...observation(MAGE, 1, 1700), seasonId: 41 }]),
    /no pertenece/,
  );
});

test("las observaciones se agrupan por el objeto que hay que reescribir", () => {
  const groups = groupByRatingHistoryObject([
    observation(MAGE, 1, 1700),
    observation(PRIEST, 1, 2100),
    observation(OTHER, 1, 1500),
    { ...observation(MAGE, 1, 1650), seasonId: 41 },
  ]);

  assert.deepEqual([...groups.keys()].sort(), [
    "rating-history/s41/3f.json.gz",
    "rating-history/s42/3f.json.gz",
    "rating-history/s42/a1.json.gz",
  ]);
  assert.equal(groups.get("rating-history/s42/3f.json.gz")?.observations.length, 2);
});

test("un fichero que no es del formato no se interpreta a medias", () => {
  assert.throws(() => parseRatingHistoryShard(`{"v":2,"season":42,"shard":"3f","series":{}}`));
  assert.throws(
    () => parseRatingHistoryShard(`{"v":1,"season":42,"shard":"3f","series":{"k":[[1,"1800"]]}}`),
    /mal formado/,
  );
  assert.throws(() => parseRatingHistoryShard("no es json"));
});
