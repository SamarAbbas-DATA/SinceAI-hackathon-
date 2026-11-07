// Exterior livery of the model ships: an outer shell (hull body plus stepped superstructure tiers) painted
// with the operator's colours, logo and ship name. Shown when zoomed out, faded away when zoomed in.
import * as THREE from "three";
import type { Ship } from "../../vendor/vessel/vessel.module.js";
import type { Design } from "../../engine/types";
import { halfBreadthAt, sortedDecks, deckHeight, spaceDeckIds } from "../../engine/vessel";

export interface Livery {
  brand: "rci" | "tui";
  /** Ship name words; RCI names are drawn as WORD "of the" WORD (e.g. ["ICON", "SEAS"]). */
  name: string[];
}

export interface Tier {
  z0: number;
  z1: number;
  x0: number;
  x1: number;
  kind: "cabins" | "public" | "crew" | "other";
}

/** Superstructure tiers above the hull body: one per deck, as long as the rooms on that deck. */
export function liveryTiers(design: Design, ship: Ship): Tier[] {
  const L = design.hull.LOA;
  const D = design.hull.depth;
  const out: Tier[] = [];
  for (const deck of sortedDecks(design)) {
    const z1 = deck.z + deckHeight(design, deck.id);
    if (z1 <= D + 0.01) continue;
    const sp = design.spaces.filter((s) => spaceDeckIds(design, s).includes(deck.id));
    if (!sp.length) continue;
    let x0 = Math.min(...sp.map((s) => s.xCentre - s.length / 2));
    let x1 = Math.max(...sp.map((s) => s.xCentre + s.length / 2));
    // like a real cruise ship: the front steps back about 0.7 m per metre of height above the hull and
    // never stops short of the rooms; aft, the lower tiers reach the transom
    const above = deck.z - D;
    x1 = Math.max(x1, L * 0.965 - 4 - above * 0.7);
    if (above < 9) x0 = Math.min(x0, 0.5 + above * 0.6);
    // keep inside the hull outline at this height
    const inside = (x: number) => halfBreadthAt(ship, Math.min(Math.max(x, 0), L), deck.z + 0.01) > 0.5;
    while (x0 < x1 && !inside(x0)) x0 += 0.5;
    while (x1 > x0 && !inside(x1)) x1 -= 0.5;
    if (x1 - x0 < 2) continue;
    const own = sp.filter((s) => s.deckId === deck.id && s.type !== "stairwell");
    const n = (t: string) => own.filter((s) => s.type === t).length;
    const kind: Tier["kind"] = n("cabin") > own.length / 2 ? (own.some((s) => s.type === "cabin" && s.persons > 0 && s.name.includes("crew")) ? "crew" : "cabins") : n("public") + n("muster_station") > own.length / 3 ? "public" : "other";
    out.push({ z0: Math.max(deck.z, D), z1, x0: Math.max(0, x0), x1: Math.min(L, x1), kind });
  }
  return out;
}

/** Height of the whole shell (top of the highest tier, or the hull depth). */
export function shellTop(design: Design, tiers: Tier[]): number {
  return Math.max(design.hull.depth, ...tiers.map((t) => t.z1));
}

type Geo = { pos: number[]; uv: number[]; idx: number[] };
const newGeo = (): Geo => ({ pos: [], uv: [], idx: [] });
function toBuffer(g: Geo): THREE.BufferGeometry {
  const b = new THREE.BufferGeometry();
  b.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
  b.setAttribute("uv", new THREE.Float32BufferAttribute(g.uv, 2));
  b.setIndex(g.idx);
  b.computeVertexNormals();
  return b;
}

/**
 * Shell geometry cut at zCut: side surfaces for starboard and port (separate, so each gets its own
 * readable texture) and caps (tops and ends). UV: u along the ship, v = z / zFull (so a cut never squashes
 * the paint). Starboard u = x/L (bow on the right seen from outside), port u = 1 - x/L (bow on the left).
 */
