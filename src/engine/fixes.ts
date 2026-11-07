// Automatic fixes for flags. Pure TS, no UI: runs in a Web Worker for the "Fix with AI" run and in Node tests.
//
// For every flag the catalogue below proposes a few concrete repairs (typed actions). Each candidate is tried on a
// copy of the design and the whole analysis runs again; a candidate is kept only if it reduces that rule's flags,
// adds no flag anywhere else and does not lower the score. The smallest change wins. Only when several candidates
// pass and they differ in kind is an AI asked to choose (the `choose` callback); it can only pick one of the
// candidates that already passed, never invent geometry. Without AI the smallest change is used.
import type { Design, Door, Finding, FireRating, LSA, Run, RunPoint, Space, StairProps, Status, TransverseBulkhead } from "./types";
import { analyze, type Analysis } from "./analyze";
import { autoDoors, defaultRuns } from "./generators";
import { sharedEdges, type SharedEdge } from "./topology";
import { freeboardLength, ruleDef } from "./rules";
import { runZ, runSegments, runClearance, spacesCrossed } from "./systems";
import { sortedDecks } from "./vessel";

export type FixAction =
  | { kind: "space"; id: string; set: Partial<Pick<Space, "xCentre" | "yCentre" | "length" | "breadth" | "persons">>; stair?: Partial<StairProps> }
  | { kind: "division"; a: string; b: string; rating: FireRating }
  | { kind: "bulkhead"; id: string; set: Partial<Pick<TransverseBulkhead, "x" | "rating">> }
  | { kind: "addBulkhead"; bulkhead: TransverseBulkhead }
  | { kind: "addDoor"; door: Door }
  | { kind: "door"; id: string; set: Partial<Pick<Door, "x" | "y" | "widthMm">> }
  | { kind: "removeDoor"; id: string }
  | { kind: "runPoints"; id: string; points: RunPoint[] }
  | { kind: "addRun"; run: Run }
  | { kind: "addLsa"; lsa: LSA }
  | { kind: "lsa"; id: string; set: Partial<Pick<LSA, "deckId" | "x" | "y">> }
  | { kind: "deck"; id: string; z: number }
  | { kind: "people"; passengers: number };

export interface FixCandidate {
  id: string;
  label: string; // what it does, one plain sentence
  actions: FixAction[];
  focus: RunPoint; // where the camera looks
  size: number; // how big the change is (smaller is closer to the original design)
}

export interface FixStep {
  ruleId: string;
  finding: string;
  status: Status;
  chosen: FixCandidate;
  options: number; // candidates that passed the checks
  byAI?: { reason: string; model?: string };
  scoreAfter: number;
}

export interface FixSkip {
  ruleId: string;
  finding: string;
  status: Status;
  why: string;
}

export interface FixPlan {
  steps: FixStep[];
  skipped: FixSkip[];
  scoreBefore: number;
  scoreAfter: number;
  ms: number;
  aiCalls: number;
}

export interface ChooseRequest {
  rule: string;
  title: string;
  finding: string;
  options: { id: string; label: string; size: number }[];
}
export type Chooser = (req: ChooseRequest) => Promise<{ choice: string; reason: string; model?: string } | null>;

// ------------------------------------------------------------------ applying actions

export function applyActions(d: Design, actions: FixAction[]): void {
  for (const a of actions) {
    switch (a.kind) {
      case "space": {
        const s = d.spaces.find((x) => x.id === a.id);
        if (!s) break;
        Object.assign(s, a.set);
        if (a.stair && s.stair) Object.assign(s.stair, a.stair);
        break;
      }
      case "division":
        d.divisions[a.a < a.b ? `${a.a}|${a.b}` : `${a.b}|${a.a}`] = a.rating;
        break;
      case "bulkhead": {
        const b = d.bulkheads.find((x) => x.id === a.id);
        if (b) Object.assign(b, a.set);
        break;
      }
      case "addBulkhead":
        if (!d.bulkheads.some((x) => x.id === a.bulkhead.id)) d.bulkheads.push({ ...a.bulkhead });
        break;
      case "addDoor":
        if (!d.doors.some((x) => x.id === a.door.id)) d.doors.push({ ...a.door });
        break;
      case "door": {
        const x = d.doors.find((q) => q.id === a.id);
        if (x) Object.assign(x, a.set);
        break;
      }
      case "removeDoor":
        d.doors = d.doors.filter((x) => x.id !== a.id);
        break;
      case "runPoints": {
        const r = d.runs.find((x) => x.id === a.id);
        if (r) r.points = a.points.map((p) => ({ ...p }));
        break;
      }
      case "addRun":
        if (!d.runs.some((x) => x.id === a.run.id)) d.runs.push(structuredClone(a.run));
        break;
      case "addLsa":
        if (!d.lsa.some((x) => x.id === a.lsa.id)) d.lsa.push({ ...a.lsa });
        break;
      case "lsa": {
        const l = d.lsa.find((x) => x.id === a.id);
        if (l) Object.assign(l, a.set);
        break;
      }
      case "deck": {
        const k = d.decks.find((x) => x.id === a.id);
        if (k) k.z = a.z;
        break;
      }
      case "people":
        d.people.passengers = a.passengers;
        break;
    }
  }
}

