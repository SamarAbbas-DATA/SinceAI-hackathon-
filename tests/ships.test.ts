// Model ships (Icon class and Mein Schiff 7): published main data, clean checks, fast enough for live use.
import { describe, it, expect } from "vitest";
import { MODELS } from "../src/data/ships";
import { analyze } from "../src/engine/analyze";

const PUBLISHED: Record<string, { LOA: number; BOA: number; T: number; decks: number; pax: number; crew: number }> = {
  icon: { LOA: 364.75, BOA: 48.47, T: 9.25, decks: 20, pax: 7600, crew: 2350 },
  star: { LOA: 364.75, BOA: 48.47, T: 9.25, decks: 20, pax: 7600, crew: 2350 },
  legend: { LOA: 364.75, BOA: 48.47, T: 9.25, decks: 20, pax: 7600, crew: 2350 },
  ms7: { LOA: 315.7, BOA: 35.8, T: 8.2, decks: 16, pax: 2894, crew: 1000 },
};

describe.each(MODELS.filter((m) => m.id !== "demo"))("model ship $label", (m) => {
  const d = m.make();
  const a = analyze(d, { withCurves: false });
  const p = PUBLISHED[m.id];
  it("uses the published main data and floats at the published draught", () => {
    expect(d.hull.LOA).toBe(p.LOA);
    expect(d.hull.BOA).toBe(p.BOA);
    expect(d.decks.length).toBe(p.decks);
    expect(d.people.passengers).toBe(p.pax);
    expect(d.people.crew).toBe(p.crew);
    expect(a.condition!.T).toBeCloseTo(p.T, 1);
    expect(Math.abs(a.condition!.trimByStern)).toBeLessThan(0.1);
  });
  it("has no calculation errors and no geometry problems", () => {
    expect(a.errors).toEqual([]);
    expect(a.geometry.map((g) => g.message)).toEqual([]);
  });
  it("has no red flags except the fire zone width of the 48.47 m Icon class (rule limit 40 m)", () => {
    const red = a.rules.filter((r) => r.status === "red").map((r) => r.ruleId);
    expect(red).toEqual(p.BOA > 40 ? ["FIRE-ZONE-SIZE"] : []);
    for (const id of ["FIRE-WALL-RATING", "ESCAPE-TWO-EXITS", "ESCAPE-STAIR-WIDTH", "FLOOD-SURVIVAL", "INTACT-STABILITY", "LSA-CAPACITY", "WEIGHT-MARGIN", "REFERENCE-SHIPS", "PIPE-FIRE-MAIN", "PIPE-WATERTIGHT", "PIPE-FUEL-HOT", "CABLE-ROUTING"])
      expect(a.rules.find((r) => r.ruleId === id)!.status, id).toBe("green");
    const fz = a.rules.find((r) => r.ruleId === "FIRE-ZONE-SIZE")!;
    expect(fz.findings.every((f) => /wide/.test(f.message))).toBe(true); // lengths are all within the limit
  });
  it("evacuates everyone within the limit (queues at stairs are amber hints only)", () => {
    const ev = a.rules.find((r) => r.ruleId === "EVACUATION-TIME")!;
    expect(a.evac!.unreachable).toEqual([]);
    expect(a.evac!.total).toBeLessThan(0.9 * a.evac!.limit);
    expect(ev.findings.every((f) => f.status === "amber" && /Queue at Stair/.test(f.message))).toBe(true);
  });
  it("analyses fast enough for live editing", () => {
    expect(a.ms).toBeLessThan(2500);
  });
});
