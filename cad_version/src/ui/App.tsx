import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { DEFAULT_HULL, hullMesh, lambda as lambdaOf, loftSections, PARAMS, planW, sanitize, scaleK, type HullParams } from "../core/hull";
import { bbox, massProps, placeOnBed, rotX, rotZ, scaleM, transform, type Mesh } from "../core/mesh";
import { analyze, DEFAULT_LOAD, printOrient, type Level, type Load } from "../core/analyze";
import { DEFAULT_PRINT, MATERIALS, PRINTERS, type PrintSettings } from "../core/print";
import { download, to3MF, toOBJ, toSTL } from "../core/exporters";
import { LIMITS } from "../core/limits";
import { occHullStep, occInit } from "../occ/client";
import { importFile, type Imported } from "./importer";
import Viewport from "./Viewport";
import { Btn, FindingRow, GzChart, Icon, ICONS, NumField, Row, Section, Select, Slider, Tabs } from "./controls";

type Source = "design" | "import";
type RightTab = "checks" | "stability" | "export" | "test";
type Unit = "mm" | "cm" | "m" | "in";
const UNIT: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

interface ImportOpts {
  unit: Unit;
  yUp: boolean;
  turn: boolean;
  flip: boolean;
  lambda: number;
}

function usePersist<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? { ...init, ...JSON.parse(s) } : init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  }, [key, v]);
  return [v, setV];
}

