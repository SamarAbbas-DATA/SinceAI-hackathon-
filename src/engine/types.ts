// Design data model. Coordinates follow vessel.js:
//   x: metres forward from the aft end of the hull (x = 0 is the stern, x = LOA is the bow)
//   y: metres from centreline, positive to port
//   z: metres above baseline (keel)

export const SPACE_TYPES = [
  "cabin",
  "corridor",
  "stairwell",
  "lift",
  "public",
  "galley",
  "engine_room",
  "store",
  "muster_station",
  "tank",
  "void",
  "other",
] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const FIRE_RATINGS = ["A-0", "A-15", "A-30", "A-60"] as const;
export type FireRating = (typeof FIRE_RATINGS)[number];

export const TANK_CONTENTS = ["fuel", "fresh_water", "ballast", "empty"] as const;
export type TankContent = (typeof TANK_CONTENTS)[number];

export interface HullParams {
  template: string; // key into hullTemplates.json
  LOA: number;
  BOA: number;
  depth: number; // moulded depth to the freeboard / uppermost continuous deck
  designDraft: number;
  designSpeedKn: number;
  parsonsK: number; // structural weight coefficient (Parsons table 11.VII), used by vessel.js hull weight
  custom?: {
    // hull offsets imported from a vessel.js ship file or an offsets CSV (non-dimensional, like the templates)
    label: string;
    attributes: Record<string, unknown>;
    halfBreadths: { stations: number[]; waterlines: number[]; table: (number | null)[][] };
  };
}

export interface Deck {
  id: string;
  name: string;
  z: number; // deck floor height above baseline
  /** Drawing only: x range (m) where the deck plate is shown. Lets an open deck above the hull (a forecastle,
   *  the roof of a deckhouse) be drawn without covering the whole length. No effect on any calculation. */
  plate?: [number, number];
}

export interface StairProps {
  widthMm: number; // clear width
  orientation: "fore-aft" | "athwartships";
  handrailsBothSides: boolean;
  flightsPerDeck: number; // flights between two decks (1 = straight run, 2 = with mid landing)
}

export interface TankProps {
  content: TankContent;
  fillPct: number; // 0..100
}

export interface Space {
  id: string;
  name: string;
  type: SpaceType;
  deckId: string; // lowest deck the space sits on
  topDeckId?: string; // stairwells and lifts can span several decks (inclusive)
  xCentre: number;
  yCentre: number;
  length: number; // along x
  breadth: number; // along y
  persons: number;
  stair?: StairProps;
  tank?: TankProps;
  outfitKgPerM2?: number; // optional override of the outfit weight per deck area
}

export interface Door {
  id: string;
  deckId: string;
  x: number;
  y: number;
  widthMm: number;
}

export interface TransverseBulkhead {
  id: string;
  kind: "fire_zone" | "watertight";
  x: number;
  rating: FireRating; // fire integrity of the bulkhead (used for fire_zone kind)
}

/** Life-saving appliance: lifeboat or liferaft station on a deck. */
export interface LSA {
  id: string;
  kind: "lifeboat" | "liferaft";
  deckId: string;
  x: number;
  y: number; // positive = port side
  capacity: number; // persons
  massT: number; // davit + craft
}

/**
 * Major pipes and cables. A run is a polyline of points; each point lies at the deckhead (ceiling) of its
 * deck. Two consecutive points on different decks with the same x and y form a vertical riser.
 */
export const RUN_KINDS = ["fire_main", "bilge_ballast", "fuel_oil", "exhaust", "hv_cable", "feeder_cable"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export const PIPE_KINDS: RunKind[] = ["fire_main", "bilge_ballast", "fuel_oil", "exhaust"];
export const CABLE_KINDS: RunKind[] = ["hv_cable", "feeder_cable"];
export const isCable = (k: RunKind) => CABLE_KINDS.includes(k);

export interface RunPoint {
  x: number;
  y: number;
  deckId: string;
}

export interface Run {
  id: string;
  kind: RunKind;
  name: string;
  sizeMm: number; // outside diameter of the pipe, or of the cable bundle
  points: RunPoint[];
}

export interface PointMass {
  massT: number;
  lcg: number;
  kg: number;
}

export interface Design {
  version: 1;
  name: string;
  hull: HullParams;
  decks: Deck[];
  bulkheadDeckId: string;
  spaces: Space[];
  doors: Door[];
  bulkheads: TransverseBulkhead[];
  lsa: LSA[];
  runs: Run[]; // major pipes and cables
  divisions: Record<string, FireRating>; // key: pairKey(spaceA, spaceB)
  loading: {
    lightshipOverride: PointMass | null; // known lightship replaces the vessel.js parametric estimate
    deadweight: PointMass; // other deadweight (stores, provisions) lumped
    personMassKg: number;
  };
  people: { passengers: number; crew: number };
  evacuation: { scenario: "night" | "day"; embarkLaunchMin: number; roRo: boolean };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Fill defaults for fields added after the first file version, so older files still open. */
export function normalizeDesign(d: Design): Design {
  d.lsa ??= [];
  d.divisions ??= {};
  d.bulkheads ??= [];
  d.doors ??= [];
  d.runs ??= [];
  for (const s of d.spaces) if (s.type === "tank" && !s.tank) s.tank = { content: "fuel", fillPct: 50 };
  return d;
}

export type Status = "grey" | "green" | "amber" | "red";

export interface Finding {
  status: Status;
  message: string; // what is wrong, one sentence
  detail?: string; // why it matters / what was measured against what
  fix?: string; // how to resolve it
  targets: string[]; // ids of spaces, doors, bulkheads, decks, lsa, runs
  at?: RunPoint; // the spot the finding is about (shown as a pin), when it is not a whole part
  measured?: string;
  limit?: string;
  ref?: RuleRef; // the clause of the source document behind this finding (attached by runRules)
}

/** A clause in a source document: local PDF with page number, or an online page. */
export interface RuleRef {
  id: string;
  source: string; // source id in rules.json
  sourceName: string;
  short: string; // short document name for compact labels
  clause: string;
  quote?: string; // exact words from the document
  page?: number; // PDF page (1-based) of the local copy
  file?: string; // local copy in docs/
  url?: string; // online copy
}

export interface RuleResult {
  ruleId: string;
  title: string;
  status: Status;
  summary: string;
  plainMeaning: string;
  source: string;
  sourceName: string;
  clause: string;
  assumed: boolean;
  assumptionNote?: string;
  findings: Finding[];
  refs: RuleRef[]; // every clause this rule is based on, most important first
}
