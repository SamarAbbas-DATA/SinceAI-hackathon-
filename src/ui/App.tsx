import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useStore, previousSession, hasPreviousSession, findModel, type Panel, type Tool, type TestKind } from "./store";
import { Viewport, focusOn } from "./three/Viewport";
import { Inspector, deleteSelection } from "./Inspector";
import { IssuesPanel, HydroPanel, StabilityPanel, DamagePanel, EvacPanel, PerformancePanel, DesignPanel } from "./panels";
import { GuidePanel, SourcesPanel, Tour } from "./help";
import { TestPanel } from "./TestPanel";
import { TYPE_COLOR, TYPE_LABEL, TYPE_ICON, STATUS_VAR, LSA_COLOR, EXIT_COLOR, RUN_COLOR, RUN_ICON } from "./theme";
import { RUN_INFO } from "../engine/systems";
import { sortedDecks, spaceVertical, centreOutsideHull } from "../engine/vessel";
import { exportDesign, exportVesselSpec, parseDesign, parseOffsetsCSV, applyOffsets } from "../engine/io";
import { blankDesign } from "../data/demoDesign";
import { MODELS } from "../data/ships";
import { importFiles, openExample, setReferenceLoader } from "./shipImport";
import { sharedEdges, overlapsWith } from "../engine/topology";
import { requiredMinutes, RULES } from "../engine/rules";
import { autoDoors } from "../engine/generators";
import { pairKey, isCable, PIPE_KINDS, CABLE_KINDS, type SpaceType, type FireRating } from "../engine/types";
import { downloadReport } from "./report";
import { FixBar, startFix, FIX_ICON } from "./FixDirector";
import { f, Icon } from "./fields";

const PALETTE: SpaceType[] = ["cabin", "corridor", "stairwell", "public", "muster_station", "galley", "engine_room", "store", "tank", "lift", "void", "other"];

const TABS: { id: Panel; label: string; testOnly?: boolean }[] = [
  { id: "test", label: "Test", testOnly: true },
  { id: "issues", label: "Issues" },
  { id: "inspect", label: "Inspect" },
  { id: "design", label: "Design" },
  { id: "hydro", label: "Hydrostatics" },
  { id: "stability", label: "Stability" },
  { id: "damage", label: "Damage" },
  { id: "evac", label: "Evacuation" },
  { id: "performance", label: "Performance" },
  { id: "guide", label: "How to use" },
  { id: "sources", label: "Sources" },
];

const ICONS = {
  select: "M5 3l13 7.5-5.6 1.6L10 18z",
  door: "M7 21V4h9v17M4 21h16M13 12.5v.01",
  watertight: "M12 3v18M7 8c1.6-1.4 3.2-1.4 5 0s3.4 1.4 5 0M7 16c1.6-1.4 3.2-1.4 5 0s3.4 1.4 5 0",
  fire: "M12 3c3 3.6 5 6 5 9.5a5 5 0 0 1-10 0c0-1.8.8-3.2 2-4.2 0 1.8.8 3 2 3.2 0-3-.6-5.6 1-8.5z",
  lifeboat: "M3 13h18l-2.6 5H5.6zM8 13V9.5h8V13M12 9.5V6",
  liferaft: "M4.5 12a7.5 4.5 0 1 0 15 0 7.5 4.5 0 1 0-15 0M12 7.5v9",
  layers: "M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  hull: "M3 11h18l-2.8 7H5.8zM8 11V7h6l2 4",
  water: "M3 14c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M3 18.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0",
  bulkheads: "M8 4v16M16 4v16M4 12h16",
  routes: "M4 18h5v-5h5V8h6M17 5l3 3-3 3",
  names: "M5 7h14M9 7v10M15 12h4M17 12v5",
  exits: "M4 4h16v16H4zM9 8v9M9 8h3M13 12.5h5M16 10l2 2.5-2 2.5",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  block: "M3 5h7v5H3zM14 5h7v5h-7zM3 14h7v5H3zM14 14h7v5h-7z",
  stairs: "M4 20h4v-4h4v-4h4V8h4V4",
  logo: "M3 15.5h18l-2.4 4.5H5.4zM6 15.5V10h9.5l3 5.5M9 10V6h4v4",
};

function download(name: string, text: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const OFFSETS_TEMPLATE = `# Hull offsets: first row = label then station x (m, aft to forward); next rows = waterline z (m) then half-breadths (m). Empty = no hull.
z\\x,0,10,20,30,40,50,60,70,80,90,100
0,,2,6,8,8.5,8.5,8.5,8,6,2,
1,3,6,8.5,9.5,9.8,9.8,9.8,9.5,8,4,0.5
3,6,8,9.5,10,10,10,10,10,9,6,1.5
6,7.5,9,10,10,10,10,10,10,9.5,7.5,3
9,8,9.5,10,10,10,10,10,10,10,8.5,4.5
`;

function fixAllWalls() {
  const st = useStore.getState();
  const d = st.design;
  const byId = new Map(d.spaces.map((s) => [s.id, s]));
  const fz = d.bulkheads.filter((b) => b.kind === "fire_zone");
  const scale: Record<string, number> = RULES.fire_rating_scale;
  let changed = 0;
  st.edit((x) => {
    for (const e of sharedEdges(d)) {
      let req = requiredMinutes(byId.get(e.a)!, byId.get(e.b)!);
      if (e.x0 === e.x1 && fz.some((b) => Math.abs(b.x - e.x0) < 0.05)) req = Math.max(req, 60);
      const k = pairKey(e.a, e.b);
      if (req > 0 && scale[x.divisions[k] ?? "A-0"] < req) {
        x.divisions[k] = `A-${req}` as FireRating;
        changed++;
      }
    }
  });
  st.notify(changed ? `Raised ${changed} wall rating${changed > 1 ? "s" : ""} to the required minimum.` : "All walls already meet their minimum rating.", changed ? "ok" : "info");
}

async function loadMesh(file: File) {
  const st = useStore.getState();
  const ext = file.name.split(".").pop()?.toLowerCase();
  const buf = await file.arrayBuffer();
  let obj: THREE.Object3D;
  let yUp = true;
  if (ext === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geo = new STLLoader().parse(buf);
    obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#c8c4bd", side: THREE.DoubleSide }));
    yUp = false;
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    obj = new OBJLoader().parse(new TextDecoder().decode(buf));
  } else if (ext === "glb" || ext === "gltf") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const gltf = await new Promise<{ scene: THREE.Object3D }>((res, rej) => new GLTFLoader().parse(ext === "glb" ? buf : new TextDecoder().decode(buf), "", res as never, rej));
    obj = gltf.scene;
  } else throw new Error("Use .stl, .obj, .gltf or .glb");
  const wrap = new THREE.Group();
  if (yUp) obj.rotation.x = Math.PI / 2; // Y-up formats to the ship's Z-up
  wrap.add(obj);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const L = st.design.hull.LOA;
  const scale = size.x > 0 ? L / size.x : 1;
  obj.position.set(-box.min.x, -(box.min.y + box.max.y) / 2, -box.min.z);
  st.setRefMesh({ name: file.name, object: wrap, offset: [0, 0, 0], scale: +scale.toPrecision(4), rotZ: 0, visible: true, opacity: 0.35 });
  st.notify(`Loaded ${file.name}, scaled to the hull length (x ${scale.toPrecision(3)}). Adjust it in Design > Reference model.`, "ok");
}

