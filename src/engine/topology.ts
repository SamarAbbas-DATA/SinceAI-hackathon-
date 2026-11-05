// Spatial topology of the arrangement: which spaces touch, which doors connect what,
// and a routing graph for escape analysis.
import type { Design, Space, Door, SpaceType } from "./types";
import { spaceDeckIds, sortedDecks } from "./vessel";

export const TOL = 0.05; // m, touching tolerance
export const DOOR_TOL = 0.25; // m, a door must lie this close to a space boundary

export const CIRCULATION: SpaceType[] = ["corridor", "public", "muster_station"];
/** Spaces that may form a "group of spaces" with the corridor they open onto (Reg 13 2.1). */
export const GROUPABLE: SpaceType[] = ["cabin", "store", "other", "galley"];

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export function rectOf(s: Space): Rect {
  return {
    x0: s.xCentre - s.length / 2,
    x1: s.xCentre + s.length / 2,
    y0: s.yCentre - s.breadth / 2,
    y1: s.yCentre + s.breadth / 2,
  };
}

export function spacesOnDeck(design: Design, deckId: string): Space[] {
  return design.spaces.filter((s) => spaceDeckIds(design, s).includes(deckId));
}

export interface SharedEdge {
  a: string;
  b: string;
  deckId: string;
  // segment
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  length: number;
}

export function sharedEdges(design: Design): SharedEdge[] {
  const out: SharedEdge[] = [];
  const seen = new Set<string>();
  for (const deck of design.decks) {
    const sp = spacesOnDeck(design, deck.id);
    for (let i = 0; i < sp.length; i++)
      for (let j = i + 1; j < sp.length; j++) {
        const a = rectOf(sp[i]),
          b = rectOf(sp[j]);
        const key = `${sp[i].id}|${sp[j].id}|${deck.id}`;
        let e: Omit<SharedEdge, "a" | "b" | "deckId" | "length"> | null = null;
        const yo0 = Math.max(a.y0, b.y0),
          yo1 = Math.min(a.y1, b.y1);
        const xo0 = Math.max(a.x0, b.x0),
          xo1 = Math.min(a.x1, b.x1);
        if (yo1 - yo0 > TOL) {
          if (Math.abs(a.x1 - b.x0) < TOL) e = { x0: a.x1, x1: a.x1, y0: yo0, y1: yo1 };
          else if (Math.abs(b.x1 - a.x0) < TOL) e = { x0: a.x0, x1: a.x0, y0: yo0, y1: yo1 };
        }
        if (!e && xo1 - xo0 > TOL) {
          if (Math.abs(a.y1 - b.y0) < TOL) e = { x0: xo0, x1: xo1, y0: a.y1, y1: a.y1 };
          else if (Math.abs(b.y1 - a.y0) < TOL) e = { x0: xo0, x1: xo1, y0: a.y0, y1: a.y0 };
        }
        if (e && !seen.has(key)) {
          seen.add(key);
          out.push({ a: sp[i].id, b: sp[j].id, deckId: deck.id, ...e, length: Math.hypot(e.x1 - e.x0, e.y1 - e.y0) });
        }
      }
  }
  return out;
}

export function overlaps(design: Design): { a: string; b: string; deckId: string; area: number }[] {
  const out: { a: string; b: string; deckId: string; area: number }[] = [];
  for (const deck of design.decks) {
    const sp = spacesOnDeck(design, deck.id);
    for (let i = 0; i < sp.length; i++)
      for (let j = i + 1; j < sp.length; j++) {
        const a = rectOf(sp[i]),
          b = rectOf(sp[j]);
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (w > TOL && h > TOL) out.push({ a: sp[i].id, b: sp[j].id, deckId: deck.id, area: w * h });
      }
  }
  return out;
}

/** Spaces that would overlap `s` (same deck area, more than touching). */
export function overlapsWith(design: Design, s: Space): Space[] {
  const decks = new Set(spaceDeckIds(design, s));
  const a = rectOf(s);
  return design.spaces.filter((o) => {
    if (o.id === s.id) return false;
    if (!spaceDeckIds(design, o).some((d) => decks.has(d))) return false;
    const b = rectOf(o);
    return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > TOL && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > TOL;
  });
}

function onBoundary(r: Rect, x: number, y: number, tol = DOOR_TOL): boolean {
  const inY = y >= r.y0 - tol && y <= r.y1 + tol;
  const inX = x >= r.x0 - tol && x <= r.x1 + tol;
  return (inY && (Math.abs(x - r.x0) < tol || Math.abs(x - r.x1) < tol)) || (inX && (Math.abs(y - r.y0) < tol || Math.abs(y - r.y1) < tol));
}

export const OUTSIDE = "__outside__";

export interface Connection {
  id: string; // door id, or "open:<a>|<b>" for open circulation connections
  a: string;
  b: string; // space id or OUTSIDE
  deckId: string;
  x: number;
  y: number;
  widthMm: number;
  virtual: boolean;
}

export interface DoorIssue {
  door: Door;
  problem: string;
}