export function shellGeometry(ship: Ship, design: Design, tiers: Tier[], zCut: number, zFull: number) {
  const L = design.hull.LOA;
  const D = design.hull.depth;
  const hb = (x: number, z: number) => Math.max(0, Math.min(design.hull.BOA / 2 + 0.05, halfBreadthAt(ship, x, z)));
  const side = { s: newGeo(), p: newGeo() };
  const caps = newGeo();
  const u = (x: number, port: boolean) => (port ? 1 - x / L : x / L);
  const grid = (xs: number[], zs: number[], half: (x: number, z: number) => number) => {
    for (const port of [false, true]) {
      const g = port ? side.p : side.s;
      const base = g.pos.length / 3;
      const sgn = port ? 1 : -1;
      for (const x of xs) for (const z of zs) g.pos.push(x, sgn * half(x, z), z), g.uv.push(u(x, port), z / zFull);
      const M = zs.length;
      for (let i = 0; i < xs.length - 1; i++)
        for (let j = 0; j < M - 1; j++) {
          const a = base + i * M + j,
            b = base + (i + 1) * M + j,
            c = base + (i + 1) * M + j + 1,
            d = base + i * M + j + 1;
          if (port) g.idx.push(a, b, c, a, c, d);
          else g.idx.push(a, c, b, a, d, c);
        }
    }
  };
  // strip across the ship at height z between port and starboard, along xs (a top cap)
  const topStrip = (xs: number[], z: number, half: (x: number) => number) => {
    const base = caps.pos.length / 3;
    for (const x of xs) caps.pos.push(x, half(x), z, x, -half(x), z), caps.uv.push(0, 0, 0, 0);
    for (let k = 0; k < xs.length - 1; k++) {
      const a = base + 2 * k;
      caps.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  };
  // end wall across the ship at x between z levels
  const endWall = (x: number, zs: number[], half: (z: number) => number) => {
    const base = caps.pos.length / 3;
    for (const z of zs) caps.pos.push(x, half(z), z, x, -half(z), z), caps.uv.push(0, 0, 0, 0);
    for (let k = 0; k < zs.length - 1; k++) {
      const a = base + 2 * k;
      caps.idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  };

  // hull body: keel to the moulded depth (or the cut)
  const hull = ship.structure.hull;
  const top = Math.min(D, zCut);
  const xs: number[] = [];
  for (let i = 0; i <= 140; i++) xs.push((L * i) / 140);
  const zs = [...hull.halfBreadths.waterlines.map((w: number) => w * hull.attributes.Depth).filter((z: number) => z < top - 0.05), top];
  grid(xs, zs, hb);
  topStrip(xs, top, (x) => hb(x, top));
  endWall(0, zs, (z) => hb(0, z));

  // superstructure tiers
  for (const t of tiers) {
    if (t.z0 >= zCut) continue;
    const z1 = Math.min(t.z1, zCut);
    const n = Math.max(2, Math.ceil((t.x1 - t.x0) / 3));
    const txs = Array.from({ length: n + 1 }, (_, i) => t.x0 + ((t.x1 - t.x0) * i) / n);
    const half = (x: number) => Math.max(0.5, hb(x, t.z0 + 0.01) - 0.15);
    grid(txs, [t.z0, z1], (x) => half(x));
    topStrip(txs, z1, half);
    endWall(t.x0, [t.z0, z1], () => half(t.x0));
    endWall(t.x1, [t.z0, z1], () => half(t.x1));
  }
  return { stbd: toBuffer(side.s), port: toBuffer(side.p), caps: toBuffer(caps) };
}

// ------------------------------------------------------------------ paint
const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  if (!images.has(src))
    images.set(
      src,
      new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
      }),
    );
  return images.get(src)!;
}

const SERIF = `"EB Garamond", Garamond, "Times New Roman", serif`;
const RCI_NAVY = "#08155a";

