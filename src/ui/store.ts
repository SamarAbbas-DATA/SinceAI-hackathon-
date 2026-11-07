import { create } from "zustand";
import type { Design, Space, SpaceType, RunKind } from "../engine/types";
import { normalizeDesign } from "../engine/types";
import { analyze, type Analysis } from "../engine/analyze";
import { demoDesign } from "../data/demoDesign";
import { MODELS } from "../data/ships";
import { overlapsWith } from "../engine/topology";
import { centreOutsideHull } from "../engine/vessel";

export type StampKind = "cabin_block" | "stair_core";
export type Tool =
  | { kind: "select" }
  | { kind: "space"; type: SpaceType }
  | { kind: "door" }
  | { kind: "route" }
  | { kind: "bulkhead"; bk: "fire_zone" | "watertight" }
  | { kind: "lsa"; lsa: "lifeboat" | "liferaft" }
  | { kind: "stamp"; stamp: StampKind }
  /** draw a pipe or cable; with `extend` the clicks continue that run from its last point */
  | { kind: "run"; run: RunKind; extend?: string; from?: "start" | "end" };
export type Selection = { kind: "space" | "door" | "bulkhead" | "lsa" | "run"; id: string } | null;
export type Panel = "test" | "issues" | "inspect" | "design" | "hydro" | "stability" | "damage" | "evac" | "performance" | "guide" | "sources";
export type TestKind = "sea" | "heel" | "flood" | "evac";

export interface RefMesh {
  name: string;
  object: unknown; // THREE.Object3D, kept out of the design file
  offset: [number, number, number];
  scale: number;
  rotZ: number;
  visible: boolean;
  opacity: number;
}

/** A ship read from uploaded files (File > Import ship files). Listed in the model picker under "Imported". */
export interface ImportedModel {
  id: string;
  label: string;
  note: string;
  make: () => Design;
  /** exterior model in ship coordinates (THREE.Object3D), painted shell shown when zoomed out */
  shell: unknown | null;
  files: string[];
}

/** A model ship or an imported ship, by id. */
export function findModel(st: { imported: ImportedModel[] }, id: string): { id: string; label: string; note: string; make: () => Design; livery?: unknown; shell?: unknown } | undefined {
  return MODELS.find((m) => m.id === id) ?? st.imported.find((m) => m.id === id);
}

export interface TestSettings {
  kind: TestKind;
  running: boolean;
  speedKn: number;
  waveAmp: number;
  waveFreq: number;
  headingDeg: number; // 180 = head seas
  heelSweep: boolean;
  heelDeg: number;
  floodCase: number;
  timeScale: number;
  restart: number; // bump to restart the animation
}

/** State of a "Fix with AI" run (null when none). Editing is locked while it is not null. */
export interface FixRun {
  phase: "planning" | "ready" | "running" | "finished";
  progress: { text: string; done: number; total: number };
  plan: import("../engine/fixes").FixPlan | null;
  current: number; // step being shown
  paused: boolean;
  stopped: boolean;
  ai: { ok: boolean; model?: string } | null;
  caption: { title: string; detail: string; ai?: string; done?: boolean } | null;
  scoreStart: number;
  applied: number;
  error?: string;
}
/** Short-lived 3D effects (rings) at the spots a fix changes. */
export interface FixFx {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: "focus" | "done";
}

const STORAGE_KEY = "ship-precheck-design-v1";
const PREVIOUS_KEY = "ship-precheck-previous-session";
const THEME_KEY = "ship-precheck-theme";

/**
 * The app always starts from the default demo ferry, so a reload never shows an old, half-edited design.
 * The design of the last session is kept under PREVIOUS_KEY and can be restored from File > Restore last session.
 */
function loadInitial(): Design {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(PREVIOUS_KEY, raw);
  } catch {
    /* storage unavailable */
  }
  return demoDesign();
}

