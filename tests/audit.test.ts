// Checks added in the regulation audit: collision bulkhead position (SOLAS II-1/12.1), passenger heel
// (IS Code 3.1), survival craft height, corridors to stairs (REG13 G5.1) and basic plausibility.
import { describe, it, expect } from "vitest";
import { demoDesign } from "../src/data/demoDesign";
import { analyze } from "../src/engine/analyze";
import { heelForLever, passengerHeel, freeboardLength } from "../src/engine/rules";
import type { GZResult } from "../src/engine/stability";
import type { Design } from "../src/engine/types";

const run = (d: Design) => analyze(d, { withCurves: false });
const rule = (d: Design, id: string) => run(d).rules.find((r) => r.ruleId === id)!;
const ctxOf = (d: Design) => {
  const a = run(d);
  return { design: d, ship: a.ship!, graph: a.graph, condition: a.condition, evac: a.evac, flood: a.flood, gz: a.gz };
};

describe("collision bulkhead (SOLAS II-1/12.1)", () => {
  it("Lf and the band follow the formula", () => {
    const d = demoDesign();
    const fl = freeboardLength(ctxOf(d))!;
    const minD = Math.min(0.05 * fl.Lf, 10),
      maxD = Math.max(0.08 * fl.Lf, 0.05 * fl.Lf + 3);
    const r = rule(d, "COLLISION-BULKHEAD");
    expect(r.summary).toContain(`allowed ${minD.toFixed(1)} m to ${maxD.toFixed(1)} m`);
    expect(r.summary).toContain(`${(fl.xFP - 108).toFixed(1)} m aft`);
  });
  it("the demo ferry's collision bulkhead is too far aft; moving it into the band turns it green", () => {
    const d = demoDesign();
    expect(rule(d, "COLLISION-BULKHEAD").status).toBe("red");
    const fl = freeboardLength(ctxOf(d))!;
    const maxD = Math.max(0.08 * fl.Lf, 0.05 * fl.Lf + 3);
    d.bulkheads.find((b) => b.id === "wt8")!.x = fl.xFP - (maxD - 1.5);
    expect(rule(d, "COLLISION-BULKHEAD").status).toBe("green");
  });
});

describe("passenger heel (IS Code 3.1)", () => {
  it("heel for a constant lever solves GM sin(phi) = l cos(phi)", () => {
    const GM = 2;
    const points = Array.from({ length: 31 }, (_, i) => ({ deg: i * 2, gz: GM * Math.sin((i * 2 * Math.PI) / 180) })); // curve ends at 60 degrees
    const gz = { points } as unknown as GZResult;
    expect(heelForLever(gz, 0.5)).toBeCloseTo((Math.atan(0.5 / GM) * 180) / Math.PI, 1);
    expect(heelForLever(gz, 0)).toBe(0);
    expect(heelForLever(gz, 5)).toBe(Infinity); // tan(phi) = 2.5 needs 68 degrees: beyond the curve, more than the ship can resist
  });
  it("turning lever = 0.2 v2 / (g LWL) (KG - T/2)", () => {
    const d = demoDesign();
    const ctx = ctxOf(d);
    const c = ctx.condition!;
    const v0 = d.hull.designSpeedKn * 0.5144;
    const expected = (0.2 * v0 * v0 * (c.KG - c.T / 2)) / (9.81 * c.hydro.LWL);
    expect(passengerHeel(ctx)!.turnLever).toBeCloseTo(expected, 9);
  });
  it("crowding lever = persons x 75 kg x arm / displacement, outboard first on the assembly deck", () => {
    const d = demoDesign();
    d.people.passengers = 40; // 10 m2 at 4 per m2, all in the outboard half of the assembly stations (arm 4 m)
    const ctx = ctxOf(d);
    const h = passengerHeel(ctx)!;
    expect(h.crowdLever).toBeCloseTo((40 * 0.075 * 4) / ctx.condition!.weights.total.massT, 6);
  });
  it("a fast, high ship heels too much in a turn", () => {
    const d = demoDesign();
    d.hull.designSpeedKn = 60;
    d.loading.deadweight = { massT: 500, lcg: 58, kg: 14 };
    const r = rule(d, "INTACT-STABILITY");
    expect(r.findings.some((f) => /turning/.test(f.message) && f.status !== "green")).toBe(true);
  });
});

