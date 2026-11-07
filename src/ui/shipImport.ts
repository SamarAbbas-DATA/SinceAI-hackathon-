// Import of several files at once (File > Import ship files, or drop files on the window):
//   CSV tables (src/engine/shipFiles.ts)  -> a new ship in the model picker, ready to edit and test
//   an exterior .glb in ship coordinates  -> the painted outside of that ship (shown when zoomed out)
//   a design .json                         -> opened as before (with an exterior .glb: as a new ship)
//   other 3D files (.glb .gltf .obj .stl)  -> reference model, as before
//   a hull offsets table alone             -> replaces the hull of the open design, as before
import * as THREE from "three";
import { useStore, type ImportedModel } from "./store";
import { importShipFiles, tableKind, slug, TABLE_LABEL, type ShipFile } from "../engine/shipFiles";
import { parseDesign, parseOffsetsCSV, applyOffsets } from "../engine/io";
import { SHIP_COORDS_TAG } from "../engine/glb";
import type { Design } from "../engine/types";

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const MESH = ["glb", "gltf", "obj", "stl"];

/** An exterior model made for this tool: glTF whose scene carries the ship-coordinates tag. */
async function readShell(name: string, buf: ArrayBuffer): Promise<THREE.Object3D | null> {
  if (!["glb", "gltf"].includes(ext(name))) return null;
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(ext(name) === "glb" ? buf : new TextDecoder().decode(buf), "");
  const tag = (gltf.scene.userData ?? {})[SHIP_COORDS_TAG] as { coords?: string } | undefined;
  if (tag?.coords !== "ship") return null;
  const wrap = new THREE.Group();
  wrap.name = name;
  gltf.scene.rotation.x = Math.PI / 2; // glTF is Y-up, the ship is Z-up
  wrap.add(gltf.scene);
  const none = () => undefined;
  wrap.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.raycast = none; // never in the way of clicks on rooms
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ color: src.color, roughness: 0.7, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false });
    mat.emissive.copy(src.color).multiplyScalar(0.35); // keeps the colours readable under the dim scene lights
    src.dispose();
    m.material = mat;
    m.renderOrder = 30;
  });
  return wrap;
}

export async function importFiles(list: File[]): Promise<void> {
  const st = useStore.getState();
  if (!list.length) return;
  try {
    const csv: ShipFile[] = [];
    const json: File[] = [];
    const meshes: File[] = [];
    const other: string[] = [];
    for (const f of list) {
      const e = ext(f.name);
      if (e === "csv" || e === "txt") csv.push({ name: f.name, text: await f.text() });
      else if (e === "json") json.push(f);
      else if (MESH.includes(e)) meshes.push(f);
      else other.push(f.name);
    }
    // exterior shell among the 3D files
    let shell: THREE.Object3D | null = null;
    const refs: File[] = [];
    for (const f of meshes) {
      const s: THREE.Object3D | null = shell ? null : await readShell(f.name, await f.arrayBuffer());
      if (s) shell = s;
      else refs.push(f);
    }
    const kinds = csv.map((f) => tableKind(f.text));
    const isShip = kinds.includes("decks") || kinds.includes("compartments");
    let design: Design | null = null;
    let summary = "";
    let used: string[] = [];
    if (isShip) {
      const rep = importShipFiles(csv);
      design = rep.design;
      used = rep.read.map((r) => r.file);
      const count = (k: string) => rep.read.find((r) => r.kind === k)?.rows ?? 0;
      summary = `${design.decks.length} decks, ${count("compartments")} compartments, ${count("openings")} doors, ${design.runs.length} pipes and cables`;
      if (rep.skipped.length) summary += `. Left out ${rep.skipped.length}: ${rep.skipped.slice(0, 2).join(" ")}${rep.skipped.length > 2 ? " ..." : ""}`;
      other.push(...rep.ignoredFiles);
    } else if (json.length) {
      design = parseDesign(await json[0].text());
      used = [json[0].name];
      summary = `${design.spaces.length} spaces`;
    } else if (csv.length === 1 && kinds[0] === "hull_offsets") {
      const o = parseOffsetsCSV(csv[0].text);
      st.edit((d) => void applyOffsets(d, o, `Imported: ${csv[0].name}`));
      st.notify(`Hull replaced by ${csv[0].name}: ${o.LOA.toFixed(1)} m long, ${o.BOA.toFixed(1)} m wide.`, "ok");
      return;
    } else if (csv.length) {
      throw new Error(`${csv.map((f) => f.name).join(", ")}: no decks or compartments table found. Expected headers like deck_id,name,z_m or id,name,type,deck,x_aft_m,...`);
    }

    if (design && (isShip || shell)) {
      const d = design;
      const model: ImportedModel = {
        id: `imp-${slug(d.name)}`,
        label: d.name,
        note: `Imported, ${used.length + (shell ? 1 : 0)} files${shell ? ", with exterior" : ""}`,
        make: () => structuredClone(d),
        shell,
        files: [...used, ...(shell ? [shell.name] : [])],
      };
      st.addImported(model);
      useStore.getState().notify(`Imported ${d.name}: ${summary}${shell ? ", exterior shell" : ""}.${other.length ? ` Not used: ${other.join(", ")}.` : ""}`, "ok");
    } else if (design) {
      st.load(design);
    }
    if (!design && shell) {
      // an exterior alone: show it as a reference model in place
      useStore.getState().setRefMesh({ name: shell.name, object: shell, offset: [0, 0, 0], scale: 1, rotZ: 0, visible: true, opacity: 0.5 });
      useStore.getState().notify(`Loaded ${shell.name} as a reference model. Add the decks and compartments tables to import it as a ship.`, "info");
    }
    for (const f of refs) await loadReference(f);
    if (!design && !shell && !refs.length && other.length) throw new Error(`None of these files can be imported: ${other.join(", ")}.`);
  } catch (err) {
    useStore.getState().notify(`Could not import: ${(err as Error).message}`, "error");
  }
}

let loadReference: (f: File) => Promise<void> = async () => undefined;
/** The reference-model loader lives in App.tsx (it also handles STL and OBJ). */
export function setReferenceLoader(fn: (f: File) => Promise<void>) {
  loadReference = fn;
}

/** Fetches the example files shipped with the app (public/models/<name>/) and imports them like an upload. */
export async function openExample(folder: string): Promise<void> {
  const st = useStore.getState();
  try {
    const base = `${import.meta.env.BASE_URL}models/${folder}/`;
    const index = await fetch(`${base}files.txt`);
    if (!index.ok) throw new Error("the example files are missing");
    const names = (await index.text()).split(/\r?\n/).filter(Boolean);
    const files = await Promise.all(
      names.map(async (n) => {
        const r = await fetch(base + n);
        if (!r.ok) throw new Error(`${n} is missing`);
        return new File([await r.blob()], n);
      }),
    );
    await importFiles(files);
  } catch (err) {
    st.notify(`Could not open the example: ${(err as Error).message}`, "error");
  }
}

export const IMPORT_HELP = Object.values(TABLE_LABEL).join(", ");
