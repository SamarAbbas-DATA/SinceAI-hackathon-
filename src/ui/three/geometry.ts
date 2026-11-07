// three.js geometry built from the vessel.js hull (ported from vessel.js Ship3D / HullSideGeometry
// to the current three.js BufferGeometry API, and sampled finer along the length).
import * as THREE from "three";
import type { Ship } from "../../vendor/vessel/vessel.module.js";
import { deckOutline, halfBreadthAt } from "../../engine/vessel";

/** Deck outline limited to x0..x1 (a deck that is open or drawn only over part of the length). */
function plateOutline(ship: Ship, z: number, [x0, x1]: [number, number], samples = 60): [number, number][] {
  const L = ship.structure.hull.attributes.LOA;
  const a = Math.max(0, x0),
    b = Math.min(L, x1);
  const port: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const x = a + ((b - a) * i) / samples;
    port.push([x, Math.max(0, halfBreadthAt(ship, x, z))]);
  }
  return [...port, ...port.map(([x, y]) => [x, -y] as [number, number]).reverse()];
}

export function hullGeometry(ship: Ship, samples = 90): THREE.BufferGeometry {
  const hull = ship.structure.hull;
  const LOA = hull.attributes.LOA;
  const D = hull.attributes.Depth;
  const wls = hull.halfBreadths.waterlines.map((w) => w * D);
  const set = new Set<number>();
  for (let i = 0; i <= samples; i++) set.add(+((LOA * i) / samples).toFixed(5));
  for (const s of hull.halfBreadths.stations) set.add(+(s * LOA).toFixed(5));
  const xs = [...set].sort((a, b) => a - b);
  const N = xs.length,
    M = wls.length;
  // grid of half-breadths with nulls collapsed onto the nearest defined point of the same station
  const grid: { y: number; z: number }[][] = xs.map((x) => {
    const st = hull.getStation(x);
    const col: ({ y: number; z: number } | null)[] = wls.map((z, j) => (st[j] === null || Number.isNaN(st[j] as number) ? null : { y: st[j] as number, z }));
    const first = col.findIndex((c) => c !== null);
    if (first < 0) return wls.map((z) => ({ y: 0, z }));
    let last = first;
    while (last + 1 < M && col[last + 1] !== null) last++;
    return col.map((c, j) => (j < first ? col[first]! : j > last ? col[last]! : c!));
  });
  const pos: number[] = [];
  const idx: number[] = [];
  const v = (x: number, y: number, z: number) => (pos.push(x, y, z), pos.length / 3 - 1);
  // port side and starboard side
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) v(xs[i], side * grid[i][j].y, grid[i][j].z);
    for (let i = 0; i < N - 1; i++)
      for (let j = 0; j < M - 1; j++) {
        const a = base + i * M + j,
          b = base + (i + 1) * M + j,
          c = base + (i + 1) * M + j + 1,
          d = base + i * M + j + 1;
        if (side > 0) idx.push(a, b, c, a, c, d);
        else idx.push(a, c, b, a, d, c);
      }
  }
  // bottom strip and transom (aft cap)
  const strip = (pts: { x: number; y: number; z: number }[]) => {
    const base = pos.length / 3;
    for (const p of pts) v(p.x, p.y, p.z), v(p.x, -p.y, p.z);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = base + 2 * k;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  };
  strip(xs.map((x, i) => ({ x, y: grid[i][0].y, z: grid[i][0].z })));
  strip(wls.map((_, j) => ({ x: xs[0], y: grid[0][j].y, z: grid[0][j].z })));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function deckGeometry(ship: Ship, z: number, plate?: [number, number]): THREE.BufferGeometry {
  const outline = plate ? plateOutline(ship, z + 0.01, plate) : deckOutline(ship, z + 0.01, 80);
  const contour = outline.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos: number[] = [];
  for (const p of contour) pos.push(p.x, p.y, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(tris.flat());
  g.computeVertexNormals();
  return g;
}

/** Transverse section of the hull at x, from the keel up to zTop, as a flat mesh in the y-z plane. */
export function sectionGeometry(ship: Ship, x: number, zTop: number): THREE.BufferGeometry {
  const hull = ship.structure.hull;
  const D = hull.attributes.Depth;
  const wls = hull.halfBreadths.waterlines.map((w) => w * D);
  const st = hull.getStation(x);
  const prof: [number, number][] = [];
  let lastY = 0;
  for (let j = 0; j < wls.length && wls[j] <= zTop; j++) {
    const y = st[j] === null || Number.isNaN(st[j] as number) ? lastY : (st[j] as number);
    prof.push([wls[j], y]);
    lastY = y;
  }
  prof.push([zTop, lastY]);
  const contour = [...prof.map(([z, y]) => new THREE.Vector2(-y, z)), ...[...prof].reverse().map(([z, y]) => new THREE.Vector2(y, z))];
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos: number[] = [];
  for (const p of contour) pos.push(x, p.x, p.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(tris.flat());
  g.computeVertexNormals();
  return g;
}
