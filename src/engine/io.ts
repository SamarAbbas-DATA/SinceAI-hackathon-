// File import / export: our design JSON, and the vessel.js ship specification format.
import type { Design, Space, SpaceType } from "./types";
import { SPACE_TYPES, normalizeDesign } from "./types";
import { buildShipSpec } from "./vessel";
import { blankDesign } from "../data/demoDesign";

export function exportDesign(d: Design): string {
  return JSON.stringify(d, null, 2);
}

export function parseDesign(text: string): Design {
  const j = JSON.parse(text);
  if (j && j.version === 1 && j.hull && Array.isArray(j.spaces)) return normalizeDesign(j as Design);
  if (j && j.structure && j.structure.hull && Array.isArray(j.baseObjects)) return normalizeDesign(importVesselSpec(j));
  throw new Error("This JSON is neither a design file from this app nor a vessel.js ship specification.");
}

export interface OffsetsImport {
  LOA: number;
  BOA: number;
  zMax: number;
  stations: number[]; // metres, shifted so the aft end is 0
  waterlines: number[]; // metres
  table: (number | null)[][]; // half-breadths in metres, [waterline][station]
}

/**
 * Hull offsets table as CSV (the format most hull design programs can export):
 *   first row:   any label, then station positions x in metres (aft to forward)
 *   other rows:  waterline height z in metres, then half-breadths in metres
 *   empty cell:  no hull at that point
 * Separators: comma, semicolon or tab.
 */
export function parseOffsetsCSV(text: string): OffsetsImport {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[;,\t]/).map((c) => c.trim()));
  if (rows.length < 3) throw new Error("An offsets table needs a header row of stations and at least two waterline rows.");
  const xs = rows[0].slice(1).map(Number);
  if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) throw new Error("The first row must list station positions x in metres after the first cell.");
  for (let i = 1; i < xs.length; i++) if (xs[i] <= xs[i - 1]) throw new Error("Station positions must increase from aft to forward.");
  const zs: number[] = [];
  const table: (number | null)[][] = [];
  for (const r of rows.slice(1)) {
    const z = Number(r[0]);
    if (!Number.isFinite(z)) throw new Error(`Waterline height "${r[0]}" is not a number.`);
    if (zs.length && z <= zs[zs.length - 1]) throw new Error("Waterline heights must increase from the keel upwards.");
    zs.push(z);
    table.push(xs.map((_, i) => (r[i + 1] === undefined || r[i + 1] === "" ? null : Math.abs(Number(r[i + 1])))));
  }
  if (table.flat().some((v) => v !== null && !Number.isFinite(v))) throw new Error("Every half-breadth must be a number or empty.");
  const x0 = xs[0];
  const maxHb = Math.max(...table.flat().map((v) => v ?? 0));
  if (maxHb <= 0) throw new Error("All half-breadths are zero.");
  return { LOA: xs[xs.length - 1] - x0, BOA: 2 * maxHb, zMax: zs[zs.length - 1], stations: xs.map((x) => x - x0), waterlines: zs, table };
}

/** Puts an imported offsets table into the design as a custom hull (vessel.js non-dimensional form). */
export function applyOffsets(d: Design, o: OffsetsImport, label: string): Design {
  const depth = Math.min(d.hull.depth, o.zMax);
  d.hull = {
    ...d.hull,
    template: "custom",
    LOA: +o.LOA.toFixed(3),
    BOA: +o.BOA.toFixed(3),
    depth: +depth.toFixed(3),
    designDraft: Math.min(d.hull.designDraft, depth * 0.9),
    custom: {
      label,
      attributes: { bulb: false, transom: o.table.some((r) => (r[0] ?? 0) > 0), cstern: 0, prismaticLengthRatio: 0.6, appendices: {} },
      halfBreadths: {
        stations: o.stations.map((x) => x / o.LOA),
        waterlines: o.waterlines.map((z) => z / depth),
        table: o.table.map((r) => r.map((v) => (v === null ? null : v / (o.BOA / 2)))),
      },
    },
  };
  return d;
}

/** Export as a vessel.js ship specification (opens in the ShipLab / vessel.js examples). */
export function exportVesselSpec(d: Design): string {
  return JSON.stringify(buildShipSpec(d), null, 2);
}

