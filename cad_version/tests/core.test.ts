import { describe, expect, it } from "vitest";
import { massProps, topology, type Mesh } from "../src/core/mesh";
import { equilibrium, gzCurve, RHO_FRESH } from "../src/core/hydro";
import { DEFAULT_HULL, hullMesh, PARAMS, type HullParams } from "../src/core/hull";
import { analyze, DEFAULT_LOAD } from "../src/core/analyze";
import { DEFAULT_PRINT, bedFit, PRINTERS } from "../src/core/print";
import { toSTL, to3MF } from "../src/core/exporters";
import { unzipSync } from "fflate";

/** Closed box L x B x D with the keel at z = 0, built from 12 outward triangles. */
function box(L: number, B: number, D: number): Mesh {
  const v = [
    [0, -B / 2, 0], [L, -B / 2, 0], [L, B / 2, 0], [0, B / 2, 0],
    [0, -B / 2, D], [L, -B / 2, D], [L, B / 2, D], [0, B / 2, D],
  ];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { pos: new Float32Array(v.flat()), idx: new Uint32Array(f) };
}

describe("box barge, analytic", () => {
  const L = 200, B = 40, D = 30;
  const m = box(L, B, D);
  it("is a closed outward solid with the right volume", () => {
    expect(topology(m).watertight).toBe(true);
    expect(massProps(m).volume).toBeCloseTo(L * B * D, 3);
  });
  it("floats at T = m / (rho L B) with GM = T/2 + B^2/(12T) - KG", () => {
    const T = 12, KG = 14;
    const mass = RHO_FRESH * L * B * T;
    const eq = equilibrium(m, { mass, G: [L / 2, 0, KG], rho: RHO_FRESH });
    expect(eq.Tm).toBeCloseTo(T, 4);
    expect(Math.abs(eq.trim)).toBeLessThan(1e-4);
    expect(eq.GM).toBeCloseTo(T / 2 + (B * B) / (12 * T) - KG, 4);
  });
  it("wall-sided GZ = sin(phi) (GM + BM/2 tan^2 phi) before the deck edge goes under", () => {
    const T = 12, KG = 14;
    const mass = RHO_FRESH * L * B * T;
    const GM = T / 2 + (B * B) / (12 * T) - KG, BM = (B * B) / (12 * T);
    const gz = gzCurve(m, { mass, G: [L / 2, 0, KG], rho: RHO_FRESH }, 0, [5, 10, 20, 30]);
    for (const p of gz) {
      const ph = (p.heel * Math.PI) / 180;
      expect(p.gz).toBeCloseTo(Math.sin(ph) * (GM + (BM / 2) * Math.tan(ph) ** 2), 3);
    }
  });
  it("trims when the weight moves forward: tan(trim) = shift / GML", () => {
    const T = 12, KG = 14, s = 4;
    const mass = RHO_FRESH * L * B * T;
    const eq = equilibrium(m, { mass, G: [L / 2 + s, 0, KG], rho: RHO_FRESH });
    const GML = T / 2 + (L * L) / (12 * T) - KG;
    expect(Math.tan((eq.trim * Math.PI) / 180)).toBeCloseTo(s / GML, 3);
  });
});

describe("parametric hull", () => {
  it("is watertight and outward for random parameters", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 60; n++) {
      const p = { ...DEFAULT_HULL } as HullParams;
      for (const s of PARAMS) (p as any)[s.key] = s.min + rnd() * (s.max - s.min);
      const m = hullMesh(p, 40, 16);
      const t = topology(m);
      expect(t.watertight, JSON.stringify(p)).toBe(true);
      expect(t.shells).toBe(1);
      expect(massProps(m).volume).toBeGreaterThan(0);
    }
  });
  it("volume converges with resolution", () => {
    const a = massProps(hullMesh(DEFAULT_HULL, 64, 24)).volume;
    const b = massProps(hullMesh(DEFAULT_HULL, 200, 64)).volume;
    expect(Math.abs(a - b) / b).toBeLessThan(0.005);
  });
  it("default design floats, fits the default printer and needs no supports deck-down", () => {
    const a = analyze({ mesh: hullMesh(DEFAULT_HULL), print: DEFAULT_PRINT, load: DEFAULT_LOAD, water: "fresh", lambda: 400, printFlip: true });
    expect(a.eq?.sinks).toBe(false);
    expect(a.fit.fits).toBe(true);
    expect(a.overhang.fraction).toBeLessThan(0.02);
    expect(a.gz.length).toBeGreaterThan(5);
  });
});

describe("print and files", () => {
  it("diagonal placement fits a 290 mm part on a 256 mm bed", () => {
    const f = bedFit(290, 50, 25, PRINTERS[0], 5);
    expect(f.fits).toBe(true);
    expect(f.angle).toBeGreaterThan(0);
  });
  it("binary STL has the right size and 3MF unzips with a model", () => {
    const m = hullMesh(DEFAULT_HULL, 20, 8);
    expect(toSTL(m).length).toBe(84 + 50 * (m.idx.length / 3));
    const z = unzipSync(to3MF(m));
    expect(Object.keys(z)).toContain("3D/3dmodel.model");
    expect(new TextDecoder().decode(z["3D/3dmodel.model"])).toContain('unit="millimeter"');
  });
});