export function connections(design: Design): { conns: Connection[]; doorIssues: DoorIssue[] } {
  const conns: Connection[] = [];
  const doorIssues: DoorIssue[] = [];
  for (const d of design.doors) {
    const hits = spacesOnDeck(design, d.deckId).filter((s) => onBoundary(rectOf(s), d.x, d.y));
    if (hits.length === 2) conns.push({ id: d.id, a: hits[0].id, b: hits[1].id, deckId: d.deckId, x: d.x, y: d.y, widthMm: d.widthMm, virtual: false });
    else if (hits.length === 1) {
      conns.push({ id: d.id, a: hits[0].id, b: OUTSIDE, deckId: d.deckId, x: d.x, y: d.y, widthMm: d.widthMm, virtual: false });
      doorIssues.push({ door: d, problem: "Door has a space on one side only; it does not count as an escape" });
    }
    else if (hits.length === 0) doorIssues.push({ door: d, problem: "Door is not on the wall of any space" });
    else doorIssues.push({ door: d, problem: `Door touches ${hits.length} spaces; place it on a wall between exactly two` });
  }
  // Open connections between circulation spaces that share a wall of at least 0.8 m
  const byId = new Map(design.spaces.map((s) => [s.id, s]));
  for (const e of sharedEdges(design)) {
    const A = byId.get(e.a)!,
      B = byId.get(e.b)!;
    if (CIRCULATION.includes(A.type) && CIRCULATION.includes(B.type) && e.length >= 0.8) {
      conns.push({
        id: `open:${e.a}|${e.b}|${e.deckId}`,
        a: e.a,
        b: e.b,
        deckId: e.deckId,
        x: (e.x0 + e.x1) / 2,
        y: (e.y0 + e.y1) / 2,
        widthMm: Math.round(e.length * 1000),
        virtual: true,
      });
    }
  }
  return { conns, doorIssues };
}

// ---------------------------------------------------------------- routing graph

export interface RouteStep {
  conn: Connection;
  space: string; // space entered through this connection
}

export interface Route {
  from: string;
  steps: RouteStep[];
  length: number; // m, horizontal + inclined stair length
  cost: number; // s, at nominal speeds
}

export interface Graph {
  design: Design;
  conns: Connection[];
  bySpace: Map<string, Connection[]>;
  space: Map<string, Space>;
  deckZ: Map<string, number>;
}

export function buildGraph(design: Design): Graph {
  const { conns } = connections(design);
  const bySpace = new Map<string, Connection[]>();
  for (const c of conns) {
    for (const s of [c.a, c.b]) {
      if (!bySpace.has(s)) bySpace.set(s, []);
      bySpace.get(s)!.push(c);
    }
  }
  return {
    design,
    conns,
    bySpace,
    space: new Map(design.spaces.map((s) => [s.id, s])),
    deckZ: new Map(design.decks.map((d) => [d.id, d.z])),
  };
}

export const STAIR_SLOPE_FACTOR = Math.SQRT2; // inclined flight length per metre of rise (45 deg)

/** Distance and time to move inside a space between two points (possibly on different decks). */
export function legInside(g: Graph, spaceId: string, p: { x: number; y: number; deckId: string }, q: { x: number; y: number; deckId: string }) {
  const horiz = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
  const dz = (g.deckZ.get(q.deckId) ?? 0) - (g.deckZ.get(p.deckId) ?? 0);
  const s = g.space.get(spaceId);
  if (dz !== 0 && s?.type === "stairwell") {
    const incl = Math.abs(dz) * STAIR_SLOPE_FACTOR;
    return { length: horiz + incl, stairLength: incl, up: dz > 0, time: horiz / 1.2 + incl / (dz > 0 ? 0.8 : 1.0) };
  }
  if (dz !== 0) return null; // only stairwells connect decks for escape (lifts are excluded)
  return { length: horiz, stairLength: 0, up: false, time: horiz / 1.2 };
}

/** Dijkstra from the centre of a space to the nearest space for which isTarget() is true. */
export function shortestRoute(g: Graph, fromId: string, isTarget: (s: Space) => boolean, blocked: (s: Space) => boolean = (s) => s.type === "lift"): Route | null {
  const from = g.space.get(fromId);
  if (!from) return null;
  type Node = { key: string; conn: Connection; space: string; cost: number; length: number; prev: Node | null };
  const origin = { x: from.xCentre, y: from.yCentre, deckId: from.deckId };
  const best = new Map<string, number>();
  const open: Node[] = [];
  for (const c of g.bySpace.get(fromId) ?? []) {
    const leg = legInside(g, fromId, origin, c);
    if (!leg) continue;
    const other = c.a === fromId ? c.b : c.a;
    open.push({ key: `${c.id}>${other}`, conn: c, space: other, cost: leg.time, length: leg.length, prev: null });
  }
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const n = open.shift()!;
    if ((best.get(n.key) ?? Infinity) <= n.cost) continue;
    best.set(n.key, n.cost);
    if (n.space === OUTSIDE) continue;
    const sp = g.space.get(n.space);
    if (!sp || blocked(sp)) continue;
    if (isTarget(sp)) {
      const steps: RouteStep[] = [];
      for (let k: Node | null = n; k; k = k.prev) steps.unshift({ conn: k.conn, space: k.space });
      return { from: fromId, steps, length: n.length, cost: n.cost };
    }
    for (const c of g.bySpace.get(n.space) ?? []) {
      if (c.id === n.conn.id) continue;
      const leg = legInside(g, n.space, n.conn, c);
      if (!leg) continue;
      const other = c.a === n.space ? c.b : c.a;
      const key = `${c.id}>${other}`;
      const cost = n.cost + leg.time;
      if ((best.get(key) ?? Infinity) <= cost) continue;
      open.push({ key, conn: c, space: other, cost, length: n.length + leg.length, prev: n });
    }
  }
  return null;
}