describe("survival craft height and corridors to stairs", () => {
  it("a lifeboat on Deck 1 is below the waterline", () => {
    const d = demoDesign();
    d.lsa.find((l) => l.id === "lb1")!.deckId = "D1";
    const f = rule(d, "LSA-CAPACITY").findings.find((x) => /waterline/.test(x.message))!;
    expect(f.status).toBe("red");
    expect(f.message).toMatch(/below the waterline/);
    expect(f.ref?.clause).toMatch(/III\/13/);
  });
  it("a corridor narrower than the stair it serves is amber (REG13 G5.1)", () => {
    const d = demoDesign();
    d.spaces.find((s) => s.id === "stairA")!.stair!.widthMm = 2500; // corridors on Decks 2 to 5 are 2.0 m wide
    const f = rule(d, "ESCAPE-STAIR-WIDTH").findings.find((x) => /corridors leading to Stair A are 2.00 m wide, narrower than the 2500 mm stair/.test(x.message))!;
    expect(f.status).toBe("amber");
    expect(f.ref?.clause).toMatch(/G5\.1/);
  });
});

describe("basic plausibility", () => {
  it("the demo ferry and its default arrangement are plausible", () => {
    expect(rule(demoDesign(), "DESIGN-SANITY").status).toBe("green");
  });
  it("flags impossible inputs", () => {
    const d = demoDesign();
    d.spaces.find((s) => s.id === "fuel1")!.persons = 3; // people in a tank
    d.spaces.find((s) => s.id === "D3-cabP24")!.persons = 60; // 60 persons in 16 m2
    d.bulkheads.push({ id: "wtX", kind: "watertight", x: -4, rating: "A-0" }); // outside the hull
    d.doors.push({ id: "wide", deckId: "D3", x: 26, y: 1, widthMm: 6000 }); // 6 m door in a 4 m wall
    d.doors.push({ id: "slim", deckId: "D3", x: 30, y: 1, widthMm: 450 });
    const msgs = rule(d, "DESIGN-SANITY").findings.map((f) => `${f.status}: ${f.message}`);
    expect(msgs).toContain("red: Fuel oil tank has persons placed inside.");
    expect(msgs.some((m) => /^red: D3 cabin P24 holds 60 persons on 16.0 m2: 3.8 persons\/m2/.test(m))).toBe(true);
    expect(msgs.some((m) => /^red: A watertight bulkhead lies outside the hull/.test(m))).toBe(true);
    expect(msgs.some((m) => /^red: An emergency door of 6000 mm sits in a wall only 4.0 m long/.test(m))).toBe(true);
    expect(msgs.some((m) => /^amber: 1 emergency door is narrower than 600 mm/.test(m))).toBe(true);
  });
  it("decks too close to stand up between, and a bulkhead deck under water, are red", () => {
    const d = demoDesign();
    d.decks.find((k) => k.id === "D6")!.z = 16.5; // 1.5 m above Deck 5, which has rooms
    d.bulkheadDeckId = "D1"; // 2 m above the keel, draft about 5.2 m
    const r = rule(d, "DESIGN-SANITY");
    const f1 = r.findings.find((f) => /headroom/.test(f.message))!;
    expect(f1.message).toMatch(/^Deck 5 has only 1.50 m/);
    expect(f1.ref?.clause).toMatch(/MLC/);
    expect(r.findings.find((f) => /bulkhead deck/.test(f.message))!.status).toBe("red");
  });
});
