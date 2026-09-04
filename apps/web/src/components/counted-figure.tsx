/**
 * Una cifra con su denominador, en el orden que fija la §2.5 del brief: **la
 * fracción manda y el porcentaje acompaña**. "1.598 de 2.282" primero, "percentil
 * 70" después, y nunca el percentil solo.
 *
 * El porcentaje es opcional porque a veces no existe: por debajo de
 * `MIN_SAMPLE_MEDIUM` observados se enseña la fracción a secas (punto 4 del ADR
 * 0011). "Percentil 50" sobre 6 personas es una cifra con forma de estadística;
 * "3 de 6" es el mismo dato sin el disfraz.
 */
export function CountedFigure({ fraction, derived }: { fraction: string; derived?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-foreground text-base">{fraction}</p>
      {derived !== undefined && <p className="text-muted-foreground text-sm">{derived}</p>}
    </div>
  );
}

/**
 * Una fila de recuento: qué se cuenta a la izquierda, cuánto a la derecha.
 *
 * `value` llega ya formateado en el idioma de la página. No lleva unidades ni
 * signos: son personajes observados, y decir de qué se declara una vez en el
 * bloque, no en cada fila.
 */
export function CountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-subtle-foreground text-sm">{label}</span>
      <span className="text-foreground font-display text-base">{value}</span>
    </div>
  );
}

/**
 * Una ausencia declarada: qué falta y por qué, con su denominador cuando lo hay.
 *
 * Nunca lleva fecha ni "próximamente" (§2.5): la cobertura depende de la
 * temporada y del presupuesto de cuota, así que prometer un calendario sería
 * prometer algo que no controlamos. Un cero con denominador —"0 de 285
 * perfiles"— dice de quién es el problema; "sin datos" no dice nada.
 */
export function DeclaredAbsence({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground text-sm">{label}</span>
      <span className="text-muted-foreground text-sm">{body}</span>
    </div>
  );
}
