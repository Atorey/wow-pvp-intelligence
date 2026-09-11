import { Alert, AlertDescription } from "./ui/alert";

/**
 * El aviso de muestra reducida del estado `medium`.
 *
 * **Ocupa espacio y desplaza al resto**, que es su función entera: si se pudiera
 * pasar por alto haciendo scroll rápido no cumpliría el "aviso visible" de la
 * §13.4. No es un borde de color ni un icono, y lo que comunica lo comunica el
 * texto — sin distinguir colores se recibe la misma información.
 *
 * Es un `Alert` y no una `Card` con borde discontinuo, que es la distinción que
 * hace la §5.0 del sistema: `role="alert"` es una región viva y esto sí es algo
 * que cambia con el dato —la cifra se está enseñando **con reservas**—, a
 * diferencia de "esta lectura todavía no está publicada", que estaba igual antes
 * de entrar en la página.
 */
export function SmallSampleNotice({ text }: { text: string }) {
  return (
    <Alert className="bg-warning border-warning-border text-warning-foreground">
      <AlertDescription className="text-warning-foreground">{text}</AlertDescription>
    </Alert>
  );
}
