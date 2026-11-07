// Minimal glTF 2.0 binary (.glb) writer for coloured triangle meshes. Input in ship coordinates (x forward,
// y to port, z up); written Y-up as glTF expects: (x, z, -y). Scene extras mark the file as already being
// in ship coordinates and metres, so the app places it without scaling (see ui/shipImport.ts).

export interface GlbPart {
  name: string;
  color: string; // sRGB hex
  pos: number[];
  nrm: number[];
  idx: number[];
}

export const SHIP_COORDS_TAG = "shipPrecheck";

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexToLinear(hex: string): [number, number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1];
}

export function writeGlb(parts: GlbPart[], extras: Record<string, unknown>): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const push = (data: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) chunks.push(new Uint8Array(pad)), (offset += pad);
    return bufferViews.length - 1;
  };
  const materials = parts.map((p) => ({ name: p.name, pbrMetallicRoughness: { baseColorFactor: hexToLinear(p.color), metallicFactor: 0, roughnessFactor: 0.75 }, doubleSided: true }));
  const primitives = parts.map((p, k) => {
    const n = p.pos.length / 3;
    const pos = new Float32Array(p.pos.length);
    const nrm = new Float32Array(p.nrm.length);
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const v = [p.pos[3 * i], p.pos[3 * i + 2], -p.pos[3 * i + 1]];
      const m = [p.nrm[3 * i], p.nrm[3 * i + 2], -p.nrm[3 * i + 1]];
      for (let a = 0; a < 3; a++) {
        pos[3 * i + a] = v[a];
        nrm[3 * i + a] = m[a];
        min[a] = Math.min(min[a], v[a]);
        max[a] = Math.max(max[a], v[a]);
      }
    }
    const bvPos = push(pos, 34962);
    accessors.push({ bufferView: bvPos, componentType: 5126, count: n, type: "VEC3", min, max });
    const aPos = accessors.length - 1;
    accessors.push({ bufferView: push(nrm, 34962), componentType: 5126, count: n, type: "VEC3" });
    const aNrm = accessors.length - 1;
    accessors.push({ bufferView: push(new Uint32Array(p.idx), 34963), componentType: 5125, count: p.idx.length, type: "SCALAR" });
    const aIdx = accessors.length - 1;
    return { attributes: { POSITION: aPos, NORMAL: aNrm }, indices: aIdx, material: k };
  });
  const json = {
    asset: { version: "2.0", generator: "Ship Design Pre-Check" },
    scene: 0,
    scenes: [{ name: "exterior", nodes: [0], extras: { [SHIP_COORDS_TAG]: extras } }],
    nodes: [{ name: "exterior", mesh: 0 }],
    meshes: [{ name: "exterior", primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jpad) {
    const padded = new Uint8Array(jsonBytes.byteLength + jpad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.byteLength + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  let p = 20 + jsonBytes.byteLength;
  dv.setUint32(p, offset, true);
  dv.setUint32(p + 4, 0x004e4942, true); // "BIN\0"
  p += 8;
  for (const c of chunks) out.set(c, p), (p += c.byteLength);
  return out;
}