setReferenceLoader(loadMesh);

export function App() {
  const st = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const meshRef = useRef<HTMLInputElement>(null);
  const shipRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  // drop files anywhere on the window: same as File > Import ship files
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth++;
      setDropping(true);
    };
    const over = (e: DragEvent) => has(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!has(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      if (useStore.getState().fix || useStore.getState().mode !== "design") return useStore.getState().notify("Switch to Design mode to import files.", "info");
      void importFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", st.theme === "dark");
  }, [st.theme]);

  useEffect(() => {
    // The interactive tour opens every time the app starts; every step has "Skip tour".
    const t = setTimeout(() => useStore.getState().set({ tourStep: 0 }), 1200);
    return () => clearTimeout(t);
  }, []);

  // Edits live in memory (per model); warn only when the page is reloaded or closed.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!useStore.getState().hasUnsavedEdits()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = useStore.getState();
      if (s.fix) {
        if (e.key === " " && s.fix.phase === "running") (e.preventDefault(), s.setFix({ paused: !s.fix.paused }));
        return; // editing is locked during a fix run
      }
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) return (e.preventDefault(), s.undo());
      if (mod && (k === "y" || (k === "z" && e.shiftKey))) return (e.preventDefault(), s.redo());
      if (mod && k === "d" && s.selection?.kind === "space") return (e.preventDefault(), duplicateSelected());
      if (mod) return;
      if (s.tool.kind === "run" && ["Delete", "Backspace", "Enter"].includes(e.key)) return; // handled by the drawing tool
      if (e.key === "Delete" || e.key === "Backspace") return deleteSelection();
      if (e.key === "Escape") return s.set({ tool: { kind: "select" }, tourStep: null });
      if (e.key.startsWith("Arrow") && s.selection?.kind === "space") {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.5;
        s.editSpace(s.selection.id, (t) => {
          if (e.key === "ArrowUp") t.xCentre += step;
          if (e.key === "ArrowDown") t.xCentre -= step;
          if (e.key === "ArrowLeft") t.yCentre += step;
          if (e.key === "ArrowRight") t.yCentre -= step;
        });
        return;
      }
      const num = "1234567890".indexOf(e.key);
      if (num >= 0 && num < PALETTE.length && s.mode === "design") return s.set({ tool: { kind: "space", type: PALETTE[num] } });
      const map: Record<string, Tool> = {
        v: { kind: "select" },
        d: { kind: "door" },
        w: { kind: "bulkhead", bk: "watertight" },
        z: { kind: "bulkhead", bk: "fire_zone" },
        l: { kind: "lsa", lsa: "lifeboat" },
        r: { kind: "lsa", lsa: "liferaft" },
        b: { kind: "stamp", stamp: "cabin_block" },
        k: { kind: "stamp", stamp: "stair_core" },
        e: { kind: "route" },
        p: { kind: "run", run: s.runKinds.pipe },
        c: { kind: "run", run: s.runKinds.cable },
      };
      if (map[k] && s.mode === "design") return s.set({ tool: map[k] });
      if (k === "t") return switchMode(s.mode === "design" ? "test" : "design");
      if (k === "f" && s.selection?.kind === "space") {
        const sp = s.design.spaces.find((x) => x.id === s.selection!.id);
        if (sp) {
          const v = spaceVertical(s.design, sp);
          focusOn(sp.xCentre, sp.yCentre, v.zBase + v.height / 2);
        }
      }
      if (e.key === "?") s.set({ tourStep: 0 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const decks = sortedDecks(st.design);
  const a = st.analysis;
  const c = a?.condition;
  const view = (mode: string) => window.dispatchEvent(new CustomEvent("viewport:view", { detail: mode }));
  const testing = st.mode === "test";
  const name = st.design.name.replace(/\W+/g, "_");

  const menus: Record<string, { label: string; onClick: () => void; hint?: string; disabled?: boolean; sep?: boolean }[]> = {
    File: [
      { label: "New empty design", onClick: () => confirm("Start a new empty design? You can undo this.") && st.load(blankDesign()) },
      { label: "Reset this model to its original design", onClick: () => st.load((findModel(st, st.modelId) ?? MODELS[0]).make()) },
      {
        label: "Restore last session",
        onClick: () => {
          const prev = previousSession();
          if (prev) st.load(prev);
        },
        disabled: !hasPreviousSession(),
      },
      { label: "Open design or vessel.js file", hint: ".json", onClick: () => fileRef.current?.click(), sep: true },
      { label: "Import ship files", hint: "several .csv .glb", onClick: () => shipRef.current?.click(), disabled: testing || !!st.fix },
      { label: "Open example: RCRV research vessel", hint: "imported", onClick: () => void openExample("rcrv"), disabled: testing || !!st.fix },
      { label: "Import hull offsets", hint: ".csv", onClick: () => csvRef.current?.click() },
      { label: "Import 3D reference model", hint: ".stl .obj .glb", onClick: () => meshRef.current?.click() },
      { label: "Save design", hint: ".design.json", onClick: () => download(`${name}.design.json`, exportDesign(st.design)), sep: true },
      { label: "Export vessel.js ship", hint: ".json", onClick: () => download(`${name}.vessel.json`, exportVesselSpec(st.design)) },
      { label: "Offsets CSV template", hint: ".csv", onClick: () => download("offsets_template.csv", OFFSETS_TEMPLATE, "text/csv") },
      { label: "Download PDF report", hint: ".pdf", onClick: () => downloadReport(), sep: true },
    ],
    Edit: [
      { label: "Undo", hint: "Ctrl Z", onClick: st.undo, disabled: !st.past.length },
      { label: "Redo", hint: "Ctrl Y", onClick: st.redo, disabled: !st.future.length },
      { label: "Duplicate space", hint: "Ctrl D", onClick: duplicateSelected, disabled: st.selection?.kind !== "space", sep: true },
      { label: "Delete selected", hint: "Del", onClick: deleteSelection, disabled: !st.selection },
      {
        label: "Auto doors for selected space",
        onClick: () => {
          if (st.selection?.kind !== "space") return;
          const doors = autoDoors(st.design, st.selection.id);
          if (!doors.length) return st.notify("No door needed: neighbours are already connected.", "info");
          st.edit((d) => void d.doors.push(...doors));
          st.notify(`Added ${doors.length} door${doors.length > 1 ? "s" : ""}.`, "ok");
        },
        disabled: st.selection?.kind !== "space",
        sep: true,
      },
      { label: "Set every wall to its minimum rating", onClick: fixAllWalls },
    ],
    Build: [
      ...PALETTE.map((t, i) => ({ label: TYPE_LABEL[t], hint: i < 10 ? String((i + 1) % 10) : "", onClick: () => st.set({ tool: { kind: "space", type: t } }) })),
      { label: "Cabin block", hint: "B", onClick: () => st.set({ tool: { kind: "stamp", stamp: "cabin_block" } }), sep: true },
      { label: "Stair core", hint: "K", onClick: () => st.set({ tool: { kind: "stamp", stamp: "stair_core" } }) },
      { label: "Emergency door", hint: "D", onClick: () => st.set({ tool: { kind: "door" } }), sep: true },
      { label: "Escape route", hint: "E", onClick: () => st.set({ tool: { kind: "route" } }) },
      { label: "Watertight bulkhead", hint: "W", onClick: () => st.set({ tool: { kind: "bulkhead", bk: "watertight" } }) },
      { label: "Fire zone bulkhead", hint: "Z", onClick: () => st.set({ tool: { kind: "bulkhead", bk: "fire_zone" } }) },
      { label: "Lifeboat", hint: "L", onClick: () => st.set({ tool: { kind: "lsa", lsa: "lifeboat" } }) },
      { label: "Liferaft", hint: "R", onClick: () => st.set({ tool: { kind: "lsa", lsa: "liferaft" } }) },
      ...PIPE_KINDS.map((k, i) => ({ label: RUN_INFO[k].label, hint: i === 0 ? "P" : "", sep: i === 0, onClick: () => st.set({ tool: { kind: "run", run: k }, runKinds: { ...st.runKinds, pipe: k } }) })),
      ...CABLE_KINDS.map((k, i) => ({ label: RUN_INFO[k].label, hint: i === 0 ? "C" : "", onClick: () => st.set({ tool: { kind: "run", run: k }, runKinds: { ...st.runKinds, cable: k } }) })),
    ],
    View: [
      { label: st.theme === "dark" ? "Light theme" : "Dark theme", onClick: () => st.setTheme(st.theme === "dark" ? "light" : "dark") },
      { label: "Perspective", onClick: () => view("3d"), sep: true },
      { label: "Plan", onClick: () => view("plan") },
      { label: "Side", onClick: () => view("side") },
      { label: "Bow", onClick: () => view("bow") },
      { label: `${st.view.isolateDeck ? "Show" : "Hide"} decks above`, onClick: () => st.setView({ isolateDeck: !st.view.isolateDeck }), sep: true },
      { label: `${st.view.showLabels ? "Hide" : "Show"} space names`, onClick: () => st.setView({ showLabels: !st.view.showLabels }) },
      { label: `${st.view.showRoutes ? "Hide" : "Show"} escape routes`, onClick: () => st.setView({ showRoutes: !st.view.showRoutes }) },
      { label: `${st.view.showDoors ? "Hide" : "Show"} emergency door icons`, onClick: () => st.setView({ showDoors: !st.view.showDoors }) },
      { label: `${st.view.showPipes ? "Hide" : "Show"} pipes`, onClick: () => st.setView({ showPipes: !st.view.showPipes }), sep: true },
      { label: `${st.view.showCables ? "Hide" : "Show"} cables`, onClick: () => st.setView({ showCables: !st.view.showCables }) },
    ],
    Analyze: TABS.filter((t) => !t.testOnly && !["guide", "sources"].includes(t.id)).map((t) => ({ label: t.label, onClick: () => st.set({ panel: t.id }) })),
    Test: [
      ...(["sea", "heel", "flood", "evac"] as TestKind[]).map((k) => ({
        label: { sea: "Ship in waves", heel: "Heel", flood: "Flooding", evac: "Evacuation walk-through" }[k],
        onClick: () => {
          st.setTest({ kind: k, running: true, restart: Date.now() });
          switchMode("test");
        },
      })),
      { label: "Fix with AI", sep: true, disabled: !!st.fix, onClick: () => void startFix() },
    ],
    Help: [
      { label: "Interactive tour", hint: "?", onClick: () => st.set({ tourStep: 0 }) },
      { label: "How to use", onClick: () => st.set({ panel: "guide" }) },
      { label: "Sources, method and AI use", onClick: () => st.set({ panel: "sources" }) },
    ],
  };

  const counts = a ? (["red", "amber", "green"] as const).map((s) => [s, a.rules.filter((r) => r.status === s).length] as const) : [];

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex h-11 items-center gap-4 border-b border-line bg-surface px-4">
        <div className="flex items-center gap-2">
          <img src="/brand/meyer-turku.png" alt="Meyer Turku" className="brand-logo h-[22px] w-auto select-none" draggable={false} />
          <span className="h-4 w-px bg-line" />
          <span className="text-[13px] font-semibold tracking-tight">Pre-Check</span>
        </div>
        <MenuBar menus={menus} />
        <div data-tour="mode" className="flex items-center gap-4 border-l border-line pl-4">
          {(["design", "test"] as const).map((m) => (
            <button key={m} className={`relative py-3 text-[12px] capitalize transition-colors ${st.mode === m ? "text-fg" : "text-muted hover:text-fg"}`} onClick={() => switchMode(m)}>
              {m}
              {st.mode === m && !st.fix && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[2px] bg-accent" />}
            </button>
          ))}
          <FixButton />
        </div>
        <div className="ml-auto flex items-center gap-4 text-[12px]">
          {a && (
            <button data-tour="score" className="flex items-center gap-3 text-muted hover:text-fg" onClick={() => st.set({ panel: "issues" })} title="Open issues">
              <span>
                <span className="text-faint">Score </span>
                <span className="font-semibold text-fg tabular-nums">{a.score.score}</span>
              </span>
              {counts.map(([s, n]) => (
                <span key={s} className="flex items-center gap-1 tabular-nums">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_VAR[s] }} />
                  {n}
                </span>
              ))}
            </button>
          )}
          <span className="flex w-20 items-center justify-end gap-1.5 text-[11px] text-faint">
            <span className={`h-1 w-1 rounded-full ${st.analyzing ? "bg-accent" : "bg-faint"}`} />
            {st.analyzing ? "analysing" : `${f(a?.ms ?? 0, 0)} ms`}
          </span>
          <button className="text-muted transition-colors hover:text-fg" onClick={() => st.setTheme(st.theme === "dark" ? "light" : "dark")} title={st.theme === "dark" ? "Light theme" : "Dark theme"}>
            <Icon d={st.theme === "dark" ? ICONS.sun : ICONS.moon} size={16} />
          </button>
          <button data-tour="report" className="flex items-center gap-1.5 text-muted transition-colors hover:text-fg" onClick={() => downloadReport()}>
            <Icon d={ICONS.download} size={15} />
            Report
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => handleFile(e, async (file) => st.load(parseDesign(await file.text())))} />
        <input
          ref={csvRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) =>
            handleFile(e, async (file) => {
              const o = parseOffsetsCSV(await file.text());
              st.edit((d) => void applyOffsets(d, o, `Imported: ${file.name}`));
              st.notify(`Hull replaced by ${file.name}: ${o.LOA.toFixed(1)} m long, ${o.BOA.toFixed(1)} m wide, ${o.stations.length} stations, ${o.waterlines.length} waterlines.`, "ok");
            })
          }
        />
        <input ref={meshRef} type="file" accept=".stl,.obj,.gltf,.glb" className="hidden" onChange={(e) => handleFile(e, loadMesh)} />
        <input
          ref={shipRef}
          data-testid="ship-files"
          type="file"
          multiple
          accept=".csv,.txt,.glb,.gltf,.json,.obj,.stl"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void importFiles(files);
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <main data-tour="viewport" className="relative min-w-0 flex-1 overflow-hidden">
          <Viewport />
          {dropping && (
            <div className="anim-rise pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg border border-dashed border-accent bg-bg/50">
              <div className="text-center">
                <div className="label">Import ship files</div>
                <p className="mt-1 text-[12.5px] text-muted">Drop the CSV tables and the exterior .glb together</p>
              </div>
            </div>
          )}
          <Fragments />
          {!testing && !st.fix && <ToolRail />}
          <div className="pointer-events-none absolute top-3 right-[284px] left-14 flex justify-center">
          <div data-tour="decks" className={`pointer-events-auto flex items-center ${decks.length > 8 ? "gap-3" : "gap-5"}`}>
            {decks.length > 8 && <span className="label mr-1">Deck</span>}
            {[...decks].reverse().map((d, i) => {
              const on = st.activeDeckId === d.id && !testing;
              return (
                <button key={d.id} className={`anim-rise relative pb-1 text-[12px] tabular-nums transition-colors ${on ? "text-fg" : "text-muted hover:text-fg"}`} style={{ animationDelay: `${i * (decks.length > 8 ? 15 : 40)}ms` }} onClick={() => st.set({ activeDeckId: d.id })} title={`${d.name}, z = ${d.z} m`}>
                  {decks.length > 8 ? d.name.replace(/^Deck\s*/, "") : d.name}
                  {d.id === st.design.bulkheadDeckId && <span className="ml-1 text-[9px] text-faint">BHD</span>}
                  {on && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[1.5px] bg-accent" />}
                </button>
              );
            })}
          </div>
          </div>
          <ModelPicker />
          {!testing && !st.fix && st.tool.kind !== "select" && (
            <div key={JSON.stringify(st.tool)} className="anim-wipe absolute top-11 left-1/2 -translate-x-1/2 text-[11.5px] whitespace-nowrap text-muted">
              {toolHint(st.tool)} <span className="text-faint">Esc to stop</span>
            </div>
          )}
          {testing && <div className="anim-wipe absolute top-11 left-1/2 -translate-x-1/2 text-[11.5px] text-muted">Test mode. Switch to Design to edit.</div>}
          {!testing && !st.fix && <Hotbar />}
          {st.fix && <div className="absolute inset-0 z-20" onWheel={(e) => e.stopPropagation()} title="Editing is locked during the fix run" />}
          <FixBar />
          <Toast />
        </main>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface">
          <nav data-tour="tabs" className="flex flex-wrap gap-x-4 gap-y-0 border-b border-line px-4 pt-2">
            {TABS.filter((t) => !t.testOnly || testing).map((t) => {
              const on = st.panel === t.id;
              return (
                <button key={t.id} className={`relative pt-1 pb-2 text-[12px] transition-colors ${on ? "text-fg" : "text-muted hover:text-fg"}`} onClick={() => st.set({ panel: t.id })}>
                  {t.label}
                  {on && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[2px] bg-accent" />}
                </button>
              );
            })}
          </nav>
          <div key={st.panel} className="min-h-0 flex-1 overflow-y-auto">
            {st.panel === "test" && testing && <TestPanel />}
            {st.panel === "test" && !testing && <IssuesPanel />}
            {st.panel === "issues" && <IssuesPanel />}
            {st.panel === "inspect" && <Inspector />}
            {st.panel === "design" && <DesignPanel />}
            {st.panel === "hydro" && <HydroPanel />}
            {st.panel === "stability" && <StabilityPanel />}
            {st.panel === "damage" && <DamagePanel />}
            {st.panel === "evac" && <EvacPanel />}
            {st.panel === "performance" && <PerformancePanel />}
            {st.panel === "guide" && <GuidePanel />}
            {st.panel === "sources" && <SourcesPanel />}
          </div>
        </aside>
      </div>

      <footer className="flex h-7 items-center gap-5 border-t border-line bg-surface px-4 text-[11px] text-muted tabular-nums">
        {c ? (
          <>
            <span>
              <span className="text-faint">Displacement </span>
              {f(c.weights.total.massT, 0)} t
            </span>
            <span>
              <span className="text-faint">Draft </span>
              {f(c.T, 2)} m
            </span>
            <span>
              <span className="text-faint">Trim </span>
              {f(c.trimByStern, 2)} m
            </span>
            <span>
              <span className="text-faint">GM </span>
              {f(c.GMt, 2)} m
            </span>
            <span>
              <span className="text-faint">KG </span>
              {f(c.KG, 2)} m
            </span>
            <span>
              <span className="text-faint">Freeboard </span>
              {f(c.freeboard, 2)} m
            </span>
          </>
        ) : (
          <span>No loading condition</span>
        )}
        <span className="ml-auto text-faint">
          {st.design.spaces.length} spaces, {st.design.doors.length} emergency doors, {st.design.bulkheads.length} bulkheads, {st.design.lsa.length} survival craft
        </span>
      </footer>
      <Tour />
    </div>
  );
}

