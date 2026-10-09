import { defineConfig } from "vite";

// Tauri expects a fixed port and fails if it's taken. 1430 so it can run beside Prestige (1420).
export default defineConfig({
  clearScreen: false,
  server: { port: 1430, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", outDir: "dist", chunkSizeWarningLimit: 8000 },
  worker: { format: "es" },
});
