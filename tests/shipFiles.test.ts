// Ship files (CSV tables + exterior .glb) and the RCRV research vessel built from them.
import { describe, it, expect } from "vitest";
import { rcrvDesign, rcrvHB, RCRV } from "../src/data/rcrv";
import { rcrvExterior } from "../src/data/rcrvExterior";
import { exportShipFiles, importShipFiles, tableKind, parseCSV } from "../src/engine/shipFiles";
import { writeGlb, SHIP_COORDS_TAG } from "../src/engine/glb";
import { analyze } from "../src/engine/analyze";
import { createShip, computeCondition, hydroAt } from "../src/engine/vessel";
import { overlaps } from "../src/engine/topology";
import { demoDesign } from "../src/data/demoDesign";
import { planFixes } from "../src/engine/fixes";

const SRC = "test";
const rcrv = rcrvDesign();
const a = analyze(rcrv, { withCurves: false });

describe("RCRV research vessel", () => {
  it("has the published main dimensions and floats level at the published draught", () => {
    expect(rcrv.hull.LOA).toBeCloseTo(60.6, 2);
    expect(rcrv.hull.BOA).toBeCloseTo(12.4, 2);
    const c = a.condition!;
    expect(Math.abs(c.T - RCRV.draft)).toBeLessThan(0.02);
    expect(Math.abs(c.trimByStern)).toBeLessThan(0.05);
    expect(c.GMt).toBeGreaterThan(1.4);
  });

  it("vessel.js volume of the offsets matches a direct integration of the hull shape", () => {
    // displaced volume at the design draught: integral of 2 * half-breadth over x and z, on a fine grid
    const T = RCRV.draft;
    let vol = 0;
    const dx = 0.05,
      dz = 0.02;
    for (let x = dx / 2; x < RCRV.LOA; x += dx) for (let z = dz / 2; z < T; z += dz) vol += 2 * rcrvHB(x, z) * dx * dz;
    const ship = createShip(rcrv);
    const h = hydroAt(ship, T);
    // the offsets table is a coarse sample of the shape (31 stations, 16 waterlines): a few per cent
    expect(Math.abs(h.Vs - vol) / vol).toBeLessThan(0.04);
  });

  it("has a clean arrangement: no overlaps, nothing outside the hull, no red geometry", () => {
    expect(overlaps(rcrv)).toEqual([]);
    expect(a.geometry.filter((g) => g.status === "red")).toEqual([]);
    expect(a.geometry.filter((g) => /sticks out/.test(g.message))).toEqual([]);
  });

  it("passes the escape, fire, stair, pipe and cable checks; keeps the score of an early design", () => {
    const st = (id: string) => a.rules.find((r) => r.ruleId === id)!.status;
    for (const id of ["FIRE-WALL-RATING", "ESCAPE-STAIR-WIDTH", "PIPE-FIRE-MAIN", "PIPE-WATERTIGHT", "PIPE-FUEL-HOT", "CABLE-ROUTING", "COLLISION-BULKHEAD", "DESIGN-SANITY", "WEIGHT-MARGIN"]) expect(st(id), id).toBe("green");
    expect(st("ESCAPE-TWO-EXITS")).not.toBe("red");
    expect(a.score.score).toBeGreaterThanOrEqual(70);
  });

  it("Fix with AI works on the imported ship and never lowers its score", async () => {
    const plan = await planFixes(importShipFiles(exportShipFiles(rcrv, SRC)).design, { timeBudgetMs: 20000 });
    expect(plan.scoreAfter).toBeGreaterThanOrEqual(plan.scoreBefore);
  }, 30000);

  it("only keeps what the tool checks: rooms, stairs and tanks; persons only in cabins", () => {
    expect(rcrv.spaces.every((s) => s.persons === 0 || s.type === "cabin")).toBe(true);
    expect(rcrv.people.passengers + rcrv.people.crew).toBe(rcrv.spaces.reduce((n, s) => n + s.persons, 0));
  });
});

