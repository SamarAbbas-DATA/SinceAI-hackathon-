/**
 * Hydrostatics of any closed triangle mesh, exact for the mesh (no sections, no approximations).
 *
 * Divergence theorem with the field F = (0, 0, f) on the part of the hull below the plane z = h:
 * the waterplane cap has z - h = 0, so the submerged volume and its moments are integrals over the
 * wetted hull triangles only, which are clipped at the waterline. Waterplane properties come from the
 * same triangles (flux of a z-independent field through a closed surface is zero).
 *
 * Units: mm and grams. Water density in g/mm^3.
 */
import { bbox, type Mesh } from "./mesh";

export const RHO_FRESH = 0.001; // g/mm^3
export const RHO_SEA = 0.001025;

export interface Cut {
  V: number;
  B: [number, number, number]; // centre of buoyancy (rotated frame)
  Awp: number; // waterplane area
  F: [number, number]; // centre of flotation x, y
  IT: number; // waterplane inertia about the longitudinal axis through F
  IL: number; // about the transverse axis through F
}

/** Rotate vertices: trim (about y, bow down positive) first, then heel (about x, starboard down positive). */
export function rotated(pos: Float32Array, heelDeg: number, trimDeg: number): Float64Array {
  const ph = (heelDeg * Math.PI) / 180,
    th = (trimDeg * Math.PI) / 180;
  const cp = Math.cos(ph), sp = Math.sin(ph), ct = Math.cos(th), st = Math.sin(th);
  const out = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const x1 = x * ct + z * st;
    const z1 = -x * st + z * ct;
    out[i] = x1;
    out[i + 1] = y * cp - z1 * sp;
    out[i + 2] = y * sp + z1 * cp;
  }
  return out;
}

export function rotatePoint(p: [number, number, number], heelDeg: number, trimDeg: number): [number, number, number] {
  const r = rotated(new Float32Array(p), heelDeg, trimDeg);
  return [r[0], r[1], r[2]];
}

/** Integrals of the part of the (already rotated) mesh below z = h. */
export function cut(P: Float64Array, idx: Uint32Array, h: number): Cut {
  let V = 0, Mx = 0, My = 0, Mu = 0;
  let A = 0, Ax = 0, Ay = 0, Axx = 0, Ayy = 0;
  const X = [0, 0, 0, 0], Y = [0, 0, 0, 0], U = [0, 0, 0, 0];

  const tri = (x1: number, y1: number, u1: number, x2: number, y2: number, u2: number, x3: number, y3: number, u3: number) => {
    const axy = 0.5 * ((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1));
    if (axy === 0) return;
    const su = u1 + u2 + u3, sx = x1 + x2 + x3, sy = y1 + y2 + y3;
    V += (axy * su) / 3;
    Mx += (axy / 12) * (x1 * u1 + x2 * u2 + x3 * u3 + sx * su);
    My += (axy / 12) * (y1 * u1 + y2 * u2 + y3 * u3 + sy * su);
    Mu += (axy / 24) * (u1 * u1 + u2 * u2 + u3 * u3 + su * su);
    A -= axy;
    Ax -= (axy * sx) / 3;
    Ay -= (axy * sy) / 3;
    Axx -= (axy / 12) * (x1 * x1 + x2 * x2 + x3 * x3 + sx * sx);
    Ayy -= (axy / 12) * (y1 * y1 + y2 * y2 + y3 * y3 + sy * sy);
  };

  for (let i = 0; i < idx.length; i += 3) {
    let nIn = 0;
    for (let k = 0; k < 3; k++) {
      const o = idx[i + k] * 3;
      X[k] = P[o];
      Y[k] = P[o + 1];
      U[k] = P[o + 2] - h;
      if (U[k] <= 0) nIn++;
    }
    if (nIn === 0) continue;
    if (nIn === 3) {
      tri(X[0], Y[0], U[0], X[1], Y[1], U[1], X[2], Y[2], U[2]);
      continue;
    }
    // rotate so the odd vertex is first (keeps winding)
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const inK = U[k] <= 0;
      const inA = U[(k + 1) % 3] <= 0, inB = U[(k + 2) % 3] <= 0;
      if (inK !== inA && inA === inB) s = k;
    }
    const a = s, b = (s + 1) % 3, c = (s + 2) % 3;
    const lerp = (p: number, q: number) => {
      const t = U[p] / (U[p] - U[q]);
      return [X[p] + t * (X[q] - X[p]), Y[p] + t * (Y[q] - Y[p])];
    };
    const [abx, aby] = lerp(a, b);
    const [acx, acy] = lerp(a, c);
    if (nIn === 1) tri(X[a], Y[a], U[a], abx, aby, 0, acx, acy, 0);
    else {
      tri(abx, aby, 0, X[b], Y[b], U[b], X[c], Y[c], U[c]);
      tri(abx, aby, 0, X[c], Y[c], U[c], acx, acy, 0);
    }
  }
  const fx = A > 0 ? Ax / A : 0,
    fy = A > 0 ? Ay / A : 0;
  return {
    V,
    B: V > 0 ? [Mx / V, My / V, h + Mu / V] : [0, 0, h],
    Awp: A,
    F: [fx, fy],
    IT: Ayy - A * fy * fy,
    IL: Axx - A * fx * fx,
  };
}

