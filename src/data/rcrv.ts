// RCRV research vessel (Regional Class Research Vessel, 12100-RCRV-199): rebuilt from views of the
// Navisworks model and the published main data (60.6 m overall, 12.4 m beam, 3.81 m draught).
// Only what this tool can check is kept: hull, decks, rooms, stairs, tanks, bulkheads, lifesaving
// appliances and the major pipes and cables. Masts, antennas, cranes, the A-frame, railings and deck
// gear are left out. The exterior shell (rcrvExterior.ts) keeps the outside shape and colours.
// This module is not part of the app bundle: scripts/build-rcrv.ts writes it out as the import files in
// public/models/rcrv/, and the app reads those files like any other import.
import type { Design, Space, Door, FireRating, LSA, TankProps, SpaceType, Run, RunKind } from "../engine/types";
import { pairKey } from "../engine/types";
import { sharedEdges } from "../engine/topology";
import { requiredMinutes } from "../engine/rules";
import { createShip, halfBreadthAt } from "../engine/vessel";
import { autoDoors } from "../engine/generators";
import { applyOffsets, type OffsetsImport } from "../engine/io";
import { blankDesign } from "./demoDesign";

// ------------------------------------------------------------------ main data
export const RCRV = {
  name: "RCRV 199 research vessel",
  LOA: 60.6,
  BOA: 12.4,
  depth: 6.0, // main deck at side (aft working deck)
  draft: 3.81,
  speedKn: 11.5,
  forecastleZ: 8.6, // 01 deck: the raised shell from the step forward
  stepX: 24, // aft end of the raised shell (front of the aft working deck)
};

const HB = RCRV.BOA / 2;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Height of the bottom of the main hull (without the bulb) at x. */
export function bottomZ(x: number): number {
  if (x < 16) return 0.6 + 1.8 * (1 - smooth(0, 16, x)); // run up to the immersed transom
  if (x > 44) return 0.6 + 3.0 * Math.pow(Math.min(1, (x - 44) / 14.5), 2); // forefoot
  return 0.6;
}

/** Forward end of the main hull at height z (raked stem); above the main deck it keeps raking slightly. */
export function stemX(z: number): number {
  if (z > RCRV.depth) return RCRV.LOA + 0.12 * (z - RCRV.depth);
  return 57.0 + (RCRV.LOA - 57.0) * Math.pow(Math.max(0, z) / RCRV.depth, 1.4);
}

/** Half-breadth of the waterline at height z (no bilge rounding): parallel middle body, fine bow. */
function waterlineHB(x: number, z: number): number {
  const zc = Math.min(z, RCRV.depth);
  const xs = stemX(z);
  const xe = 33 + 6 * (zc / RCRV.depth); // end of the parallel middle body, further aft low down
  let b = x < 6 ? HB - 0.25 * (1 - x / 6) : HB;
  if (x > xe) {
    const u = Math.min(1, (x - xe) / Math.max(0.1, xs - xe));
    const p = 1.7 + 0.5 * (zc / RCRV.depth); // fuller up high
    b *= Math.pow(Math.max(0, 1 - Math.pow(u, p)), 0.62);
  }
  if (z > RCRV.depth && x > 40) b *= 1 + 0.01 * (z - RCRV.depth) * ((x - 40) / 20); // bow flare
  return b;
}

/** Half-breadth of the bulb and sonar blister under the forward hull. */
export function bulbHB(x: number, z: number): number {
  // a long round body: full section amidships, blending into the bottom aft, rounded nose forward
  if (x < 26 || x > 59.6) return 0;
  const aft = Math.sqrt(Math.min(1, (x - 26) / 10));
  const fwd = x > 53 ? Math.sqrt(Math.max(0, 1 - Math.pow((x - 53) / 6.6, 2))) : 1;
  const k = aft * fwd;
  const zc = 1.15,
    hz = 1.15 * Math.max(0.05, k),
    w = 1.55 * k;
  const v = 1 - Math.pow((z - zc) / hz, 2);
  return v > 0 ? w * Math.sqrt(v) : 0;
}

