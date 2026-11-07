// Major pipes and cables: geometry (analytic), default arrangement and the four checks.
import { describe, it, expect } from "vitest";
import { demoDesign } from "../src/data/demoDesign";
import { analyze } from "../src/engine/analyze";
import { segDistance, clipToRect, runSegments, runLength, runZ, spacesCrossed, watertightCrossings, runClearance } from "../src/engine/systems";
import { exportDesign, parseDesign } from "../src/engine/io";
import type { Design, Run } from "../src/engine/types";

const rule = (d: Design, id: string) => analyze(d, { withCurves: false }).rules.find((r) => r.ruleId === id)!;
const run = (id: string, kind: Run["kind"], pts: [number, number, string][], sizeMm = 200): Run => ({ id, kind, name: id, sizeMm, points: pts.map(([x, y, deckId]) => ({ x, y, deckId })) });

describe("geometry", () => {
  it("distance between segments matches hand values", () => {
    // parallel, 3 m apart
    expect(segDistance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }, { x: 8, y: 3, z: 0 }).d).toBeCloseTo(3, 9);
    // skew: along x at z = 0, along y at z = 2 crossing above it
    expect(segDistance({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 1, y: -5, z: 2 }, { x: 1, y: 5, z: 2 }).d).toBeCloseTo(2, 9);
    // end to end: (10,0,0) to (13,4,0) = 5
    expect(segDistance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 13, y: 4, z: 0 }, { x: 20, y: 4, z: 0 }).d).toBeCloseTo(5, 9);
  });
  it("clips a segment to a room outline", () => {
    const c = clipToRect(0, 1, 10, 1, { x0: 2, x1: 6, y0: 0, y1: 2 }, 0)!;
    expect(c[0] * 10).toBeCloseTo(2, 9);
    expect(c[1] * 10).toBeCloseTo(6, 9);
    expect(clipToRect(0, 3, 10, 3, { x0: 2, x1: 6, y0: 0, y1: 2 }, 0)).toBeNull();
  });
  it("puts runs under the deckhead and measures risers by their height", () => {
    const d = demoDesign();
    expect(runZ(d, "D3")).toBeCloseTo(12 - 0.06, 9); // D3 at 9 m, D4 at 12 m
    const r = run("t", "fire_main", [
      [10, 0, "D2"],
      [20, 0, "D2"],
      [20, 0, "D4"],
    ]);
    expect(runSegments(d, r)[1].vertical).toBe(true);
    expect(runSegments(d, r)[1].deckIds).toEqual(["D2", "D3", "D4"]);
    expect(runLength(d, r)).toBeCloseTo(10 + 6, 9); // D2 deckhead 8.94 to D4 deckhead 14.94
  });
});

describe("default arrangement on the demo ferry", () => {
  const d = demoDesign();
  it("has the major pipes and cables", () => {
    const kinds = new Set(d.runs.map((r) => r.kind));
    for (const k of ["fire_main", "bilge_ballast", "fuel_oil", "exhaust", "hv_cable", "feeder_cable"]) expect(kinds.has(k as Run["kind"]), k).toBe(true);
    expect(d.runs.filter((r) => r.kind === "fire_main").length).toBe(6); // riser + Decks 1 to 5
  });
  it("only the bilge main goes through the collision bulkhead", () => {
    const through = d.runs.filter((r) => watertightCrossings(d, r).some((c) => c.bulkhead.id === "wt8"));
    expect(through.map((r) => r.kind)).toEqual(["bilge_ballast"]);
  });
  it("shows the two deliberate problems and nothing else", () => {
    const a = analyze(d, { withCurves: false });
    const get = (id: string) => a.rules.find((r) => r.ruleId === id)!;
    expect(get("PIPE-FIRE-MAIN").status).toBe("green");
    expect(get("PIPE-WATERTIGHT").status).toBe("green");
    const fuel = get("PIPE-FUEL-HOT");
    expect(fuel.status).toBe("amber");
    expect(fuel.findings.map((f) => f.message)).toEqual([expect.stringMatching(/Fuel oil line 1 .* passes 0\.\d\d m from Exhaust uptake 1/)]);
    const cab = get("CABLE-ROUTING");
    expect(cab.status).toBe("amber");
    expect(cab.findings.map((f) => f.message)).toEqual(["Feeder cable Deck 4 runs through Galley."]);
    expect(cab.findings[0].at?.deckId).toBe("D4");
  });
  it("pump pressure follows 0.40 N/mm2 + rho g h", () => {
    const fm = rule(d, "PIPE-FIRE-MAIN");
    const need = 0.4 + (1025 * 9.81 * (runZ(d, "D5")! - 2)) / 1e6; // highest fire main under the Deck 5 deckhead, pumps on Deck 1
    expect(fm.summary).toContain(`${need.toFixed(2)} N/mm2`);
  });
  it("survives a design file round trip", () => {
    const back = parseDesign(exportDesign(d));
    expect(back.runs).toEqual(d.runs);
  });
});

