// Large-angle intact stability (GZ curve) by direct integration of heeled hull sections.
// Section shapes come from the vessel.js offset table (hull.getStation), so the geometry is the
// same one vessel.js uses for upright hydrostatics. The hull is treated as watertight up to the
// moulded depth (deck edge immersion is therefore captured). Fixed trim, no free surface.
import type { Ship } from "../vendor/vessel/vessel.module.js";

type P = [number, number]; // (y, z)

function stationPolygon(ship: Ship, x: number, zTop: number): P[] {
  const hull = ship.structure.hull;
  const D = hull.attributes.Depth;
  const hb = hull.getStation(x);
  const wls = hull.halfBreadths.waterlines.map((w) => w * D);
  const prof: [number, number][] = []; // (z, halfBreadth)
  for (let j = 0; j < wls.length; j++) {
    const v = hb[j];
    if (v === null || Number.isNaN(v as number)) continue;
    if (wls[j] <= zTop + 1e-9) {
      prof.push([wls[j], Math.max(0, v as number)]);
    } else {
      const last = prof[prof.length - 1];
      if (last && last[0] < zTop) {
        const mu = (zTop - last[0]) / (wls[j] - last[0]);
        prof.push([zTop, last[1] + mu * ((v as number) - last[1])]);
      }
      break;
    }
  }
  if (prof.length < 2) return [];
  const lastP = prof[prof.length - 1];
  if (lastP[0] < zTop - 1e-6) prof.push([zTop, lastP[1]]);
  const poly: P[] = prof.map(([z, y]) => [-y, z]);
  for (let k = prof.length - 1; k >= 0; k--) poly.push([prof[k][1], prof[k][0]]);
  return poly;
}