/** Half-breadth of the main hull alone. */
export function mainHB(x: number, z: number): number {
  if (x < 0 || x > stemX(z)) return 0;
  const zb = bottomZ(x);
  if (z < zb) return 0;
  const b = waterlineHB(x, z);
  const R = Math.min(1.5, b); // bilge radius
  const h = z - zb;
  if (h >= R) return b;
  return Math.max(0, b - R + Math.sqrt(R * R - (R - h) * (R - h)));
}

/** Moulded hull half-breadth at (x, z): main hull and bulb. */
export function rcrvHB(x: number, z: number): number {
  return Math.max(mainHB(x, z), bulbHB(x, z));
}

const STATIONS = [0, 0.5, 2, 4, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 44, 46, 48, 50, 52, 53.5, 55, 56, 57, 58, 58.8, 59.4, 60, 60.6];
const WATERLINES = [0, 0.15, 0.35, 0.6, 0.85, 1.1, 1.4, 1.8, 2.2, 2.7, 3.2, 3.8, 4.4, 5.0, 5.5, 6.0];

/** Offsets table in metres, as a hull design program would export it. */
export function rcrvOffsets(): OffsetsImport {
  const table = WATERLINES.map((z) => STATIONS.map((x) => +rcrvHB(x, z).toFixed(3)));
  return { LOA: RCRV.LOA, BOA: RCRV.BOA, zMax: RCRV.depth, stations: [...STATIONS], waterlines: [...WATERLINES], table };
}

// ------------------------------------------------------------------ decks and rooms
// Deck heights above the keel. 01 and 02 are deckhouse levels (the bridge is on 02).
const DECKS = [
  { id: "DB", name: "Double bottom", z: 0.6 },
  { id: "LD", name: "Lower deck", z: 3.1 },
  { id: "MD", name: "Main deck", z: 6.0 },
  { id: "D01", name: "01 deck", z: 8.6, plate: [RCRV.stepX, RCRV.LOA] as [number, number] },
  { id: "D02", name: "02 deck (bridge)", z: 11.2, plate: [26.5, 47.5] as [number, number] },
];

const HOUSE_HW = 5.4; // half-width of the 01 deckhouse (walkway outside)
const WHEEL_HW = 4.8; // half-width of the wheelhouse level
const CORR = 0.6; // corridor half-width (1.2 m clear)
const STAIR_W = 900;

interface Room {
  id: string;
  name: string;
  type: SpaceType;
  deck: string;
  top?: string;
  x0: number;
  x1: number;
  y0: number; // starboard edge (negative)
  y1: number; // port edge
  persons?: number;
  tank?: TankProps;
}

