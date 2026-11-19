/**
 * Indexed triangle mesh utilities. Units are whatever the caller uses (the app uses model millimetres).
 * Everything here is pure TS so it runs in the browser, in a worker and in Node tests.
 */

export interface Mesh {
  pos: Float32Array; // xyz per vertex
  idx: Uint32Array; // 3 vertex indices per triangle, counter-clockwise seen from outside
}

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

export function bbox(m: Mesh): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return { min, max };
}

export const size = (b: BBox): [number, number, number] => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

export interface MassProps {
  volume: number; // signed: positive for outward-facing triangles
  area: number;
  centroid: [number, number, number]; // volume centroid
  areaCentroid: [number, number, number];
}

/** Volume, surface area and centroids from the divergence theorem (exact for a closed mesh). */
export function massProps(m: Mesh): MassProps {
  const p = m.pos,
    t = m.idx;
  let V = 0,
    A = 0,
    cx = 0,
    cy = 0,
    cz = 0,
    ax = 0,
    ay = 0,
    az = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3,
      b = t[i + 1] * 3,
      c = t[i + 2] * 3;
    const x1 = p[a], y1 = p[a + 1], z1 = p[a + 2];
    const x2 = p[b], y2 = p[b + 1], z2 = p[b + 2];
    const x3 = p[c], y3 = p[c + 1], z3 = p[c + 2];
    const v = (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6;
    V += v;
    cx += v * (x1 + x2 + x3) / 4;
    cy += v * (y1 + y2 + y3) / 4;
    cz += v * (z1 + z2 + z3) / 4;
    const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1, wx = x3 - x1, wy = y3 - y1, wz = z3 - z1;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const ar = 0.5 * Math.hypot(nx, ny, nz);
    A += ar;
    ax += ar * (x1 + x2 + x3) / 3;
    ay += ar * (y1 + y2 + y3) / 3;
    az += ar * (z1 + z2 + z3) / 3;
  }
  return {
    volume: V,
    area: A,
    centroid: V !== 0 ? [cx / V, cy / V, cz / V] : [0, 0, 0],
    areaCentroid: A > 0 ? [ax / A, ay / A, az / A] : [0, 0, 0],
  };
}

export interface Topology {
  triangles: number;
  vertices: number;
  boundaryEdges: number; // edges used by one triangle: holes
  nonManifoldEdges: number; // edges used by three or more triangles
  flippedEdges: number; // edges whose two triangles disagree on orientation
  degenerate: number; // zero-area triangles
  shells: number; // connected pieces
  watertight: boolean;
}

/** Checks that the mesh is a closed, consistently oriented 2-manifold: what slicers need. */
export function topology(m: Mesh): Topology {
  const t = m.idx,
    p = m.pos;
  const nV = p.length / 3;
  const edges = new Map<number, number>(); // key a*nV+b (a<b) -> packed count / orientation
  let degenerate = 0;
  const fwd = new Map<number, number>();
  for (let i = 0; i < t.length; i += 3) {
    const tri = [t[i], t[i + 1], t[i + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) degenerate++;
    else {
      const a = tri[0] * 3, b = tri[1] * 3, c = tri[2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
      const n2 = (uy * wz - uz * wy) ** 2 + (uz * wx - ux * wz) ** 2 + (ux * wy - uy * wx) ** 2;
      if (n2 < 1e-20) degenerate++;
    }
    for (let k = 0; k < 3; k++) {
      const u = tri[k],
        v = tri[(k + 1) % 3];
      const key = u < v ? u * nV + v : v * nV + u;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      fwd.set(key, (fwd.get(key) ?? 0) + (u < v ? 1 : -1));
    }
  }
  let boundary = 0,
    nonManifold = 0,
    flipped = 0;
  for (const [k, n] of edges) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
    else if (fwd.get(k) !== 0) flipped++;
  }
  // connected pieces (union-find over triangle vertices)
  const parent = new Int32Array(nV).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const used = new Uint8Array(nV);
  for (let i = 0; i < t.length; i += 3) {
    used[t[i]] = used[t[i + 1]] = used[t[i + 2]] = 1;
    const a = find(t[i]);
    parent[find(t[i + 1])] = a;
    parent[find(t[i + 2])] = a;
  }
  let shells = 0;
  for (let i = 0; i < nV; i++) if (used[i] && find(i) === i) shells++;
  return {
    triangles: t.length / 3,
    vertices: nV,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    degenerate,
    shells,
    watertight: boundary === 0 && nonManifold === 0 && flipped === 0,
  };
}

/** Merge vertices closer than `tol` (STL and per-face CAD meshes repeat every vertex). Drops collapsed triangles. */
export function weld(pos: ArrayLike<number>, idx: ArrayLike<number> | null, tol = 1e-4): Mesh {
  const nIn = pos.length / 3;
  const map = new Map<string, number>();
  const outPos: number[] = [];
  const remap = new Uint32Array(nIn);
  const inv = 1 / tol;
  for (let i = 0; i < nIn; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = outPos.length / 3;
      map.set(key, j);
      outPos.push(x, y, z);
    }
    remap[i] = j;
  }
  const triIn = idx ?? Array.from({ length: nIn }, (_, i) => i);
  const outIdx: number[] = [];
  for (let i = 0; i + 2 < triIn.length; i += 3) {
    const a = remap[triIn[i]], b = remap[triIn[i + 1]], c = remap[triIn[i + 2]];
    if (a === b || b === c || a === c) continue;
    outIdx.push(a, b, c);
  }
  return { pos: new Float32Array(outPos), idx: new Uint32Array(outIdx) };
}

