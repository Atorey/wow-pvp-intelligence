# ADR 0052 — Lo que solo se lee por su última fila se poda, y los índices que repiten a otro salen

**Fecha**: 23 de octubre de 2026 · **Estado**: aceptada · **Revisa el punto 3 del [ADR 0047](0047-los-agregados-semanales-se-guardan-cuatro-semanas.md)**, que dejaba `population_segments` sin podar · Se apoya en el [ADR 0034](0034-historico-frio-archivado-en-storage.md) y el [ADR 0037](0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md)

## Contexto

El 12 de octubre `compact` dejó la base en 332 MB. El 23 estaba en 457 de una cuota de 500, según el `db-size` diario de Freshness:

- **59 MB volvieron al día siguiente del `compact`**, y no hay forma de evitarlo con `compact`. `refresh-activity` reescribe cada día todas las filas de `character_activity`, y `character_presence` y `characters` se actualizan en cada corrida. En tablas así, el doble de las filas vivas es su tamaño normal (27 → 54 MB en `character_activity`).
- **Desde entonces crece unos 4,4 MB al día, repartidos entre muchas tablas.** La mayor parte es temporada: personajes nuevos, series nuevas (también de arena desde el ADR 0048), piezas de gear y conjuntos de talentos nuevos. Eso no baja hasta que la temporada se cierra ([ADR 0042](0042-una-temporada-cerrada-sale-de-postgres.md)).

A ese ritmo la cuota se acaba hacia el 2 de noviembre. Pagar o cambiar de proveedor está descartado. Lo que se puede recortar sin perder nada que lea una pantalla está en dos sitios:

| Qué                        |  Tamaño |                     Crece | Quién lee lo antiguo                                                     |
| -------------------------- | ------: | ------------------------: | ------------------------------------------------------------------------ |
| `idx_snapshots_character`  | 17,4 MB | con `character_snapshots` | nadie: 169 lecturas en toda su vida                                      |
| `idx_characters_name_fold` |  7,9 MB |          con `characters` | nadie: el autocompletado usa el de prefijo                               |
| `population_segments`      | 13,7 MB |               ~0,3 MB/día | nadie: se lee la última corrida de cada spec y la anterior con agregados |
| `leaderboard_fetches`      |  6,7 MB |               ~0,1 MB/día | el informe de cadencia de `refresh-leaderboard`                          |
| `segment_coverage`         |  5,8 MB |               ~0,1 MB/día | `coverage`, que enseña las últimas 7 corridas                            |

`idx_snapshots_character` es `(character_id, captured_at desc)`, de la migración 0001. La 0002 añadió el único `(character_id, bracket, captured_at)`, que empieza por la misma columna, y toda lectura de snapshots por personaje filtra también por bracket. `idx_characters_name_fold` es `(region, realm_slug, name_fold)`, de la 0008, para resolver un personaje por su nombre plegado, una consulta que no llegó a existir: la única que lee `name_fold` es el autocompletado, con `like 'prefijo%'`, y eso solo lo sirve el índice con `text_pattern_ops` de la 0011.

## Decisión

1. **`idx_snapshots_character` e `idx_characters_name_fold` salen** (migraciones 0030 y 0033). Lo que buscaba solo por personaje lo sirve la primera columna del índice único de snapshots, y la búsqueda por nombre, el índice de prefijo.
2. **De `population_segments` sale lo que cumple las tres condiciones**:
   - es anterior a las cuatro semanas de la retención de agregados (`--weeks`, contadas desde la corrida vigente);
   - no conserva ningún agregado;
   - no es la fila más reciente de su escalón `(región, temporada, bracket, clase, spec, tramo)`.
3. **`leaderboard_fetches` y `segment_coverage` conservan 30 días enteros** (`--log-days`), contados desde su última fila. Fuera de la ventana, `leaderboard_fetches` guarda la última descarga con `content_hash` y la última con `population_hash` de cada bracket y temporada: son las que leen la ingesta por cambio y los agregados.
4. **Lo aplica `prune-aggregates`**, que `refresh-aggregates` ya encadena al final de cada corrida. Con `--dry-run` cuenta sin borrar: un borrado deshecho dejaría las tuplas muertas y subiría la cuota.

## Por qué

**Porque solo se borra lo que no lee nadie.** La web lee `population_segments` por su corrida más reciente (`readSegment`, `readBracketSegments`) y por la anterior que conserva agregados (`readPreviousSegment`, ADR 0037). Las corridas anteriores a cuatro semanas ya no tienen agregados desde el ADR 0047, así que ninguna de esas lecturas llega a ellas. Las bitácoras se leen por su última fila: el resto de su historia solo alimentaba informes de desarrollo.

**Porque el «se conserva por la tendencia» del ADR 0047 no tenía consumidor, y la cuota es fija.** La serie de mediana y cuartiles por escalón se guardaba por si algún día sostenía una tendencia. Ese día no ha llegado, y mientras tanto la tabla había pasado de los 4 MB que la justificaban a 13,7. Si llega —la tendencia anti-FOTM de #126 es la candidata—, la serie se reconstruye desde el archivo de Storage o se guarda resumida, con su propio ADR.

**Porque un índice de más cuesta dos veces.** Cada snapshot nuevo pagaba el primero en un segundo índice, en la tabla que más crece. Quitarlo devuelve espacio hoy y también frena el crecimiento.

## Consecuencias

- **Medido con `--dry-run` el 23 de octubre**, la primera corrida borra 13.025 filas de 29.062 en `population_segments`, 11.305 de 20.899 en `leaderboard_fetches` y 2.657 de 19.182 en `segment_coverage`: unos 10,5 MB en proporción al tamaño de cada tabla. Con los 25,3 MB de los dos índices, unos 36 MB en total, y deja de crecer ~0,5 MB al día en las tres tablas. Los índices vuelven a la cuota en el acto. **Lo borrado no vuelve hasta un `compact`** de las tres tablas ([ADR 0034](0034-historico-frio-archivado-en-storage.md)).
- **No es una solución para toda la temporada.** Al ritmo actual da algo más de una semana. Lo que sigue creciendo es población, y esa se recorta con otra decisión.
- **`coverage` ya no puede enseñar la caída de un cambio de temporada si pasó hace más de 30 días.** Las 7 corridas que enseña por defecto quedan de sobra dentro.
- **El informe de cadencia de `refresh-leaderboard` mide sobre 30 días**, no sobre toda la historia.
- **Una pantalla que quiera la evolución de un escalón más allá de cuatro semanas tiene que revisar esta decisión.** Hasta ahora el ADR 0047 la remitía a `population_segments`.
