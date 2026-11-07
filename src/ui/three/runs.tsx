// Pipes and cables in 3D: thick tubes for pipes, thin ones for cables, drawn under the deckhead of their deck.
// They draw themselves in after the rooms assemble, lift and brighten on hover, and carry a crisp status line and
// a map pin when a check flags them. The drawing and dragging tools live in Viewport's Interaction.
import { useMemo, useRef, useEffect, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useStore } from "../store";
import type { Design, Run, RunPoint, Finding } from "../../engine/types";
import { isCable } from "../../engine/types";
import { runZ, RUN_INFO, runLength } from "../../engine/systems";
import { sortedDecks, deckHeight } from "../../engine/vessel";
import { RUN_COLOR, STATUS_COLOR, runDrawRadius } from "../theme";

/** Vertex being dragged (or pressed) on the selected run; read by Viewport's Interaction. */
export const runDrag: { current: null | { id: string; idx: number; moved: boolean } } = { current: null };

export const runVisible = (r: Run, view: { showPipes: boolean; showCables: boolean }) => (isCable(r.kind) ? view.showCables : view.showPipes);

/** Visible pieces of a run as 3D polylines (vessel coordinates), cut at zCut when the decks above are hidden. */
export function runPieces(design: Design, run: Run, visible: Set<string>, zCut: number): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  let cur: THREE.Vector3[] = [];
  const flush = () => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  for (let i = 0; i < run.points.length - 1; i++) {
    const p = run.points[i],
      q = run.points[i + 1];
    const za = runZ(design, p.deckId),
      zb = runZ(design, q.deckId);
    if (za === null || zb === null) {
      flush();
      continue;
    }
    const a = new THREE.Vector3(p.x, p.y, za),
      b = new THREE.Vector3(q.x, q.y, zb);
    const va = visible.has(p.deckId) && za <= zCut,
      vb = visible.has(q.deckId) && zb <= zCut;
    if (va && vb) {
      if (!cur.length) cur.push(a);
      cur.push(b);
    } else if (va || vb) {
      // a riser leaving the visible decks: cut it at zCut
      const lo = va ? a : b,
        hi = va ? b : a;
      const t = Math.max(0, Math.min(1, (zCut - lo.z) / Math.max(1e-6, hi.z - lo.z)));
      const cut = lo.clone().lerp(hi, t);
      if (va) {
        if (!cur.length) cur.push(a);
        cur.push(cut);
        flush();
      } else {
        flush();
        cur.push(cut, b);
      }
    } else flush();
  }
  flush();
  return out;
}

/** One merged tube (cylinders with round joints) per run, ordered along the run so drawRange can draw it in. */
function tubeGeometry(pieces: THREE.Vector3[][], r: number, radial: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const pts of pieces)
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        const a = pts[i - 1],
          b = pts[i];
        const len = a.distanceTo(b);
        if (len > 1e-3) {
          const g = new THREE.CylinderGeometry(r, r, len, radial, 1, true);
          g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
          g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          parts.push(g);
        }
      }
      const s = new THREE.SphereGeometry(r, radial, Math.max(4, Math.round(radial / 2)));
      s.translate(pts[i].x, pts[i].y, pts[i].z);
      parts.push(s);
    }
  if (!parts.length) return null;
  const m = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return m;
}

export function RunsView({ visibleDeckIds }: { visibleDeckIds: Set<string> }) {
  const design = useStore((s) => s.design);
  const view = useStore((s) => s.view);
  const testing = useStore((s) => s.mode === "test");
  const activeDeckId = useStore((s) => s.activeDeckId);
  const selId = useStore((s) => (s.selection?.kind === "run" ? s.selection.id : null));
  const [hover, setHover] = useState<{ id: string; p: THREE.Vector3 } | null>(null);
  const decks = sortedDecks(design);
  const active = decks.find((d) => d.id === activeDeckId);
  const zCut = view.isolateDeck && !testing && active ? active.z + deckHeight(design, active.id) + 0.01 : Infinity;
  const runs = (design.runs ?? []).filter((r) => r.points.length >= 2 && runVisible(r, view));
  const sel = runs.find((r) => r.id === selId);
  return (
    <>
      {runs.map((r) => {
        const pieces = runPieces(design, r, visibleDeckIds, zCut);
        return pieces.length ? <RunMesh key={r.id} run={r} pieces={pieces} hover={hover?.id === r.id ? hover.p : null} setHover={setHover} /> : null;
      })}
      {sel && !testing && <Handles run={sel} visibleDeckIds={visibleDeckIds} zCut={zCut} />}
    </>
  );
}

