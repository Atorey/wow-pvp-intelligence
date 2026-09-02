"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { copyFor } from "../i18n/copy";
import type { Locale } from "../i18n/locales";

export function ThemeSwitch({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).theme;
  /*
   * `resolvedTheme` y no `theme`: el proveedor arranca en `system`, que no es
   * ni claro ni oscuro. Leyendo `theme` habría que comparar contra `"dark"` un
   * valor que casi siempre vale `"system"`, y el botón anunciaría el tema
   * contrario al que se está pintando. `resolvedTheme` ya dice cuál de los dos
   * hay delante.
   */
  const { resolvedTheme, setTheme } = useTheme();

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5"
        aria-label={copy.label}
      >
        <Moon aria-hidden="true" className="size-4" />
        {copy.label}
      </button>
    );
  }

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? Moon : Sun;
  const current = isDark ? copy.dark : copy.light;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5"
      /*
       * El nombre accesible **contiene** el texto que se ve, y no dice otra
       * cosa. Antes anunciaba el tema contrario al escrito al lado: quien
       * navega con la voz oía "Claro" donde la pantalla ponía "Oscuro", y
       * quien dicta no podía pulsarlo por su nombre. Lo que añade es de qué
       * va esa palabra suelta, que en un pie con dos enlaces más no se
       * deduce.
       */
      aria-label={`${copy.label}: ${current}`}
    >
      <Icon aria-hidden="true" className="size-4" />
      {current}
    </button>
  );
}
