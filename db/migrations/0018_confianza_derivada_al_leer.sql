-- La confianza no se guarda: se deriva del denominador al leer (ADR 0033).
--
-- `population_segments.confidence` se escribía como `confidenceFor(sample_size)`
-- y se llamaba como la pregunta que NO respondía. El 20 de agosto de 2026 la
-- tabla tenía 59 filas guardadas como `high` con `gear_sample = 0`: segmentos de
-- miles de personas de los que no hay un solo perfil con equipo. Quien leyera esa
-- columna para decidir si enseñar una comparación —que es literalmente lo que su
-- nombre promete— publicaría una página vacía con la confianza declarada
-- mintiendo, que es el error que el ADR 0007 evitó separando `gear_sample` de
-- `sample_size` y que el punto 3 del ADR 0010 zanjó eligiendo cuál manda.
--
-- No se renombra a `population_confidence`, se quita. El valor es una función
-- pura de `sample_size`, que sigue en la misma fila: no se pierde nada al
-- borrarlo y se gana que los umbrales del ADR 0003 dejen de existir congelados
-- en filas viejas, capaces de contradecir a la función que los define. Es la
-- regla que la migración 0017 ya aplicó a `segment_coverage` el mes pasado,
-- citando estas mismas filas.
--
-- Las dos confianzas que hacen falta siguen estando, y ninguna se lee de aquí:
-- la de población sale de `sample_size` y sostiene el percentil y el ranking; la
-- de comparación sale del denominador de cada cifra —`gear_sample`,
-- `talent_node_sample`, `pvp_talent_sample`, `item_level_sample`— y decide si el
-- Player Gap se enseña. `provenanceFor()` de packages/data es el único sitio
-- donde se construye una y no acepta la confianza como parámetro.
alter table population_segments
  drop column if exists confidence;

comment on column population_segments.sample_size is
  'Personajes activos del segmento en su ventana. Es POBLACIÓN: sostiene el '
  'percentil y el ranking, que no necesitan perfil (ADR 0011, punto 2b), y no '
  'es la base de ninguna comparación. Su nivel de confianza no se guarda: se '
  'deriva al leer con confidenceFor().';

comment on column population_segments.gear_sample is
  'Miembros del segmento con equipo legible: la base de comparación que decide '
  'el Player Gap (ADR 0010, decisión 3). Difiere de sample_size en órdenes de '
  'magnitud y puede ser 0 en un segmento de miles. Su confianza tampoco se '
  'guarda aquí, por lo mismo que se fue la columna confidence.';
