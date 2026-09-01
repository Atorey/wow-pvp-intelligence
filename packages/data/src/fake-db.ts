import type { Queryable, QueryResultLike, QueryRow } from "./queryable";

/**
 * Ejecutor de mentira para los tests.
 *
 * Es el mismo recurso que el reloj inyectable de `RequestQueue`: lo que aquí
 * merece test no es que Postgres sepa hacer un `order by`, sino qué se le pide y
 * en qué se convierte lo que devuelve — que es justo donde puede colarse una
 * confianza leída de la columna equivocada.
 *
 * Guarda las consultas para poder afirmar cosas **sobre la SQL**, como que la
 * lista de columnas del segmento no incluye `confidence`.
 *
 * Vive aquí y se exporta por `@wowpvp/data/fake-db` porque el contrato
 * `Queryable` es de este paquete: un doble por consumidor acabaría siendo dos
 * dobles divergiendo de una sola interfaz.
 */
export interface FakeCall {
  text: string;
  values: unknown[];
}

export interface FakeDb extends Queryable {
  calls: FakeCall[];
}

export function fakeDb(...responses: QueryRow[][]): FakeDb {
  const calls: FakeCall[] = [];
  let index = 0;

  return {
    calls,
    query<Row extends QueryRow>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      const rows = (responses[index++] ?? []) as Row[];
      return Promise.resolve({ rows } satisfies QueryResultLike<Row>);
    },
  };
}
