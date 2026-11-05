// Simplified evacuation analysis following IMO MSC.1/Circ.1533, Annex 2 and its Appendix 1.
// Hydraulic model: corridors are pipes, doors are valves, stairways carry the merged flow.
import type { Design, Space } from "./types";
import { buildGraph, shortestRoute, legInside, type Graph, type Route } from "./topology";

// Table 1.1: initial specific flow and speed vs. initial density (corridors)
const T11 = { D: [0, 0.5, 1.9, 3.2, 3.5], Fs: [0, 0.65, 1.3, 0.65, 0.32], S: [1.2, 1.2, 0.67, 0.2, 0.1] };
// Table 1.2: maximum specific flow
export const FS_MAX = { stairDown: 1.1, stairUp: 0.88, corridor: 1.3, door: 1.3 };
// Table 1.3: speed vs specific flow
const T13 = {
  stairDown: { Fs: [0, 0.54, 1.1], S: [1.0, 1.0, 0.55] },
  stairUp: { Fs: [0, 0.43, 0.88], S: [0.8, 0.8, 0.44] },
  corridor: { Fs: [0, 0.65, 1.3], S: [1.2, 1.2, 0.67] },
};

function interp(xs: number[], ys: number[], x: number) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}

export interface EvacRoute {
  deckId: string;
  stairId: string | null; // null = reaches the assembly station without stairs
  musterId: string;
  persons: number;
  spaces: string[]; // origin spaces
  corridorIds: string[];
  density: number;
  FcDeck: number; // p/s
  tF: number; // s
  tDeck: number;
  tStair: number;
  tAssembly: number;
  tI: number;
}

export interface StairLoad {
  stairId: string;
  persons: number;
  FcIn: number;
  FcOut: number;
  FsOut: number;
  queue: boolean;
  up: boolean;
}

export interface Congestion {
  kind: "stair" | "density";
  where: string[];
  reason: string;
  stairId?: string;
  FcIn?: number;
  FcOut?: number;
  density?: number;
}

export interface EvacResult {
  ok: boolean; // false if the analysis could not run
  reason?: string;
  unreachable: string[]; // occupied spaces with no route to an assembly station
  routes: EvacRoute[];
  stairs: StairLoad[];
  congestion: Congestion[];
  tI: number; // s, highest ideal travel duration
  gamma: number;
  delta: number;
  T: number; // s, travel duration
  R: number; // s, response duration
  EL: number; // s, embarkation + launching
  total: number; // s, 1.25(R+T) + 2/3(E+L)
  limit: number; // s
  mvz: number;
  persons: number;
  assignments: Map<string, Route>; // space -> route
}

