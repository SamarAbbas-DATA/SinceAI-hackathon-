// Verifies the physics against closed-form results for a rectangular box barge.
// If vessel.js hydrostatics, our GZ integration or the flooding method were wrong, these would fail.
import { describe, it, expect } from "vitest";
import { blankDesign } from "../src/data/demoDesign";
import { createShip, hydroAt, RHO, computeCondition, grownCondition } from "../src/engine/vessel";
import { gzCurve, gzAt } from "../src/engine/stability";
import { floodAnalysis, lostVolume, requiredR } from "../src/engine/flooding";
import type { Design } from "../src/engine/types";

const L = 100,
  B = 20,
  D = 10;

function boxDesign(): Design {
  const d = blankDesign();
  d.hull = { template: "box", LOA: L, BOA: B, depth: D, designDraft: 5, designSpeedKn: 10, parsonsK: 0.03 };
  d.decks = [{ id: "main", name: "Main deck", z: D }];
  d.bulkheadDeckId = "main";
  return d;
}

describe("box barge hydrostatics (vessel.js)", () => {
  const ship = createShip(boxDesign());
  const T = 5;
  const h = hydroAt(ship, T);
  it("volume, centre of buoyancy and waterplane", () => {
    expect(h.Vs).toBeCloseTo(L * B * T, 3);
    expect(h.KB).toBeCloseTo(T / 2, 4);
    expect(h.LCB).toBeCloseTo(L / 2, 4);
    expect(h.Awp).toBeCloseTo(L * B, 3);
    expect(h.LCF).toBeCloseTo(L / 2, 4);
  });
  it("metacentric radii BMt = B^2/12T and BMl = L^2/12T", () => {
    expect(h.BMt).toBeCloseTo((B * B) / (12 * T), 4);
    expect(h.BMl).toBeCloseTo((L * L) / (12 * T), 3);
  });
  it("form coefficients are 1 for a box", () => {
    expect(h.Cb).toBeCloseTo(1, 5);
    expect(h.Cwp).toBeCloseTo(1, 5);
  });
  it("draft solver returns the draft for a given mass", () => {
    const M = RHO * L * B * 4.2;
    expect(ship.structure.hull.calculateDraftAtMass(M, 1e-5, RHO)).toBeCloseTo(4.2, 3);
  });
});

describe("V-section prism (vessel.js prismaticHull.json) hydrostatics", () => {
  const d = boxDesign();
  d.hull.template = "wedge";
  const ship = createShip(d);
  const T = 5;
  const h = hydroAt(ship, T);
  const b = (B * T) / D; // waterline breadth
  it("volume L*B*T^2/(2D) and KB = 2T/3", () => {
    expect(h.Vs).toBeCloseTo((L * B * T * T) / (2 * D), 3);
    expect(h.KB).toBeCloseTo((2 * T) / 3, 4);
  });
  it("BMt = (L b^3/12) / V", () => {
    expect(h.BMt).toBeCloseTo((L * b ** 3) / 12 / ((L * B * T * T) / (2 * D)), 4);
  });
});

describe("GZ curve by section integration", () => {
  const ship = createShip(boxDesign());
  const T = 5,
    KG = 6;
  const V0 = L * B * T;
  const BM = (B * B) / (12 * T);
  const GM = T / 2 + BM - KG;
  const gz = gzCurve(ship, { V0, KG, TCG: 0, T, depth: D, BWL: B, maxDeg: 60, stepDeg: 2.5 });
  const wallSided = (deg: number) => {
    const p = (deg * Math.PI) / 180;
    return Math.sin(p) * (GM + 0.5 * BM * Math.tan(p) ** 2);
  };
  it("is zero upright", () => expect(gz.points[0].gz).toBeCloseTo(0, 6));
  it("matches the wall-sided formula before deck edge immersion (26.6 deg)", () => {
    for (const deg of [5, 10, 15, 20, 25]) expect(gzAt(gz, deg)).toBeCloseTo(wallSided(deg), 3);
  });
  it("initial slope tends to GM", () => {
    const slope = gzAt(gz, 2.5) / ((2.5 * Math.PI) / 180);
    expect(Math.abs(slope - GM) / GM).toBeLessThan(0.005); // 2.5 deg still carries the small tan^2 term
  });
  it("reports the deck edge immersion angle", () => expect(gz.deckEdgeDeg).toBeCloseTo((Math.atan(5 / 10) * 180) / Math.PI, 3));
});

