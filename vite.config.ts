import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * The source PDFs live in docs/ (rules.json, the tests and the "Open p. N" links use docs/...).
 * The dev server serves the whole project folder, but a production build only contains public/,
 * so copy the PDFs into dist/docs after the build. Needed for static hosting (Netlify).
 */
function copyDocs(): Plugin {
  let outDir = "dist";
  return {
    name: "copy-docs-pdfs",
    apply: "build",
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const src = path.resolve(__dirname, "docs");
      if (!fs.existsSync(src)) return;
      const copy = (from: string, to: string) => {
        for (const e of fs.readdirSync(from, { withFileTypes: true })) {
          const a = path.join(from, e.name),
            b = path.join(to, e.name);
          if (e.isDirectory()) copy(a, b);
          else if (e.name.toLowerCase().endsWith(".pdf")) {
            fs.mkdirSync(to, { recursive: true });
            fs.copyFileSync(a, b);
          }
        }
      };
      copy(src, path.join(outDir, "docs"));
    },
  };
}

/**
 * In development, serve /api/fix-choice with the same Netlify Function code, reading OPENROUTER_API_KEY from .env.
 * (On Netlify the function runs for real; on any other static host the AI simply reports "offline".)
 */
function devFunctions(mode: string): Plugin {
  return {
    name: "dev-netlify-functions",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), "");
      for (const k of ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_FALLBACK_MODEL"]) if (env[k]) process.env[k] = env[k];
      server.middlewares.use("/api/fix-choice", async (req, res) => {
        try {
          const mod = await server.ssrLoadModule("/netlify/functions/fix-choice.mts");
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const request = new Request("http://localhost/api/fix-choice", { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "POST" ? Buffer.concat(chunks).toString() : undefined });
          const r: Response = await mod.default(request, { ip: req.socket.remoteAddress });
          res.statusCode = r.status;
          res.setHeader("Content-Type", "application/json");
          res.end(await r.text());
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), copyDocs(), devFunctions(mode)],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}) as any);
