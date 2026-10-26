import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works under any GitHub Pages subpath.
  base: "./",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  server: { port: 5174 },
});
