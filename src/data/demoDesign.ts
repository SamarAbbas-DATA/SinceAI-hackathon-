// Demo design: a 120 m passenger ferry on the vessel.js "Cruise" hull form.
// Built in code so that every door sits exactly on a shared wall.
// It contains a few deliberate problems so the early-warning flags have something to show.
import type { Design, Space, Door, FireRating } from "../engine/types";
import { pairKey } from "../engine/types";
import { sharedEdges } from "../engine/topology";
import { requiredMinutes } from "../engine/rules";
import { defaultRuns } from "../engine/generators";

export function blankDesign(): Design {
  return {
    version: 1,
    name: "New design",
    hull: { template: "cruise", LOA: 120, BOA: 20, depth: 9, designDraft: 5.2, designSpeedKn: 18, parsonsK: 0.037 },
    decks: [
      { id: "D1", name: "Deck 1", z: 2 },
      { id: "D2", name: "Deck 2", z: 6 },
      { id: "D3", name: "Deck 3", z: 9 },
      { id: "D4", name: "Deck 4", z: 12 },
      { id: "D5", name: "Deck 5", z: 15 },
    ],
    bulkheadDeckId: "D3",
    spaces: [],
    doors: [],
    bulkheads: [],
    lsa: [],
    runs: [],
    divisions: {},
    loading: { lightshipOverride: null, deadweight: { massT: 0, lcg: 60, kg: 3 }, personMassKg: 100 },
    people: { passengers: 0, crew: 0 },
    evacuation: { scenario: "night", embarkLaunchMin: 30, roRo: false },
  };
}

