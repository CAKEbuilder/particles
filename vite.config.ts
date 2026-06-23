import { defineConfig } from "vite";

// Lean config: static SPA, exposed on the LAN so we can test on real phones.
export default defineConfig({
  base: "./",
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
