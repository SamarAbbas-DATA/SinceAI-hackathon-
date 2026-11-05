// Simplified damage stability (lost-buoyancy method) for transverse watertight subdivision.
// Waterplane areas, centroids and second moments of the damaged compartments come from
// vessel.js `waterlineCalculation(z, {minX, maxX})`; intact properties from
// `calculateAttributesAtDraft`. Compartments span the full breadth, so flooding is symmetric
// (no heel unless the damaged GM becomes negative). This is an early-design estimate, not a
// SOLAS II-1 probabilistic calculation.
import type { Ship } from "../vendor/vessel/vessel.module.js";
import type { Design } from "./types";
import { RHO, clamp, boundedWaterline } from "./vessel";

export interface Compartment {
  id: string;
  xAft: number;
  xFwd: number;
  length: number;
  permeability: number;
  spaces: string[];
}

export interface DamageCase {
  compartments: string[];
  xAft: number;
  xFwd: number;
  p: number; // weight of this case
  survives: boolean;
  reason: string;
  draft: number | null; // equilibrium mean draft
  draftAft: number | null;
  draftFwd: number | null;
  GMd: number | null;
  heelDeg: number;
}

export interface FloodResult {
  ok: boolean;
  reason?: string;
  compartments: Compartment[];
  cases: DamageCase[];
  A: number;
  Asingle: number;
  Apair: number;
  R: number;
  N: number;
  bulkheadDeckZ: number;
}

export function requiredR(N: number): number {
  if (N < 400) return 0.722;
  if (N <= 1350) return N / 7580 + 0.66923;
  if (N <= 6000) return 0.0369 * Math.log(N + 89.048) + 0.579;
  return 1 - (852.5 + 0.03875 * N) / (N + 5000);
}

/** Lost buoyancy properties of the hull slice [xa, xb] below z (vessel.js waterplane integration). */
export function lostVolume(ship: Ship, xa: number, xb: number, z: number, nz = 24) {
  let V = 0,
    Mz = 0,
    Mx = 0;
  let prev: { A: number; xc: number; z: number } | null = null;
  for (let i = 0; i <= nz; i++) {
    const zi = (z * i) / nz;
    const w = boundedWaterline(ship, zi, xa, xb);
    const cur = { A: w.Awp || 0, xc: Number.isFinite(w.xc) ? w.xc : 0.5 * (xa + xb), z: zi };
    if (prev) {
      const dz = cur.z - prev.z;
      V += 0.5 * (prev.A + cur.A) * dz;
      Mz += 0.5 * (prev.A * prev.z + cur.A * cur.z) * dz;
      Mx += 0.5 * (prev.A * prev.xc + cur.A * cur.xc) * dz;
    }
    prev = cur;
  }
  const wp = boundedWaterline(ship, z, xa, xb);
  return {
    V,
    zc: V ? Mz / V : 0,
    xc: V ? Mx / V : 0.5 * (xa + xb),
    Awp: wp.Awp || 0,
    xcwp: Number.isFinite(wp.xc) ? wp.xc : 0.5 * (xa + xb),
    Ix: wp.Ix || 0,
    Iy: wp.Iy || 0,
  };
}

/** Permeability by space use (SOLAS II-1/7-3 table values; see rules.json FLOOD-SURVIVAL). */
export function compartmentPermeability(design: Design, xa: number, xb: number, bulkheadDeckZ: number, table: Record<string, number>): { mu: number; spaces: string[] } {
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  const inside = design.spaces.filter((s) => s.xCentre >= xa && s.xCentre < xb && (deckZ.get(s.deckId) ?? 0) < bulkheadDeckZ);
  let mu = table.accommodation ?? 0.95;
  if (inside.some((s) => s.type === "engine_room")) mu = table.machinery ?? 0.85;
  else if (inside.length && inside.every((s) => s.type === "store")) mu = table.stores ?? 0.6;
  return { mu, spaces: inside.map((s) => s.id) };
}

