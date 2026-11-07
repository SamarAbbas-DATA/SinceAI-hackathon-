// Major pipes and cables (runs): geometry used by the rules, the 3D view and the report.
// A run point lies at the deckhead (ceiling) of its deck. Pure TS, no UI.
import type { Design, Run, RunKind, RunPoint, Space, TransverseBulkhead } from "./types";
import { isCable } from "./types";
import { sortedDecks, deckHeight, spaceDeckIds } from "./vessel";

/** Names and typical sizes (outside diameter in mm) of the run types. */
export const RUN_INFO: Record<RunKind, { label: string; short: string; sizeMm: number; what: string }> = {
  fire_main: { label: "Fire main", short: "fire main", sizeMm: 200, what: "Sea water under pressure to the fire hydrants and sprinklers, painted red." },
  bilge_ballast: { label: "Bilge and ballast main", short: "bilge main", sizeMm: 300, what: "Pumps sea water into and out of the ballast tanks and drains water from the bilges." },
  fuel_oil: { label: "Fuel oil line", short: "fuel line", sizeMm: 100, what: "Fuel from the storage tanks to the engines, under pressure." },
  exhaust: { label: "Exhaust uptake", short: "exhaust", sizeMm: 900, what: "Hot engine exhaust gas up to the funnel and the scrubbers." },
  hv_cable: { label: "HV power cable", short: "HV cable", sizeMm: 120, what: "6.6 to 11 kV cables from the main generators to the main switchboard and the propulsion motors." },
  feeder_cable: { label: "Switchboard feeder cable", short: "feeder cable", sizeMm: 80, what: "Power from the main switchboard to the distribution panels on each deck." },
};

/** Gap between a run's centreline and the deck above (runs hang under the deckhead). */
export const DECKHEAD_GAP = 0.06;

export function runZ(design: Design, deckId: string): number | null {
  return deckInfo(design).zHead.get(deckId) ?? null;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}
export interface RunSeg {
  i: number; // index of the first point
  a: P3;
  b: P3;
  vertical: boolean;
  deckIds: string[]; // decks the segment runs through (one for a horizontal segment)
  deckId: string; // deck of the first point
}

// per-design lookups (decks in height order, rooms per deck), cached on the arrays they come from
const deckCache = new WeakMap<Design["decks"], { sorted: Design["decks"]; idx: Map<string, number>; zHead: Map<string, number> }>();
function deckInfo(design: Design) {
  let c = deckCache.get(design.decks);
  if (!c) {
    const sorted = sortedDecks(design);
    c = { sorted, idx: new Map(sorted.map((d, i) => [d.id, i])), zHead: new Map(sorted.map((d) => [d.id, d.z + deckHeight(design, d.id) - DECKHEAD_GAP])) };
    deckCache.set(design.decks, c);
  }
  return c;
}
const roomCache = new WeakMap<Space[], { decks: Design["decks"]; byDeck: Map<string, Space[]> }>();
/** Spaces present on a deck (multi-deck spaces such as stairwells appear on every deck they span). */
export function spacesOnDeckCached(design: Design, deckId: string): Space[] {
  let c = roomCache.get(design.spaces);
  if (!c || c.decks !== design.decks) {
    const byDeck = new Map<string, Space[]>();
    for (const s of design.spaces) for (const id of spaceDeckIds(design, s)) byDeck.set(id, [...(byDeck.get(id) ?? []), s]);
    c = { decks: design.decks, byDeck };
    roomCache.set(design.spaces, c);
  }
  return c.byDeck.get(deckId) ?? [];
}