export function evacuate(design: Design, opts: { mvz: number; graph?: Graph }): EvacResult {
  const g = opts.graph ?? buildGraph(design);
  const isMuster = (s: Space) => s.type === "muster_station";
  const occupied = design.spaces.filter((s) => s.persons > 0 && !["muster_station", "stairwell", "lift"].includes(s.type));
  const persons = occupied.reduce((n, s) => n + s.persons, 0);
  const base = {
    unreachable: [] as string[],
    routes: [] as EvacRoute[],
    stairs: [] as StairLoad[],
    congestion: [] as Congestion[],
    tI: 0,
    gamma: 2,
    delta: 0.3,
    T: 0,
    R: (design.evacuation.scenario === "night" ? 10 : 5) * 60,
    EL: design.evacuation.embarkLaunchMin * 60,
    total: 0,
    limit: (design.evacuation.roRo ? 60 : opts.mvz > 3 ? 80 : 60) * 60,
    mvz: opts.mvz,
    persons,
    assignments: new Map<string, Route>(),
  };
  if (!design.spaces.some(isMuster)) return { ok: false, reason: "No assembly (muster) station placed yet", ...base };
  if (!design.spaces.some((s) => s.type === "stairwell")) return { ok: false, reason: "No stairwell placed yet", ...base };
  if (persons === 0) return { ok: false, reason: "No persons assigned to spaces yet", ...base };

  // 1. Assign each occupied space to its shortest route to an assembly station.
  const groups = new Map<string, { deckId: string; stairId: string | null; musterId: string; spaces: Space[]; routes: Route[] }>();
  for (const s of occupied) {
    const r = shortestRoute(g, s.id, isMuster);
    if (!r) {
      base.unreachable.push(s.id);
      continue;
    }
    base.assignments.set(s.id, r);
    const stairStep = r.steps.find((st) => g.space.get(st.space)?.type === "stairwell");
    const stairId = stairStep ? stairStep.space : null;
    const musterId = r.steps[r.steps.length - 1].space;
    const key = `${s.deckId}|${stairId}|${musterId}`;
    if (!groups.has(key)) groups.set(key, { deckId: s.deckId, stairId, musterId, spaces: [], routes: [] });
    groups.get(key)!.spaces.push(s);
    groups.get(key)!.routes.push(r);
  }

  // 2. Per deck route: density in corridors, initial flow, deck travel.
  const routes: EvacRoute[] = [];
  for (const grp of groups.values()) {
    const N = grp.spaces.reduce((n, s) => n + s.persons, 0);
    const corridorIds = new Set<string>();
    let minDoorW = Infinity;
    for (const r of grp.routes) {
      for (const st of r.steps) {
        const sp = g.space.get(st.space);
        if (!sp) continue;
        if (sp.type === "stairwell") break;
        if (sp.type === "corridor" && st.conn.deckId === grp.deckId) corridorIds.add(sp.id);
      }
      minDoorW = Math.min(minDoorW, r.steps[0].conn.widthMm / 1000);
    }
    const corridors = [...corridorIds].map((id) => g.space.get(id)!);
    let density: number, Fs: number, S: number, Wc: number;
    if (corridors.length) {
      const area = corridors.reduce((a, c) => a + c.length * c.breadth, 0);
      density = N / area;
      Fs = interp(T11.D, T11.Fs, density);
      S = interp(T11.D, T11.S, density);
      Wc = Math.min(...corridors.map((c) => Math.min(c.length, c.breadth)));
    } else {
      // public space: everybody starts at the exit door, door maximum specific flow
      const origin = grp.spaces[0];
      density = N / Math.max(1, origin.length * origin.breadth);
      Fs = FS_MAX.door;
      S = T13.corridor.S[0];
      Wc = Number.isFinite(minDoorW) ? minDoorW : 0.8;
    }
    const FcDeck = Math.max(Fs * Wc, 1e-6);
    // tDeck: farthest horizontal length on this deck until the stair (or the assembly station)
    let farthest = 0,
      tStairMax = 0,
      tAssemblyMax = 0;
    for (const r of grp.routes) {
      const split = splitRoute(g, r);
      farthest = Math.max(farthest, split.deckLength);
      tAssemblyMax = Math.max(tAssemblyMax, split.assemblyLength / T13.corridor.S[0]);
      tStairMax = Math.max(tStairMax, split.stairLength); // converted below with stair speed
    }
    routes.push({
      deckId: grp.deckId,
      stairId: grp.stairId,
      musterId: grp.musterId,
      persons: N,
      spaces: grp.spaces.map((s) => s.id),
      corridorIds: [...corridorIds],
      density,
      FcDeck,
      tF: N / FcDeck,
      tDeck: farthest / Math.max(S, 0.1),
      tStair: tStairMax, // still a length; fixed after stair speeds are known
      tAssembly: tAssemblyMax,
      tI: 0,
    });
  }

  // 3. Stairs: merge inflows (transition rule 1.7), cap at max specific flow, queue if exceeded.
  const stairs: StairLoad[] = [];
  const stairSpeed = new Map<string, number>();
  const stairTF = new Map<string, number>();
  for (const stairId of new Set(routes.map((r) => r.stairId).filter((x): x is string => !!x))) {
    const rs = routes.filter((r) => r.stairId === stairId);
    const st = g.space.get(stairId)!;
    const W = (st.stair?.widthMm ?? 1000) / 1000;
    const N = rs.reduce((n, r) => n + r.persons, 0);
    const FcIn = rs.reduce((n, r) => n + r.FcDeck, 0);
    const musterDeck = g.space.get(rs[0].musterId)?.deckId;
    const up = (g.deckZ.get(musterDeck ?? "") ?? 0) > Math.min(...rs.map((r) => g.deckZ.get(r.deckId) ?? 0));
    const fsMax = up ? FS_MAX.stairUp : FS_MAX.stairDown;
    const tab = up ? T13.stairUp : T13.stairDown;
    let FsOut = FcIn / W;
    const queue = FsOut > fsMax;
    if (queue) FsOut = fsMax;
    const FcOut = FsOut * W;
    stairSpeed.set(stairId, interp(tab.Fs, tab.S, FsOut));
    stairTF.set(stairId, N / Math.max(FcOut, 1e-6));
    stairs.push({ stairId, persons: N, FcIn, FcOut, FsOut, queue, up });
    if (FcIn - FcOut > 1.5)
      base.congestion.push({ kind: "stair", where: [stairId], stairId, FcIn, FcOut, reason: `Inflow ${FcIn.toFixed(2)} p/s exceeds stair outflow ${FcOut.toFixed(2)} p/s by more than 1.5 p/s` });
  }
  for (const r of routes) {
    if (r.density >= 3.5) base.congestion.push({ kind: "density", where: [...r.corridorIds, ...r.spaces], density: r.density, reason: `Initial density ${r.density.toFixed(2)} p/m2 is 3.5 or more` });
    const v = r.stairId ? stairSpeed.get(r.stairId)! : 1;
    r.tStair = r.stairId ? r.tStair / v : 0;
    const tF = Math.max(r.tF, r.stairId ? stairTF.get(r.stairId)! : 0);
    r.tF = tF;
    r.tI = tF + r.tDeck + r.tStair + r.tAssembly;
  }
  const tI = routes.reduce((m, r) => Math.max(m, r.tI), 0);
  const T = (base.gamma + base.delta) * tI;
  const total = 1.25 * (base.R + T) + (2 / 3) * base.EL;
  return { ok: true, ...base, routes, stairs, tI, T, total };
}

/** Split a route into deck travel (before the first stair), stair travel and assembly travel. */
function splitRoute(g: Graph, r: Route) {
  const from = g.space.get(r.from)!;
  let pos = { x: from.xCentre, y: from.yCentre, deckId: from.deckId };
  let cur = r.from;
  let phase: "deck" | "stair" | "assembly" = "deck";
  let deckLength = 0,
    stairLength = 0,
    assemblyLength = 0;
  for (const st of r.steps) {
    const leg = legInside(g, cur, pos, st.conn);
    if (leg) {
      if (phase === "deck") deckLength += leg.length;
      else if (phase === "stair") stairLength += leg.stairLength;
      else assemblyLength += leg.length;
      if (phase === "stair") assemblyLength += leg.length - leg.stairLength;
    }
    const entered = g.space.get(st.space);
    if (entered?.type === "stairwell") phase = "stair";
    else if (phase === "stair") phase = "assembly";
    pos = st.conn;
    cur = st.space;
  }
  return { deckLength, stairLength, assemblyLength };
}
