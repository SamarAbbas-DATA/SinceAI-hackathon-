// Ship files: a design as a set of plain CSV tables, the way a CAD or Navisworks export arrives
// (one table per kind of object), plus an optional exterior model (.glb, handled in the UI).
//   particulars.csv      key,value                     main data, people, loading
//   hull_offsets.csv     offsets table (io.ts format)   station x across, waterline z down, half-breadths
//   decks.csv            deck_id,name,z_m,plate_x0_m,plate_x1_m
//   compartments.csv     id,name,type,deck,top_deck,x_aft_m,x_fwd_m,y_stbd_m,y_port_m,persons,...
//   openings.csv         id,deck,x_m,y_m,width_mm      emergency doors
//   bulkheads.csv        id,kind,x_m,rating
//   fire_divisions.csv   space_a,space_b,rating
//   lifesaving.csv       id,kind,deck,x_m,y_m,capacity,mass_t
//   systems.csv          run_id,kind,name,size_mm,point,x_m,y_m,deck
// The kind of each table is found from its header row, so file names do not matter. Rows this tool
// cannot use (an unknown room type, an object on a deck that is not listed) are skipped and reported.
import type { Design, Space, Door, TransverseBulkhead, LSA, Run, FireRating, SpaceType, RunKind, TankContent } from "./types";
import { SPACE_TYPES, FIRE_RATINGS, RUN_KINDS, TANK_CONTENTS, normalizeDesign, pairKey } from "./types";
import { parseOffsetsCSV, applyOffsets } from "./io";
import { blankDesign } from "../data/demoDesign";
import { HULL_TEMPLATES } from "./vessel";

export type TableKind = "particulars" | "hull_offsets" | "decks" | "compartments" | "openings" | "bulkheads" | "fire_divisions" | "lifesaving" | "systems";
export const TABLE_LABEL: Record<TableKind, string> = {
  particulars: "main data",
  hull_offsets: "hull offsets",
  decks: "decks",
  compartments: "compartments",
  openings: "emergency doors",
  bulkheads: "bulkheads",
  fire_divisions: "fire ratings",
  lifesaving: "lifesaving appliances",
  systems: "pipes and cables",
};

// ------------------------------------------------------------------ CSV basics
function cell(v: unknown): string {
  const s = v === undefined || v === null ? "" : typeof v === "number" ? String(+v.toFixed(4)) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function table(header: string[], rows: unknown[][], comment: string[]): string {
  return [...comment.map((c) => `# ${c}`), header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

/** Rows of a CSV text (comma, semicolon or tab), skipping blank and # comment lines; quotes are honoured. */
export function parseCSV(text: string): string[][] {
  const out: string[][] = [];
  let sep = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // the separator comes from the header row (quoted names further down may contain commas)
    if (!sep) sep = line.includes(",") ? "," : line.includes(";") ? ";" : "\t";
    const row: string[] = [];
    let cur = "",
      q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) row.push(cur.trim()), (cur = "");
      else cur += ch;
    }
    row.push(cur.trim());
    out.push(row);
  }
  return out;
}

/** Which table a CSV text holds, from its header row; null if it is not one of ours. */
export function tableKind(text: string): TableKind | null {
  const rows = parseCSV(text);
  if (!rows.length) return null;
  const h = rows[0].map((c) => c.toLowerCase());
  const has = (...k: string[]) => k.every((x) => h.includes(x));
  if (has("key", "value")) return "particulars";
  if (has("run_id")) return "systems";
  if (has("space_a", "space_b")) return "fire_divisions";
  if (has("deck_id", "z_m")) return "decks";
  if (has("type", "x_aft_m", "x_fwd_m")) return "compartments";
  if (has("capacity", "kind")) return "lifesaving";
  if (has("kind", "rating", "x_m")) return "bulkheads";
  if (has("width_mm", "x_m", "y_m")) return "openings";
  if (h.length > 2 && h.slice(1).every((c) => c !== "" && Number.isFinite(Number(c)))) return "hull_offsets";
  return null;
}

// ------------------------------------------------------------------ export
export interface ShipFile {
  name: string;
  text: string;
}

export function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "ship";
}