describe("targeted edits change the verdicts", () => {
  it("a deck without its fire main is red", () => {
    const d = demoDesign();
    d.runs = d.runs.filter((r) => r.id !== "fm-D4");
    const r = rule(d, "PIPE-FIRE-MAIN");
    expect(r.status).toBe("red");
    expect(r.findings[0].message).toMatch(/^Deck 4 has no fire main in fire zones zone 1 .*zone 2 .*zone 3/);
  });
  it("a fire main that does not touch the riser is not fed", () => {
    const d = demoDesign();
    for (const p of d.runs.find((r) => r.id === "fm-D3")!.points) p.y = 3;
    const r = rule(d, "PIPE-FIRE-MAIN");
    expect(r.status).toBe("red");
    expect(r.findings.map((f) => f.message)).toContain("Fire main Deck 3 is not connected to the fire pumps.");
  });
  it("pumps that cannot lift the water to the top hydrant are red", () => {
    const d = demoDesign();
    d.decks.push({ id: "D7", name: "Deck 7", z: 95 });
    d.runs.push(run("tall", "fire_main", [
      [50, 0, "D1"],
      [50, 0, "D7"],
    ]));
    const r = rule(d, "PIPE-FIRE-MAIN");
    expect(r.findings.some((f) => f.status === "red" && /N\/mm2 to give 0.4 N\/mm2 at the highest hydrant on Deck 7/.test(f.message))).toBe(true);
  });
  it("a cable or a second pipe through the collision bulkhead is red", () => {
    const d = demoDesign();
    d.runs.push(run("bowcable", "hv_cable", [
      [100, -2, "D1"],
      [111, -2, "D1"],
    ], 120));
    d.runs.push(run("bowpipe", "bilge_ballast", [
      [100, -1, "D1"],
      [111, -1, "D1"],
    ]));
    const r = rule(d, "PIPE-WATERTIGHT");
    expect(r.status).toBe("red");
    expect(r.findings.map((f) => f.message)).toEqual(["bowcable goes through the collision bulkhead below the bulkhead deck.", "2 pipes go through the collision bulkhead below the bulkhead deck; 1 is allowed."]);
  });
  it("a fuel line touching the exhaust is red, one through cabins amber", () => {
    const d = demoDesign();
    const ex = d.runs.find((r) => r.id === "exhaust-1")!.points[0];
    d.runs.push(run("hotfuel", "fuel_oil", [
      [ex.x - 3, ex.y, "D1"],
      [ex.x + 3, ex.y, "D1"],
    ], 100));
    d.runs.push(run("cabinfuel", "fuel_oil", [
      [24, 3, "D2"],
      [36, 3, "D2"],
    ], 100));
    const r = rule(d, "PIPE-FUEL-HOT");
    expect(r.findings.find((f) => f.targets.includes("hotfuel"))!.status).toBe("red");
    expect(r.findings.find((f) => f.targets.includes("cabinfuel"))!.message).toBe("cabinfuel runs through D2 cabin P24, D2 cabin P28, D2 cabin P32."); // ends on the wall at x 36
    expect(runClearance(d, d.runs.find((x) => x.id === "hotfuel")!, d.runs.find((x) => x.id === "exhaust-1")!)!.gap).toBeLessThan(0);
  });
  it("a cable next to the exhaust casing is amber; the galley detour removed turns the rule green", () => {
    const d = demoDesign();
    const f4 = d.runs.find((r) => r.id === "feeder-D4")!;
    f4.points = [f4.points[0], f4.points[f4.points.length - 1]];
    expect(rule(d, "CABLE-ROUTING").status).toBe("green");
    const ex = d.runs.find((r) => r.id === "exhaust-1")!.points[0];
    d.runs.push(run("near", "feeder_cable", [
      [ex.x - 4, ex.y + 0.7, "D3"],
      [ex.x + 4, ex.y + 0.7, "D3"],
    ], 80));
    const r = rule(d, "CABLE-ROUTING");
    expect(r.status).toBe("amber");
    expect(r.findings[0].message).toMatch(/^near passes 0\.\d\d m from Exhaust uptake 1/);
  });
  it("spaces crossed by a riser count every deck it passes", () => {
    const d = demoDesign();
    const ex = d.runs.find((r) => r.id === "exhaust-1")!;
    const names = spacesCrossed(d, ex).map((c) => c.space.deckId);
    expect(new Set(names)).toEqual(new Set(["D1", "D2", "D3", "D4", "D5"]));
  });
});
