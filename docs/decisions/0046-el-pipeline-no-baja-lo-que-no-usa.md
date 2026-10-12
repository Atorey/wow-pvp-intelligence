# ADR 0046 — El pipeline no baja de Postgres lo que no usa

**Fecha**: 12 de octubre de 2026 · **Estado**: aceptada · Revisa el punto 8 del [ADR 0021](0021-ingesta-continua-de-perfiles.md) · Lleva al lado de la lectura lo que el [ADR 0035](0035-talentos-por-referencia-a-catalogo.md) y el [ADR 0040](0040-gear-y-talentos-por-referencia-a-contenido.md) hicieron al guardar

## Contexto

El plan gratuito de Supabase tiene dos cuotas, y hasta aquí solo se había mirado una. El tamaño de la base se arregló el 26 de septiembre. La **salida** (egress, 5 GB por ciclo) llegó a 9,74 GB el 12 de octubre sin que la web estuviera desplegada: todo era el pipeline leyendo su propia base.

Storage no era la causa. El índice de rating baja y sube unos 4 MB al día y la purga lee unos 75 MB cada tres o cuatro días: en total, alrededor de 1 GB al mes. Lo demás eran filas de Postgres devueltas al runner. `pg_stat_statements` el 12 de octubre, con unos 16 días de contadores:

| Consulta                                                     | Filas devueltas |  ≈ GB |
| ------------------------------------------------------------ | --------------: | ----: |
| Talentos de los agregados, una fila por selección con nombre |          20,8 M | ~1,35 |
| Ids de personaje devueltos en la ingesta del leaderboard     |          13,4 M | ~1,05 |
| Observaciones, actividad y presencia de `rebuildActivity`    |          15,2 M |  ~1,6 |
| Gear de los agregados, una fila por slot con nombres         |           4,3 M |  ~0,7 |
| Distribución por segmento del job de leaderboard             |          15,0 M | ~0,65 |

Unos 5,4 GB en 16 días: los 9,74 del ciclo.

## Decisión

1. **Los agregados leen gear y talentos por referencia.** `loadProfiles` pide `piece_ids` y `set_ids` por snapshot, y después cada pieza, conjunto y etiqueta distinta una sola vez, y los abre en memoria. Antes los abrían las vistas `character_snapshot_gear_slots` y `character_snapshot_talent_trees`, que repiten el contenido en cada snapshot. Las vistas siguen siendo la forma de leer de la ficha y del archivado, que leen pocas filas o las necesitan con esa forma.
2. **La ingesta del leaderboard no pide los ids de vuelta.** `writeCharacters` escribe sin devolver nada, y el `insert` de snapshots y el de presencia resuelven el id con un `join` por `(region, realm_slug, name_slug)`. `upsertCharacters` sigue devolviendo el mapa para quien lo necesita: la búsqueda bajo demanda, con un personaje.
3. **El job de leaderboard no imprime la distribución.** Era un listado del log, y contaba a todo el que se ha visto y no a los activos. El n que decide la confianza lo imprime `refresh-aggregates` cada día. La ingesta manual la sigue enseñando.
4. **La actividad se recalcula una vez al día, en `refresh-aggregates`.** `refresh-profiles` usa la que dejó el agregado anterior, de hace unas 22 horas, y solo la calcula si la temporada no tiene ninguna fila. Esto revisa el punto 8 del ADR 0021, que pedía recalcularla al empezar cada corrida.

## Por qué

**Porque la cuota se cobra por byte que sale, y la base ya sabía no repetir.** Los ADR 0035 y 0040 quitaron de la base los nombres repetidos en cada snapshot. Las vistas los volvían a poner para que leer fuera cómodo, y eso no cuesta nada en la base, pero cada byte que sale de ella se cobra. Leer como se guarda es el mismo razonamiento aplicado al otro lado.

**Porque un id que viaja de ida y vuelta sin cambiar no aporta nada.** La ingesta bajaba 114.000 ids en cada corrida para volver a subirlos en la sentencia siguiente. Postgres ya tenía todo lo necesario para hacer el cruce.

**Porque en el punto 8 del ADR 0021 había dos razones, y solo una pesa tanto como la cuota.** La de frescura —no elegir candidatos con la actividad de ayer— cuesta poco cuando la ventana es de 7 a 14 días: quien vuelve a jugar ayer espera un día más a que le bajen el perfil, y el agregado, que es lo que se publica, sigue recalculando antes de filtrar. La otra razón era evitar un fallo silencioso con la tabla vacía al empezar la temporada, y esa se conserva: con la temporada sin filas, el job la calcula.

## Consecuencias

- La salida estimada baja de unos 10 GB a entre 3 y 3,5 GB al mes, Storage incluido. Es una estimación por filas devueltas multiplicadas por el ancho de fila; se confirma con `pg_stat_statements` tras un ciclo.
- Lo siguiente que pesa es la propia `rebuildActivity`, unos 50 MB por corrida. Si hace falta más margen, el camino es recalcular solo las series con snapshots nuevos y fundir la presencia en SQL, pero eso toca la herencia del [ADR 0034](0034-historico-frio-archivado-en-storage.md) y requiere probarse contra una base.
- Una lectura nueva del pipeline que recorra toda la población entra en esta cuota. Antes de añadirla hay que estimar filas × ancho × corridas al día.
