import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      manifest: {
        name: "Astrozor",
        short_name: "Astrozor",
        description: "Astrozor — kolaborativní platforma pro aktivní astronomy",
        theme_color: "#0b1020",
        background_color: "#0b1020",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        lang: "cs",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^\/api\/v1\/healthz$/,
            handler: "NetworkFirst",
            options: { cacheName: "astrozor-healthz" },
          },
        ],
      },
      devOptions: { enabled: true, type: "module" },
    }),
  ],
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