// ------------------------------------------------------------------ verification

type Tally = Map<string, { red: number; amber: number }>;
function tally(a: Analysis): Tally {
  const t: Tally = new Map();
  for (const r of a.rules) t.set(r.ruleId, { red: r.findings.filter((f) => f.status === "red").length, amber: r.findings.filter((f) => f.status === "amber").length });
  t.set("__geometry", { red: a.geometry.filter((g) => g.status === "red").length, amber: a.geometry.filter((g) => g.status === "amber").length });
  return t;
}

/** A candidate is accepted when its rule improves, nothing else gets worse and the score does not drop. */
function improves(before: Analysis, tb: Tally, after: Analysis, ruleId: string): boolean {
  if (after.errors.length > before.errors.length) return false;
  const ta = tally(after);
  for (const [id, b] of tb) {
    const x = ta.get(id) ?? { red: 0, amber: 0 };
    if (id === ruleId) {
      if (x.red > b.red || x.red * 10 + x.amber >= b.red * 10 + b.amber) return false;
    } else if (x.red > b.red || x.amber > b.amber) return false;
  }
  return after.score.score >= before.score.score;
}

// ------------------------------------------------------------------ helpers

const deckOfZ = (d: Design, id: string) => d.decks.find((k) => k.id === id)?.z ?? 0;
const mm = (s?: string) => (s ? parseFloat(s) : NaN);
let uidN = 0;
const uid = (p: string) => `${p}fix${Date.now().toString(36)}${(uidN++).toString(36)}`;

function centreOf(_d: Design, s: Space): RunPoint {
  return { x: s.xCentre, y: s.yCentre, deckId: s.deckId };
}

/** The wall (shared edge) a door sits in. */
function wallOf(edges: SharedEdge[], dr: Door): SharedEdge | undefined {
  return edges.find(
    (e) =>
      e.deckId === dr.deckId &&
      Math.abs((e.x1 - e.x0) * (dr.y - e.y0) - (e.y1 - e.y0) * (dr.x - e.x0)) / Math.max(1e-9, e.length) < 0.3 &&
      dr.x >= Math.min(e.x0, e.x1) - 0.3 &&
      dr.x <= Math.max(e.x0, e.x1) + 0.3 &&
      dr.y >= Math.min(e.y0, e.y1) - 0.3 &&
      dr.y <= Math.max(e.y0, e.y1) + 0.3,
  );
}

/** Move one segment of a run sideways (away from a point) by `by` metres; neighbouring legs stretch with it. */
function offsetSegment(run: Run, i: number, away: { x: number; y: number }, by: number): RunPoint[] {
  const pts = run.points.map((p) => ({ ...p }));
  const a = pts[i],
    b = pts[i + 1];
  if (!a || !b || a.deckId !== b.deckId) return pts;
  const alongX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const mid = alongX ? a.y : a.x;
  const sign = (alongX ? mid - away.y : mid - away.x) >= 0 ? 1 : -1;
  const shift = (p: RunPoint) => (alongX ? (p.y = +(p.y + sign * by).toFixed(2)) : (p.x = +(p.x + sign * by).toFixed(2)));
  // keep the run connected: an end point is moved with an extra elbow so the rest of the run stays put
  const out: RunPoint[] = [];
  pts.forEach((p, k) => {
    if (k === i) {
      if (k > 0) out.push({ ...p });
      const q = { ...p };
      shift(q);
      out.push(q);
    } else if (k === i + 1) {
      const q = { ...p };
      shift(q);
      out.push(q);
      if (k < pts.length - 1) out.push({ ...p });
    } else out.push(p);
  });
  return out;
}

// ------------------------------------------------------------------ the catalogue

type Gen = (d: Design, a: Analysis, f: Finding) => FixCandidate[] | string;

