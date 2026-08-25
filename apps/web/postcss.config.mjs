// Tailwind v4 no lleva fichero de configuración propio: el tema vive en CSS,
// en el bloque `@theme` de globals.css (ADR 0019). Esto es todo lo que hay.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
