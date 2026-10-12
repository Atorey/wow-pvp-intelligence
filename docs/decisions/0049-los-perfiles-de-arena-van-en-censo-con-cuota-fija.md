# ADR 0049 — Los perfiles de arena se bajan en censo, con una parte fija del presupuesto

**Fecha**: 12 de octubre de 2026 · **Estado**: aceptada (issue [#34](https://github.com/Atorey/wow-pvp-intelligence/issues/34)) · Revisa el punto 7 del [ADR 0048](0048-la-spec-de-arena-sale-del-perfil.md) · Se apoya en el [ADR 0010](0010-cobertura-por-segmento.md) y el [ADR 0021](0021-ingesta-continua-de-perfiles.md)

## Contexto

El punto 7 del ADR 0048 metía los perfiles de arena en el mismo planificador que los de Solo Shuffle. Las 6.000 peticiones diarias de `refresh-profiles` se repartirían entre todos los pares `(bracket, segmento)` con el orden del ADR 0010: el ICP primero y, dentro, más sujetos debajo primero.

Aplicado a la letra no funciona, y por dos razones:

- **Un par de arena lleva dentro las cuarenta specs.** La spec no se sabe hasta bajar el perfil, así que el par es `(3v3, 2000-2200)` y no `(3v3, Frost Mage, 2000-2200)`. Sus sujetos debajo suman los de todas las specs, y con ese número pasaría por delante de cualquier par de Solo Shuffle.
- **Su objetivo no da base a ninguna spec.** El planificador sube cada par hasta `MIN_SAMPLE_HIGH` (100) perfiles frescos. Cien perfiles de `(3v3, 2000-2200)` son dos o tres por spec, y ninguna llegaría a los 30 de `canShowComparison()`. Se gastaría presupuesto sin producir ninguna comparación.

Y el presupuesto ya no sobra. La corrida del 12 de octubre de 2026 gastó las 6.000 peticiones (1.500 perfiles) en pares del ICP, y 229 pares de Solo Shuffle se quedaron sin llegar al suelo de 30 por falta de presupuesto.

## Decisión

1. **La arena tiene una parte fija del mismo presupuesto**: `PROFILE_REFRESH_ARENA_SHARE`, 0,2 por defecto. No es un presupuesto aparte. El total sigue siendo `PROFILE_REFRESH_BUDGET`.
2. **Dentro de su parte, la arena se baja en censo.** No hay objetivo ni suelo por par: se le baja el perfil a todo activo sin perfil fresco de cada par `(bracket, segmento)`. El orden sí es el del ADR 0010: el ICP antes que nada de fuera, más sujetos debajo primero, y fuera los tramos sin nadie debajo.
3. **Lo que la arena no gasta vuelve a Solo Shuffle en la misma corrida.** Con la arena apagada, o ya al día, Solo Shuffle tiene el presupuesto entero, como antes.
4. **La spec de cada perfil de arena es su `active_spec`.** Si no hay una que el catálogo reconozca, el perfil no se guarda (ADR 0048, punto 2).
5. **Solo Shuffle se baja primero y la arena después.** Si la corrida se corta, lo que se pierde es lo que todavía no sostiene ninguna pantalla.
6. **`--specs` acota a Solo Shuffle.** Una selección de specs no puede nombrar arena, porque sus brackets no nombran spec.

## Por qué

**Porque en arena solo el censo da base por spec.** Una spec de 3v3 en 2000-2200 tiene unas decenas de jugadores, y llegar a 30 perfiles frescos de ella exige bajárselos a casi todos. Como no se sabe de antemano quién es de qué spec, la única forma de conseguirlo es bajar el tramo entero. Un objetivo por par repartiría el mismo gasto entre cuarenta specs y no dejaría ninguna servible.

**Porque una parte fija hace el coste predecible en las dos direcciones.** Solo Shuffle pierde como mucho esa fracción, y lo que pierde se ve en `segment_coverage` ([ADR 0032](0032-cobertura-servible-medida-de-forma-continua.md)). La arena recibe un ritmo constante en vez de lo que sobre, que con Solo Shuffle saturado sería nada. Y en Supabase no cambia nada, porque el número de perfiles al día es el mismo (ADR 0048).

**Porque el 20 % es lo que cuesta el censo.** El leaderboard de arena empieza en ~1850 en 2v2 y ~1950 en 3v3, así que los objetivos de 1800-2000 no tienen sujetos debajo y no se muestrean. Quedan 2000-2200 y 2200-2400: unas 5.450 entradas entre los dos brackets, y con un 70 % activo, unos 3.800 personajes. Mantenerlos frescos con la ventana de 14 días pide unos 270 perfiles al día, unas 1.100 peticiones. El 20 % son 1.200. Con un 10 % solo se cubriría la mitad. Con un 25 % se le quitaría a Solo Shuffle más de lo necesario mientras tenga pares sin llegar al suelo.

## Consecuencias

- **El primer llenado tarda unas dos semanas.** A unos 300 perfiles diarios, ninguna spec de arena será servible hasta que el censo de su tramo esté casi completo. Hasta entonces, los agregados de arena dirán «no llega a muestra», que es lo cierto.
- **Solo Shuffle pierde hasta un 20 % de sus perfiles diarios mientras la arena esté encendida y no esté al día.** Con 229 pares por debajo del suelo, eso retrasa su cobertura. Si `segment_coverage` muestra que pesa más de lo que aporta la arena, la fracción se baja con la variable, sin desplegar nada.
- **El censo incluye los tramos de fuera del ICP** (2400 o más) cuando el ICP está al día. Son unas 1.200 entradas más, y entran en el orden del punto 2.
- Revisar la fracción cuando la temporada madure: el corte del leaderboard baja con ella, y los tramos de arena que sirven al ICP serán más.