function switchMode(m: "design" | "test") {
  const st = useStore.getState();
  if (st.fix) return st.notify("Finish or stop the fix run first.", "info");
  st.set({ mode: m, panel: m === "test" ? "test" : st.panel === "test" ? "issues" : st.panel, tool: { kind: "select" } });
  if (m === "test") st.setTest({ running: true, restart: Date.now() });
}

function duplicateSelected() {
  const st = useStore.getState();
  if (st.selection?.kind !== "space") return;
  const sp = st.design.spaces.find((x) => x.id === st.selection!.id);
  if (!sp) return;
  const id = `s${Date.now().toString(36)}`;
  for (const [dx, dy] of [
    [sp.length, 0],
    [-sp.length, 0],
    [0, sp.breadth],
    [0, -sp.breadth],
  ]) {
    const copy = { ...structuredClone(sp), id, name: `${sp.name} copy`, xCentre: sp.xCentre + dx, yCentre: sp.yCentre + dy };
    if (overlapsWith(st.design, copy).length) continue;
    if (st.analysis?.ship && centreOutsideHull(st.design, st.analysis.ship, copy)) continue; // would sit in the water
    st.edit((d) => void d.spaces.push(copy));
    st.select({ kind: "space", id });
    return;
  }
  st.notify("No free spot next to this space for a copy.", "error");
}