const CATALOGUE: { rule: string; match: RegExp; gen: Gen }[] = [
  // ---- fire integrity
  {
    rule: "FIRE-WALL-RATING",
    match: /^The wall between/,
    gen: (d, _a, f) => {
      const [A, B] = f.targets;
      const e = sharedEdges(d).find((x) => (x.a === A && x.b === B) || (x.a === B && x.b === A));
      const rating = f.limit as FireRating;
      return [{ id: "rate", label: `Set the wall to ${rating}`, actions: [{ kind: "division", a: A, b: B, rating }], focus: e ? { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2, deckId: e.deckId } : centreOf(d, d.spaces.find((s) => s.id === A)!), size: 1 }];
    },
  },
  {
    rule: "FIRE-WALL-RATING",
    match: /^The fire zone bulkhead at/,
    gen: (d, _a, f) => {
      const b = d.bulkheads.find((x) => x.id === f.targets[0])!;
      return [{ id: "rate", label: `Set the bulkhead to ${f.limit}`, actions: [{ kind: "bulkhead", id: b.id, set: { rating: f.limit as FireRating } }], focus: { x: b.x, y: 0, deckId: d.bulkheadDeckId }, size: 1 }];
    },
  },
  // ---- stairs
  {
    rule: "ESCAPE-STAIR-WIDTH",
    match: /wide; escape stairs must be at least/,
    gen: (d, _a, f) => {
      const s = d.spaces.find((x) => x.id === f.targets[0])!;
      const w = mm(f.limit);
      const st = s.stair!;
      const lanes = st.flightsPerDeck > 1 ? 2 : 1;
      const foreAft = st.orientation === "fore-aft";
      const need = (lanes * w) / 1000;
      const across = foreAft ? s.breadth : s.length;
      const out: FixCandidate[] = [{ id: "widen", label: `Widen ${s.name} to ${w} mm`, actions: [{ kind: "space", id: s.id, set: {}, stair: { widthMm: w } }], focus: centreOf(d, s), size: (w - st.widthMm) / 1000 }];
      if (need > across + 0.01)
        for (const shift of [0, 1, -1]) {
          const grow = need - across;
          const set = foreAft ? { breadth: +need.toFixed(2), yCentre: +(s.yCentre + (shift * grow) / 2).toFixed(2) } : { length: +need.toFixed(2), xCentre: +(s.xCentre + (shift * grow) / 2).toFixed(2) };
          out.push({ id: `grow${shift}`, label: `Widen ${s.name} to ${w} mm and make the stairwell ${need.toFixed(1)} m wide`, actions: [{ kind: "space", id: s.id, set, stair: { widthMm: w } }], focus: centreOf(d, s), size: (w - st.widthMm) / 1000 + grow * 2 });
        }
      return out;
    },
  },
  {
    rule: "ESCAPE-STAIR-WIDTH",
    match: /emergency doors? into .* narrower than the/,
    gen: (d, _a, f) => {
      const s = d.spaces.find((x) => x.id === f.targets[0])!;
      const w = mm(f.limit);
      const doors = f.targets.slice(1).map((id) => d.doors.find((x) => x.id === id)).filter(Boolean) as Door[];
      const edges = sharedEdges(d);
      const fits = doors.filter((dr) => (wallOf(edges, dr)?.length ?? 0) >= w / 1000);
      if (!fits.length) return `The walls are too short for ${w} mm doors.`;
      const first = fits[0];
      return [{ id: "doors", label: `Widen ${fits.length} door${fits.length > 1 ? "s" : ""} into ${s.name} to ${w} mm`, actions: fits.map((dr) => ({ kind: "door" as const, id: dr.id, set: { widthMm: w } })), focus: { x: first.x, y: first.y, deckId: first.deckId }, size: (fits.length * (w - first.widthMm)) / 1000 }];
    },
  },
  { rule: "ESCAPE-STAIR-WIDTH", match: /has a handrail on one side only/, gen: (d, _a, f) => [{ id: "rail", label: "Add the second handrail", actions: [{ kind: "space", id: f.targets[0], set: {}, stair: { handrailsBothSides: true } }], focus: centreOf(d, d.spaces.find((s) => s.id === f.targets[0])!), size: 0.1 }] },
  { rule: "ESCAPE-STAIR-WIDTH", match: /runs across the ship/, gen: (d, _a, f) => [{ id: "turn", label: "Turn the stair fore and aft", actions: [{ kind: "space", id: f.targets[0], set: {}, stair: { orientation: "fore-aft" } }], focus: centreOf(d, d.spaces.find((s) => s.id === f.targets[0])!), size: 1 }] },
  {
    rule: "ESCAPE-STAIR-WIDTH",
    match: /without a landing/,
    gen: (d, _a, f) => {
      const s = d.spaces.find((x) => x.id === f.targets[0])!;
      return [{ id: "landing", label: "Add a landing (one more flight per deck)", actions: [{ kind: "space", id: s.id, set: {}, stair: { flightsPerDeck: (s.stair?.flightsPerDeck ?? 1) + 1 } }], focus: centreOf(d, s), size: 1 }];
    },
  },
  {
    rule: "ESCAPE-STAIR-WIDTH",
    match: /has no door there/,
    gen: (d, _a, f) => {
      const doors = autoDoors(d, f.targets[0]);
      if (!doors.length) return "No corridor next to the stair on that deck.";
      return [{ id: "door", label: `Add ${doors.length} emergency door${doors.length > 1 ? "s" : ""} to the stair`, actions: doors.map((door) => ({ kind: "addDoor" as const, door })), focus: { x: doors[0].x, y: doors[0].y, deckId: doors[0].deckId }, size: doors.length }];
    },
  },
  // ---- escape routes
  {
    rule: "ESCAPE-TWO-EXITS",
    match: /has no door\.|has only one way out|has no escape route|has no route to an enclosed stairway/,
    gen: (d, _a, f) => {
      const out: FixCandidate[] = [];
      for (const id of f.targets.slice(0, 3)) {
        const doors = autoDoors(d, id);
        if (doors.length) out.push({ id: `doors-${id}`, label: `Add ${doors.length} emergency door${doors.length > 1 ? "s" : ""} from ${d.spaces.find((s) => s.id === id)?.name}`, actions: doors.map((door) => ({ kind: "addDoor" as const, door })), focus: { x: doors[0].x, y: doors[0].y, deckId: doors[0].deckId }, size: doors.length });
      }
      return out.length ? out : "No corridor or stair next to it to put a door into.";
    },
  },
  {
    rule: "ESCAPE-TWO-EXITS",
    match: /exits of .* are only .* apart/,
    gen: (d, _a, f) => {
      const doors = f.targets.map((id) => d.doors.find((x) => x.id === id)).filter(Boolean) as Door[];
      if (doors.length < 2) return "Exits not found.";
      const edges = sharedEdges(d);
      const out: FixCandidate[] = [];
      doors.slice(0, 2).forEach((dr, i) => {
        const other = doors[1 - i];
        const e = wallOf(edges, dr);
        if (!e) return;
        const ends = [0.0, 1.0].map((t) => {
          const inset = Math.min(0.5, (dr.widthMm / 1000 / 2 + 0.1) / e.length);
          const u = t === 0 ? inset : 1 - inset;
          return { x: +(e.x0 + (e.x1 - e.x0) * u).toFixed(2), y: +(e.y0 + (e.y1 - e.y0) * u).toFixed(2) };
        });
        const best = ends.sort((p, q) => Math.hypot(q.x - other.x, q.y - other.y) - Math.hypot(p.x - other.x, p.y - other.y))[0];
        out.push({ id: `move${i}`, label: `Move the door at x ${dr.x.toFixed(1)} m to the far end of its wall`, actions: [{ kind: "door", id: dr.id, set: best }], focus: { x: dr.x, y: dr.y, deckId: dr.deckId }, size: Math.hypot(best.x - dr.x, best.y - dr.y) });
      });
      return out;
    },
  },
  // ---- evacuation queues: widen the stair (and its doors) when the stairwell has room for the width needed
  {
    rule: "EVACUATION-TIME",
    match: /^Queue at /,
    gen: (d, a, f) => {
      const s = d.spaces.find((x) => x.id === f.targets[0] && x.type === "stairwell");
      if (!s?.stair) return "Not a stair queue.";
      const m = f.message.match(/arrive at ([\d.]+) persons\/s but the stair passes only ([\d.]+)/);
      if (!m) return "Flows not found.";
      const inflow = +m[1],
        outflow = +m[2];
      const perM = outflow / (s.stair.widthMm / 1000); // persons per second per metre of clear width
      const limit = ruleDef("EVACUATION-TIME").values.congestion_flow_difference_p_per_s;
      const needMm = Math.ceil(((inflow - limit) / perM) * 10) * 100;
      const lanes = s.stair.flightsPerDeck > 1 ? 2 : 1;
      const across = s.stair.orientation === "fore-aft" ? s.breadth : s.length;
      const maxMm = Math.floor((across / lanes) * 10) * 100;
      if (needMm > maxMm) return `${s.name} would need ${needMm} mm; its stairwell holds at most ${maxMm} mm. Add a stair nearby instead.`;
      const edges = sharedEdges(d);
      const doors = (a.graph.bySpace.get(s.id) ?? []).filter((c) => !c.virtual).map((c) => d.doors.find((x) => x.id === c.id)).filter(Boolean) as Door[];
      const out: FixCandidate[] = [];
      for (const w of [needMm, Math.min(maxMm, needMm + 200)]) {
        if (out.some((c) => c.id === `w${w}`)) continue;
        if (doors.some((dr) => (wallOf(edges, dr)?.length ?? 0) < w / 1000)) continue;
        out.push({
          id: `w${w}`,
          label: `Widen ${s.name} and its ${doors.length} doors to ${w} mm`,
          actions: [{ kind: "space", id: s.id, set: {}, stair: { widthMm: w } }, ...doors.filter((dr) => dr.widthMm < w).map((dr) => ({ kind: "door" as const, id: dr.id, set: { widthMm: w } }))],
          focus: centreOf(d, s),
          size: (w - s.stair.widthMm) / 1000 + doors.length * 0.1,
        });
      }
      return out.length ? out : `The walls around ${s.name} are too short for wider doors.`;
    },
  },
  // ---- subdivision
  {
    rule: "COLLISION-BULKHEAD",
    match: /aft of the forward perpendicular/,
    gen: (d, a, f) => {
      const b = d.bulkheads.find((x) => x.id === f.targets[0]);
      const fl = freeboardLength({ design: d, ship: a.ship!, graph: a.graph, condition: a.condition, evac: a.evac, flood: a.flood, gz: a.gz });
      if (!b || !fl) return "Hull not ready.";
      const v = ruleDef("COLLISION-BULKHEAD").values;
      const lo = Math.min(v.min_share_of_lf * fl.Lf, v.min_cap_m),
        hi = Math.max(v.max_share_of_lf * fl.Lf, v.max_alt_share_of_lf * fl.Lf + v.max_alt_extra_m);
      return [0.5, 0.3, 0.7].map((t) => {
        const x = +(fl.xFP - (lo + (hi - lo) * t)).toFixed(1);
        return { id: `x${t}`, label: `Move the collision bulkhead to x ${x} m (${(fl.xFP - x).toFixed(1)} m from the bow)`, actions: [{ kind: "bulkhead" as const, id: b.id, set: { x } }], focus: { x, y: 0, deckId: d.bulkheadDeckId }, size: Math.abs(x - b.x) };
      });
    },
  },
  {
    rule: "FLOOD-SURVIVAL",
    match: /^The ship is lost if compartments? /,
    gen: (d, a, f) => {
      const cs = a.flood?.ok ? a.flood.compartments.filter((c) => f.targets.includes(c.id)) : [];
      if (!cs.length) return "Compartments not found.";
      const out: FixCandidate[] = [];
      for (const c of cs) {
        const x = +((c.xAft + c.xFwd) / 2).toFixed(1);
        if (c.xFwd - c.xAft < 8) continue;
        out.push({ id: `wt${x}`, label: `Add a watertight bulkhead at x ${x} m (splits compartment ${c.id})`, actions: [{ kind: "addBulkhead", bulkhead: { id: uid("wt"), kind: "watertight", x, rating: "A-0" } }], focus: { x, y: 0, deckId: d.bulkheadDeckId }, size: 6 });
      }
      return out.length ? out : "Compartments are already short.";
    },
  },
  // ---- reference ships
  {
    rule: "REFERENCE-SHIPS",
    match: /m2\)?\.?$|gives each person only/,
    gen: (d, _a, f) => {
      const v = ruleDef("REFERENCE-SHIPS").values;
      const cabins = f.targets.map((id) => d.spaces.find((s) => s.id === id)).filter(Boolean) as Space[];
      let removed = 0;
      const actions: FixAction[] = cabins.map((s) => {
        const p = Math.max(1, Math.floor((s.length * s.breadth) / v.min_cabin_area_per_person_m2 + 1e-6));
        removed += s.persons - p;
        return { kind: "space", id: s.id, set: { persons: p } };
      });
      if (!removed) return "Already within the area per person.";
      actions.push({ kind: "people", passengers: Math.max(0, d.people.passengers - removed) });
      return [{ id: "persons", label: `Plan ${removed} fewer berths in ${cabins.map((s) => s.name).join(" and ")}`, actions, focus: centreOf(d, cabins[0]), size: removed }];
    },
  },
  {
    rule: "REFERENCE-SHIPS",
    match: /^(.+) and (.+) are only .* m apart\.$/,
    gen: (d, _a, f) => {
      const v = ruleDef("REFERENCE-SHIPS").values;
      const decks = sortedDecks(d);
      const i = decks.findIndex((k, j) => j < decks.length - 1 && f.message.startsWith(`${k.name} and ${decks[j + 1].name}`));
      if (i < 0) return "Decks not found.";
      const dz = +(decks[i].z + v.min_deck_height_m - decks[i + 1].z).toFixed(2);
      const actions: FixAction[] = decks.slice(i + 1).map((k) => ({ kind: "deck", id: k.id, z: +(k.z + dz).toFixed(2) }));
      return [{ id: "raise", label: `Raise ${decks[i + 1].name}${i + 2 < decks.length ? " and the decks above" : ""} by ${dz.toFixed(2)} m`, actions, focus: { x: d.hull.LOA / 2, y: 0, deckId: decks[i + 1].id }, size: dz * 5 }];
    },
  },
  {
    rule: "REFERENCE-SHIPS",
    match: /^The escape route from .* leads through /,
    gen: (d, a, f) => {
      const [room, ...from] = f.targets;
      const out: FixCandidate[] = [];
      for (const c of a.graph.conns) {
        if (c.virtual) continue;
        const pair = [c.a, c.b];
        if (pair.includes(room) && from.some((x) => pair.includes(x))) {
          const dr = d.doors.find((x) => x.id === c.id);
          if (dr) out.push({ id: `rm${dr.id}`, label: `Remove the connecting door between ${d.spaces.find((s) => s.id === room)?.name} and ${d.spaces.find((s) => from.includes(s.id))?.name}`, actions: [{ kind: "removeDoor", id: dr.id }], focus: { x: dr.x, y: dr.y, deckId: dr.deckId }, size: 1 });
        }
      }
      return out.length ? out : "No connecting door to remove.";
    },
  },
  // ---- pipes and cables
  {
    rule: "PIPE-FUEL-HOT",
    match: / passes .* m from /,
    gen: (d, _a, f) => fuelOrCableAway(d, f, ruleDef("PIPE-FUEL-HOT").values.min_clearance_to_exhaust_m),
  },
  {
    rule: "CABLE-ROUTING",
    match: / passes .* m from /,
    gen: (d, _a, f) => fuelOrCableAway(d, f, ruleDef("CABLE-ROUTING").values.min_clearance_to_exhaust_m),
  },
  {
    rule: "CABLE-ROUTING",
    match: / runs through /,
    gen: (d, _a, f) => {
      const run = d.runs.find((r) => r.id === f.targets[0]);
      if (!run) return "Cable not found.";
      const v = ruleDef("CABLE-ROUTING").values;
      const pat = new RegExp(v.high_fire_risk_name_pattern, "i");
      const bad = (r: Run) => spacesCrossed(d, r).some((c) => v.high_fire_risk_types.includes(c.space.type) || pat.test(c.space.name));
      const out: FixCandidate[] = [];
      const P = run.points;
      // straighten: drop a detour (interior points) whose two neighbours line up on one deck
      for (let i = 1; i < P.length - 1; i++)
        for (let j = P.length - 2; j >= i; j--) {
          const a = P[i - 1],
            b = P[j + 1];
          if (a.deckId !== b.deckId || (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01)) continue;
          const pts = [...P.slice(0, i), ...P.slice(j + 1)];
          const test = { ...run, points: pts };
          if (!bad(test)) out.push({ id: `str${i}-${j}`, label: `Straighten ${run.name} along the corridor`, actions: [{ kind: "runPoints", id: run.id, points: pts }], focus: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, deckId: a.deckId }, size: j - i + 1 });
        }
      out.sort((p, q) => p.size - q.size);
      return out.length ? out.slice(0, 2) : "No straight route around the room.";
    },
  },
  {
    rule: "PIPE-FIRE-MAIN",
    match: /has no fire main in fire|is not connected to the fire pumps|has no fire main yet/,
    gen: (d, _a, f) => {
      const defs = defaultRuns(d).filter((r) => r.kind === "fire_main");
      const deckId = f.at?.deckId ?? f.targets.find((t) => d.decks.some((k) => k.id === t));
      const want = defs.filter((r) => (f.message.includes("has no fire main yet") ? true : r.points.some((p) => p.deckId === deckId)) || r.id === "fm-riser");
      const add = want.filter((r) => !d.runs.some((x) => x.kind === "fire_main" && JSON.stringify(x.points) === JSON.stringify(r.points)));
      if (!add.length) return "The default fire main is already there.";
      const runs = add.map((r) => ({ ...r, id: uid("fm") }));
      const p = runs[0].points[0];
      return [{ id: "fm", label: `Lay ${runs.length === 1 ? "a fire main" : `${runs.length} fire main runs`} along the corridor${deckId ? ` of ${d.decks.find((k) => k.id === deckId)?.name}` : ""}`, actions: runs.map((run) => ({ kind: "addRun" as const, run })), focus: p, size: runs.length * 3 }];
    },
  },
  {
    rule: "PIPE-WATERTIGHT",
    match: /goes through the collision bulkhead/,
    gen: (d, _a, f) => {
      const run = d.runs.find((r) => r.id === f.targets[0]);
      const b = d.bulkheads.find((x) => x.id === f.targets[1]);
      if (!run || !b || !f.at) return "Not found.";
      const pts: RunPoint[] = [];
      for (let i = 0; i < run.points.length; i++) {
        const p = run.points[i];
        if (p.x < b.x || p.deckId !== f.at.deckId) pts.push(p);
        else {
          const prev = run.points[i - 1];
          if (prev && prev.x < b.x) pts.push({ x: +(b.x - 0.5).toFixed(2), y: p.y, deckId: p.deckId });
          break;
        }
      }
      if (pts.length < 2) return "The run lies forward of the bulkhead.";
      return [{ id: "cut", label: `End ${run.name} just aft of the collision bulkhead`, actions: [{ kind: "runPoints", id: run.id, points: pts }], focus: f.at, size: 2 }];
    },
  },
  // ---- survival craft
  {
    rule: "LSA-CAPACITY",
    match: /^Lifeboats on the (port|starboard) side carry/,
    gen: (d, _a, f) => {
      const port = /port/.test(f.message);
      const need = mm(f.limit) - mm(f.measured);
      const boats = d.lsa.filter((l) => l.kind === "lifeboat");
      const muster = d.spaces.find((s) => s.type === "muster_station")?.deckId ?? boats[0]?.deckId;
      if (!muster) return "No assembly deck.";
      const same = boats.filter((l) => (l.y >= 0) === port);
      const ref = same[0] ?? boats[0];
      const y = ref ? (port ? Math.abs(ref.y) : -Math.abs(ref.y)) : 0;
      if (!ref) return "No lifeboat to copy.";
      const cap = Math.max(ref.capacity, need);
      const xs = boats.map((l) => l.x);
      const out: FixCandidate[] = [];
      for (const x of [Math.max(...xs) + 10, Math.min(...xs) - 10]) {
        if (x <= 2 || x >= d.hull.LOA - 2) continue;
        out.push({ id: `lb${x}`, label: `Add a ${cap}-person lifeboat on the ${port ? "port" : "starboard"} side at x ${x.toFixed(0)} m`, actions: [{ kind: "addLsa", lsa: { id: uid("lb"), kind: "lifeboat", deckId: muster, x, y, capacity: cap, massT: ref.massT } }], focus: { x, y, deckId: muster }, size: 4 });
      }
      return out.length ? out : "No free place on the assembly deck.";
    },
  },
  {
    rule: "LSA-CAPACITY",
    match: /waterline|not on a deck with an assembly station/,
    gen: (d, _a, f) => {
      const l = d.lsa.find((x) => x.id === f.targets[0]);
      const muster = d.spaces.find((s) => s.type === "muster_station")?.deckId;
      if (!l || !muster) return "No assembly deck.";
      return [{ id: "up", label: `Move it up to ${d.decks.find((k) => k.id === muster)?.name}`, actions: [{ kind: "lsa", id: l.id, set: { deckId: muster } }], focus: { x: l.x, y: l.y, deckId: muster }, size: 2 }];
    },
  },
  // ---- plausibility
  {
    rule: "DESIGN-SANITY",
    match: /persons placed inside|has persons placed in|have persons placed in/,
    gen: (d, _a, f) => {
      const ss = f.targets.map((id) => d.spaces.find((s) => s.id === id)).filter(Boolean) as Space[];
      return [{ id: "zero", label: `Remove the persons from ${ss.map((s) => s.name).join(", ")}`, actions: ss.map((s) => ({ kind: "space" as const, id: s.id, set: { persons: 0 } })), focus: centreOf(d, ss[0]), size: 1 }];
    },
  },
  {
    rule: "DESIGN-SANITY",
    match: /persons\/m2\.$/,
    gen: (d, _a, f) => {
      const s = d.spaces.find((x) => x.id === f.targets[0])!;
      const p = Math.max(1, Math.floor(s.length * s.breadth * 1.0));
      return [{ id: "persons", label: `Set ${s.name} to ${p} persons`, actions: [{ kind: "space", id: s.id, set: { persons: p } }], focus: centreOf(d, s), size: 1 }];
    },
  },
  {
    rule: "DESIGN-SANITY",
    match: /^An emergency door of .* sits in a wall only/,
    gen: (d, _a, f) => {
      const dr = d.doors.find((x) => x.id === f.targets[0])!;
      return [{ id: "fit", label: `Make the door ${f.limit}`, actions: [{ kind: "door", id: dr.id, set: { widthMm: mm(f.limit) } }], focus: { x: dr.x, y: dr.y, deckId: dr.deckId }, size: 1 }];
    },
  },
  {
    rule: "DESIGN-SANITY",
    match: /narrower than 600 mm/,
    gen: (d, _a, f) => {
      const ds = f.targets.map((id) => d.doors.find((x) => x.id === id)).filter(Boolean) as Door[];
      return [{ id: "w", label: `Widen ${ds.length} door${ds.length > 1 ? "s" : ""} to 700 mm`, actions: ds.map((x) => ({ kind: "door" as const, id: x.id, set: { widthMm: 700 } })), focus: { x: ds[0].x, y: ds[0].y, deckId: ds[0].deckId }, size: ds.length }];
    },
  },
];

