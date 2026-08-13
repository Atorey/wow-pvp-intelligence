import * as fs from "fs";
import * as path from "path";
import { blizzardGet, REGION_IN_USE } from "./blizzard";

interface CharacterInput {
  realmSlug: string;
  name: string;
}

interface CharacterReport {
  input: CharacterInput;
  profile: "ok" | "fail";
  className?: string;
  activeSpec?: string;
  pvpBrackets: { bracket: string; rating: number | null; played: number | null }[];
  equipment: "ok" | "fail" | "partial";
  gemsEnchantsFound: boolean;
  talents: "ok" | "missing" | "fail";
  talentDetail?: string;
  notes: string[];
}

async function validateCharacter(input: CharacterInput): Promise<CharacterReport> {
  const { realmSlug, name } = input;
  const base = `/profile/wow/character/${realmSlug}/${name.toLowerCase()}`;
  const notes: string[] = [];

  const report: CharacterReport = {
    input,
    profile: "fail",
    pvpBrackets: [],
    equipment: "fail",
    gemsEnchantsFound: false,
    talents: "fail",
    notes: [],
  };

  // 1) Character Profile Summary
  const profileRes = await blizzardGet(base, "profile");
  if (profileRes.ok) {
    report.profile = "ok";
    report.className = profileRes.data?.character_class?.name;
    report.activeSpec = profileRes.data?.active_spec?.name;
  } else {
    notes.push(`profile: HTTP ${profileRes.status} — ${profileRes.error?.slice(0, 200)}`);
  }

  // 2) PvP Summary -> descubre qué brackets ha jugado, y luego pide cada uno.
  //    Este es el método robusto: no adivinamos slugs de shuffle-{clase}-{spec},
  //    dejamos que la propia API nos diga qué brackets existen para este personaje.
  const pvpSummaryRes = await blizzardGet(`${base}/pvp-summary`, "profile");
  if (pvpSummaryRes.ok && Array.isArray(pvpSummaryRes.data?.brackets)) {
    for (const bracketLink of pvpSummaryRes.data.brackets) {
      const href: string | undefined = bracketLink?.href;
      if (!href) continue;
      // El href ya viene con namespace propio; extraemos solo el path relativo.
      const url = new URL(href);
      const bracketPath = url.pathname;
      const bracketRes = await blizzardGet(bracketPath, "profile");
      if (bracketRes.ok) {
        const bracketId = bracketRes.data?.bracket?.type ?? "unknown";
        report.pvpBrackets.push({
          bracket: bracketId,
          rating: bracketRes.data?.rating ?? null,
          played: bracketRes.data?.season_match_statistics?.played ?? null,
        });
      } else {
        notes.push(`pvp-bracket (${bracketPath}): HTTP ${bracketRes.status}`);
      }
    }
  } else if (!pvpSummaryRes.ok) {
    notes.push(`pvp-summary: HTTP ${pvpSummaryRes.status} — ${pvpSummaryRes.error?.slice(0, 200)}`);
  }

  // 3) Equipment Summary (gear + gemas + encantamientos van dentro de cada item)
  const equipmentRes = await blizzardGet(`${base}/equipment`, "profile");
  if (equipmentRes.ok) {
    const items = equipmentRes.data?.equipped_items ?? [];
    report.equipment = items.length > 0 ? "ok" : "partial";
    report.gemsEnchantsFound = items.some(
      (it: any) => (it.sockets && it.sockets.length > 0) || it.enchantments
    );
  } else {
    notes.push(`equipment: HTTP ${equipmentRes.status} — ${equipmentRes.error?.slice(0, 200)}`);
  }

  // 4) Specializations Summary — AQUÍ está el riesgo activo (sección 30 del plan):
  //    el campo talent_loadout_code desapareció tras el parche 11.2 (ago. 2025)
  //    según múltiples reportes en el foro oficial de Blizzard. Esto es lo
  //    primero que hay que confirmar antes de comprometer la comparación de
  //    talentos en Player Gap.
  const specRes = await blizzardGet(`${base}/specializations`, "profile");
  if (specRes.ok) {
    const specs = specRes.data?.specializations ?? [];
    const anyLoadoutCode = specs.some((s: any) =>
      (s.loadouts ?? []).some((l: any) => typeof l.talent_loadout_code === "string" && l.talent_loadout_code.length > 0)
    );
    if (anyLoadoutCode) {
      report.talents = "ok";
    } else {
      report.talents = "missing";
      report.talentDetail = "specializations respondió pero no se encontró talent_loadout_code en ningún loadout.";
    }
  } else {
    notes.push(`specializations: HTTP ${specRes.status} — ${specRes.error?.slice(0, 200)}`);
  }

  report.notes = notes;
  return report;
}

