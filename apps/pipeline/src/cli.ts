import { migrate } from "./db/migrate";
import { fetchLeaderboards } from "./jobs/fetch-leaderboard";
import { ingestLeaderboards } from "./jobs/ingest-leaderboard";
import { validateEndpoints } from "./jobs/validate-endpoints";

const COMMANDS: Record<string, { run: () => Promise<void>; help: string }> = {
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
  await entry.run();
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
