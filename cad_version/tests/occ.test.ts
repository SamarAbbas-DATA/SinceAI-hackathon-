import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { buildHullStep, readStep } from "../src/occ/kernel";
import { DEFAULT_HULL, hullMesh, loftSections } from "../src/core/hull";
import { massProps, topology, weld } from "../src/core/mesh";

const require = createRequire(import.meta.url);

beforeAll(async () => {
  const wasm = require.resolve("replicad-opencascadejs/wasm");
  const OC = await (opencascade as any)({ locateFile: () => wasm });
  setOC(OC);
});

describe("CAD kernel (OpenCascade)", () => {
  it("builds a STEP solid matching the mesh volume, and reads it back as a watertight mesh", async () => {
    const out = await buildHullStep(loftSections(DEFAULT_HULL));
    const meshV = massProps(hullMesh(DEFAULT_HULL, 160, 48)).volume;
    expect(Math.abs(out.volume - meshV) / meshV).toBeLessThan(0.01);
    const txt = new TextDecoder().decode(out.step.slice(0, 400));
    expect(txt).toContain("ISO-10303-21");
    const back = await readStep(out.step);
    const m = weld(back.vertices, back.triangles, 1e-4);
    expect(topology(m).watertight).toBe(true);
    expect(Math.abs(massProps(m).volume - meshV) / meshV).toBeLessThan(0.015);
    console.log("step bytes", out.step.byteLength, "vol", out.volume, "mesh", meshV, "bounds", JSON.stringify(out.bounds));
  });
});
