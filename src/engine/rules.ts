// Rules engine. Every threshold is read from rules.json (single source of truth).
// Each finding says what is wrong (message), why it matters (detail) and how to fix it (fix).
import rulesJson from "../../rules.json";
import type { Design, Finding, RuleResult, RuleRef, Status, Space, Run, RunPoint } from "./types";
import { pairKey, isCable } from "./types";
import { RUN_INFO, runSegments, runZ, spacesCrossed, watertightCrossings, runClearance, connectedGroups, terminalEngineRooms, runsOf, cables as cablesOf, inRect } from "./systems";
import { rectOf, sharedEdges, disjointRoutes, CIRCULATION, GROUPABLE, OUTSIDE, type Graph } from "./topology";
import type { EvacResult } from "./evacuation";
import { FS_MAX } from "./evacuation";
import type { FloodResult } from "./flooding";
import type { GZResult } from "./stability";
import { gzAt } from "./stability";
import type { Condition } from "./vessel";
import type { Ship } from "../vendor/vessel/vessel.module.js";
import { halfBreadthAt, spaceDeckIds, boundedWaterline, grownCondition, sortedDecks } from "./vessel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RULES: any = rulesJson;
const RATING_MIN: Record<string, number> = RULES.fire_rating_scale;

export function ruleDef(id: string) {
  return RULES.rules.find((r: { id: string }) => r.id === id);
}

export interface RuleContext {
  design: Design;
  ship: Ship;
  graph: Graph;
  condition: Condition | null;
  evac: EvacResult | null;
  flood: FloodResult | null;
  gz: GZResult | null;
}

