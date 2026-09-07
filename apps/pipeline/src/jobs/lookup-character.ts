import {
  BlizzardClient,
  blizzardUsage,
  formatUsage,
  lookupCharacter,
  type LookupResult,
} from "@wowpvp/blizzard";
import { formatCharacterRef, parseCharacterRef, type CharacterRef } from "@wowpvp/core";
import {
  getCharacterLookupTtlMinutes,
  getDatabaseUrl,
  getNotFoundCacheTtlMinutes,
  getRegion,
} from "../config";
import { createPool } from "../db/pool";

/**
 * El comando de terminal de la búsqueda bajo demanda.
 *
 * El motor —`lookupCharacter()`— vive en `@wowpvp/blizzard` porque quien de
 * verdad acumula población es el buscador de la web. Esto es la otra forma de
 * llamarlo: la que sirve para ejercitarlo, medirlo y depurar un personaje
 * concreto sin abrir un navegador.
 */

interface Options {
  refs: CharacterRef[];
  force: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { refs: [], force: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!flag?.startsWith("--")) continue;

    if (flag === "--force") {
      options.force = true;
      continue;
    }

    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`La opción ${flag} necesita un valor.`);
    }
    i++;

    if (flag !== "--character") {
      throw new Error(`Opción desconocida: ${flag}. Disponibles: --character, --force.`);
    }
    options.refs.push(parseCharacterRef(value));
  }

  if (options.refs.length === 0) {
    throw new Error(
      "Falta --character reino/nombre (se puede repetir para buscar varios personajes).",
    );
  }

  return options;
}

function describe(result: LookupResult): string {
  switch (result.outcome) {
    case "cached":
      return "ya lo teníamos fresco, no se ha llamado a Blizzard";
    case "not-found":
      return "Blizzard no conoce ese personaje (revisa reino y nombre)";
    case "not-found-cached":
      return "ya nos dijeron hace poco que no existe, no se ha llamado a Blizzard";
    case "no-brackets":
      return "existe, pero no juega ningún Solo Shuffle";
    case "error":
      if (result.unavailable === "quota") return "no se pudo preguntar: sin cuota para on-demand";
      if (result.unavailable === "deadline") {
        return "no se pudo preguntar: se agotó el presupuesto de tiempo";
      }
      return `no se pudo completar — ${result.note ?? "sin detalle"}`;
    case "ok":
      return (
        `${result.bracketsFound} bracket(s), ${result.snapshotsInserted} snapshot(s), ` +
        `${result.gearRows} filas de gear, ${result.talentCodes} con código de talentos`
      );
  }
}

export async function lookupCharacters(args: string[] = []): Promise<void> {
  const options = parseOptions(args);
  const region = getRegion();
  const ttlMinutes = getCharacterLookupTtlMinutes();
  const notFoundTtlMinutes = getNotFoundCacheTtlMinutes();

  getDatabaseUrl();

  console.log(`Búsqueda bajo demanda — región ${region.toUpperCase()}`);
  console.log(
    `Caché: ${ttlMinutes} min${options.force ? " (ignorada por --force)" : ""} · ` +
      `${options.refs.length} personaje(s)\n`,
  );

  // La prioridad más alta de §28: detrás de esto hay alguien esperando delante
  // de una pantalla, a diferencia del leaderboard y de los agregados. Sin
  // `timeBudgetMs`: quien lanza el comando puede esperar, y el que no puede es
  // el buscador de la web, que sí lo pasa.
  const pool = createPool();
  const client = new BlizzardClient({ priority: "on-demand", db: pool });
  const results: LookupResult[] = [];

  try {
    for (const ref of options.refs) {
      const result = await lookupCharacter(
        { pool, client, region, ttlMinutes, notFoundTtlMinutes, force: options.force },
        ref,
      );
      results.push(result);

      const icon = result.outcome === "ok" ? "✅" : result.outcome === "error" ? "❌" : "ℹ️";
      console.log(`${icon} ${formatCharacterRef(ref)}: ${describe(result)}`);
      if (result.newCharacter && result.outcome !== "not-found") {
        console.log("   Personaje nuevo: no estaba en la base de datos.");
      }
      if (result.note && result.outcome === "ok") console.log(`   ⚠️  ${result.note}`);
    }
  } finally {
    await pool.end();
  }

  const nuevos = results.filter((r) => r.newCharacter && r.outcome !== "not-found").length;
  const snapshots = results.reduce((acc, r) => acc + r.snapshotsInserted, 0);
  console.log(
    `\n${nuevos}/${results.length} personaje(s) no estaban en la base — ` +
      `${snapshots} snapshot(s) insertados.`,
  );
  console.log(`Cuota: ${formatUsage(blizzardUsage())}`);
}