describe("ship files", () => {
  it("tells every table apart by its header", () => {
    const files = exportShipFiles(rcrv, SRC);
    const kinds = files.map((f) => tableKind(f.text));
    expect(new Set(kinds).size).toBe(files.length);
    expect(kinds).not.toContain(null);
  });

  it("round trip: the RCRV read back from its files gives the same ship and the same results", () => {
    const back = importShipFiles(exportShipFiles(rcrv, SRC));
    expect(back.skipped).toEqual([]);
    const d = back.design;
    expect(d.spaces.map((s) => s.id)).toEqual(rcrv.spaces.map((s) => s.id));
    for (const s of d.spaces) {
      const o = rcrv.spaces.find((x) => x.id === s.id)!;
      expect(Math.abs(s.xCentre - o.xCentre) + Math.abs(s.yCentre - o.yCentre) + Math.abs(s.length - o.length) + Math.abs(s.breadth - o.breadth)).toBeLessThan(1e-3);
      expect(s.type).toBe(o.type);
      expect(s.persons).toBe(o.persons);
    }
    expect(d.doors.length).toBe(rcrv.doors.length);
    expect(d.runs.length).toBe(rcrv.runs.length);
    expect(d.divisions).toEqual(rcrv.divisions);
    expect(d.decks).toEqual(rcrv.decks);
    const b = analyze(d, { withCurves: false });
    expect(b.score.score).toBe(a.score.score);
    expect(b.condition!.T).toBeCloseTo(a.condition!.T, 3);
    expect(b.rules.map((r) => r.status)).toEqual(a.rules.map((r) => r.status));
  });

  it("round trip of a design with a template hull (the demo ferry)", () => {
    const demo = demoDesign();
    const d = importShipFiles(exportShipFiles(demo, SRC)).design;
    const x = analyze(demo, { withCurves: false }),
      y = analyze(d, { withCurves: false });
    expect(y.score.score).toBe(x.score.score);
    expect(computeCondition(d, createShip(d)).T).toBeCloseTo(x.condition!.T, 3);
  });

  it("the files in public/models/rcrv are up to date with src/data/rcrv.ts (run scripts/build-rcrv.ts)", () => {
    const all = Object.keys(import.meta.glob("../public/models/rcrv/*")).map((k) => k.split("/").pop()!);
    const text = import.meta.glob("../public/models/rcrv/*.{csv,txt}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const read = (n: string) => text[`../public/models/rcrv/${n}`];
    const names = read("files.txt").split(/\r?\n/).filter(Boolean);
    expect(all.sort()).toEqual([...names, "files.txt"].sort());
    const csv = names.filter((n) => n.endsWith(".csv")).map((n) => ({ name: n, text: read(n) }));
    const fresh = exportShipFiles(rcrv, "x");
    expect(JSON.stringify(importShipFiles(csv).design)).toBe(JSON.stringify(importShipFiles(fresh).design));
  });

  it("leaves out what it cannot use and says why", () => {
    const files = exportShipFiles(rcrv, SRC);
    const comp = files.find((f) => tableKind(f.text) === "compartments")!;
    comp.text += 'mast-1,"Main mast",mast,D02,,40,41,-0.5,0.5,0\nant-1,Radar antenna,other,D05,,40,41,-0.5,0.5,0\n';
    const sys = files.find((f) => tableKind(f.text) === "systems")!;
    sys.text += "hvac-1,hvac_duct,Supply duct,400,1,30,0,MD\nhvac-1,hvac_duct,Supply duct,400,2,40,0,MD\n";
    const rep = importShipFiles([...files, { name: "notes.csv", text: "a,b\n1,2\n" }]);
    expect(rep.skipped.length).toBe(3);
    expect(rep.skipped[0]).toMatch(/Main mast: type "mast"/);
    expect(rep.skipped[1]).toMatch(/deck "D05"/);
    expect(rep.ignoredFiles).toEqual(["notes.csv"]);
    expect(rep.design.spaces.length).toBe(rcrv.spaces.length);
    expect(rep.design.runs.length).toBe(rcrv.runs.length);
  });

  it("needs decks and compartments", () => {
    const files = exportShipFiles(rcrv, SRC).filter((f) => tableKind(f.text) !== "decks");
    expect(() => importShipFiles(files)).toThrow(/No decks table/);
  });

  it("reads quoted names, semicolons and comment lines", () => {
    expect(parseCSV('# c\nid;name\n1;"Master\'s cabin, aft"\n')).toEqual([
      ["id", "name"],
      ["1", "Master's cabin, aft"],
    ]);
    expect(parseCSV('a,b\n"say ""hi""",2')).toEqual([
      ["a", "b"],
      ['say "hi"', "2"],
    ]);
  });
});

describe("exterior .glb", () => {
  const parts = rcrvExterior();
  const glb = writeGlb(parts, { coords: "ship", units: "m" });
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));

  it("is a valid glTF 2.0 binary with one primitive per colour, tagged as ship coordinates", () => {
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes[0].primitives.length).toBe(parts.length);
    expect(json.scenes[0].extras[SHIP_COORDS_TAG].coords).toBe("ship");
    const binLen = dv.getUint32(20 + jsonLen, true);
    expect(json.buffers[0].byteLength).toBe(binLen);
    expect(glb.byteLength).toBeLessThan(4 * 1024 * 1024); // light enough for the browser
  });

  it("is Y-up and in metres: the bounding box matches the ship", () => {
    const pos = json.meshes[0].primitives.map((p: { attributes: { POSITION: number } }) => json.accessors[p.attributes.POSITION]);
    const max = [0, 1, 2].map((k) => Math.max(...pos.map((a: { max: number[] }) => a.max[k])));
    const min = [0, 1, 2].map((k) => Math.min(...pos.map((a: { min: number[] }) => a.min[k])));
    expect(min[0]).toBeCloseTo(0, 1); // stern
    expect(max[0]).toBeGreaterThan(RCRV.LOA - 0.5); // bow
    expect(max[0]).toBeLessThan(RCRV.LOA + 1);
    expect(min[1]).toBeCloseTo(0, 1); // keel (Y is up)
    expect(max[1]).toBeGreaterThan(14); // top of the wheelhouse and the stack
    expect(max[2] - min[2]).toBeLessThan(RCRV.BOA + 0.5); // beam (Z = -y)
  });
});