export function rcrvDesign(): Design {
  const d = blankDesign();
  d.name = RCRV.name;
  d.hull = { template: "cruise", LOA: RCRV.LOA, BOA: RCRV.BOA, depth: RCRV.depth, designDraft: RCRV.draft, designSpeedKn: RCRV.speedKn, parsonsK: 0.033 };
  d.decks = DECKS.map((k) => ({ ...k }));
  d.bulkheadDeckId = "MD";
  applyOffsets(d, rcrvOffsets(), "RCRV 199 hull offsets");
  d.hull.designDraft = RCRV.draft;
  const ship = createShip({ ...d, spaces: [], doors: [], bulkheads: [], lsa: [] });
  const zOf = new Map(d.decks.map((k) => [k.id, k.z]));
  /** usable half-width over x0..x1 on a deck: narrowest hull point, 0.3 m inside the shell, 0.1 m steps */
  const hw = (deck: string, x0: number, x1: number, cap = HB) => {
    const z = zOf.get(deck)! + 0.01;
    let m = cap + 0.3;
    for (let i = 0; i <= 10; i++) m = Math.min(m, halfBreadthAt(ship, x0 + ((x1 - x0) * i) / 10, Math.min(z, RCRV.depth - 0.01)));
    return Math.floor((m - 0.3) * 10) / 10;
  };

  const rooms: Room[] = [];
  const add = (r: Room) => rooms.push(r);
  const P = (deck: string, x0: number, x1: number, cap?: number) => hw(deck, x0, x1, cap);

  // --- Double bottom: tanks port and starboard of the centre girder
  const tanks: [string, number, number, TankProps["content"], number][] = [
    ["Fuel oil tank 1", 18, 24, "fuel", 85],
    ["Fuel oil tank 2", 24, 32, "fuel", 85],
    ["Fresh water tank", 32, 39, "fresh_water", 80],
    ["Ballast tank 3", 39, 46, "ballast", 0],
    ["Ballast tank 4", 46, 52, "ballast", 0],
  ];
  for (const [name, x0, x1, content, fill] of tanks) {
    const w = P("DB", x0, x1);
    if (w < 1.2) continue;
    const tag = name.toLowerCase().replace(/\W+/g, "-");
    add({ id: `${tag}-p`, name: `${name} P`, type: "tank", deck: "DB", x0, x1, y0: 0, y1: w, tank: { content, fillPct: fill } });
    add({ id: `${tag}-s`, name: `${name} S`, type: "tank", deck: "DB", x0, x1, y0: -w, y1: 0, tank: { content, fillPct: fill } });
  }

  // --- Lower deck: steering gear, engine room, auxiliary machinery, stores, science hold
  {
    const D = "LD";
    const w = (x0: number, x1: number) => P(D, x0, x1);
    add({ id: "steering", name: "Steering gear flat (unmanned)", type: "void", deck: D, x0: 7, x1: 12, y0: -w(7, 12), y1: w(7, 12) });
    add({ id: "engine-room", name: "Engine room", type: "engine_room", deck: D, x0: 12, x1: 24, y0: -w(12, 24), y1: w(12, 24), persons: 0 });
    add({ id: "ld-corridor", name: "Lower deck passage", type: "corridor", deck: D, x0: 24, x1: 47, y0: -CORR, y1: CORR });
    add({ id: "stair-c", name: "Stair C (engine escape)", type: "stairwell", deck: D, top: "MD", x0: 24, x1: 27, y0: CORR, y1: CORR + 3 });
    add({ id: "aux-machinery", name: "Auxiliary machinery room", type: "engine_room", deck: D, x0: 27, x1: 39, y0: CORR, y1: w(27, 39) });
    add({ id: "switchboard", name: "Switchboard room", type: "other", deck: D, x0: 24, x1: 39, y0: -w(24, 39), y1: -CORR });
    add({ id: "stair-a", name: "Stair A", type: "stairwell", deck: D, top: "D02", x0: 39, x1: 42, y0: -CORR - 3, y1: -CORR });
    add({ id: "science-hold", name: "Science hold", type: "store", deck: D, x0: 39, x1: 42, y0: CORR, y1: w(39, 42) });
    add({ id: "ld-cabin-p", name: "Crew cabin P", type: "cabin", deck: D, x0: 42, x1: 47, y0: CORR, y1: w(42, 47) });
    add({ id: "ld-cabin-s", name: "Crew cabin S", type: "cabin", deck: D, x0: 42, x1: 47, y0: -w(42, 47), y1: -CORR });
  }

  // --- Main deck: labs aft (behind the working deck), mess and galley, crew cabins forward
  {
    const D = "MD";
    const w = (x0: number, x1: number) => P(D, x0, x1);
    add({ id: "md-corridor", name: "Main deck corridor", type: "corridor", deck: D, x0: 24, x1: 47, y0: -CORR, y1: CORR });
    add({ id: "hydro-lab", name: "Hydro lab", type: "other", deck: D, x0: 27, x1: 31, y0: CORR, y1: w(27, 31) });
    add({ id: "stair-b", name: "Stair B", type: "stairwell", deck: D, top: "D02", x0: 31, x1: 34, y0: CORR, y1: CORR + 3 });
    add({ id: "main-lab", name: "Main lab", type: "other", deck: D, x0: 34, x1: 42, y0: CORR, y1: w(34, 42) });
    add({ id: "wet-lab", name: "Wet lab", type: "other", deck: D, x0: 24, x1: 31, y0: -w(24, 31), y1: -CORR });
    add({ id: "dry-lab", name: "Dry lab", type: "other", deck: D, x0: 31, x1: 39, y0: -w(31, 39), y1: -CORR });
    add({ id: "mess", name: "Mess room", type: "public", deck: D, x0: 42, x1: 47, y0: CORR, y1: w(42, 47) });
    add({ id: "galley", name: "Galley", type: "galley", deck: D, x0: 42, x1: 47, y0: -w(42, 47), y1: -CORR });
    add({ id: "bosun-store", name: "Bosun and provision store", type: "store", deck: D, x0: 47, x1: 55, y0: -w(47, 55), y1: w(47, 55) });
  }

  // --- 01 deck house: lounge (assembly station) aft, science cabins
  {
    const D = "D01";
    const w = (x0: number, x1: number) => Math.min(HOUSE_HW, P(D, x0, x1));
    add({ id: "lounge", name: "Lounge and assembly station", type: "muster_station", deck: D, x0: 27, x1: 31, y0: -w(27, 31), y1: w(27, 31) });
    add({ id: "d01-corridor", name: "01 deck corridor", type: "corridor", deck: D, x0: 31, x1: 45, y0: -CORR, y1: CORR });
    const port: [number, number][] = [
      [34, 37.7],
      [37.7, 41.4],
      [41.4, 45],
    ];
    port.forEach(([x0, x1], i) => add({ id: `sci-cabin-p${i + 1}`, name: `Science cabin P${i + 1}`, type: "cabin", deck: D, x0, x1, y0: CORR, y1: w(x0, x1) }));
    const stbd: [number, number][] = [
      [31, 35],
      [35, 39],
      [42, 45],
    ];
    stbd.forEach(([x0, x1], i) => add({ id: `sci-cabin-s${i + 1}`, name: `Science cabin S${i + 1}`, type: "cabin", deck: D, x0, x1, y0: -w(x0, x1), y1: -CORR }));
  }

  // --- 02 deck: officers' cabins and the wheelhouse
  {
    const D = "D02";
    const w = (x0: number, x1: number) => Math.min(WHEEL_HW, P(D, x0, x1));
    add({ id: "d02-corridor", name: "02 deck corridor", type: "corridor", deck: D, x0: 31, x1: 42, y0: -CORR, y1: CORR });
    add({ id: "master", name: "Master's cabin", type: "cabin", deck: D, x0: 34, x1: 38, y0: CORR, y1: w(34, 38) });
    add({ id: "chief-mate", name: "Chief mate's cabin", type: "cabin", deck: D, x0: 38, x1: 42, y0: CORR, y1: w(38, 42) });
    add({ id: "chief-eng", name: "Chief engineer's cabin", type: "cabin", deck: D, x0: 31, x1: 35, y0: -w(31, 35), y1: -CORR });
    add({ id: "second-eng", name: "Second engineer's cabin", type: "cabin", deck: D, x0: 35, x1: 39, y0: -w(35, 39), y1: -CORR });
    add({ id: "wheelhouse", name: "Wheelhouse", type: "other", deck: D, x0: 42, x1: 45, y0: -w(42, 45), y1: w(42, 45) });
  }

  // persons: 2 per cabin where it gives at least 7.5 m2 each, otherwise 1 (officers 1)
  const officers = new Set(["master", "chief-mate", "chief-eng", "second-eng"]);
  const spaces: Space[] = rooms.map((r) => {
    const length = +(r.x1 - r.x0).toFixed(3),
      breadth = +(r.y1 - r.y0).toFixed(3);
    const persons = r.persons ?? (r.type === "cabin" ? (officers.has(r.id) ? 1 : length * breadth >= 15 ? 2 : 1) : 0);
    const s: Space = { id: r.id, name: r.name, type: r.type, deckId: r.deck, xCentre: +((r.x0 + r.x1) / 2).toFixed(3), yCentre: +((r.y0 + r.y1) / 2).toFixed(3), length, breadth, persons };
    if (r.top) s.topDeckId = r.top;
    if (r.type === "stairwell") s.stair = { widthMm: STAIR_W, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 };
    if (r.tank) s.tank = r.tank;
    return s;
  });
  d.spaces = spaces;

  // --- Emergency doors: every room onto its corridor, stair or lounge (auto doors, like the Route tool)
  d.doors = [];
  let n = 0;
  // stairs first, then corridors and public rooms, then the rest; a cabin or store keeps the one door it got
  const rank = (s: Space) => (s.type === "stairwell" ? 0 : ["corridor", "public", "muster_station"].includes(s.type) ? 1 : 2);
  const hasDoor = (s: Space) => d.doors.some((dr) => dr.deckId === s.deckId && Math.abs(dr.x - s.xCentre) <= s.length / 2 + 0.01 && Math.abs(dr.y - s.yCentre) <= s.breadth / 2 + 0.01);
  for (const s of [...spaces].sort((a, b) => rank(a) - rank(b))) {
    if (s.type === "tank" || s.type === "void") continue;
    if (["cabin", "store"].includes(s.type) && hasDoor(s)) continue;
    for (const dr of autoDoors(d, s.id)) {
      if (["cabin", "store"].includes(s.type) || ["cabin", "store"].includes(otherSide(d, s, dr)?.type ?? "")) {
        // rooms open onto circulation only, never into a neighbouring room
        const o = otherSide(d, s, dr);
        const via = s.type === "cabin" || s.type === "store" ? o?.type : s.type;
        if (o && !["corridor", "muster_station"].includes(via ?? "")) continue; // cabins and stores open onto a corridor
        if (o && ["cabin", "store"].includes(o.type) && hasDoor(o)) continue;
      }
      d.doors.push({ ...dr, id: `door${++n}` } as Door);
    }
  }

  // --- Bulkheads: watertight subdivision and one fire zone boundary
  d.bulkheads = [
    ...[7, 12, 24, 39, 48, 55.2].map((x, i) => ({ id: `wt${i + 1}`, kind: "watertight" as const, x, rating: "A-0" as FireRating })),
    { id: "mvz1", kind: "fire_zone" as const, x: RCRV.stepX, rating: "A-60" as FireRating },
  ];

  // --- Fire ratings: every shared wall gets its minimum, walls on the fire zone boundary A-60
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const divisions: Record<string, FireRating> = {};
  for (const e of sharedEdges(d)) {
    const A = byId.get(e.a)!,
      B = byId.get(e.b)!;
    let req = requiredMinutes(A, B);
    if (e.x0 === e.x1 && Math.abs(e.x0 - RCRV.stepX) < 0.05) req = 60;
    if (req > 0) divisions[pairKey(A.id, B.id)] = `A-${req}` as FireRating;
  }
  d.divisions = divisions;

  // --- People and loading
  const science = spaces.filter((s) => s.id.startsWith("sci-cabin")).reduce((a, s) => a + s.persons, 0);
  const crew = spaces.reduce((a, s) => a + s.persons, 0) - science;
  d.people = { passengers: science, crew };
  d.loading = { lightshipOverride: { ...RCRV_LIGHTSHIP }, deadweight: { massT: 120, lcg: 30, kg: 6.5 }, personMassKg: 100 };
  d.evacuation = { scenario: "night", embarkLaunchMin: 30, roRo: false };

  // --- Lifesaving: liferafts on the 01 deck beside the lounge (assembly station), rescue boat on the main deck
  const lsa: LSA[] = [];
  const raftY = (x: number) => +(halfBreadthAt(ship, x, RCRV.depth - 0.01) - 0.8).toFixed(1);
  for (const [i, x] of [25.2, 26.2].entries()) {
    lsa.push({ id: `lrP${i + 1}`, kind: "liferaft", deckId: "D01", x, y: raftY(x), capacity: 25, massT: 1.5 });
    lsa.push({ id: `lrS${i + 1}`, kind: "liferaft", deckId: "D01", x, y: -raftY(x), capacity: 25, massT: 1.5 });
  }
  d.lsa = lsa;

  // --- Major pipes and cables (default arrangement)
  d.runs = rcrvRuns();
  return d;
}