const ORDER: Status[] = ["grey", "green", "amber", "red"];
export function worst(a: Status, b: Status): Status {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

function result(id: string, findings: Finding[], summary: string, statusOverride?: Status): RuleResult {
  const d = ruleDef(id);
  const src = RULES.sources.find((s: { id: string }) => d.source.includes(s.id));
  const status = statusOverride ?? (findings.length ? findings.map((f) => f.status).reduce(worst, "green") : "green");
  return {
    ruleId: id,
    title: d.title,
    status,
    summary,
    plainMeaning: d.plain_meaning,
    source: d.source,
    sourceName: src?.name ?? d.source,
    clause: d.clause,
    assumed: d.status === "assumed",
    assumptionNote: d.assumption_note,
    findings,
    refs: ruleRefs(id),
  };
}

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const m1 = (v: number) => `${fmt(v)} m`;

// ------------------------------------------------------------------ FIRE-ZONE-SIZE
export function fireZoneSize(ctx: RuleContext): RuleResult {
  const v = ruleDef("FIRE-ZONE-SIZE").values;
  const { design, ship } = ctx;
  const fzB = design.bulkheads.filter((b) => b.kind === "fire_zone").sort((a, b) => a.x - b.x);
  const fz = fzB.map((b) => b.x);
  const LOA = design.hull.LOA;
  if (!fz.length)
    return result("FIRE-ZONE-SIZE", [], `No fire zone bulkheads yet. The ship is ${m1(LOA)} long, so it needs at least ${Math.max(1, Math.ceil(LOA / v.max_mean_length_m) - 1)} to keep each zone under ${v.max_mean_length_m} m.`, "grey");
  // zone i lies between fz[i-1] and fz[i]; measure it on every deck and keep the worst deck
  const zones = fz.length + 1;
  const worstPerZone: { len: number; w: number; deck: string; a: number; b: number }[] = Array.from({ length: zones }, () => ({ len: 0, w: 0, deck: "", a: 0, b: 0 }));
  for (const deck of design.decks) {
    const xs: number[] = [];
    for (let i = 0; i <= 240; i++) {
      const x = (LOA * i) / 240;
      if (halfBreadthAt(ship, x, deck.z + 0.01) > 0.05) xs.push(x);
    }
    if (!xs.length) continue;
    const x0 = xs[0],
      x1 = xs[xs.length - 1];
    const bounds = [-Infinity, ...fz, Infinity];
    for (let i = 0; i < zones; i++) {
      const a = Math.max(bounds[i], x0),
        b = Math.min(bounds[i + 1], x1);
      if (b <= a) continue;
      const len = b - a;
      const meanW = (boundedWaterline(ship, deck.z + 0.01, a, b).Awp || 0) / len;
      const z = worstPerZone[i];
      if (Math.max(len, meanW) > Math.max(z.len, z.w)) worstPerZone[i] = { len, w: meanW, deck: deck.name, a, b };
    }
  }
  const findings: Finding[] = [];
  let worstDim = 0;
  worstPerZone.forEach((z, i) => {
    const dim = Math.max(z.len, z.w);
    worstDim = Math.max(worstDim, dim);
    const what = z.len >= z.w ? "long" : "wide";
    const status: Status = dim > v.max_mean_length_m ? "red" : dim > v.amber_above_m ? "amber" : "green";
    if (status === "green") return;
    const bhIds = fzB.filter((bh) => Math.abs(bh.x - z.a) < 0.01 || Math.abs(bh.x - z.b) < 0.01).map((bh) => bh.id);
    findings.push({
      status,
      message:
        status === "red"
          ? `Fire zone ${i + 1} (x ${fmt(z.a, 0)} to ${fmt(z.b, 0)} m) is ${m1(dim)} ${what}, more than the ${v.max_mean_length_m} m limit.`
          : `Fire zone ${i + 1} (x ${fmt(z.a, 0)} to ${fmt(z.b, 0)} m) is ${m1(dim)} ${what}, close to the ${v.max_mean_length_m} m limit.`,
      detail: `Fire zone bulkheads split the ship into main vertical zones that keep a fire contained. On any deck a zone's mean length and mean width should not exceed ${v.max_mean_length_m} m. Largest value found on ${z.deck}, measured inside the hull outline. Amber starts above ${v.amber_above_m} m.`,
      fix: status === "red" ? `Add a fire zone bulkhead inside this zone, or move its bulkheads closer together.` : `No action needed now, but moving a bulkhead 2 to 4 m would give margin for later changes.`,
      targets: bhIds,
      measured: m1(dim),
      limit: `${v.max_mean_length_m} m`,
    });
  });
  return result("FIRE-ZONE-SIZE", findings, `${zones} fire zones. Largest zone dimension ${m1(worstDim)} (limit ${v.max_mean_length_m} m).`);
}

// ------------------------------------------------------------------ FIRE-WALL-RATING
export function requiredMinutes(a: Space, b: Space): number {
  const table: { pair: string[]; min: number }[] = ruleDef("FIRE-WALL-RATING").values.minimum_minutes_by_room_pair;
  let req = 0;
  for (const row of table) {
    const [p, q] = row.pair;
    if ((p === a.type && (q === b.type || q === "any")) || (p === b.type && (q === a.type || q === "any"))) req = Math.max(req, row.min);
  }
  return req;
}

const typeName = (t: string) => t.replace(/_/g, " ");

export function fireWallRating(ctx: RuleContext): RuleResult {
  const { design } = ctx;
  const byId = new Map(design.spaces.map((s) => [s.id, s]));
  const findings: Finding[] = [];
  const fzMin = ruleDef("FIRE-WALL-RATING").values.minimum_minutes_by_room_pair.find((r: { pair: string[] }) => r.pair[0] === "fire_zone_boundary")?.min ?? 60;
  const fz = design.bulkheads.filter((b) => b.kind === "fire_zone");
  let checked = 0;
  for (const e of sharedEdges(design)) {
    const A = byId.get(e.a)!,
      B = byId.get(e.b)!;
    let req = requiredMinutes(A, B);
    const onZone = fz.find((b) => e.x0 === e.x1 && Math.abs(e.x0 - b.x) < 0.05);
    if (onZone) req = Math.max(req, fzMin);
    if (req === 0) continue;
    checked++;
    const rating = design.divisions[pairKey(A.id, B.id)] ?? "A-0";
    if (RATING_MIN[rating] < req)
      findings.push({
        status: "red",
        message: `The wall between ${A.name} and ${B.name} is ${rating} but must be at least A-${req}.`,
        detail: onZone
          ? `This wall lies on the fire zone bulkhead at x ${fmt(onZone.x)} m. Zone boundaries must hold back fire for ${fzMin} minutes.`
          : `A wall between a ${typeName(A.type)} and a ${typeName(B.type)} must keep the far side cool for ${req} minutes (rating A-${req}). Current rating ${rating} gives ${RATING_MIN[rating]} minutes.`,
        fix: `Select ${A.name}, then set this wall to A-${req} under "Walls and fire rating" (or press "Set all to minimum").`,
        targets: [A.id, B.id],
        measured: rating,
        limit: `A-${req}`,
      });
  }
  for (const b of fz) {
    if (RATING_MIN[b.rating] < fzMin)
      findings.push({
        status: "red",
        message: `The fire zone bulkhead at x ${fmt(b.x)} m is ${b.rating} but must be A-${fzMin}.`,
        detail: `Main vertical zone boundaries must hold back fire for ${fzMin} minutes on every deck.`,
        fix: `Select the bulkhead and set its rating to A-${fzMin}.`,
        targets: [b.id],
        measured: b.rating,
        limit: `A-${fzMin}`,
      });
    for (const s of design.spaces) {
      const r = rectOf(s);
      if (r.x0 < b.x - 0.05 && r.x1 > b.x + 0.05)
        findings.push({
          status: "red",
          message: `${s.name} crosses the fire zone bulkhead at x ${fmt(b.x)} m.`,
          detail: `A space cannot lie in two fire zones: the bulkhead would have an opening as large as the space. ${s.name} runs from x ${fmt(r.x0)} to ${fmt(r.x1)} m.`,
          fix: `Move or shorten ${s.name} so it ends at x ${fmt(b.x)} m, or split it into two spaces joined by a door.`,
          targets: [s.id, b.id],
        });
    }
  }
  if (!checked && !fz.length) return result("FIRE-WALL-RATING", findings, "Place rooms side by side to check the walls between them.", findings.length ? undefined : "grey");
  return result("FIRE-WALL-RATING", findings, findings.length ? `${plural(findings.length, "fire rating problem")} (${checked} walls need a rating).` : `All ${checked} walls that need a fire rating have one.`);
}

// ------------------------------------------------------------------ ESCAPE-TWO-EXITS
export function escapeTwoExits(ctx: RuleContext): RuleResult {
  const v = ruleDef("ESCAPE-TWO-EXITS").values;
  const { design, graph: g } = ctx;
  const findings: Finding[] = [];
  if (!design.spaces.some((s) => s.type === "stairwell")) return result("ESCAPE-TWO-EXITS", [], "Place a stairwell and doors to start checking escape routes.", "grey");
  const musterDecks = new Set(design.spaces.filter((s) => s.type === "muster_station").map((s) => s.deckId));
  const isTarget = (s: Space) => s.type === "stairwell" || s.type === "muster_station";
  const skip = new Set(["stairwell", "lift", "muster_station", "tank", "void"]);
  const groupOf = new Map<string, string>();
  let checked = 0;
  for (const s of design.spaces) {
    if (skip.has(s.type)) continue;
    const cs = g.bySpace.get(s.id) ?? [];
    if (!cs.length) {
      findings.push({
        status: "red",
        message: `${s.name} has no door.`,
        detail: `Without a door nobody can leave this space, so it has no escape route at all.`,
        fix: `Use the Door tool on a wall it shares with a corridor, or select it and press "Auto doors".`,
        targets: [s.id],
      });
      continue;
    }
    if (GROUPABLE.includes(s.type)) {
      const others = new Set(cs.map((c) => (c.a === s.id ? c.b : c.a)));
      const [only] = [...others];
      const os = others.size === 1 ? g.space.get(only) : undefined;
      if (os && CIRCULATION.includes(os.type)) {
        groupOf.set(s.id, only);
        continue;
      }
    }
    groupOf.set(s.id, s.id);
  }
  for (const id of new Set(groupOf.values())) {
    const s = g.space.get(id)!;
    if (skip.has(s.type)) continue;
    checked++;
    const members = [...groupOf.entries()].filter(([, o]) => o === id).map(([m]) => m);
    const label = members.length > 1 ? `${s.name} (and the ${members.length - 1} rooms that open onto it)` : s.name;
    const r = disjointRoutes(g, id, isTarget);
    if (r.count < v.min_separate_routes) {
      findings.push(
        r.count === 0
          ? {
              status: "red",
              message: `${label} has no escape route.`,
              detail: `Following doors and corridors from here never reaches a stairwell or an assembly station. Lifts do not count as escape routes.`,
              fix: `Connect it to a corridor that leads to a stairwell, or add a stairwell next to it.`,
              targets: members,
              measured: "0 routes",
              limit: `${v.min_separate_routes}`,
            }
          : {
              status: "red",
              message: `${label} has only one way out.`,
              detail: `Regulation 13 needs at least ${v.min_separate_routes} escape routes that share no door and no space, so that one fire cannot block both. Every route from here passes through the same door or space.`,
              fix: s.type === "corridor" ? `Connect the other end of ${s.name} to a second stairwell or corridor.` : `Add a second door to a different corridor or stairwell, as far from the first door as possible.`,
              targets: members,
              measured: "1 route",
              limit: `${v.min_separate_routes}`,
            },
      );
      continue;
    }
    if (v.one_route_must_reach_enclosed_stairway && !r.reachesStair && !musterDecks.has(s.deckId))
      findings.push({
        status: "red",
        message: `${label} has no route to an enclosed stairway.`,
        detail: `${v.one_route_must_reach_enclosed_stairway_clause}: at least one escape route must be an enclosed stairway leading up to the embarkation deck. The routes from here only reach assembly stations on the same deck through other spaces.`,
        fix: `Add a door from ${s.name} into a stairwell, or place a stairwell next to it.`,
        targets: members,
      });
    if (r.firstConns.length >= 2) {
      let maxSep = 0;
      for (let i = 0; i < r.firstConns.length; i++)
        for (let j = i + 1; j < r.firstConns.length; j++) maxSep = Math.max(maxSep, Math.hypot(r.firstConns[i].x - r.firstConns[j].x, r.firstConns[i].y - r.firstConns[j].y));
      if (maxSep < v.min_distance_between_exits_m)
        findings.push({
          status: "amber",
          message: `The two exits of ${label} are only ${m1(maxSep)} apart.`,
          detail: `Escape routes must be "widely separated" so one fire cannot block both. Regulation 13 gives no number; we use ${v.min_distance_between_exits_m} m as a working value.`,
          fix: `Move one of the doors further from the other, ideally to the opposite end of the space.`,
          targets: [...members, ...r.firstConns.map((c) => c.id)],
          measured: m1(maxSep),
          limit: `${v.min_distance_between_exits_m} m`,
        });
    }
  }
  // Dead-end corridors (Reg 13 3.3.4)
  for (const c of design.spaces.filter((s) => s.type === "corridor")) {
    const alongX = c.length >= c.breadth;
    const r = rectOf(c);
    const lo = alongX ? r.x0 : r.y0,
      hi = alongX ? r.x1 : r.y1;
    const through = (g.bySpace.get(c.id) ?? []).filter((k) => {
      const other = k.a === c.id ? k.b : k.a;
      if (other === OUTSIDE) return false;
      const os = g.space.get(other);
      if (!os || os.type === "lift") return false;
      if (GROUPABLE.includes(os.type) && new Set((g.bySpace.get(os.id) ?? []).map((x) => (x.a === os.id ? x.b : x.a))).size <= 1) return false;
      return true;
    });
    const pos = through.map((k) => (alongX ? k.x : k.y)).sort((a, b) => a - b);
    const deadLo = pos.length ? pos[0] - lo : hi - lo;
    const deadHi = pos.length ? hi - pos[pos.length - 1] : 0;
    const dead = Math.max(deadLo, deadHi);
    if (dead > v.dead_end_corridor_max_m) {
      const end = !pos.length ? "" : deadLo >= deadHi ? (alongX ? " at its aft end" : " at its starboard end") : alongX ? " at its forward end" : " at its port end";
      findings.push({
        status: "red",
        message: `${c.name} has a ${m1(dead)} dead end${end}.`,
        detail: `A dead end is the part of a corridor beyond the last exit, where people walking the wrong way get trapped. ${v.dead_end_corridor_clause} does not accept dead ends longer than ${v.dead_end_corridor_max_m} m.`,
        fix: `Shorten the corridor, or add a stairwell or a link to another corridor within ${v.dead_end_corridor_max_m} m of the end.`,
        targets: [c.id],
        measured: m1(dead),
        limit: `${v.dead_end_corridor_max_m} m`,
      });
    }
  }
  return result("ESCAPE-TWO-EXITS", findings, findings.length ? `${plural(findings.length, "escape problem")} across ${checked} spaces or groups of rooms.` : `All ${checked} spaces or groups of rooms have two separate ways out.`);
}

// ------------------------------------------------------------------ ESCAPE-STAIR-WIDTH
export function escapeStairWidth(ctx: RuleContext): RuleResult {
  const v = ruleDef("ESCAPE-STAIR-WIDTH").values;
  const { design, evac } = ctx;
  const stairs = design.spaces.filter((s) => s.type === "stairwell");
  if (!stairs.length) return result("ESCAPE-STAIR-WIDTH", [], "Place a stairwell to check its width and layout.", "grey");
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  const findings: Finding[] = [];
  for (const s of stairs) {
    const st = s.stair ?? { widthMm: 1000, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 1 };
    const served =
      evac?.stairs.find((x) => x.stairId === s.id)?.persons ??
      (() => {
        const decks = spaceDeckIds(design, s);
        return design.spaces.filter((o) => decks.includes(o.deckId) && o.type !== "stairwell").reduce((n, o) => n + o.persons, 0);
      })();
    if (st.widthMm < v.use_for_red)
      findings.push({
        status: "red",
        message: `${s.name} is ${st.widthMm} mm wide; escape stairs must be at least ${v.min_width_mm_uscg_fss} mm.`,
        detail:
          st.widthMm >= v.min_width_mm_reg13
            ? `The FSS Code (chapter 13.2.1.1, required by SOLAS II-2/13) sets ${v.min_width_mm_uscg_fss} mm clear width between handrails. ${v.min_width_mm_reg13} mm is only accepted for the single escape route of a space that has a dispensation under Regulation 13 3.2.1.2.`
            : `The FSS Code (chapter 13.2.1.1, required by SOLAS II-2/13) sets ${v.min_width_mm_uscg_fss} mm clear width between handrails. Even the dispensation case of Regulation 13 needs ${v.min_width_mm_reg13} mm.`,
        fix: `Select ${s.name} and set its clear width to ${v.min_width_mm_uscg_fss} mm or more.`,
        targets: [s.id],
        measured: `${st.widthMm} mm`,
        limit: `${v.min_width_mm_uscg_fss} mm`,
      });
    if (served > v.persons_needing_fore_aft_alignment && st.orientation !== "fore-aft")
      findings.push({
        status: "red",
        message: `${s.name} serves ${served} persons but runs across the ship.`,
        detail: `FSS Code 13.2.2.2: stairs sized for more than ${v.persons_needing_fore_aft_alignment} persons must run fore and aft, with no curved stairs or steps on landings, so they stay usable when the ship rolls.`,
        fix: `Set the stair direction to "Fore and aft" in the inspector.`,
        targets: [s.id],
        measured: `${served} persons`,
        limit: `${v.persons_needing_fore_aft_alignment}`,
      });
    const ids = spaceDeckIds(design, s);
    const deckName = (id: string) => design.decks.find((d) => d.id === id)?.name ?? id;
    let maxFlightRise = 0;
    for (let i = 0; i < ids.length - 1; i++) {
      const rise = ((deckZ.get(ids[i + 1]) ?? 0) - (deckZ.get(ids[i]) ?? 0)) / Math.max(1, st.flightsPerDeck);
      maxFlightRise = Math.max(maxFlightRise, rise);
      if (rise > v.max_rise_without_landing_m)
        findings.push({
          status: "red",
          message: `A flight in ${s.name} climbs ${fmt(rise, 2)} m without a landing.`,
          detail: `FSS Code 13.2.2.3: a flight may rise at most ${v.max_rise_without_landing_m} m before a landing, at no more than ${v.max_inclination_deg} degrees.`,
          fix: `Increase "Flights per deck" to ${Math.ceil((rise * st.flightsPerDeck) / v.max_rise_without_landing_m)} so each flight has a landing.`,
          targets: [s.id],
          measured: `${fmt(rise, 2)} m`,
          limit: `${v.max_rise_without_landing_m} m`,
        });
    }
    if (ids.length < 2)
      findings.push({
        status: "amber",
        message: `${s.name} only spans one deck.`,
        detail: `A stairwell that does not reach another deck cannot be used to escape upwards to the embarkation deck.`,
        fix: `Select it and set its top deck.`,
        targets: [s.id],
      });
    if (v.stair_must_fit_in_stairwell) {
      // The stair flights must physically fit inside the stairwell box.
      const foreAft = st.orientation === "fore-aft";
      const along = foreAft ? s.length : s.breadth;
      const across = foreAft ? s.breadth : s.length;
      const lanes = st.flightsPerDeck > 1 ? 2 : 1; // two or more flights fold back side by side
      const needAcross = (lanes * st.widthMm) / 1000;
      const needAlong = maxFlightRise / Math.tan((v.max_inclination_deg * Math.PI) / 180);
      if (needAlong > along + 0.01)
        findings.push({
          status: "red",
          message: `${s.name} is too short for its height: each flight climbs ${fmt(maxFlightRise, 2)} m but the stairwell is only ${m1(along)} long.`,
          detail: `FSS Code 13.2.2.3: a flight may be at most ${v.max_inclination_deg} degrees steep. At that slope a flight that climbs ${fmt(maxFlightRise, 2)} m needs at least ${fmt(needAlong, 2)} m of length ${foreAft ? "fore and aft" : "across the ship"}. A shorter stairwell means a stair steeper than allowed.`,
          fix: `Make ${s.name} at least ${fmt(Math.ceil(needAlong * 10) / 10, 1)} m ${foreAft ? "long (Length)" : "wide (Breadth)"}${st.flightsPerDeck === 1 ? `, or set "Flights per deck" to 2 so each flight climbs half the height` : ""}.`,
          targets: [s.id],
          measured: m1(along),
          limit: `${fmt(needAlong, 2)} m`,
        });
      if (needAcross > across + 0.01)
        findings.push({
          status: "red",
          message: `${s.name}'s ${st.widthMm} mm clear width does not fit: ${lanes === 2 ? `its flights sit side by side and need ${m1(needAcross)}` : `it needs ${m1(needAcross)}`}, but the stairwell is only ${m1(across)} ${foreAft ? "wide" : "long"}.`,
          detail: `The clear width is the free space between handrails on each flight. ${lanes === 2 ? `With ${st.flightsPerDeck} flights per deck the flights fold back and run next to each other, so the stairwell must hold two of them.` : "The stairwell must be at least as wide as the flight."} Otherwise the width used in the width and evacuation checks is not real.`,
          fix: `Make ${s.name} at least ${fmt(Math.ceil(needAcross * 10) / 10, 1)} m ${foreAft ? "wide (Breadth)" : "long (Length)"}, or lower its clear width.`,
          targets: [s.id],
          measured: m1(across),
          limit: m1(needAcross),
        });
    }
    if (v.stair_needs_door_at_top_and_bottom && ids.length >= 2) {
      // A stair that ends on a deck without a door leads nowhere there.
      const conns = ctx.graph.bySpace.get(s.id) ?? [];
      const ends = [ids[0], ids[ids.length - 1]];
      for (const dId of ends) {
        if (conns.some((c) => c.deckId === dId)) continue;
        const withDoor = ids.filter((x) => conns.some((c) => c.deckId === x));
        const isTop = dId === ids[ids.length - 1];
        findings.push({
          status: "amber",
          message: `${s.name} goes ${isTop ? "up" : "down"} to ${deckName(dId)} but has no door there.`,
          detail: `Nobody can get on or off the stair on ${deckName(dId)}, so that part of the stair is useless for escape.${withDoor.length ? ` It has doors on ${withDoor.map(deckName).join(", ")}.` : " It has no door on any deck."}`,
          fix: withDoor.length
            ? `Add a door on ${deckName(dId)} between ${s.name} and a corridor, or set its ${isTop ? '"Top deck"' : '"Deck" (bottom deck)'} to ${deckName(isTop ? withDoor[withDoor.length - 1] : withDoor[0])}.`
            : `Add doors between ${s.name} and a corridor on each deck it serves (select it and press "Auto doors").`,
          targets: [s.id],
        });
      }
    }
    if (v.door_to_stair_at_least_stair_width) {
      // REG13 guidance G5.1: doorways serving a stairway should be at least as wide as the stair.
      const narrow = (ctx.graph.bySpace.get(s.id) ?? []).filter((c) => !c.virtual && c.b !== OUTSIDE && c.a !== OUTSIDE && c.widthMm < st.widthMm);
      if (narrow.length) {
        const widths = [...new Set(narrow.map((c) => c.widthMm))].sort((a, b) => a - b);
        const decks = [...new Set(narrow.map((c) => deckName(c.deckId)))];
        findings.push({
          status: "amber",
          message: `${plural(narrow.length, "emergency door")} into ${s.name} ${narrow.length === 1 ? "is" : "are"} ${widths.join(" or ")} mm wide, narrower than the ${st.widthMm} mm stair.`,
          detail: `${v.door_to_stair_clause}. A narrow door in front of a wide stair becomes the bottleneck, so the stair cannot be used at its full width. On ${decks.join(", ")}.`,
          fix: `Select each door into ${s.name} and set its clear width to ${st.widthMm} mm, or reduce the stair's clear width (not below ${v.min_width_mm_uscg_fss} mm).`,
          targets: [s.id, ...narrow.map((c) => c.id)],
          measured: `${widths[0]} mm`,
          limit: `${st.widthMm} mm`,
        });
      }
    }
    if (v.handrails_both_sides && !st.handrailsBothSides)
      findings.push({
        status: "red",
        message: `${s.name} has a handrail on one side only.`,
        detail: `Escape stairs need handrails on both sides.`,
        fix: `Tick "Handrails both sides" in the inspector.`,
        targets: [s.id],
      });
  }
  return result("ESCAPE-STAIR-WIDTH", findings, findings.length ? `${plural(findings.length, "problem")} in ${plural(stairs.length, "stairwell")}.` : `All ${plural(stairs.length, "stairwell")} are wide enough and laid out correctly.`);
}

// ------------------------------------------------------------------ EVACUATION-TIME
export function evacuationTime(ctx: RuleContext): RuleResult {
  const v = ruleDef("EVACUATION-TIME").values;
  const { design, evac } = ctx;
  const pax = design.people.passengers;
  if (pax <= v.applies_if_passengers_over) return result("EVACUATION-TIME", [], `Not required: ${pax} passengers (applies above ${v.applies_if_passengers_over}).`, "grey");
  if (!evac || !evac.ok) return result("EVACUATION-TIME", [], evac?.reason ?? "Not enough built yet.", "grey");
  const findings: Finding[] = [];
  const min = (s: number) => `${fmt(s / 60)} min`;
  const name = (id: string) => design.spaces.find((x) => x.id === id)?.name ?? id;
  for (const id of evac.unreachable) {
    const s = design.spaces.find((x) => x.id === id);
    findings.push({
      status: "red",
      message: `Nobody in ${s?.name ?? id} can reach an assembly station.`,
      detail: `${s?.persons ?? 0} persons are placed here, but no chain of doors, corridors and stairs leads to an assembly station.`,
      fix: `Connect it to a corridor and stairwell that lead up to the assembly station deck.`,
      targets: [id],
    });
  }
  for (const c of evac.congestion) {
    if (c.kind === "stair" && c.stairId) {
      const st = design.spaces.find((x) => x.id === c.stairId);
      const up = evac.stairs.find((x) => x.stairId === c.stairId)?.up;
      findings.push({
        status: "amber",
        message: `Queue at ${name(c.stairId)}: people arrive at ${fmt(c.FcIn!, 1)} persons/s but the stair passes only ${fmt(c.FcOut!, 1)} persons/s.`,
        detail: `Circ.1533 marks a congestion point where inflow exceeds outflow by more than ${v.congestion_flow_difference_p_per_s} persons/s. A stair going ${up ? "up" : "down"} passes at most ${up ? FS_MAX.stairUp : FS_MAX.stairDown} persons per metre of width per second; ${name(c.stairId)} is ${st?.stair?.widthMm ?? "?"} mm wide.`,
        fix: `Widen ${name(c.stairId)}, or add another stairwell nearby so fewer people use it.`,
        targets: c.where,
      });
    } else {
      findings.push({
        status: "amber",
        message: `Crowding at the start: ${fmt(c.density ?? 0, 2)} persons/m2 in ${name(c.where[0])}.`,
        detail: `At ${v.congestion_density_p_per_m2} persons/m2 or more people can barely move (Circ.1533 congestion criterion).`,
        fix: `Widen the corridor or reduce the number of persons in the rooms that open onto it.`,
        targets: c.where,
      });
    }
  }
  const ratio = evac.total / evac.limit;
  const status: Status = ratio > 1 ? "red" : ratio * 100 > v.amber_above_percent_of_limit ? "amber" : "green";
  if (status !== "green") {
    const w = [...evac.routes].sort((a, b) => b.tI - a.tI)[0];
    findings.push({
      status,
      message: status === "red" ? `Evacuation takes ${min(evac.total)}, more than the ${min(evac.limit)} allowed.` : `Evacuation takes ${min(evac.total)}, close to the ${min(evac.limit)} limit.`,
      detail: `Total = 1.25 x (response ${min(evac.R)} + travel ${min(evac.T)}) + 2/3 x (embarkation and launching ${min(evac.EL)}). The slowest route is ${w ? `${w.persons} persons from ${design.decks.find((d) => d.id === w.deckId)?.name} via ${w.stairId ? name(w.stairId) : "the deck"} (${fmt(w.tI, 0)} s ideal travel)` : "-"}.`,
      fix: `Speed up the slowest route: widen its stair, add a stairwell closer to the occupants, or move the assembly station nearer.`,
      targets: w ? [...w.spaces, ...(w.stairId ? [w.stairId] : [])] : [],
      measured: min(evac.total),
      limit: min(evac.limit),
    });
  }
  return result("EVACUATION-TIME", findings, `Full evacuation (alarm, walking to the assembly stations, boarding and launching) takes ${min(evac.total)}; the limit is ${min(evac.limit)} with ${plural(evac.mvz, "fire zone")}.`);
}

// ------------------------------------------------------------------ FLOOD-SURVIVAL
export function floodSurvival(ctx: RuleContext): RuleResult {
  const v = ruleDef("FLOOD-SURVIVAL").values;
  const { flood } = ctx;
  if (!flood || !flood.ok) return result("FLOOD-SURVIVAL", [], flood?.reason ?? "Place watertight bulkheads to start this check.", "grey");
  const status: Status = flood.A < flood.R ? "red" : flood.A < flood.R * (1 + v.amber_if_A_within_percent_of_R / 100) ? "amber" : "green";
  const findings: Finding[] = [];
  if (status !== "green")
    findings.push({
      status,
      message: status === "red" ? `Survival index A = ${fmt(flood.A, 3)} is below the required R = ${fmt(flood.R, 3)}.` : `Survival index A = ${fmt(flood.A, 3)} is only just above the required R = ${fmt(flood.R, 3)}.`,
      detail: `A adds up, over all damage cases, how likely each damage is times whether the ship survives it. R grows with the persons on board (N = ${flood.N}). Simplified estimate, not the full SOLAS calculation.`,
      fix: `Make the failing damage cases below survive: add watertight bulkheads in long compartments, or raise the bulkhead deck.`,
      targets: [],
    });
  for (const c of flood.cases) {
    if (c.survives) continue;
    const where = c.compartments.length > 1 ? `compartments ${c.compartments.join(" and ")}` : `compartment ${c.compartments[0]}`;
    const why = c.reason.startsWith("Sinks")
      ? `There is not enough buoyancy above the waterline: the water would rise past the bulkhead deck (${m1(flood.bulkheadDeckZ)}) before the ship floats again.`
      : c.reason.startsWith("Capsizes")
        ? `After flooding the metacentric height is ${fmt(c.GMd ?? 0, 2)} m, so the ship has no stability left and capsizes.`
        : `The ship floats, but it trims so much that the bulkhead deck (${m1(flood.bulkheadDeckZ)}) goes under water at the ${(c.draftAft ?? 0) > (c.draftFwd ?? 0) ? `stern (draft aft ${m1(c.draftAft ?? 0)})` : `bow (draft forward ${m1(c.draftFwd ?? 0)})`}.`;
    findings.push({
      status: status === "green" ? "amber" : "red",
      message: `The ship is lost if ${where} flood (x ${fmt(c.xAft, 0)} to ${fmt(c.xFwd, 0)} m).`,
      detail: why,
      fix: `Add a watertight bulkhead between x ${fmt(c.xAft, 0)} and ${fmt(c.xFwd, 0)} m to make the flooded volume smaller.`,
      targets: c.compartments,
    });
  }
  return result("FLOOD-SURVIVAL", findings, `Simplified estimate: A = ${fmt(flood.A, 3)} against required R = ${fmt(flood.R, 3)}. ${flood.cases.filter((c) => c.survives).length} of ${flood.cases.length} damage cases survive.`, status);
}

// ------------------------------------------------------------------ INTACT-STABILITY
const CRITERIA_TEXT: Record<string, string> = {
  area0_30: "The area under the GZ curve is the energy the ship can absorb from wind and waves before heeling to 30 degrees.",
  area0_40: "The same energy measure up to 40 degrees.",
  area30_40: "Energy between 30 and 40 degrees: the ship must keep righting itself at large angles.",
  gz30: "The righting lever at 30 degrees or more shows the ship still pushes back hard at large heel.",
  angleMax: "The GZ curve should peak late, at 25 degrees or more, so the ship does not lose stability early.",
  gm: "Initial GM is the stiffness at small angles (slack-tank free-surface correction included).",
};

export function intactStability(ctx: RuleContext): RuleResult {
  const v = ruleDef("INTACT-STABILITY").values;
  const { gz, condition } = ctx;
  if (!gz || !condition) return result("INTACT-STABILITY", [], "Hull or loading condition not ready.", "grey");
  if (condition.overloaded)
    return result(
      "INTACT-STABILITY",
      [
        {
          status: "red",
          message: `The ship is heavier than its hull can carry.`,
          detail: `Displacement ${fmt(condition.weights.total.massT, 0)} t is more than the hull holds up to the moulded depth.`,
          fix: `Reduce weight (deadweight, tank fillings, lightship) or make the hull larger in the Design tab.`,
          targets: [],
        },
      ],
      "Overloaded.",
    );
  const gz30 = Math.max(...gz.points.filter((p) => p.deg >= 30).map((p) => p.gz), gzAt(gz, 30));
  const checks: [string, string, number, number, string][] = [
    ["area0_30", "Area under the GZ curve from 0 to 30 degrees", gz.area0_30, v.min_area_0_30_m_rad, "m.rad"],
    ["area0_40", "Area under the GZ curve from 0 to 40 degrees", gz.area0_40, v.min_area_0_40_m_rad, "m.rad"],
    ["area30_40", "Area under the GZ curve from 30 to 40 degrees", gz.area30_40, v.min_area_30_40_m_rad, "m.rad"],
    ["gz30", "Righting lever GZ at 30 degrees or more", gz30, v.min_gz_at_30_deg_or_more_m, "m"],
    ["angleMax", "Angle of maximum GZ", gz.angleMaxGZ, v.min_angle_of_max_gz_deg, "deg"],
    ["gm", "Initial metacentric height GM", condition.GMt, v.min_initial_gm_m, "m"],
  ];
  const findings: Finding[] = [];
  for (const [key, name, val, lim, unit] of checks) {
    const status: Status = val < lim ? "red" : val < lim * (1 + v.amber_within_percent / 100) ? "amber" : "green";
    if (status === "green") continue;
    findings.push({
      status,
      message: status === "red" ? `${name} is ${fmt(val, 3)} ${unit}, below the minimum of ${lim} ${unit}.` : `${name} is ${fmt(val, 3)} ${unit}, just above the minimum of ${lim} ${unit}.`,
      detail: CRITERIA_TEXT[key],
      fix: key === "angleMax" ? `Raise the freeboard (moulded depth) or reduce beam slightly so the deck edge goes under later.` : `Lower the centre of gravity: move heavy spaces and tanks lower, fill low ballast tanks, or reduce weight high up. Avoid slack tanks.`,
      targets: key === "gm" ? condition.freeSurface.map((f) => f.spaceId) : [],
      measured: `${fmt(val, 3)} ${unit}`,
      limit: `${lim} ${unit}`,
    });
  }
  return result("INTACT-STABILITY", findings, `GM ${fmt(condition.GMt, 2)} m, maximum GZ ${fmt(gz.maxGZ, 2)} m at ${gz.angleMaxGZ} degrees, stable up to ${fmt(gz.rangeDeg, 0)} degrees.`);
}

// ------------------------------------------------------------------ LSA-CAPACITY
export function lsaCapacity(ctx: RuleContext): RuleResult {
  const v = ruleDef("LSA-CAPACITY").values;
  const { design } = ctx;
  const lsa = design.lsa ?? [];
  const N = design.people.passengers + design.people.crew;
  if (!lsa.length) return result("LSA-CAPACITY", [], `Place lifeboats and liferafts to check survival craft capacity for ${N} persons.`, "grey");
  const findings: Finding[] = [];
  const port = lsa.filter((l) => l.kind === "lifeboat" && l.y >= 0).reduce((n, l) => n + l.capacity, 0);
  const stbd = lsa.filter((l) => l.kind === "lifeboat" && l.y < 0).reduce((n, l) => n + l.capacity, 0);
  const rafts = lsa.filter((l) => l.kind === "liferaft").reduce((n, l) => n + l.capacity, 0);
  const needSide = Math.ceil(N * v.lifeboats_each_side_min_share);
  const needRafts = Math.ceil(N * v.liferafts_min_share);
  for (const [side, cap, ids] of [
    ["port", port, lsa.filter((l) => l.kind === "lifeboat" && l.y >= 0).map((l) => l.id)],
    ["starboard", stbd, lsa.filter((l) => l.kind === "lifeboat" && l.y < 0).map((l) => l.id)],
  ] as const)
    if (cap < needSide)
      findings.push({
        status: "red",
        message: `Lifeboats on the ${side} side carry ${cap} persons; ${needSide} are needed.`,
        detail: `Lifeboats on each side must hold at least ${v.lifeboats_each_side_min_share * 100} % of everyone on board (${N} persons), so the ship can still be abandoned if it lists and one side cannot be used.`,
        fix: `Add a lifeboat on the ${side} side or use larger boats (select a boat to change its capacity).`,
        targets: [...ids],
        measured: `${cap}`,
        limit: `${needSide}`,
      });
  if (rafts < needRafts)
    findings.push({
      status: "red",
      message: `Liferafts carry ${rafts} persons; ${needRafts} are needed.`,
      detail: `On top of the lifeboats, liferafts must hold at least ${v.liferafts_min_share * 100} % of everyone on board.`,
      fix: `Place more liferafts with the Liferaft tool.`,
      targets: lsa.filter((l) => l.kind === "liferaft").map((l) => l.id),
      measured: `${rafts}`,
      limit: `${needRafts}`,
    });
  if (v.must_be_on_assembly_deck) {
    const musterDecks = new Set(design.spaces.filter((s) => s.type === "muster_station").map((s) => s.deckId));
    for (const l of lsa)
      if (!musterDecks.has(l.deckId))
        findings.push({
          status: "amber",
          message: `${l.kind === "lifeboat" ? "Lifeboat" : "Liferaft"} at x ${fmt(l.x, 0)} m is not on a deck with an assembly station.`,
          detail: `Survival craft should be boarded next to the assembly stations, so people do not have to climb stairs again after mustering.`,
          fix: `Move it to the embarkation deck (${design.decks.find((d) => musterDecks.has(d.id))?.name ?? "the deck with assembly stations"}).`,
          targets: [l.id],
        });
  }
  return result("LSA-CAPACITY", findings, `Lifeboats port ${port}, starboard ${stbd}, liferafts ${rafts} places for ${N} persons.`);
}

// ------------------------------------------------------------------ WEIGHT-MARGIN
export function weightMargin(ctx: RuleContext): RuleResult {
  const v = ruleDef("WEIGHT-MARGIN").values;
  const { condition, ship } = ctx;
  if (!condition || !ship) return result("WEIGHT-MARGIN", [], "Hull or loading condition not ready.", "grey");
  if (condition.overloaded) return result("WEIGHT-MARGIN", [], "The ship is already too heavy; fix that first (see the stability check).", "grey");
  const LS = condition.weights.lightship.massT;
  const dDesign = LS * v.design_build_margin_share_of_lightship;
  const dService = (LS + dDesign) * v.service_life_margin_share_of_lightship;
  const dW = dDesign + dService;
  const g = grownCondition(ship, condition, dW);
  const gmMin: number = ruleDef("INTACT-STABILITY").values.min_initial_gm_m;
  const pct = (100 * dW) / LS;
  const findings: Finding[] = [];
  const how = `Margin = ${fmt(v.design_build_margin_share_of_lightship * 100)} % of lightship for design and build (${fmt(dDesign, 0)} t) plus ${fmt(v.service_life_margin_share_of_lightship * 100)} % for growth in service (${fmt(dService, 0)} t), added at the lightship centre of gravity (KG ${m1(condition.weights.lightship.kg)}). Draft is solved again on the hull: the ship sinks ${fmt(g.sinkage * 100, 0)} cm.`;
  if (g.overloaded || g.freeboard < 0)
    findings.push({
      status: "red",
      message: `With the usual weight margin (${fmt(dW, 0)} t) the deck edge goes under water.`,
      detail: `${how} Freeboard would be ${fmt(g.freeboard, 2)} m. There is no room for the weight growth every ship sees.`,
      fix: `Reduce weight now, or give the hull more volume (deeper or wider in the Design tab).`,
      targets: [],
      measured: `${fmt(g.freeboard, 2)} m`,
      limit: `${v.min_freeboard_after_margin_m} m`,
    });
  else if (g.freeboard < v.min_freeboard_after_margin_m)
    findings.push({
      status: "amber",
      message: `With the usual weight margin (${fmt(dW, 0)} t) freeboard drops to ${fmt(g.freeboard, 2)} m.`,
      detail: `${how} Below ${v.min_freeboard_after_margin_m} m the deck edge is close to the water and the ship loses stability at small angles.`,
      fix: `Keep weight down or add depth to the hull so the freeboard stays above ${v.min_freeboard_after_margin_m} m after the margin.`,
      targets: [],
      measured: `${fmt(g.freeboard, 2)} m`,
      limit: `${v.min_freeboard_after_margin_m} m`,
    });
  if (!g.overloaded && g.GMt < gmMin)
    findings.push({
      status: "red",
      message: `With the usual weight margin GM drops to ${fmt(g.GMt, 2)} m, below the ${gmMin} m minimum.`,
      detail: `${how} The extra weight sits at the lightship height, so the centre of gravity moves from ${m1(condition.KG)} to ${m1(g.KG)}.`,
      fix: `Lower the centre of gravity (heavy rooms and tanks lower down) or widen the hull, so GM keeps a margin.`,
      targets: [],
      measured: `${fmt(g.GMt, 2)} m`,
      limit: `${gmMin} m`,
    });
  return result(
    "WEIGHT-MARGIN",
    findings,
    `With ${fmt(pct)} % extra lightship weight (${fmt(dW, 0)} t) the ship sinks ${fmt(g.sinkage * 100, 0)} cm: freeboard ${fmt(condition.freeboard, 2)} to ${fmt(g.freeboard, 2)} m, GM ${fmt(condition.GMt, 2)} to ${fmt(g.GMt, 2)} m.`,
  );
}

// ------------------------------------------------------------------ REFERENCE-SHIPS
export function referenceShips(ctx: RuleContext): RuleResult {
  const v = ruleDef("REFERENCE-SHIPS").values;
  const { design, evac } = ctx;
  const findings: Finding[] = [];
  // 1. Cabin floor area per person
  const cabins = design.spaces.filter((s) => s.type === "cabin" && s.persons > 0);
  const small = cabins.filter((s) => (s.length * s.breadth) / s.persons < v.min_cabin_area_per_person_m2 - 1e-6);
  if (small.length) {
    const worstC = small.reduce((a, b) => ((a.length * a.breadth) / a.persons <= (b.length * b.breadth) / b.persons ? a : b));
    const per = (worstC.length * worstC.breadth) / worstC.persons;
    findings.push({
      status: "amber",
      message: small.length === 1 ? `${worstC.name} gives each person only ${fmt(per)} m2.` : `${small.length} cabins give each person less than ${v.min_cabin_area_per_person_m2} m2 (smallest: ${worstC.name}, ${fmt(per)} m2).`,
      detail: `${worstC.name} is ${fmt(worstC.length * worstC.breadth)} m2 for ${worstC.persons} persons. On the reference ships the smallest cabins give ${v.min_cabin_area_per_person_m2} m2 per person (${v.cabin_area_note}). The persons number also drives the evacuation check, so check it is realistic.`,
      fix: `Lower "Persons" or make the cabin larger. Passenger cabins can be smaller than on research ships; confirm your own minimum.`,
      targets: small.map((s) => s.id),
      measured: `${fmt(per)} m2`,
      limit: `${v.min_cabin_area_per_person_m2} m2`,
    });
  }
  // 2. Height between neighbouring decks
  const decks = sortedDecks(design);
  for (let i = 0; i < decks.length - 1; i++) {
    const h = decks[i + 1].z - decks[i].z;
    if (h < v.min_deck_height_m - 1e-6)
      findings.push({
        status: "amber",
        message: `${decks[i].name} and ${decks[i + 1].name} are only ${fmt(h, 2)} m apart.`,
        detail: `This is the full height from deck to deck, before deck plating, beams, ducts and ceilings take their share. The reference ships use at least ${v.min_deck_height_m} m (${v.deck_height_note}).`,
        fix: `Raise ${decks[i + 1].name} (Design tab) so the decks are at least ${v.min_deck_height_m} m apart.`,
        targets: [],
        measured: `${fmt(h, 2)} m`,
        limit: `${v.min_deck_height_m} m`,
      });
  }
  // 3. Escape routes that pass through rooms
  if (evac?.ok) {
    const through = new Map<string, string[]>();
    for (const [from, r] of evac.assignments)
      for (const st of r.steps.slice(0, -1)) {
        const sp = design.spaces.find((x) => x.id === st.space);
        if (sp && sp.id !== from && v.rooms_not_passageways.includes(sp.type)) through.set(sp.id, [...(through.get(sp.id) ?? []), from]);
      }
    for (const [roomId, froms] of through) {
      const room = design.spaces.find((x) => x.id === roomId)!;
      const names = froms.map((id) => design.spaces.find((x) => x.id === id)?.name ?? id);
      findings.push({
        status: "amber",
        message: `The escape route from ${names.length === 1 ? names[0] : `${names.length} rooms`} leads through ${room.name}.`,
        detail: `${v.passageway_note}. A ${typeName(room.type)} can be locked, full of furniture or the place where the fire starts, so people should not have to cross it to escape.${names.length > 1 ? ` Rooms using it: ${names.slice(0, 4).join(", ")}${names.length > 4 ? " and more" : ""}.` : ""}`,
        fix: `Give ${names.length === 1 ? names[0] : "those rooms"} a door straight onto a corridor or stairwell, or turn ${room.name} into a corridor.`,
        targets: [roomId, ...froms],
      });
    }
  }
  return result(
    "REFERENCE-SHIPS",
    findings,
    findings.length ? `${plural(findings.length, "hint")} from comparing with three real research ships.` : `Cabin sizes, deck heights and escape routes look like those on the reference ships.`,
  );
}

// ------------------------------------------------------------------ pipes and cables
const deckNameOf = (design: Design, id: string) => design.decks.find((d) => d.id === id)?.name ?? id;
const names = (xs: string[], max = 3) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`);

// ------------------------------------------------------------------ PIPE-FIRE-MAIN
export function pipeFireMain(ctx: RuleContext): RuleResult {
  const v = ruleDef("PIPE-FIRE-MAIN").values;
  const { design } = ctx;
  const decks = sortedDecks(design);
  const excluded: string[] = v.served_room_types_excluded;
  const served = (deckId: string) => design.spaces.filter((s) => !excluded.includes(s.type) && spaceDeckIds(design, s).includes(deckId));
  if (!design.spaces.some((s) => !excluded.includes(s.type))) return result("PIPE-FIRE-MAIN", [], "No rooms yet, so no fire main is needed yet.", "grey");
  const mains = runsOf(design, (r) => r.kind === "fire_main");
  const findings: Finding[] = [];
  if (!mains.length) {
    findings.push({
      status: "red",
      message: "The ship has no fire main yet.",
      detail: "Without a fire main the hydrants and sprinklers get no water from the fire pumps.",
      fix: "Pick the Pipe tool (P) on the left, choose Fire main and draw it along the corridor of every deck with rooms, with a riser down to the engine room.",
      targets: [],
    });
    return result("PIPE-FIRE-MAIN", findings, "No fire main yet.");
  }
  // 1. every deck and fire zone with rooms has a fire main on that deck inside the zone
  const fz = design.bulkheads.filter((b) => b.kind === "fire_zone").map((b) => b.x).sort((a, b) => a - b);
  const edges = [-Infinity, ...fz, Infinity];
  const segs = mains.flatMap((r) => runSegments(design, r).filter((g) => !g.vertical).map((g) => ({ r, g })));
  for (const dk of decks) {
    const rooms = served(dk.id);
    if (!rooms.length) continue;
    const missing: { k: number; x0: number; x1: number }[] = [];
    for (let k = 0; k < edges.length - 1; k++) {
      const inZone = rooms.filter((s) => s.xCentre > edges[k] && s.xCentre < edges[k + 1]);
      if (!inZone.length) continue;
      const lo = Math.max(edges[k], Math.min(...inZone.map((s) => s.xCentre - s.length / 2)));
      const hi = Math.min(edges[k + 1], Math.max(...inZone.map((s) => s.xCentre + s.length / 2)));
      const covered = segs.some(({ g }) => g.deckId === dk.id && Math.min(Math.max(g.a.x, g.b.x), hi) - Math.max(Math.min(g.a.x, g.b.x), lo) > 0.5);
      if (!covered) missing.push({ k, x0: lo, x1: hi });
    }
    if (!missing.length) continue;
    const zoneTxt = missing.map((m) => `zone ${m.k + 1} (x ${fmt(m.x0, 0)} to ${fmt(m.x1, 0)} m)`);
    const m0 = missing[0];
    findings.push({
      status: "red",
      message: `${dk.name} has no fire main in fire ${missing.length === 1 ? "" : "zones "}${missing.length === 1 ? zoneTxt[0] : zoneTxt.join(", ")}.`,
      detail: `Rooms there have no hydrant water. The hydrants must still reach every part of the deck when all doors in the main vertical zone bulkheads are closed, so each zone needs the fire main on its own deck.`,
      fix: `Draw a fire main (Pipe tool, Fire main) along the corridor of ${dk.name} from x ${fmt(m0.x0, 0)} to ${fmt(m0.x1, 0)} m and let it touch the fire main riser.`,
      targets: [dk.id],
      at: { x: (m0.x0 + m0.x1) / 2, y: 0, deckId: dk.id },
    });
  }
  // 2. every piece of fire main is connected to the pumps (an engine room)
  const fed = (r: Run) => terminalEngineRooms(design, r).size > 0 || spacesCrossed(design, r).some((c) => c.space.type === "engine_room");
  const groups = connectedGroups(design, mains, v.connect_tolerance_m);
  const pumped = groups.filter((g) => g.some(fed));
  for (const g of groups) {
    if (pumped.includes(g)) continue;
    const r0 = g[0];
    findings.push({
      status: "red",
      message: `${names(g.map((r) => r.name))} ${g.length === 1 ? "is" : "are"} not connected to the fire pumps.`,
      detail: `A fire main must be fed from the fire pumps in the machinery space (with isolating valves outside it). This piece does not touch any other fire main that reaches an engine room (gap more than ${v.connect_tolerance_m} m).`,
      fix: `Extend ${r0.name} until it meets the fire main riser or another connected fire main, or draw a riser from it down to the engine room.`,
      targets: g.map((r) => r.id),
      at: r0.points[0],
    });
  }
  // 3. pump pressure needed for the highest hydrant (static head only)
  const fedRuns = pumped.flat();
  const erFloors = design.spaces.filter((s) => s.type === "engine_room").map((s) => design.decks.find((d) => d.id === s.deckId)?.z ?? 0);
  let summaryP = "";
  if (fedRuns.length && erFloors.length) {
    let zTop = -Infinity,
      topRun: Run | null = null,
      topPt: RunPoint | null = null;
    for (const r of fedRuns)
      for (const p of r.points) {
        const z = runZ(design, p.deckId) ?? -Infinity;
        if (z > zTop) ((zTop = z), (topRun = r), (topPt = p));
      }
    const zPump = Math.min(...erFloors);
    const head = (v.sea_water_density_t_m3 * 1000 * 9.81 * (zTop - zPump)) / 1e6;
    const need = v.min_hydrant_pressure_mpa + head;
    summaryP = ` The pumps need ${fmt(need, 2)} N/mm2 for ${v.min_hydrant_pressure_mpa} N/mm2 at the highest hydrant (${deckNameOf(design, topPt!.deckId)}).`;
    if (need > v.amber_above_share_of_pump * v.pump_pressure_mpa)
      findings.push({
        status: need > v.pump_pressure_mpa ? "red" : "amber",
        message: `The fire pumps need ${fmt(need, 2)} N/mm2 to give ${v.min_hydrant_pressure_mpa} N/mm2 at the highest hydrant on ${deckNameOf(design, topPt!.deckId)}.`,
        detail: `The water has to be lifted ${fmt(zTop - zPump)} m from the engine room floor, which costs ${fmt(head, 2)} N/mm2 before any friction loss. Our fire pumps deliver ${v.pump_pressure_mpa} N/mm2.`,
        fix: "Use fire pumps with a higher delivery pressure, add a booster pump for the upper decks, or feed the top decks from a pressure tank.",
        targets: [topRun!.id],
        at: topPt!,
        measured: `${fmt(need, 2)} N/mm2`,
        limit: `${v.pump_pressure_mpa} N/mm2`,
      });
  }
  const decksWith = decks.filter((dk) => served(dk.id).length).length;
  return result(
    "PIPE-FIRE-MAIN",
    findings,
    findings.length ? `${plural(findings.length, "fire main problem")}.${summaryP}` : `The fire main reaches every fire zone on all ${decksWith} decks with rooms and is fed from the engine room.${summaryP}`,
  );
}

// ------------------------------------------------------------------ PIPE-WATERTIGHT
export function pipeWatertight(ctx: RuleContext): RuleResult {
  const v = ruleDef("PIPE-WATERTIGHT").values;
  const { design } = ctx;
  const runs = runsOf(design, () => true);
  if (!runs.length) return result("PIPE-WATERTIGHT", [], "No pipes or cables yet.", "grey");
  const L = design.hull.LOA;
  const wt = design.bulkheads.filter((b) => b.kind === "watertight").sort((a, b) => a.x - b.x);
  const collision = wt.length && wt[wt.length - 1].x >= v.collision_min_x_share_of_length * L ? wt[wt.length - 1] : null;
  const findings: Finding[] = [];
  const throughCollision: { r: Run; at: RunPoint }[] = [];
  let count = 0;
  const perBulkhead = new Map<string, number>();
  for (const r of runs)
    for (const c of watertightCrossings(design, r)) {
      count++;
      perBulkhead.set(c.bulkhead.id, (perBulkhead.get(c.bulkhead.id) ?? 0) + 1);
      if (collision && c.bulkhead.id === collision.id) throughCollision.push({ r, at: c.at });
      else if ((v.hot_kinds as string[]).includes(r.kind))
        findings.push({
          status: "amber",
          message: `${r.name} passes through a watertight bulkhead at x ${fmt(c.bulkhead.x)} m on ${deckNameOf(design, c.at.deckId)}: hot exhaust pipe in a watertight penetration.`,
          detail: "Seals and packings in a watertight penetration must not be heat sensitive, or a fire or the hot pipe itself can break the watertight integrity of the bulkhead.",
          fix: `Route ${r.name} up through its own casing instead of through the bulkhead, or specify a steel penetration piece without heat-sensitive seals.`,
          targets: [r.id, c.bulkhead.id],
          at: c.at,
        });
    }
  if (collision && throughCollision.length) {
    const allowed: string[] = v.collision_allowed_kinds;
    const wrong = throughCollision.filter((t) => !allowed.includes(t.r.kind));
    const pipes = throughCollision.filter((t) => allowed.includes(t.r.kind));
    for (const t of wrong) {
      const cable = isCable(t.r.kind);
      findings.push({
        status: "red",
        message: `${t.r.name} goes through the collision bulkhead below the bulkhead deck.`,
        detail: `Only one pipe, for the forepeak tank, may pierce the collision bulkhead (x ${fmt(collision.x)} m) below the bulkhead deck. A ${cable ? "cable" : RUN_INFO[t.r.kind].short} there is a leak path straight into the ship after a bow collision.`,
        fix: `End ${t.r.name} aft of x ${fmt(collision.x)} m, or take it forward above the bulkhead deck (${deckNameOf(design, design.bulkheadDeckId)}).`,
        targets: [t.r.id, collision.id],
        at: t.at,
      });
    }
    if (pipes.length > v.collision_max_pipes)
      findings.push({
        status: "red",
        message: `${pipes.length} pipes go through the collision bulkhead below the bulkhead deck; ${v.collision_max_pipes} is allowed.`,
        detail: `${names(pipes.map((t) => t.r.name))} all pierce it. Only one pipe for the forepeak tank is allowed, with a screw-down valve worked from above the bulkhead deck.`,
        fix: "Join them into one forepeak pipe, or end the others aft of the collision bulkhead.",
        targets: [...pipes.map((t) => t.r.id), collision.id],
        at: pipes[1].at,
      });
  }
  const busiest = [...perBulkhead.entries()].sort((a, b) => b[1] - a[1])[0];
  const bx = busiest ? design.bulkheads.find((b) => b.id === busiest[0])?.x : undefined;
  return result(
    "PIPE-WATERTIGHT",
    findings,
    findings.length
      ? `${plural(findings.length, "problem")} with pipes or cables through watertight bulkheads.`
      : count
        ? `${plural(count, "pipe or cable penetration", "pipe and cable penetrations")} of watertight bulkheads below the bulkhead deck (most at x ${fmt(bx ?? 0)} m: ${busiest[1]}). Each needs a watertight transit.${collision ? ` The collision bulkhead has ${throughCollision.length === 1 ? "one forepeak pipe" : "no pipe"}.` : ""}`
        : "No pipe or cable crosses a watertight bulkhead below the bulkhead deck.",
  );
}

// ------------------------------------------------------------------ PIPE-FUEL-HOT
export function pipeFuelHot(ctx: RuleContext): RuleResult {
  const v = ruleDef("PIPE-FUEL-HOT").values;
  const { design } = ctx;
  const fuel = runsOf(design, (r) => r.kind === "fuel_oil");
  if (!fuel.length) return result("PIPE-FUEL-HOT", [], "No fuel oil lines yet.", "grey");
  const hot = runsOf(design, (r) => r.kind === "exhaust");
  const findings: Finding[] = [];
  const noRooms: string[] = v.no_fuel_room_types;
  let closest = Infinity;
  for (const f of fuel) {
    for (const e of hot) {
      const c = runClearance(design, f, e);
      if (!c) continue;
      closest = Math.min(closest, c.gap);
      if (c.gap >= v.min_clearance_to_exhaust_m) continue;
      const touching = c.gap < v.touching_below_m;
      findings.push({
        status: touching ? "red" : "amber",
        message: touching ? `${f.name} touches ${e.name}.` : `${f.name} passes ${fmt(Math.max(0, c.gap), 2)} m from ${e.name}.`,
        detail: `Hot exhaust pipes are the most common ignition source in a machinery space. Fuel spraying from a leaking joint onto the exhaust starts a fire at once. Clear gap ${fmt(Math.max(0, c.gap), 2)} m, our working minimum ${v.min_clearance_to_exhaust_m} m.`,
        fix: `Move ${f.name} at least ${v.min_clearance_to_exhaust_m} m away from the exhaust, or fit spray shields on every joint, use jacketed pipe and insulate the exhaust there.`,
        targets: [f.id, e.id],
        at: c.at,
        measured: `${fmt(Math.max(0, c.gap), 2)} m`,
        limit: `${v.min_clearance_to_exhaust_m} m`,
      });
    }
    const rooms = spacesCrossed(design, f).filter((c) => noRooms.includes(c.space.type));
    if (rooms.length)
      findings.push({
        status: "amber",
        message: `${f.name} runs through ${names(rooms.map((c) => c.space.name))}.`,
        detail: `Fuel oil lines are under pressure and must be screened against spray. In ${rooms.length === 1 ? "this room" : "these rooms"} a leak would not be noticed and would put people at risk.`,
        fix: `Route ${f.name} through machinery spaces, tanks or a pipe duct instead.`,
        targets: [f.id],
        at: rooms[0].at,
      });
  }
  return result(
    "PIPE-FUEL-HOT",
    findings,
    findings.length ? `${plural(findings.length, "fuel oil line problem")}.` : hot.length ? `All ${plural(fuel.length, "fuel oil line")} keep at least ${fmt(closest, 1)} m from the exhaust uptakes and stay out of the rooms.` : `${plural(fuel.length, "fuel oil line")}, no exhaust uptakes drawn yet.`,
  );
}

// ------------------------------------------------------------------ CABLE-ROUTING
export function cableRouting(ctx: RuleContext): RuleResult {
  const v = ruleDef("CABLE-ROUTING").values;
  const { design } = ctx;
  const cs = cablesOf(design);
  if (!cs.length) return result("CABLE-ROUTING", [], "No main cables yet.", "grey");
  const risky: string[] = v.high_fire_risk_types;
  const pat = new RegExp(v.high_fire_risk_name_pattern, "i");
  const hot = runsOf(design, (r) => r.kind === "exhaust");
  const findings: Finding[] = [];
  for (const c of cs) {
    const own = terminalEngineRooms(design, c);
    const bad = spacesCrossed(design, c).filter((x) => (risky.includes(x.space.type) || pat.test(x.space.name)) && !own.has(x.space.id));
    if (bad.length) {
      const what = bad.map((x) => x.space.name);
      findings.push({
        status: "amber",
        message: `${c.name} runs through ${names(what)}.`,
        detail: `Cables for essential power must be routed clear of galleys, laundries and machinery spaces of category A so far as practicable, so a fire there does not cut the power needed to fight it. ${fmt(bad.reduce((a, x) => a + x.length, 0))} m of the cable lie inside.`,
        fix: `Re-route ${c.name} around ${bad.length === 1 ? what[0] : "these rooms"}, for example along the corridor.`,
        targets: [c.id],
        at: bad[0].at,
      });
    }
    for (const e of hot) {
      const g = runClearance(design, c, e);
      if (!g || g.gap >= v.min_clearance_to_exhaust_m) continue;
      const inOwn = design.spaces.some((s) => own.has(s.id) && spaceDeckIds(design, s).includes(g.at.deckId) && inRect(s, g.at.x, g.at.y, -0.05));
      if (inOwn) continue; // inside the engine room it serves
      findings.push({
        status: "amber",
        message: `${c.name} passes ${fmt(Math.max(0, g.gap), 2)} m from ${e.name}.`,
        detail: `The exhaust uptake runs in the machinery casing, which counts like the machinery space itself. Clear gap ${fmt(Math.max(0, g.gap), 2)} m, our working minimum ${v.min_clearance_to_exhaust_m} m.`,
        fix: `Move ${c.name} at least ${v.min_clearance_to_exhaust_m} m away from the casing.`,
        targets: [c.id, e.id],
        at: g.at,
        measured: `${fmt(Math.max(0, g.gap), 2)} m`,
        limit: `${v.min_clearance_to_exhaust_m} m`,
      });
    }
  }
  return result("CABLE-ROUTING", findings, findings.length ? `${plural(findings.length, "cable routing hint")}.` : `All ${plural(cs.length, "main cable")} stay clear of galleys, laundries, other engine rooms and exhaust casings.`);
}

export const RULE_FUNCS: Record<string, (ctx: RuleContext) => RuleResult> = {
  "PIPE-FIRE-MAIN": pipeFireMain,
  "PIPE-WATERTIGHT": pipeWatertight,
  "PIPE-FUEL-HOT": pipeFuelHot,
  "CABLE-ROUTING": cableRouting,
  "FIRE-ZONE-SIZE": fireZoneSize,
  "FIRE-WALL-RATING": fireWallRating,
  "ESCAPE-TWO-EXITS": escapeTwoExits,
  "ESCAPE-STAIR-WIDTH": escapeStairWidth,
  "EVACUATION-TIME": evacuationTime,
  "FLOOD-SURVIVAL": floodSurvival,
  "INTACT-STABILITY": intactStability,
  "LSA-CAPACITY": lsaCapacity,
  "WEIGHT-MARGIN": weightMargin,
  "REFERENCE-SHIPS": referenceShips,
};

type RawRef = { id: string; source: string; clause: string; quote?: string; page?: number; match?: string };
/** The clauses behind a rule (rules.json "refs"), resolved to their documents. */
export function ruleRefs(id: string): RuleRef[] {
  const raw: RawRef[] = ruleDef(id).refs ?? [];
  return raw.map((x) => {
    const src = RULES.sources.find((s: { id: string }) => s.id === x.source) as { name: string; short?: string; file?: string; url?: string } | undefined;
    return { id: x.id, source: x.source, sourceName: src?.name ?? x.source, short: src?.short ?? x.source, clause: x.clause, quote: x.quote, page: x.page, file: src?.file, url: src?.url };
  });
}
/** Picks the clause for a finding: the first ref whose "match" pattern fits the message, else the first ref without one. */
export function refForFinding(id: string, f: Finding): RuleRef | undefined {
  const raw: RawRef[] = ruleDef(id).refs ?? [];
  const refs = ruleRefs(id);
  const i = raw.findIndex((x) => x.match && new RegExp(x.match, "i").test(f.message));
  return refs[i >= 0 ? i : Math.max(0, raw.findIndex((x) => !x.match))];
}

export function runRules(ctx: RuleContext): RuleResult[] {
  return RULES.rules.map((r: { id: string; title: string }) => {
    const fn = RULE_FUNCS[r.id];
    if (!fn) return result(r.id, [], "No check implemented for this rule yet.", "grey");
    try {
      const res = fn(ctx);
      for (const f of res.findings) f.ref ??= refForFinding(r.id, f);
      return res;
    } catch (e) {
      return result(r.id, [{ status: "grey", message: `The check could not run: ${(e as Error).message}`, targets: [] }], "Error while running the check.", "grey");
    }
  });
}

export function score(results: RuleResult[]): { score: number; counted: number } {
  const counted = results.filter((r) => r.status !== "grey");
  if (!counted.length) return { score: 0, counted: 0 };
  const pts = counted.reduce((s, r) => s + (r.status === "green" ? 1 : r.status === "amber" ? 0.5 : 0), 0);
  return { score: Math.round((100 * pts) / counted.length), counted: counted.length };
}
