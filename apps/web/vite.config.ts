import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // No changeOrigin: the server checks the browser's Origin (http://localhost:5173).
    proxy: {
      "/trpc": SERVER,
      "/chunk": SERVER,
      "/overview": SERVER,
      "/auth": SERVER,
      "/ws": { target: SERVER, ws: true },
    },
  },
});
