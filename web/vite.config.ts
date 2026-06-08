import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The engine + server are workspace packages whose `exports` point at TS source,
// so we exclude them from dep pre-bundling (Vite handles them as source) and allow
// serving from the workspace root.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["drinkwars-engine", "drinkwars-server"] },
  server: { fs: { allow: [".."] } },
});
