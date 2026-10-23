# ADR 0047 — Los agregados semanales se guardan cuatro semanas

**Fecha**: 12 de octubre de 2026 · **Estado**: aceptada · Revisa la regla 2 de la retención de `aggregate_snapshots` ([migración 0019](../../db/migrations/0019_retencion_de_agregados.sql), `prune-aggregates`) · Se apoya en el [ADR 0037](0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md) · **El punto 3 está revisado por el [ADR 0052](0052-lo-que-solo-se-lee-por-su-ultima-fila-se-poda.md)**

## Contexto

La retención de la migración 0019 conserva entera la corrida vigente y, de las anteriores, una por semana con las filas de cinco usuarios o más. No ponía límite a cuántas semanas. Con la temporada avanzando, `aggregate_snapshots` pasó a ser la tabla que más crecía: de 44,7 a 56,3 MB entre el 30 de septiembre y el 11 de octubre, unos 8 MB por semana. El 11 de octubre la base estaba en 424 MB de una cuota de 500, y `db-size` llevaba desde el 6 avisando por encima de 400.

Las semanas viejas no las lee ninguna pantalla. El producto lee dos corridas: la vigente, y la anterior que conserve detalle por variable, para decir cuánto se ha movido un escalón (`readPreviousSegment`, ADR 0037). Esa casi siempre es la semanal más reciente.

## Decisión

1. **Una corrida semanal sobrevive durante cuatro semanas**, contadas desde la corrida vigente. La vigente se sigue guardando entera, y las semanales con el mismo corte de cinco usuarios.
2. **Las semanas se cuentan desde la última corrida, no desde la fecha actual.** Si el pipeline se para, lo que hay no se va borrando mientras no se calcula nada nuevo.
3. ~~**`population_segments` sigue sin podarse.** La serie de mediana, cuartiles y denominadores por escalón queda entera, que es la que sostiene una tendencia.~~ **Revisado el 23 de octubre de 2026 por el [ADR 0052](0052-lo-que-solo-se-lee-por-su-ultima-fila-se-poda.md)**: fuera de las cuatro semanas sale lo que ya no tiene agregados y no es la fila más reciente de su escalón. Ninguna pantalla leía esa serie, y había crecido a 13,7 MB.
4. `--weeks N` en `prune-aggregates` para cambiarlo a mano; el valor por defecto es el mismo que aplica `refresh-aggregates` al final de cada corrida.

## Por qué

**Porque la comparación solo necesita la anterior, y cuatro semanas cubren cualquier hueco visto.** Entre el 29 de agosto y el 13 de septiembre de 2026 no hubo ni una corrida: quince días. Con cuatro semanas, una racha así sigue dejando con qué comparar.

**Porque guardar detalle que nadie lee es pagar cuota por nada**, y la cuota de 500 MB del plan gratuito es fija ([ADR 0034](0034-historico-frio-archivado-en-storage.md)). Si un día hace falta la tendencia por variable de toda una temporada, en principio se puede reconstruir: `aggregate_snapshots` es derivada (migración 0005), y lo que la alimenta está en Postgres o en el archivo de Storage, aunque no hay ningún comando que lo haga hoy.

## Consecuencias

- Medido con `--dry-run` el 12 de octubre: de 213.799 filas se borran 32.455 (unos 8,5 MB) y quedan 181.344 en cinco corridas, unos 47 MB. Ese es el techo con la población de hoy. Sube despacio a medida que avanza la temporada, porque las semanales recientes llevan más perfiles y más variables que las antiguas, pero ya no suma una corrida más cada semana.
- La primera corrida tras el despliegue borra de una vez las semanales anteriores a cuatro semanas. El espacio no vuelve a la cuota hasta el siguiente `compact`.
- Una pantalla nueva que quiera enseñar la evolución de una variable más allá de cuatro semanas tiene que revisar esta decisión. Leer de `population_segments` ya no sirve más allá de cuatro semanas (ADR 0052).
