// Tanks / free surface, offsets CSV import, overlap guard, stamps, lifeboat capacity.
import { describe, it, expect } from "vitest";
import { blankDesign, demoDesign } from "../src/data/demoDesign";
import { createShip, computeCondition, hydroAt, RHO, centreOutsideHull } from "../src/engine/vessel";
import { parseOffsetsCSV, applyOffsets } from "../src/engine/io";
import { overlapsWith, connections } from "../src/engine/topology";
import { cabinBlock, autoDoors, stairCore, doorSpot, emergencyDoorWidth } from "../src/engine/generators";
import { analyze } from "../src/engine/analyze";
import type { Design } from "../src/engine/types";

function box(): Design {
  const d = blankDesign();
  d.hull = { template: "box", LOA: 100, BOA: 20, depth: 10, designDraft: 5, designSpeedKn: 10, parsonsK: 0.03 };
  d.decks = [{ id: "tt", name: "Tank top", z: 1 }];
  d.bulkheadDeckId = "tt";
  return d;
}

describe("tanks and free surface", () => {
  it("a slack tank adds its liquid mass and reduces GM by rho*l*b^3/12 / displacement", () => {
    const d = box();
    d.loading.lightshipOverride = { massT: 8000, lcg: 50, kg: 4 };
    d.spaces.push({ id: "t", name: "T", type: "tank", deckId: "tt", xCentre: 50, yCentre: 0, length: 10, breadth: 10, persons: 0, tank: { content: "fuel", fillPct: 50 }, outfitKgPerM2: 0 });
    const c = computeCondition(d, createShip(d));
    const vol = 10 * 10 * 2.8 * 0.98; // top deck height 2.8 m, 98 % usable
    const liquid = (0.85 * vol * 0.5);
    expect(c.weights.items.find((i) => i.label === "Tank contents")!.massT).toBeCloseTo(liquid, 3);
    const disp = 8000 + liquid;
    expect(c.FSC).toBeCloseTo((0.85 * 10 * 10 ** 3) / 12 / disp, 6);
    expect(c.KG).toBeCloseTo(c.KGsolid + c.FSC, 9);
  });
  it("a full tank has no free surface", () => {
    const d = box();
    d.spaces.push({ id: "t", name: "T", type: "tank", deckId: "tt", xCentre: 50, yCentre: 0, length: 10, breadth: 10, persons: 0, tank: { content: "ballast", fillPct: 100 } });
    expect(computeCondition(d, createShip(d)).FSC).toBe(0);
  });
});

describe("offsets CSV import", () => {
  const csv = `z\\x,0,50,100\n0,10,10,10\n5,10,10,10\n10,10,10,10\n`;
  it("parses stations, waterlines and half-breadths", () => {
    const o = parseOffsetsCSV(csv);
    expect(o.LOA).toBe(100);
    expect(o.BOA).toBe(20);
    expect(o.waterlines).toEqual([0, 5, 10]);
  });
  it("an imported box hull gives box hydrostatics", () => {
    const d = applyOffsets(blankDesign(), parseOffsetsCSV(csv), "test box");
    d.hull.depth = 10;
    const h = hydroAt(createShip(d), 4);
    expect(h.Vs).toBeCloseTo(100 * 20 * 4, 2);
    expect(h.BMt).toBeCloseTo(400 / 48, 4);
  });
  it("rejects malformed tables with a readable message", () => {
    expect(() => parseOffsetsCSV("a,b\n1,2")).toThrow(/header row/);
    expect(() => parseOffsetsCSV("z,10,5\n0,1,1\n1,1,1")).toThrow(/increase/);
  });
});

