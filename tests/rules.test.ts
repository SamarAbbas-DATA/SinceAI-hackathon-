// Rule behaviour on the demo ship and on targeted edits.
import { describe, it, expect } from "vitest";
import { demoDesign } from "../src/data/demoDesign";
import { analyze } from "../src/engine/analyze";
import type { Design } from "../src/engine/types";
import { pairKey } from "../src/engine/types";

const rule = (d: Design, id: string) => analyze(d, { withCurves: false }).rules.find((r) => r.ruleId === id)!;

describe("demo design", () => {
  const a = analyze(demoDesign());

  it("runs the full chain without errors and fast enough for live use", () => {
    expect(a.errors).toEqual([]);
    expect(a.ms).toBeLessThan(5000);
  });

  it("has no geometry problems (no overlaps, all doors on walls, all spaces inside the hull)", () => {
    expect(a.geometry.map((g) => g.message)).toEqual([]);
  });

  it("floats at a sensible draft with positive GM", () => {
    const c = a.condition!;
    expect(c.overloaded).toBe(false);
    expect(c.T).toBeGreaterThan(2);
    expect(c.T).toBeLessThan(9);
    expect(c.GMt).toBeGreaterThan(0);
  });

  it("flags the galley walls left at A-0 (needs A-30)", () => {
    const r = a.rules.find((r) => r.ruleId === "FIRE-WALL-RATING")!;
    expect(r.status).toBe("red");
    expect(r.findings.every((f) => f.targets.includes("galley"))).toBe(true);
  });

  it("flags the 850 mm stair as red (FSS Code 13.2.1.1 needs 900 mm)", () => {
    const r = a.rules.find((r) => r.ruleId === "ESCAPE-STAIR-WIDTH")!;
    expect(r.status).toBe("red");
    expect(r.findings[0].targets).toEqual(["stairC"]);
    expect(r.findings[0].detail).toMatch(/dispensation/);
  });

  it("escape routes pass: every space or group has two separate ways out", () => {
    const r = a.rules.find((r) => r.ruleId === "ESCAPE-TWO-EXITS")!;
    expect(r.findings.map((f) => f.message)).toEqual([]);
    expect(r.status).toBe("green");
  });

  it("evacuation analysis runs and gives a total below the limit", () => {
    expect(a.evac!.ok).toBe(true);
    expect(a.evac!.unreachable).toEqual([]);
    expect(a.evac!.total).toBeGreaterThan(0);
  });

  it("flooding analysis runs", () => {
    expect(a.flood!.ok).toBe(true);
    expect(a.flood!.compartments.length).toBe(9);
  });
});

describe("targeted edits change the verdicts", () => {
  it("fixing the galley walls turns FIRE-WALL-RATING green", () => {
    const d = demoDesign();
    for (const id of ["D4-cabP60", "D4-cabP72"]) d.divisions[pairKey("galley", id)] = "A-30";
    expect(rule(d, "FIRE-WALL-RATING").status).toBe("green");
  });

  it("a 700 mm stair is red", () => {
    const d = demoDesign();
    d.spaces.find((s) => s.id === "stairC")!.stair!.widthMm = 700;
    expect(rule(d, "ESCAPE-STAIR-WIDTH").status).toBe("red");
  });

  it("a stairwell too short for its flights at 45 degrees is red", () => {
    // Stair A: Deck 2 (z 6) to Deck 3 (z 9) is a 3 m climb; one flight per deck needs 3 / tan 45 = 3 m of length.
    const d = demoDesign();
    const s = d.spaces.find((x) => x.id === "stairA")!;
    s.stair!.flightsPerDeck = 1;
    s.stair!.widthMm = 1200;
    s.length = 2.5;
    const f = rule(d, "ESCAPE-STAIR-WIDTH").findings.find((x) => x.targets.includes("stairA") && /too short/.test(x.message));
    expect(f?.status).toBe("red");
    expect(f?.limit).toBe("3.00 m");
  });

  it("a clear width that does not fit across the stairwell is red", () => {
    // two flights side by side at 2.2 m each need 4.4 m, the demo stairwells are 4 m wide
    const d = demoDesign();
    d.spaces.find((x) => x.id === "stairA")!.stair!.widthMm = 2200;
    const f = rule(d, "ESCAPE-STAIR-WIDTH").findings.find((x) => x.targets.includes("stairA") && /does not fit/.test(x.message));
    expect(f?.status).toBe("red");
  });

  it("a stair that ends on a deck without a door is flagged", () => {
    const d = demoDesign();
    const s = d.spaces.find((x) => x.id === "stairA")!;
    const top = d.decks.find((x) => x.id === s.topDeckId)!;
    d.doors = d.doors.filter((x) => !(x.deckId === top.id && Math.abs(x.x - 18) < 0.5 && Math.abs(x.y - 1) < 0.5));
    const f = rule(d, "ESCAPE-STAIR-WIDTH").findings.find((x) => x.targets.includes("stairA") && /no door there/.test(x.message));
    expect(f?.status).toBe("amber");
    expect(f?.message).toContain(top.name);
  });

  it("removing the engine room's second exit gives 'only one way out'", () => {
    const d = demoDesign();
    d.doors = d.doors.filter((x) => !(x.deckId === "D1" && x.y > 0));
    const r = rule(d, "ESCAPE-TWO-EXITS");
    expect(r.status).toBe("red");
    expect(r.findings.some((f) => f.targets.includes("engine") && /one way out/.test(f.message))).toBe(true);
  });

  it("removing stair A makes the aft corridor a dead end", () => {
    const d = demoDesign();
    d.spaces = d.spaces.filter((s) => s.id !== "stairA");
    const r = rule(d, "ESCAPE-TWO-EXITS");
    expect(r.findings.some((f) => /dead end/.test(f.message))).toBe(true);
  });

  it("a space straddling a main vertical zone bulkhead is red", () => {
    const d = demoDesign();
    const cab = d.spaces.find((s) => s.id === "D3-cabP36")!;
    cab.xCentre += 2;
    expect(rule(d, "FIRE-WALL-RATING").findings.some((f) => f.targets.includes(cab.id) && /crosses/.test(f.message))).toBe(true);
  });

  it("removing the fire zone bulkheads makes the zone check grey", () => {
    const d = demoDesign();
    d.bulkheads = d.bulkheads.filter((b) => b.kind !== "fire_zone");
    expect(rule(d, "FIRE-ZONE-SIZE").status).toBe("grey");
  });

  it("evacuation is not required at 36 passengers or fewer", () => {
    const d = demoDesign();
    d.people.passengers = 30;
    expect(rule(d, "EVACUATION-TIME").status).toBe("grey");
  });
});