async function handleFile(e: React.ChangeEvent<HTMLInputElement>, fn: (f: File) => Promise<void>) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    await fn(file);
  } catch (err) {
    useStore.getState().notify(`Could not open ${file.name}: ${(err as Error).message}`, "error");
  }
}

function toolHint(t: Tool): string {
  switch (t.kind) {
    case "space":
      return `${TYPE_LABEL[t.type]}: click on the deck to place. A red outline means it would overlap.`;
    case "door":
      return "Emergency door: click near a wall between two rooms. Green preview = it connects them, amber = outer wall.";
    case "route":
      return "Escape route: click a room. Missing emergency doors to its corridor or stairwell are added and its way out is drawn in red.";
    case "bulkhead":
      return `${t.bk === "watertight" ? "Watertight" : "Fire zone"} bulkhead: click to place it across the ship.`;
    case "lsa":
      return `${t.lsa === "lifeboat" ? "Lifeboat" : "Liferaft"}: click near the ship's side.`;
    case "stamp":
      return t.stamp === "cabin_block" ? "Cabin block: click where the aft end of the corridor starts." : "Stair core: click to place a stair from this deck to the top.";
    case "run":
      return `${RUN_INFO[t.run].label}: click to add points, change deck for a riser. Enter finishes, Backspace undoes.`;
    default:
      return "";
  }
}

