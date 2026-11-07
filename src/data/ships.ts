// Model ships: parametric arrangements of real cruise ships, built from public main data.
// Hull, decks, fire zones, persons and lifesaving appliances follow the published figures; the interior
// arrangement is a simplified block layout (not the real general arrangement, which is not public).
// Every fire zone has a stair core at each end, a central corridor and a room block on each side.
// The layouts are made to pass the checks; see THINGS_TO_ASK.txt for the values that are assumptions.
import type { Design, Space, Door, FireRating, SpaceType, LSA, TankProps } from "../engine/types";
import { pairKey } from "../engine/types";
import { sharedEdges } from "../engine/topology";
import { requiredMinutes } from "../engine/rules";
import { createShip, halfBreadthAt } from "../engine/vessel";
import { blankDesign, demoDesign } from "./demoDesign";

type Role = "tank" | "machinery" | "crew" | "service" | "muster" | "public" | "cabin";

interface ShipSpec {
  name: string;
  LOA: number;
  BOA: number;
  depth: number;
  draft: number;
  speedKn: number;
  deck1Z: number;
  deckHeight: number;
  /** One entry per deck from Deck 1 up; zones = inclusive fire-zone range present on that deck (default all). */
  decks: { role: Role; zones?: [number, number] }[];
  bulkheadDeck: number; // deck number (1-based)
  musterDeck: number;
  zones: number;
  xAft: number;
  xFwd: number;
  stairWidthMm: number;
  pax: number;
  crew: number;
  machineryZones: number[];
  galleyZones: number[];
  fuelZones: number[];
  freshWaterZones: number[];
  lifeboats: { perSide: number; capacity: number; massT: number; x0: number; x1: number };
  rafts: { count: number; capacity: number };
  lightship: { massT: number; lcg: number; kg: number };
  deadweight: { massT: number; lcg: number; kg: number };
}

const CORR = 2.5; // half-width of the central corridor and stair cores (5 m band)
const STAIR_LEN = 7;