function icon(status: string) {
  if (status === "ok") return "✅";
  if (status === "partial" || status === "missing") return "⚠️";
  return "❌";
}

async function main() {
  const inputPath = path.join(__dirname, "..", "characters.eu.json");
  const characters: CharacterInput[] = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  console.log(`Región: ${REGION_IN_USE.toUpperCase()} — validando ${characters.length} personajes...\n`);

  const reports: CharacterReport[] = [];
  for (const c of characters) {
    console.log(`→ ${c.name}-${c.realmSlug} ...`);
    const r = await validateCharacter(c);
    reports.push(r);
  }

  console.log("\n=== REPORTE SPRINT 0 — VALIDACIÓN DE DATOS (días 1-3) ===\n");
  for (const r of reports) {
    console.log(`${r.input.name}-${r.input.realmSlug}`);
    console.log(`  Perfil:            ${icon(r.profile)} ${r.className ?? ""} ${r.activeSpec ? "/ " + r.activeSpec : ""}`);
    console.log(
      `  Rating PvP:        ${r.pvpBrackets.length > 0 ? "✅" : "❌"} ` +
        r.pvpBrackets.map((b) => `${b.bracket}=${b.rating}`).join(", ")
    );
    console.log(`  Equipo:            ${icon(r.equipment)} (gemas/encantamientos detectados: ${r.gemsEnchantsFound ? "sí" : "no"})`);
    console.log(`  Talentos:          ${icon(r.talents)} ${r.talentDetail ?? ""}`);
    if (r.notes.length > 0) console.log(`  Notas:             ${r.notes.join(" | ")}`);
    console.log("");
  }

  const total = reports.length;
  const talentsOk = reports.filter((r) => r.talents === "ok").length;
  const talentsMissing = reports.filter((r) => r.talents === "missing").length;
  const talentsFail = reports.filter((r) => r.talents === "fail").length;

  console.log("=== RESUMEN — CRITERIO DE GO/NO-GO (sección 32 del plan) ===");
  console.log(`Personajes probados: ${total}`);
  console.log(`Talentos disponibles (talent_loadout_code presente): ${talentsOk}/${total}`);
  console.log(`Talentos ausentes (endpoint responde pero sin loadout code): ${talentsMissing}/${total}`);
  console.log(`Talentos con fallo de endpoint: ${talentsFail}/${total}`);
  console.log("");
  const missingRate = (talentsMissing + talentsFail) / total;
  if (missingRate === 0) {
    console.log("→ GO: talentos fiable al 100% en esta muestra. Player Gap puede incluir talentos desde el lanzamiento.");
  } else if (missingRate < 0.2) {
    console.log("→ GO CONDICIONADO: fallo puntual (<20%). Investigar si es específico de clase/spec antes de decidir.");
  } else {
    console.log("→ ACTIVAR PLAN DE CONTINGENCIA: fallo >20%. Lanzar Player Gap sin comparación de talentos (gear/stats primero).");
  }

  fs.writeFileSync(
    path.join(__dirname, "..", "report.json"),
    JSON.stringify(reports, null, 2)
  );
  console.log("\nReporte detallado guardado en report.json");
}

main().catch((err) => {
  console.error("Error ejecutando la validación:", err);
  process.exit(1);
});