export function demoDesign(): Design {
  const d = blankDesign();
  d.name = "Demo ferry 120 m";
  // Open sun deck only 2.3 m above Deck 5: less headroom than on the reference ships (REFERENCE-SHIPS hint).
  d.decks.push({ id: "D6", name: "Deck 6", z: 17.3 });
  const spaces: Space[] = [];
  const doors: Door[] = [];
  const divisions: Record<string, FireRating> = {};
  let n = 0;
  const door = (deckId: string, x: number, y: number, widthMm = 800) => doors.push({ id: `door${++n}`, deckId, x, y, widthMm });
  const box = (s: Omit<Space, "xCentre" | "yCentre" | "length" | "breadth">, x0: number, x1: number, y0: number, y1: number): Space => {
    const sp = { ...s, xCentre: (x0 + x1) / 2, yCentre: (y0 + y1) / 2, length: x1 - x0, breadth: y1 - y0 } as Space;
    spaces.push(sp);
    return sp;
  };

  // --- Vertical escapes
  const stairA = box({ id: "stairA", name: "Stair A", type: "stairwell", deckId: "D2", topDeckId: "D5", persons: 0, stair: { widthMm: 1200, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 } }, 16, 20, 1, 5);
  const stairB = box({ id: "stairB", name: "Stair B", type: "stairwell", deckId: "D1", topDeckId: "D5", persons: 0, stair: { widthMm: 1200, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 } }, 58, 62, -5, -1);
  const trunk = box({ id: "trunk", name: "Engine escape trunk", type: "stairwell", deckId: "D1", topDeckId: "D3", persons: 0, stair: { widthMm: 900, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 } }, 58, 62, 1, 5);
  const stairC = box({ id: "stairC", name: "Stair C", type: "stairwell", deckId: "D2", topDeckId: "D5", persons: 0, stair: { widthMm: 850, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 } }, 84, 88, -5, -1);
  const reservedPort = [
    [16, 20],
    [58, 62],
  ];
  const reservedStbd = [
    [58, 62],
    [84, 88],
  ];

  // --- Deck 1: engine room
  const er = box({ id: "engine", name: "Engine room", type: "engine_room", deckId: "D1", persons: 4 }, 46, 58, -4.5, 4.5);
  door("D1", 58, -2.75, 900);
  door("D1", 58, 2.75, 900);
  void er;
  box({ id: "fuel1", name: "Fuel oil tank", type: "tank", deckId: "D1", persons: 0, tank: { content: "fuel", fillPct: 70 } }, 62, 70, -4, 4);
  box({ id: "fw1", name: "Fresh water tank", type: "tank", deckId: "D1", persons: 0, tank: { content: "fresh_water", fillPct: 100 } }, 70, 78, -4, 4);

  // --- Accommodation decks
  const accDeck = (deckId: string, crew: boolean, extra: { portSkip?: number[][]; stbdSkip?: number[][] } = {}) => {
    const c1 = box({ id: `${deckId}-corr1`, name: `${deckId} corridor aft`, type: "corridor", deckId, persons: 0 }, 16, 40, -1, 1);
    const c2 = box({ id: `${deckId}-corr2`, name: `${deckId} corridor mid`, type: "corridor", deckId, persons: 0 }, 40, 80, -1, 1);
    const c3 = box({ id: `${deckId}-corr3`, name: `${deckId} corridor fwd`, type: "corridor", deckId, persons: 0 }, 80, 92, -1, 1);
    divisions[pairKey(c1.id, c2.id)] = "A-60"; // fire doors in the main vertical zone bulkheads
    divisions[pairKey(c2.id, c3.id)] = "A-60";
    const corrAt = (x: number) => (x < 40 ? c1 : x < 80 ? c2 : c3);
    for (const [side, y0, y1, skip] of [
      ["P", 1, 5, [...reservedPort, ...(extra.portSkip ?? [])]],
      ["S", -5, -1, [...reservedStbd, ...(extra.stbdSkip ?? [])]],
    ] as const) {
      for (let x = 16; x + 4 <= 92; x += 4) {
        if (skip.some(([a, b]) => x < b && x + 4 > a)) continue;
        const cab = box({ id: `${deckId}-cab${side}${x}`, name: `${deckId} cabin ${side}${x}`, type: "cabin", deckId, persons: crew ? 1 : 2 }, x, x + 4, y0, y1);
        door(deckId, x + 2, side === "P" ? 1 : -1, 700);
        void cab;
        void corrAt;
      }
    }
    // stair doors onto the corridors
    if (deckId !== "D1") {
      door(deckId, 18, 1, 900); // stair A
      door(deckId, 60, -1, 900); // stair B
      door(deckId, 86, -1, 900); // stair C
      if (deckId === "D2" || deckId === "D3") door(deckId, 60, 1, 900); // trunk
    }
    return { c1, c2, c3 };
  };
  accDeck("D2", true);
  // Small rooms beside Stair B with a connecting door to the next cabin: that cabin's shortest way out runs
  // through the room (NOAA SWATH report 2.4.2: rooms should not serve as passageways, REFERENCE-SHIPS hint).
  // The cabin keeps its own corridor door, moved to the far corner so its two exits stay 5 m apart.
  const passage = (deckId: string, id: string, name: string, type: Space["type"], x0: number, x1: number, stairX: number, cabX: number, cabDoorX: number, movedTo: number) => {
    box({ id, name, type, deckId, persons: 0 }, x0, x1, -5, -1);
    door(deckId, (x0 + x1) / 2, -1, 800); // onto the corridor
    door(deckId, stairX, -3, 1200); // into Stair B
    door(deckId, cabX, -4.6, 700); // connecting door to the cabin
    doors.find((q) => q.deckId === deckId && q.x === cabDoorX && q.y === -1)!.x = movedTo;
  };
  passage("D2", "D2-store", "D2 crew store", "store", 56, 58, 58, 56, 54, 52.4);
  accDeck("D3", false);
  passage("D3", "D3-laundry", "D3 laundry", "other", 56, 58, 58, 56, 54, 52.4);
  accDeck("D4", false, { portSkip: [[64, 72]] });
  passage("D4", "D4-pantry", "D4 pantry", "store", 56, 58, 58, 56, 54, 52.4);
  const galley = box({ id: "galley", name: "Galley", type: "galley", deckId: "D4", persons: 6 }, 64, 72, 1, 5);
  door("D4", 66, 1, 900);
  door("D4", 70, 1, 900);
  divisions[pairKey(galley.id, "D4-corr2")] = "A-30";

  // --- Deck 5: embarkation deck with assembly stations
  const d5c1 = box({ id: "D5-corr1", name: "D5 corridor aft", type: "corridor", deckId: "D5", persons: 0 }, 16, 40, -1, 1);
  const d5c2 = box({ id: "D5-corr2", name: "D5 corridor mid", type: "corridor", deckId: "D5", persons: 0 }, 40, 80, -1, 1);
  const d5c3 = box({ id: "D5-corr3", name: "D5 corridor fwd", type: "corridor", deckId: "D5", persons: 0 }, 80, 92, -1, 1);
  divisions[pairKey(d5c1.id, d5c2.id)] = "A-60";
  divisions[pairKey(d5c2.id, d5c3.id)] = "A-60";
  box({ id: "musterA", name: "Assembly station A", type: "muster_station", deckId: "D5", persons: 0 }, 20, 40, 1, 7);
  door("D5", 26, 1, 1200);
  door("D5", 36, 1, 1200);
  box({ id: "musterB", name: "Assembly station B", type: "muster_station", deckId: "D5", persons: 0 }, 64, 80, -7, -1);
  door("D5", 68, -1, 1200);
  door("D5", 76, -1, 1200);
  box({ id: "lounge", name: "Lounge", type: "public", deckId: "D5", persons: 40 }, 40, 56, 1, 7);
  door("D5", 44, 1, 1000);
  door("D5", 52, 1, 1000);
  door("D5", 18, 1, 900);
  door("D5", 60, -1, 900);
  door("D5", 86, -1, 900);
  box({ id: "lift1", name: "Lift", type: "lift", deckId: "D2", topDeckId: "D5", persons: 0 }, 76, 78, 1, 3);
  void stairA;
  void stairB;
  void trunk;
  void stairC;

  // Remove D2..D4 cabins that collide with the lift shaft
  const liftRect = { x0: 76, x1: 78, y0: 1, y1: 3 };
  d.spaces = spaces.filter(
    (s) => !(s.type === "cabin" && ["D2", "D3", "D4"].includes(s.deckId) && s.xCentre - s.length / 2 < liftRect.x1 && s.xCentre + s.length / 2 > liftRect.x0 && s.yCentre > 0),
  );
  const removed = new Set(spaces.filter((s) => !d.spaces.includes(s)).map((s) => s.id));
  d.doors = doors.filter((dr) => !(removed.size && ["D2", "D3", "D4"].includes(dr.deckId) && dr.x === 78 && dr.y === 1));
  d.divisions = divisions;
  // Two family cabins on Deck 4 sleep 3 in 16 m2: below the 7.5 m2 per person on the reference ships (GA 23007).
  for (const id of ["D4-cabS20", "D4-cabS24"]) {
    const c = d.spaces.find((s) => s.id === id)!;
    c.persons = 3;
    c.name = `${c.name} (family)`;
  }

  // The forwardmost bulkhead (x 108) is the collision bulkhead: 12 m from the forward perpendicular, more than
  // SOLAS II-1/12.1 allows for this length (COLLISION-BULKHEAD shows it in red; kept as a showcase).
  d.bulkheads = [
    ...[8, 20, 32, 46, 62, 76, 90, 108].map((x, i) => ({ id: `wt${i + 1}`, kind: "watertight" as const, x, rating: "A-0" as const })),
    { id: "mvz1", kind: "fire_zone", x: 40, rating: "A-60" },
    { id: "mvz2", kind: "fire_zone", x: 80, rating: "A-60" },
  ];
  // Give every wall the rating it needs, except the galley/cabin walls (left at A-0 to demo a red flag).
  const byId = new Map(d.spaces.map((s) => [s.id, s]));
  const zoneX = d.bulkheads.filter((b) => b.kind === "fire_zone").map((b) => b.x);
  for (const e of sharedEdges(d)) {
    const A = byId.get(e.a)!,
      B = byId.get(e.b)!;
    if ((A.type === "galley" && B.type === "cabin") || (B.type === "galley" && A.type === "cabin")) continue;
    let req = requiredMinutes(A, B);
    if (e.x0 === e.x1 && zoneX.some((x) => Math.abs(x - e.x0) < 0.05)) req = 60;
    const key = pairKey(A.id, B.id);
    if (req > 0 && !d.divisions[key]) d.divisions[key] = `A-${req}` as FireRating;
  }
  const pax = d.spaces.filter((s) => s.type === "cabin" && s.deckId !== "D2").reduce((a, s) => a + s.persons, 0) + 40;
  const crew = d.spaces.filter((s) => s.deckId === "D2" || s.type === "engine_room" || s.type === "galley").reduce((a, s) => a + s.persons, 0);
  d.people = { passengers: pax, crew };
  d.loading.deadweight = { massT: 500, lcg: 58, kg: 4.0 };
  d.lsa = [
    { id: "lb1", kind: "lifeboat", deckId: "D5", x: 30, y: 8.8, capacity: 60, massT: 3.5 },
    { id: "lb2", kind: "lifeboat", deckId: "D5", x: 50, y: 8.8, capacity: 60, massT: 3.5 },
    { id: "lb3", kind: "lifeboat", deckId: "D5", x: 30, y: -8.8, capacity: 60, massT: 3.5 },
    { id: "lb4", kind: "lifeboat", deckId: "D5", x: 50, y: -8.8, capacity: 60, massT: 3.5 },
    { id: "lr1", kind: "liferaft", deckId: "D5", x: 70, y: 8.6, capacity: 25, massT: 0.2 },
    { id: "lr2", kind: "liferaft", deckId: "D5", x: 74, y: 8.6, capacity: 25, massT: 0.2 },
    { id: "lr3", kind: "liferaft", deckId: "D5", x: 84, y: -8.2, capacity: 25, massT: 0.2 },
  ];

  // --- Major pipes and cables (default arrangement), with two deliberate problems for the flags:
  d.runs = defaultRuns(d);
  // the Deck 4 feeder takes a short cut over the galley (SOLAS II-1/45.5.3: keep it clear of galleys, CABLE-ROUTING)
  const f4 = d.runs.find((r) => r.id === "feeder-D4");
  if (f4) {
    const [a, b] = [f4.points[0], f4.points[f4.points.length - 1]];
    f4.points = [a, { x: 63, y: a.y, deckId: "D4" }, { x: 63, y: 3, deckId: "D4" }, { x: 72.5, y: 3, deckId: "D4" }, { x: 72.5, y: a.y, deckId: "D4" }, b];
  }
  // the first fuel oil line ends at the engine just under the exhaust uptake (MSC/Circ.647 hot surfaces, PIPE-FUEL-HOT)
  const fuel = d.runs.find((r) => r.id === "fuel-1");
  if (fuel) {
    const last = fuel.points[fuel.points.length - 1];
    fuel.points.push({ x: last.x, y: 1.2, deckId: last.deckId }, { x: 50.5, y: 1.2, deckId: last.deckId }); // 0.9 m from the uptake
  }
  return d;
}
