import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { jarvisModuleSettingsPlugin, jarvisModuleWebPlugin } from "@jarv1s/settings-ui/vite";

const apiTarget = process.env.JARVIS_API_PROXY_TARGET ?? "http://localhost:3000";
const rootDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), jarvisModuleSettingsPlugin({ rootDir }), jarvisModuleWebPlugin({ rootDir })],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
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
