import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
  build: { chunkSizeWarningLimit: 4000 },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 120000 },
} as any);