// ------------------------------------------------------------------ model picker (top right of the 3D view)
function ModelPicker() {
  const modelId = useStore((s) => s.modelId);
  const drafts = useStore((s) => s.drafts);
  const pastLen = useStore((s) => s.past.length);
  const testing = useStore((s) => s.mode === "test");
  const switchModel = useStore((s) => s.switchModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const imported = useStore((s) => s.imported);
  const cur = findModel({ imported }, modelId) ?? MODELS[0];
  const edited = (id: string) => (id === modelId ? pastLen > 0 : (drafts[id]?.past.length ?? 0) > 0);
  return (
    <div ref={ref} data-tour="models" className="anim-rise absolute top-2 right-4 z-20">
      <button
        onClick={() => setOpen(!open)}
        disabled={testing}
        title={testing ? "Switch to Design mode to change the model" : "Choose a model ship"}
        className={`flex min-w-[230px] items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${open ? "border-accent" : "border-line hover:border-muted"} bg-surface/90 backdrop-blur-sm disabled:opacity-60`}
      >
        <Icon d={ICONS.logo} size={20} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{cur.label}</span>
          <span className="block truncate text-[10.5px] text-faint">
            {cur.note}
            {edited(cur.id) && <span className="text-accent"> · edited</span>}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="anim-wipe absolute right-0 mt-1 w-[280px] overflow-hidden rounded-md border border-line bg-surface shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)]">
          <div className="label px-3 pt-2.5 pb-1">Model ships</div>
          {MODELS.map((m) => {
            const on = m.id === modelId;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setOpen(false);
                  switchModel(m.id);
                }}
                className={`relative flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left transition-colors hover:bg-surface-2 ${on ? "text-fg" : "text-muted"}`}
              >
                {on && <span className="absolute top-2 bottom-2 left-0 w-[2px] rounded bg-accent" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg">{m.label}</span>
                  <span className="block truncate text-[10.5px] text-faint">{m.note}</span>
                </span>
                {edited(m.id) && <span className="text-[10px] text-accent">edited</span>}
              </button>
            );
          })}
          {imported.length > 0 && <div className="label border-t border-line px-3 pt-2.5 pb-1">Imported</div>}
          {imported.map((m) => {
            const on = m.id === modelId;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setOpen(false);
                  switchModel(m.id);
                }}
                className={`relative flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left transition-colors hover:bg-surface-2 ${on ? "text-fg" : "text-muted"}`}
              >
                {on && <span className="absolute top-2 bottom-2 left-0 w-[2px] rounded bg-accent" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg">{m.label}</span>
                  <span className="block truncate text-[10.5px] text-faint">{m.note}</span>
                </span>
                {edited(m.id) && <span className="text-[10px] text-accent">edited</span>}
              </button>
            );
          })}
          <p className="border-t border-line px-3 py-2 text-[10.5px] leading-snug text-faint">Edits to each model are kept while you switch. They are lost when the page is reloaded.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ menu bar
