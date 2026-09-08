"use client";

import { copyFor } from "../i18n/copy";
import { SOURCE_LOCALE } from "../i18n/locales";

/**
 * La última red: un fallo en el propio layout raíz (ADR 0030).
 *
 * Sustituye al documento entero, así que trae su propio `<html>` y no puede
 * apoyarse en nada del layout — ni en las fuentes, ni en los tokens, ni en el
 * tema. De ahí que sus estilos vayan en línea, que es la única excepción a la
 * regla de que los estilos son tokens (ADR 0019): aquí el fichero que define los
 * tokens es precisamente el que puede no haber cargado.
 *
 * Y va en inglés, la lengua fuente, porque a este nivel no hay ruta de la que
 * deducir el idioma: si el layout no se ha montado, tampoco hay `[locale]`.
 * Enseñar una de las dos lenguas es mejor que enseñar el texto de Next.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const copy = copyFor(SOURCE_LOCALE).error;

  return (
    <html lang={SOURCE_LOCALE}>
      <body style={{ margin: 0, background: "#0f1014", color: "#e8e8ea" }}>
        <main
          style={{
            maxWidth: "38rem",
            margin: "0 auto",
            padding: "4rem 1.25rem",
            fontFamily: "system-ui, sans-serif",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 400, margin: 0 }}>{copy.title}</h1>
          <p style={{ margin: 0, color: "#a8aab4" }}>{copy.body}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              padding: 0,
              color: "#d4a95d",
              textDecoration: "underline",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  );
}