/** Segments of a run with their 3D end points and the decks they pass through. */
export function runSegments(design: Design, run: Run): RunSeg[] {
  const { sorted: decks, idx, zHead } = deckInfo(design);
  const out: RunSeg[] = [];
  for (let i = 0; i < run.points.length - 1; i++) {
    const p = run.points[i],
      q = run.points[i + 1];
    const za = zHead.get(p.deckId),
      zb = zHead.get(q.deckId);
    if (za === undefined || zb === undefined) continue;
    const ia = idx.get(p.deckId)!,
      ib = idx.get(q.deckId)!;
    const deckIds = decks.slice(Math.min(ia, ib), Math.max(ia, ib) + 1).map((d) => d.id);
    out.push({ i, a: { x: p.x, y: p.y, z: za }, b: { x: q.x, y: q.y, z: zb }, vertical: p.deckId !== q.deckId, deckIds, deckId: p.deckId });
  }
  return out;
}

export function runLength(design: Design, run: Run): number {
  return runSegments(design, run).reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y, g.b.z - g.a.z), 0);
}

export const runRadius = (r: Run) => r.sizeMm / 2000;

/** Part [t0, t1] of segment a-b (2D) inside the rectangle shrunk by `inset`, or null (Liang-Barsky clip). */
export function clipToRect(ax: number, ay: number, bx: number, by: number, r: { x0: number; x1: number; y0: number; y1: number }, inset = 0.05): [number, number] | null {
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dy = by - ay;
  const edges: [number, number][] = [
    [-dx, ax - (r.x0 + inset)],
    [dx, r.x1 - inset - ax],
    [-dy, ay - (r.y0 + inset)],
    [dy, r.y1 - inset - ay],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

const rect = (s: Space) => ({ x0: s.xCentre - s.length / 2, x1: s.xCentre + s.length / 2, y0: s.yCentre - s.breadth / 2, y1: s.yCentre + s.breadth / 2 });
export const inRect = (s: Space, x: number, y: number, inset = 0.05) => {
  const r = rect(s);
  return x > r.x0 + inset && x < r.x1 - inset && y > r.y0 + inset && y < r.y1 - inset;
};

export interface Crossing {
  space: Space;
  length: number; // metres of the run inside the space
  at: RunPoint; // middle of the part inside
}

/** Spaces a run passes through, with the length inside each (vertical risers count their height). */
export function spacesCrossed(design: Design, run: Run): Crossing[] {
  const hit = new Map<string, Crossing>();
  for (const g of runSegments(design, run)) {
    for (const deckId of g.deckIds) {
      for (const s of spacesOnDeckCached(design, deckId)) {
        let len = 0,
          mx = 0,
          my = 0;
        if (g.vertical) {
          if (!inRect(s, g.a.x, g.a.y)) continue;
          len = deckHeight(design, deckId);
          mx = g.a.x;
          my = g.a.y;
        } else {
          const c = clipToRect(g.a.x, g.a.y, g.b.x, g.b.y, rect(s));
          if (!c) continue;
          len = (c[1] - c[0]) * Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
          if (len < 0.05) continue;
          const t = (c[0] + c[1]) / 2;
          mx = g.a.x + (g.b.x - g.a.x) * t;
          my = g.a.y + (g.b.y - g.a.y) * t;
        }
        const prev = hit.get(s.id);
        if (prev) prev.length += len;
        else hit.set(s.id, { space: s, length: len, at: { x: mx, y: my, deckId } });
      }
    }
  }
  return [...hit.values()];
}

export interface BulkheadCrossing {
  bulkhead: TransverseBulkhead;
  at: RunPoint;
}

/** Watertight bulkheads crossed by horizontal segments on decks below the bulkhead deck. */
export function watertightCrossings(design: Design, run: Run): BulkheadCrossing[] {
  const bhd = design.decks.find((d) => d.id === design.bulkheadDeckId)?.z ?? design.hull.depth;
  const out: BulkheadCrossing[] = [];
  for (const g of runSegments(design, run)) {
    if (g.vertical) continue;
    const deck = design.decks.find((d) => d.id === g.deckId);
    if (!deck || deck.z >= bhd - 1e-6) continue;
    for (const b of design.bulkheads) {
      if (b.kind !== "watertight") continue;
      if ((g.a.x - b.x) * (g.b.x - b.x) >= 0) continue; // ends on the bulkhead or does not reach it
      const t = (b.x - g.a.x) / (g.b.x - g.a.x);
      out.push({ bulkhead: b, at: { x: b.x, y: g.a.y + (g.b.y - g.a.y) * t, deckId: g.deckId } });
    }
  }
  return out;
}

/** Closest distance between two 3D segments, and the point on the first one. */
export function segDistance(p1: P3, q1: P3, p2: P3, q2: P3): { d: number; at: P3 } {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y, z: q1.z - p1.z };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y, z: q2.z - p2.z };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
  const dot = (u: P3, v: P3) => u.x * v.x + u.y * v.y + u.z * v.z;
  const a = dot(d1, d1),
    e = dot(d2, d2),
    f = dot(d2, r);
  let s = 0,
    t = 0;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  return { d: Math.hypot(c1.x - c2.x, c1.y - c2.y, c1.z - c2.z), at: c1 };
}