describe("overlap guard and stamps", () => {
  it("detects overlap but allows touching", () => {
    const d = demoDesign();
    const cab = structuredClone(d.spaces.find((s) => s.id === "D3-cabP20")!);
    expect(overlapsWith(d, cab).length).toBe(0);
    cab.xCentre += 1;
    expect(overlapsWith(d, cab).map((s) => s.id)).toContain("D3-cabP24");
  });
  it("cabin block creates connected cabins and refuses overlapping placement", () => {
    const d = blankDesign();
    const r = cabinBlock(d, "D3", 30, 0, { cabins: 4, cabinLength: 4, cabinDepth: 4, corridorWidth: 2, persons: 2 });
    expect(r.ok).toBe(true);
    expect(r.spaces.length).toBe(9);
    d.spaces.push(...r.spaces);
    d.doors.push(...r.doors);
    expect(connections(d).doorIssues).toEqual([]);
    expect(cabinBlock(d, "D3", 32, 0, { cabins: 2, cabinLength: 4, cabinDepth: 4, corridorWidth: 2, persons: 2 }).ok).toBe(false);
  });
  it("auto doors connect a room to the corridor beside it", () => {
    const d = blankDesign();
    d.spaces.push({ id: "c", name: "C", type: "corridor", deckId: "D3", xCentre: 50, yCentre: 0, length: 20, breadth: 2, persons: 0 });
    d.spaces.push({ id: "r", name: "R", type: "cabin", deckId: "D3", xCentre: 50, yCentre: 3, length: 4, breadth: 4, persons: 2 });
    const doors = autoDoors(d, "r");
    expect(doors.length).toBe(1);
    expect(doors[0].y).toBeCloseTo(1, 6);
  });
  it("stair core spans to the top deck with a door on each deck", () => {
    const d = blankDesign();
    const r = stairCore(d, "D2", 40, 3);
    expect(r.spaces[0].topDeckId).toBe("D5");
    expect(r.doors.length).toBe(4);
  });
});

describe("lifeboats", () => {
  it("demo has enough survival craft; removing port boats turns it red", () => {
    const d = demoDesign();
    expect(analyze(d, { withCurves: false }).rules.find((r) => r.ruleId === "LSA-CAPACITY")!.status).toBe("green");
    d.lsa = d.lsa.filter((l) => !(l.kind === "lifeboat" && l.y > 0));
    const r = analyze(d, { withCurves: false }).rules.find((r) => r.ruleId === "LSA-CAPACITY")!;
    expect(r.status).toBe("red");
    expect(r.findings[0].message).toMatch(/port side/);
  });
  it("every finding carries a fix", () => {
    const a = analyze(demoDesign(), { withCurves: false });
    for (const r of a.rules) for (const f of r.findings) expect(f.fix, `${r.ruleId}: ${f.message}`).toBeTruthy();
  });
});

void RHO;

describe("emergency doors", () => {
  it("a click near a shared wall snaps onto it and the door connects both spaces", () => {
    const d = demoDesign();
    // D3 corridor aft runs y -1..1 from x 16 to 40; cabin P24 is above it (y 1..5, x 24..28)
    const spot = doorSpot(d, "D3", 26.2, 2.4)!;
    expect(spot.b).toBeDefined();
    expect(spot.y).toBeCloseTo(1, 6);
    const ids = [spot.a, spot.b].sort();
    expect(ids).toContain("D3-cabP24");
    d.doors.push({ id: "new", deckId: "D3", x: spot.x, y: spot.y, widthMm: spot.widthMm });
    const c = connections(d).conns.find((k) => k.id === "new")!;
    expect([c.a, c.b].sort()).toEqual(ids);
  });

  it("a door into a stair gets the stair's clear width, other doors 800 mm, never wider than the wall", () => {
    const d = demoDesign();
    const stairA = d.spaces.find((s) => s.id === "stairA")!;
    const corr = d.spaces.find((s) => s.id === "D3-corr1")!;
    expect(emergencyDoorWidth(stairA, corr)).toBe(1200);
    expect(emergencyDoorWidth(corr, null)).toBe(800);
    expect(emergencyDoorWidth(stairA, corr, 1.0)).toBe(1000);
    const r = stairCore(d, "D5", 104, 0, 1400);
    expect(r.ok).toBe(true);
    expect(r.doors.length).toBeGreaterThan(0);
    expect(r.doors.every((x) => x.widthMm === 1400)).toBe(true);
  });

  it("nothing within reach gives no spot", () => {
    expect(doorSpot(demoDesign(), "D3", 110, 0)).toBeNull();
  });
});

describe("rooms in the water are refused", () => {
  it("centre outside the hull outline is detected, inside is not", () => {
    const d = demoDesign();
    const ship = createShip(d);
    expect(centreOutsideHull(d, ship, { deckId: "D5", xCentre: 32.5, yCentre: -47.75 })).toBe(true);
    expect(centreOutsideHull(d, ship, { deckId: "D5", xCentre: 32.5, yCentre: 0 })).toBe(false);
    expect(centreOutsideHull(d, ship, { deckId: "D3", xCentre: -5, yCentre: 0 })).toBe(true);
    // every space of the demo ship is inside
    expect(d.spaces.filter((s) => centreOutsideHull(d, ship, s)).map((s) => s.name)).toEqual([]);
  });
});
