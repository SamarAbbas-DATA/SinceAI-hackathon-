/**
 * Parametric hull. The ship is described at full scale (metres) and built at model scale (millimetres).
 * Frame: x forward from the transom, y to port, z up from the keel. The deck is flat at z = D, so the
 * model can be printed deck-down with no supports.
 *
 * The same section function feeds the triangle mesh (STL, 3MF, OBJ, GLB, hydrostatics) and the
 * B-spline loft in the CAD kernel (STEP), so all exports describe the same shape.
 */
import { flip, massProps, type Mesh } from "./mesh";

export interface HullParams {
  L: number; // length, m
  B: number; // beam, m
  D: number; // depth keel to deck, m
  modelL: number; // printed length, mm
  midbody: number; // fraction of length with full beam
  midPos: number; // centre of the full-beam part, fraction of L from the transom
  bowFull: number; // waterline fullness of the bow (1 = straight wedge, 3 = blunt)
  sternFull: number; // same for the run aft
  transom: number; // transom width / beam
  bilge: number; // section squareness (2 = round, 10 = boxy)
  deadrise: number; // 0 = flat bottom, 0.6 = deep V
  bowRise: number; // keel rise at the bow, fraction of D (cut-up forefoot)
  sternRise: number; // keel rise at the transom, fraction of D
}

export const DEFAULT_HULL: HullParams = {
  L: 120,
  B: 20,
  D: 10,
  modelL: 280,
  midbody: 0.3,
  midPos: 0.45,
  bowFull: 1.8,
  sternFull: 2.4,
  transom: 0.72,
  bilge: 5,
  deadrise: 0.12,
  bowRise: 0.4,
  sternRise: 0.25,
};

export interface ParamSpec {
  key: keyof HullParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  group: "ship" | "form" | "model";
  help: string;
}

export const PARAMS: ParamSpec[] = [
  { key: "L", label: "Length", min: 10, max: 400, step: 1, unit: "m", group: "ship", help: "Overall length of the full-size ship." },
  { key: "B", label: "Beam", min: 2, max: 70, step: 0.5, unit: "m", group: "ship", help: "Maximum width." },
  { key: "D", label: "Depth", min: 1, max: 40, step: 0.5, unit: "m", group: "ship", help: "Keel to the (flat) deck." },
  { key: "midbody", label: "Parallel midbody", min: 0, max: 0.6, step: 0.01, unit: "", group: "form", help: "Share of the length at full beam." },
  { key: "midPos", label: "Midbody position", min: 0.3, max: 0.6, step: 0.01, unit: "", group: "form", help: "Where the full-beam part sits, from the transom." },
  { key: "bowFull", label: "Bow fullness", min: 1, max: 3.5, step: 0.05, unit: "", group: "form", help: "1 = fine wedge bow, 3.5 = blunt bow." },
  { key: "sternFull", label: "Stern fullness", min: 1, max: 4, step: 0.05, unit: "", group: "form", help: "Fullness of the run towards the transom." },
  { key: "transom", label: "Transom width", min: 0.1, max: 1, step: 0.01, unit: "", group: "form", help: "Transom width as a share of the beam." },
  { key: "bilge", label: "Section squareness", min: 2, max: 10, step: 0.1, unit: "", group: "form", help: "2 = round bilge, 10 = box section." },
  { key: "deadrise", label: "Deadrise", min: 0, max: 0.6, step: 0.01, unit: "", group: "form", help: "0 = flat bottom, higher = V bottom." },
  { key: "bowRise", label: "Forefoot rise", min: 0, max: 0.8, step: 0.01, unit: "", group: "form", help: "How far the keel rises towards the bow." },
  { key: "sternRise", label: "Stern rise", min: 0, max: 0.7, step: 0.01, unit: "", group: "form", help: "How far the keel rises towards the transom." },
  { key: "modelL", label: "Printed length", min: 60, max: 600, step: 1, unit: "mm", group: "model", help: "Length of the printed model. Sets the scale." },
];

/** Smallest half-breadth at the bow tip, mm. A knife edge does not print and breaks the CAD loft. */
export const STEM_HALF_MM = 0.6;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function sanitize(p: HullParams): HullParams {
  const q = { ...p };
  for (const s of PARAMS) {
    const v = Number(q[s.key]);
    q[s.key] = Number.isFinite(v) ? clamp(v, s.min, s.max) : DEFAULT_HULL[s.key];
  }
  return q;
}

/** mm of model per metre of ship */
export const scaleK = (p: HullParams) => p.modelL / p.L;
/** scale ratio 1 : lambda */
export const lambda = (p: HullParams) => (1000 * p.L) / p.modelL;

