import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BlizzardClient } from "../blizzard/client";
import { REPORTS_DIR } from "../config";

const CHARACTERS_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "config",
  "characters.eu.json",
);

interface CharacterInput {
  realmSlug: string;
  name: string;
}

interface CharacterReport {
  input: CharacterInput;
  profile: "ok" | "fail";
  className?: string | undefined;
  activeSpec?: string | undefined;
  pvpBrackets: { bracket: string; rating: number | null; played: number | null }[];
  equipment: "ok" | "partial" | "fail";
  gemsEnchantsFound: boolean;
  talents: "ok" | "missing" | "fail";
  talentDetail?: string;
  notes: string[];
}

/**
 * Valida los 4 endpoints core contra personajes reales. El cuarto (talentos)
 * es el riesgo activo del proyecto: `talent_loadout_code` se reportó ausente
 * tras el parche 11.2 y de forma desigual por clase, así que el reporte agrupa
 * el resultado por clase — un 100% sobre 3 personajes de 3 clases no dice nada
 * sobre las 10 restantes.
 */
async function validateCharacter(
  client: BlizzardClient,
  input: CharacterInput,
): Promise<CharacterReport> {
  const base = `/profile/wow/character/${input.realmSlug}/${input.name.toLowerCase()}`;
  const report: CharacterReport = {
    input,
    profile: "fail",
    pvpBrackets: [],
    equipment: "fail",
    gemsEnchantsFound: false,
    talents: "fail",
    notes: [],
  };

  // 1) Perfil
  const profile = await client.tryGet<{
    character_class?: { name?: string };
    active_spec?: { name?: string };
  }>(base, "profile");
  if (profile.ok) {
    report.profile = "ok";
    report.className = profile.data?.character_class?.name;
    report.activeSpec = profile.data?.active_spec?.name;
  } else {
    report.notes.push(`profile: HTTP ${profile.status} — ${profile.error?.slice(0, 200)}`);
  }

  // 2) Rating por bracket. No adivinamos slugs de shuffle: pedimos el resumen
  //    de PvP y seguimos los brackets que la propia API declara para este personaje.
  const summary = await client.tryGet<{ brackets?: { href?: string }[] }>(
    `${base}/pvp-summary`,
    "profile",
  );
  if (summary.ok) {
    for (const link of summary.data?.brackets ?? []) {
      if (!link.href) continue;
      const bracketPath = new URL(link.href).pathname;
      const bracket = await client.tryGet<{
        bracket?: { type?: string };
        rating?: number;
        season_match_statistics?: { played?: number };
      }>(bracketPath, "profile");
      if (bracket.ok) {
        report.pvpBrackets.push({
          bracket: bracket.data?.bracket?.type ?? "unknown",
          rating: bracket.data?.rating ?? null,
          played: bracket.data?.season_match_statistics?.played ?? null,
        });
      } else {
        report.notes.push(`pvp-bracket (${bracketPath}): HTTP ${bracket.status}`);
      }
    }
  } else {
    report.notes.push(`pvp-summary: HTTP ${summary.status} — ${summary.error?.slice(0, 200)}`);
  }

  // 3) Equipo (gemas y encantamientos vienen dentro de cada item)
  const equipment = await client.tryGet<{
    equipped_items?: { sockets?: unknown[]; enchantments?: unknown }[];
  }>(`${base}/equipment`, "profile");
  if (equipment.ok) {
    const items = equipment.data?.equipped_items ?? [];
    report.equipment = items.length > 0 ? "ok" : "partial";
    report.gemsEnchantsFound = items.some((it) => (it.sockets?.length ?? 0) > 0 || it.enchantments);
  } else {
    report.notes.push(`equipment: HTTP ${equipment.status} — ${equipment.error?.slice(0, 200)}`);
  }

  // 4) Talentos — el riesgo activo
  const specs = await client.tryGet<{
    specializations?: { loadouts?: { talent_loadout_code?: string }[] }[];
  }>(`${base}/specializations`, "profile");
  if (specs.ok) {
    const hasCode = (specs.data?.specializations ?? []).some((s) =>
      (s.loadouts ?? []).some(
        (l) => typeof l.talent_loadout_code === "string" && l.talent_loadout_code.length > 0,
      ),
    );
    report.talents = hasCode ? "ok" : "missing";
    if (!hasCode) {
      report.talentDetail =
        "specializations responde, pero ningún loadout trae talent_loadout_code.";
    }
  } else {
    report.notes.push(`specializations: HTTP ${specs.status} — ${specs.error?.slice(0, 200)}`);
  }

  return report;
}

