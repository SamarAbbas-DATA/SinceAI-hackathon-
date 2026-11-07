import { useMemo, useRef, useState, useEffect, type ReactNode } from "react";
import { Canvas, useThree, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges, Html, Line, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { useStore, newId, live } from "../store";
import { createShip, spaceVertical, spaceDeckIds, sortedDecks, deckHeight, halfBreadthAt, motions, G, centreOutsideHull } from "../../engine/vessel";
import { rectOf, spacesOnDeck, sharedEdges, OUTSIDE, overlapsWith, buildGraph, shortestRoute } from "../../engine/topology";
import { cabinBlock, stairCore, doorSpot, autoDoors, type DoorSpot } from "../../engine/generators";
import { gzAt } from "../../engine/stability";
import type { Design, Space, LSA } from "../../engine/types";
import { pairKey } from "../../engine/types";
import { hullGeometry, deckGeometry, sectionGeometry } from "./geometry";
import { TYPE_COLOR, STATUS_COLOR, DEFAULT_SIZE, DEFAULT_PERSONS, TYPE_LABEL, LSA_COLOR, EXIT_COLOR } from "../theme";

const SNAP = 0.25;
const snap = (v: number, s = SNAP) => Math.round(v / s) * s;
/** world (three, y-up) -> vessel (z-up) */
const toVessel = (p: THREE.Vector3) => ({ x: p.x, y: -p.z, z: p.y });
/** vessel -> world */
const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
const D2R = Math.PI / 180;

function hullKey(d: Design) {
  return JSON.stringify([d.hull, d.decks]);
}

/** Neutral scene palette per theme (no blue cast). */
function usePalette() {
  const dark = useStore((s) => s.theme) === "dark";
  return {
    dark,
    hull: dark ? "#8a8782" : "#8f8a83",
    hullEdge: dark ? "#5f5c58" : "#b3aea6",
    deckActive: dark ? "#272726" : "#ffffff",
    deck: dark ? "#1f1f1e" : "#e6e4e0",
    seaLine: dark ? "#d8d4ce" : "#4a4744",
    seaFill: dark ? "#171717" : "#eceae6",
    fog: dark ? "#1c1c1c" : "#e9e7e3",
    edge: dark ? "#d8d4ce" : "#2a2927",
    grid: dark ? "#222221" : "#dedbd6",
    grid2: dark ? "#2b2b2a" : "#d0ccc6",
    accent: dark ? "#e0803c" : "#c8611c",
    door: dark ? "#9c8a74" : "#8a7560",
  };
}

export function Viewport() {
  const design = useStore((s) => s.design);
  const LOA = design.hull.LOA;
  return (
    <div className="absolute inset-0" style={{ background: "var(--viewport)" }}>
      <Canvas
        camera={{ position: [LOA * 0.1 - 35, 48, 95], fov: 38, near: 0.5, far: 6000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
        onPointerMissed={() => useStore.getState().tool.kind === "select" && useStore.getState().select(null)}
      >
        <Lights />
        <Scene />
        <OrbitControls
          makeDefault
          target={[LOA / 2, 6, 0]}
          enableDamping
          dampingFactor={0.09}
          zoomToCursor
          zoomSpeed={1.1}
          rotateSpeed={0.75}
          minDistance={4}
          maxDistance={800}
          maxPolarAngle={Math.PI * 0.495}
        />
        <GizmoHelper alignment="bottom-right" margin={[64, 120]}>
          <GizmoViewport labelColor="#161616" axisColors={["#b9826a", "#93a387", "#8899aa"]} axisHeadScale={0.7} hideNegativeAxes />
        </GizmoHelper>
        <CameraRig />
      </Canvas>
    </div>
  );
}

function Lights() {
  const p = usePalette();
  return (
    <>
      <fog attach="fog" args={[p.fog, 140, 520]} />
      <hemisphereLight args={["#fff8f0", p.dark ? "#1a1a1a" : "#9a958e", p.dark ? 0.95 : 1.15]} />
      <directionalLight position={[80, 140, 90]} intensity={p.dark ? 1.35 : 1.15} color="#fff4e8" />
      <directionalLight position={[-90, 60, -80]} intensity={p.dark ? 0.35 : 0.3} color="#ffffff" />
    </>
  );
}

/** Camera presets and smooth focus on a point. */
function CameraRig() {
  const { camera, controls, gl } = useThree();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // test hook: ship coordinates -> page pixels (used by the browser interaction test)
    (window as unknown as Record<string, unknown>).__project = (x: number, y: number, z: number) => {
      const v = toWorld(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
  }, [camera, gl]);
  const design = useStore((s) => s.design);
  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  useEffect(() => {
    const L = design.hull.LOA;
    const ctl = () => controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    const onView = (e: Event) => {
      const mode = (e as CustomEvent).detail as string;
      const k = Math.max(1, L / 120); // bigger ships: same framing, further away (k = 1 for ships up to 120 m)
      const target = new THREE.Vector3(L / 2, 6 * k, 0);
      const pos = mode === "plan" ? new THREE.Vector3(L / 2, L * 1.2, 0.01) : mode === "side" ? new THREE.Vector3(L / 2, 7 * k, L * 1.05) : mode === "bow" ? new THREE.Vector3(L * 1.45, 18 * k, 30 * k) : new THREE.Vector3(L * 0.1 - 35 * k, 48 * k, 95 * k);
      goal.current = { target, pos };
    };
    const onFocus = (e: Event) => {
      const { x, y, z } = (e as CustomEvent).detail as { x: number; y: number; z: number };
      const c = ctl();
      if (!c) return;
      const target = toWorld(x, y, z);
      const dir = camera.position.clone().sub(c.target).normalize();
      goal.current = { target, pos: target.clone().add(dir.multiplyScalar(32)) };
    };
    window.addEventListener("viewport:view", onView);
    window.addEventListener("viewport:focus", onFocus);
    return () => {
      window.removeEventListener("viewport:view", onView);
      window.removeEventListener("viewport:focus", onFocus);
    };
  }, [camera, controls, design.hull.LOA]);
  // a different model ship was chosen: frame it (skipped on first load, the camera starts there already)
  const modelId = useStore((s) => s.modelId);
  const firstModel = useRef(modelId);
  useEffect(() => {
    if (modelId === firstModel.current) return;
    firstModel.current = "";
    const t = setTimeout(() => window.dispatchEvent(new CustomEvent("viewport:view", { detail: "3d" })), 60);
    return () => clearTimeout(t);
  }, [modelId]);
  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!g || !c) return;
    const k = 1 - Math.exp(-dt * 6);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.2 && c.target.distanceTo(g.target) < 0.05) goal.current = null;
  });
  return null;
}

export function focusOn(x: number, y: number, z: number) {
  window.dispatchEvent(new CustomEvent("viewport:focus", { detail: { x, y, z } }));
}

