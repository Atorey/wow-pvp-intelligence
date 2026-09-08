/**
 * El arnés que convierte el principio 9 en un número (ADR 0031).
 *
 * "Rápido primero" no es un principio hasta que alguien puede incumplirlo, y
 * para eso hace falta medir siempre igual. Esto no es un test: no falla, no
 * corre en CI y no tiene umbral dentro. Imprime lo que tarda la web real, y el
 * umbral vive en el ADR, que es donde se puede discutir.
 *
 * Sin dependencias a propósito. Una librería de benchmarking traería su propio
 * calentamiento, su propia estadística y su propio criterio de outliers, y la
 * cifra dejaría de ser comparable con la de dentro de seis meses.
 *
 * Uso, contra un servidor ya levantado (`npm run web:build` y luego
 * `npm run start --workspace @wowpvp/web`), que es el build que corre Netlify:
 *
 *   npx tsx apps/web/scripts/measure-ttfb.ts --base http://localhost:3000 --runs 30
 *
 * Las rutas se pasan con `--path` (repetible). Sin ninguna, mide las cuatro que
 * el ADR usa como referencia y que hay que dar de alta a mano: un perfil con
 * comparación, uno sin ella, la portada y una página de spec.
 */

interface Options {
  base: string;
  runs: number;
  paths: string[];
}

/**
 * El TTFB se mide con el primer trozo del cuerpo, no con la resolución de
 * `fetch()`.
 *
 * `await fetch()` resuelve cuando llegan las cabeceras, y en una respuesta
 * renderizada en streaming eso puede ser antes de que el servidor haya tocado
 * Postgres. Lo que importa aquí es cuándo el navegador tiene algo que pintar.
 */
interface Timing {
  ttfbMs: number;
  totalMs: number;
  status: number;
  bytes: number;
}

async function measureOnce(url: string): Promise<Timing> {
  const started = performance.now();
  const response = await fetch(url, {
    // Sin caché de ningún lado: lo que se mide es lo que cuesta producir la
    // página, no lo que cuesta recordarla.
    cache: "no-store",
    headers: { "accept-language": "en" },
  });

  let ttfbMs = performance.now() - started;
  let bytes = 0;
  let first = true;

  if (response.body) {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      if (first) {
        ttfbMs = performance.now() - started;
        first = false;
      }
      bytes += chunk.byteLength;
    }
  }

  return { ttfbMs, totalMs: performance.now() - started, status: response.status, bytes };
}

/**
 * Percentil por interpolación lineal, el mismo criterio que usan las
 * herramientas de Web Vitals. Con 30 muestras la diferencia con el método del
 * vecino más cercano es visible, así que conviene decir cuál se usa.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const weight = rank - low;
  return (sorted[low] as number) * (1 - weight) + (sorted[high] as number) * weight;
}

function ms(value: number): string {
  return `${value.toFixed(0)} ms`.padStart(9);
}

function parseArgs(argv: string[]): Options {
  const paths: string[] = [];
  let base = "http://localhost:3000";
  let runs = 30;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--base" && value) {
      base = value.replace(/\/$/, "");
      i += 1;
    } else if (flag === "--runs" && value) {
      runs = Number(value);
      if (!Number.isFinite(runs) || runs < 1) throw new Error(`--runs="${value}" no es un número.`);
      i += 1;
    } else if (flag === "--path" && value) {
      paths.push(value);
      i += 1;
    }
  }

  return { base, runs, paths };
}

/**
 * Las rutas de referencia del ADR 0031.
 *
 * Los dos perfiles van sin rellenar porque **dependen del dataset**: el que hoy
 * tiene comparación puede no tenerla la semana que viene, y una constante con un
 * personaje dentro se convertiría en una medición de otra cosa sin que nadie se
 * entere. Se pasan con `--path` y se anota cuál se usó junto a la cifra.
 */
const DEFAULT_PATHS = ["/en", "/en/spec/frost-mage", "/en/methodology"];

async function main(): Promise<void> {
  const { base, runs, paths } = parseArgs(process.argv.slice(2));
  const targets = paths.length > 0 ? paths : DEFAULT_PATHS;

  console.log(`Midiendo ${targets.length} ruta(s) × ${runs} peticiones contra ${base}`);
  console.log(`Fecha: ${new Date().toISOString()}\n`);

  for (const path of targets) {
    const url = `${base}${path}`;
    const timings: Timing[] = [];

    // Una petición fuera de la cuenta: la primera paga el arranque del proceso,
    // la conexión al pooler y la compilación perezosa de la ruta. Es una cifra
    // real —el arranque en frío de Netlify se parece— pero no es la misma
    // pregunta, así que se declara aparte en vez de contaminar el percentil.
    const cold = await measureOnce(url);

    for (let i = 0; i < runs; i += 1) {
      timings.push(await measureOnce(url));
    }

    const ttfb = timings.map((t) => t.ttfbMs).sort((a, b) => a - b);
    const total = timings.map((t) => t.totalMs).sort((a, b) => a - b);
    const statuses = new Set(timings.map((t) => t.status));

    console.log(`${path}`);
    console.log(`  estado ${[...statuses].join(", ")} · ${(cold.bytes / 1024).toFixed(1)} KiB`);
    console.log(`  primera (en frío)   ttfb ${ms(cold.ttfbMs)}   total ${ms(cold.totalMs)}`);
    console.log(
      `  p50                 ttfb ${ms(percentile(ttfb, 50))}   total ${ms(percentile(total, 50))}`,
    );
    console.log(
      `  p75                 ttfb ${ms(percentile(ttfb, 75))}   total ${ms(percentile(total, 75))}`,
    );
    console.log(
      `  p95                 ttfb ${ms(percentile(ttfb, 95))}   total ${ms(percentile(total, 95))}`,
    );
    console.log("");
  }

  console.log("El presupuesto y la lectura de estas cifras están en el ADR 0031.");
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