function build(spec: ShipSpec): Design {
  const d = blankDesign();
  d.name = spec.name;
  d.hull = { template: "cruise", LOA: spec.LOA, BOA: spec.BOA, depth: spec.depth, designDraft: spec.draft, designSpeedKn: spec.speedKn, parsonsK: 0.037 };
  d.decks = spec.decks.map((_, i) => ({ id: `D${i + 1}`, name: `Deck ${i + 1}`, z: +(spec.deck1Z + i * spec.deckHeight).toFixed(2) }));
  d.bulkheadDeckId = `D${spec.bulkheadDeck}`;
  const ship = createShip({ ...d, spaces: [], doors: [], bulkheads: [], lsa: [] });
  const zb = Array.from({ length: spec.zones + 1 }, (_, k) => +(spec.xAft + (k * (spec.xFwd - spec.xAft)) / spec.zones).toFixed(2));
  // usable half-width of a zone on a deck: narrowest hull point over the zone, 0.4 m inside the shell
  const halfW = (z: number, x0: number, x1: number) => {
    let m = spec.BOA / 2;
    for (let i = 0; i <= 12; i++) m = Math.min(m, halfBreadthAt(ship, x0 + ((x1 - x0) * i) / 12, z + 0.01));
    return Math.floor((m - 0.4) * 2) / 2;
  };

  const spaces: Space[] = [];
  const doors: Door[] = [];
  let n = 0;
  const door = (deckId: string, x: number, y: number, widthMm: number) => doors.push({ id: `door${++n}`, deckId, x: +x.toFixed(2), y: +y.toFixed(2), widthMm });
  const box = (s: Omit<Space, "xCentre" | "yCentre" | "length" | "breadth">, x0: number, x1: number, y0: number, y1: number): Space => {
    const sp = { ...s, xCentre: +((x0 + x1) / 2).toFixed(3), yCentre: +((y0 + y1) / 2).toFixed(3), length: +(x1 - x0).toFixed(3), breadth: +(y1 - y0).toFixed(3) } as Space;
    spaces.push(sp);
    return sp;
  };

  // 1. Which zones exist on which deck (hull wide enough, inside the deck's zone range)
  const present: boolean[][] = spec.decks.map((dk, i) =>
    zb.slice(0, -1).map((x0, k) => {
      if (dk.role === "tank") return false;
      const [a, b] = dk.zones ?? [0, spec.zones - 1];
      return k >= a && k <= b && halfW(d.decks[i].z, x0, zb[k + 1]) >= CORR + 4;
    }),
  );

  // A zone without an assembly station on the muster deck would leave its rooms with nowhere to go:
  // leave such a zone empty (on these ships that is the narrow bow, used for mooring gear).
  for (let k = 0; k < spec.zones; k++) if (!present[spec.musterDeck - 1][k]) present.forEach((row) => (row[k] = false));

  // 2. Stair cores at both ends of every zone, from the lowest to the highest deck where the zone exists
  const stairOf = new Map<string, { aft: Space; fwd: Space }>();
  for (let k = 0; k < spec.zones; k++) {
    const decksHere = spec.decks.map((_, i) => i).filter((i) => present[i][k]);
    if (!decksHere.length) continue;
    const lo = d.decks[decksHere[0]].id,
      hi = d.decks[decksHere[decksHere.length - 1]].id;
    const stair = { widthMm: spec.stairWidthMm, orientation: "fore-aft" as const, handrailsBothSides: true, flightsPerDeck: 2 };
    const aft = box({ id: `stair${k + 1}A`, name: `Stair ${k + 1}A`, type: "stairwell", deckId: lo, topDeckId: hi, persons: 0, stair }, zb[k], zb[k] + STAIR_LEN, -CORR, CORR);
    const fwd = box({ id: `stair${k + 1}F`, name: `Stair ${k + 1}F`, type: "stairwell", deckId: lo, topDeckId: hi, persons: 0, stair }, zb[k + 1] - STAIR_LEN, zb[k + 1], -CORR, CORR);
    stairOf.set(String(k), { aft, fwd });
  }

  // 3. Decks
  const cabinRooms: Space[] = [];
  const crewRooms: Space[] = [];
  spec.decks.forEach((dk, i) => {
    const deck = d.decks[i];
    const tag = `D${i + 1}`;
    for (let k = 0; k < spec.zones; k++) {
      const x0 = zb[k],
        x1 = zb[k + 1];
      const zn = `Z${k + 1}`;
      if (dk.role === "tank") {
        const w = halfW(deck.z, x0, x1);
        if (w < 3) continue;
        const content: TankProps["content"] = spec.fuelZones.includes(k) ? "fuel" : spec.freshWaterZones.includes(k) ? "fresh_water" : "empty";
        const label = content === "fuel" ? "Fuel tank" : content === "fresh_water" ? "Fresh water tank" : "Ballast tank (empty)";
        for (const [side, y0, y1] of [
          ["port", 0, w],
          ["stbd", -w, 0],
        ] as const)
          box({ id: `${tag}-${zn}-t${side[0]}`, name: `${label} ${zn} ${side}`, type: "tank", deckId: deck.id, persons: 0, tank: { content, fillPct: content === "empty" ? 0 : 100 } }, x0 + 0.5, x1 - 0.5, y0, y1);
        continue;
      }
      if (!present[i][k]) continue;
      const w = halfW(deck.z, x0, x1);
      const st = stairOf.get(String(k))!;
      const corr = box({ id: `${tag}-${zn}-c`, name: `${tag} corridor ${zn}`, type: "corridor", deckId: deck.id, persons: 0 }, x0 + STAIR_LEN, x1 - STAIR_LEN, -CORR, CORR);
      door(deck.id, x0 + STAIR_LEN, 0, spec.stairWidthMm);
      door(deck.id, x1 - STAIR_LEN, 0, spec.stairWidthMm);
      void corr;
      void st;
      let type: SpaceType;
      let what: string;
      switch (dk.role) {
        case "machinery":
          [type, what] = spec.machineryZones.includes(k) ? ["engine_room", "engine room"] : ["cabin", "crew cabins"];
          break;
        case "crew":
          [type, what] = ["cabin", "crew cabins"];
          break;
        case "service":
          [type, what] = spec.galleyZones.includes(k) ? ["galley", "galley"] : k % 3 === 0 ? ["store", "stores"] : ["cabin", "crew cabins"];
          break;
        case "muster":
          [type, what] = ["muster_station", "assembly station"];
          break;
        case "public":
          [type, what] = ["public", "public rooms"];
          break;
        default:
          [type, what] = ["cabin", "cabins"];
      }
      for (const [side, sgn] of [
        ["port", 1],
        ["stbd", -1],
      ] as const) {
        const y0 = sgn > 0 ? CORR : -w,
          y1 = sgn > 0 ? w : -CORR;
        const room = box({ id: `${tag}-${zn}-${side[0]}`, name: `${tag} ${what} ${zn} ${side}`, type, deckId: deck.id, persons: type === "engine_room" ? 6 : type === "galley" ? 12 : 0 }, x0, x1, y0, y1);
        // groupable rooms open onto the corridor; public rooms, assembly stations and engine rooms also open into the aft stair
        // Port rooms open onto the aft half of the corridor and starboard rooms onto the forward half, so the
        // two stair cores of the zone share the load. Public rooms, assembly stations and engine rooms also
        // open straight into a stair core (port: aft core, starboard: forward core); assembly stations into both.
        const mid = x0 + STAIR_LEN + (x1 - x0 - 2 * STAIR_LEN) * (sgn > 0 ? 0.3 : 0.7);
        door(deck.id, mid, sgn * CORR, ["cabin", "store", "galley"].includes(type) ? 900 : 1600);
        if (!["cabin", "store", "galley"].includes(type)) {
          if (sgn > 0 || type === "muster_station") door(deck.id, x0 + STAIR_LEN / 2, sgn * CORR, spec.stairWidthMm);
          if (sgn < 0 || type === "muster_station") door(deck.id, x1 - STAIR_LEN / 2, sgn * CORR, spec.stairWidthMm);
        }
        if (type === "cabin") (dk.role === "cabin" ? cabinRooms : crewRooms).push(room);
      }
    }
  });

  // 4. Persons by floor area (passengers in passenger cabins, the rest of the crew in crew cabins)
  // largest-remainder split, so rounding never piles up in one room
  const spread = (rooms: Space[], total: number) => {
    const area = rooms.reduce((a, s) => a + s.length * s.breadth, 0);
    const exact = rooms.map((s) => (total * s.length * s.breadth) / area);
    rooms.forEach((s, i) => (s.persons = Math.floor(exact[i])));
    let left = total - rooms.reduce((a, s) => a + s.persons, 0);
    for (const i of exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) {
      if (left <= 0) break;
      rooms[i].persons++;
      left--;
    }
  };
  spread(cabinRooms, spec.pax);
  const fixedCrew = spaces.filter((s) => s.type === "engine_room" || s.type === "galley").reduce((a, s) => a + s.persons, 0);
  spread(crewRooms, spec.crew - fixedCrew);

  d.spaces = spaces;
  d.doors = doors;

  // 5. Fire zone and watertight bulkheads
  d.bulkheads = [
    ...zb.slice(1, -1).map((x, i) => ({ id: `mvz${i + 1}`, kind: "fire_zone" as const, x, rating: "A-60" as const })),
    ...[...zb.slice(1, -1), ...zb.slice(0, -1).map((x, k) => (x + zb[k + 1]) / 2), spec.LOA * 0.04, spec.LOA * 0.95]
      .sort((a, b) => a - b)
      .map((x, i) => ({ id: `wt${i + 1}`, kind: "watertight" as const, x: +x.toFixed(2), rating: "A-0" as const })),
  ];

  // 6. Every shared wall gets its minimum fire rating; walls on a fire zone boundary A-60
  const byId = new Map(d.spaces.map((s) => [s.id, s]));
  const divisions: Record<string, FireRating> = {};
  for (const e of sharedEdges(d)) {
    const A = byId.get(e.a)!,
      B = byId.get(e.b)!;
    let req = requiredMinutes(A, B);
    if (e.x0 === e.x1 && zb.some((x) => Math.abs(x - e.x0) < 0.05)) req = 60;
    if (req > 0) divisions[pairKey(A.id, B.id)] = `A-${req}` as FireRating;
  }
  d.divisions = divisions;

  // 7. People, loading, lifesaving appliances
  const crewOnBoard = d.spaces.filter((s) => s.type !== "cabin" || !cabinRooms.includes(s)).reduce((a, s) => a + s.persons, 0);
  d.people = { passengers: spec.pax, crew: crewOnBoard };
  d.loading = { lightshipOverride: { ...spec.lightship, tcg: 0 } as Design["loading"]["lightshipOverride"], deadweight: spec.deadweight, personMassKg: 100 };
  d.evacuation = { scenario: "night", embarkLaunchMin: 30, roRo: false };
  const mz = d.decks[spec.musterDeck - 1];
  const lsa: LSA[] = [];
  const lb = spec.lifeboats;
  for (let i = 0; i < lb.perSide; i++) {
    const x = lb.x0 + ((lb.x1 - lb.x0) * i) / Math.max(1, lb.perSide - 1);
    const y = halfBreadthAt(ship, x, mz.z + 0.01) - 1.5;
    lsa.push({ id: `lbP${i + 1}`, kind: "lifeboat", deckId: mz.id, x: +x.toFixed(1), y: +y.toFixed(1), capacity: lb.capacity, massT: lb.massT });
    lsa.push({ id: `lbS${i + 1}`, kind: "lifeboat", deckId: mz.id, x: +x.toFixed(1), y: -y.toFixed(1), capacity: lb.capacity, massT: lb.massT });
  }
  for (let i = 0; i < spec.rafts.count; i++) {
    const fwd = i % 2 === 0;
    const j = Math.floor(i / 2);
    const x = fwd ? lb.x1 + 10 + j * 3 : lb.x0 - 10 - j * 3;
    const side = j % 2 === 0 ? 1 : -1;
    lsa.push({ id: `lr${i + 1}`, kind: "liferaft", deckId: mz.id, x: +x.toFixed(1), y: +(side * (halfBreadthAt(ship, x, mz.z + 0.01) - 1)).toFixed(1), capacity: spec.rafts.capacity, massT: 1.5 });
  }
  d.lsa = lsa;
  return d;
}