/** The design as CSV tables. `source` goes into the comment line at the top of every file. */
export function exportShipFiles(d: Design, source: string): ShipFile[] {
  const base = slug(d.name);
  const head = (what: string) => [`${d.name}: ${what}`, `Source: ${source}`, "Units: metres, tonnes, millimetres for widths and sizes. x forward from the stern, y to port, z up from the keel."];
  const files: ShipFile[] = [];
  const h = d.hull;
  const ls = d.loading.lightshipOverride;
  const kv: [string, unknown][] = [
    ["name", d.name],
    ["loa_m", h.LOA],
    ["boa_m", h.BOA],
    ["depth_m", h.depth],
    ["design_draft_m", h.designDraft],
    ["design_speed_kn", h.designSpeedKn],
    ["structural_weight_k", h.parsonsK],
    ["hull_form", h.custom ? "offsets" : h.template],
    ["bulkhead_deck", d.bulkheadDeckId],
    ["passengers", d.people.passengers],
    ["crew", d.people.crew],
    ["person_mass_kg", d.loading.personMassKg],
    ["lightship_t", ls?.massT ?? ""],
    ["lightship_lcg_m", ls?.lcg ?? ""],
    ["lightship_kg_m", ls?.kg ?? ""],
    ["deadweight_t", d.loading.deadweight.massT],
    ["deadweight_lcg_m", d.loading.deadweight.lcg],
    ["deadweight_kg_m", d.loading.deadweight.kg],
    ["evacuation_scenario", d.evacuation.scenario],
    ["embarkation_launching_min", d.evacuation.embarkLaunchMin],
    ["ro_ro", d.evacuation.roRo ? "yes" : "no"],
  ];
  files.push({ name: `${base}_particulars.csv`, text: table(["key", "value"], kv, head("main particulars")) });

  if (h.custom) {
    const hb = h.custom.halfBreadths;
    const xs = hb.stations.map((s) => s * h.LOA);
    const rows = hb.waterlines.map((w, j) => [w * h.depth, ...hb.table[j].map((v) => (v === null ? "" : v * (h.BOA / 2)))]);
    files.push({ name: `${base}_hull_offsets.csv`, text: table(["z \\ x", ...xs.map((x) => cell(x))], rows, head("hull offsets, half-breadths in metres")) });
  }

  files.push({ name: `${base}_decks.csv`, text: table(["deck_id", "name", "z_m", "plate_x0_m", "plate_x1_m"], d.decks.map((k) => [k.id, k.name, k.z, k.plate?.[0] ?? "", k.plate?.[1] ?? ""]), head("decks")) });

  files.push({
    name: `${base}_compartments.csv`,
    text: table(
      ["id", "name", "type", "deck", "top_deck", "x_aft_m", "x_fwd_m", "y_stbd_m", "y_port_m", "persons", "stair_width_mm", "stair_orientation", "stair_handrails_both_sides", "stair_flights_per_deck", "tank_content", "tank_fill_pct", "outfit_kg_m2"],
      d.spaces.map((s) => [
        s.id,
        s.name,
        s.type,
        s.deckId,
        s.topDeckId ?? "",
        s.xCentre - s.length / 2,
        s.xCentre + s.length / 2,
        s.yCentre - s.breadth / 2,
        s.yCentre + s.breadth / 2,
        s.persons,
        s.stair?.widthMm ?? "",
        s.stair?.orientation ?? "",
        s.stair ? (s.stair.handrailsBothSides ? "yes" : "no") : "",
        s.stair?.flightsPerDeck ?? "",
        s.tank?.content ?? "",
        s.tank?.fillPct ?? "",
        s.outfitKgPerM2 ?? "",
      ]),
      head("compartments (rooms, stairs, tanks) as boxes between the given bounds"),
    ),
  });
  files.push({ name: `${base}_openings.csv`, text: table(["id", "deck", "x_m", "y_m", "width_mm"], d.doors.map((o) => [o.id, o.deckId, o.x, o.y, o.widthMm]), head("emergency doors (clear width)")) });
  files.push({ name: `${base}_bulkheads.csv`, text: table(["id", "kind", "x_m", "rating"], d.bulkheads.map((b) => [b.id, b.kind, b.x, b.rating]), head("transverse bulkheads")) });
  files.push({
    name: `${base}_fire_divisions.csv`,
    text: table(
      ["space_a", "space_b", "rating"],
      Object.entries(d.divisions).map(([k, r]) => [...k.split("|"), r]),
      head("fire rating of the wall between two compartments"),
    ),
  });
  files.push({ name: `${base}_lifesaving.csv`, text: table(["id", "kind", "deck", "x_m", "y_m", "capacity", "mass_t"], d.lsa.map((l) => [l.id, l.kind, l.deckId, l.x, l.y, l.capacity, l.massT]), head("lifeboats and liferafts")) });
  files.push({
    name: `${base}_systems.csv`,
    text: table(
      ["run_id", "kind", "name", "size_mm", "point", "x_m", "y_m", "deck"],
      d.runs.flatMap((r) => r.points.map((p, i) => [r.id, r.kind, r.name, r.sizeMm, i + 1, p.x, p.y, p.deckId])),
      head("major pipes and cables: one row per point, at the deckhead of the given deck"),
    ),
  });
  return files;
}