export function floodAnalysis(
  design: Design,
  ship: Ship,
  cond: { T: number; KG: number; LCG: number; massT: number },
  opts: { permeability: Record<string, number>; heelLimitDeg: number; N: number; mix: { single: number; pair: number } },
): FloodResult {
  const hull = ship.structure.hull;
  const LOA = design.hull.LOA;
  const bhd = design.decks.find((d) => d.id === design.bulkheadDeckId);
  const zB = clamp(bhd ? bhd.z : design.hull.depth, 0, design.hull.depth);
  const wt = design.bulkheads.filter((b) => b.kind === "watertight" && b.x > 0 && b.x < LOA).map((b) => b.x).sort((a, b) => a - b);
  const R = requiredR(opts.N);
  const empty = { compartments: [], cases: [], A: 0, Asingle: 0, Apair: 0, R, N: opts.N, bulkheadDeckZ: zB };
  if (wt.length < 2) return { ok: false, reason: "Place at least two watertight bulkheads", ...empty };
  if (cond.T >= zB) return { ok: false, reason: "Intact waterline is already at or above the bulkhead deck", ...empty };

  const edges = [0, ...wt, LOA];
  const compartments: Compartment[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const { mu, spaces } = compartmentPermeability(design, edges[i], edges[i + 1], zB, opts.permeability);
    compartments.push({ id: `C${i + 1}`, xAft: edges[i], xFwd: edges[i + 1], length: edges[i + 1] - edges[i], permeability: mu, spaces });
  }

  const V0 = (cond.massT * 1000) / RHO;
  const evalCase = (ids: string[], xa: number, xb: number, mu: number): Omit<DamageCase, "p"> => {
    const net = (T: number) => hull.calculateAttributesAtDraft(T).Vs - mu * lostVolume(ship, xa, xb, T).V - V0;
    const base = { compartments: ids, xAft: xa, xFwd: xb, heelDeg: 0 };
    if (net(zB) < 0) return { ...base, survives: false, reason: "Sinks below the bulkhead deck (not enough reserve buoyancy)", draft: null, draftAft: null, draftFwd: null, GMd: null };
    let lo = cond.T,
      hi = zB;
    for (let k = 0; k < 40 && hi - lo > 1e-4; k++) {
      const m = 0.5 * (lo + hi);
      if (net(m) < 0) lo = m;
      else hi = m;
    }
    const Td = 0.5 * (lo + hi);
    const I = hull.calculateAttributesAtDraft(Td);
    const L = lostVolume(ship, xa, xb, Td);
    const Vi = I.Vs,
      Vl = mu * L.V;
    const KBd = (Vi * I.KB - Vl * L.zc) / V0;
    const LCBd = (Vi * I.LCB - Vl * L.xc) / V0;
    const Ai = I.Awp,
      Al = mu * L.Awp;
    const Ar = Ai - Al;
    const xr = Ar > 0 ? (Ai * I.LCF - Al * L.xcwp) / Ar : I.LCF;
    const IyO = I.Iywp + Ai * I.LCF * I.LCF - mu * (L.Iy + L.Awp * L.xcwp * L.xcwp);
    const Iyr = IyO - Ar * xr * xr;
    const Ixr = I.Ixwp - mu * L.Ix;
    const GMd = KBd + Ixr / V0 - cond.KG;
    const GMLd = KBd + Iyr / V0 - cond.KG;
    const t = GMLd !== 0 ? (LCBd - cond.LCG) / GMLd : 0;
    const draftAft = Td + (xr - I.minXs) * t;
    const draftFwd = Td + (xr - I.maxXs) * t;
    let survives = true,
      reason = "Survives: waterline below bulkhead deck and positive GM";
    if (GMd <= 0) ((survives = false), (reason = `Capsizes: damaged GM ${GMd.toFixed(2)} m is not positive`));
    else if (Math.max(draftAft, draftFwd) >= zB) ((survives = false), (reason = `Bulkhead deck immersed at the ${draftAft > draftFwd ? "stern" : "bow"} after trim`));
    return { ...base, survives, reason, draft: Td, draftAft, draftFwd, GMd, heelDeg: GMd > 0 ? 0 : opts.heelLimitDeg + 1 };
  };

  const Ltot = LOA;
  const singles = compartments.map((c) => ({ ...evalCase([c.id], c.xAft, c.xFwd, c.permeability), p: c.length / Ltot }));
  const pairsRaw = compartments.slice(0, -1).map((c, i) => {
    const d = compartments[i + 1];
    const mu = (c.permeability * c.length + d.permeability * d.length) / (c.length + d.length);
    return { ...evalCase([c.id, d.id], c.xAft, d.xFwd, mu), w: c.length + d.length };
  });
  const wsum = pairsRaw.reduce((s, p) => s + p.w, 0) || 1;
  const pairs = pairsRaw.map(({ w, ...p }) => ({ ...p, p: w / wsum }));
  const Asingle = singles.reduce((s, c) => s + (c.survives ? c.p : 0), 0);
  const Apair = pairs.reduce((s, c) => s + (c.survives ? c.p : 0), 0);
  const A = opts.mix.single * Asingle + opts.mix.pair * Apair;
  return { ok: true, compartments, cases: [...singles, ...pairs], A, Asingle, Apair, R, N: opts.N, bulkheadDeckZ: zB };
}