// ------------------------------------------------------------------ the ships
// Icon class (Meyer Turku): 364.75 m overall, 48.47 m moulded breadth, 9.25 m draught, 20 decks,
// 5,610 guests at double occupancy / 7,600 maximum, 2,350 crew, about 22 kn (Wikipedia, Meyer Turku, CruiseMapper).
const ICON_DECKS: ShipSpec["decks"] = [
  { role: "tank" },
  { role: "machinery" },
  { role: "crew" },
  { role: "service" },
  { role: "muster" },
  { role: "crew" }, // crew decks below the guest decks
  ...Array.from({ length: 10 }, () => ({ role: "cabin" as const })), // Decks 7 to 16
  { role: "public", zones: [1, 9] },
  { role: "public", zones: [2, 8] },
  { role: "public", zones: [3, 7] },
  { role: "public", zones: [4, 6] },
];

function iconClass(name: string, variant: { galleyZones: number[]; topDecks?: ShipSpec["decks"] }): ShipSpec {
  return {
    name,
    LOA: 364.75,
    BOA: 48.47,
    depth: 21,
    draft: 9.25,
    speedKn: 22,
    deck1Z: 3,
    deckHeight: 3,
    decks: variant.topDecks ? [...ICON_DECKS.slice(0, 16), ...variant.topDecks] : ICON_DECKS,
    bulkheadDeck: 5,
    musterDeck: 5,
    zones: 11,
    xAft: 0,
    xFwd: 364.75,
    stairWidthMm: 2000,
    pax: 7600,
    crew: 2350,
    machineryZones: [3, 4, 5],
    galleyZones: variant.galleyZones,
    fuelZones: [3, 4, 5, 6],
    freshWaterZones: [2, 7],
    lifeboats: { perSide: 14, capacity: 370, massT: 30, x0: 70, x1: 290 },
    rafts: { count: 18, capacity: 150 },
    lightship: ICON_LIGHTSHIP,
    deadweight: { massT: 3000, lcg: 180, kg: 14 },
  };
}
// Calibrated so the ship floats at its published draught (scripts/calibrate-ships.ts).
const ICON_LIGHTSHIP = { massT: 41295, lcg: 172.61, kg: 23.55 };
const MS7_LIGHTSHIP = { massT: 28586, lcg: 141.16, kg: 12.54 };

