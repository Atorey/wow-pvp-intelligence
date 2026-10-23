# ADR 0051 — Player Gap compara con el escalón más cercano que tiene base, y arriba del todo con el propio

**Fecha**: 15 de octubre de 2026 · **Estado**: aceptada · **Revisa la decisión 7 del [ADR 0011](0011-fuera-de-cobertura-se-describe-no-se-compara.md)** y la [§1.6 del brief](../design/brief.md#16-estado-adyacente--no-hay-escalón-de-arriba) · Se apoya en el [ADR 0010](0010-cobertura-por-segmento.md) y el [ADR 0028](0028-medicion-de-primera-parte-y-sin-banner.md)

## Contexto

La decisión 7 del ADR 0011 dejó el objetivo de Player Gap clavado en el escalón inmediato: si ese no tenía base, no había comparación, ni contra el siguiente servible ni contra el propio. La razón era buena —saltar al primer tramo poblado cambia la promesa sin decirlo— y la medición de entonces la sostenía, porque el problema era el día del lanzamiento y se esperaba que se resolviera solo.

No se ha resuelto en los bordes. La corrida del 15 de octubre de 2026 en Solo Shuffle, por tramo de quien mira:

| Tramo de quien mira | Observados | Con Player Gap | Con algún tramo servible encima | Lo más cerca que hay base |
| ------------------- | ---------: | -------------: | ------------------------------: | ------------------------- |
| 0-1200              |     ~8.060 |              0 |       27-31 specs de cada 35-39 | 600 puntos o más          |
| 1200-1400           |      1.960 |              0 |                  32 specs de 40 | 400 puntos (1600-1800)    |
| 1400-2200           |    ~19.040 |     casi todos |                               — | —                         |
| 2200 o más          |     ~5.720 |        2 specs |                               0 | ninguna por encima        |

Dos cosas salen de ahí:

- **Por debajo de 1400 la población está y el gear no.** El tramo 1400-1600 tiene unas 98 personas por spec y `gear_sample = 0` en todas. No es un hueco del juego, es del muestreo: `refresh-profiles` gasta el presupuesto en los objetivos que sirven al ICP ([ADR 0021](0021-ingesta-continua-de-perfiles.md)), y un objetivo de 1400-1600 tiene debajo a gente de 1200-1400. Eso se arregla bajando perfiles, y es otra decisión. Mientras tanto, a quien juega a 1250 la caja le dice que no hay nada.
- **Por encima de 2200 no hay nada servible arriba y no lo va a haber.** Las poblaciones caen con el rating y la base no llega. Pero el propio tramo sí la tiene: 2200-2400 llega a n≥30 en 28 specs. La caja le dice a esa gente que no hay comparación cuando sí hay un escalón muestreado del que decirles algo: el suyo.

El producto, tal como estaba, no le aportaba nada a quien juega lejos del ICP. La decisión 7 protegía la promesa a costa de no hacer ninguna.

## Decisión

1. **El objetivo se busca en este orden**, y lo decide `comparisonTargetFor()` en `packages/core` con la base de cada tramo:
   1. **`next`**: el inmediato, si tiene base. Es la promesa del producto y no cambia.
   2. **`skipped`**: si el inmediato no la tiene y algún tramo de encima sí. El objetivo es el más cercano con base, **a la distancia que esté**: no hay tope de tramos saltados.
   3. **`peers`**: si ningún tramo por encima tiene base, a ninguna distancia, o no hay tramo encima (3000+). Se compara con el propio, si ese tiene base.
   4. Si nada de eso se cumple, no hay comparación, como hasta ahora, y la ausencia la explica el inmediato.
2. **«Tener base» es lo de siempre**: `canShowComparison()` sobre el `gear_sample` del tramo, nunca sobre su población (decisión 3 del ADR 0010). Este ADR no baja ningún umbral: cambia contra qué tramo se aplica.
3. **`peers` exige que no haya base en ningún tramo de encima.** Con uno servible tres tramos más arriba, quien mira no está en la parte alta: está en un hueco del muestreo, y se compara con ese tramo, no con el suyo.
4. **Fuera de `next`, cada fila compara el escalón con lo que lleva quien mira, no con su tramo.** La lista es «lo que se lleva en ese tramo y tú no», de más a menos llevado, con el mismo corte de `isDiscriminative()` y la misma regla de no rellenar. Es `playerDifferences()`, junto a `biggestDifferences()`. En `next` todo sigue igual: dos tramos y dos porcentajes por fila.
5. **La caja dice contra qué compara, encima de las cifras.** En `skipped` dice cuántos tramos ha saltado y cuáles, con su población y su base sumadas, porque la distancia es parte del dato. En `peers` cambia la pregunta del titular («Tu build frente a 2400-2600», no «¿Qué te separa de…?») y dice por qué. La metodología lo explica en los dos idiomas.
6. **La medición distingue los tres modos.** `player_gap_views` gana `target_mode` (migración 0029). La North Star del §35 —vistas `high` o `medium` por usuario semanal— se puede calcular con y sin `skipped` y `peers`, y el informe dice cuál da.

## Por qué

**Porque el riesgo que vio el ADR 0011 era sustituir sin decirlo, y aquí se dice.** Su argumento era que la caja seguiría preguntando «qué te separa del siguiente escalón» mientras el dato contestaba otra cosa. Con el titular que nombra el tramo real, la frase del saltado encima de las cifras y una pregunta distinta para los pares, la caja no promete el inmediato cuando no lo da.

**Porque un tope deja fuera a quien más lo necesita.** Con un salto como mucho, la caja cubría 1200-1400 —31 specs con un solo tramo de por medio— y seguía vacía para las ~8.000 personas observadas por debajo de 1200, donde lo primero con base está a 600 puntos o más. Se consideró un tope de uno y se descartó: el problema que este ADR viene a resolver es justo que la caja no aporte nada lejos del ICP.

**Y el precio de no tenerlo se paga declarándolo, no escondiéndolo.** Lo que lleva alguien de 1800 describe peor el paso de alguien de 850 que el de alguien de 1600, y cuanto más lejos, más fácil es leer la fila como un consejo. Por eso la caja escribe cuántos tramos ha saltado antes de cualquier cifra, y por eso la fila es «lo que se lleva ahí y tú no», que describe, y no un delta entre tramos que sugiera un camino. La regla 3 sigue rigiendo el copy igual que con el inmediato.

**Porque al saltar la comparación tramo contra tramo ya no tiene sentido.** «El 60 % de 1600-1800 frente al 20 % de tu tramo» mezcla dos pasos en una diferencia. Y en la práctica no se puede calcular: por debajo de 1400 la base propia es cero en todas las specs medidas. El equipo de quien mira sí lo tenemos, porque sin él la caja ya no compara (causa `subject`). Por eso la otra mitad de la fila es un hecho de esa persona y no un porcentaje sin base.

**Porque compararse con los pares es otra promesa, pero es una promesa.** La §1.6 del brief ya la reconocía —«en qué te pareces a tus pares»— y la dejaba para una decisión propia. Esta es esa decisión. Arriba del todo, lo que distingue a alguien de su tramo es lo único que el dato puede decir. Vale más que «no hay nada encima», siempre que no se presente como el siguiente escalón.

**Porque la métrica no puede subir con esto sin que se vea.** Si `skipped` y `peers` contaran en el numerador igual que `next`, la North Star mejoraría el día del despliegue sin que hubiera un solo perfil más. Con la columna, la cifra honesta sigue disponible.

## Consecuencias

- **La caja deja de estar vacía para casi todo Solo Shuffle**: por debajo de 1400, contra el primer tramo con base por encima, y en 2200-2400, contra el propio. Siguen sin comparación las specs sin ningún tramo servible encima y sin base propia: 7-8 por tramo por debajo de 1200, el 15 de octubre de 2026.
- **Por debajo de 1200 la comparación es, de entrada, contra 1600-1800 o más arriba.** Es lo que hay, y la caja lo dice. Un objetivo más cercano solo llega bajando perfiles en esos tramos.
- **La arena no cambia en la práctica.** Por debajo del corte de su leaderboard (~1850 en 2v2, ~1950 en 3v3) no hay población agregada en ningún tramo (ADR 0048). Por encima, las mismas reglas.
- **`segment_coverage` sigue midiendo el par `(spec, segmento objetivo)` inmediato** ([ADR 0032](0032-cobertura-servible-medida-de-forma-continua.md)). Es lo que dice dónde falta muestreo, y eso no cambia porque la caja sepa sortearlo.
- **El tramo propio, en `peers`, incluye a quien mira.** Con n≥30 su peso en cualquier porcentaje es como mucho de un 3 %, y no se resta: la población agregada no dice quién está dentro.
- **El informe del pipeline (`player-gap`) sigue comparando solo con el inmediato.** Es una herramienta de desarrollo sobre poblaciones crudas, no la caja que se publica.
- **El remedio de fondo para el rango bajo es bajar perfiles en sus objetivos**, una parte del presupuesto de `refresh-profiles` como la de la arena ([ADR 0049](0049-los-perfiles-de-arena-van-en-censo-con-cuota-fija.md)). Eso revisa el orden del ADR 0021 y va en su propio ADR. Cuando llegue, una parte de los `skipped` pasará sola a `next`.
- La §1.6 y la §2.6 del brief, que prohibían esto, quedan revisadas por este ADR.