/** Waterline height giving the target volume (Newton on dV/dh = Awp, guarded by bisection). */
export function solveDraft(P: Float64Array, idx: Uint32Array, Vt: number, hGuess?: number): { h: number; c: Cut } {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < P.length; i += 3) {
    if (P[i] < lo) lo = P[i];
    if (P[i] > hi) hi = P[i];
  }
  let h = hGuess !== undefined && hGuess > lo && hGuess < hi ? hGuess : (lo + hi) / 2;
  let c = cut(P, idx, h);
  for (let it = 0; it < 60; it++) {
    const err = c.V - Vt;
    if (Math.abs(err) <= 1e-9 * Math.max(Vt, 1)) break;
    if (err > 0) hi = h;
    else lo = h;
    let next = c.Awp > 1e-12 ? h - err / c.Awp : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - h) < 1e-9) break;
    h = next;
    c = cut(P, idx, h);
  }
  return { h, c };
}

export interface Condition {
  mass: number; // g
  G: [number, number, number]; // centre of gravity, design frame, mm
  rho: number; // g/mm^3
}

export interface Equilibrium {
  sinks: boolean;
  trim: number; // deg, bow down positive
  h: number; // waterline height in the trimmed frame
  Tm: number; // draft at mid length, from the keel line z = 0
  Ta: number; // draft at x = xmin
  Tf: number; // draft at x = xmax
  c: Cut;
  KB: number; // centre of buoyancy height above the keel line (design frame)
  BM: number;
  GM: number;
  GML: number;
  V: number;
  Vtotal: number;
  reserve: number; // reserve buoyancy share 0..1
}

