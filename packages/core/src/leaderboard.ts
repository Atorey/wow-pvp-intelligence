/**
 * El tope del leaderboard de Blizzard: cuántas entradas publica como mucho por
 * bracket, que en Solo Shuffle es por spec (ADR 0045).
 *
 * Vive en core y no en el pipeline porque decide lo que la web dice de una
 * cifra: una spec que llena el tope es una spec de la que vemos la parte alta y
 * no la cola, y su población observada deja de ser una medida para ser un
 * suelo. Si el número estuviera escrito en el job que lo detecta y en la página
 * que lo declara, el día que Blizzard lo cambiara cada lado contaría otra cosa.
 */
export const LEADERBOARD_CAP = 5_000;

/**
 * Si una publicación del leaderboard llena el tope.
 *
 * Se pregunta por las entradas publicadas y no por la población observada, que
 * es otra cifra: la población cuenta a quien ha jugado dentro de la ventana, y
 * un bracket con 5.000 entradas y 3.800 activos está recortado aunque su
 * población no se acerque al tope.
 *
 * `null` es "no sabemos cuántas trajo", y no se da por recortado: afirmar un
 * recorte que nadie ha visto sería el mismo error que negarlo (regla 5).
 */
export function isLeaderboardCapped(entries: number | null): boolean {
  return entries !== null && entries >= LEADERBOARD_CAP;
}
