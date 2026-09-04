import type { ReactNode } from "react";

import { Card } from "./ui/card";

/**
 * Un bloque de la página de perfil: título en versalita y contenido.
 *
 * El título se escribe en minúscula en el marcado y se transforma con
 * `uppercase` (§3.3 del sistema): un lector de pantalla debe leer "Posición en
 * la spec", no deletrear las mayúsculas.
 *
 * No es una `Alert` aunque lo parezca por la forma. `Alert` lleva `role="alert"`
 * y anuncia lo que hay dentro como si acabara de ocurrir; esto es contenido de
 * la página, y estaba igual antes de entrar.
 */
export function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`gap-4 p-5 ${className ?? ""}`}>
      <h2 className="text-subtle-foreground tracking-caps text-xs uppercase">{title}</h2>
      {children}
    </Card>
  );
}
