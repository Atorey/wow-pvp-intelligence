import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VISITOR_TTL_DAYS, freshVisitor, parseVisitor } from "./visitor";

const NOW = Date.UTC(2026, 8, 6);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("el identificador del visitante", () => {
  it("caduca, y lo caducado se lee igual que lo que no existe", () => {
    // Que caduque es lo que impide que una medición agregada se convierta en un
    // registro de navegación de años (ADR 0028).
    const visitor = freshVisitor("id", NOW);
    assert.equal(parseVisitor(JSON.stringify(visitor), NOW)?.id, "id");
    assert.equal(parseVisitor(JSON.stringify(visitor), NOW + VISITOR_TTL_DAYS * DAY_MS), null);
  });

  it("descarta lo que no reconoce en vez de fallar", () => {
    // En `localStorage` escribe cualquier versión anterior del sitio, y una
    // entrada con otra forma no puede tumbar la caja que la lee.
    assert.equal(parseVisitor(null, NOW), null);
    assert.equal(parseVisitor("{", NOW), null);
    assert.equal(parseVisitor('"id"', NOW), null);
    assert.equal(parseVisitor('{"id":"x"}', NOW), null);
    assert.equal(parseVisitor('{"id":1,"expiresAt":9e15}', NOW), null);
  });
});
