import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { bbox, type Mesh } from "../core/mesh";
import type { Printer } from "../core/print";

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export interface ViewProps {
  mode: "float" | "print";
  mesh: Mesh;
  printMesh: Mesh;
  printer: Printer;
  bedAngle: number;
  heel: number;
  trim: number;
  waterH: number | null;
  G: [number, number, number];
  dark: boolean;
}

function useGeometry(m: Mesh) {
  const g = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    geo.setIndex(new THREE.BufferAttribute(m.idx, 1));
    geo.computeVertexNormals();
    return geo;
  }, [m]);
  useEffect(() => () => g.dispose(), [g]);
  return g;
}

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** Polygon wireframe water: a displaced quad grid, crests drawn brighter. */
function Water({ size, h, dark }: { size: number; h: number; dark: boolean }) {
  const n = 48;
  const ref = useRef<THREE.LineSegments>(null);
  const { geo, base } = useMemo(() => {
    const pts: number[] = [];
    const s = size / n;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j < n; j++) {
        pts.push(-size / 2 + j * s, -size / 2 + i * s, 0, -size / 2 + (j + 1) * s, -size / 2 + i * s, 0);
        pts.push(-size / 2 + i * s, -size / 2 + j * s, 0, -size / 2 + i * s, -size / 2 + (j + 1) * s, 0);
      }
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(pts);
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pts.length), 3));
    return { geo, base: arr.slice() };
  }, [size]);
  useEffect(() => () => geo.dispose(), [geo]);
  const c0 = useMemo(() => new THREE.Color(dark ? "#3a3a39" : "#c9c6c0"), [dark]);
  const c1 = useMemo(() => new THREE.Color(dark ? "#8f8c87" : "#6e6b66"), [dark]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const c = geo.getAttribute("color") as THREE.BufferAttribute;
    const amp = size * 0.0025;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const w = Math.sin(x * (12 / size) + t * 0.9) * 0.6 + Math.sin((x * 0.6 + y) * (9 / size) - t * 0.7) * 0.4;
      p.setZ(i, w * amp);
      const k = Math.max(0, w) * 0.9;
      c.setXYZ(i, c0.r + (c1.r - c0.r) * k, c0.g + (c1.g - c0.g) * k, c0.b + (c1.b - c0.b) * k);
    }
    p.needsUpdate = true;
    c.needsUpdate = true;
  });
  return (
    <group position={[0, 0, h]}>
      {/* soft veil so the submerged hull reads as under water; the water itself stays a wireframe */}
      <mesh position={[0, 0, -0.05]} renderOrder={1}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={dark ? "#161616" : "#f3f2f0"} transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments ref={ref} geometry={geo} renderOrder={2}>
        <lineBasicMaterial vertexColors transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
}

function Bed({ printer, dark }: { printer: Printer; dark: boolean }) {
  const [W, H] = printer.bed;
  const geo = useMemo(() => {
    const pts: number[] = [];
    const step = 10;
    for (let x = 0; x <= W + 1e-6; x += step) pts.push(x, 0, 0, x, H, 0);
    for (let y = 0; y <= H + 1e-6; y += step) pts.push(0, y, 0, W, y, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [W, H]);
  return (
    <group position={[-W / 2, -H / 2, 0]}>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={dark ? "#2d2d2d" : "#dad7d2"} />
      </lineSegments>
      <mesh position={[W / 2, H / 2, -0.3]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial color={dark ? "#1d1d1d" : "#efede9"} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(W, H, printer.bed[2]).translate(W / 2, H / 2, printer.bed[2] / 2)]} />
        <lineBasicMaterial color={dark ? "#3a3a39" : "#c9c6c0"} transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

function Frame({ target, dist }: { target: [number, number, number]; dist: number }) {
  const { camera } = useThree();
  const key = `${Math.round(dist)}`;
  useEffect(() => {
    camera.position.set(target[0] - dist * 0.55, target[1] - dist * 0.85, target[2] + dist * 0.5);
    camera.lookAt(...target);
    (camera as THREE.PerspectiveCamera).near = dist / 500;
    (camera as THREE.PerspectiveCamera).far = dist * 50;
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function Scene(p: ViewProps) {
  const geo = useGeometry(p.mesh);
  const pgeo = useGeometry(p.printMesh);
  const b = useMemo(() => bbox(p.mesh), [p.mesh]);
  const L = b.max[0] - b.min[0];
  const cx = (b.min[0] + b.max[0]) / 2;
  const hullColor = p.dark ? "#cfccc7" : "#f7f6f4";
  const accent = useMemo(() => css("--accent"), [p.dark]);
  const rot = new THREE.Euler((p.heel * Math.PI) / 180, (p.trim * Math.PI) / 180, 0, "XYZ");
  const span = p.mode === "print" ? Math.max(p.printer.bed[0], p.printer.bed[1]) * 1.4 : Math.max(L, 1) * 1.25;
  return (
    <>
      <ambientLight intensity={p.dark ? 0.55 : 0.75} />
      <directionalLight position={[-1, -2, 3]} intensity={p.dark ? 1.6 : 1.4} />
      <directionalLight position={[2, 1.5, 1]} intensity={0.35} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} target={p.mode === "print" ? [0, 0, 10] : [0, 0, 0]} />
      <Frame target={p.mode === "print" ? [0, 0, 10] : [0, 0, 0]} dist={span} />
      {p.mode === "float" ? (
        <group>
          {/* hull rotated about its own reference, translated so mid-length sits at the origin */}
          <group rotation={rot}>
            <group position={[-cx, 0, 0]}>
              <mesh geometry={geo}>
                <meshStandardMaterial color={hullColor} roughness={0.75} metalness={0.02} side={THREE.DoubleSide} />
              </mesh>
              <mesh position={p.G}>
                <sphereGeometry args={[Math.max(L * 0.007, 0.4), 16, 12]} />
                <meshBasicMaterial color={accent} depthTest={false} transparent />
              </mesh>
            </group>
          </group>
          {p.waterH !== null && <WaterAt h={p.waterH} cx={cx} trim={p.trim} heel={p.heel} size={L * 2.4} dark={p.dark} />}
        </group>
      ) : (
        <group>
          <Bed printer={p.printer} dark={p.dark} />
          <group rotation={[0, 0, (p.bedAngle * Math.PI) / 180]}>
            <mesh geometry={pgeo}>
              <meshStandardMaterial color={hullColor} roughness={0.8} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      )}
    </>
  );
}

/** The waterline h is in the rotated hull frame; the hull group is shifted by -cx before rotation, so shift the water too. */
function WaterAt({ h, cx, trim, heel, size, dark }: { h: number; cx: number; trim: number; heel: number; size: number; dark: boolean }) {
  // world z of R(p - c) is (Rp)_z - (Rc)_z, and (Rc)_z = -cx sin(trim) cos(heel) for c = (cx, 0, 0)
  const zc = -cx * Math.sin((trim * Math.PI) / 180) * Math.cos((heel * Math.PI) / 180);
  return <Water size={size} h={h - zc} dark={dark} />;
}

export default function Viewport(p: ViewProps) {
  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 35, position: [-200, -300, 160], up: [0, 0, 1] }} gl={{ antialias: true }}>
      <Scene {...p} />
    </Canvas>
  );
}