/** Clear gap between the outside surfaces of two runs (negative = they touch or overlap), and where it is smallest. */
export function runClearance(design: Design, A: Run, B: Run): { gap: number; at: RunPoint } | null {
  let best: { gap: number; at: RunPoint } | null = null;
  const segB = runSegments(design, B);
  for (const ga of runSegments(design, A))
    for (const gb of segB) {
      const r = segDistance(ga.a, ga.b, gb.a, gb.b);
      const gap = r.d - runRadius(A) - runRadius(B);
      if (!best || gap < best.gap) best = { gap, at: { x: r.at.x, y: r.at.y, deckId: nearestDeck(design, r.at.z) } };
    }
  return best;
}

function nearestDeck(design: Design, z: number): string {
  // a point at height z belongs to the deck whose deckhead band contains it
  const decks = sortedDecks(design);
  let id = decks[0]?.id ?? "";
  for (const d of decks) if (d.z <= z + 1e-6) id = d.id;
  return id;
}

/** Groups of runs that touch each other (within `tol` metres between centrelines). */
export function connectedGroups(design: Design, runs: Run[], tol: number): Run[][] {
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const segs = runs.map((r) => runSegments(design, r));
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      if (find(i) === find(j)) continue;
      let near = false;
      for (const a of segs[i]) {
        for (const b of segs[j])
          if (segDistance(a.a, a.b, b.a, b.b).d <= tol) {
            near = true;
            break;
          }
        if (near) break;
      }
      if (near) parent[find(i)] = find(j);
    }
  const groups = new Map<number, Run[]>();
  runs.forEach((r, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), r]));
  return [...groups.values()];
}

/** Engine rooms in which a run starts or ends (on any deck the end point's x, y lies inside). */
export function terminalEngineRooms(design: Design, run: Run): Set<string> {
  const out = new Set<string>();
  const ends = [run.points[0], run.points[run.points.length - 1]].filter(Boolean);
  for (const p of ends) for (const s of spacesOnDeckCached(design, p.deckId)) if (s.type === "engine_room" && inRect(s, p.x, p.y, -0.05)) out.add(s.id);
  // engine rooms stacked directly above or below a terminal one are the same machinery space
  for (const s of design.spaces)
    if (s.type === "engine_room" && !out.has(s.id) && [...out].some((id) => {
      const t = design.spaces.find((q) => q.id === id)!;
      return Math.abs(t.xCentre - s.xCentre) < 0.5 && Math.abs(t.yCentre - s.yCentre) < 0.5;
    }))
      out.add(s.id);
  return out;
}

export const runsOf = (design: Design, pred: (r: Run) => boolean) => (design.runs ?? []).filter((r) => r.points.length >= 2 && pred(r));
export const cables = (design: Design) => runsOf(design, (r) => isCable(r.kind));