const deckIndexOf = (design: Design, id: string) => Math.max(0, sortedDecks(design).findIndex((d) => d.id === id));

function RunMesh({ run, pieces, hover, setHover }: { run: Run; pieces: THREE.Vector3[][]; hover: THREE.Vector3 | null; setHover: (h: { id: string; p: THREE.Vector3 } | null) => void }) {
  const design = useStore((s) => s.design);
  const status = useStore((s) => s.analysis?.statusById.get(run.id));
  const selected = useStore((s) => s.selection?.kind === "run" && s.selection.id === run.id);
  const assembleAt = useStore((s) => s.assembleAt);
  const testing = useStore((s) => s.mode === "test");
  const dark = useStore((s) => s.theme === "dark");
  const r = runDrawRadius(run.kind, run.sizeMm);
  const cable = isCable(run.kind);
  const key = useMemo(() => pieces.map((p) => p.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`).join(";")).join("|"), [pieces]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => tubeGeometry(pieces, r, cable ? 6 : run.kind === "exhaust" ? 18 : 12), [key, r, cable]);
  useEffect(() => () => geo?.dispose(), [geo]);
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const flagged = status === "red" || status === "amber";

  // Draw-in: after a design load the runs draw themselves along their length once the rooms have
  // assembled (deck by deck); a newly drawn run draws in quickly.
  const anim = useRef({ start: 0, delay: 0, dur: 0.35, lift: 0, done: false });
  useEffect(() => {
    const now = performance.now() / 1000;
    const fresh = now - assembleAt < 1.2;
    let h = 0;
    for (const ch of run.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
    anim.current = { start: now, delay: fresh ? 0.85 + deckIndexOf(design, run.points[0].deckId) * 0.1 + (h / 997) * 0.35 : 0, dur: fresh ? 0.9 : 0.35, lift: 0, done: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembleAt]);
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m || !geo) return;
    const A = anim.current;
    if (!A.done) {
      const u = Math.min(1, Math.max(0, (performance.now() / 1000 - A.start - A.delay) / A.dur));
      const e = 1 - (1 - u) ** 3;
      const n = geo.index ? geo.index.count : geo.getAttribute("position").count;
      geo.setDrawRange(0, u >= 1 ? Infinity : Math.ceil((n * e) / 3) * 3);
      m.visible = u > 0;
      if (u >= 1) A.done = true;
    }
    const k = 1 - Math.exp(-dt * 12);
    const hot = !!hover && !testing;
    A.lift += ((hot ? 0.12 : 0) - A.lift) * k;
    m.position.z = A.lift;
    if (mat.current) mat.current.emissiveIntensity += ((hot || selected ? 0.55 : dark ? 0.16 : 0.08) - mat.current.emissiveIntensity) * k;
  });
  // geometry rebuilt (edit): it is complete at once
  useEffect(() => {
    if (anim.current.done && geo) geo.setDrawRange(0, Infinity);
  }, [geo]);
  if (!geo) return null;
  const color = RUN_COLOR[run.kind];
  const lineColor = selected ? (dark ? "#ffffff" : "#1a1a1a") : flagged ? STATUS_COLOR[status!] : null;
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const st = useStore.getState();
    return st.mode === "design" && st.tool.kind === "select" && e.button === 0;
  };
  return (
    <group>
      <mesh
        ref={mesh}
        geometry={geo}
        renderOrder={6}
        visible={false}
        onPointerOver={(e) => {
          if (testing) return;
          e.stopPropagation();
          setHover({ id: run.id, p: (e.object.parent ?? e.object).worldToLocal(e.point.clone()) });
        }}
        onPointerOut={() => setHover(null)}
        onPointerDown={(e) => {
          if (!pick(e)) return;
          e.stopPropagation();
          const st = useStore.getState();
          st.select({ kind: "run", id: run.id });
        }}
        onClick={(e) => {
          if (useStore.getState().tool.kind === "select" || testing) e.stopPropagation();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          const p = (e.object.parent ?? e.object).worldToLocal(e.point.clone());
          window.dispatchEvent(new CustomEvent("viewport:focus", { detail: { x: p.x, y: p.y, z: p.z } }));
        }}
      >
        <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={0.1} roughness={cable ? 0.6 : 0.42} metalness={cable ? 0 : 0.25} />
      </mesh>
      {lineColor && pieces.map((p, i) => <Line key={i} points={p} color={lineColor} lineWidth={2} depthTest={false} transparent opacity={0.95} renderOrder={15} />)}
      {hover && !testing && (
        <Html position={[hover.x, hover.y, hover.z + r + 0.5]} center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
          <div className="anim-wipe flex items-center gap-1.5 rounded border border-line bg-surface/95 px-2 py-[3px] text-[11px] whitespace-nowrap text-fg shadow-[0_6px_18px_-8px_rgba(0,0,0,0.5)]">
            <span className="h-[3px] w-3 rounded" style={{ background: color }} />
            {run.name}
            <span className="text-muted">{RUN_INFO[run.kind].label}</span>
            <span className="text-faint">
              {runLength(design, run).toFixed(0)} m, {run.sizeMm} mm
            </span>
            {flagged && <span style={{ color: STATUS_COLOR[status!] }}>flagged</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Round handles on the bends and ends of the selected run: drag to move, click an end to keep drawing from it. */
function Handles({ run, visibleDeckIds, zCut }: { run: Run; visibleDeckIds: Set<string>; zCut: number }) {
  const design = useStore((s) => s.design);
  const dark = useStore((s) => s.theme === "dark");
  const r = runDrawRadius(run.kind, run.sizeMm);
  const [hot, setHot] = useState<number | null>(null);
  return (
    <>
      {run.points.map((p, i) => {
        const z = runZ(design, p.deckId);
        if (z === null || !visibleDeckIds.has(p.deckId) || z > zCut) return null;
        // the lower end of a riser shares its x, y with the upper one: show one handle per spot and deck
        const end = i === 0 || i === run.points.length - 1;
        const size = Math.max(0.28, r * 1.35) * (end ? 1.25 : 1) * (hot === i ? 1.2 : 1);
        return (
          <mesh
            key={i}
            position={[p.x, p.y, z]}
            renderOrder={16}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHot(i);
            }}
            onPointerOut={() => setHot(null)}
            onPointerDown={(e) => {
              const st = useStore.getState();
              if (e.button !== 0 || st.mode !== "design" || st.tool.kind !== "select") return;
              e.stopPropagation();
              runDrag.current = { id: run.id, idx: i, moved: false };
              st.beginGesture();
              if (p.deckId !== st.activeDeckId) st.set({ activeDeckId: p.deckId });
              window.dispatchEvent(new CustomEvent("viewport:controls", { detail: false }));
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <sphereGeometry args={[size, 16, 12]} />
            <meshBasicMaterial color={end ? RUN_COLOR[run.kind] : dark ? "#ffffff" : "#1a1a1a"} transparent opacity={0.95} depthTest={false} />
          </mesh>
        );
      })}
    </>
  );
}

/** Map pins on the active deck at the spots pipe and cable checks point to. */
export function RunPins() {
  const design = useStore((s) => s.design);
  const rules = useStore((s) => s.analysis?.rules);
  const view = useStore((s) => s.view);
  const activeDeckId = useStore((s) => s.activeDeckId);
  if (!rules) return null;
  const byId = new Map((design.runs ?? []).map((r) => [r.id, r]));
  const seen = new Set<string>();
  const pins: { f: Finding; at: RunPoint }[] = [];
  for (const res of rules)
    for (const f of res.findings) {
      if (!f.at || (f.status !== "red" && f.status !== "amber") || f.at.deckId !== activeDeckId) continue;
      const runs = f.targets.map((t) => byId.get(t)).filter(Boolean) as Run[];
      if (runs.length && !runs.some((r) => runVisible(r, view))) continue;
      const k = `${f.at.x.toFixed(1)},${f.at.y.toFixed(1)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pins.push({ f, at: f.at });
    }
  pins.sort((a, b) => (a.f.status === "red" ? -1 : 1) - (b.f.status === "red" ? -1 : 1));
  return (
    <>
      {pins.slice(0, 16).map(({ f, at }, i) => (
        <Html key={`${at.x},${at.y},${i}`} position={[at.x, at.y, (runZ(design, at.deckId) ?? 0) + 1.2]} center zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
          <div className="anim-pop flex flex-col items-center" style={{ animationDelay: `${450 + i * 35}ms`, pointerEvents: "none", transform: "translateY(-12px)" }}>
            <svg width="18" height="24" viewBox="0 0 18 24">
              <path d="M9 23 C9 23 2 14.5 2 9 a7 7 0 0 1 14 0 C16 14.5 9 23 9 23 Z" fill="var(--surface)" stroke="var(--fg)" strokeWidth="1.1" />
              <circle cx="9" cy="9" r="3" fill={f.status === "red" ? "var(--bad)" : "var(--warn)"} />
            </svg>
          </div>
        </Html>
      ))}
    </>
  );
}