/** Draws "ICON of the SEAS" (big words, small stacked "OF / THE"), right edge at xRight, baseline at y. */
function drawRciName(g: CanvasRenderingContext2D, words: string[], xRight: number, baseline: number, cap: number, alignRight: boolean) {
  g.fillStyle = RCI_NAVY;
  g.textBaseline = "alphabetic";
  const big = (w: string) => {
    const parts: { t: string; size: number }[] = [
      { t: w[0], size: cap * 1.32 },
      { t: w.slice(1), size: cap },
    ];
    return parts;
  };
  const pieces: { t: string; size: number; stack?: boolean }[] = [...big(words[0])];
  if (words.length > 1) pieces.push({ t: "", size: cap * 0.42, stack: true }, ...big(words[1]));
  const width = (p: { t: string; size: number; stack?: boolean }) => {
    if (p.stack) {
      g.font = `600 ${p.size}px ${SERIF}`;
      return Math.max(g.measureText("OF").width, g.measureText("THE").width) + cap * 0.5;
    }
    g.font = `500 ${p.size}px ${SERIF}`;
    return g.measureText(p.t).width + cap * 0.02;
  };
  const total = pieces.reduce((a, p) => a + width(p), 0);
  let x = alignRight ? xRight - total : xRight;
  for (const p of pieces) {
    const w = width(p);
    if (p.stack) {
      g.font = `600 ${p.size}px ${SERIF}`;
      g.textAlign = "center";
      g.fillText("OF", x + w / 2, baseline - cap * 0.55);
      g.fillText("THE", x + w / 2, baseline - cap * 0.08);
      g.textAlign = "left";
    } else {
      g.font = `500 ${p.size}px ${SERIF}`;
      g.fillText(p.t, x, baseline);
    }
    x += w;
  }
}

/**
 * Paints one side of the shell. bowRight: starboard seen from outside (bow on the right). ppm = pixels
 * per metre; the canvas covers 0..L by 0..zFull.
 */
