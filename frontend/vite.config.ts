import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Allow any Host header in dev — we sit behind Caddy reverse proxy,
    // and E2E runs from inside the Docker network using service hostnames.
    allowedHosts: true,
    watch: {
      usePolling: true, // for Docker volume mounts on Windows
    },
    proxy: {
      "/api": {
        target: "http://api:8000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
