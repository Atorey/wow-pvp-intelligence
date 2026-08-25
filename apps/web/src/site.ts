/**
 * Lo que cambia entre entornos. Las funciones reciben el entorno en vez de
 * leerlo por su cuenta para que se puedan probar sin tocar `process.env`.
 */

export type Environment = Record<string, string | undefined>;

/** Vale para `next dev` sin configurar nada; en Netlify se declara explícita. */
const LOCAL_SITE_URL = "http://localhost:3000";

/**
 * El origen sobre el que se resuelven canonicals y `hreflang`.
 *
 * Un preview con la URL de producción se anuncia a Google como producción, y
 * lo que §39 llama moat —la autoridad del dominio— se erosiona con URL
 * duplicadas. Por eso `DEPLOY_PRIME_URL`, que Netlify rellena con la URL real
 * del deploy, es mejor fallback que el dominio de producción.
 */
export function siteUrl(env: Environment): URL {
  const configured = env["NEXT_PUBLIC_SITE_URL"] ?? env["DEPLOY_PRIME_URL"] ?? LOCAL_SITE_URL;
  return new URL(configured);
}

/**
 * Si esta ejecución es la del sitio público. `CONTEXT` es de Netlify y vale
 * `production`, `deploy-preview` o `branch-deploy`; fuera de Netlify no existe.
 *
 * Se decide por lista blanca —solo `production` indexa— y no descartando los
 * contextos conocidos: un contexto nuevo que nadie previó tiene que entrar
 * como no indexable, no colarse en el índice de Google por omisión.
 */
export function isPublicSite(env: Environment): boolean {
  return env["CONTEXT"] === "production";
}
