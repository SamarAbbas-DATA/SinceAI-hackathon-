/** Read STL, OBJ, 3MF or STEP into a welded mesh in millimetres-as-given (unit choice is applied later). */
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { weld, type Mesh } from "../core/mesh";
import { occReadStep } from "../occ/client";

export interface Imported {
  name: string;
  format: string;
  raw: Mesh;
  cadVolume?: number;
}

function collect(obj: THREE.Object3D): Float32Array {
  obj.updateMatrixWorld(true);
  const parts: Float32Array[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    let g = m.geometry as THREE.BufferGeometry;
    if (g.index) g = g.toNonIndexed();
    const a = g.getAttribute("position");
    const v = new THREE.Vector3();
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
      out.set([v.x, v.y, v.z], i * 3);
    }
    parts.push(out);
  });
  const n = parts.reduce((s, p) => s + p.length, 0);
  const all = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}

function weldAuto(pos: Float32Array, idx: ArrayLike<number> | null): Mesh {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] < lo) lo = pos[i];
    if (pos[i] > hi) hi = pos[i];
  }
  const tol = Math.max((hi - lo) * 1e-6, 1e-7);
  return weld(pos, idx, tol);
}

export async function importFile(file: File): Promise<Imported> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const name = file.name.replace(/\.[^.]+$/, "");
  const buf = await file.arrayBuffer();
  if (ext === "stl") {
    const g = new STLLoader().parse(buf);
    return { name, format: "STL", raw: weldAuto(g.getAttribute("position").array as Float32Array, null) };
  }
  if (ext === "obj") {
    const grp = new OBJLoader().parse(new TextDecoder().decode(buf));
    return { name, format: "OBJ", raw: weldAuto(collect(grp), null) };
  }
  if (ext === "3mf") {
    const grp = new ThreeMFLoader().parse(buf);
    return { name, format: "3MF", raw: weldAuto(collect(grp), null) };
  }
  if (ext === "step" || ext === "stp") {
    const r = await occReadStep(buf);
    return { name, format: "STEP", raw: weldAuto(r.vertices, r.triangles), cadVolume: r.volume };
  }
  throw new Error(`.${ext} is not supported. Use STEP, STL, OBJ or 3MF.`);
}