/** Keep the part of the polygon where u.p <= h (Sutherland-Hodgman, single half-plane). */
function clip(poly: P[], uy: number, uz: number, h: number): P[] {
  const out: P[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const sa = uy * a[0] + uz * a[1] - h;
    const sb = uy * b[0] + uz * b[1] - h;
    if (sa <= 0) out.push(a);
    if ((sa <= 0) !== (sb <= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

function areaCentroid(poly: P[]): { A: number; y: number; z: number } {
  let A = 0,
    cy = 0,
    cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [y0, z0] = poly[i];
    const [y1, z1] = poly[(i + 1) % n];
    const c = y0 * z1 - y1 * z0;
    A += c;
    cy += (y0 + y1) * c;
    cz += (z0 + z1) * c;
  }
  A *= 0.5;
  if (Math.abs(A) < 1e-12) return { A: 0, y: 0, z: 0 };
  return { A: Math.abs(A), y: cy / (6 * A), z: cz / (6 * A) };
}

export class SectionModel {
  xs: number[];
  polys: P[][];
  constructor(ship: Ship, zTop: number, samples = 80) {
    const hull = ship.structure.hull;
    const LOA = hull.attributes.LOA;
    const set = new Set<number>();
    for (let i = 0; i <= samples; i++) set.add(+((LOA * i) / samples).toFixed(6));
    for (const s of hull.halfBreadths.stations) set.add(+(s * LOA).toFixed(6));
    this.xs = [...set].sort((a, b) => a - b);
    this.polys = this.xs.map((x) => stationPolygon(ship, x, zTop));
  }

  /** Submerged volume and centre of buoyancy for heel phi (rad, starboard down) and plane level h. */
  integrate(phi: number, h: number) {
    const uy = Math.sin(phi),
      uz = Math.cos(phi);
    let V = 0,
      My = 0,
      Mz = 0,
      Mx = 0;
    let prev: { A: number; y: number; z: number; x: number } | null = null;
    for (let i = 0; i < this.xs.length; i++) {
      const p = this.polys[i];
      const s = p.length ? areaCentroid(clip(p, uy, uz, h)) : { A: 0, y: 0, z: 0 };
      const cur = { ...s, x: this.xs[i] };
      if (prev) {
        const dx = cur.x - prev.x;
        V += 0.5 * (prev.A + cur.A) * dx;
        My += 0.5 * (prev.A * prev.y + cur.A * cur.y) * dx;
        Mz += 0.5 * (prev.A * prev.z + cur.A * cur.z) * dx;
        Mx += 0.5 * (prev.A * prev.x + cur.A * cur.x) * dx;
      }
      prev = cur;
    }
    return { V, yB: V ? My / V : 0, zB: V ? Mz / V : 0, xB: V ? Mx / V : 0 };
  }

  /** Find plane level h so the submerged volume equals V0. */
  solve(phi: number, V0: number) {
    const uy = Math.sin(phi),
      uz = Math.cos(phi);
    let lo = Infinity,
      hi = -Infinity;
    for (const p of this.polys)
      for (const [y, z] of p) {
        const s = uy * y + uz * z;
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    if (this.integrate(phi, hi).V < V0) return null; // cannot float at this heel (hull too small)
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.integrate(phi, mid).V < V0) lo = mid;
      else hi = mid;
      if (hi - lo < 1e-5) break;
    }
    const h = 0.5 * (lo + hi);
    return { h, ...this.integrate(phi, h) };
  }
}

export interface GZPoint {
  deg: number;
  gz: number;
}

export interface GZResult {
  points: GZPoint[];
  maxGZ: number;
  angleMaxGZ: number;
  rangeDeg: number; // angle of vanishing stability (or last computed angle)
  area0_30: number; // m.rad
  area0_40: number;
  area30_40: number;
  deckEdgeDeg: number; // approx angle of deck edge immersion (upright freeboard / half breadth)
}

export function gzCurve(ship: Ship, opts: { V0: number; KG: number; TCG: number; T: number; depth: number; BWL: number; maxDeg?: number; stepDeg?: number }): GZResult {
  const model = new SectionModel(ship, opts.depth);
  const maxDeg = opts.maxDeg ?? 80;
  const step = opts.stepDeg ?? 2.5;
  const points: GZPoint[] = [];
  for (let d = 0; d <= maxDeg + 1e-9; d += step) {
    const phi = (d * Math.PI) / 180;
    const r = model.solve(phi, opts.V0);
    if (!r) break;
    const gz = (opts.TCG - r.yB) * Math.cos(phi) - (opts.KG - r.zB) * Math.sin(phi);
    points.push({ deg: d, gz });
  }
  return summarise(points, opts);
}

function summarise(points: GZPoint[], opts: { T: number; depth: number; BWL: number }): GZResult {
  let maxGZ = -Infinity,
    angleMaxGZ = 0,
    rangeDeg = points.length ? points[points.length - 1].deg : 0;
  for (const p of points) if (p.gz > maxGZ) ((maxGZ = p.gz), (angleMaxGZ = p.deg));
  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].gz > 0 && points[i].gz <= 0) {
      const a = points[i - 1],
        b = points[i];
      rangeDeg = a.deg + ((b.deg - a.deg) * a.gz) / (a.gz - b.gz);
      break;
    }
  }
  const area = (from: number, to: number) => {
    let s = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const lo = Math.max(a.deg, from),
        hi = Math.min(b.deg, to);
      if (hi <= lo) continue;
      const g = (d: number) => a.gz + ((b.gz - a.gz) * (d - a.deg)) / (b.deg - a.deg);
      s += 0.5 * (g(lo) + g(hi)) * ((hi - lo) * Math.PI) / 180;
    }
    return s;
  };
  return {
    points,
    maxGZ: Number.isFinite(maxGZ) ? maxGZ : 0,
    angleMaxGZ,
    rangeDeg,
    area0_30: area(0, 30),
    area0_40: area(0, 40),
    area30_40: area(30, 40),
    deckEdgeDeg: (Math.atan(Math.max(0, opts.depth - opts.T) / (0.5 * opts.BWL)) * 180) / Math.PI,
  };
}

export function gzAt(r: GZResult, deg: number): number {
  const p = r.points;
  for (let i = 1; i < p.length; i++) {
    if (p[i].deg >= deg) {
      const a = p[i - 1],
        b = p[i];
      return a.gz + ((b.gz - a.gz) * (deg - a.deg)) / (b.deg - a.deg);
    }
  }
  return p.length ? p[p.length - 1].gz : 0;
}
