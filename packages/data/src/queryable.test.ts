import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { fakeDb } from "./fake-db";
import type { Queryable } from "./queryable";

/**
 * `pg` entra aquí solo como tipo, y solo para este test.
 *
 * El paquete no depende de `pg` en tiempo de ejecución a propósito (ver
 * `queryable.ts`), pero toda la decisión de recibir el ejecutor en vez de
 * crearlo se apoya en que un `pg.Pool` encaje **por estructura**, sin
 * adaptador. Si esa compatibilidad se rompiera —un cambio de firma en el
 * driver, un tipo demasiado estricto por nuestra parte— el sitio donde se
 * descubriría sería el andamiaje de la web, tarde. Aquí falla el typecheck.
 */
describe("Queryable", () => {
  it("lo cumple un pg.Pool sin adaptador", () => {
    const asQueryable = (pool: pg.Pool): Queryable => pool;
    assert.equal(typeof asQueryable, "function");
  });

  it("lo cumple también un cliente suelto, para las lecturas dentro de transacción", () => {
    const asQueryable = (client: pg.PoolClient): Queryable => client;
    assert.equal(typeof asQueryable, "function");
  });

  it("devuelve las respuestas en el orden en que se hacen las consultas", async () => {
    const db = fakeDb([{ n: 1 }], [{ n: 2 }]);

    assert.deepEqual((await db.query<{ n: number }>("primera")).rows, [{ n: 1 }]);
    assert.deepEqual((await db.query<{ n: number }>("segunda")).rows, [{ n: 2 }]);
    // Sin respuesta preparada devuelve vacío, que es lo que hace Postgres.
    assert.deepEqual((await db.query<{ n: number }>("tercera")).rows, []);
    assert.deepEqual(
      db.calls.map((call) => call.text),
      ["primera", "segunda", "tercera"],
    );
  });
});