const f = (v: number | undefined | null, d = 1) => (v === undefined || v === null || !Number.isFinite(v) ? "-" : v.toFixed(d));
const num = (s: string) => {
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

/** Imported mesh to the analysis frame: millimetres, z up, length along x from 0, centred on y, keel at z = 0. */
function prepImport(raw: Mesh, o: ImportOpts): Mesh {
  let m = transform(raw, scaleM(UNIT[o.unit]));
  if (o.yUp) m = transform(m, rotX(90));
  if (o.turn) m = transform(m, rotZ(90));
  if (o.flip) m = transform(m, rotX(180));
  const b = bbox(m);
  return transform(m, scaleM(1), [-b.min[0], -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
}

export default function App() {
  const [dark, setDark] = usePersist("hw.dark", { on: true });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark.on);
  }, [dark.on]);

  const [source, setSource] = useState<Source>("design");
  const [hull, setHull] = usePersist<HullParams>("hw.hull", DEFAULT_HULL);
  const [print, setPrint] = usePersist<PrintSettings>("hw.print", DEFAULT_PRINT);
  const [load, setLoad] = usePersist<Load>("hw.load", DEFAULT_LOAD);
  const [env, setEnv] = usePersist("hw.env", { water: "fresh" as "fresh" | "sea", printFlip: true });
  const [imp, setImp] = useState<Imported | null>(null);
  const [impOpts, setImpOpts] = useState<ImportOpts>({ unit: "mm", yUp: false, turn: false, flip: false, lambda: 1 });
  const [impBusy, setImpBusy] = useState<string | null>(null);
  const [view, setView] = useState<"float" | "print">("float");
  const [heelView, setHeelView] = useState(0);
  const [tab, setTab] = useState<RightTab>("checks");
  const [meas, setMeas] = usePersist("hw.meas", { weighed: "", Ta: "", Tf: "", w: "", d: "", phi: "" });
  const [stepState, setStepState] = useState<{ busy: boolean; msg: string; level: Level } | null>(null);

  const H = useDeferredValue(sanitize(hull));
  const P = useDeferredValue(print);
  const LD = useDeferredValue(load);

  const designMesh = useMemo(() => hullMesh(H, 64, 24), [H]);
  const importMesh = useMemo(() => (imp ? prepImport(imp.raw, impOpts) : null), [imp, impOpts]);
  const useImport = source === "import" && importMesh;
  const mesh = useImport ? importMesh! : designMesh;
  const lam = useImport ? impOpts.lambda : lambdaOf(H);
  const stemHalf = useImport ? undefined : (H.B * scaleK(H) * planW(H, 1)) / 2;

  const A = useMemo(
    () => analyze({ mesh, print: P, load: LD, water: env.water, lambda: lam, stemHalf, printFlip: env.printFlip, weighedPrint: num(meas.weighed) }),
    [mesh, P, LD, env.water, lam, stemHalf, env.printFlip, meas.weighed],
  );
  const printer = PRINTERS.find((p) => p.id === print.printer) ?? PRINTERS[0];

  const worst = (ids: string[]): Level => {
    const fs = A.findings.filter((x) => ids.includes(x.group));
    return fs.some((x) => x.level === "bad") ? "bad" : fs.some((x) => x.level === "warn") ? "warn" : "ok";
  };
  const counts = { bad: A.findings.filter((x) => x.level === "bad").length, warn: A.findings.filter((x) => x.level === "warn").length };

  // view heel: waterline at that heel from the GZ sweep (5 deg steps, interpolated)
  const waterH = useMemo(() => {
    if (!A.eq || A.eq.sinks) return A.eq?.sinks ? null : null;
    if (heelView === 0 || !A.gz.length) return A.eq.h;
    const i = Math.min(A.gz.length - 2, Math.floor(heelView / 5));
    const p = A.gz[i], q = A.gz[i + 1];
    return p.h + ((q.h - p.h) * (heelView - p.heel)) / (q.heel - p.heel);
  }, [A, heelView]);

  // ---------------- export ----------------
  const name = useImport ? imp!.name : `hull_${Math.round(H.L)}m_1-${Math.round(lam)}`;
  const exportMesh = useCallback(() => (useImport ? importMesh! : hullMesh(H, 160, 48)), [useImport, importMesh, H]);
  const printReady = useCallback(() => {
    const m = transform(printOrient(exportMesh(), env.printFlip), rotZ(A.fit.angle));
    return placeOnBed(m, printer.bed[0] / 2, printer.bed[1] / 2);
  }, [exportMesh, env.printFlip, A.fit.angle, printer]);

  const doStep = async () => {
    setStepState({ busy: true, msg: "Loading the CAD kernel (first time about 10 MB)...", level: "info" });
    try {
      const out = await occHullStep(loftSections(H));
      const mv = massProps(hullMesh(H, 160, 48)).volume;
      const dv = Math.abs(out.volume - mv) / mv;
      download(out.step, `${name}.step`, "application/step");
      setStepState({
        busy: false,
        level: dv <= LIMITS.print.stepVolumeTol ? "ok" : "warn",
        msg: `STEP solid written. Volume ${f(out.volume / 1000, 2)} cm3 vs mesh ${f(mv / 1000, 2)} cm3 (${f(dv * 100, 2)} % apart).`,
      });
    } catch (e) {
      setStepState({ busy: false, level: "bad", msg: `STEP failed: ${(e as Error).message}. STL and 3MF still work.` });
    }
  };
  const doGlb = async () => {
    const m = exportMesh();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeVertexNormals();
    const obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xdedbd6, roughness: 0.7 }));
    obj.name = name;
    obj.scale.setScalar(0.001); // glTF is in metres
    obj.rotation.x = -Math.PI / 2; // glTF is y-up
    const res = await new GLTFExporter().parseAsync(obj, { binary: true });
    download(res as ArrayBuffer, `${name}.glb`, "model/gltf-binary");
  };
  const doReport = () => {
    const L: string[] = [`Hull Workshop report: ${name}`, "Early pre-check, not an official approval.", ""];
    if (!useImport) {
      L.push("DESIGN (full scale)");
      for (const s of PARAMS) L.push(`  ${s.label}: ${H[s.key]} ${s.unit}`);
    } else L.push(`IMPORTED ${imp!.format}: ${imp!.name}, units ${impOpts.unit}, scale 1:${impOpts.lambda}`);
    L.push("", `MODEL: ${f(A.dims[0])} x ${f(A.dims[1])} x ${f(A.dims[2])} mm, scale 1:${Math.round(lam)}`);
    L.push(`PRINT: ${A.printMass.material.name}, wall ${print.wall} mm, infill ${Math.round(print.infill * 100)} %, ${f(A.printMass.total)} g, about EUR ${f(A.printMass.cost, 2)}`);
    L.push(`LOAD: ${load.mass} g at ${Math.round(load.xFrac * 100)} % length, ${load.height} mm above deck. Total ${f(A.totalMass)} g, KG ${f(A.G[2])} mm`);
    if (A.eq) L.push(`FLOAT: draft aft ${f(A.eq.Ta)} / fwd ${f(A.eq.Tf)} mm, trim ${f(A.eq.trim, 2)} deg, GM ${f(A.eq.GM, 2)} mm`);
    L.push("", "GZ (deg: mm model)");
    for (const p of A.gz) L.push(`  ${p.heel}: ${f(p.gz, 3)}${p.deckWet ? "  deck edge under" : ""}`);
    L.push("", "CHECKS");
    for (const x of A.findings) {
      L.push(`[${x.level.toUpperCase()}] ${x.title}`, `  ${x.message}`);
      if (x.detail) L.push(`  Why: ${x.detail}`);
      if (x.fix) L.push(`  Fix: ${x.fix}`);
    }
    download(L.join("\n"), `${name}_report.txt`, "text/plain");
  };

  useEffect(() => {
    if (tab === "export" && !useImport) occInit().catch(() => undefined); // warm the kernel while the user reads
  }, [tab, useImport]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImpBusy(`Reading ${file.name}...`);
    try {
      const r = await importFile(file);
      const b = bbox(r.raw);
      const ext = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      const unit: Unit = ext < 2 ? "m" : "mm"; // a model under 2 units across is almost certainly metres
      const yUp = r.format === "OBJ" || r.format === "GLB";
      setImp(r);
      setImpOpts((o) => ({ ...o, unit, yUp, turn: b.max[1] - b.min[1] > b.max[0] - b.min[0] && !yUp, flip: false }));
      setSource("import");
      setImpBusy(null);
    } catch (e) {
      setImpBusy(`Could not read ${file.name}: ${(e as Error).message}`);
    }
  };

  const setH = (k: keyof HullParams, v: number) => setHull((h) => ({ ...h, [k]: v }));
  const meshes = view === "print" ? A.printMesh : mesh;

  // ---------------- test numbers ----------------
  const mTa = num(meas.Ta), mTf = num(meas.Tf), w = num(meas.w), d = num(meas.d), phi = num(meas.phi);
  const gmMeas = w && d && phi ? (w * d) / (A.totalMass * Math.tan((phi * Math.PI) / 180)) : null;

  return (
    <div className="flex h-full flex-col bg-bg text-fg" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), onFile(e.dataTransfer.files[0]))}>
      {/* header */}
      <header className="flex h-11 shrink-0 items-center gap-5 border-b border-line bg-surface px-4">
        <div className="flex items-center gap-2">
          <Icon d={ICONS.hull} size={18} className="text-accent" />
          <span className="text-[13px] font-semibold tracking-tight">Hull Workshop</span>
          <span className="label ml-1">design, check, print, test</span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: counts.bad ? "var(--bad)" : counts.warn ? "var(--warn)" : "var(--ok)" }} />
            {counts.bad} fail, {counts.warn} warn
          </span>
          <span className="hidden md:inline">Early pre-check, not an official approval</span>
          <button className="text-muted hover:text-fg" title="Theme" onClick={() => setDark({ on: !dark.on })}>
            <Icon d={dark.on ? ICONS.sun : ICONS.moon} size={15} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* left */}
        <aside className="w-full shrink-0 overflow-y-auto border-line bg-surface md:w-[290px] md:border-r">
          <Tabs<Source>
            value={source}
            onChange={setSource}
            items={[
              { id: "design", label: "Design" },
              { id: "import", label: "Import" },
            ]}
          />
          {source === "design" ? (
            <>
              <Section title="Ship, full scale" right={<button className="text-[10px] text-muted hover:text-accent" onClick={() => setHull(DEFAULT_HULL)}>Reset</button>}>
                {PARAMS.filter((s) => s.group === "ship").map((s) => (
                  <Slider key={s.key} label={s.label} value={hull[s.key]} min={s.min} max={s.max} step={s.step} unit={s.unit} help={s.help} onChange={(v) => setH(s.key, v)} />
                ))}
              </Section>
              <Section title="Hull form">
                {PARAMS.filter((s) => s.group === "form").map((s) => (
                  <Slider key={s.key} label={s.label} value={hull[s.key]} min={s.min} max={s.max} step={s.step} unit={s.unit} help={s.help} onChange={(v) => setH(s.key, v)} />
                ))}
              </Section>
              <Section title="Model" right={<span className="font-mono text-[11px] text-muted">1:{Math.round(lam)}</span>}>
                {PARAMS.filter((s) => s.group === "model").map((s) => (
                  <Slider key={s.key} label={s.label} value={hull[s.key]} min={s.min} max={s.max} step={s.step} unit={s.unit} help={s.help} onChange={(v) => setH(s.key, v)} />
                ))}
                <div className="text-[11px] text-muted">
                  {f(A.dims[0])} x {f(A.dims[1])} x {f(A.dims[2])} mm, {f(A.volume / 1000)} cm3
                </div>
              </Section>
            </>
          ) : (
            <Section title="Import a model">
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[7px] border border-dashed border-line px-3 py-5 text-center text-[12px] text-muted hover:border-accent hover:text-fg">
                <Icon d={ICONS.upload} size={20} />
                <span>Drop or choose STEP, STL, OBJ or 3MF</span>
                <input type="file" accept=".step,.stp,.stl,.obj,.3mf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              {impBusy && <div className="text-[11px] text-muted">{impBusy}</div>}
              {imp && (
                <>
                  <Row k="File" v={`${imp.name}.${imp.format.toLowerCase()}`} />
                  <Select<Unit> label="File units" value={impOpts.unit} onChange={(v) => setImpOpts({ ...impOpts, unit: v })} options={[{ id: "mm", name: "millimetres" }, { id: "cm", name: "centimetres" }, { id: "m", name: "metres" }, { id: "in", name: "inches" }]} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                    {(
                      [
                        ["yUp", "Y is up"],
                        ["turn", "Turn 90 deg"],
                        ["flip", "Upside down"],
                      ] as const
                    ).map(([k, l]) => (
                      <label key={k} className="flex items-center gap-1.5 text-muted">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={impOpts[k]} onChange={(e) => setImpOpts({ ...impOpts, [k]: e.target.checked })} />
                        {l}
                      </label>
                    ))}
                  </div>
                  <NumField label="Scale 1 :" value={String(impOpts.lambda)} onChange={(v) => setImpOpts({ ...impOpts, lambda: Math.max(1, num(v) ?? 1) })} />
                  <div className="text-[11px] leading-snug text-muted">
                    Length runs along x, keel down. {f(A.dims[0])} x {f(A.dims[1])} x {f(A.dims[2])} mm{A.topo.watertight ? `, ${f(A.volume / 1000)} cm3` : ""}.
                    {imp.cadVolume ? ` CAD volume ${f(imp.cadVolume * UNIT[impOpts.unit] ** 3 / 1000)} cm3.` : ""}
                  </div>
                </>
              )}
              {!imp && <div className="text-[11px] leading-snug text-muted">Any closed model works: a hull from Onshape, Fusion, Rhino or FreeCAD, or a part to check for printing. Floating checks run on closed solids.</div>}
            </Section>
          )}

          <Section title="Print">
            <Select label="Printer" value={print.printer} onChange={(v) => setPrint({ ...print, printer: v })} options={PRINTERS} />
            <Select label="Material" value={print.material} onChange={(v) => setPrint({ ...print, material: v })} options={MATERIALS} />
            <Slider label="Shell thickness" value={print.wall} min={0.4} max={4} step={0.05} unit="mm" help="Walls plus top and bottom layers. Use the same in the slicer." onChange={(v) => setPrint({ ...print, wall: v })} />
            <Slider label="Infill" value={Math.round(print.infill * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setPrint({ ...print, infill: v / 100 })} />
            <Select<"deck" | "keel"> label="Orientation" value={env.printFlip ? "deck" : "keel"} onChange={(v) => setEnv({ ...env, printFlip: v === "deck" })} options={[{ id: "deck", name: "Deck on the bed" }, { id: "keel", name: "Keel down" }]} />
            <Row k="Printed mass" v={f(A.printMass.total)} u="g" />
            <Row k="Filament cost" v={f(A.printMass.cost, 2)} u="EUR" />
          </Section>

          <Section title="Test load on deck">
            <Slider label="Mass" value={load.mass} min={0} max={2000} step={1} unit="g" help="Coins or weights placed on the deck for the water test." onChange={(v) => setLoad({ ...load, mass: v })} />
            <Slider label="Position" value={Math.round(load.xFrac * 100)} min={0} max={100} step={1} unit="%" help="0 = transom, 100 = bow" onChange={(v) => setLoad({ ...load, xFrac: v / 100 })} />
            <Slider label="Height above deck" value={load.height} min={0} max={100} step={0.5} unit="mm" help="Centre of the stack of weights above the deck" onChange={(v) => setLoad({ ...load, height: v })} />
            <Select<"fresh" | "sea"> label="Water" value={env.water} onChange={(v) => setEnv({ ...env, water: v })} options={[{ id: "fresh", name: "Fresh (tank, 1.000)" }, { id: "sea", name: "Sea (1.025)" }]} />
          </Section>
        </aside>

        {/* viewport */}
        <main className="relative min-h-[320px] flex-1" style={{ background: "var(--viewport)" }}>
          <Viewport mode={view} mesh={mesh} printMesh={meshes === A.printMesh ? A.printMesh : A.printMesh} printer={printer} bedAngle={A.fit.angle} heel={view === "float" ? heelView : 0} trim={A.eq?.trim ?? 0} waterH={waterH} G={A.G} dark={dark.on} />
          <div className="pointer-events-none absolute top-3 left-4 flex gap-4">
            {(["float", "print"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`pointer-events-auto relative pb-1 text-[11px] tracking-[0.08em] uppercase ${view === v ? "text-fg" : "text-muted hover:text-fg"}`}>
                {v === "float" ? "In water" : "On the print bed"}
                {view === v && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[2px] bg-accent" />}
              </button>
            ))}
          </div>
          {view === "float" && A.eq && !A.eq.sinks && (
            <div className="absolute bottom-3 left-4 w-[240px] rounded-[7px] bg-surface/80 px-3 py-2 backdrop-blur-sm">
              <Slider label="Heel to view" value={heelView} min={0} max={90} step={1} unit="deg" onChange={setHeelView} />
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>GZ {f((A.gz.length ? A.gz[Math.min(A.gz.length - 1, Math.round(heelView / 5))].gz : 0), 2)} mm</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-[6px] w-[6px] rounded-full bg-accent" /> centre of gravity
                </span>
              </div>
            </div>
          )}
          {view === "print" && (
            <div className="absolute bottom-3 left-4 text-[11px] text-muted">
              {printer.name}
              {A.fit.angle > 0 ? `, turned ${f(A.fit.angle)} deg to fit` : ""}. {A.fit.fits ? "Fits." : "Does not fit."}
            </div>
          )}
          {A.eq?.sinks && <div className="absolute top-12 left-4 text-[12px] text-bad">Sinks with this load.</div>}
        </main>

        {/* right */}
        <aside className="flex w-full shrink-0 flex-col border-line bg-surface md:w-[360px] md:border-l">
          <Tabs<RightTab>
            value={tab}
            onChange={setTab}
            items={[
              { id: "checks", label: "Checks", badge: worst(["geometry", "print", "float", "stability"]) },
              { id: "stability", label: "Stability", badge: worst(["stability"]) },
              { id: "export", label: "Export" },
              { id: "test", label: "Water test" },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "checks" &&
              (["float", "stability", "print", "geometry"] as const).map((g) => {
                const list = A.findings.filter((x) => x.group === g);
                if (!list.length) return null;
                return (
                  <div key={g}>
                    <div className="label px-4 pt-3 pb-1">{{ float: "Floating", stability: "Stability", print: "3D print", geometry: "Geometry" }[g]}</div>
                    {list.map((x, i) => (
                      <FindingRow key={x.id} f={x} i={i} />
                    ))}
                  </div>
                );
              })}

            {tab === "stability" && (
              <>
                <Section title="Floating position (model)">
                  {A.eq ? (
                    <>
                      <Row k="Total mass" v={f(A.totalMass)} u="g" />
                      <Row k="Draft aft / forward" v={`${f(A.eq.Ta)} / ${f(A.eq.Tf)}`} u="mm" />
                      <Row k="Trim" v={f(A.eq.trim, 2)} u="deg" />
                      <Row k="KB / BM / KG" v={`${f(A.eq.KB)} / ${f(A.eq.BM)} / ${f(A.G[2])}`} u="mm" />
                      <Row k="GM" v={f(A.eq.GM, 2)} u="mm" level={A.eq.GM > 0 ? "ok" : "bad"} />
                      <Row k="Reserve buoyancy" v={f(A.eq.reserve * 100)} u="%" />
                    </>
                  ) : (
                    <div className="text-[12px] text-muted">Needs a closed solid.</div>
                  )}
                </Section>
                {A.is && (
                  <Section title={`Full scale 1:${Math.round(lam)}, ${LIMITS.isCode.source}`}>
                    <GzChart gz={A.gz} scale={lam / 1000} deckEdge={A.is.deckEdge} vanish={A.is.vanish} />
                    <Row k="Displacement (sea water)" v={f((A.totalMass * lam ** 3 * 1.025) / 1e6, 0)} u="t" />
                    <Row k="GM0" v={f(A.is.gm0, 2)} u="m" level={A.is.gm0 >= LIMITS.isCode.gm0 ? "ok" : "warn"} />
                    <Row k="Area 0-30" v={f(A.is.area30, 3)} u="m rad" level={A.is.area30 >= LIMITS.isCode.area30 ? "ok" : "warn"} />
                    <Row k="Area 0-40" v={f(A.is.area40, 3)} u="m rad" level={A.is.area40 >= LIMITS.isCode.area40 ? "ok" : "warn"} />
                    <Row k="Area 30-40" v={f(A.is.area3040, 3)} u="m rad" level={A.is.area3040 >= LIMITS.isCode.area3040 ? "ok" : "warn"} />
                    <Row k="GZ at 30 deg or more" v={f(A.is.gz30, 2)} u="m" level={A.is.gz30 >= LIMITS.isCode.gz30 ? "ok" : "warn"} />
                    <Row k="Angle of max GZ" v={f(A.is.maxGzAngle, 0)} u="deg" level={A.is.maxGzAngle >= LIMITS.isCode.maxGzAngle ? "ok" : "warn"} />
                    <Row k="Vanishing angle" v={f(A.is.vanish, 0)} u="deg" />
                    <Row k="Deck edge under water" v={A.is.deckEdge === null ? "never" : f(A.is.deckEdge, 0)} u={A.is.deckEdge === null ? "" : "deg"} />
                    <div className="text-[10.5px] leading-snug text-faint">Hydrostatics are exact on the mesh. GZ at fixed trim. Model in {env.water} water; full-scale values assume the same geometry and loading.</div>
                  </Section>
                )}
              </>
            )}

            {tab === "export" && (
              <>
                <Section title="Editable CAD">
                  <Btn primary onClick={doStep} disabled={!!useImport || stepState?.busy}>
                    <Icon d={ICONS.download} size={15} />
                    <span className="flex-1">STEP solid (.step)</span>
                    <span className="text-[10px] text-faint">Onshape, Fusion, SolidWorks, FreeCAD, Rhino</span>
                  </Btn>
                  {useImport && <div className="text-[11px] text-muted">Imported meshes stay meshes: use your original CAD file for editing.</div>}
                  {stepState && (
                    <div className="flex items-start gap-2 text-[11px] leading-snug text-muted">
                      <span className="mt-1 h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: stepState.level === "info" ? "var(--muted)" : `var(--${stepState.level})` }} />
                      {stepState.msg}
                    </div>
                  )}
                </Section>
                <Section title="3D printing (print-ready)">
                  <Btn primary disabled={!A.topo.watertight} onClick={() => download(to3MF(printReady(), name), `${name}.3mf`, "model/3mf")}>
                    <Icon d={ICONS.download} size={15} />
                    <span className="flex-1">3MF (.3mf)</span>
                    <span className="text-[10px] text-faint">Bambu, Prusa, Orca, Cura</span>
                  </Btn>
                  <Btn disabled={!A.topo.watertight} onClick={() => download(toSTL(printReady(), name), `${name}.stl`, "model/stl")}>
                    <Icon d={ICONS.download} size={15} />
                    <span className="flex-1">STL (.stl)</span>
                    <span className="text-[10px] text-faint">any slicer</span>
                  </Btn>
                  <div className="text-[11px] leading-snug text-muted">
                    Millimetres, {env.printFlip ? "deck on the bed" : "keel down"}, {A.fit.angle > 0 ? `turned ${f(A.fit.angle)} deg to fit, ` : ""}centred on the {printer.name.split(" (")[0]} bed. Watertight and outward-facing, checked before export. Slicer: {Math.max(LIMITS.print.minWallLines, Math.round(print.wall / print.lineWidth))} walls, 5 top/bottom layers, {Math.round(print.infill * 100)} % infill.
                  </div>
                </Section>
                <Section title="3D modelling and rendering">
                  <Btn onClick={() => download(toOBJ(exportMesh(), name), `${name}.obj`, "text/plain")}>
                    <Icon d={ICONS.download} size={15} />
                    <span className="flex-1">OBJ (.obj)</span>
                    <span className="text-[10px] text-faint">Blender, Rhino, mm, z up</span>
                  </Btn>
                  <Btn onClick={doGlb}>
                    <Icon d={ICONS.download} size={15} />
                    <span className="flex-1">glTF binary (.glb)</span>
                    <span className="text-[10px] text-faint">web, Blender, AR, metres</span>
                  </Btn>
                </Section>
                <Section title="Documentation">
                  <Btn onClick={doReport}>
                    <Icon d={ICONS.download} size={15} />
                    <span className="flex-1">Check report (.txt)</span>
                    <span className="text-[10px] text-faint">all values and flags</span>
                  </Btn>
                </Section>
              </>
            )}

            {tab === "test" && (
              <>
                <Section title="1. Weigh the print">
                  <NumField label="Weighed print" value={meas.weighed} onChange={(v) => setMeas({ ...meas, weighed: v })} unit="g" placeholder={f(A.printMass.total)} />
                  <div className="text-[11px] leading-snug text-muted">Enter the kitchen-scale mass of the printed hull. It replaces the estimate in every prediction.</div>
                </Section>
                <Section title="2. Float it and mark the drafts">
                  {A.eq && !A.eq.sinks ? (
                    <>
                      <Row k="Predicted draft aft" v={f(A.eq.Ta)} u="mm" />
                      <Row k="Predicted draft forward" v={f(A.eq.Tf)} u="mm" />
                      <NumField label="Measured aft" value={meas.Ta} onChange={(v) => setMeas({ ...meas, Ta: v })} unit="mm" />
                      <NumField label="Measured forward" value={meas.Tf} onChange={(v) => setMeas({ ...meas, Tf: v })} unit="mm" />
                      {mTa !== null && <Row k="Error aft" v={`${mTa - A.eq.Ta >= 0 ? "+" : ""}${f(mTa - A.eq.Ta)} mm (${f(((mTa - A.eq.Ta) / A.eq.Ta) * 100)} %)`} level={Math.abs(mTa - A.eq.Ta) <= 1 ? "ok" : "warn"} />}
                      {mTf !== null && <Row k="Error forward" v={`${mTf - A.eq.Tf >= 0 ? "+" : ""}${f(mTf - A.eq.Tf)} mm (${f(((mTf - A.eq.Tf) / A.eq.Tf) * 100)} %)`} level={Math.abs(mTf - A.eq.Tf) <= 1 ? "ok" : "warn"} />}
                      <div className="text-[11px] leading-snug text-muted">Measure from the keel to the waterline at the transom and at the bow. If it floats lower than predicted, water has leaked into the infill.</div>
                    </>
                  ) : (
                    <div className="text-[12px] text-muted">No floating prediction for this setup.</div>
                  )}
                </Section>
                <Section title="3. Inclining test (measure GM)">
                  <NumField label="Weight moved" value={meas.w} onChange={(v) => setMeas({ ...meas, w: v })} unit="g" />
                  <NumField label="Moved sideways by" value={meas.d} onChange={(v) => setMeas({ ...meas, d: v })} unit="mm" />
                  <NumField label="Measured heel" value={meas.phi} onChange={(v) => setMeas({ ...meas, phi: v })} unit="deg" />
                  {A.eq && <Row k="Predicted GM" v={f(A.eq.GM, 2)} u="mm" />}
                  {gmMeas !== null && A.eq && <Row k="Measured GM" v={`${f(gmMeas, 2)} mm (${f(((gmMeas - A.eq.GM) / A.eq.GM) * 100)} %)`} level={Math.abs(gmMeas - A.eq.GM) / Math.abs(A.eq.GM) <= 0.15 ? "ok" : "warn"} />}
                  <div className="text-[11px] leading-snug text-muted">GM = w d / (total mass x tan heel). The same test shipyards run on every new ship. Move one weight across the deck, read the heel with a phone level app.</div>
                </Section>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