// Calibrated so the ship floats at its published draught, level, with GM 1.6 m (scripts/check-rcrv.ts --calibrate 1.6).
export const RCRV_LIGHTSHIP = { massT: 1441, lcg: 28.08, kg: 5.40 };

/** The space on the other side of a door from s (the door lies on a wall s shares with it). */
function otherSide(d: Design, s: Space, dr: Pick<Door, "x" | "y" | "deckId">): Space | undefined {
  return d.spaces.find(
    (o) =>
      o.id !== s.id &&
      (o.deckId === dr.deckId || o.topDeckId) &&
      Math.abs(dr.x - o.xCentre) <= o.length / 2 + 0.01 &&
      Math.abs(dr.y - o.yCentre) <= o.breadth / 2 + 0.01 &&
      sharesDeck(d, o, dr.deckId),
  );
}
function sharesDeck(d: Design, o: Space, deckId: string) {
  const z = new Map(d.decks.map((k) => [k.id, k.z]));
  const lo = z.get(o.deckId)!,
    hi = z.get(o.topDeckId ?? o.deckId)!,
    at = z.get(deckId)!;
  return at >= lo - 1e-6 && at <= hi + 1e-6;
}

/**
 * Major pipes and cables, routed through this arrangement: mains along the corridors under the deckhead,
 * risers beside Stair B, exhaust uptakes inside the stack, fuel lines from the double-bottom tanks into
 * the engine room.
 */