/**
 * Import a vessel.js ship specification: hull offsets, decks and box objects.
 * Offsets in vessel.js are already non-dimensional, so the hull is kept exactly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importVesselSpec(spec: any): Design {
  const d = blankDesign();
  const h = spec.structure.hull;
  const a = h.attributes ?? {};
  d.name = spec.attributes?.name ?? "Imported vessel.js ship";
  d.hull = {
    ...d.hull,
    template: "custom",
    LOA: a.LOA,
    BOA: a.BOA,
    depth: a.Depth,
    designDraft: spec.designState?.calculationParameters?.Draft_design || a.Depth * 0.5,
    designSpeedKn: Number(spec.designState?.calculationParameters?.speed) || 12,
    parsonsK: Number(spec.designState?.calculationParameters?.K) || 0.033,
    custom: {
      label: "Imported vessel.js hull",
      attributes: { bulb: a.bulb ?? false, transom: a.transom ?? false, cstern: a.cstern ?? 0, prismaticLengthRatio: a.prismaticLengthRatio ?? 0.6, appendices: a.appendices ?? {} },
      halfBreadths: h.halfBreadths,
    },
  };
  const decks = Object.entries(spec.structure.decks ?? {}) as [string, { zFloor: number }][];
  d.decks = decks.length ? decks.map(([id, dk]) => ({ id, name: id, z: dk.zFloor })).sort((p, q) => p.z - q.z) : [{ id: "main", name: "Main deck", z: a.Depth }];
  const bhd = [...d.decks].reverse().find((dk) => dk.z <= a.Depth) ?? d.decks[0];
  d.bulkheadDeckId = bhd.id;
  d.bulkheads = Object.entries(spec.structure.bulkheads ?? {}).map(([id, b]) => ({ id, kind: "watertight" as const, x: (b as { xAft: number }).xAft, rating: "A-0" as const }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bases = new Map<string, any>((spec.baseObjects ?? []).map((b: any) => [b.id, b]));
  const spaces: Space[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const o of spec.derivedObjects ?? []) {
    const b = typeof o.baseObject === "string" ? bases.get(o.baseObject) : o.baseObject;
    const rs = o.referenceState ?? {};
    if ((o.affiliations?.group ?? b?.affiliations?.group) === "lsa") {
      const z = rs.zBase ?? 0;
      const deck = [...d.decks].reverse().find((dk) => dk.z <= z + 0.3) ?? d.decks[0];
      const massT = (b?.weightInformation?.lightweight ?? 0) / 1000;
      d.lsa.push({ id: String(o.id), kind: massT > 1 ? "lifeboat" : "liferaft", deckId: deck.id, x: rs.xCentre ?? 0, y: rs.yCentre ?? 0, capacity: massT > 1 ? 60 : 25, massT });
      continue;
    }
    if ((o.affiliations?.group ?? b?.affiliations?.group) === "deadweight") {
      d.loading.deadweight = { massT: (b?.weightInformation?.lightweight ?? 0) / 1000, lcg: rs.xCentre ?? 0, kg: rs.zBase ?? 0 };
      continue;
    }
    const bd = b?.boxDimensions ?? {};
    if (!bd.length || !(bd.breadth ?? bd.width)) continue;
    const z = rs.zBase ?? 0;
    const deck = [...d.decks].reverse().find((dk) => dk.z <= z + 0.3) ?? d.decks[0];
    const group = String(o.affiliations?.group ?? b?.affiliations?.group ?? "").toLowerCase();
    const type: SpaceType = (SPACE_TYPES as readonly string[]).includes(group) ? (group as SpaceType) : /engine|propuls/i.test(o.id) ? "engine_room" : /tank/i.test(o.id) ? "tank" : /stair/i.test(o.id) ? "stairwell" : "other";
    spaces.push({ id: String(o.id), name: String(o.id), type, deckId: deck.id, xCentre: rs.xCentre ?? 0, yCentre: rs.yCentre ?? 0, length: bd.length, breadth: bd.breadth ?? bd.width, persons: 0 });
  }
  d.spaces = spaces;
  return d;
}
