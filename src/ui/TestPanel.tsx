import { useEffect, useState } from "react";
import { useStore, live, type TestKind } from "./store";
import { Section, Btn, Slider, Check, KV, Select, f, Badge } from "./fields";
import { motions } from "../engine/vessel";
import { gzAt } from "../engine/stability";
import { STATUS_COLOR } from "./theme";
import { downloadReport } from "./report";

/** Round dial. zones are [from, to, color] in value units. */
export function Gauge({ label, value, min, max, unit, digits = 1, zones = [], size = 116 }: { label: string; value: number; min: number; max: number; unit: string; digits?: number; zones?: [number, number, string][]; size?: number }) {
  const a0 = -220,
    a1 = 40; // degrees, 260 deg sweep
  const ang = (v: number) => a0 + ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * (a1 - a0);
  const R = 42;
  const pt = (deg: number, r = R) => [50 + r * Math.cos((deg * Math.PI) / 180), 54 + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, to: number, r = R) => {
    const [x0, y0] = pt(from, r),
      [x1, y1] = pt(to, r);
    return `M${x0} ${y0} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const needle = ang(value);
  const [nx, ny] = pt(needle, R - 8);
  const zoneColor = zones.find(([lo, hi]) => value >= lo && value <= hi)?.[2];
  return (
    <div className="anim-pop flex flex-col items-center">
      <svg viewBox="0 0 100 100" style={{ width: size, height: size * 0.92 }}>
        <path d={arc(a0, a1)} stroke="var(--line)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        {zones.map(([lo, hi, c], i) => (
          <path key={i} d={arc(ang(lo), ang(hi))} stroke={c} strokeWidth="2.2" fill="none" />
        ))}
        {Array.from({ length: 21 }, (_, i) => {
          const d = a0 + (i * (a1 - a0)) / 20;
          const [x0, y0] = pt(d, R + (i % 5 === 0 ? 6 : 4)),
            [x1, y1] = pt(d, R + 2);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={i % 5 === 0 ? "var(--muted)" : "var(--faint)"} strokeWidth="0.6" />;
        })}
        <line x1="50" y1="54" x2={nx} y2={ny} stroke={zoneColor ?? "var(--fg)"} strokeWidth="1.4" strokeLinecap="round" style={{ transition: "all 0.1s linear" }} />
        <circle cx="50" cy="54" r="2.2" fill="var(--surface)" stroke={zoneColor ?? "var(--fg)"} strokeWidth="1.2" />
        <text x="50" y="80" textAnchor="middle" fontSize="12" fontWeight="500" fill="var(--fg)">
          {Number.isFinite(value) ? value.toFixed(digits) : "-"}
        </text>
        <text x="50" y="90" textAnchor="middle" fontSize="6.5" fill="var(--muted)">
          {unit}
        </text>
        <text x="14" y="96" fontSize="5.5" fill="var(--faint)">
          {+min.toFixed(1)}
        </text>
        <text x="86" y="96" fontSize="5.5" fill="var(--faint)" textAnchor="end">
          {+max.toFixed(1)}
        </text>
      </svg>
      <div className="label -mt-1 !text-[9.5px]">{label}</div>
    </div>
  );
}

function Spark({ data, color, label }: { data: number[]; color: string; label: string }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data),
    hi = Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 300},${50 - ((v - lo) / span) * 44 - 3}`).join(" ");
  return (
    <div>
      <div className="flex justify-between text-[10px] text-muted">
        <span>{label}</span>
        <span>
          {lo.toFixed(2)} to {hi.toFixed(2)}
        </span>
      </div>
      <svg viewBox="0 0 300 50" className="h-12 w-full">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.1" />
      </svg>
    </div>
  );
}

const KINDS: { id: TestKind; label: string; text: string }[] = [
  { id: "sea", label: "Waves", text: "Regular waves; heave, pitch and roll from vessel.js WaveMotion." },
  { id: "heel", label: "Heel", text: "Tilt the ship and read the righting lever from the GZ curve." },
  { id: "flood", label: "Flooding", text: "Flood a damage case and watch the ship sink and trim to its final waterline." },
  { id: "evac", label: "Evacuation", text: "People walk their escape routes to the assembly stations." },
];