export function flip(m: Mesh): Mesh {
  const idx = new Uint32Array(m.idx);
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  return { pos: m.pos, idx };
}

/** Apply p' = M p + o with a row-major 3x3 matrix. Flips winding if det < 0 so normals stay outward. */
export function transform(m: Mesh, M: number[], o: [number, number, number] = [0, 0, 0]): Mesh {
  const p = m.pos,
    q = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    q[i] = M[0] * x + M[1] * y + M[2] * z + o[0];
    q[i + 1] = M[3] * x + M[4] * y + M[5] * z + o[1];
    q[i + 2] = M[6] * x + M[7] * y + M[8] * z + o[2];
  }
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  const out = { pos: q, idx: m.idx };
  return det < 0 ? flip(out) : out;
}

export const rotZ = (deg: number) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
export const rotX = (deg: number) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (deg: number) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const scaleM = (k: number) => [k, 0, 0, 0, k, 0, 0, 0, k];

/** Move so the lowest point sits on z = 0 and the footprint is centred on (cx, cy). */
export function placeOnBed(m: Mesh, cx = 0, cy = 0): Mesh {
  const b = bbox(m);
  return transform(m, scaleM(1), [cx - (b.min[0] + b.max[0]) / 2, cy - (b.min[1] + b.max[1]) / 2, -b.min[2]]);
}

export interface Overhang {
  area: number; // down-facing area steeper than the limit, excluding faces resting on the bed
  fraction: number; // of total area
  bedArea: number; // area touching the bed (adhesion)
}

/** Down-facing surfaces that a printer cannot build without support, for the mesh as it sits (z up, bed at min z). */
export function overhang(m: Mesh, limitDeg = 45): Overhang {
  const p = m.pos,
    t = m.idx;
  const b = bbox(m);
  const zBed = b.min[2],
    eps = Math.max(1e-3, (b.max[2] - b.min[2]) * 1e-4);
  const cosLim = Math.cos(((90 - limitDeg) * Math.PI) / 180); // normal within (90-limit) of straight down
  let area = 0,
    total = 0,
    bed = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, bb = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = p[bb] - p[a], uy = p[bb + 1] - p[a + 1], uz = p[bb + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const n = Math.hypot(nx, ny, nz);
    if (n === 0) continue;
    const ar = n / 2;
    total += ar;
    const down = -nz / n;
    if (down <= cosLim) continue;
    const onBed = Math.max(p[a + 2], p[bb + 2], p[c + 2]) - zBed < eps;
    if (onBed) bed += ar;
    else area += ar;
  }
  return { area, fraction: total > 0 ? area / total : 0, bedArea: bed };
}
