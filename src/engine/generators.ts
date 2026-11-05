// Build helpers ("stamps") that create several connected parts at once.
import type { Design, Space, Door } from "./types";
import { overlapsWith, sharedEdges, connections, CIRCULATION } from "./topology";
import { sortedDecks } from "./vessel";

let n = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

export interface StampResult {
  ok: boolean;
  error?: string;
  spaces: Space[];
  doors: Door[];
}

function check(design: Design, spaces: Space[]): string | null {
  const probe: Design = { ...design, spaces: [...design.spaces, ...spaces] };
  for (const s of spaces) {
    const hit = overlapsWith(probe, s);
    if (hit.length) return `${s.name} would overlap ${hit[0].name}. Move the stamp to free deck area.`;
  }
  return null;
}

/**
 * Cabin block: a corridor along x with cabins on both sides, one door per cabin.
 * (x0, yC) is the aft end of the corridor centreline.
 */
export function cabinBlock(design: Design, deckId: string, x0: number, yC: number, opts: { cabins: number; cabinLength: number; cabinDepth: number; corridorWidth: number; persons: number }): StampResult {
  const { cabins, cabinLength, cabinDepth, corridorWidth, persons } = opts;
  const len = cabins * cabinLength;
  const tag = deckId;
  const corr: Space = { id: uid("s"), name: `${tag} corridor`, type: "corridor", deckId, xCentre: x0 + len / 2, yCentre: yC, length: len, breadth: corridorWidth, persons: 0 };
  const spaces: Space[] = [corr];
  const doors: Door[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < cabins; i++) {
      const xc = x0 + cabinLength * (i + 0.5);
      const yEdge = yC + (side * corridorWidth) / 2;
      spaces.push({ id: uid("s"), name: `${tag} cabin ${side > 0 ? "P" : "S"}${Math.round(xc)}`, type: "cabin", deckId, xCentre: xc, yCentre: yEdge + (side * cabinDepth) / 2, length: cabinLength, breadth: cabinDepth, persons });
      doors.push({ id: uid("d"), deckId, x: xc, y: yEdge, widthMm: 700 });
    }
  }
  const err = check(design, spaces);
  return err ? { ok: false, error: err, spaces: [], doors: [] } : { ok: true, spaces, doors };
}

/** Stair core: an enclosed stairwell from this deck to the top deck, with a door on its inboard side on every deck. */
export function stairCore(design: Design, deckId: string, x: number, y: number, widthMm = 1200): StampResult {
  const decks = sortedDecks(design);
  const i = decks.findIndex((d) => d.id === deckId);
  const top = decks[decks.length - 1];
  const s: Space = {
    id: uid("s"),
    name: `Stair ${design.spaces.filter((q) => q.type === "stairwell").length + 1}`,
    type: "stairwell",
    deckId,
    topDeckId: top.id,
    xCentre: x,
    yCentre: y,
    length: 4,
    breadth: 4,
    persons: 0,
    stair: { widthMm, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 },
  };
  const err = check(design, [s]);
  if (err) return { ok: false, error: err, spaces: [], doors: [] };
  const doors: Door[] = [];
  const inboardY = y > 0 ? y - 2 : y + 2;
  for (const d of decks.slice(i)) doors.push({ id: uid("d"), deckId: d.id, x, y: inboardY, widthMm: 900 });
  return { ok: true, spaces: [s], doors };
}

/**
 * Adds a door on every wall the space shares with a corridor, public space, assembly station or
 * stairwell where there is no door yet. A cabin-type space gets one door only.
 */
export function autoDoors(design: Design, spaceId: string): Door[] {
  const s = design.spaces.find((x) => x.id === spaceId);
  if (!s) return [];
  const { conns } = connections(design);
  const linked = new Set(conns.filter((c) => c.a === spaceId || c.b === spaceId).map((c) => (c.a === spaceId ? c.b : c.a)));
  const byId = new Map(design.spaces.map((x) => [x.id, x]));
  const out: Door[] = [];
  const isOpen = (t: Space["type"]) => CIRCULATION.includes(t) || t === "stairwell";
  const edges = sharedEdges(design)
    .filter((e) => e.a === spaceId || e.b === spaceId)
    .sort((p, q) => q.length - p.length);
  for (const e of edges) {
    const other = byId.get(e.a === spaceId ? e.b : e.a)!;
    if (linked.has(other.id)) continue;
    if (!(isOpen(other.type) || isOpen(s.type))) continue;
    if (e.length < 0.9) continue;
    if (CIRCULATION.includes(s.type) && CIRCULATION.includes(other.type)) continue; // already open
    out.push({ id: uid("d"), deckId: e.deckId, x: +((e.x0 + e.x1) / 2).toFixed(2), y: +((e.y0 + e.y1) / 2).toFixed(2), widthMm: other.type === "stairwell" || s.type === "stairwell" ? 900 : 800 });
    linked.add(other.id);
    if (["cabin", "store"].includes(s.type)) break;
  }
  return out;
}
