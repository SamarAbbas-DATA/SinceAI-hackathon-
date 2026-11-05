// One entry point that runs the whole analysis chain for a design.
import type { Design, RuleResult, Status, Finding } from "./types";
import { createShip, computeCondition, hydrostaticTable, resistanceCurve, holtropValidity, halfBreadthAt, type Condition, type Hydro, type ResistancePoint } from "./vessel";
import { buildGraph, overlaps, connections, rectOf, type Graph, type DoorIssue } from "./topology";
import { evacuate, type EvacResult } from "./evacuation";
import { floodAnalysis, type FloodResult } from "./flooding";
import { gzCurve, type GZResult } from "./stability";
import { runRules, score, worst, ruleDef } from "./rules";
import type { Ship } from "../vendor/vessel/vessel.module.js";

export type GeometryIssue = Finding;

export interface Analysis {
  ship: Ship | null;
  condition: Condition | null;
  hydroTable: Hydro[];
  gz: GZResult | null;
  resistance: ResistancePoint[];
  holtropWarnings: string[];
  evac: EvacResult | null;
  flood: FloodResult | null;
  graph: Graph;
  geometry: GeometryIssue[];
  rules: RuleResult[];
  score: { score: number; counted: number };
  statusById: Map<string, Status>;
  errors: string[];
  ms: number;
}

function attempt<T>(errors: string[], label: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message}`);
    return null;
  }
}

export function analyze(design: Design, opts: { withCurves?: boolean } = {}): Analysis {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const errors: string[] = [];
  const ship = attempt(errors, "Hull", () => createShip(design));
  const condition = ship ? attempt(errors, "Loading condition", () => computeCondition(design, ship)) : null;
  const hydroTable = ship && opts.withCurves !== false ? attempt(errors, "Hydrostatics", () => hydrostaticTable(ship, design.hull.depth)) ?? [] : [];
  const gz =
    ship && condition && !condition.overloaded
      ? attempt(errors, "GZ curve", () =>
          gzCurve(ship, { V0: condition.hydro.Vs, KG: condition.KG, TCG: condition.TCG, T: condition.T, depth: design.hull.depth, BWL: condition.hydro.BWL }),
        )
      : null;
  const resistance = ship && condition && opts.withCurves !== false ? attempt(errors, "Resistance", () => resistanceCurve(ship, condition, design.hull.designSpeedKn * 1.25)) ?? [] : [];
  const holtropWarnings = condition ? holtropValidity(condition) : [];

  const graph = buildGraph(design);
  const mvz = design.bulkheads.filter((b) => b.kind === "fire_zone").length + 1;
  const evac = attempt(errors, "Evacuation", () => evacuate(design, { mvz, graph }));
  const fv = ruleDef("FLOOD-SURVIVAL").values;
  const N = design.people.passengers + design.people.crew;
  const flood =
    ship && condition
      ? attempt(errors, "Flooding", () =>
          floodAnalysis(design, ship, { T: condition.T, KG: condition.KG, LCG: condition.LCG, massT: condition.weights.total.massT }, {
            permeability: fv.permeability,
            heelLimitDeg: fv.survive_if_final_heel_degrees_below,
            N,
            mix: fv.single_vs_pair_mix,
          }),
        )
      : null;

  // Geometry sanity (not regulatory): overlaps, doors, spaces outside the hull
  const geometry: GeometryIssue[] = [];
  const deckName = (id: string) => design.decks.find((d) => d.id === id)?.name ?? id;
  for (const o of overlaps(design)) {
    const a = design.spaces.find((s) => s.id === o.a)?.name,
      b = design.spaces.find((s) => s.id === o.b)?.name;
    geometry.push({
      status: "red",
      message: `${a} and ${b} overlap by ${o.area.toFixed(1)} m2 on ${deckName(o.deckId)}.`,
      detail: "Two spaces cannot occupy the same deck area. Weights, walls and escape routes for both are unreliable until this is fixed.",
      fix: "Move or resize one of them. Spaces may touch but not overlap.",
      targets: [o.a, o.b],
    });
  }
  const { doorIssues } = connections(design);
  for (const d of doorIssues as DoorIssue[])
    geometry.push({
      status: "amber",
      message: `The door at x ${d.door.x.toFixed(1)} m, y ${d.door.y.toFixed(1)} m on ${deckName(d.door.deckId)} does not connect two spaces.`,
      detail: `${d.problem}. A door only counts for escape when it sits on a wall shared by exactly two spaces.`,
      fix: "Delete it and place it again with the Door tool, which snaps to walls.",
      targets: [d.door.id],
    });
  if (ship) {
    const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
    for (const s of design.spaces) {
      const r = rectOf(s);
      const z = (deckZ.get(s.deckId) ?? 0) + 0.01;
      let worstX = 0,
        worstOver = 0;
      for (const [x, y] of [
        [r.x0, r.y0],
        [r.x0, r.y1],
        [r.x1, r.y0],
        [r.x1, r.y1],
      ]) {
        const hb = halfBreadthAt(ship, Math.min(Math.max(x, 0), design.hull.LOA), z);
        const over = x < -0.05 || x > design.hull.LOA + 0.05 ? 99 : Math.abs(y) - hb;
        if (over > worstOver) ((worstOver = over), (worstX = x));
      }
      if (worstOver > 0.05)
        geometry.push({
          status: "amber",
          message: `${s.name} sticks out of the hull on ${deckName(s.deckId)}.`,
          detail:
            worstOver >= 99
              ? "Part of it lies beyond the ends of the hull."
              : `At x ${worstX.toFixed(1)} m the hull is only ${(2 * halfBreadthAt(ship, Math.min(Math.max(worstX, 0), design.hull.LOA), z)).toFixed(1)} m wide at this deck height, so a corner is ${worstOver.toFixed(2)} m outside the shell.`,
          fix: "Move it towards the centreline or midships, or make it narrower.",
          targets: [s.id],
        });
    }
  }
  if (condition?.overloaded)
    geometry.push({
      status: "red",
      message: `The ship is too heavy: ${condition.weights.total.massT.toFixed(0)} t is more than the hull can float.`,
      detail: "The displacement exceeds the hull volume up to the moulded depth, so the ship would sink.",
      fix: "Reduce weight (tank fillings, deadweight, lightship) or enlarge the hull in the Design tab.",
      targets: [],
    });
  else if (condition && condition.freeboard < 0.5)
    geometry.push({
      status: "amber",
      message: `Freeboard is only ${condition.freeboard.toFixed(2)} m.`,
      detail: "The deck edge is very close to the water, so the ship takes water on deck early and loses stability at small angles.",
      fix: "Reduce weight or increase the moulded depth.",
      targets: [],
    });

  const rules = runRules({ design, ship: ship!, graph, condition, evac, flood, gz });
  const statusById = new Map<string, Status>();
  const mark = (id: string, s: Status) => statusById.set(id, worst(statusById.get(id) ?? "green", s));
  for (const r of rules) for (const f of r.findings) for (const id of f.targets) mark(id, f.status);
  // compartments -> their spaces
  if (flood?.ok)
    for (const c of flood.compartments) {
      const st = statusById.get(c.id);
      if (st) for (const sid of c.spaces) mark(sid, st === "red" ? "amber" : st);
    }
  for (const gi of geometry) for (const id of gi.targets) mark(id, gi.status);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { ship, condition, hydroTable, gz, resistance, holtropWarnings, evac, flood, graph, geometry, rules, score: score(rules), statusById, errors, ms: t1 - t0 };
}
