/**
 * File writers. All mesh formats are written in millimetres from a watertight, outward-facing mesh.
 * STL: binary, the universal slicer format.
 * 3MF: the modern slicer format (units stored in the file, opened by Bambu Studio, PrusaSlicer, Cura, Orca).
 * OBJ: for Blender, Rhino, Fusion mesh import.
 * STEP comes from the CAD kernel worker (src/occ).
 */
import { zipSync, strToU8 } from "fflate";
import type { Mesh } from "./mesh";

export function toSTL(m: Mesh, name = "hull"): Uint8Array {
  const n = m.idx.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const dv = new DataView(buf);
  const header = `${name} | units: mm | Hull Workshop`.slice(0, 79);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, n, true);
  const p = m.pos,
    t = m.idx;
  let o = 84;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, p[v], true);
      dv.setFloat32(o + 4, p[v + 1], true);
      dv.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

export function toOBJ(m: Mesh, name = "hull"): string {
  const lines: string[] = [`# ${name}`, "# units: millimetres, z up", `o ${name}`];
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) lines.push(`v ${+p[i].toFixed(5)} ${+p[i + 1].toFixed(5)} ${+p[i + 2].toFixed(5)}`);
  const t = m.idx;
  for (let i = 0; i < t.length; i += 3) lines.push(`f ${t[i] + 1} ${t[i + 1] + 1} ${t[i + 2] + 1}`);
  return lines.join("\n") + "\n";
}

export function to3MF(m: Mesh, name = "hull"): Uint8Array {
  const v: string[] = [];
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) v.push(`<vertex x="${+p[i].toFixed(5)}" y="${+p[i + 1].toFixed(5)}" z="${+p[i + 2].toFixed(5)}"/>`);
  const tr: string[] = [];
  const t = m.idx;
  for (let i = 0; i < t.length; i += 3) tr.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`);
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${name}</metadata><metadata name="Application">Hull Workshop</metadata>` +
    `<resources><object id="1" type="model" name="${name}"><mesh><vertices>${v.join("")}</vertices><triangles>${tr.join("")}</triangles></mesh></object></resources>` +
    `<build><item objectid="1"/></build></model>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zipSync({ "[Content_Types].xml": strToU8(types), "_rels/.rels": strToU8(rels), "3D/3dmodel.model": strToU8(model) }, { level: 6 });
}

export function download(data: BlobPart | Uint8Array, filename: string, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
