// Exterior shell of the RCRV research vessel: the outside shape and colours as seen in the Navisworks
// views (hull bands, raised forecastle, stepped deckhouse, wheelhouse with sloped windows, exhaust stack).
// Mast, antennas, cranes, A-frame, railings and deck gear are left out. Built as plain triangle lists per
// colour and written to a .glb by scripts/build-rcrv.ts. Coordinates: ship x, y, z in metres.
import { RCRV, rcrvHB, bulbHB, mainHB, stemX, bottomZ } from "./rcrv";

export interface Part {
  name: string;
  color: string; // sRGB hex
  pos: number[];
  nrm: number[];
  idx: number[];
}

export const COLORS = {
  bottom: "#8c2a86",
  band: "#bcd43a",
  shell: "#a63fc4",
  bulwarkAft: "#e9df93",
  bulb: "#d8bb8c",
  workDeck: "#7d3a7c",
  foreDeck: "#e04fc0",
  house: "#ec8a2e",
  houseRoof: "#f19a45",
  wheel: "#2fae4f",
  window: "#2a3038",
  stack: "#a94bd6",
  stackTop: "#d65aa0",
};

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

class Builder {
  parts = new Map<string, Part>();
  part(name: string): Part {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = { name, color: COLORS[name as keyof typeof COLORS], pos: [], nrm: [], idx: [] }));
    return p;
  }
  /** flat quad a-b-c-d (counter-clockwise seen from outside) */
  quad(name: string, a: V3, b: V3, c: V3, d: V3) {
    const p = this.part(name);
    const n = norm(cross(sub(b, a), sub(d, a)));
    const i = p.pos.length / 3;
    for (const v of [a, b, c, d]) p.pos.push(...v), p.nrm.push(...n);
    p.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  tri(name: string, a: V3, b: V3, c: V3) {
    const p = this.part(name);
    const n = norm(cross(sub(b, a), sub(c, a)));
    const i = p.pos.length / 3;
    for (const v of [a, b, c]) p.pos.push(...v), p.nrm.push(...n);
    p.idx.push(i, i + 1, i + 2);
  }
  /** vertical prism over a plan polygon (counter-clockwise from above), z0..z1; optional outward slope of the top */
  prism(wall: string, top: string | null, plan: [number, number][], z0: number, z1: number, flareTop = 0, bottom = false) {
    const c = plan.reduce((a, p) => [a[0] + p[0] / plan.length, a[1] + p[1] / plan.length], [0, 0]);
    const grow = (p: [number, number], k: number): [number, number] => {
      const dx = p[0] - c[0],
        dy = p[1] - c[1];
      const l = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / l) * k, p[1] + (dy / l) * k];
    };
    const upper = plan.map((p) => grow(p, flareTop));
    for (let i = 0; i < plan.length; i++) {
      const j = (i + 1) % plan.length;
      this.quad(wall, [plan[i][0], plan[i][1], z0], [plan[j][0], plan[j][1], z0], [upper[j][0], upper[j][1], z1], [upper[i][0], upper[i][1], z1]);
    }
    if (top) for (let i = 1; i < upper.length - 1; i++) this.tri(top, [upper[0][0], upper[0][1], z1], [upper[i][0], upper[i][1], z1], [upper[i + 1][0], upper[i + 1][1], z1]);
    if (bottom) for (let i = 1; i < plan.length - 1; i++) this.tri(top ?? wall, [plan[0][0], plan[0][1], z0], [plan[i + 1][0], plan[i + 1][1], z0], [plan[i][0], plan[i][1], z0]);
  }
}

/** Plan of a rectangle x0..x1, half-width h, with the forward corners cut by `chamfer` (counter-clockwise). */
function housePlan(x0: number, x1: number, h: number, chamfer: number, frontHalf = h - chamfer): [number, number][] {
  return [
    [x0, -h],
    [x1 - chamfer, -h],
    [x1, -frontHalf],
    [x1, frontHalf],
    [x1 - chamfer, h],
    [x0, h],
  ];
}

const D = RCRV.depth;
const FC = RCRV.forecastleZ;
/** top of the shell side: bulwark above the working deck aft, above the forecastle forward, rising at the bow */
function sheer(x: number): number {
  if (x < RCRV.stepX) return D + 1.0;
  return FC + 1.0 + 0.7 * Math.pow(Math.max(0, (x - 48) / (RCRV.LOA - 48)), 2);
}

/** Half-breadth of the outside shell, also above the moulded depth (wall-sided with a little bow flare). */
function shellHB(x: number, z: number): number {
  if (z <= D) return rcrvHB(x, z);
  if (x > stemX(z)) return 0;
  const base = mainHB(Math.min(x, stemX(D) - 1e-3), D - 1e-3);
  const xs = stemX(z);
  // keep the stem closing smoothly above the deck
  const u = x > stemX(D) - 6 ? Math.min(1, (x - (stemX(D) - 6)) / Math.max(0.1, xs - (stemX(D) - 6))) : 0;
  const closing = u > 0 ? Math.pow(Math.max(0, 1 - Math.pow(u, 2.2)), 0.6) : 1;
  const flare = x > 40 ? 0.04 * (z - D) * ((x - 40) / 20) : 0;
  return Math.max(0, (u > 0 ? mainHB(stemX(D) - 6, D - 1e-3) * closing : base) + flare);
}