const SEA_STATES = [
  { label: "Calm (0.5 m waves)", amp: 0.25, freq: 1.0 },
  { label: "Moderate (2 m waves)", amp: 1.0, freq: 0.75 },
  { label: "Rough (4 m waves)", amp: 2.0, freq: 0.6 },
  { label: "Very rough (6 m waves)", amp: 3.0, freq: 0.5 },
];

export function TestPanel() {
  const test = useStore((s) => s.test);
  const setTest = useStore((s) => s.setTest);
  const a = useStore((s) => s.analysis);
  const design = useStore((s) => s.design);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 100);
    return () => clearInterval(id);
  }, []);
  const c = a?.condition;
  const gz = a?.gz;
  const fl = a?.flood;
  const evac = a?.evac;
  const amp = (() => {
    if (test.kind !== "sea" || !a?.ship || !c) return null;
    try {
      return motions(a.ship, c, { speedKn: test.speedKn, waveFreq: test.waveFreq, waveAmp: test.waveAmp, relHeadingDeg: test.headingDeg, positionPct: 90 });
    } catch {
      return null;
    }
  })();
  const deckEdge = gz?.deckEdgeDeg ?? 30;
  const range = gz?.rangeDeg ?? 60;
  const hist = live.history;
  const cs = fl?.ok ? fl.cases[test.floodCase] : undefined;
  const bhdZ = fl?.bulkheadDeckZ ?? design.hull.depth;
  if (c && live.floodProgress === 0) {
    live.draftAft = c.draftAft;
    live.draftFwd = c.draftFwd;
  }

  return (
    <div>
      <div className="flex gap-5 border-b border-line px-4 pt-3">
        {KINDS.map((k, i) => {
          const on = test.kind === k.id;
          return (
            <button key={k.id} className={`anim-rise relative pb-2 text-[12.5px] transition-colors ${on ? "text-fg" : "text-muted hover:text-fg"}`} style={{ animationDelay: `${i * 40}ms` }} onClick={() => setTest({ kind: k.id, running: true, restart: Date.now() })}>
              {k.label}
              {on && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[1.5px] bg-accent" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[11.5px]">
        <button className="anim-pop flex h-7 w-7 items-center justify-center rounded-full border border-line text-fg transition-colors hover:border-accent hover:text-accent" onClick={() => setTest({ running: !test.running })} title={test.running ? "Pause" : "Run"}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d={test.running ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M7 4l13 8-13 8z"} />
          </svg>
        </button>
        <button className="anim-pop flex h-7 w-7 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-accent hover:text-accent" style={{ animationDelay: "60ms" }} onClick={() => setTest({ restart: Date.now(), running: true })} title="Restart">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" />
          </svg>
        </button>
        <span className="ml-2 text-faint">Speed</span>
        {[0.5, 1, 2, 4].map((s) => (
          <button key={s} className={`tabular-nums transition-colors ${test.timeScale === s ? "text-fg" : "text-faint hover:text-muted"}`} onClick={() => setTest({ timeScale: s })}>
            {s}x
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-faint">t {live.t.toFixed(1)} s</span>
      </div>
      <p className="anim-wipe px-4 pt-3 text-[11.5px] text-muted">{KINDS.find((k) => k.id === test.kind)?.text}</p>

      {test.kind === "sea" && (
        <>
          <Section title="Sea state">
            <Select
              label="Preset"
              value={String(SEA_STATES.findIndex((s) => s.amp === test.waveAmp && s.freq === test.waveFreq))}
              options={[{ value: "-1", label: "Custom" }, ...SEA_STATES.map((s, i) => ({ value: String(i), label: s.label }))]}
              onChange={(v) => v !== "-1" && setTest({ waveAmp: SEA_STATES[+v].amp, waveFreq: SEA_STATES[+v].freq })}
            />
            <Slider label="Wave amplitude" value={test.waveAmp} min={0} max={4} step={0.05} unit="m" digits={2} onChange={(v) => setTest({ waveAmp: v })} />
            <Slider label="Wave frequency" value={test.waveFreq} min={0.3} max={1.6} step={0.01} unit="rad/s" digits={2} onChange={(v) => setTest({ waveFreq: v })} />
            <Slider label="Wave heading (180 = head seas, 90 = beam)" value={test.headingDeg} min={0} max={180} step={5} unit="deg" digits={0} onChange={(v) => setTest({ headingDeg: v })} />
            <Slider label="Ship speed" value={test.speedKn} min={0} max={Math.max(25, design.hull.designSpeedKn * 1.3)} step={0.5} unit="kn" onChange={(v) => setTest({ speedKn: v })} />
          </Section>
          <div className="grid grid-cols-2 gap-y-4 border-b border-line px-4 py-4">
            <Gauge label="Roll" value={live.rollDeg} min={-30} max={30} unit="deg" zones={[[-30, -deckEdge, STATUS_COLOR.red], [deckEdge, 30, STATUS_COLOR.red]]} />
            <Gauge label="Pitch" value={live.pitchDeg} min={-10} max={10} unit="deg" digits={2} />
            <Gauge label="Heave" value={live.heave} min={-4} max={4} unit="m" digits={2} />
            <Gauge label="Vertical acc. at bow" value={live.vertAcc / 9.81} min={-1} max={1} unit="g" digits={2} />
          </div>
          <Section title="Live trace (last 24 s)">
            <Spark data={hist.map((h) => h.a)} color="#e0803c" label="Heave (m)" />
            <Spark data={hist.map((h) => h.b)} color="#e5484d" label="Roll (deg)" />
          </Section>
          {amp && (
            <Section title="Amplitudes (vessel.js)">
              <KV k="Heave amplitude" v={f(amp.heaveAmp, 2)} unit="m" />
              <KV k="Pitch amplitude" v={f(amp.pitchAmpDeg, 2)} unit="deg" />
              <KV k="Roll amplitude" v={f(amp.rollAmpDeg, 2)} unit="deg" />
              <KV k="Vertical acc. amplitude (90 % L)" v={f(amp.verticalAcc, 2)} unit="m/s2" />
              <KV k="Encounter period" v={f((2 * Math.PI) / Math.max(0.01, Math.abs(amp.encounterFreq)), 1)} unit="s" />
              <KV k="Natural roll period" v={f(amp.naturalRollPeriod, 1)} unit="s" />
              <KV k="Deck edge immerses at" v={f(deckEdge, 1)} unit="deg" />
              {amp.rollAmpDeg > deckEdge && <p className="mt-1 text-xs text-bad">Roll amplitude exceeds the deck-edge angle: water would come on deck in this sea state.</p>}
            </Section>
          )}
        </>
      )}

      {test.kind === "heel" && (
        <>
          <Section title="Heel">
            <Check label="Sweep automatically" value={test.heelSweep} onChange={(v) => setTest({ heelSweep: v })} />
            {!test.heelSweep && <Slider label="Heel angle" value={test.heelDeg} min={0} max={80} step={0.5} unit="deg" onChange={(v) => setTest({ heelDeg: v })} />}
          </Section>
          <div className="grid grid-cols-2 gap-y-4 border-b border-line px-4 py-4">
            <Gauge label="Heel" value={live.heelDeg} min={0} max={80} unit="deg" zones={[[0, deckEdge, STATUS_COLOR.green], [deckEdge, range, STATUS_COLOR.amber], [range, 80, STATUS_COLOR.red]]} />
            <Gauge label="Righting lever GZ" value={live.gz} min={-0.5} max={Math.max(1, (gz?.maxGZ ?? 1) * 1.2)} unit="m" digits={2} zones={[[-0.5, 0, STATUS_COLOR.red]]} />
          </div>
          <Section title="Readout">
            <KV k="Righting moment" v={c ? f((c.weights.total.massT * 9.81 * live.gz) / 1000, 1) : "-"} unit="MN.m" />
            <KV k="Deck edge immersion" v={f(deckEdge, 1)} unit="deg" />
            <KV k="Maximum GZ" v={gz ? `${f(gz.maxGZ, 2)} m at ${gz.angleMaxGZ} deg` : "-"} />
            <KV k="Stability lost beyond" v={f(range, 1)} unit="deg" />
            <div className="mt-1">
              {live.heelDeg > range ? <Badge status="red">capsizing</Badge> : live.heelDeg > deckEdge ? <Badge status="amber">deck edge under water</Badge> : <Badge status="green">upright range</Badge>}
            </div>
            {gz && <p className="mt-2 text-[11px] text-muted">GZ at 30 deg: {f(gzAt(gz, 30), 3)} m. The ship returns upright as long as GZ is positive.</p>}
          </Section>
        </>
      )}

      {test.kind === "flood" && (
        <>
          <Section title="Damage case">
            {!fl?.ok ? (
              <p className="text-xs text-muted">{fl?.reason ?? "Place watertight bulkheads first."}</p>
            ) : (
              <Select
                label="Flooded"
                value={String(test.floodCase)}
                options={fl.cases.map((k, i) => ({ value: String(i), label: `${k.compartments.join(" + ")}  (x ${k.xAft.toFixed(0)} to ${k.xFwd.toFixed(0)} m)${k.survives ? "" : "  lost"}` }))}
                onChange={(v) => setTest({ floodCase: +v, restart: Date.now(), running: true })}
              />
            )}
          </Section>
          {cs && c && (
            <>
              <div className="grid grid-cols-2 gap-y-4 border-b border-line px-4 py-4">
                <Gauge label="Flooding progress" value={live.floodProgress * 100} min={0} max={100} unit="%" digits={0} />
                <Gauge label="Freeboard to bulkhead deck" value={bhdZ - Math.max(live.draftAft, live.draftFwd)} min={-2} max={Math.max(4, bhdZ - c.T + 1)} unit="m" digits={2} zones={[[-2, 0, STATUS_COLOR.red]]} />
                <Gauge label="Draft aft" value={live.draftAft} min={0} max={bhdZ + 2} unit="m" digits={2} zones={[[bhdZ, bhdZ + 2, STATUS_COLOR.red]]} />
                <Gauge label="Draft forward" value={live.draftFwd} min={0} max={bhdZ + 2} unit="m" digits={2} zones={[[bhdZ, bhdZ + 2, STATUS_COLOR.red]]} />
              </div>
              <Section title="Result">
                <div className="mb-1">{cs.survives ? <Badge status="green">ship survives</Badge> : <Badge status="red">ship is lost</Badge>}</div>
                <p className="text-xs">{cs.reason}</p>
                <KV k="Final mean draft" v={f(cs.draft, 2)} unit="m" />
                <KV k="Damaged GM" v={f(cs.GMd, 2)} unit="m" />
                <KV k="Case weight p" v={f(cs.p, 3)} />
                <KV k="Index A / R (all cases)" v={`${f(fl!.A, 3)} / ${f(fl!.R, 3)}`} />
              </Section>
            </>
          )}
        </>
      )}

      {test.kind === "evac" && (
        <>
          {!evac?.ok ? (
            <p className="p-3 text-xs text-muted">{evac?.reason ?? "Not available."}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-y-4 border-b border-line px-4 py-4">
                <Gauge label="People at assembly stations" value={live.evacTotal ? (100 * live.evacArrived) / live.evacTotal : 0} min={0} max={100} unit="%" digits={0} />
                <Gauge label="Walk time (simulated)" value={live.evacTime / 60} min={0} max={10} unit="min" digits={1} />
              </div>
              <Section title="Circ.1533 result (the official number)">
                <KV k="Total evacuation duration" v={f(evac.total / 60, 1)} unit="min" />
                <KV k="Allowed" v={f(evac.limit / 60, 0)} unit="min" />
                <KV k="Travel duration T" v={f(evac.T / 60, 1)} unit="min" />
                <KV k="Congestion points" v={evac.congestion.length} />
                <p className="mt-1 text-[11px] text-muted">Dots: white walking, amber on stairs, green arrived. The walk-through ignores queues; the Circ.1533 total above includes them plus response and boarding time.</p>
              </Section>
            </>
          )}
        </>
      )}

      <Section title="Report">
        <Btn className="w-full !py-1.5" onClick={() => downloadReport()}>
          Download PDF report
        </Btn>
        <p className="mt-1 text-[11px] text-muted">All flags on deck plans, stability, damage and evacuation results, sources.</p>
      </Section>
    </div>
  );
}