function MenuBar({ menus }: { menus: Record<string, { label: string; onClick: () => void; hint?: string; disabled?: boolean; sep?: boolean }[]> }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={ref} data-tour="menu" className="relative flex items-center gap-0.5">
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="relative">
          <button className={`rounded px-2 py-1 text-[12px] transition-colors ${open === name ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`} onClick={() => setOpen(open === name ? null : name)} onMouseEnter={() => open && setOpen(name)}>
            {name}
          </button>
          {open === name && (
            <div className="anim-rise absolute top-full left-0 z-40 mt-1.5 min-w-60 rounded-md border border-line bg-surface py-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.45)]">
              {items.map((it, i) => (
                <div key={it.label}>
                  {it.sep && i > 0 && <div className="my-1 h-px bg-line" />}
                  <button
                    disabled={it.disabled}
                    className="anim-wipe flex w-full items-center justify-between gap-6 px-3 py-[5px] text-left text-[12px] text-fg transition-colors hover:bg-surface-2 disabled:text-faint disabled:hover:bg-transparent"
                    style={{ animationDelay: `${i * 18}ms` }}
                    onClick={() => {
                      setOpen(null);
                      it.onClick();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.hint && <span className="font-mono text-[10px] text-faint">{it.hint}</span>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Fix with AI" next to Design / Test: plans and plays verified fixes for the flags. */
function FixButton() {
  const fix = useStore((s) => s.fix);
  const red = useStore((s) => s.analysis?.rules.some((r) => r.findings.some((f) => f.status === "red" || f.status === "amber")) ?? false);
  const [hover, setHover] = useState(false);
  const on = !!fix;
  return (
    <button
      data-tour="fix"
      onClick={() => void startFix()}
      disabled={on}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Find a safe fix for each flag and show the changes one by one"
      className={`relative flex items-center gap-1.5 py-3 text-[12px] transition-colors ${on ? "text-fg" : "text-muted hover:text-fg"}`}
    >
      <span className="relative flex h-5 w-5 items-center justify-center">
        <HoverTile color="var(--accent)" show={hover || on} strong={on} className="-inset-0.5" />
        <Icon d={FIX_ICON} size={14} className="relative text-accent" />
      </span>
      Fix with AI
      {red && !on && <span className="h-[4px] w-[4px] rounded-full" style={{ background: "var(--warn)" }} />}
      {on && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[2px] bg-accent" />}
    </button>
  );
}

// ------------------------------------------------------------------ tool rail (icons only)
function ToolRail() {
  const st = useStore();
  const is = (t: Tool) => JSON.stringify(t) === JSON.stringify(st.tool);
  const items: { t: Tool; label: string; k: string; icon: string; color?: string }[] = [
    { t: { kind: "select" }, label: "Select and move", k: "V", icon: ICONS.select },
    { t: { kind: "door" }, label: "Emergency door", k: "D", icon: ICONS.door, color: EXIT_COLOR },
    { t: { kind: "bulkhead", bk: "watertight" }, label: "Watertight bulkhead", k: "W", icon: ICONS.watertight, color: "#7aa6d6" },
    { t: { kind: "bulkhead", bk: "fire_zone" }, label: "Fire zone bulkhead", k: "Z", icon: ICONS.fire, color: "#e0803c" },
    { t: { kind: "lsa", lsa: "lifeboat" }, label: "Lifeboat", k: "L", icon: ICONS.lifeboat, color: LSA_COLOR.lifeboat },
    { t: { kind: "lsa", lsa: "liferaft" }, label: "Liferaft", k: "R", icon: ICONS.liferaft, color: "#d8d4ce" },
  ];
  const runTool = st.tool.kind === "run" ? st.tool : null;
  return (
    <div data-tour="tools" className="absolute top-3 left-3 flex flex-col items-start gap-3">
      <RailGroup>
      {items.map((it, i) => (
        <RailButton key={it.label} active={is(it.t)} label={`${it.label}  ${it.k}`} icon={it.icon} color={it.color} delay={i * 35} onClick={() => st.set({ tool: it.t })} />
      ))}
      <div className="my-1 h-px w-5 bg-line" />
      <div data-tour="systems" className="relative flex flex-col items-center gap-0.5">
        <RailButton active={!!runTool && !isCable(runTool.run)} label={`Pipe: ${RUN_INFO[st.runKinds.pipe].label}  P`} icon={RUN_ICON.pipe} color={RUN_COLOR[st.runKinds.pipe]} delay={230} onClick={() => st.set({ tool: runTool && !isCable(runTool.run) ? { kind: "select" } : { kind: "run", run: st.runKinds.pipe } })} />
        <RailButton active={!!runTool && isCable(runTool.run)} label={`Cable: ${RUN_INFO[st.runKinds.cable].label}  C`} icon={RUN_ICON.cable} color={RUN_COLOR[st.runKinds.cable]} delay={265} onClick={() => st.set({ tool: runTool && isCable(runTool.run) ? { kind: "select" } : { kind: "run", run: st.runKinds.cable } })} />
        {runTool && <RunKindPicker />}
      </div>
      </RailGroup>
      <RailGroup delay={120}>
      <span className="label self-start px-1 pt-0.5 pb-1">View</span>
      {/* three short columns so the group stays clear of the build bar; routes, door icons and names on the right */}
      <div className="grid grid-cols-3 gap-0.5">
        <ViewToggle k="isolateDeck" label="Hide decks above" icon={ICONS.layers} />
        <ViewToggle k="showHull" label="Hull" icon={ICONS.hull} />
        <ViewToggle k="showRoutes" label="Escape routes" icon={ICONS.routes} />
        <ViewToggle k="showWater" label="Waterline" icon={ICONS.water} />
        <ViewToggle k="showBulkheads" label="Bulkheads" icon={ICONS.bulkheads} />
        <ViewToggle k="showDoors" label="Emergency door icons" icon={ICONS.exits} />
        <ViewToggle k="showPipes" label="Pipes" icon={RUN_ICON.pipesView} />
        <ViewToggle k="showCables" label="Cables" icon={RUN_ICON.cablesView} />
        <ViewToggle k="showLabels" label="Space names" icon={ICONS.names} />
      </div>
      </RailGroup>
    </div>
  );
}

/** Frosted rounded panel that groups rail buttons: a light tint of the text colour (whitish on dark, grey on light). */
function RailGroup({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <div
      className="anim-rise flex flex-col items-center gap-0.5 rounded-[12px] p-1"
      style={{
        animationDelay: `${delay}ms`,
        background: "color-mix(in srgb, var(--fg) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--fg) 13%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 8px 24px -14px rgba(0,0,0,0.45)",
      }}
    >
      {children}
    </div>
  );
}

/** Pipe or cable type picker, beside the rail while a pipe or cable tool is on. */
function RunKindPicker() {
  const st = useStore();
  if (st.tool.kind !== "run") return null;
  const cur = st.tool.run;
  const cable = isCable(cur);
  const kinds = cable ? CABLE_KINDS : PIPE_KINDS;
  return (
    <div key={cable ? "c" : "p"} className="anim-wipe absolute bottom-0 left-12 z-20 flex flex-col rounded-[7px] border border-line bg-surface/95 py-1 shadow-lg">
      <span className="label px-2.5 pt-0.5 pb-1">{cable ? "Cable" : "Pipe"}</span>
      {kinds.map((k, i) => {
        const on = k === cur;
        return (
          <button
            key={k}
            className={`anim-wipe flex items-center gap-2 px-2.5 py-[4px] text-left text-[11.5px] whitespace-nowrap transition-colors ${on ? "text-fg" : "text-muted hover:text-fg"}`}
            style={{ animationDelay: `${i * 30}ms` }}
            onClick={() => st.set({ tool: { kind: "run", run: k }, runKinds: { ...st.runKinds, [cable ? "cable" : "pipe"]: k } })}
          >
            <span className="rounded" style={{ background: RUN_COLOR[k], width: 14, height: cable ? 2 : 4 }} />
            {RUN_INFO[k].label}
            {on && <span className="ml-auto h-[3px] w-[3px] rounded-full bg-accent" />}
          </button>
        );
      })}
      <span className="mt-1 border-t border-line px-2.5 pt-1 text-[10px] text-faint">{(st.design.runs ?? []).filter((r) => isCable(r.kind) === cable).length} drawn</span>
    </div>
  );
}

/** Soft rounded tile in the tool's own colour, shown behind an icon on hover or when active (low alpha, not bright). */
function HoverTile({ color, show, strong = false, className = "" }: { color: string; show: boolean; strong?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute rounded-[7px] transition-all duration-200 ${className}`}
      style={{
        background: `color-mix(in srgb, ${color} ${strong ? 32 : 24}%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} ${strong ? 58 : 44}%, transparent)`,
        opacity: show ? 1 : 0,
        transform: show ? "scale(1)" : "scale(0.85)",
      }}
    />
  );
}

function RailButton({ active, label, icon, color, onClick, delay = 0 }: { active: boolean; label: string; icon: string; color?: string; onClick: () => void; delay?: number }) {
  const [hover, setHover] = useState(false);
  const lit = active || hover;
  const tint = color ?? "var(--accent)";
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`anim-pop relative flex h-9 w-9 items-center justify-center text-fg transition-colors`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <HoverTile color={tint} show={lit} strong={active} className="inset-0.5" />
      {active && <span className="absolute top-2 bottom-2 -left-1 w-[2px] rounded bg-accent" />}
      <Icon d={icon} size={19} className="relative" style={{ color: lit ? tint : undefined, opacity: lit ? 0.75 : 0.88, transition: "color 0.2s, opacity 0.2s" }} />
      {hover && <span className="anim-wipe pointer-events-none absolute left-12 z-30 rounded border border-line bg-surface px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-lg">{label}</span>}
    </button>
  );
}

function ViewToggle({ k, label, icon }: { k: "isolateDeck" | "showHull" | "showWater" | "showBulkheads" | "showRoutes" | "showLabels" | "showDoors" | "showPipes" | "showCables"; label: string; icon: string }) {
  const on = useStore((s) => s.view[k]);
  const setView = useStore((s) => s.setView);
  const [hover, setHover] = useState(false);
  return (
    <button title={label} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => setView({ [k]: !on })} className={`group relative flex h-8 w-9 items-center justify-center transition-colors ${on ? "text-fg" : "text-muted"}`}>
      <HoverTile color="var(--fg)" show={hover} className="inset-0" />
      <Icon d={icon} size={17} className="relative" style={{ opacity: hover ? 0.75 : on ? 0.95 : 0.45, transition: "opacity 0.2s" }} />
      <span className="absolute right-[5px] bottom-[5px] h-[3px] w-[3px] rounded-full bg-accent transition-opacity duration-200" style={{ opacity: on ? 1 : 0 }} />
      <span className="pointer-events-none absolute left-11 z-30 hidden rounded border border-line bg-surface px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-lg group-hover:block">
        {label} <span className="text-muted">{on ? "on" : "off"}</span>
      </span>
    </button>
  );
}

// ------------------------------------------------------------------ build bar: monochrome icons that light up in their colour
function Hotbar() {
  const st = useStore();
  const counts = new Map<SpaceType, number>();
  for (const s of st.design.spaces) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  const isStamp = st.tool.kind === "stamp";
  return (
    <div data-tour="hotbar" className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center pt-10 pb-3" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--bg) 85%, transparent), transparent)" }}>
      {isStamp && <StampOptions />}
      <div className="pointer-events-auto flex items-end gap-0.5">
        {PALETTE.map((t, i) => {
          const active = st.tool.kind === "space" && st.tool.type === t;
          return <Tile key={t} delay={i * 25} active={active} color={TYPE_COLOR[t]} icon={TYPE_ICON[t]} label={TYPE_LABEL[t]} hotkey={i < 10 ? String((i + 1) % 10) : ""} count={counts.get(t) ?? 0} onClick={() => st.set({ tool: active ? { kind: "select" } : { kind: "space", type: t } })} />;
        })}
        <div className="mx-2 mb-4 h-6 w-px self-end bg-line" />
        <Tile delay={330} active={st.tool.kind === "stamp" && st.tool.stamp === "cabin_block"} color={TYPE_COLOR.cabin} icon={ICONS.block} label="Cabin block" hotkey="B" onClick={() => st.set({ tool: { kind: "stamp", stamp: "cabin_block" } })} />
        <Tile delay={355} active={st.tool.kind === "stamp" && st.tool.stamp === "stair_core"} color={TYPE_COLOR.stairwell} icon={ICONS.stairs} label="Stair core" hotkey="K" onClick={() => st.set({ tool: { kind: "stamp", stamp: "stair_core" } })} />
        <Tile delay={380} active={st.tool.kind === "route"} color={EXIT_COLOR} icon={ICONS.routes} label="Escape route" hotkey="E" onClick={() => st.set({ tool: st.tool.kind === "route" ? { kind: "select" } : { kind: "route" } })} />
      </div>
    </div>
  );
}

function Tile({ active, color, icon, label, hotkey, count, onClick, delay }: { active: boolean; color: string; icon: string; label: string; hotkey: string; count?: number; onClick: () => void; delay: number }) {
  const [hover, setHover] = useState(false);
  const lit = active || hover;
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} title={hotkey ? `${label}  ${hotkey}` : label} className="anim-pop relative flex w-[60px] flex-col items-center gap-1 pt-1.5 pb-1" style={{ animationDelay: `${delay}ms` }}>
      <span className="relative flex h-8 w-10 items-center justify-center transition-all duration-200" style={{ color: lit ? color : "var(--muted)", transform: lit ? "translateY(-3px)" : "none" }}>
        <HoverTile color={color} show={lit} strong={active} className="inset-0" />
        <span className="relative flex transition-opacity duration-200" style={{ opacity: lit ? 0.7 : 1 }}>
          <Icon d={icon} size={21} stroke={1.4} />
        </span>
      </span>
      <span className={`w-full truncate text-center text-[10px] leading-tight transition-colors ${lit ? "text-fg" : "text-faint"}`}>{label}</span>
      <span className="h-[3px] w-[3px] rounded-full transition-opacity" style={{ background: color, opacity: active ? 1 : 0 }} />
      {count !== undefined && count > 0 && <span className="absolute top-0 right-2 text-[9px] text-faint tabular-nums">{count}</span>}
    </button>
  );
}

function StampOptions() {
  const tool = useStore((s) => s.tool);
  const o = useStore((s) => s.stampOpts);
  const set = useStore((s) => s.setStampOpts);
  const field = (label: string, key: keyof typeof o, step: number, min: number) => (
    <label className="flex flex-col gap-0.5 text-[10px] text-faint">
      {label}
      <input
        type="number"
        className="w-16 border-0 border-b border-line bg-transparent text-[12px] text-fg outline-none focus:border-accent"
        value={o[key]}
        step={step}
        min={min}
        onChange={(e) => set({ [key]: Math.max(min, parseFloat(e.target.value) || min) })}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
  return (
    <div className="anim-wipe pointer-events-auto mb-3 flex gap-4 rounded-md border border-line bg-surface px-4 py-2">
      {tool.kind === "stamp" && tool.stamp === "cabin_block" ? (
        <>
          {field("Cabins per side", "cabins", 1, 1)}
          {field("Cabin length m", "cabinLength", 0.5, 2)}
          {field("Cabin depth m", "cabinDepth", 0.5, 2)}
          {field("Corridor m", "corridorWidth", 0.1, 0.9)}
          {field("Persons", "persons", 1, 0)}
        </>
      ) : (
        field("Stair width mm", "stairWidthMm", 50, 600)
      )}
    </div>
  );
}

// ------------------------------------------------------------------ drifting line fragments (after the animation reference)
function Fragments() {
  const items = useMemo(() => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 16 }, () => ({
      left: `${r() * 100}%`,
      top: `${r() * 100}%`,
      w: 6 + r() * 18,
      t: 16 + r() * 18,
      d: -r() * 30,
      dx: (r() - 0.5) * 160,
      dy: -40 - r() * 120,
      r0: r() * 180,
      r1: r() * 360,
      o: 0.08 + r() * 0.14,
    }));
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((p, i) => (
        <span
          key={i}
          className="fragment"
          style={{ left: p.left, top: p.top, width: p.w, ["--t" as string]: `${p.t}s`, ["--d" as string]: `${p.d}s`, ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px`, ["--r0" as string]: `${p.r0}deg`, ["--r1" as string]: `${p.r1}deg`, ["--o" as string]: p.o }}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ toast
function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  const color = t.kind === "error" ? "var(--bad)" : t.kind === "ok" ? "var(--ok)" : "var(--accent)";
  return (
    <div key={t.id} className="anim-wipe pointer-events-none absolute bottom-28 left-1/2 z-30 flex max-w-xl -translate-x-1/2 items-stretch overflow-hidden rounded-md border border-line bg-surface text-[12px] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)]">
      <span className="w-[3px] shrink-0" style={{ background: color }} />
      <span className="px-3 py-2">{t.text}</span>
    </div>
  );
}