// Mein Schiff 7 (Meyer Turku, TUI Cruises, 2024): 315.7 m, 35.8 m moulded breadth, about 8.2 m draught,
// 16 decks (10 with cabins), 2,894 passengers maximum, 1,000 crew, 22 kn (Meyer Turku, portguide.org, CruiseMapper).
const MS7: ShipSpec = {
  name: "Mein Schiff 7",
  LOA: 315.7,
  BOA: 35.8,
  depth: 15,
  draft: 8.2,
  speedKn: 22,
  deck1Z: 3,
  deckHeight: 3,
  decks: [
    { role: "tank" },
    { role: "machinery" },
    { role: "crew" },
    { role: "service" },
    { role: "muster" },
    ...Array.from({ length: 10 }, () => ({ role: "cabin" as const })), // Decks 6 to 15
    { role: "public", zones: [1, 7] },
  ],
  bulkheadDeck: 4,
  musterDeck: 5,
  zones: 9,
  xAft: 0,
  xFwd: 315.7,
  stairWidthMm: 1800,
  pax: 2894,
  crew: 1000,
  machineryZones: [3, 4],
  galleyZones: [2, 5],
  fuelZones: [3, 4, 5],
  freshWaterZones: [2, 6],
  lifeboats: { perSide: 14, capacity: 150, massT: 15, x0: 70, x1: 240 },
  rafts: { count: 7, capacity: 150 },
  lightship: MS7_LIGHTSHIP,
  deadweight: { massT: 2000, lcg: 155, kg: 12 },
};