function Scene() {
  const design = useStore((s) => s.design);
  const analysis = useStore((s) => s.analysis);
  const view = useStore((s) => s.view);
  const mode = useStore((s) => s.mode);
  const testKind = useStore((s) => s.test.kind);
  const activeDeckId = useStore((s) => s.activeDeckId);
  const p = usePalette();
  const key = hullKey(design);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geomShip = useMemo(() => createShip({ ...design, spaces: [], doors: [], bulkheads: [], lsa: [] }), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hullGeo = useMemo(() => hullGeometry(geomShip), [key]);
  const decks = sortedDecks(design);
  const activeIdx = decks.findIndex((d) => d.id === activeDeckId);
  const testing = mode === "test";
  const visibleDeckIds = new Set(view.isolateDeck && !testing ? decks.slice(0, activeIdx + 1).map((d) => d.id) : decks.map((d) => d.id));
  const c = analysis?.condition;

  return (
    <>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <ShipMotion>
          {view.showHull && (
            <mesh geometry={hullGeo} renderOrder={1}>
              <meshStandardMaterial color={p.hull} transparent opacity={p.dark ? 0.1 : 0.14} side={THREE.DoubleSide} depthWrite={false} metalness={0} roughness={0.9} />
            </mesh>
          )}
          {view.showHull && (
            <lineSegments renderOrder={2}>
              <edgesGeometry args={[hullGeo, 25]} />
              <lineBasicMaterial color={p.hullEdge} transparent opacity={0.7} />
            </lineSegments>
          )}
          {decks.map((d) => (
            <DeckPlate key={d.id} ship={geomShip} z={d.z} active={d.id === activeDeckId && !testing} visible={visibleDeckIds.has(d.id)} />
          ))}
          {view.showBulkheads && <Bulkheads ship={geomShip} />}
          <Spaces visibleDeckIds={visibleDeckIds} />
          <Doors visibleDeckIds={visibleDeckIds} />
          <FailingWalls visibleDeckIds={visibleDeckIds} />
          <LSAs visibleDeckIds={visibleDeckIds} />
          {(view.showRoutes || (testing && testKind === "evac")) && !(testing && testKind === "evac") && <Routes visibleDeckIds={visibleDeckIds} />}
          {!testing && <FloodCase />}
          {testing && testKind === "flood" && <FloodWater />}
          {testing && testKind === "evac" && <EvacDots />}
          {!testing && <FlagPins />}
          <RefMeshView />
        </ShipMotion>
        {c && !c.overloaded && (testing || view.showWater) && (
          <Sea T={c.T} lcf={c.hydro.LCF} trimTan={testing ? 0 : (c.draftAft - c.draftFwd) / Math.max(1, c.hydro.maxXs - c.hydro.minXs)} L={design.hull.LOA} B={design.hull.BOA} />
        )}
        {!testing && <Interaction ship={geomShip} />}
      </group>
    </>
  );
}

// ------------------------------------------------------------------ test-mode ship motion

function ShipMotion({ children }: { children: ReactNode }) {
  const pivot = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const t = useRef(0);
  const mode = useStore((s) => s.mode);
  const test = useStore((s) => s.test);
  const analysis = useStore((s) => s.analysis);
  const design = useStore((s) => s.design);
  const c = analysis?.condition;
  const motion = useMemo(() => {
    if (mode !== "test" || test.kind !== "sea" || !analysis?.ship || !c || c.overloaded) return null;
    try {
      return motions(analysis.ship, c, { speedKn: test.speedKn, waveFreq: test.waveFreq, waveAmp: test.waveAmp, relHeadingDeg: test.headingDeg, positionPct: 90 });
    } catch {
      return null;
    }
  }, [mode, test.kind, test.speedKn, test.waveFreq, test.waveAmp, test.headingDeg, analysis, c]);
  useEffect(() => {
    t.current = 0;
    live.history = [];
  }, [test.restart, test.kind, mode]);

  useFrame((_, dt) => {
    const P = pivot.current,
      I = inner.current;
    if (!P || !I) return;
    if (mode !== "test" || !c) {
      P.position.set(0, 0, 0);
      P.rotation.set(0, 0, 0);
      I.position.set(0, 0, 0);
      return;
    }
    if (test.running) t.current += Math.min(dt, 0.1) * test.timeScale;
    const time = t.current;
    live.t = time;
    const lcf = c.hydro.LCF,
      T = c.T;
    I.position.set(-lcf, 0, -T);
    let heave = 0,
      pitch = 0,
      roll = 0;
    if (test.kind === "sea" && motion) {
      const we = Math.max(Math.abs(motion.encounterFreq), 0.05);
      heave = motion.heaveAmp * Math.cos(we * time);
      pitch = motion.pitchAmpDeg * D2R * Math.sin(we * time);
      roll = motion.rollAmpDeg * D2R * Math.sin(we * time + 0.6);
      const xBow = 0.9 * design.hull.LOA - lcf;
      live.heave = heave;
      live.pitchDeg = pitch / D2R;
      live.rollDeg = roll / D2R;
      live.vertAcc = -we * we * (heave - pitch * xBow);
      pushHistory(time, live.heave, live.rollDeg);
    } else if (test.kind === "heel") {
      const gz = analysis?.gz;
      const maxDeg = Math.min(gz?.rangeDeg ?? 60, 75);
      const deg = test.heelSweep ? maxDeg * (0.5 - 0.5 * Math.cos((2 * Math.PI * time) / 14)) : test.heelDeg;
      roll = deg * D2R;
      live.heelDeg = deg;
      live.gz = gz ? gzAt(gz, deg) : 0;
      pushHistory(time, deg, live.gz);
    } else if (test.kind === "flood") {
      const fl = analysis?.flood;
      const cs = fl?.ok ? fl.cases[test.floodCase] : undefined;
      const p = ease(Math.min(1, time / 6));
      live.floodProgress = p;
      if (cs) {
        const Td = cs.draft ?? fl!.bulkheadDeckZ + 1.5;
        const dA = cs.draftAft ?? Td + 2,
          dF = cs.draftFwd ?? Td;
        heave = -(Td - T) * p;
        pitch = -Math.atan((dA - dF) / design.hull.LOA) * p;
        if (cs.GMd !== null && cs.GMd <= 0) roll = 25 * D2R * p;
        live.draftAft = c.draftAft + (dA - c.draftAft) * p;
        live.draftFwd = c.draftFwd + (dF - c.draftFwd) * p;
      }
    }
    P.position.set(lcf, 0, T + heave);
    P.rotation.set(roll, pitch, 0);
  });
  return (
    <group ref={pivot}>
      <group ref={inner}>{children}</group>
    </group>
  );
}

function ease(x: number) {
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

let lastPush = 0;
function pushHistory(t: number, a: number, b: number) {
  if (t - lastPush < 0.1 && t >= lastPush) return;
  lastPush = t;
  live.history.push({ t, a, b });
  if (live.history.length > 240) live.history.shift();
}

/**
 * Polygon wireframe sea (after the reference wave): a displaced quad grid drawn as lines over a
 * dark fill that hides what lies below, fading out with the scene fog. Moves gently in design
 * mode and with the vessel.js encounter frequency in the waves test.
 */
function Sea({ T, L, B, lcf, trimTan }: { T: number; L: number; B: number; lcf: number; trimTan: number }) {
  const p = usePalette();
  const test = useStore((s) => s.test);
  const testing = useStore((s) => s.mode === "test");
  const analysis = useStore((s) => s.analysis);
  const SX = 110,
    SY = 56;
  const geo = useMemo(() => new THREE.PlaneGeometry(L * 3.2, B * 12, SX, SY), [L, B]);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", geo.getAttribute("position")); // shares the displaced vertices
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3), 3));
    const idx: number[] = [];
    const W = SX + 1;
    for (let j = 0; j <= SY; j++)
      for (let i = 0; i < SX; i++) idx.push(j * W + i, j * W + i + 1);
    for (let i = 0; i <= SX; i++)
      for (let j = 0; j < SY; j++) idx.push(j * W + i, (j + 1) * W + i);
    g.setIndex(idx);
    return g;
  }, [geo]);
  const base = useMemo(() => Float32Array.from(geo.getAttribute("position").array as Float32Array), [geo]);
  const lineRGB = useMemo(() => new THREE.Color(p.seaLine), [p.seaLine]);
  const fillRGB = useMemo(() => new THREE.Color(p.seaFill), [p.seaFill]);
  const we = useMemo(() => {
    if (test.kind !== "sea" || !analysis?.ship || !analysis.condition) return test.waveFreq;
    try {
      return Math.abs(motions(analysis.ship, analysis.condition, { speedKn: test.speedKn, waveFreq: test.waveFreq, waveAmp: test.waveAmp, relHeadingDeg: test.headingDeg, positionPct: 50 }).encounterFreq) || test.waveFreq;
    } catch {
      return test.waveFreq;
    }
  }, [test.kind, test.speedKn, test.waveFreq, test.waveAmp, test.headingDeg, analysis]);
  useFrame((state) => {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const sea = testing && test.kind === "sea";
    const A = sea ? test.waveAmp : testing ? 0.12 : 0.18;
    const k = ((sea ? test.waveFreq : 0.9) ** 2) / G;
    const w = sea ? we : 0.55;
    const b = (sea ? test.headingDeg : 160) * D2R;
    const dx = Math.cos(b),
      dy = Math.sin(b);
    const t = testing ? live.t : state.clock.elapsedTime;
    const colAttr = lineGeo.getAttribute("color") as THREE.BufferAttribute;
    const col = colAttr.array as Float32Array;
    // short "chop" on top of the physical swell: visual texture only, the ship motion uses the swell
    const C = sea ? 0.18 + 0.12 * A : 0.12;
    const span = A * 1.35 + C * 1.6 + 0.04;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i] + L / 2,
        y = base[i + 1];
      // swell + cross swell + chop, so the surface reads as faceted polygons rather than a liquid sheet
      const zz =
        A * Math.cos(k * (x * dx + y * dy) - w * t) +
        A * 0.35 * Math.cos(k * 1.7 * (x * 0.6 - y * 0.8) - w * 1.3 * t + 1.1) +
        C * Math.sin(0.42 * x * dx + 0.42 * y * dy - 1.6 * t) * Math.cos(0.31 * (y * dx - x * dy) + 0.7 * t) +
        C * 0.6 * Math.sin(0.23 * x - 0.37 * y + 1.1 * t);
      a[i + 2] = zz;
      // crests bright, troughs fade into the background (as in the reference wave)
      const u = 0.18 + 0.82 * Math.min(1, Math.max(0, 0.5 + (0.5 * zz) / span));
      col[i] = lineRGB.r * u + fillRGB.r * (1 - u);
      col[i + 1] = lineRGB.g * u + fillRGB.g * (1 - u);
      col[i + 2] = lineRGB.b * u + fillRGB.b * (1 - u);
    }
    colAttr.needsUpdate = true;
    pos.needsUpdate = true;
  });
  return (
    <group position={[lcf, 0, T]} rotation={[0, Math.atan(trimTan), 0]}>
      <group position={[L / 2 - lcf, 0, 0]}>
        <mesh geometry={geo} renderOrder={3} position={[0, 0, -0.03]}>
          <meshBasicMaterial color={p.seaFill} transparent opacity={testing ? 0.9 : 0.62} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        <lineSegments geometry={lineGeo} renderOrder={4}>
          <lineBasicMaterial vertexColors transparent opacity={p.dark ? 0.75 : 0.6} depthWrite={false} />
        </lineSegments>
      </group>
    </group>
  );
}