function icon(status: string): string {
  if (status === "ok") return "✅";
  if (status === "partial" || status === "missing") return "⚠️";
  return "❌";
}

export async function validateEndpoints(): Promise<void> {
  const characters: CharacterInput[] = JSON.parse(fs.readFileSync(CHARACTERS_FILE, "utf-8"));
  const client = new BlizzardClient();

  console.log(
    `Región: ${client.region.toUpperCase()} — validando ${characters.length} personajes...\n`,
  );

  const reports: CharacterReport[] = [];
  for (const c of characters) {
    console.log(`→ ${c.name}-${c.realmSlug} ...`);
    reports.push(await validateCharacter(client, c));
  }

  console.log("\n=== VALIDACIÓN DE ENDPOINTS ===\n");
  for (const r of reports) {
    console.log(`${r.input.name}-${r.input.realmSlug}`);
    console.log(
      `  Perfil:     ${icon(r.profile)} ${r.className ?? ""}${r.activeSpec ? " / " + r.activeSpec : ""}`,
    );
    console.log(
      `  Rating PvP: ${r.pvpBrackets.length > 0 ? "✅" : "❌"} ` +
        r.pvpBrackets.map((b) => `${b.bracket}=${b.rating}`).join(", "),
    );
    console.log(
      `  Equipo:     ${icon(r.equipment)} (gemas/encantamientos: ${r.gemsEnchantsFound ? "sí" : "no"})`,
    );
    console.log(`  Talentos:   ${icon(r.talents)} ${r.talentDetail ?? ""}`);
    if (r.notes.length > 0) console.log(`  Notas:      ${r.notes.join(" | ")}`);
    console.log("");
  }

  // Cobertura de talentos por clase: es lo que decide si podemos comprometer
  // la comparación de talentos, no el porcentaje global.
  const byClass = new Map<string, { ok: number; total: number }>();
  for (const r of reports) {
    const key = r.className ?? "(clase desconocida)";
    const acc = byClass.get(key) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (r.talents === "ok") acc.ok += 1;
    byClass.set(key, acc);
  }

  console.log("=== TALENTOS POR CLASE ===");
  for (const [className, { ok, total }] of [...byClass].sort()) {
    console.log(`  ${ok === total ? "✅" : "⚠️"} ${className}: ${ok}/${total}`);
  }
  console.log(`\nClases cubiertas por esta muestra: ${byClass.size}/13`);
  if (byClass.size < 13) {
    console.log("⚠️  Muestra incompleta: falta cubrir clases antes de dar el dato por bueno.");
  }

  const failed = reports.filter((r) => r.talents !== "ok").length;
  const rate = failed / reports.length;
  console.log("\n=== VEREDICTO (§32 del plan) ===");
  console.log(`Talentos disponibles: ${reports.length - failed}/${reports.length}`);
  if (rate === 0) {
    console.log("→ GO: Player Gap puede incluir talentos, si la muestra cubre las 13 clases.");
  } else if (rate < 0.2) {
    console.log("→ GO CONDICIONADO: fallo <20%. Mira si se concentra en alguna clase concreta.");
  } else {
    console.log("→ CONTINGENCIA: fallo ≥20%. Lanzar Player Gap solo con gear/stats.");
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const out = path.join(
    REPORTS_DIR,
    `endpoint-validation-${new Date().toISOString().slice(0, 10)}.json`,
  );
  fs.writeFileSync(out, JSON.stringify(reports, null, 2));
  console.log(`\nReporte detallado: ${out}`);
}
