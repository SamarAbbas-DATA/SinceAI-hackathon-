/**
 * 3D print model: what the printed part weighs, where its weight sits, and whether it fits the printer.
 * The printed hull is a closed solid: outer walls of `wall` mm plus sparse infill inside.
 */
import { massProps, type Mesh } from "./mesh";

export interface Material {
  id: string;
  name: string;
  density: number; // g/cm^3
  costPerKg: number; // EUR, typical filament price
}

export const MATERIALS: Material[] = [
  { id: "pla", name: "PLA", density: 1.24, costPerKg: 22 },
  { id: "petg", name: "PETG", density: 1.27, costPerKg: 24 },
  { id: "abs", name: "ABS", density: 1.04, costPerKg: 24 },
  { id: "asa", name: "ASA", density: 1.07, costPerKg: 28 },
  { id: "pa", name: "Nylon (PA)", density: 1.14, costPerKg: 45 },
  { id: "resin", name: "SLA resin", density: 1.15, costPerKg: 45 },
];

export interface Printer {
  id: string;
  name: string;
  bed: [number, number, number]; // mm
}

export const PRINTERS: Printer[] = [
  { id: "p1s", name: "Bambu Lab X1 / P1 (256 mm)", bed: [256, 256, 256] },
  { id: "a1", name: "Bambu Lab A1 (256 mm)", bed: [256, 256, 256] },
  { id: "a1mini", name: "Bambu Lab A1 mini (180 mm)", bed: [180, 180, 180] },
  { id: "mk4", name: "Prusa MK4 (250 x 210)", bed: [250, 210, 220] },
  { id: "core1", name: "Prusa Core One (250 x 220)", bed: [250, 220, 270] },
  { id: "ender3", name: "Creality Ender-3 (220 mm)", bed: [220, 220, 250] },
  { id: "k1max", name: "Creality K1 Max (300 mm)", bed: [300, 300, 300] },
  { id: "form3", name: "Formlabs Form 3 (145 x 145)", bed: [145, 145, 185] },
];

export interface PrintSettings {
  material: string;
  printer: string;
  wall: number; // mm, outer shell thickness (walls and top/bottom layers)
  infill: number; // 0..1
  lineWidth: number; // mm, nozzle line width
  margin: number; // mm kept clear at the bed edge
}

export const DEFAULT_PRINT: PrintSettings = { material: "pla", printer: "p1s", wall: 1.6, infill: 0.15, lineWidth: 0.42, margin: 5 };

export interface PrintMass {
  shell: number; // g
  infill: number; // g
  total: number; // g
  G: [number, number, number]; // centre of gravity of the printed part, mm
  volume: number; // mm^3 enclosed
  area: number; // mm^2
  material: Material;
  cost: number; // EUR
}

/** Shell mass sits on the surface (area centroid), infill mass fills the inside (volume centroid). */
export function printMass(m: Mesh, s: PrintSettings): PrintMass {
  const mp = massProps(m);
  const mat = MATERIALS.find((x) => x.id === s.material) ?? MATERIALS[0];
  const rho = mat.density / 1000; // g/mm^3
  const shellVol = Math.min(mp.volume, mp.area * s.wall);
  const inner = Math.max(0, mp.volume - shellVol);
  const shell = rho * shellVol;
  const infill = rho * inner * s.infill;
  const total = shell + infill;
  const G: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) G[k] = total > 0 ? (shell * mp.areaCentroid[k] + infill * mp.centroid[k]) / total : mp.centroid[k];
  return { shell, infill, total, G, volume: mp.volume, area: mp.area, material: mat, cost: (total / 1000) * mat.costPerKg };
}

export interface BedFit {
  fits: boolean;
  angle: number; // rotation about z that fits (0 = straight)
  heightOk: boolean;
  maxLengthStraight: number; // longest part of this footprint shape that fits without rotation
  maxLengthAny: number; // with the best rotation
}

/** Fit a footprint length x width (mm) on the bed, trying rotations about z (diagonal placement). */
export function bedFit(len: number, wid: number, height: number, p: Printer, margin: number): BedFit {
  const W = p.bed[0] - 2 * margin,
    H = p.bed[1] - 2 * margin;
  const fitsAt = (l: number, w: number, a: number) => {
    const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return l * c + w * s <= W && l * s + w * c <= H;
  };
  let angle = -1;
  for (let a = 0; a <= 90; a += 0.5)
    if (fitsAt(len, wid, a)) {
      angle = a;
      break;
    }
  const ratio = wid / len;
  const maxL = (aSet: number[]) => {
    let lo = 0, hi = Math.hypot(W, H);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (aSet.some((a) => fitsAt(mid, mid * ratio, a))) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const all = Array.from({ length: 181 }, (_, i) => i * 0.5);
  return {
    fits: angle >= 0 && height <= p.bed[2],
    angle: Math.max(angle, 0),
    heightOk: height <= p.bed[2],
    maxLengthStraight: maxL([0, 90]),
    maxLengthAny: maxL(all),
  };
}