function regions(p: HullParams) {
  const half = p.midbody / 2;
  const m0 = clamp(p.midPos - half, 0.05, 0.9);
  const m1 = clamp(p.midPos + half, m0, 0.95);
  return { m0, m1 };
}

/** Waterline half-breadth factor 0..1 along the length (xi = x / L). */
export function planW(p: HullParams, xi: number): number {
  const { m0, m1 } = regions(p);
  const k = scaleK(p);
  const wmin = Math.min(0.3, STEM_HALF_MM / ((p.B * k) / 2));
  let w: number;
  if (xi >= m1) {
    const t = clamp((xi - m1) / (1 - m1), 0, 1);
    w = 1 - Math.pow(t, p.bowFull);
  } else if (xi <= m0) {
    const t = clamp((m0 - xi) / m0, 0, 1);
    w = 1 - (1 - p.transom) * Math.pow(t, p.sternFull);
  } else w = 1;
  return Math.max(wmin, w);
}

/** Keel height as a fraction of D. */
export function keelRise(p: HullParams, xi: number): number {
  const { m0, m1 } = regions(p);
  let r = 0;
  if (xi > m1) r = p.bowRise * Math.pow((xi - m1) / (1 - m1), 2.2);
  else if (xi < m0) r = p.sternRise * Math.pow((m0 - xi) / m0, 2);
  return Math.min(r, 0.85);
}

/** Half section at xi, from the keel (y = 0) up to the deck edge, in model mm. s = u^2 clusters points at the bilge. */
export function halfSection(p: HullParams, xi: number, n: number): { y: number[]; z: number[] } {
  const k = scaleK(p);
  const b = (p.B * k * planW(p, xi)) / 2;
  const D = p.D * k;
  const z0 = keelRise(p, xi) * D;
  const y: number[] = [],
    z: number[] = [];
  const ne = p.bilge;
  for (let j = 0; j <= n; j++) {
    const u = j / n;
    const s = u * u;
    const sup = Math.pow(1 - Math.pow(1 - s, ne), 1 / ne);
    y.push(b * ((1 - p.deadrise) * sup + p.deadrise * s));
    z.push(z0 + (D - z0) * s);
  }
  // A keel point at y = 0 makes zero-width quads only at j = 0 (shared vertex), which is fine.
  return { y, z };
}

/** Cosine spacing: dense at the transom and at the bow where the shape changes fastest. */
export function stations(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
}

/** Closed, outward-facing, watertight hull solid (deck included). */
export function hullMesh(pIn: HullParams, nx = 64, nu = 24): Mesh {
  const p = sanitize(pIn);
  const L = p.modelL;
  const xs = stations(nx);
  const R = 2 * nu + 1; // ring: keel, port 1..nu, starboard nu..1
  const nV = nx * R + 2;
  const pos = new Float32Array(nV * 3);
  const centres: number[] = [];
  for (let i = 0; i < nx; i++) {
    const { y, z } = halfSection(p, xs[i], nu);
    const x = xs[i] * L;
    const put = (k: number, yy: number, zz: number) => {
      const o = (i * R + k) * 3;
      pos[o] = x;
      pos[o + 1] = yy;
      pos[o + 2] = zz;
    };
    put(0, 0, z[0]);
    for (let j = 1; j <= nu; j++) put(j, y[j], z[j]);
    for (let j = nu; j >= 1; j--) put(2 * nu + 1 - j, -y[j], z[j]);
    centres.push((z[0] + z[nu]) / 2);
  }
  const cA = nx * R,
    cF = nx * R + 1;
  pos.set([0, 0, centres[0]], cA * 3);
  pos.set([L, 0, centres[nx - 1]], cF * 3);

  const idx: number[] = [];
  const V = (i: number, k: number) => i * R + (((k % R) + R) % R);
  for (let i = 0; i < nx - 1; i++)
    for (let k = 0; k < R; k++) {
      const a = V(i, k), b = V(i, k + 1), c = V(i + 1, k + 1), d = V(i + 1, k);
      idx.push(a, b, c, a, c, d);
    }
  for (let k = 0; k < R; k++) {
    idx.push(cA, V(0, k + 1), V(0, k));
    idx.push(cF, V(nx - 1, k), V(nx - 1, k + 1));
  }
  const m: Mesh = { pos, idx: new Uint32Array(idx) };
  return massProps(m).volume < 0 ? flip(m) : m;
}

/** Section outlines for the CAD loft: closed polylines (y, z) per station, port side first. */
export function loftSections(pIn: HullParams, nSections = 25, nu = 10) {
  const p = sanitize(pIn);
  return stations(nSections).map((xi) => {
    const { y, z } = halfSection(p, xi, nu);
    return { x: xi * p.modelL, y, z };
  });
}
