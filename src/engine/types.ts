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
  for (const s of d.spaces) if (s.type === "tank" && !s.tank) s.tank = { content: "fuel", fillPct: 50 };
  return d;
}

export type Status = "grey" | "green" | "amber" | "red";

export interface Finding {
  status: Status;
  message: string; // what is wrong, one sentence
  detail?: string; // why it matters / what was measured against what
  fix?: string; // how to resolve it
  targets: string[]; // ids of spaces, doors, bulkheads, decks, lsa
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
