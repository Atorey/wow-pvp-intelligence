import { Card } from "./ui/card";

/**
 * Una cifra de cabecera: el valor, qué es, y una nota opcional debajo.
 *
 * La comparten el perfil y las páginas de spec porque es la misma pieza y tiene
 * que leerse igual en las dos: una cifra de cabecera que cambiara de forma según
 * la página obligaría a aprender dos veces a leer lo mismo.
 */
export function FigureCard({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  /**
   * `| undefined` explícito y no solo `?`: con `exactOptionalPropertyTypes`, una
   * prop opcional no admite que le pasen `undefined` a propósito, que es justo
   * lo que hace el llamante cuando esa nota no existe.
   */
  note?: string | undefined;
}) {
  return (
    <Card className="gap-0.5 p-4">
      <span className="text-foreground font-display text-2xl">{value}</span>
      <span className="text-subtle-foreground text-sm">{label}</span>
      {note !== undefined && <span className="text-muted-foreground pt-1 text-sm">{note}</span>}
    </Card>
  );
}