export interface ModelEntry {
  id: string;
  label: string;
  note: string;
  make: () => Design;
}

export const MODELS: ModelEntry[] = [
  { id: "demo", label: "Demo ferry 120 m", note: "Training ship with deliberate problems", make: demoDesign },
  { id: "icon", label: "Icon of the Seas", note: "2023, 364.75 m, 20 decks", make: () => build(iconClass("Icon of the Seas", { galleyZones: [2, 5, 8] })) },
  { id: "star", label: "Star of the Seas", note: "2025, 364.75 m, 20 decks", make: () => build(iconClass("Star of the Seas", { galleyZones: [3, 6, 8] })) },
  {
    id: "legend",
    label: "Legend of the Seas",
    note: "2026, 364.75 m, 20 decks",
    make: () =>
      build(
        iconClass("Legend of the Seas", {
          galleyZones: [2, 6, 9],
          topDecks: [
            { role: "public", zones: [1, 9] },
            { role: "public", zones: [1, 8] },
            { role: "public", zones: [3, 7] },
            { role: "public", zones: [4, 7] },
          ],
        }),
      ),
  },
  { id: "ms7", label: "Mein Schiff 7", note: "2024, 315.7 m, 16 decks", make: () => build(MS7) },
];

export { build as buildModelShip, type ShipSpec };