describe("flooding by lost buoyancy", () => {
  it("lost volume of a slice equals l*B*z", () => {
    const ship = createShip(boxDesign());
    const lv = lostVolume(ship, 40, 60, 5);
    expect(lv.V).toBeCloseTo(20 * B * 5, 2);
    expect(lv.zc).toBeCloseTo(2.5, 3);
    expect(lv.Awp).toBeCloseTo(20 * B, 3);
  });

  it("central compartment: sinkage and damaged GM match hand calculation", () => {
    const d = boxDesign();
    d.bulkheads = [
      { id: "a", kind: "watertight", x: 45, rating: "A-0" },
      { id: "b", kind: "watertight", x: 55, rating: "A-0" },
    ];
    const ship = createShip(d);
    const T = 5,
      KG = 6,
      mu = 0.95,
      l = 10;
    const massT = (RHO * L * B * T) / 1000;
    const res = floodAnalysis(d, ship, { T, KG, LCG: 50, massT }, { permeability: { accommodation: mu }, heelLimitDeg: 12, N: 100, mix: { single: 0.5, pair: 0.5 } });
    const mid = res.cases.find((c) => c.compartments.join() === "C2")!;
    const Td = (T * L) / (L - mu * l);
    expect(mid.draft!).toBeCloseTo(Td, 3);
    // damaged GM: KB at new draft (lost slice also centred at Td/2), BM from the remaining waterplane
    const V0 = L * B * T;
    const BMd = ((B ** 3) * (L - mu * l)) / 12 / V0;
    expect(mid.GMd!).toBeCloseTo(Td / 2 + BMd - KG, 3);
    expect(mid.survives).toBe(true);
    // symmetric damage: no trim
    expect(mid.draftAft!).toBeCloseTo(mid.draftFwd!, 3);
  });

  it("end compartment damage trims the ship towards the damage", () => {
    const d = boxDesign();
    d.bulkheads = [
      { id: "a", kind: "watertight", x: 15, rating: "A-0" },
      { id: "b", kind: "watertight", x: 50, rating: "A-0" },
    ];
    const ship = createShip(d);
    const massT = (RHO * L * B * 5) / 1000;
    const res = floodAnalysis(d, ship, { T: 5, KG: 6, LCG: 50, massT }, { permeability: { accommodation: 0.95 }, heelLimitDeg: 12, N: 100, mix: { single: 0.5, pair: 0.5 } });
    const aft = res.cases.find((c) => c.compartments.join() === "C1")!;
    expect(aft.draftAft!).toBeGreaterThan(aft.draftFwd!);
  });

  it("required index R follows the SOLAS formula ranges", () => {
    expect(requiredR(300)).toBeCloseTo(0.722, 6);
    expect(requiredR(1000)).toBeCloseTo(1000 / 7580 + 0.66923, 6);
    expect(requiredR(3000)).toBeCloseTo(0.0369 * Math.log(3089.048) + 0.579, 6);
  });
});

describe("loading condition", () => {
  it("lightship override plus deadweight gives the expected draft and GM on a box", () => {
    const d = boxDesign();
    d.loading.lightshipOverride = { massT: (RHO * L * B * 4) / 1000 - 500, lcg: 50, kg: 5 };
    d.loading.deadweight = { massT: 500, lcg: 50, kg: 5 };
    const ship = createShip(d);
    const c = computeCondition(d, ship);
    expect(c.T).toBeCloseTo(4, 3);
    expect(c.GMt).toBeCloseTo(2 + (B * B) / (12 * 4) - 5, 3);
    expect(Math.abs(c.trimByStern)).toBeLessThan(1e-3);
  });

  it("weight margin: a box sinks dW / (rho L B) and KG moves to the weighted mean", () => {
    // Box at T = 4 m, KG 5 m (lightship KG 6 m). Add dW = 410 t at the lightship KG.
    const d = boxDesign();
    d.loading.lightshipOverride = { massT: (RHO * L * B * 4) / 1000 - 500, lcg: 50, kg: 6 };
    d.loading.deadweight = { massT: 500, lcg: 50, kg: 1 };
    const ship = createShip(d);
    const c = computeCondition(d, ship);
    const M = c.weights.total.massT;
    const dW = 410;
    const g = grownCondition(ship, c, dW);
    const T2 = 4 + (dW * 1000) / (RHO * L * B); // 4.2 m
    expect(g.T).toBeCloseTo(T2, 3);
    expect(g.sinkage).toBeCloseTo(T2 - 4, 3);
    expect(g.freeboard).toBeCloseTo(D - T2, 3);
    const KG2 = (M * c.KG + dW * 6) / (M + dW);
    expect(g.KG).toBeCloseTo(KG2, 6);
    expect(g.GMt).toBeCloseTo(T2 / 2 + (B * B) / (12 * T2) - KG2, 3);
    expect(grownCondition(ship, c, 0).GMt).toBeCloseTo(c.GMt, 6);
  });
});