function fuelOrCableAway(d: Design, f: Finding, minGap: number): FixCandidate[] | string {
  const run = d.runs.find((r) => r.id === f.targets[0]);
  const hot = d.runs.find((r) => r.id === f.targets[1]);
  if (!run || !hot) return "Runs not found.";
  const gap = runClearance(d, run, hot)?.gap ?? 0;
  const segs = runSegments(d, run);
  const near = segs.map((g) => ({ g, gap: runClearance(d, { ...run, points: [run.points[g.i], run.points[g.i + 1]] }, hot)?.gap ?? Infinity })).sort((p, q) => p.gap - q.gap)[0];
  const out: FixCandidate[] = [];
  // 1. shorten: drop the end legs that reach towards the exhaust
  for (let k = run.points.length - 1; k >= 2; k--) {
    const pts = run.points.slice(0, k);
    const g = runClearance(d, { ...run, points: pts }, hot)?.gap ?? Infinity;
    if (g >= minGap) {
      out.push({ id: `cut${k}`, label: `End ${run.name} ${run.points.length - k === 1 ? "one leg" : `${run.points.length - k} legs`} earlier, clear of the exhaust`, actions: [{ kind: "runPoints", id: run.id, points: pts }], focus: run.points[k - 1], size: run.points.length - k });
      break;
    }
  }
  // 2. move the nearest leg sideways
  if (near) {
    const by = +(minGap - gap + 0.3).toFixed(2);
    const ex = hot.points[0];
    const pts = offsetSegment(run, near.g.i, ex, by);
    if ((runClearance(d, { ...run, points: pts }, hot)?.gap ?? 0) >= minGap)
      out.push({ id: "shift", label: `Move the nearest leg of ${run.name} ${by.toFixed(1)} m away from the exhaust`, actions: [{ kind: "runPoints", id: run.id, points: pts }], focus: run.points[near.g.i], size: by * 2 });
  }
  return out.length ? out : "No clear route found.";
}

