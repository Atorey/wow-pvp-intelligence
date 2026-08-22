# @wowpvp/data

Las lecturas que la web hace contra Postgres. Un solo sitio, para que pipeline y web no acaben con dos versiones de la misma consulta.

Decisión y motivos en el [ADR 0014](../../docs/decisions/0014-capa-de-lectura-compartida.md).

## Qué es y qué no

| | |
|---|---|
| **Sí** | Lecturas de servicio: lo que una página necesita para pintarse. |
| **No** | Escrituras. Se quedan en `apps/pipeline/src/db` — quien escribe es el pipeline. |
| **No** | Consultas de cálculo del pipeline (`refresh-aggregates`). Sirven a un job, no a una página. |
| **No** | Conexiones. El paquete recibe el ejecutor, no lo crea. |
| **No** | Formato ni copy. Devuelve datos y fechas; el texto lo pone la web ([ADR 0012](../../docs/decisions/0012-producto-bilingue.md)). |

## Uso

```ts
import { readSegment, readAdoption, isComparable } from "@wowpvp/data";

const segment = await readSegment(db, {
  region: "eu",
  seasonId: 42,
  bracket: "shuffle-priest-holy",
  segmentId: "2000-2200",
});

if (!segment) return notCalculatedYet();
if (!isComparable(segment.gear)) return explainWhyThereIsNoComparison(segment);

const items = await readAdoption(db, segment, "gear-item", { limit: 10 });
```

`db` es cualquier cosa con un `query`: un `pg.Pool` en el pipeline, un cliente del pooler de Supabase en las funciones de Netlify ([ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md), decisión 10).

## Las tres cosas que hay que saber antes de tocarlo

**1. La confianza no se lee, se deriva.** `population_segments` tiene una columna `confidence` que mide **población**, no base de comparación: el 20 de agosto de 2026 había 59 filas guardadas como `high` con `gear_sample` a cero. Este paquete no la selecciona. Cada cifra trae su `Provenance`, y ahí `confidence` sale siempre de `confidenceFor(denominator)` con el denominador de esa cifra concreta ([ADR 0010](../../docs/decisions/0010-cobertura-por-segmento.md), punto 3). Si hace falta añadir una columna a `SEGMENT_COLUMNS`, se añade a mano y se ve en el diff.

**2. No hay forma de devolver un porcentaje sin su denominador.** `readAdoption` recibe el `SegmentRead`, no un identificador de fila, así que no se puede leer una adopción sin haber leído antes el escalón del que cuelga. El requisito de trazabilidad del principio 8 (§9) deja de ser algo que recordar.

**3. Un escalón sin muestra devuelve fila; uno que no existe devuelve `null`.** No es lo mismo "aquí hay 12 personas" que "esto no se ha calculado nunca", y el [ADR 0011](../../docs/decisions/0011-fuera-de-cobertura-se-describe-no-se-compara.md) los explica distinto. Colapsarlos en `null` dejaría a la web sin poder decir cuál de los dos es.

## Tests

`node:test`, con un ejecutor falso (`fake-db.ts`) — el mismo recurso que el reloj inyectable de `RequestQueue`. Lo que se prueba es el mapeo y qué SQL se emite, no que Postgres sepa ordenar. Que no se sirvan datos de verdad contra el schema es el hueco conocido, y se cierra con las fixtures de [#64](https://github.com/Atorey/wow-pvp-intelligence/issues/64).
