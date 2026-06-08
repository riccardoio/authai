import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev runs Vite on 5173 and the Hono backend on 4000. The /api/*
// proxy keeps the SPA's "same-origin fetch" assumption working in dev,
// matching prod where one Hono process serves both static + API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
