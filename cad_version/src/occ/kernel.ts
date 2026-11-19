/**
 * CAD kernel operations on top of replicad (OpenCascade compiled to WebAssembly).
 * Needs setOC() to have been called (see occ.worker.ts, or the Node test).
 */
import { draw, importSTEP, measureVolume, type Shape3D, type Sketch } from "replicad";

export interface Section {
  x: number;
  y: number[]; // port half, keel (y = 0) to deck edge
  z: number[];
}

type P2 = [number, number];

/** Chord-scaled cubic Bezier controls through points (C1 smooth, no overshoot on uneven spacing). */
function bezierChain(pts: P2[]): { end: P2; c1: P2; c2: P2 }[] {
  const n = pts.length;
  const d = (i: number) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  const tan = (i: number): P2 => {
    if (i === 0) {
      const l = d(0) || 1;
      return [(pts[1][0] - pts[0][0]) / l, (pts[1][1] - pts[0][1]) / l];
    }
    if (i === n - 1) {
      const l = d(n - 2) || 1;
      return [(pts[n - 1][0] - pts[n - 2][0]) / l, (pts[n - 1][1] - pts[n - 2][1]) / l];
    }
    const l = d(i - 1) + d(i) || 1;
    return [(pts[i + 1][0] - pts[i - 1][0]) / l, (pts[i + 1][1] - pts[i - 1][1]) / l];
  };
  const out: { end: P2; c1: P2; c2: P2 }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = d(i) / 3,
      t0 = tan(i),
      t1 = tan(i + 1);
    out.push({ end: pts[i + 1], c1: [pts[i][0] + t0[0] * h, pts[i][1] + t0[1] * h], c2: [pts[i + 1][0] - t1[0] * h, pts[i + 1][1] - t1[1] * h] });
  }
  return out;
}

/** Closed section outline: keel, up the port side, across the deck, down the starboard side. */
function sectionSketch(s: Section) {
  const port: P2[] = s.y.map((y, j) => [y, s.z[j]]);
  const stbd: P2[] = port.map(([y, z]) => [-y, z] as P2).reverse();
  let pen = draw(port[0]);
  for (const seg of bezierChain(port)) pen = pen.cubicBezierCurveTo(seg.end, seg.c1, seg.c2);
  pen = pen.lineTo(stbd[0]);
  const down = bezierChain(stbd);
  for (let i = 0; i < down.length - 1; i++) pen = pen.cubicBezierCurveTo(down[i].end, down[i].c1, down[i].c2);
  const last = down[down.length - 1];
  // finish exactly on the start point so close() adds no zero-length edge
  pen = pen.cubicBezierCurveTo(port[0], last.c1, last.c2);
  return pen.close().sketchOnPlane("YZ", s.x) as Sketch;
}

/** Smooth B-spline solid through the sections. */
export function hullSolid(sections: Section[]): Shape3D {
  const sk = sections.map(sectionSketch);
  return sk[0].loftWith(sk.slice(1), { ruled: false });
}

export interface MeshOut {
  vertices: Float32Array;
  triangles: Uint32Array;
}

export function meshShape(shape: Shape3D, tolerance: number): MeshOut {
  const m = shape.mesh({ tolerance, angularTolerance: 0.15 });
  return { vertices: new Float32Array(m.vertices), triangles: new Uint32Array(m.triangles) };
}

export async function buildHullStep(sections: Section[]) {
  const solid = hullSolid(sections);
  const volume = measureVolume(solid);
  const step = await solid.blobSTEP().arrayBuffer();
  const bb = solid.boundingBox.bounds;
  solid.delete();
  return { step, volume, bounds: bb };
}

export async function readStep(data: ArrayBuffer) {
  const shape = (await importSTEP(new Blob([data]))) as Shape3D;
  const bb = shape.boundingBox;
  const diag = Math.hypot(bb.width, bb.height, bb.depth) || 1;
  const mesh = meshShape(shape, diag * 0.0008);
  let volume = 0;
  try {
    volume = measureVolume(shape);
  } catch {
    volume = 0;
  }
  shape.delete();
  return { ...mesh, volume };
}