function FloodWater() {
  const analysis = useStore((s) => s.analysis);
  const idx = useStore((s) => s.test.floodCase);
  const design = useStore((s) => s.design);
  const ref = useRef<THREE.Mesh>(null);
  const fl = analysis?.flood;
  const cs = fl?.ok ? fl.cases[idx] : undefined;
  const c = analysis?.condition;
  useFrame(() => {
    if (!ref.current || !cs || !c) return;
    const Td = cs.draft ?? fl!.bulkheadDeckZ + 1.5;
    const level = (c.T + (Td - c.T)) * Math.max(0.02, live.floodProgress);
    ref.current.scale.set(1, 1, Math.max(0.01, level));
    ref.current.position.z = level / 2;
  });
  if (!cs) return null;
  return (
    <mesh ref={ref} position={[(cs.xAft + cs.xFwd) / 2, 0, 0.5]} renderOrder={8}>
      <boxGeometry args={[cs.xFwd - cs.xAft, design.hull.BOA * 0.92, 1]} />
      <meshStandardMaterial color={cs.survives ? "#8a9aa3" : "#e5484d"} transparent opacity={0.55} roughness={0.9} depthWrite={false} />
    </mesh>
  );
}

/** Visual walk-through of the escape routes (people as dots). The Circ.1533 numbers are in the panel. */
function EvacDots() {
  const analysis = useStore((s) => s.analysis);
  const design = useStore((s) => s.design);
  const restart = useStore((s) => s.test.restart);
  const ref = useRef<THREE.InstancedMesh>(null);
  const agents = useMemo(() => {
    const evac = analysis?.evac;
    if (!evac?.ok) return [];
    const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
    const total = evac.persons || 1;
    const per = Math.max(1, Math.ceil(total / 320));
    const out: { pts: THREE.Vector3[]; cum: number[]; slow: boolean[]; delay: number; persons: number }[] = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [sid, r] of evac.assignments) {
      const s = design.spaces.find((x) => x.id === sid);
      if (!s) continue;
      const z0 = (deckZ.get(s.deckId) ?? 0) + 0.9;
      const pts = [new THREE.Vector3(s.xCentre, s.yCentre, z0)];
      for (const st of r.steps) pts.push(new THREE.Vector3(st.conn.x, st.conn.y, (deckZ.get(st.conn.deckId) ?? 0) + 0.9));
      const last = design.spaces.find((x) => x.id === r.steps[r.steps.length - 1].space);
      if (last) pts.push(new THREE.Vector3(last.xCentre + (rnd() - 0.5) * last.length * 0.7, last.yCentre + (rnd() - 0.5) * last.breadth * 0.7, (deckZ.get(last.deckId) ?? 0) + 0.9));
      // Manhattan legs inside spaces
      const path: THREE.Vector3[] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = path[path.length - 1],
          b = pts[i];
        if (Math.abs(a.z - b.z) < 0.01 && Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) path.push(new THREE.Vector3(b.x, a.y, a.z));
        path.push(b);
      }
      const cum = [0];
      const slow: boolean[] = [];
      for (let i = 1; i < path.length; i++) {
        const isStair = Math.abs(path[i].z - path[i - 1].z) > 0.01;
        slow.push(isStair);
        cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]) * (isStair ? 1.4 : 1));
      }
      const n = Math.max(1, Math.round(s.persons / per));
      for (let k = 0; k < n; k++) out.push({ pts: path.map((p) => p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, 0))), cum, slow, delay: rnd() * 25, persons: Math.min(per, s.persons - k * per) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, design, restart]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const simT = live.t * 6; // walk-through runs 6x faster than real time
    let arrived = 0,
      total = 0;
    agents.forEach((a, i) => {
      const dist = Math.max(0, simT - a.delay) * 1.2;
      const end = a.cum[a.cum.length - 1];
      let p: THREE.Vector3;
      let onStair = false;
      if (dist >= end) {
        p = a.pts[a.pts.length - 1];
        arrived += a.persons;
      } else {
        let j = 1;
        while (j < a.cum.length && a.cum[j] < dist) j++;
        const u = (dist - a.cum[j - 1]) / Math.max(1e-6, a.cum[j] - a.cum[j - 1]);
        p = a.pts[j - 1].clone().lerp(a.pts[j], u);
        onStair = a.slow[j - 1];
      }
      total += a.persons;
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(dist >= end ? "#46a758" : onStair ? "#e0803c" : "#efece7"));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    live.evacTime = simT;
    live.evacArrived = arrived;
    live.evacTotal = total;
  });
  if (!agents.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, agents.length]} renderOrder={10}>
      <sphereGeometry args={[0.32, 10, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ------------------------------------------------------------------ static scene parts

function DeckPlate({ ship, z, active, visible }: { ship: ReturnType<typeof createShip>; z: number; active: boolean; visible: boolean }) {
  const geo = useMemo(() => deckGeometry(ship, z), [ship, z]);
  const p = usePalette();
  if (!visible) return null;
  return (
    <mesh geometry={geo} position={[0, 0, z]} renderOrder={0}>
      <meshStandardMaterial color={active ? p.deckActive : p.deck} transparent opacity={active ? 0.95 : 0.4} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={1} />
    </mesh>
  );
}

function Bulkheads({ ship }: { ship: ReturnType<typeof createShip> }) {
  const design = useStore((s) => s.design);
  const selection = useStore((s) => s.selection);
  const status = useStore((s) => s.analysis?.statusById);
  const select = useStore((s) => s.select);
  const decks = sortedDecks(design);
  const bhd = design.decks.find((d) => d.id === design.bulkheadDeckId)?.z ?? design.hull.depth;
  const top = decks.length ? decks[decks.length - 1].z + deckHeight(design, decks[decks.length - 1].id) : design.hull.depth;
  return (
    <>
      {design.bulkheads.map((b) => {
        const geo = sectionGeometry(ship, b.x, b.kind === "watertight" ? bhd : Math.min(top, design.hull.depth * 1.8));
        const sel = selection?.kind === "bulkhead" && selection.id === b.id;
        const st = status?.get(b.id);
        const color = st && st !== "green" ? STATUS_COLOR[st] : b.kind === "watertight" ? "#8fa3b5" : "#e0803c";
        return (
          <mesh
            key={b.id}
            geometry={geo}
            renderOrder={4}
            onClick={(e) => {
              if (useStore.getState().tool.kind !== "select" || useStore.getState().mode !== "design") return;
              e.stopPropagation();
              select({ kind: "bulkhead", id: b.id });
            }}
          >
            <meshBasicMaterial color={color} transparent opacity={sel ? 0.55 : 0.2} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

function Spaces({ visibleDeckIds }: { visibleDeckIds: Set<string> }) {
  const design = useStore((s) => s.design);
  const activeDeckId = useStore((s) => s.activeDeckId);
  const testing = useStore((s) => s.mode === "test");
  const [hover, setHover] = useState<string | null>(null);
  return (
    <>
      {design.spaces.map((s) => {
        const ids = spaceDeckIds(design, s);
        if (!ids.some((id) => visibleDeckIds.has(id))) return null;
        return <SpaceBox key={s.id} s={s} onActive={testing || ids.includes(activeDeckId)} hovered={hover === s.id} setHover={setHover} />;
      })}
    </>
  );
}

function SpaceBox({ s, onActive, hovered, setHover }: { s: Space; onActive: boolean; hovered: boolean; setHover: (id: string | null) => void }) {
  const design = useStore((st) => st.design);
  const selected = useStore((st) => st.selection?.kind === "space" && st.selection.id === s.id);
  const status = useStore((st) => st.analysis?.statusById.get(s.id));
  const tool = useStore((st) => st.tool);
  const testing = useStore((st) => st.mode === "test");
  const showLabels = useStore((st) => st.view.showLabels);
  const assembleAt = useStore((st) => st.assembleAt);
  const p = usePalette();
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const { zBase, height } = spaceVertical(design, s);
  const h = Math.max(0.3, height - 0.12);
  const flagged = status === "red" || status === "amber";
  const baseZ = zBase + 0.06 + h / 2;
  const tankFill = s.type === "tank" && s.tank ? s.tank.fillPct / 100 : null;
  const baseOpacity = onActive ? (p.dark ? 0.86 : 0.92) : 0.16;
  // Assembly animation (after the reference): on a design load the rooms drop in deck by deck,
  // aft to forward; a newly placed room drops a short distance.
  const anim = useRef({ start: 0, delay: 0, from: 0, lift: 0 });
  useEffect(() => {
    const now = performance.now() / 1000;
    const fresh = now - assembleAt < 1.2;
    const decks = sortedDecks(design);
    const di = Math.max(0, decks.findIndex((d) => d.id === s.deckId));
    let hsh = 0;
    for (const ch of s.id) hsh = (hsh * 31 + ch.charCodeAt(0)) % 997;
    anim.current = { start: now, delay: fresh ? di * 0.16 + (s.xCentre / design.hull.LOA) * 0.55 + (hsh / 997) * 0.2 : 0, from: fresh ? 14 + (hsh % 17) : 3, lift: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembleAt]);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const A = anim.current;
    const u = Math.min(1, Math.max(0, (performance.now() / 1000 - A.start - A.delay) / 0.75));
    const e = 1 - (1 - u) ** 3;
    const k = 1 - Math.exp(-dt * 12);
    const hot = hovered && onActive && !testing;
    const big = hot ? 1.05 : 1;
    m.scale.x += (big - m.scale.x) * k;
    m.scale.y += (big - m.scale.y) * k;
    A.lift += ((hot ? 0.35 : 0) - A.lift) * k;
    m.position.z = baseZ + A.lift + A.from * (1 - e);
    if (mat.current) {
      mat.current.opacity = baseOpacity * (0.1 + 0.9 * e);
      mat.current.emissiveIntensity = hot || selected ? 0.18 : 0;
    }
  });
  // flagged rooms: solid tint towards the status colour and a crisp outline, no glow
  const fill = useMemo(() => (flagged ? new THREE.Color(TYPE_COLOR[s.type]).lerp(new THREE.Color(STATUS_COLOR[status!]), 0.55) : new THREE.Color(TYPE_COLOR[s.type])), [flagged, status, s.type]);
  const edge = selected ? p.edge : flagged ? STATUS_COLOR[status!] : p.dark ? "#000000" : "#ffffff";
  return (
    <mesh
      ref={ref}
      position={[s.xCentre, s.yCentre, baseZ]}
      renderOrder={onActive ? 5 : 2}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(s.id);
      }}
      onPointerOut={() => setHover(null)}
      onClick={(e) => {
        if (tool.kind === "select" || testing) e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        focusOn(s.xCentre, s.yCentre, zBase + h / 2);
      }}
      onPointerDown={(e) => {
        if (tool.kind !== "select" || e.button !== 0 || testing) return;
        e.stopPropagation();
        const st = useStore.getState();
        st.select({ kind: "space", id: s.id });
        if (!onActive) {
          st.set({ activeDeckId: s.deckId });
          return;
        }
        startDrag(e, s);
      }}
    >
      <boxGeometry args={[Math.max(0.1, s.length - 0.1), Math.max(0.1, s.breadth - 0.1), h]} />
      <meshStandardMaterial ref={mat} color={fill} transparent opacity={baseOpacity} emissive={fill} emissiveIntensity={0} depthWrite={onActive} roughness={0.85} metalness={0} />
      <Edges color={edge} threshold={15} lineWidth={selected ? 1.6 : flagged ? 1.6 : 1} transparent opacity={selected || flagged ? 1 : p.dark ? 0.35 : 0.6} />
      {tankFill !== null && tankFill > 0 && (
        <mesh position={[0, 0, -h / 2 + (h * tankFill) / 2]}>
          <boxGeometry args={[Math.max(0.1, s.length - 0.3), Math.max(0.1, s.breadth - 0.3), Math.max(0.02, h * tankFill)]} />
          <meshStandardMaterial color={s.tank!.content === "fuel" ? "#6b4a2b" : s.tank!.content === "ballast" ? "#4f5f63" : "#7c8f96"} transparent opacity={0.9} roughness={0.9} />
        </mesh>
      )}
      {((hovered && onActive && tool.kind !== "door") || selected || (showLabels && onActive && !testing)) && (
        <Html position={[0, 0, h / 2 + 0.5]} center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
          <div className="anim-wipe rounded border border-line bg-surface/95 px-2 py-[3px] text-[11px] whitespace-nowrap text-fg shadow-[0_6px_18px_-8px_rgba(0,0,0,0.5)]">
            {s.name}
            {(hovered || selected) && <span className="text-muted"> {TYPE_LABEL[s.type]}</span>}
            {(hovered || selected) && s.persons > 0 && <span className="text-faint"> {s.persons} p</span>}
            {(hovered || selected) && tankFill !== null && <span className="text-faint"> {s.tank!.fillPct}% {s.tank!.content.replace("_", " ")}</span>}
            {flagged && <span style={{ color: STATUS_COLOR[status!] }}> flagged</span>}
          </div>
        </Html>
      )}
    </mesh>
  );
}

/** Exit-sign icon (rounded square, white door with an arrow) as a texture, cached per colour. */
const exitTextures = new Map<string, THREE.CanvasTexture>();
function exitIcon(color: string): THREE.CanvasTexture {
  const hit = exitTextures.get(color);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(4, 4, 56, 56, 13);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeRect(14, 15, 18, 34); // door
  g.beginPath(); // arrow out of the door
  g.moveTo(28, 32);
  g.lineTo(51, 32);
  g.moveTo(43, 24);
  g.lineTo(51, 32);
  g.lineTo(43, 40);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  exitTextures.set(color, t);
  return t;
}

/** Screen-size exit icon: stays the same size at any zoom and shows through rooms. */
function ExitIcon({ color, z, size = 0.02, pick }: { color: string; z: number; size?: number; pick?: object }) {
  return (
    <sprite position={[0, 0, z]} scale={[size, size, 1]} renderOrder={14} {...pick}>
      <spriteMaterial map={exitIcon(color)} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
    </sprite>
  );
}

function Doors({ visibleDeckIds }: { visibleDeckIds: Set<string> }) {
  const design = useStore((s) => s.design);
  const analysis = useStore((s) => s.analysis);
  const selection = useStore((s) => s.selection);
  const activeDeckId = useStore((s) => s.activeDeckId);
  const testing = useStore((s) => s.mode === "test");
  // Exit icons are hidden by default (too busy); they show when the "Emergency doors" view toggle is on,
  // while the door tool is active (active deck only), and on the selected door.
  const showDoors = useStore((s) => s.view.showDoors);
  const doorTool = useStore((s) => s.tool.kind === "door");
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  const conns = analysis?.graph.conns ?? [];
  return (
    <>
      {design.doors.map((d) => {
        if (!visibleDeckIds.has(d.deckId)) return null;
        const conn = conns.find((c) => c.id === d.id);
        const bad = !conn || conn.b === OUTSIDE;
        const alongY = design.spaces.some((s) => {
          const r = rectOf(s);
          return spaceDeckIds(design, s).includes(d.deckId) && (Math.abs(d.x - r.x0) < 0.25 || Math.abs(d.x - r.x1) < 0.25) && d.y > r.y0 - 0.25 && d.y < r.y1 + 0.25;
        });
        // Emergency door: drawn a little wider than its clear width so it is easy to see and click,
        // plus a screen-size exit icon on the active deck (and on flagged doors) that shows through the rooms.
        const w = Math.max(1.0, d.widthMm / 1000 + 0.2);
        const sel = selection?.kind === "door" && selection.id === d.id;
        const st = analysis?.statusById.get(d.id);
        const color = sel ? "#ffffff" : bad ? STATUS_COLOR.amber : st && st !== "green" ? STATUS_COLOR[st] : EXIT_COLOR;
        const z0 = deckZ.get(d.deckId) ?? 0;
        const pick = {
          onClick: (e: ThreeEvent<MouseEvent>) => {
            if (useStore.getState().tool.kind === "select") e.stopPropagation();
          },
          onPointerDown: (e: ThreeEvent<PointerEvent>) => {
            if (useStore.getState().tool.kind !== "select" || useStore.getState().mode !== "design") return;
            e.stopPropagation();
            useStore.getState().select({ kind: "door", id: d.id });
          },
        };
        return (
          <group key={d.id} position={[d.x, d.y, z0]}>
            <mesh position={[0, 0, 1.05]} renderOrder={6} {...pick}>
              <boxGeometry args={alongY ? [0.6, w, 2.1] : [w, 0.6, 2.1]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={showDoors || sel ? 0.6 : 0.3} roughness={0.7} />
            </mesh>
            {!testing && (sel || (showDoors && (d.deckId === activeDeckId || bad || (st && st !== "green"))) || (doorTool && d.deckId === activeDeckId)) && <ExitIcon color={color} z={2.6} pick={pick} />}
          </group>
        );
      })}
    </>
  );
}

function LSAs({ visibleDeckIds }: { visibleDeckIds: Set<string> }) {
  const design = useStore((s) => s.design);
  const selection = useStore((s) => s.selection);
  const status = useStore((s) => s.analysis?.statusById);
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  return (
    <>
      {(design.lsa ?? []).map((l: LSA) => {
        if (!visibleDeckIds.has(l.deckId)) return null;
        const z = (deckZ.get(l.deckId) ?? 0) + (l.kind === "lifeboat" ? 2.2 : 0.8);
        const sel = selection?.kind === "lsa" && selection.id === l.id;
        const st = status?.get(l.id);
        const color = st === "red" || st === "amber" ? STATUS_COLOR[st] : LSA_COLOR[l.kind];
        return (
          <group
            key={l.id}
            position={[l.x, l.y, z]}
            onPointerDown={(e) => {
              if (useStore.getState().tool.kind !== "select" || useStore.getState().mode !== "design") return;
              e.stopPropagation();
              useStore.getState().select({ kind: "lsa", id: l.id });
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {l.kind === "lifeboat" ? (
              <mesh rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.75]}>
                <capsuleGeometry args={[1.3, 6.5, 6, 12]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={sel ? 0.6 : 0.2} roughness={0.5} />
              </mesh>
            ) : (
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.6, 0.6, 1.6, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={sel ? 0.6 : 0.1} />
              </mesh>
            )}
            {sel && <Edges color="#ffffff" />}
          </group>
        );
      })}
    </>
  );
}

/** Red bars on walls whose fire rating is too low. */
function FailingWalls({ visibleDeckIds }: { visibleDeckIds: Set<string> }) {
  const design = useStore((s) => s.design);
  const analysis = useStore((s) => s.analysis);
  const edges = useMemo(() => sharedEdges(design), [design]);
  const bad = new Set<string>();
  const fw = analysis?.rules.find((r) => r.ruleId === "FIRE-WALL-RATING");
  for (const f of fw?.findings ?? []) if (f.targets.length === 2) bad.add(pairKey(f.targets[0], f.targets[1]));
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  return (
    <>
      {edges
        .filter((e) => bad.has(pairKey(e.a, e.b)) && visibleDeckIds.has(e.deckId))
        .map((e, i) => {
          const z = (deckZ.get(e.deckId) ?? 0) + 1.3;
          const alongX = e.y0 === e.y1;
          return (
            <mesh key={i} position={[(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2, z]} renderOrder={7}>
              <boxGeometry args={alongX ? [e.length, 0.18, 2.6] : [0.18, e.length, 2.6]} />
              <meshBasicMaterial color={STATUS_COLOR.red} />
            </mesh>
          );
        })}
    </>
  );
}

/**
 * Minimal map pins above flagged rooms on the active deck (after the 3D reference): a thin outline
 * pin with a crisp status dot. Click a pin to select the room.
 */
function FlagPins() {
  const design = useStore((s) => s.design);
  const status = useStore((s) => s.analysis?.statusById);
  const activeDeckId = useStore((s) => s.activeDeckId);
  const selectedId = useStore((s) => (s.selection?.kind === "space" ? s.selection.id : null));
  if (!status) return null;
  const flagged = design.spaces
    .filter((s) => (status.get(s.id) === "red" || status.get(s.id) === "amber") && s.deckId === activeDeckId)
    .sort((a, b) => (status.get(a.id) === "red" ? -1 : 1) - (status.get(b.id) === "red" ? -1 : 1))
    .slice(0, 24);
  return (
    <>
      {flagged.map((s, i) => {
        const v = spaceVertical(design, s);
        const st = status.get(s.id)!;
        const color = st === "red" ? "var(--bad)" : "var(--warn)";
        return (
          <Html key={s.id} position={[s.xCentre, s.yCentre, v.zBase + Math.min(v.height, 3.2) + 1.2]} center zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
            {/* visual only: the room underneath stays grabbable */}
            <div className="anim-pop flex flex-col items-center" style={{ animationDelay: `${300 + i * 35}ms`, opacity: selectedId === s.id ? 1 : 0.92, pointerEvents: "none", transform: "translateY(-12px)" }}>
              <svg width="18" height="24" viewBox="0 0 18 24">
                <path d="M9 23 C9 23 2 14.5 2 9 a7 7 0 0 1 14 0 C16 14.5 9 23 9 23 Z" fill="var(--surface)" stroke="var(--fg)" strokeWidth="1.1" />
                <circle cx="9" cy="9" r="3" fill={color} />
              </svg>
            </div>
          </Html>
        );
      })}
    </>
  );
}

function Routes({ visibleDeckIds }: { visibleDeckIds: Set<string> }) {
  const design = useStore((s) => s.design);
  const evac = useStore((s) => s.analysis?.evac);
  const graph = useStore((s) => s.analysis?.graph);
  const selection = useStore((s) => s.selection);
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  if (!evac?.ok) return null;
  const lines: { pts: [number, number, number][]; hi: boolean }[] = [];
  for (const [sid, r] of evac.assignments) {
    const s = design.spaces.find((x) => x.id === sid);
    if (!s || !visibleDeckIds.has(s.deckId)) continue;
    const pts: [number, number, number][] = [[s.xCentre, s.yCentre, (deckZ.get(s.deckId) ?? 0) + 0.6]];
    for (const st of r.steps) pts.push([st.conn.x, st.conn.y, (deckZ.get(st.conn.deckId) ?? 0) + 0.6]);
    lines.push({ pts, hi: selection?.id === sid });
  }
  // A selected room with no persons has no evacuation assignment: draw its shortest route anyway.
  const selSpace = selection?.kind === "space" && !evac.assignments.has(selection.id) && graph ? design.spaces.find((x) => x.id === selection.id) : undefined;
  const selRoute = selSpace && visibleDeckIds.has(selSpace.deckId) ? shortestRoute(graph!, selSpace.id, (q) => q.type === "muster_station") : null;
  if (selSpace && selRoute) {
    const pts: [number, number, number][] = [[selSpace.xCentre, selSpace.yCentre, (deckZ.get(selSpace.deckId) ?? 0) + 0.6]];
    for (const st of selRoute.steps) pts.push([st.conn.x, st.conn.y, (deckZ.get(st.conn.deckId) ?? 0) + 0.6]);
    lines.push({ pts, hi: true });
  }
  return (
    <>
      {lines.map((l, i) => (
        <Line key={i} points={l.pts} color={l.hi ? "#e5484d" : "#e0803c"} lineWidth={l.hi ? 2.5 : 1.2} transparent opacity={l.hi ? 1 : 0.8} dashed={!l.hi} dashSize={0.8} gapSize={0.4} />
      ))}
    </>
  );
}

function FloodCase() {
  const flood = useStore((s) => s.analysis?.flood);
  const idx = useStore((s) => s.focusCase);
  const design = useStore((s) => s.design);
  if (!flood?.ok || idx === null || !flood.cases[idx]) return null;
  const c = flood.cases[idx];
  const len = c.xFwd - c.xAft;
  const zB = flood.bulkheadDeckZ;
  const T = c.draft;
  const trimTan = c.draftAft !== null && c.draftFwd !== null ? (c.draftAft - c.draftFwd) / design.hull.LOA : 0;
  return (
    <>
      <mesh position={[(c.xAft + c.xFwd) / 2, 0, zB / 2]} renderOrder={8}>
        <boxGeometry args={[len, design.hull.BOA, zB]} />
        <meshBasicMaterial color={c.survives ? "#8a9aa3" : "#e5484d"} transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {T !== null && (
        <mesh position={[design.hull.LOA / 2, 0, T]} rotation={[0, Math.atan(trimTan), 0]} renderOrder={9}>
          <planeGeometry args={[design.hull.LOA * 1.6, design.hull.BOA * 3]} />
          <meshBasicMaterial color={c.survives ? "#6f7c84" : "#b8383c"} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}

function RefMeshView() {
  const ref = useStore((s) => s.refMesh);
  const obj = ref?.object as THREE.Object3D | undefined;
  useEffect(() => {
    if (!obj || !ref) return;
    obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
        mm.transparent = true;
        mm.opacity = ref.opacity;
        mm.depthWrite = false;
      }
    });
  }, [obj, ref]);
  if (!ref || !obj || !ref.visible) return null;
  return (
    <group position={ref.offset} rotation={[0, 0, ref.rotZ * D2R]} scale={ref.scale}>
      <primitive object={obj} />
    </group>
  );
}

// ------------------------------------------------------------------ interaction (design mode)

// start is taken from the first move on the deck plane, so the drag does not jump by the
// parallax between the box top (where it was grabbed) and the deck it slides on
type Drag = { id: string; start: { x: number; y: number } | null; orig: { x: number; y: number } };
let drag: Drag | null = null;

function startDrag(_e: ThreeEvent<PointerEvent>, s: Space) {
  drag = { id: s.id, start: null, orig: { x: s.xCentre, y: s.yCentre } };
  useStore.getState().beginGesture();
  window.dispatchEvent(new CustomEvent("viewport:controls", { detail: false }));
}

/** Snap a moving rectangle's edges to the edges of other spaces on the same deck (within 0.6 m). */
function magnet(design: Design, s: Space, x: number, y: number) {
  const others = spacesOnDeck(design, s.deckId).filter((o) => o.id !== s.id);
  const R = 0.6;
  let bestX = { d: R, dx: 0 },
    bestY = { d: R, dy: 0 };
  const sx = [x - s.length / 2, x + s.length / 2],
    sy = [y - s.breadth / 2, y + s.breadth / 2];
  for (const o of others) {
    const r = rectOf(o);
    for (const a of sx)
      for (const b of [r.x0, r.x1]) {
        const d = Math.abs(a - b);
        if (d < bestX.d) bestX = { d, dx: b - a };
      }
    for (const a of sy)
      for (const b of [r.y0, r.y1]) {
        const d = Math.abs(a - b);
        if (d < bestY.d) bestY = { d, dy: b - a };
      }
  }
  return { x: x + bestX.dx, y: y + bestY.dy };
}

type Ghost = { boxes: { x: number; y: number; l: number; b: number; color: string }[]; ok: boolean } | null;

function Interaction({ ship }: { ship: ReturnType<typeof createShip> }) {
  const design = useStore((s) => s.design);
  const activeDeckId = useStore((s) => s.activeDeckId);
  const tool = useStore((s) => s.tool);
  const stampOpts = useStore((s) => s.stampOpts);
  const deck = design.decks.find((d) => d.id === activeDeckId);
  const { controls, camera, gl } = useThree();
  const [ghost, setGhost] = useState<Ghost>(null);
  const [doorGhost, setDoorGhost] = useState<DoorSpot | null>(null);
  const [bhGhost, setBhGhost] = useState<number | null>(null);
  const moveRef = useRef<(p: { x: number; y: number }, shift: boolean) => void>(() => {});
  const clearRef = useRef(() => {});
  clearRef.current = () => {
    setGhost(null);
    setDoorGhost(null);
    setBhGhost(null);
  };

  // Pointer moves are read at window level and intersected with the deck plane directly, so that
  // dragging and previews keep working while the cursor is over other rooms (which take the hover).
  useEffect(() => {
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const onWinMove = (ev: PointerEvent) => {
      const st = useStore.getState();
      const dk = st.design.decks.find((d) => d.id === st.activeDeckId);
      if (!dk || st.mode !== "design") return;
      const r = gl.domElement.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside && !drag) return clearRef.current();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(dk.z + 0.02)), hit)) return;
      moveRef.current(toVessel(hit), ev.shiftKey);
    };
    window.addEventListener("pointermove", onWinMove);
    return () => window.removeEventListener("pointermove", onWinMove);
  }, [camera, gl]);

  useEffect(() => {
    const onCtl = (e: Event) => {
      const c = controls as unknown as { enabled: boolean } | null;
      if (c) c.enabled = (e as CustomEvent).detail as boolean;
    };
    const up = () => {
      if (!drag) return;
      const st = useStore.getState();
      const s = st.design.spaces.find((x) => x.id === drag!.id);
      const hit = s ? overlapsWith(st.design, s) : [];
      const ship = st.analysis?.ship;
      if (hit.length) {
        st.cancelGesture();
        st.notify(`${s!.name} cannot go there: it would overlap ${hit[0].name}. Moved back.`, "error");
      } else if (s && ship && centreOutsideHull(st.design, ship, s)) {
        st.cancelGesture();
        st.notify(`${s.name} cannot go there: it would be outside the hull, in the water. Moved back.`, "error");
      } else st.commit();
      drag = null;
      const c = controls as unknown as { enabled: boolean } | null;
      if (c) c.enabled = true;
    };
    window.addEventListener("viewport:controls", onCtl);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("viewport:controls", onCtl);
      window.removeEventListener("pointerup", up);
    };
  }, [controls]);

  useEffect(() => {
    setGhost(null);
    setDoorGhost(null);
    setBhGhost(null);
  }, [tool]);

  if (!deck) return null;
  const L = design.hull.LOA,
    B = design.hull.BOA;

  const lsaPos = (x: number, y: number) => {
    const hb = halfBreadthAt(ship, Math.min(Math.max(x, 0), L), deck.z + 0.01);
    return { x: snap(x, 0.5), y: (y >= 0 ? 1 : -1) * Math.max(0.5, hb - 0.9) };
  };

  const preview = (x: number, y: number): Ghost => {
    if (tool.kind === "space") {
      const [l, b] = DEFAULT_SIZE[tool.type];
      const probe: Space = { id: "__ghost", name: "ghost", type: tool.type, deckId: deck.id, xCentre: x, yCentre: y, length: l, breadth: b, persons: 0 };
      return { boxes: [{ x, y, l, b, color: TYPE_COLOR[tool.type] }], ok: overlapsWith(design, probe).length === 0 && !centreOutsideHull(design, ship, probe) };
    }
    if (tool.kind === "stamp") {
      const r = tool.stamp === "cabin_block" ? cabinBlock(design, deck.id, x, y, stampOpts) : stairCore(design, deck.id, x, y, stampOpts.stairWidthMm);
      const spaces =
        r.spaces.length > 0
          ? r.spaces
          : tool.stamp === "cabin_block"
            ? [{ xCentre: x + (stampOpts.cabins * stampOpts.cabinLength) / 2, yCentre: y, length: stampOpts.cabins * stampOpts.cabinLength, breadth: stampOpts.corridorWidth + 2 * stampOpts.cabinDepth, type: "cabin" as const }]
            : [{ xCentre: x, yCentre: y, length: 4, breadth: 4, type: "stairwell" as const }];
      return { boxes: spaces.map((s) => ({ x: s.xCentre, y: s.yCentre, l: s.length, b: s.breadth, color: TYPE_COLOR[s.type] })), ok: r.ok && !spaces.some((s) => centreOutsideHull(design, ship, { deckId: deck.id, xCentre: s.xCentre, yCentre: s.yCentre })) };
    }
    return null;
  };

  moveRef.current = (p, shift) => {
    if (drag) {
      const st = useStore.getState();
      const s = st.design.spaces.find((x) => x.id === drag!.id);
      if (!s) return;
      if (!drag.start) {
        drag.start = { x: p.x, y: p.y };
        return;
      }
      let x = snap(drag.orig.x + p.x - drag.start.x);
      let y = snap(drag.orig.y + p.y - drag.start.y);
      if (!shift) ({ x, y } = magnet(st.design, s, x, y));
      if (x === s.xCentre && y === s.yCentre) return;
      st.edit((d) => {
        const t = d.spaces.find((q) => q.id === drag!.id)!;
        t.xCentre = +x.toFixed(3);
        t.yCentre = +y.toFixed(3);
      }, false);
      return;
    }
    const x = snap(p.x),
      y = snap(p.y);
    if (tool.kind === "space" || tool.kind === "stamp") setGhost(preview(x, y));
    else if (tool.kind === "door") setDoorGhost(doorSpot(design, deck.id, p.x, p.y));
    else if (tool.kind === "bulkhead") setBhGhost(snap(p.x, 0.5));
    else if (tool.kind === "lsa") {
      const q = lsaPos(p.x, p.y);
      setGhost({ boxes: [{ x: q.x, y: q.y, l: tool.lsa === "lifeboat" ? 8 : 1.6, b: tool.lsa === "lifeboat" ? 2.6 : 1.2, color: LSA_COLOR[tool.lsa] }], ok: true });
    }
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // it was an orbit drag
    const p = toVessel(e.point);
    const st = useStore.getState();
    const x = snap(p.x),
      y = snap(p.y);
    if (tool.kind === "select") {
      st.select(null);
    } else if (tool.kind === "space") {
      e.stopPropagation();
      const [len, br] = DEFAULT_SIZE[tool.type];
      const decks = sortedDecks(st.design);
      const i = decks.findIndex((d) => d.id === deck.id);
      const id = newId("s");
      const count = st.design.spaces.filter((s) => s.type === tool.type).length + 1;
      const sp: Space = {
        id,
        name: `${TYPE_LABEL[tool.type]} ${count}`,
        type: tool.type,
        deckId: deck.id,
        topDeckId: tool.type === "stairwell" || tool.type === "lift" ? decks[Math.min(i + 1, decks.length - 1)].id : undefined,
        xCentre: x,
        yCentre: y,
        length: len,
        breadth: br,
        persons: DEFAULT_PERSONS[tool.type] ?? 0,
        stair: tool.type === "stairwell" ? { widthMm: 1000, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 2 } : undefined,
        tank: tool.type === "tank" ? { content: "fuel", fillPct: 50 } : undefined,
      };
      const hit = overlapsWith(st.design, sp);
      if (hit.length) {
        st.notify(`Cannot place a ${TYPE_LABEL[tool.type].toLowerCase()} here: it would overlap ${hit[0].name}. Spaces may touch but not overlap.`, "error");
        return;
      }
      if (centreOutsideHull(st.design, ship, sp)) {
        st.notify(`Cannot place a ${TYPE_LABEL[tool.type].toLowerCase()} here: it would be outside the hull, in the water. Click inside the deck outline.`, "error");
        return;
      }
      st.edit((d) => void d.spaces.push(sp));
      st.select({ kind: "space", id });
      st.set({ panel: "inspect" });
    } else if (tool.kind === "stamp") {
      e.stopPropagation();
      const r = tool.stamp === "cabin_block" ? cabinBlock(st.design, deck.id, x, y, st.stampOpts) : stairCore(st.design, deck.id, x, y, st.stampOpts.stairWidthMm);
      if (!r.ok) {
        st.notify(`Cannot stamp here: ${r.error}`, "error");
        return;
      }
      const wet = r.spaces.find((s) => centreOutsideHull(st.design, ship, s));
      if (wet) {
        st.notify(`Cannot stamp here: ${wet.name} would be outside the hull, in the water. Move the stamp inside the deck outline.`, "error");
        return;
      }
      st.edit((d) => {
        d.spaces.push(...r.spaces);
        d.doors.push(...r.doors);
      });
      st.notify(`Added ${r.spaces.length} spaces and ${r.doors.length} doors.`, "ok");
    } else if (tool.kind === "door") {
      e.stopPropagation();
      const w = doorSpot(st.design, deck.id, p.x, p.y);
      if (!w) {
        st.notify("Click closer to a wall: emergency doors snap to the nearest wall between two rooms within 3 m.", "error");
        return;
      }
      const dup = st.design.doors.find((q) => q.deckId === deck.id && Math.hypot(q.x - w.x, q.y - w.y) < 0.6);
      if (dup) {
        st.select({ kind: "door", id: dup.id });
        st.set({ panel: "inspect" });
        st.notify("There is already an emergency door here; it is now selected.", "info");
        return;
      }
      const id = newId("d");
      st.edit((d) => void d.doors.push({ id, deckId: deck.id, x: w.x, y: w.y, widthMm: w.widthMm }));
      const name = (sid?: string) => st.design.spaces.find((q) => q.id === sid)?.name ?? "";
      if (w.b) st.notify(`Emergency door ${w.widthMm} mm added between ${name(w.a)} and ${name(w.b)}.`, "ok");
      else st.notify(`Emergency door added on an outer wall of ${name(w.a)}: it only counts once there is a space on the other side.`, "info");
    } else if (tool.kind === "route") {
      // Escape route tool: connect the clicked room to its neighbouring corridors / stairwells (auto doors),
      // then show and describe its route to an assembly station. Uses the same graph as the checks.
      e.stopPropagation();
      const s = st.design.spaces.find((q) => spaceDeckIds(st.design, q).includes(deck.id) && Math.abs(p.x - q.xCentre) <= q.length / 2 && Math.abs(p.y - q.yCentre) <= q.breadth / 2);
      if (!s) return st.notify("Click inside a room to give it an escape route.", "info");
      if (["stairwell", "muster_station", "lift", "tank", "void"].includes(s.type))
        return st.notify(`${s.name} is a ${TYPE_LABEL[s.type].toLowerCase()}: it does not need an escape route of its own. Click a room people use.`, "info");
      const doors = autoDoors(st.design, s.id);
      if (doors.length) st.edit((d) => void d.doors.push(...doors));
      st.setView({ showRoutes: true });
      st.select({ kind: "space", id: s.id });
      const now = useStore.getState().design;
      const g = buildGraph(now);
      const r = shortestRoute(g, s.id, (q) => q.type === "muster_station");
      const added = doors.length ? `Added ${doors.length} emergency door${doors.length > 1 ? "s" : ""}. ` : "";
      if (!r) st.notify(`${added}${s.name} still has no escape route to an assembly station. Place a corridor or stairwell next to it, then click it again.`, "error");
      else {
        const via = r.steps.map((x) => g.space.get(x.space)).filter((x) => x && x.type === "stairwell").map((x) => x!.name);
        const to = g.space.get(r.steps[r.steps.length - 1].space)?.name ?? "the assembly station";
        st.notify(`${added}Escape route from ${s.name}: ${Math.round(r.length)} m${via.length ? ` via ${[...new Set(via)].join(", ")}` : ""} to ${to} (shown in red).`, doors.length ? "ok" : "info");
      }
    } else if (tool.kind === "bulkhead") {
      e.stopPropagation();
      const id = newId(tool.bk === "watertight" ? "wt" : "mvz");
      st.edit((d) => void d.bulkheads.push({ id, kind: tool.bk, x: snap(p.x, 0.5), rating: tool.bk === "fire_zone" ? "A-60" : "A-0" }));
      st.select({ kind: "bulkhead", id });
    } else if (tool.kind === "lsa") {
      e.stopPropagation();
      const q = lsaPos(p.x, p.y);
      const id = newId(tool.lsa === "lifeboat" ? "lb" : "lr");
      st.edit((d) => void d.lsa.push({ id, kind: tool.lsa, deckId: deck.id, x: q.x, y: q.y, capacity: tool.lsa === "lifeboat" ? 60 : 25, massT: tool.lsa === "lifeboat" ? 3.5 : 0.2 }));
      st.select({ kind: "lsa", id });
    }
  };

  return (
    <>
      <mesh position={[L / 2, 0, deck.z + 0.02]} onClick={onClick}>
        <planeGeometry args={[L + 80, B + 80]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {ghost?.boxes.map((g, i) => (
        <mesh key={i} position={[g.x, g.y, deck.z + 1.2]}>
          <boxGeometry args={[g.l, g.b, 2.4]} />
          <meshBasicMaterial color={ghost.ok ? g.color : STATUS_COLOR.red} transparent opacity={ghost.ok ? 0.4 : 0.55} depthWrite={false} />
          <Edges color={ghost.ok ? "#ffffff" : STATUS_COLOR.red} />
        </mesh>
      ))}
      {doorGhost && (
        <group position={[doorGhost.x, doorGhost.y, deck.z]}>
          <mesh position={[0, 0, 1.05]} renderOrder={13}>
            <boxGeometry args={doorGhost.alongY ? [0.7, Math.max(1.0, doorGhost.widthMm / 1000 + 0.2), 2.1] : [Math.max(1.0, doorGhost.widthMm / 1000 + 0.2), 0.7, 2.1]} />
            <meshBasicMaterial color={doorGhost.b ? EXIT_COLOR : STATUS_COLOR.amber} transparent opacity={0.75} depthTest={false} depthWrite={false} />
          </mesh>
          <ExitIcon color={doorGhost.b ? EXIT_COLOR : STATUS_COLOR.amber} z={2.6} size={0.032} />
        </group>
      )}
      {bhGhost !== null && (
        <mesh position={[bhGhost, 0, design.hull.depth / 2]}>
          <boxGeometry args={[0.15, B, design.hull.depth]} />
          <meshBasicMaterial color={tool.kind === "bulkhead" && tool.bk === "watertight" ? "#8fa3b5" : "#e0803c"} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}
    </>
  );
}