function rcrvRuns(): Run[] {
  const run = (id: string, kind: RunKind, name: string, sizeMm: number, pts: [number, number, string][]): Run => ({ id, kind, name, sizeMm, points: pts.map(([x, y, deckId]) => ({ x, y, deckId })) });
  const R = 31.5; // riser position (in the corridor beside Stair B on every deck)
  return [
    run("fm-LD", "fire_main", "Fire main Lower deck (from the fire pumps)", 200, [[13, 0.3, "LD"], [46.5, 0.3, "LD"]]),
    run("fm-riser", "fire_main", "Fire main riser", 200, [[R, 0.3, "LD"], [R, 0.3, "D02"]]),
    run("fm-MD", "fire_main", "Fire main Main deck", 200, [[24.5, 0.3, "MD"], [46.5, 0.3, "MD"]]),
    run("fm-D01", "fire_main", "Fire main 01 deck", 200, [[27.5, 0.3, "D01"], [44.5, 0.3, "D01"]]),
    run("fm-D02", "fire_main", "Fire main 02 deck", 200, [[R, 0.3, "D02"], [45, 0.3, "D02"]]),
    run("bilge-main", "bilge_ballast", "Bilge and ballast main", 300, [[12.5, 0.6, "DB"], [55.7, 0.6, "DB"]]),
    run("fuel-1", "fuel_oil", "Fuel oil line tank 1", 100, [[21, 1.0, "DB"], [19, 1.0, "DB"], [19, 1.0, "LD"]]),
    run("fuel-2", "fuel_oil", "Fuel oil line tank 2", 100, [[28, -1.0, "DB"], [19, -1.0, "DB"], [19, -1.0, "LD"]]),
    run("exhaust-1", "exhaust", "Exhaust uptake 1", 600, [[22, -4.4, "LD"], [22, -4.4, "D02"]]),
    run("exhaust-2", "exhaust", "Exhaust uptake 2", 600, [[22, -3.2, "LD"], [22, -3.2, "D02"]]),
    run("hv-propulsion", "hv_cable", "Propulsion motor cable", 120, [[17, -3, "LD"], [9, -3, "LD"]]),
    run("feeder-LD", "feeder_cable", "Main feeder from the switchboard", 80, [[30, -1.5, "LD"], [30, -0.3, "LD"], [32.5, -0.3, "LD"]]),
    run("feeder-riser", "feeder_cable", "Feeder riser", 80, [[32.5, -0.3, "LD"], [32.5, -0.3, "D02"]]),
    run("feeder-MD", "feeder_cable", "Feeder Main deck", 80, [[24.5, -0.3, "MD"], [46.5, -0.3, "MD"]]),
    run("feeder-D01", "feeder_cable", "Feeder 01 deck", 80, [[27.5, -0.3, "D01"], [44.5, -0.3, "D01"]]),
    run("feeder-D02", "feeder_cable", "Feeder 02 deck", 80, [[32.5, -0.3, "D02"], [45, -0.3, "D02"]]),
  ];
}
