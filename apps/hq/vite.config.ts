import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
});
