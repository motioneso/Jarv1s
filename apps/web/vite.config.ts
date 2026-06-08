import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.JARVIS_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", apiTarget);
          });
        }
      },
      "/health": {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 4173
  }
});
