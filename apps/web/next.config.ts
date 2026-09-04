import type { NextConfig } from "next";

const config: NextConfig = {
  // El monorepo no tiene paso de build: los paquetes compartidos se publican
  // como TypeScript fuente (`main` apunta a src/index.ts). Sin esto, Next
  // resuelve el import y se encuentra .ts sin transpilar.
  transpilePackages: ["@wowpvp/core", "@wowpvp/data", "@wowpvp/blizzard"],
  // Next escribe un AGENTS.md y un CLAUDE.md dentro de `apps/web` en cada
  // arranque de `next dev`. Las instrucciones de este repo viven en el CLAUDE.md
  // de la raíz, así que ese par de ficheros son dos copias sin dueño que
  // contradicen a la única fuente y aparecen sin pedirlas en cada `git status`.
  agentRules: false,
};

export default config;