// ------------------------------------------------------------------ planner

const norm = (ruleId: string, f: Finding) => `${ruleId}|${f.targets.slice().sort().join(",")}|${f.message.replace(/[\d.]+/g, "#")}`;

export interface PlanOptions {
  choose?: Chooser;
  maxSteps?: number;
  maxAI?: number;
  timeBudgetMs?: number;
  progress?: (text: string, done: number, total: number) => void;
}

/** Plan the fixes for every flag, one at a time, each verified on the whole analysis. */
export async function planFixes(start: Design, opts: PlanOptions = {}): Promise<FixPlan> {
  const t0 = Date.now();
  const maxSteps = opts.maxSteps ?? 24;
  const maxAI = opts.maxAI ?? 4;
  const budget = opts.timeBudgetMs ?? 45000;
  let d: Design = structuredClone(start);
  let a = analyze(d, { withCurves: false });
  const scoreBefore = a.score.score;
  const steps: FixStep[] = [];
  const skipped: FixSkip[] = [];
  const tried = new Set<string>();
  let aiCalls = 0;
  const all = () =>
    a.rules
      .flatMap((r) => r.findings.map((f) => ({ r, f })))
      .filter(({ f }) => f.status === "red" || f.status === "amber")
      .sort((p, q) => (p.f.status === "red" ? 0 : 1) - (q.f.status === "red" ? 0 : 1));
  const total = all().length;
  while (steps.length < maxSteps && Date.now() - t0 < budget) {
    const next = all().find(({ r, f }) => !tried.has(norm(r.ruleId, f)));
    if (!next) break;
    const { r, f } = next;
    tried.add(norm(r.ruleId, f));
    opts.progress?.(`${r.title}: ${f.message}`, tried.size, Math.max(total, tried.size));
    const entry = CATALOGUE.find((c) => c.rule === r.ruleId && c.match.test(f.message));
    if (!entry) {
      skipped.push({ ruleId: r.ruleId, finding: f.message, status: f.status, why: "Needs a designer's decision; no safe automatic change." });
      continue;
    }
    let gen: FixCandidate[] | string;
    try {
      gen = entry.gen(d, a, f);
    } catch (e) {
      gen = `Could not build a fix (${(e as Error).message}).`;
    }
    if (typeof gen === "string" || !gen.length) {
      skipped.push({ ruleId: r.ruleId, finding: f.message, status: f.status, why: typeof gen === "string" ? gen : "No candidate." });
      continue;
    }
    const tb = tally(a);
    const ok: { c: FixCandidate; d: Design; a: Analysis }[] = [];
    for (const c of gen.slice(0, 4)) {
      const trial = structuredClone(d);
      applyActions(trial, c.actions);
      const at = analyze(trial, { withCurves: false });
      if (improves(a, tb, at, r.ruleId)) ok.push({ c, d: trial, a: at });
    }
    if (!ok.length) {
      skipped.push({ ruleId: r.ruleId, finding: f.message, status: f.status, why: "Every automatic option made something else worse." });
      continue;
    }
    ok.sort((p, q) => p.c.size - q.c.size || q.a.score.score - p.a.score.score);
    let pick = ok[0];
    let byAI: FixStep["byAI"];
    const distinct = new Set(ok.map((o) => o.c.label)).size > 1;
    if (opts.choose && ok.length > 1 && distinct && aiCalls < maxAI) {
      aiCalls++;
      opts.progress?.(`Asking the AI to choose between ${ok.length} safe options`, tried.size, Math.max(total, tried.size));
      try {
        const ans = await opts.choose({ rule: r.ruleId, title: r.title, finding: f.message, options: ok.map((o) => ({ id: o.c.id, label: o.c.label, size: +o.c.size.toFixed(2) })) });
        const hit = ans && ok.find((o) => o.c.id === ans.choice);
        if (hit) {
          pick = hit;
          byAI = { reason: ans!.reason, model: ans!.model };
        }
      } catch {
        /* AI unavailable: keep the smallest change */
      }
    }
    d = pick.d;
    a = pick.a;
    steps.push({ ruleId: r.ruleId, finding: f.message, status: f.status, chosen: pick.c, options: ok.length, byAI, scoreAfter: a.score.score });
  }
  return { steps, skipped, scoreBefore, scoreAfter: a.score.score, ms: Date.now() - t0, aiCalls };
}

/** Height for the camera when looking at a fix spot. */
export function focusZ(d: Design, p: RunPoint): number {
  return runZ(d, p.deckId) ?? deckOfZ(d, p.deckId) + 2;
}