// ------------------------------------------------------------------ import
export interface ImportReport {
  design: Design;
  /** tables that were read, with the number of rows used */
  read: { file: string; kind: TableKind; rows: number }[];
  /** files that are not a ship table */
  ignoredFiles: string[];
  /** rows that were skipped, with the reason */
  skipped: string[];
}

const num = (v: string | undefined, what: string): number => {
  const n = Number(v);
  if (v === undefined || v === "" || !Number.isFinite(n)) throw new Error(`${what} is not a number ("${v ?? ""}").`);
  return n;
};
const opt = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
const r4 = (v: number) => +v.toFixed(4);

/** Builds a design from ship tables. Needs at least decks and compartments. */
export function importShipFiles(files: ShipFile[]): ImportReport {
  const read: ImportReport["read"] = [];
  const ignoredFiles: string[] = [];
  const skipped: string[] = [];
  const byKind = new Map<TableKind, { file: string; rows: Record<string, string>[]; text: string }>();
  for (const f of files) {
    const kind = tableKind(f.text);
    if (!kind) {
      ignoredFiles.push(f.name);
      continue;
    }
    if (byKind.has(kind)) throw new Error(`Two ${TABLE_LABEL[kind]} tables: ${byKind.get(kind)!.file} and ${f.name}. Upload one of them.`);
    const rows = parseCSV(f.text);
    const h = rows[0].map((c) => c.toLowerCase());
    byKind.set(kind, { file: f.name, text: f.text, rows: rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))) });
  }
  const decksT = byKind.get("decks");
  const compT = byKind.get("compartments");
  if (!decksT || !compT) {
    const missing = [!decksT && "decks", !compT && "compartments"].filter(Boolean).join(" and ");
    throw new Error(`No ${missing} table among the files. A ship needs at least a decks table and a compartments table.`);
  }
  const note = (kind: TableKind, rows: number) => read.push({ file: byKind.get(kind)!.file, kind, rows });

  const d = blankDesign();
  d.name = "Imported ship";
  // main data
  const pt = byKind.get("particulars");
  const P = new Map((pt?.rows ?? []).map((r) => [r.key, r.value]));
  if (pt) {
    d.name = P.get("name") || d.name;
    const g = (k: string) => opt(P.get(k));
    d.hull.LOA = g("loa_m") ?? d.hull.LOA;
    d.hull.BOA = g("boa_m") ?? d.hull.BOA;
    d.hull.depth = g("depth_m") ?? d.hull.depth;
    d.hull.designDraft = g("design_draft_m") ?? d.hull.designDraft;
    d.hull.designSpeedKn = g("design_speed_kn") ?? d.hull.designSpeedKn;
    d.hull.parsonsK = g("structural_weight_k") ?? d.hull.parsonsK;
    const form = P.get("hull_form");
    if (form && form !== "offsets" && HULL_TEMPLATES[form]) d.hull.template = form;
    d.people = { passengers: g("passengers") ?? 0, crew: g("crew") ?? 0 };
    d.loading.personMassKg = g("person_mass_kg") ?? d.loading.personMassKg;
    const lm = g("lightship_t");
    d.loading.lightshipOverride = lm ? { massT: lm, lcg: g("lightship_lcg_m") ?? d.hull.LOA / 2, kg: g("lightship_kg_m") ?? d.hull.depth * 0.8 } : null;
    d.loading.deadweight = { massT: g("deadweight_t") ?? 0, lcg: g("deadweight_lcg_m") ?? d.hull.LOA / 2, kg: g("deadweight_kg_m") ?? d.hull.depth / 2 };
    d.evacuation = { scenario: P.get("evacuation_scenario") === "day" ? "day" : "night", embarkLaunchMin: g("embarkation_launching_min") ?? 30, roRo: P.get("ro_ro") === "yes" };
    note("particulars", pt.rows.length);
  }
  // hull offsets
  const ot = byKind.get("hull_offsets");
  if (ot) {
    const o = parseOffsetsCSV(ot.text);
    const draft = d.hull.designDraft;
    if (!pt?.rows.some((r) => r.key === "depth_m")) d.hull.depth = o.zMax;
    applyOffsets(d, o, `Hull offsets from ${ot.file}`);
    d.hull.designDraft = Math.min(draft, d.hull.depth * 0.95);
    note("hull_offsets", o.waterlines.length);
  }
  // decks
  d.decks = [];
  for (const r of decksT.rows) {
    if (!r.deck_id) continue;
    const k: Design["decks"][number] = { id: r.deck_id, name: r.name || r.deck_id, z: num(r.z_m, `Height of deck ${r.deck_id}`) };
    const a = opt(r.plate_x0_m),
      b = opt(r.plate_x1_m);
    if (a !== undefined && b !== undefined && b > a) k.plate = [a, b];
    d.decks.push(k);
  }
  if (!d.decks.length) throw new Error(`The decks table ${decksT.file} has no decks.`);
  d.decks.sort((a, b) => a.z - b.z);
  note("decks", d.decks.length);
  const deckIds = new Set(d.decks.map((k) => k.id));
  const bh = P.get("bulkhead_deck");
  d.bulkheadDeckId = bh && deckIds.has(bh) ? bh : ([...d.decks].reverse().find((k) => k.z <= d.hull.depth + 0.05) ?? d.decks[0]).id;

  // compartments
  const spaces: Space[] = [];
  for (const r of compT.rows) {
    const label = r.name || r.id;
    const type = (r.type || "").toLowerCase();
    if (!(SPACE_TYPES as readonly string[]).includes(type)) {
      skipped.push(`${label}: type "${r.type}" is not one this tool checks.`);
      continue;
    }
    if (!deckIds.has(r.deck)) {
      skipped.push(`${label}: deck "${r.deck}" is not in the decks table.`);
      continue;
    }
    const x0 = num(r.x_aft_m, `${label} x_aft_m`),
      x1 = num(r.x_fwd_m, `${label} x_fwd_m`),
      y0 = num(r.y_stbd_m, `${label} y_stbd_m`),
      y1 = num(r.y_port_m, `${label} y_port_m`);
    if (x1 - x0 < 0.2 || y1 - y0 < 0.2) {
      skipped.push(`${label}: smaller than 0.2 m on one side.`);
      continue;
    }
    if (spaces.some((s) => s.id === r.id)) {
      skipped.push(`${label}: id "${r.id}" is used twice.`);
      continue;
    }
    const s: Space = { id: r.id, name: label, type: type as SpaceType, deckId: r.deck, xCentre: r4((x0 + x1) / 2), yCentre: r4((y0 + y1) / 2), length: r4(x1 - x0), breadth: r4(y1 - y0), persons: Math.max(0, Math.round(opt(r.persons) ?? 0)) };
    if (r.top_deck && deckIds.has(r.top_deck) && r.top_deck !== r.deck) s.topDeckId = r.top_deck;
    if (type === "stairwell")
      s.stair = {
        widthMm: opt(r.stair_width_mm) ?? 900,
        orientation: r.stair_orientation === "athwartships" ? "athwartships" : "fore-aft",
        handrailsBothSides: r.stair_handrails_both_sides !== "no",
        flightsPerDeck: opt(r.stair_flights_per_deck) ?? 2,
      };
    if (type === "tank") s.tank = { content: ((TANK_CONTENTS as readonly string[]).includes(r.tank_content) ? r.tank_content : "fuel") as TankContent, fillPct: Math.min(100, Math.max(0, opt(r.tank_fill_pct) ?? 50)) };
    const ok = opt(r.outfit_kg_m2);
    if (ok !== undefined) s.outfitKgPerM2 = ok;
    spaces.push(s);
  }
  d.spaces = spaces;
  note("compartments", spaces.length);
  const spaceIds = new Set(spaces.map((s) => s.id));

  const ops = byKind.get("openings");
  if (ops) {
    const doors: Door[] = [];
    for (const r of ops.rows) {
      if (!deckIds.has(r.deck)) {
        skipped.push(`Door ${r.id}: deck "${r.deck}" is not in the decks table.`);
        continue;
      }
      doors.push({ id: r.id || `door${doors.length + 1}`, deckId: r.deck, x: num(r.x_m, `Door ${r.id} x`), y: num(r.y_m, `Door ${r.id} y`), widthMm: opt(r.width_mm) ?? 800 });
    }
    d.doors = doors;
    note("openings", doors.length);
  }
  const bt = byKind.get("bulkheads");
  if (bt) {
    const out: TransverseBulkhead[] = [];
    for (const r of bt.rows) {
      const kind = r.kind === "fire_zone" ? "fire_zone" : r.kind === "watertight" ? "watertight" : null;
      if (!kind) {
        skipped.push(`Bulkhead ${r.id}: kind "${r.kind}" is not watertight or fire_zone.`);
        continue;
      }
      out.push({ id: r.id || `bh${out.length + 1}`, kind, x: num(r.x_m, `Bulkhead ${r.id} x`), rating: ((FIRE_RATINGS as readonly string[]).includes(r.rating) ? r.rating : "A-0") as FireRating });
    }
    d.bulkheads = out;
    note("bulkheads", out.length);
  }
  const ft = byKind.get("fire_divisions");
  if (ft) {
    let n = 0;
    for (const r of ft.rows) {
      if (!spaceIds.has(r.space_a) || !spaceIds.has(r.space_b) || !(FIRE_RATINGS as readonly string[]).includes(r.rating)) {
        skipped.push(`Fire rating ${r.space_a} / ${r.space_b}: unknown compartment or rating.`);
        continue;
      }
      d.divisions[pairKey(r.space_a, r.space_b)] = r.rating as FireRating;
      n++;
    }
    note("fire_divisions", n);
  }
  const lt = byKind.get("lifesaving");
  if (lt) {
    const out: LSA[] = [];
    for (const r of lt.rows) {
      if (!["lifeboat", "liferaft"].includes(r.kind) || !deckIds.has(r.deck)) {
        skipped.push(`Lifesaving ${r.id}: unknown kind "${r.kind}" or deck "${r.deck}".`);
        continue;
      }
      out.push({ id: r.id || `lsa${out.length + 1}`, kind: r.kind as LSA["kind"], deckId: r.deck, x: num(r.x_m, `${r.id} x`), y: num(r.y_m, `${r.id} y`), capacity: opt(r.capacity) ?? 25, massT: opt(r.mass_t) ?? 1.5 });
    }
    d.lsa = out;
    note("lifesaving", out.length);
  }
  const st = byKind.get("systems");
  if (st) {
    const runs = new Map<string, Run>();
    const bad = new Set<string>();
    for (const r of st.rows) {
      if (bad.has(r.run_id)) continue;
      if (!(RUN_KINDS as readonly string[]).includes(r.kind) || !deckIds.has(r.deck)) {
        skipped.push(`${r.name || r.run_id}: not a pipe or cable type this tool checks ("${r.kind}"), or unknown deck.`);
        bad.add(r.run_id);
        runs.delete(r.run_id);
        continue;
      }
      let run = runs.get(r.run_id);
      if (!run) runs.set(r.run_id, (run = { id: r.run_id, kind: r.kind as RunKind, name: r.name || r.run_id, sizeMm: opt(r.size_mm) ?? 100, points: [] }));
      run.points.push({ x: num(r.x_m, `${run.name} x`), y: num(r.y_m, `${run.name} y`), deckId: r.deck });
    }
    d.runs = [...runs.values()].filter((r) => r.points.length >= 2);
    note("systems", d.runs.length);
  }
  return { design: normalizeDesign(d), read, ignoredFiles, skipped };
}