/** Free-floating upright condition: solve draft and trim so that buoyancy equals weight and B is under G. */
export function equilibrium(m: Mesh, cond: Condition, vTotal?: number): Equilibrium {
  const Vt = cond.mass / cond.rho;
  const box = bbox(m);
  const Vtot = vTotal ?? cut(rotated(m.pos, 0, 0), m.idx, box.max[2] + 1).V;
  const xL = box.min[0], xF = box.max[0];
  const sinks = Vt >= Vtot * 0.999;
  const f = (trim: number, hg?: number) => {
    const P = rotated(m.pos, 0, trim);
    const s = solveDraft(P, m.idx, Math.min(Vt, Vtot * 0.999), hg);
    const Gr = rotatePoint(cond.G, 0, trim);
    return { ...s, gap: s.c.B[0] - Gr[0] };
  };
  // secant on trim so that B is vertically under G
  let t0 = 0,
    r0 = f(t0);
  let t1 = 0.5,
    r1 = f(t1, r0.h);
  for (let it = 0; it < 30 && Math.abs(r1.gap) > 1e-6 * (xF - xL); it++) {
    const d = r1.gap - r0.gap;
    let t2 = Math.abs(d) > 1e-15 ? t1 - (r1.gap * (t1 - t0)) / d : t1 + 0.5;
    t2 = Math.max(-30, Math.min(30, t2));
    t0 = t1;
    r0 = r1;
    t1 = t2;
    r1 = f(t1, r0.h);
  }
  const trim = t1,
    { h, c } = r1;
  const th = (trim * Math.PI) / 180;
  const T = (x: number) => (h + x * Math.sin(th)) / Math.cos(th);
  // KB in the design frame: rotate B back by -trim
  const KB = -c.B[0] * Math.sin(-th) + c.B[2] * Math.cos(-th);
  const BM = c.V > 0 ? c.IT / c.V : 0;
  const BML = c.V > 0 ? c.IL / c.V : 0;
  const zG = cond.G[2];
  return {
    sinks,
    trim,
    h,
    Tm: T((xL + xF) / 2),
    Ta: T(xL),
    Tf: T(xF),
    c,
    KB,
    BM,
    GM: KB + BM - zG,
    GML: KB + BML - zG,
    V: c.V,
    Vtotal: Vtot,
    reserve: Vtot > 0 ? 1 - c.V / Vtot : 0,
  };
}

export interface GzPoint {
  heel: number;
  gz: number; // mm, positive = righting
  h: number;
  deckWet: boolean; // deck edge under water
}

/** Righting lever curve at fixed trim. GZ = y_G - y_B in the heeled frame. */
export function gzCurve(m: Mesh, cond: Condition, trim: number, angles: number[]): GzPoint[] {
  const Vt = cond.mass / cond.rho;
  const box = bbox(m);
  const zTop = box.max[2] - (box.max[2] - box.min[2]) * 0.005;
  const deck: number[] = [];
  for (let i = 0; i < m.pos.length; i += 3) if (m.pos[i + 2] >= zTop) deck.push(i);
  let hg: number | undefined;
  return angles.map((heel) => {
    const P = rotated(m.pos, heel, trim);
    const { h, c } = solveDraft(P, m.idx, Vt, hg);
    hg = h;
    const G = rotatePoint(cond.G, heel, trim);
    let deckWet = false;
    for (const i of deck)
      if (P[i + 2] < h) {
        deckWet = true;
        break;
      }
    return { heel, gz: G[1] - c.B[1], h, deckWet };
  });
}

/** Area under the GZ curve between two angles (trapezoid), mm*rad. */
export function gzArea(curve: GzPoint[], from: number, to: number): number {
  let a = 0;
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i - 1], q = curve[i];
    const lo = Math.max(p.heel, from), hi = Math.min(q.heel, to);
    if (hi <= lo) continue;
    const g = (x: number) => p.gz + ((q.gz - p.gz) * (x - p.heel)) / (q.heel - p.heel);
    a += (((g(lo) + g(hi)) / 2) * (hi - lo) * Math.PI) / 180;
  }
  return a;
}

/** Interpolated GZ at an angle. */
export function gzAt(curve: GzPoint[], deg: number): number {
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i - 1], q = curve[i];
    if (deg >= p.heel && deg <= q.heel) return p.gz + ((q.gz - p.gz) * (deg - p.heel)) / (q.heel - p.heel);
  }
  return curve[curve.length - 1]?.gz ?? 0;
}

/** First angle after the peak where GZ falls to zero (angle of vanishing stability), or the last angle computed. */
export function vanishingAngle(curve: GzPoint[]): number {
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i - 1], q = curve[i];
    if (p.gz > 0 && q.gz <= 0) return p.heel + ((q.heel - p.heel) * p.gz) / (p.gz - q.gz);
  }
  return curve[0] && curve[0].gz < 0 ? 0 : (curve[curve.length - 1]?.heel ?? 0);
}

export function deckEdgeAngle(curve: GzPoint[]): number | null {
  const p = curve.find((c) => c.deckWet && c.heel > 0);
  return p ? p.heel : null;
}
