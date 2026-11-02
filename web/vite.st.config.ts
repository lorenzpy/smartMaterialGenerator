import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-material fork: dev server WITHOUT cross-origin-isolation headers, so
// the engine uses the single-threaded WASM build (`npm run wasm:st`) and no
// threaded build / nightly toolchain is needed. Slower solves, same results.
export default defineConfig({
  base: process.env.VITE_BASE,
  plugins: [react()],
  build: { target: "esnext" },
  worker: { format: "es" },
  esbuild: { target: "esnext" },
});