export function hasPreviousSession(): boolean {
  try {
    return localStorage.getItem(PREVIOUS_KEY) !== null;
  } catch {
    return false;
  }
}

/** The design from the previous browser session, or null. */
export function previousSession(): Design | null {
  try {
    const raw = localStorage.getItem(PREVIOUS_KEY);
    return raw ? normalizeDesign(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

interface State {
  design: Design;
  past: Design[];
  future: Design[];
  analysis: Analysis | null;
  analyzing: boolean;
  selection: Selection;
  activeDeckId: string;
  tool: Tool;
  panel: Panel;
  mode: "design" | "test";
  theme: "dark" | "light";
  view: { isolateDeck: boolean; showHull: boolean; showRoutes: boolean; showWater: boolean; showBulkheads: boolean; showLabels: boolean; showDoors: boolean; showPipes: boolean; showCables: boolean };
  /** last pipe and cable type picked, so the tool rail buttons reopen with it */
  runKinds: { pipe: RunKind; cable: RunKind };
  focusCase: number | null;
  test: TestSettings;
  refMesh: RefMesh | null;
  toast: { text: string; kind: "error" | "info" | "ok"; id: number } | null;
  tourStep: number | null;
  /** Model ship shown in the picker; switching keeps every model's edits (with undo history) in memory. */
  modelId: string;
  drafts: Record<string, { design: Design; past: Design[]; future: Design[]; activeDeckId: string }>;
  switchModel: (id: string) => void;
  imported: ImportedModel[];
  /** adds (or replaces) an imported ship and switches to it */
  addImported: (m: ImportedModel) => void;
  /** True when any model has edits since the page was opened (used for the leave-page warning). */
  hasUnsavedEdits: () => boolean;
  assembleAt: number; // time (s) of the last design load: spaces assemble from it
  stampOpts: { cabins: number; cabinLength: number; cabinDepth: number; corridorWidth: number; persons: number; stairWidthMm: number };
  setStampOpts: (p: Partial<State["stampOpts"]>) => void;
  edit: (fn: (d: Design) => void, commit?: boolean) => void;
  /** Edit one space; refused (with a message) if the result would overlap another space. */
  editSpace: (id: string, fn: (s: Space) => void) => boolean;
  beginGesture: () => void;
  commit: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  load: (d: Design) => void;
  select: (s: Selection) => void;
  set: (p: Partial<Pick<State, "activeDeckId" | "tool" | "panel" | "focusCase" | "mode" | "tourStep" | "runKinds">>) => void;
  setView: (p: Partial<State["view"]>) => void;
  setTest: (p: Partial<TestSettings>) => void;
  setTheme: (t: "dark" | "light") => void;
  setRefMesh: (m: RefMesh | null) => void;
  notify: (text: string, kind?: "error" | "info" | "ok") => void;
  fix: FixRun | null;
  setFix: (p: Partial<FixRun> | null) => void;
  fx: FixFx[];
  addFx: (f: Omit<FixFx, "id">) => void;
}

let gestureStart: Design | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const schedule = () => {
    if (timer) clearTimeout(timer);
    set({ analyzing: true });
    timer = setTimeout(() => {
      const d = get().design;
      let a: Analysis | null = null;
      try {
        a = analyze(d);
      } catch (e) {
        console.error(e);
      }
      set({ analysis: a, analyzing: false });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      } catch {
        /* storage unavailable */
      }
    }, 200);
  };
  const initial = loadInitial();
  setTimeout(schedule, 0);
  let urlPanel: Panel | null = null;
  let urlDeck: string | null = null;
  let urlMode: "design" | "test" | null = null;
  let theme: "dark" | "light" = "dark";
  let urlTest: TestKind | null = null;
  try {
    urlTest = (new URLSearchParams(window.location.search).get("test") as TestKind | null) ?? null;
    const q = new URLSearchParams(window.location.search);
    urlPanel = q.get("panel") as Panel | null;
    urlDeck = q.get("deck");
    urlMode = q.get("mode") === "test" ? "test" : null;
    theme = (q.get("theme") as "dark" | "light" | null) ?? (localStorage.getItem(THEME_KEY) as "dark" | "light" | null) ?? "dark";
  } catch {
    /* no window */
  }
  return {
    design: initial,
    past: [],
    future: [],
    analysis: null,
    analyzing: true,
    selection: null,
    activeDeckId: (urlDeck && initial.decks.some((d) => d.id === urlDeck) ? urlDeck : initial.decks[Math.min(2, initial.decks.length - 1)]?.id) ?? "",
    tool: { kind: "select" },
    panel: urlPanel ?? (urlMode === "test" ? "test" : "issues"),
    mode: urlMode ?? "design",
    theme,
    view: { isolateDeck: true, showHull: true, showRoutes: false, showWater: true, showBulkheads: true, showLabels: false, showDoors: false, showPipes: true, showCables: true },
    runKinds: { pipe: "fire_main", cable: "hv_cable" },
    focusCase: null,
    test: { kind: urlTest ?? "sea", running: true, speedKn: initial.hull.designSpeedKn, waveAmp: 1.5, waveFreq: 0.6, headingDeg: 150, heelSweep: true, heelDeg: 10, floodCase: 0, timeScale: 1, restart: 0 },
    refMesh: null,
    toast: null,
    tourStep: null,
    modelId: "demo",
    drafts: {},
    switchModel: (id) => {
      const st = get();
      if (id === st.modelId) return;
      if (st.fix) return st.notify("Finish or stop the fix run first.", "info");
      const m = findModel(st, id);
      if (!m) return;
      gestureStart = null;
      const drafts = { ...st.drafts, [st.modelId]: { design: st.design, past: st.past, future: st.future, activeDeckId: st.activeDeckId } };
      const saved = drafts[id];
      const design = saved?.design ?? normalizeDesign(m.make());
      const sorted = [...design.decks].sort((a, b) => a.z - b.z);
      // model ships open on their top deck, so the whole painted hull is visible from the start
      const deck = saved?.activeDeckId ?? (m.livery || m.shell ? sorted[sorted.length - 1]?.id : sorted[Math.min(2, sorted.length - 1)]?.id) ?? "";
      set({
        modelId: id,
        drafts,
        design,
        past: saved?.past ?? [],
        future: saved?.future ?? [],
        activeDeckId: deck,
        selection: null,
        focusCase: null,
        tool: { kind: "select" },
        test: { ...st.test, speedKn: design.hull.designSpeedKn, floodCase: 0 },
        assembleAt: performance.now() / 1000,
      });
      schedule();
      get().notify(saved ? `${m.label}: your edits are back.` : `${m.label} loaded. Your edits to the other models are kept until you reload the page.`, "info");
    },
    imported: [],
    addImported: (m) => {
      const st = get();
      if (st.fix) return st.notify("Finish or stop the fix run first.", "info");
      const drafts = { ...st.drafts };
      delete drafts[m.id];
      set({ imported: [...st.imported.filter((x) => x.id !== m.id), m], drafts });
      if (st.modelId !== m.id) return get().switchModel(m.id);
      // re-import of the ship that is open: replace it (undoable), open on the top deck
      get().load(m.make());
      const sorted = [...get().design.decks].sort((a, b) => a.z - b.z);
      set({ activeDeckId: sorted[sorted.length - 1]?.id ?? get().activeDeckId });
    },
    hasUnsavedEdits: () => {
      const st = get();
      return st.past.length > 0 || Object.entries(st.drafts).some(([k, v]) => k !== st.modelId && v.past.length > 0);
    },
    assembleAt: typeof performance !== "undefined" ? performance.now() / 1000 : 0,
    stampOpts: { cabins: 6, cabinLength: 4, cabinDepth: 4, corridorWidth: 2, persons: 2, stairWidthMm: 1200 },
    setStampOpts: (p) => set({ stampOpts: { ...get().stampOpts, ...p } }),
    edit: (fn, commit = true) => {
      const prev = get().design;
      const next = structuredClone(prev);
      fn(next);
      if (commit) set({ design: next, past: [...get().past.slice(-99), prev], future: [] });
      else set({ design: next });
      schedule();
    },
    editSpace: (id, fn) => {
      const probe = structuredClone(get().design);
      const s = probe.spaces.find((x) => x.id === id);
      if (!s) return false;
      fn(s);
      const hit = overlapsWith(probe, s);
      if (hit.length) {
        get().notify(`Not applied: ${s.name} would overlap ${hit[0].name}. Spaces may touch but not overlap.`, "error");
        return false;
      }
      const ship = get().analysis?.ship;
      if (ship && centreOutsideHull(probe, ship, s)) {
        get().notify(`Not applied: the centre of ${s.name} would be outside the hull, in the water. Move it towards the centreline.`, "error");
        return false;
      }
      get().edit((d) => fn(d.spaces.find((x) => x.id === id)!));
      return true;
    },
    beginGesture: () => {
      gestureStart = get().design;
    },
    commit: () => {
      if (gestureStart && gestureStart !== get().design) set({ past: [...get().past.slice(-99), gestureStart], future: [] });
      gestureStart = null;
    },
    cancelGesture: () => {
      if (gestureStart) set({ design: gestureStart });
      gestureStart = null;
      schedule();
    },
    undo: () => {
      const { past, design, future } = get();
      if (!past.length) return;
      set({ design: past[past.length - 1], past: past.slice(0, -1), future: [design, ...future] });
      schedule();
    },
    redo: () => {
      const { past, design, future } = get();
      if (!future.length) return;
      set({ design: future[0], future: future.slice(1), past: [...past, design] });
      schedule();
    },
    load: (d) => {
      const n = normalizeDesign(d);
      set({ design: n, past: [...get().past, get().design], future: [], selection: null, activeDeckId: n.decks[Math.min(2, n.decks.length - 1)]?.id ?? "", focusCase: null, assembleAt: performance.now() / 1000 });
      schedule();
    },
    select: (s) => set({ selection: s, panel: s ? "inspect" : get().panel }),
    set: (p) => set(p),
    setView: (p) => set({ view: { ...get().view, ...p } }),
    setTest: (p) => set({ test: { ...get().test, ...p } }),
    setTheme: (t) => {
      set({ theme: t });
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {
        /* storage unavailable */
      }
    },
    setRefMesh: (m) => set({ refMesh: m }),
    fix: null,
    setFix: (p) => set({ fix: p === null ? null : ({ ...(get().fix ?? ({} as FixRun)), ...p } as FixRun) }),
    fx: [],
    addFx: (f) => {
      const id = Date.now() + Math.random();
      set({ fx: [...get().fx.slice(-12), { ...f, id }] });
      setTimeout(() => set({ fx: get().fx.filter((x) => x.id !== id) }), 1800);
    },
    notify: (text, kind = "info") => {
      if (toastTimer) clearTimeout(toastTimer);
      set({ toast: { text, kind, id: Date.now() } });
      toastTimer = setTimeout(() => set({ toast: null }), 4000);
    },
  };
});

let idc = 0;
export function newId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${(idc++).toString(36)}`;
}

/** Values written every frame by the 3D test animation and read by the dials. */
export const live = {
  t: 0,
  heave: 0,
  pitchDeg: 0,
  rollDeg: 0,
  vertAcc: 0,
  heelDeg: 0,
  gz: 0,
  floodProgress: 0,
  draftAft: 0,
  draftFwd: 0,
  evacTime: 0,
  evacArrived: 0,
  evacTotal: 0,
  history: [] as { t: number; a: number; b: number }[],
};
