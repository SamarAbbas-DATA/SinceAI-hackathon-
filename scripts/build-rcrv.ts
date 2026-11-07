// Writes the RCRV research vessel as import files: CSV tables (src/engine/shipFiles.ts) and the exterior
// model (.glb). Output: public/models/rcrv/ (served by the app, also there to upload by hand).
// Usage: npx vite-node scripts/build-rcrv.ts
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { rcrvDesign, RCRV } from "../src/data/rcrv";
import { rcrvExterior } from "../src/data/rcrvExterior";
import { exportShipFiles, slug } from "../src/engine/shipFiles";
import { writeGlb } from "../src/engine/glb";

const out = join(process.cwd(), "public", "models", "rcrv");
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f));
const source = "12100-RCRV-199 Navisworks model (rebuilt from model views) and published main data";
const d = rcrvDesign();
const files = exportShipFiles(d, source);
for (const f of files) writeFileSync(join(out, f.name), f.text);
const parts = rcrvExterior();
const glbName = `${slug(d.name)}_exterior.glb`;
const glb = writeGlb(parts, { coords: "ship", units: "m", role: "exterior", name: d.name, loa: RCRV.LOA, source });
writeFileSync(join(out, glbName), glb);
const list = [...files.map((f) => f.name), glbName];
writeFileSync(join(out, "files.txt"), list.join("\n") + "\n");
const tris = parts.reduce((a, p) => a + p.idx.length / 3, 0);
console.log(`${list.length} files in ${out}; exterior ${tris} triangles, ${(glb.byteLength / 1024).toFixed(0)} kB`);
