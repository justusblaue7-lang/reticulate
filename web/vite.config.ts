import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The engine API runs on :8000 (`reticulate serve`); the dev server proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
