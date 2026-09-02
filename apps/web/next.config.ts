import type { NextConfig } from "next";

const config: NextConfig = {
  // El monorepo no tiene paso de build: los paquetes compartidos se publican
  // como TypeScript fuente (`main` apunta a src/index.ts). Sin esto, Next
  // resuelve el import y se encuentra .ts sin transpilar.
  transpilePackages: ["@wowpvp/core", "@wowpvp/data", "@wowpvp/blizzard"],
};

export default config;