export async function paintSide(design: Design, tiers: Tier[], livery: Livery, zFull: number, bowRight: boolean, T: number): Promise<HTMLCanvasElement> {
  const L = design.hull.LOA;
  const D = design.hull.depth;
  const ppm = Math.min(18, 6144 / L);
  const W = Math.ceil(L * ppm),
    H = Math.ceil(zFull * ppm);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const X = (x: number) => (bowRight ? x : L - x) * ppm;
  const Y = (z: number) => H - z * ppm;
  const rect = (x0: number, x1: number, z0: number, z1: number, c: string) => {
    g.fillStyle = c;
    const a = X(x0),
      b = X(x1);
    g.fillRect(Math.min(a, b), Y(z1), Math.abs(b - a), (z1 - z0) * ppm);
  };
  const tui = livery.brand === "tui";
  const hullColour = tui ? "#14264d" : "#f6f6f3";
  // base: white superstructure, hull colour up to the moulded depth, antifouling below the waterline
  g.fillStyle = "#f6f6f3";
  g.fillRect(0, 0, W, H);
  rect(0, L, 0, D, hullColour);
  rect(0, L, 0, T, tui ? "#9b2a26" : "#1f2f57");
  rect(0, L, T, T + 0.35, tui ? "#f6f6f3" : RCI_NAVY);

  // windows and balconies per deck
  const decks = sortedDecks(design);
  for (const d of decks) {
    const z0 = d.z,
      h = deckHeight(design, d.id);
    if (z0 < T + 0.8 || z0 >= zFull) continue;
    const tier = tiers.find((t) => Math.abs(t.z0 - Math.max(z0, D)) < 0.05);
    const inHull = z0 + h <= D + 0.01;
    const x0 = inHull ? L * 0.06 : tier?.x0 ?? 0,
      x1 = inHull ? L * 0.93 : tier?.x1 ?? 0;
    if (x1 - x0 < 2) continue;
    const kind = inHull ? "crew" : tier?.kind ?? "other";
    if (!inHull) rect(x0, x1, z0, z0 + 0.12, "#d9d9d4"); // deck edge line
    if (kind === "cabins") {
      // balcony glazing: a narrow dark band per deck, white partitions every few metres
      rect(x0 + 1, x1 - 1, z0 + h * 0.36, z0 + h * 0.66, "#5b6d84");
      g.fillStyle = "#f6f6f3";
      for (let x = x0 + 1; x < x1 - 1; x += 4.2) g.fillRect(X(x) - Math.max(1, ppm * 0.09), Y(z0 + h * 0.66), Math.max(2, ppm * 0.18), h * 0.3 * ppm);
    } else if (kind === "public") {
      rect(x0 + 1.5, x1 - 1.5, z0 + h * 0.25, z0 + h * 0.8, "#6b8299");
    } else {
      const c = tui && z0 + h <= D + 0.01 ? "#c7d3e4" : "#4a5869";
      for (let x = x0 + 2; x < x1 - 2; x += 2.6) rect(x, x + 0.9, z0 + h * 0.45, z0 + h * 0.72, c);
    }
  }

  // lifeboats and liferaft canisters on this side (the 3D boats sit inside the shell outline)
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  for (const l of design.lsa ?? []) {
    if (l.y >= 0 === bowRight) continue; // port (y > 0) is the side with the bow on the left
    const z = deckZ.get(l.deckId) ?? 0;
    if (z >= zFull) continue;
    if (l.kind === "lifeboat") {
      const len = Math.min(16, 7 + l.capacity / 40);
      g.fillStyle = tui ? "#e8622c" : "#f0b43c";
      const a = X(l.x - len / 2),
        b = X(l.x + len / 2);
      g.beginPath();
      g.roundRect(Math.min(a, b), Y(z + 3.3), Math.abs(b - a), 2.1 * ppm, 0.9 * ppm);
      g.fill();
      rect(l.x - len / 2 + 0.6, l.x + len / 2 - 0.6, z + 2.4, z + 2.75, "#ffffff");
    } else rect(l.x - 0.9, l.x + 0.9, z + 0.8, z + 2, "#e9e4da");
  }

  // operator marks
  if (tui) {
    // white sweep line along the hull, rising towards the bow
    g.strokeStyle = "#f6f6f3";
    g.lineWidth = Math.max(2, ppm * 0.28);
    g.beginPath();
    g.moveTo(X(L * 0.015), Y(T + 1.6));
    g.bezierCurveTo(X(L * 0.4), Y(T + 1.3), X(L * 0.75), Y(D - 2.4), X(L * 0.985), Y(D - 0.9));
    g.stroke();
    const logo = await loadImage("/liveries/mein-schiff.png");
    const h = (D - T) * 0.78;
    const w = (h * logo.width) / logo.height;
    const xc = L * 0.3;
    const a = X(xc) - w * ppm * 0.5;
    g.drawImage(logo, a, Y(T + (D - T) * 0.12 + h), w * ppm, h * ppm);
  } else {
    const crown = await loadImage("/liveries/rci-crown.png");
    const h = Math.min(11, (D - T) * 0.82);
    const w = (h * crown.width) / crown.height;
    const xc = L * 0.08;
    g.drawImage(crown, X(xc) - w * ppm * 0.5, Y(T + (D - T) * 0.1 + h), w * ppm, h * ppm);
    // wait for the serif at most 1.5 s (offline: the system serif is used)
    await Promise.race([document.fonts.load(`500 64px "EB Garamond"`).catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
    const cap = Math.min(6.5, (D - T) * 0.5) * ppm;
    drawRciName(g, livery.name, X(L * 0.925), Y(T + (D - T) * 0.16), cap, bowRight);
  }
  return cv;
}