// ---------------------------------------------------------------- disjoint routes (max-flow)

export interface DisjointResult {
  count: number;
  firstConns: Connection[]; // first connection used by each disjoint route
  reachesStair: boolean;
}

/**
 * Number of escape routes from `fromId` to target spaces that share no intermediate space and no door.
 * Node-splitting max-flow (Edmonds-Karp); every intermediate space and every connection has capacity 1.
 */
export function disjointRoutes(g: Graph, fromId: string, isTarget: (s: Space) => boolean): DisjointResult {
  type E = { to: number; cap: number; rev: number; conn?: Connection };
  const adj: E[][] = [];
  const id = new Map<string, number>();
  const node = (k: string) => {
    if (!id.has(k)) {
      id.set(k, adj.length);
      adj.push([]);
    }
    return id.get(k)!;
  };
  const add = (u: number, v: number, cap: number, conn?: Connection) => {
    adj[u].push({ to: v, cap, rev: adj[v].length, conn });
    adj[v].push({ to: u, cap: 0, rev: adj[u].length - 1, conn });
  };
  const SRC = node("SRC"),
    SNK = node("SNK");
  const BIG = 1e6;
  for (const s of g.design.spaces) {
    if (s.type === "lift") continue;
    const i = node(`${s.id}:in`),
      o = node(`${s.id}:out`);
    add(i, o, s.id === fromId ? BIG : 1);
    if (s.id !== fromId && isTarget(s)) add(o, SNK, 1);
  }
  add(SRC, node(`${fromId}:in`), BIG);
  for (const c of g.conns) {
    if (c.b === OUTSIDE) continue;
    const A = g.space.get(c.a),
      B = g.space.get(c.b);
    if (!A || !B || A.type === "lift" || B.type === "lift") continue;
    // each connection usable once in either direction: model as a connection node with capacity 1
    const cn = node(`conn:${c.id}`),
      cn2 = node(`conn2:${c.id}`);
    add(cn, cn2, 1, c);
    add(node(`${c.a}:out`), cn, 1);
    add(node(`${c.b}:out`), cn, 1);
    add(cn2, node(`${c.a}:in`), 1);
    add(cn2, node(`${c.b}:in`), 1);
  }
  let flow = 0;
  for (;;) {
    const prev: ({ u: number; e: number } | null)[] = new Array(adj.length).fill(null);
    const q = [SRC];
    const seen = new Set([SRC]);
    while (q.length && !seen.has(SNK)) {
      const u = q.shift()!;
      adj[u].forEach((e, ei) => {
        if (e.cap > 0 && !seen.has(e.to)) {
          seen.add(e.to);
          prev[e.to] = { u, e: ei };
          q.push(e.to);
        }
      });
    }
    if (!seen.has(SNK)) break;
    for (let v = SNK; v !== SRC; ) {
      const p = prev[v]!;
      const e = adj[p.u][p.e];
      e.cap -= 1;
      adj[v][e.rev].cap += 1;
      v = p.u;
    }
    flow++;
    if (flow >= 4) break;
  }
  // first connections used: flow leaving fromId:out into a connection node
  const firstConns: Connection[] = [];
  const out = id.get(`${fromId}:out`);
  if (out !== undefined) {
    // an original space->connection edge (cap 1) with residual 0 carries one route
    for (const e of adj[out]) {
      const k = [...id.entries()].find(([, v]) => v === e.to)?.[0] ?? "";
      if (k.startsWith("conn:") && e.cap === 0) {
        const c = g.conns.find((c) => `conn:${c.id}` === k);
        if (c) firstConns.push(c);
      }
    }
  }
  let reachesStair = false;
  const snkIn = adj[SNK];
  for (const e of snkIn) {
    const back = adj[e.to][e.rev];
    if (back.cap === 0) {
      const k = [...id.entries()].find(([, v]) => v === e.to)?.[0] ?? "";
      const sid = k.replace(/:out$/, "");
      if (g.space.get(sid)?.type === "stairwell") reachesStair = true;
    }
  }
  return { count: flow, firstConns, reachesStair };
}

export function deckIndex(design: Design, deckId: string): number {
  return sortedDecks(design).findIndex((d) => d.id === deckId);
}
