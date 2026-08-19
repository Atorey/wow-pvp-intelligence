import { migrate } from "./db/migrate";
import { fetchLeaderboards } from "./jobs/fetch-leaderboard";
import { ingestLeaderboards } from "./jobs/ingest-leaderboard";
import { lookupCharacters } from "./jobs/lookup-character";
import { playerGap } from "./jobs/player-gap";
import { refreshActivity } from "./jobs/refresh-activity";
import { refreshAggregates } from "./jobs/refresh-aggregates";
import { refreshLeaderboard } from "./jobs/refresh-leaderboard";
import { sampleProfiles } from "./jobs/sample-profiles";
import { validateEndpoints } from "./jobs/validate-endpoints";

/** `args` son los argumentos posteriores al comando; los jobs sin opciones lo ignoran. */
const COMMANDS: Record<string, { run: (args: string[]) => Promise<void>; help: string }> = {
  "validate-endpoints": {
    run: validateEndpoints,
    help: "Comprueba perfil/rating/equipo/talentos contra los personajes de config/characters.eu.json",
  },
  "fetch-leaderboard": {
    run: fetchLeaderboards,
    help: "Descarga el leaderboard de Solo Shuffle de las specs activas a data/leaderboard/",
  },
  "ingest-leaderboard": {
    run: ingestLeaderboards,
    help: "Carga en Postgres lo descargado (append-only) e imprime la distribución por segmento",
  },
  "refresh-leaderboard": {
    run: refreshLeaderboard,
    help: "Job programado: descarga + ingiere solo si Blizzard ha republicado (ver ADR 0004)",
  },
  "lookup-character": {
    run: lookupCharacters,
    help: "Busca personajes y los añade a la población acumulada [--character reino/nombre --force]",
  },
  "sample-profiles": {
    run: sampleProfiles,
    help: "Baja gear y talentos de una muestra por segmento de rating [--limit --seed --segments --specs --run]",
  },
  "refresh-activity": {
    run: refreshActivity,
    help: "Recalcula last_active_at por personaje desde las partidas jugadas [--season --dry-run]",
  },
  "refresh-aggregates": {
    run: refreshAggregates,
    help: "Job diario: recalcula la distribución y el adoption_rate por segmento [--window --dry-run]",
  },
  "player-gap": {
    run: playerGap,
    help: "Genera el Player Gap de un personaje contra el siguiente segmento [--run --character --top --rating]",
  },
  migrate: {
    run: migrate,
    help: "Aplica las migraciones pendientes de db/migrations/",
  },
};

function printHelp(): void {
  console.log("Pipeline de WoW PvP Intelligence\n");
  console.log("Uso: npm run pipeline -- <comando>\n");
  console.log("Comandos:");
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
  for (const [name, { help }] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(width)}  ${help}`);
  }
  console.log("\nRequiere un .env en la raíz del repo (ver .env.example).");
  console.log("\nOpciones de sample-profiles:");
  console.log("  --limit N      personajes por bucket (default 100; 0 = censo del bucket)");
  console.log("  --segments R,R rating de entrada de cada segmento (default 1800,2000)");
  console.log("  --seed S       semilla del muestreo (misma semilla = misma muestra)");
  console.log("  --specs K,K    specs a muestrear, p.ej. mage-frost (default: las que ingiere)");
  console.log("  --run ID       reanuda un run anterior sin volver a gastar cuota");
  console.log("\nOpciones de lookup-character:");
  console.log("  --character R/N  personaje a buscar; se puede repetir");
  console.log("  --force        ignora la caché y vuelve a preguntar a Blizzard");
  console.log("\nOpciones de player-gap:");
  console.log("  --run ID       run muestreado a analizar (default: el más reciente)");
  console.log("  --character R/N  un personaje concreto; si se omite, un sujeto por spec");
  console.log("  --top N        cuántas diferencias de gear se listan (default 5)");
  console.log("  --rating R     rating de entrada del segmento de los sujetos (default 1800)");
  console.log("  --window D     ventana de actividad en días (7, 14 o 30; default: la de §13.4)");
  console.log("  --all          sin filtro de actividad (reproduce reportes anteriores a #16)");
}

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  printHelp();
  process.exit(0);
}

const entry = COMMANDS[command];
if (!entry) {
  console.error(`Comando desconocido: "${command}"\n`);
  printHelp();
  process.exit(1);
}

try {
  await entry.run(process.argv.slice(3));
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
