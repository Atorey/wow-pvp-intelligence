/**
 * Lo mínimo que hace falta para ejecutar una consulta.
 *
 * Este paquete no abre conexiones, y no es un detalle de tipado. La decisión 10
 * del ADR 0013 obliga a que la web hable con el pooler de Supabase en modo
 * transacción en vez de abrir un `pg.Pool` por invocación, mientras que el
 * pipeline es un proceso largo al que le conviene justo lo contrario. Si esta
 * capa creara la conexión, elegiría por sus dos consumidores y uno de los dos
 * tendría que saltársela — que es exactamente el incentivo que hace aparecer
 * queries duplicadas fuera del paquete.
 *
 * Recibiéndola, `pg.Pool`, `pg.Client` y cualquier cliente del pooler la
 * cumplen por estructura, sin que este paquete dependa de `pg`.
 */
export interface Queryable {
  query<Row extends QueryRow>(text: string, values?: unknown[]): Promise<QueryResultLike<Row>>;
}

/**
 * Una fila cruda tal y como la devuelve el driver. El índice es `any` para
 * calcar la forma de `QueryResultRow` de node-postgres: con `unknown`, un
 * `pg.Pool` dejaría de encajar por estructura y habría que adaptarlo a mano en
 * cada consumidor.
 */
export type QueryRow = Record<string, any>;

/** Solo se usan las filas; el resto de lo que trae el driver no hace falta aquí. */
export interface QueryResultLike<Row> {
  rows: Row[];
}