function hullColour(x: number, z: number, T: number): keyof typeof COLORS {
  const b = bulbHB(x, z);
  if (b > 0 && b >= mainHB(x, z) - 0.02 && z < 2.4) return "bulb";
  if (x > 50 && z < 2.5 && mainHB(x, z) < 0.05) return "bulb"; // the nose, where the stem has already ended
  if (z < T - 0.25) return "bottom";
  if (z < D) return "band";
  return x < RCRV.stepX ? "bulwarkAft" : "shell";
}

export function rcrvExterior(T = RCRV.draft): Part[] {
  const B = new Builder();
  // ---- hull sides (both), as two x-ranges so the shell steps up at the front of the working deck
  const xsOf = (a: number, b: number, step: number) => {
    const n = Math.max(2, Math.ceil((b - a) / step));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  const segments: [number, number][] = [
    [0, RCRV.stepX],
    [RCRV.stepX, RCRV.LOA + 0.6],
  ];
  for (const [xa, xb] of segments) {
    const xs = xsOf(xa, xb, 0.35);
    const top = Math.max(...xs.map(sheer));
    const zs = [...xsOf(0, D, 0.12), ...xsOf(D, top, 0.3).slice(1)];
    // grid of points (x, y(z), z clamped to the sheer)
    const P = xs.map((x) => zs.map((z): V3 => {
      const zz = Math.min(z, sheer(x));
      return [x, shellHB(x, zz), zz];
    }));
    for (const side of [1, -1]) {
      for (let i = 0; i < xs.length - 1; i++)
        for (let j = 0; j < zs.length - 1; j++) {
          const a = P[i][j],
            b = P[i + 1][j],
            c = P[i + 1][j + 1],
            d = P[i][j + 1];
          if (a[2] === d[2] && b[2] === c[2]) continue; // above the sheer
          const mx = (a[0] + b[0]) / 2,
            mz = (a[2] + d[2]) / 2;
          if (a[1] + b[1] + c[1] + d[1] < 1e-4) continue; // inside the gap between bulb and stem
          const col = hullColour(mx, mz, T);
          const s = (v: V3): V3 => [v[0], side * v[1], v[2]];
          if (side > 0) B.quad(col, s(a), s(d), s(c), s(b));
          else B.quad(col, s(a), s(b), s(c), s(d));
        }
    }
  }
  // transom (x = 0) from its bottom to the bulwark top
  {
    const zb = bottomZ(0);
    const zs = xsOf(zb, D + 1.0, 0.25);
    for (let j = 0; j < zs.length - 1; j++) {
      const h0 = shellHB(0, zs[j]),
        h1 = shellHB(0, zs[j + 1]);
      const col = zs[j] < T - 0.25 ? "bottom" : zs[j] < D ? "band" : "bulwarkAft";
      B.quad(col, [0, h0, zs[j]], [0, -h0, zs[j]], [0, -h1, zs[j + 1]], [0, h1, zs[j + 1]]);
    }
  }
  // step at the front of the working deck: wall of the raised shell, from the working deck up to the bulwark top
  {
    const x = RCRV.stepX;
    const zs = xsOf(D, sheer(x), 0.4);
    for (let j = 0; j < zs.length - 1; j++) {
      const h0 = shellHB(x, zs[j]) - 0.02,
        h1 = shellHB(x, zs[j + 1]) - 0.02;
      B.quad("shell", [x, -h0, zs[j]], [x, h0, zs[j]], [x, h1, zs[j + 1]], [x, -h1, zs[j + 1]]);
    }
    // two doors onto the working deck
    for (const y of [-2.2, 2.2]) B.quad("window", [x - 0.03, y - 0.45, D + 0.05], [x - 0.03, y + 0.45, D + 0.05], [x - 0.03, y + 0.45, D + 2.0], [x - 0.03, y - 0.45, D + 2.0]);
  }
  // ---- decks: working deck aft, forecastle deck forward (the deckhouse sits on it)
  const deckStrip = (name: string, x0: number, x1: number, z: number) => {
    const xs = xsOf(x0, x1, 0.5);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = Math.max(0, shellHB(xs[i], z) - 0.03),
        b = Math.max(0, shellHB(xs[i + 1], z) - 0.03);
      B.quad(name, [xs[i], -a, z], [xs[i + 1], -b, z], [xs[i + 1], b, z], [xs[i], a, z]);
    }
  };
  deckStrip("workDeck", 0, RCRV.stepX, D + 0.01);
  deckStrip("foreDeck", RCRV.stepX, stemX(FC), FC + 0.01);

  // ---- windows in the raised shell (main deck accommodation and labs), both sides
  const zw0 = D + 0.9,
    zw1 = D + 1.6;
  for (let x = 26; x < 54; x += 2.4) {
    const w = x < 42 ? 1.3 : 0.6; // labs have wide windows, cabins portholes
    for (const side of [1, -1]) {
      const y0 = shellHB(x, zw0) + 0.03,
        y1 = shellHB(x + w, zw0) + 0.03;
      const s = side;
      if (s > 0) B.quad("window", [x, y0, zw0], [x + w, y1, zw0], [x + w, y1, zw1], [x, y0, zw1]);
      else B.quad("window", [x, -y0, zw0], [x, -y0, zw1], [x + w, -y1, zw1], [x + w, -y1, zw0]);
    }
  }
  // portholes lower down (lower deck)
  for (let x = 28; x < 50; x += 3) {
    const z = 4.6;
    for (const side of [1, -1]) {
      const y = shellHB(x, z) + 0.03;
      if (side > 0) B.quad("window", [x, y, z], [x + 0.4, y, z], [x + 0.4, y, z + 0.4], [x, y, z + 0.4]);
      else B.quad("window", [x, -y, z], [x, -y, z + 0.4], [x + 0.4, -y, z + 0.4], [x + 0.4, -y, z]);
    }
  }

  // ---- 01 deckhouse (orange), roof = 02 deck
  // roofs sit just above each deck's deckhead, so the pipes under the deckhead stay inside
  const z01 = FC,
    z02 = FC + 2.6,
    zTop = z02 + 2.8 + 0.3;
  B.prism("house", null, housePlan(27, 47, 5.4, 1.8), z01, z02);
  B.prism("houseRoof", "houseRoof", housePlan(26.6, 47.5, 5.9, 2.0), z02, z02 + 0.22, 0, true);
  for (let x = 28; x < 45; x += 2.0)
    for (const side of [1, -1]) {
      const y = side * 5.43,
        z = z01 + 1.0;
      if (side > 0) B.quad("window", [x, y, z], [x + 0.8, y, z], [x + 0.8, y, z + 0.8], [x, y, z + 0.8]);
      else B.quad("window", [x, y, z], [x, y, z + 0.8], [x + 0.8, y, z + 0.8], [x + 0.8, y, z]);
    }
  // ---- wheelhouse on 02 (orange base, green sloped window band, overhanging roof), bridge wings
  const WF = 47; // wheelhouse front
  const wh = housePlan(31, WF, 4.8, 2.0, 2.2);
  B.prism("house", null, wh, z02 + 0.22, z02 + 1.0);
  B.prism("wheel", null, wh, z02 + 1.0, zTop - 0.3, 0.55);
  B.prism("houseRoof", "houseRoof", housePlan(30.4, WF + 0.8, 5.6, 2.4, 2.6), zTop - 0.3, zTop, 0, true);
  // dark glazing on the sloped front
  {
    const zg0 = z02 + 1.35,
      zg1 = zTop - 0.6;
    const k0 = 0.55 * ((zg0 - (z02 + 1.0)) / (zTop - 0.3 - (z02 + 1.0)));
    const k1 = 0.55 * ((zg1 - (z02 + 1.0)) / (zTop - 0.3 - (z02 + 1.0)));
    const f0 = WF + k0 + 0.03,
      f1 = WF + k1 + 0.03;
    B.quad("window", [f0, -1.6, zg0], [f0, 1.6, zg0], [f1, 1.6, zg1], [f1, -1.6, zg1]);
  }
  // bridge wings: thin decks out to the ship's side at the wheelhouse front
  for (const side of [1, -1]) {
    const y0 = side * 4.8,
      y1 = side * 6.0;
    B.prism("houseRoof", "houseRoof", side > 0 ? [[42.5, y0], [46, y0], [46, y1], [42.5, y1]] : [[42.5, y1], [46, y1], [46, y0], [42.5, y0]], z02 + 0.22, z02 + 0.45, 0, true);
  }

  // ---- exhaust stack (starboard, just aft of the step), top sloping down aft, two uptakes
  {
    const x0 = 20.6,
      x1 = 23.9,
      y0 = -5.2,
      y1 = -2.4;
    const zb = D;
    const zA = 14.2,
      zF = 15.0;
    const plan: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (let i = 0; i < 4; i++) {
      const [a, b] = [plan[i], plan[(i + 1) % 4]];
      const za = a[0] === x1 ? zF : zA,
        zb2 = b[0] === x1 ? zF : zA;
      B.quad("stack", [a[0], a[1], zb], [b[0], b[1], zb], [b[0], b[1], zb2], [a[0], a[1], za]);
    }
    B.quad("stackTop", [x0, y0, zA], [x1, y0, zF], [x1, y1, zF], [x0, y1, zA]);
    for (const yc of [-4.3, -3.3]) B.prism("stackTop", "stackTop", [[21.6, yc - 0.3], [22.3, yc - 0.3], [22.3, yc + 0.3], [21.6, yc + 0.3]], zA + 0.2, zF + 0.9);
  }
  return [...B.parts.values()].filter((p) => p.idx.length);
}
