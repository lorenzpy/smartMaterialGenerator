import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Multi-material fork: build and dev server for the single-threaded WASM
// (`npm run wasm:st`). No cross-origin-isolation headers and no coi service
// worker: this checkout ships no threaded WASM build, and the page would
// otherwise reload once on first visit just to end up on the single-threaded
// module anyway. Slower solves, same results.
const withoutCoiServiceWorker: Plugin = {
  name: "without-coi-serviceworker",
  transformIndexHtml: (html) => html.replace(/<script[^>]*coi-serviceworker\.js[^>]*><\/script>\s*/g, ""),
};

export default defineConfig({
  base: process.env.VITE_BASE,
  plugins: [react(), withoutCoiServiceWorker],
  build: { target: "esnext" },
  worker: { format: "es" },
  esbuild: { target: "esnext" },
});
