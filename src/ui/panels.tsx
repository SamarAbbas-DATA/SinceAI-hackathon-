import { useMemo, useState } from "react";
import { useStore } from "./store";
import { Section, Badge, KV, Num, Text, Select, Check, Btn, Dot, f } from "./fields";
import { Chart } from "./Chart";
import { STATUS_VAR } from "./theme";
import { RULES, ruleDef } from "../engine/rules";
import { motions, HULL_TEMPLATES, sortedDecks } from "../engine/vessel";
import { gzAt } from "../engine/stability";
import type { RuleResult, Finding } from "../engine/types";
import { focusOn } from "./three/Viewport";
import { spaceVertical } from "../engine/vessel";

export const DOC_FILES: Record<string, string> = {
  "USCG-SOLAS-01": "docs/USCG_SOLAS-01_Stairs_in_Escape_Paths.pdf",
  REG13: "docs/REG13_Means_of_Escape.pdf",
  "MSC-1-CIRC-1533": "docs/MSC.1-Circ.1533_Evacuation_Analysis.pdf",
  "MSC-429-98": "docs/MSC.429-98_Rev2_Flooding_MGN692_Annex.pdf",
};

// ------------------------------------------------------------------ Issues (rules)
export function IssuesPanel() {
  const a = useStore((s) => s.analysis);
  const [filter, setFilter] = useState<"all" | "problems">("problems");
  if (!a) return <div className="p-4 text-xs text-muted">Analysing...</div>;
  const counts = { red: 0, amber: 0, green: 0, grey: 0 };
  for (const r of a.rules) counts[r.status]++;
  const rules = filter === "problems" ? [...a.rules].sort((x, y) => rank(y.status) - rank(x.status)) : a.rules;
  return (
    <div>
      <div className="flex items-center gap-4 border-b border-line px-4 py-4">
        <ScoreRing score={a.score.score} />
        <div className="flex-1">
          <div className="label anim-wipe">Compliance</div>
          <div className="anim-wipe mt-1 flex gap-3 text-[12px] text-muted tabular-nums" style={{ animationDelay: "60ms" }}>
            {(["red", "amber", "green", "grey"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <Dot status={s} />
                {counts[s]}
              </span>
            ))}
          </div>
          <div className="anim-wipe mt-1.5 text-[10.5px] text-faint" style={{ animationDelay: "120ms" }}>
            Early pre-check. Not an official approval.
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-[11px]">
          {(["problems", "all"] as const).map((k) => (
            <button key={k} className={`transition-colors ${filter === k ? "text-fg" : "text-faint hover:text-muted"}`} onClick={() => setFilter(k)}>
              {k === "problems" ? "Worst first" : "Rule order"}
            </button>
          ))}
        </div>
      </div>
      {a.geometry.length > 0 && (
        <section className="border-b border-line px-4 py-3">
          <h3 className="label anim-wipe mb-2">Model checks {a.geometry.length}</h3>
          <div className="space-y-2">
            {a.geometry.map((g, i) => (
              <FindingRow key={i} f={g} i={i} />
            ))}
          </div>
        </section>
      )}
      {rules.map((r, i) => (
        <RuleCard key={r.ruleId} r={r} i={i} />
      ))}
      {a.errors.length > 0 && (
        <Section title="Calculation errors">
          {a.errors.map((e, i) => (
            <p key={i} className="text-xs text-bad">
              {e}
            </p>
          ))}
        </Section>
      )}
    </div>
  );
}

const rank = (s: string) => ["grey", "green", "amber", "red"].indexOf(s);

export function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const status = score >= 80 ? "green" : score >= 50 ? "amber" : "red";
  return (
    <div className="anim-pop relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="18" cy="18" r="16" fill="none" stroke="var(--line)" strokeWidth="1.4" />
        <circle cx="18" cy="18" r="16" fill="none" stroke={STATUS_VAR[status]} strokeWidth="1.8" strokeLinecap="round" pathLength={100} strokeDasharray={`${score} 100`} style={{ transition: "stroke-dasharray 0.8s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold tabular-nums">{score}</div>
    </div>
  );
}

function RuleCard({ r, i }: { r: RuleResult; i: number }) {
  const [open, setOpen] = useState(r.status === "red");
  const def = ruleDef(r.ruleId);
  const doc = Object.entries(DOC_FILES).find(([k]) => r.source.includes(k));
  return (
    <section className="anim-rise border-b border-line" style={{ animationDelay: `${80 + i * 45}ms` }}>
      <button className="group flex w-full items-start gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        <Dot status={r.status} size={7} style={{ marginTop: 5 }} />
        <span className="flex-1">
          <span className="block text-[13px] font-medium text-fg">{r.title}</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{r.summary}</span>
        </span>
        {r.findings.length > 0 && <span className="mt-0.5 text-[11px] text-faint tabular-nums">{r.findings.length}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" className={`mt-1 text-faint transition-transform group-hover:text-muted ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="space-y-2 pr-4 pb-4 pl-[34px]">
          {r.findings.map((x, k) => (
            <FindingRow key={k} f={x} i={k} />
          ))}
          <div className="anim-wipe space-y-1 pt-1 text-[11.5px] leading-relaxed" style={{ animationDelay: `${r.findings.length * 40 + 40}ms` }}>
            <p className="text-fg/85">{r.plainMeaning}</p>
            <p className="text-faint">Checked: {def.early_warning}</p>
            <p className="text-faint">
              {r.sourceName}, {r.clause}.
              {doc && (
                <a className="ml-1 text-accent hover:underline" href={`/${doc[1]}`} target="_blank" rel="noreferrer">
                  Open PDF
                </a>
              )}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function FindingRow({ f: x, i = 0 }: { f: Finding; i?: number }) {
  const [open, setOpen] = useState(false);
  const focus = () => {
    const st = useStore.getState();
    const d = st.design;
    const t = x.targets.find((id) => d.spaces.some((s) => s.id === id) || d.doors.some((q) => q.id === id) || d.bulkheads.some((b) => b.id === id) || d.lsa.some((l) => l.id === id));
    if (!t) {
      const deck = d.decks.find((k) => x.targets.includes(k.id));
      if (deck) st.set({ activeDeckId: deck.id });
      const cIdx = st.analysis?.flood?.cases.findIndex((c) => c.compartments.join() === x.targets.join());
      if (cIdx !== undefined && cIdx >= 0) st.set({ focusCase: cIdx, panel: "damage" });
      return;
    }
    const sp = d.spaces.find((s) => s.id === t);
    const door = d.doors.find((q) => q.id === t);
    const lsa = d.lsa.find((l) => l.id === t);
    const deckId = sp?.deckId ?? door?.deckId ?? lsa?.deckId;
    if (deckId) st.set({ activeDeckId: deckId });
    const kind = sp ? "space" : door ? "door" : lsa ? "lsa" : "bulkhead";
    useStore.setState({ selection: { kind, id: t } });
    if (sp) {
      const v = spaceVertical(d, sp);
      focusOn(sp.xCentre, sp.yCentre, v.zBase + v.height / 2);
    }
  };
  return (
    <div className="anim-wipe relative pl-3" style={{ animationDelay: `${i * 40}ms` }}>
      <span className="absolute top-[3px] bottom-[3px] left-0 w-[2px] rounded" style={{ background: STATUS_VAR[x.status] }} />
      <button className="w-full text-left text-[12px] leading-snug text-fg transition-colors hover:text-accent" onClick={focus} title="Show in 3D">
        {x.message}
      </button>
      {open && x.detail && <p className="anim-rise mt-1 text-[11.5px] leading-relaxed text-muted">{x.detail}</p>}
      {x.fix && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
          <span className="label mr-1.5 !text-[9.5px] !text-accent">Fix</span>
          {x.fix}
        </p>
      )}
      {x.detail && (
        <button className="mt-0.5 text-[10.5px] text-faint transition-colors hover:text-muted" onClick={() => setOpen(!open)}>
          {open ? "Less" : "Why it matters"}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Hydrostatics & weights
export function HydroPanel() {
  const a = useStore((s) => s.analysis);
  const c = a?.condition;
  if (!a || !c) return <div className="p-4 text-xs text-muted">No loading condition yet.</div>;
  const h = c.hydro;
  return (
    <div>
      <Section title="Floating condition (vessel.js)">
        {c.overloaded && <p className="mb-1 text-xs font-semibold text-bad">The ship is heavier than its hull can carry.</p>}
        <div className="grid grid-cols-2 gap-x-4">
          <KV k="Displacement" v={f(c.weights.total.massT, 0)} unit="t" />
          <KV k="Mean draft T" v={f(c.T, 3)} unit="m" />
          <KV k="Draft aft" v={f(c.draftAft, 3)} unit="m" />
          <KV k="Draft forward" v={f(c.draftFwd, 3)} unit="m" />
          <KV k="Trim (by stern +)" v={f(c.trimByStern, 3)} unit="m" />
          <KV k="Freeboard" v={f(c.freeboard, 2)} unit="m" />
          <KV k="KG solid" v={f(c.KGsolid, 3)} unit="m" />
          <KV k="Free-surface corr." v={f(c.FSC, 3)} unit="m" />
          <KV k="KG fluid" v={f(c.KG, 3)} unit="m" />
          <KV k="LCG" v={f(c.LCG, 2)} unit="m" />
          <KV k="KB" v={f(h.KB, 3)} unit="m" />
          <KV k="BMt" v={f(h.BMt, 3)} unit="m" />
          <KV k="KMt" v={f(h.KMt, 3)} unit="m" />
          <KV k="GMt (fluid)" v={f(c.GMt, 3)} unit="m" />
          <KV k="GMl" v={f(c.GMl, 1)} unit="m" />
          <KV k="Heel from TCG" v={f(c.heelDeg, 2)} unit="deg" />
          <KV k="LCB" v={f(h.LCB, 2)} unit="m" />
          <KV k="LCF" v={f(h.LCF, 2)} unit="m" />
          <KV k="Cb" v={f(h.Cb, 3)} />
          <KV k="Cp" v={f(h.Cp, 3)} />
          <KV k="Cwp" v={f(h.Cwp, 3)} />
          <KV k="Cm" v={f(h.Cm, 3)} />
          <KV k="LWL" v={f(h.LWL, 2)} unit="m" />
          <KV k="BWL" v={f(h.BWL, 2)} unit="m" />
          <KV k="TPC" v={f(h.TPC, 2)} unit="t/cm" />
          <KV k="MCT 1 cm" v={f(h.MCT, 1)} unit="t.m" />
          <KV k="Wetted area" v={f(h.wettedArea, 0)} unit="m2" />
          <KV k="Waterplane area" v={f(h.Awp, 0)} unit="m2" />
        </div>
      </Section>
      <Section title="Weight breakdown">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Item</th>
              <th className="text-right font-normal">t</th>
              <th className="text-right font-normal">LCG</th>
              <th className="text-right font-normal">VCG</th>
            </tr>
          </thead>
          <tbody>
            {c.weights.items.map((w) => (
              <tr key={w.label}>
                <td className="pr-1">{w.label}</td>
                <td className="text-right">{f(w.massT, 1)}</td>
                <td className="text-right">{f(w.lcg, 2)}</td>
                <td className="text-right">{f(w.vcg, 2)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold">
              <td>Total</td>
              <td className="text-right">{f(c.weights.total.massT, 1)}</td>
              <td className="text-right">{f(c.LCG, 2)}</td>
              <td className="text-right">{f(c.KGsolid, 2)}</td>
            </tr>
          </tbody>
        </table>
        {c.weights.lightship.estimated && <p className="mt-1 text-[11px] text-warn">Lightship is a vessel.js parametric estimate. Enter your own lightship in the Design tab once known.</p>}
      </Section>
      {a.hydroTable.length > 0 && (
        <>
          <Section title="Hydrostatic curves">
            <Chart
              xLabel="Draft T (m)"
              yLabel="m"
              series={[
                { name: "KB", color: "#a8a49e", points: a.hydroTable.map((r) => [r.T, r.KB]) },
                { name: "KMt", color: "#e0803c", points: a.hydroTable.map((r) => [r.T, Math.min(r.KMt, 60)]) },
                { name: "LCB / 10", color: "#c9a27a", points: a.hydroTable.map((r) => [r.T, r.LCB / 10]) },
              ]}
              vLines={[{ x: c.T, label: "T" }]}
              hLines={[{ y: c.KG, label: "KG", color: "#e5484d" }]}
            />
            <Chart xLabel="Draft T (m)" yLabel="Displacement (t)" series={[{ name: "Displacement", color: "#a8a49e", points: a.hydroTable.map((r) => [r.T, r.dispT]) }]} vLines={[{ x: c.T, label: "T" }]} height={160} />
          </Section>
          <Section title="Hydrostatic table">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="text-muted">
                  <tr>
                    {["T", "Disp t", "KB", "KMt", "LCB", "LCF", "TPC", "MCT", "Cb", "Cwp"].map((x) => (
                      <th key={x} className="px-1 text-right font-normal">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.hydroTable.map((r) => (
                    <tr key={r.T}>
                      {[f(r.T, 2), f(r.dispT, 0), f(r.KB, 2), f(r.KMt, 2), f(r.LCB, 2), f(r.LCF, 2), f(r.TPC, 2), f(r.MCT, 1), f(r.Cb, 3), f(r.Cwp, 3)].map((v, i) => (
                        <td key={i} className="px-1 text-right">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Stability
export function StabilityPanel() {
  const a = useStore((s) => s.analysis);
  const gz = a?.gz;
  const c = a?.condition;
  if (!gz || !c) return <div className="p-4 text-xs text-muted">GZ curve not available (check the loading condition).</div>;
  const v = ruleDef("INTACT-STABILITY").values;
  const rows: [string, number, number, string][] = [
    ["Area 0 to 30 deg", gz.area0_30, v.min_area_0_30_m_rad, "m.rad"],
    ["Area 0 to 40 deg", gz.area0_40, v.min_area_0_40_m_rad, "m.rad"],
    ["Area 30 to 40 deg", gz.area30_40, v.min_area_30_40_m_rad, "m.rad"],
    ["GZ at 30 deg", gzAt(gz, 30), v.min_gz_at_30_deg_or_more_m, "m"],
    ["Angle of max GZ", gz.angleMaxGZ, v.min_angle_of_max_gz_deg, "deg"],
    ["Initial GM", c.GMt, v.min_initial_gm_m, "m"],
  ];
  return (
    <div>
      <Section title="Righting lever curve GZ">
        <Chart
          xLabel="Heel angle (deg)"
          yLabel="GZ (m)"
          series={[
            { name: "GZ", color: "#e0803c", points: gz.points.map((p) => [p.deg, p.gz]) },
            { name: "GM sin(heel)", color: "#6e6b66", dashed: true, points: gz.points.filter((p) => p.deg <= 40).map((p) => [p.deg, c.GMt * Math.sin((p.deg * Math.PI) / 180)]) },
          ]}
          vLines={[
            { x: gz.deckEdgeDeg, label: "deck edge", color: "#c9a27a" },
            { x: 30, label: "30", color: "#55524e" },
            { x: 40, label: "40", color: "#55524e" },
          ]}
          height={220}
        />
        <p className="mt-1 text-[11px] text-muted">Computed by integrating heeled hull sections from the vessel.js offsets at constant displacement. Fixed trim, hull watertight to the moulded depth, slack-tank free-surface correction included.</p>
      </Section>
      <Section title="IS Code 2008 general criteria">
        <table className="w-full text-xs tabular-nums">
          <tbody>
            {rows.map(([n, val, lim, unit]) => (
              <tr key={n}>
                <td>{n}</td>
                <td className="text-right">
                  {f(val, 3)} {unit}
                </td>
                <td className="text-right text-muted">min {lim}</td>
                <td className="pl-2 text-right">
                  <Badge status={val >= lim ? "green" : "red"}>{val >= lim ? "ok" : "fail"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <KV k="Maximum GZ" v={f(gz.maxGZ, 3)} unit="m" />
        <KV k="Range of positive stability" v={f(gz.rangeDeg, 1)} unit="deg" />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Damage
export function DamagePanel() {
  const a = useStore((s) => s.analysis);
  const focus = useStore((s) => s.focusCase);
  const set = useStore((s) => s.set);
  const setTest = useStore((s) => s.setTest);
  const fl = a?.flood;
  if (!fl) return <div className="p-4 text-xs text-muted">Not available.</div>;
  if (!fl.ok) return <div className="p-4 text-xs text-muted">{fl.reason}</div>;
  return (
    <div>
      <Section title="Subdivision index (simplified estimate)">
        <div className="mb-2 flex items-center gap-3">
          <Badge status={fl.A >= fl.R ? "green" : "red"}>{fl.A >= fl.R ? "A >= R" : "A < R"}</Badge>
          <span className="text-sm font-semibold tabular-nums">
            A = {f(fl.A, 3)} / R = {f(fl.R, 3)}
          </span>
        </div>
        <KV k="Persons on board N" v={fl.N} />
        <KV k="Single-compartment part" v={f(fl.Asingle, 3)} />
        <KV k="Two-compartment part" v={f(fl.Apair, 3)} />
        <KV k="Bulkhead deck height" v={f(fl.bulkheadDeckZ, 2)} unit="m" />
        <p className="mt-1 text-[11px] text-muted">Lost-buoyancy method with vessel.js waterplane integration. Full-breadth compartments, permeability by use. Not the SOLAS II-1 probabilistic calculation.</p>
      </Section>
      <Section title="Compartments">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Id</th>
              <th className="text-right font-normal">x aft</th>
              <th className="text-right font-normal">x fwd</th>
              <th className="text-right font-normal">length</th>
              <th className="text-right font-normal">perm.</th>
            </tr>
          </thead>
          <tbody>
            {fl.compartments.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td className="text-right">{f(c.xAft, 1)}</td>
                <td className="text-right">{f(c.xFwd, 1)}</td>
                <td className="text-right">{f(c.length, 1)}</td>
                <td className="text-right">{f(c.permeability, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Damage cases (click to show, or test it)" right={focus !== null && <Btn onClick={() => set({ focusCase: null })}>Clear</Btn>}>
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              <th className="text-left font-normal">Case</th>
              <th className="text-right font-normal">p</th>
              <th className="text-right font-normal">T</th>
              <th className="text-right font-normal">aft/fwd</th>
              <th className="text-right font-normal">GM</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fl.cases.map((k, i) => (
              <tr key={i} className={`cursor-pointer hover:bg-surface-2 ${focus === i ? "bg-accent-soft" : ""}`} onClick={() => set({ focusCase: i })} title={k.reason}>
                <td>{k.compartments.join("+")}</td>
                <td className="text-right">{f(k.p, 3)}</td>
                <td className="text-right">{f(k.draft, 2)}</td>
                <td className="text-right">
                  {f(k.draftAft, 2)}/{f(k.draftFwd, 2)}
                </td>
                <td className="text-right">{f(k.GMd, 2)}</td>
                <td className="pl-1 text-right">
                  <Badge status={k.survives ? "green" : "red"}>{k.survives ? "ok" : "lost"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {focus !== null && fl.cases[focus] && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs">{fl.cases[focus].reason}</p>
            <Btn
              kind="primary"
              onClick={() => {
                setTest({ kind: "flood", floodCase: focus, running: true, restart: Date.now() });
                set({ mode: "test" });
              }}
            >
              Flood test
            </Btn>
          </div>
        )}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Evacuation
export function EvacPanel() {
  const a = useStore((s) => s.analysis);
  const design = useStore((s) => s.design);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const e = a?.evac;
  const name = (id: string | null) => (id ? (design.spaces.find((s) => s.id === id)?.name ?? id) : "-");
  const deckName = (id: string) => design.decks.find((d) => d.id === id)?.name ?? id;
  const m = (s: number) => (s / 60).toFixed(1);
  return (
    <div>
      <Section title="Evacuation analysis (MSC.1/Circ.1533 Annex 2)" right={<Check label="Show routes" value={view.showRoutes} onChange={(v) => setView({ showRoutes: v })} />}>
        {!e?.ok ? (
          <p className="text-xs text-muted">{e?.reason ?? "Not available"}</p>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Badge status={e.total <= e.limit ? (e.total > 0.9 * e.limit ? "amber" : "green") : "red"}>{e.total <= e.limit ? "within limit" : "too slow"}</Badge>
              <span className="text-sm font-semibold tabular-nums">
                {m(e.total)} min / {m(e.limit)} min
              </span>
            </div>
            <p className="mb-1 font-mono text-[11px]">
              1.25 (R + T) + 2/3 (E + L) = 1.25 ({m(e.R)} + {m(e.T)}) + 2/3 ({m(e.EL)})
            </p>
            <KV k="Persons" v={e.persons} />
            <KV k="Highest ideal travel duration tI" v={m(e.tI)} unit="min" />
            <KV k="T = (gamma + delta) tI" v={`(${e.gamma} + ${e.delta}) tI = ${m(e.T)}`} unit="min" />
            <KV k="Main vertical zones" v={e.mvz} />
            {e.unreachable.length > 0 && <p className="mt-1 text-xs text-bad">No route to an assembly station: {e.unreachable.map(name).join(", ")}</p>}
          </>
        )}
      </Section>
      {e?.ok && (
        <>
          <Section title="Stairways">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Stair</th>
                  <th className="text-right font-normal">persons</th>
                  <th className="text-right font-normal">in p/s</th>
                  <th className="text-right font-normal">out p/s</th>
                  <th className="text-right font-normal">dir</th>
                </tr>
              </thead>
              <tbody>
                {e.stairs.map((s) => (
                  <tr key={s.stairId}>
                    <td>{name(s.stairId)}</td>
                    <td className="text-right">{s.persons}</td>
                    <td className="text-right">{f(s.FcIn, 2)}</td>
                    <td className={`text-right ${s.queue ? "font-semibold text-warn" : ""}`}>{f(s.FcOut, 2)}</td>
                    <td className="text-right">{s.up ? "up" : "down"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">Amber outflow means a queue forms: more people arrive than the stair can pass (Circ.1533 table 1.2).</p>
          </Section>
          <Section title="Escape routes per deck">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Deck / stair</th>
                  <th className="text-right font-normal">p</th>
                  <th className="text-right font-normal">D</th>
                  <th className="text-right font-normal">tF</th>
                  <th className="text-right font-normal">tdeck</th>
                  <th className="text-right font-normal">tstair</th>
                  <th className="text-right font-normal">tI</th>
                </tr>
              </thead>
              <tbody>
                {[...e.routes]
                  .sort((x, y) => y.tI - x.tI)
                  .map((r, i) => (
                    <tr key={i}>
                      <td>
                        {deckName(r.deckId)} / {name(r.stairId)}
                      </td>
                      <td className="text-right">{r.persons}</td>
                      <td className="text-right">{f(r.density, 2)}</td>
                      <td className="text-right">{f(r.tF, 0)}</td>
                      <td className="text-right">{f(r.tDeck, 0)}</td>
                      <td className="text-right">{f(r.tStair, 0)}</td>
                      <td className="text-right font-semibold">{f(r.tI, 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">Times in seconds. D = starting density in the corridors (persons/m2).</p>
          </Section>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Performance (resistance + motions)
export function PerformancePanel() {
  const a = useStore((s) => s.analysis);
  const design = useStore((s) => s.design);
  const [m, setM] = useState({ speedKn: design.hull.designSpeedKn, waveFreq: 0.6, waveAmp: 1.5, relHeadingDeg: 180, positionPct: 80 });
  const res = a?.resistance ?? [];
  const ship = a?.ship;
  const c = a?.condition;
  const result = useMemo(() => {
    if (!ship || !c || c.overloaded) return null;
    try {
      return motions(ship, c, m);
    } catch {
      return null;
    }
  }, [ship, c, m]);
  const rao = useMemo(() => {
    if (!ship || !c || c.overloaded) return [];
    const out: { w: number; heave: number; pitch: number; roll: number }[] = [];
    for (let w = 0.2; w <= 2.0001; w += 0.05) {
      try {
        const r = motions(ship, c, { ...m, waveFreq: w, waveAmp: 1 });
        out.push({ w, heave: r.heaveAmp, pitch: r.pitchAmpDeg, roll: r.rollAmpDeg });
      } catch {
        /* skip */
      }
    }
    return out;
  }, [ship, c, m]);
  return (
    <div>
      <Section title="Calm water resistance (Holtrop-Mennen, vessel.js)">
        {res.length ? (
          <>
            <Chart
              xLabel="Speed (kn)"
              yLabel="kN / kW / 10"
              series={[
                { name: "Total resistance kN", color: "#e0803c", points: res.map((p) => [p.speedKn, p.resistanceKN]) },
                { name: "Effective power kW / 10", color: "#e0803c", points: res.map((p) => [p.speedKn, p.effectivePowerKW / 10]) },
              ]}
              vLines={[{ x: design.hull.designSpeedKn, label: "design" }]}
            />
            {a!.holtropWarnings.length > 0 && <p className="mt-1 text-[11px] text-warn">Outside the Holtrop validity range: {a!.holtropWarnings.join("; ")}</p>}
          </>
        ) : (
          <p className="text-xs text-muted">Not available.</p>
        )}
      </Section>
      <Section title="Motions in regular waves (vessel.js WaveMotion)">
        <Num label="Ship speed" value={m.speedKn} unit="kn" step={1} min={0} onChange={(v) => setM({ ...m, speedKn: v })} />
        <Num label="Wave frequency" value={m.waveFreq} unit="rad/s" step={0.05} min={0.1} max={3} onChange={(v) => setM({ ...m, waveFreq: v })} />
        <Num label="Wave amplitude" value={m.waveAmp} unit="m" step={0.25} min={0} onChange={(v) => setM({ ...m, waveAmp: v })} />
        <Num label="Wave heading (180 = head)" value={m.relHeadingDeg} unit="deg" step={15} min={0} max={360} digits={0} onChange={(v) => setM({ ...m, relHeadingDeg: v })} />
        <Num label="Position along hull" value={m.positionPct} unit="% L" step={5} min={0} max={100} digits={0} onChange={(v) => setM({ ...m, positionPct: v })} />
        {result && (
          <div className="mt-2 grid grid-cols-2 gap-x-4">
            <KV k="Heave amplitude" v={f(result.heaveAmp, 2)} unit="m" />
            <KV k="Pitch amplitude" v={f(result.pitchAmpDeg, 2)} unit="deg" />
            <KV k="Roll amplitude" v={f(result.rollAmpDeg, 2)} unit="deg" />
            <KV k="Vertical motion" v={f(result.verticalMotion, 2)} unit="m" />
            <KV k="Vertical acc." v={f(result.verticalAcc, 2)} unit="m/s2" />
            <KV k="Encounter freq." v={f(result.encounterFreq, 3)} unit="rad/s" />
            <KV k="Natural roll period" v={f(result.naturalRollPeriod, 1)} unit="s" />
          </div>
        )}
        {rao.length > 0 && (
          <Chart
            xLabel="Wave frequency (rad/s)"
            yLabel="per m wave amplitude"
            series={[
              { name: "Heave m/m", color: "#e0803c", points: rao.map((r) => [r.w, r.heave]) },
              { name: "Pitch deg/m", color: "#e0803c", points: rao.map((r) => [r.w, r.pitch]) },
              { name: "Roll deg/m", color: "#e5484d", points: rao.map((r) => [r.w, r.roll]) },
            ]}
          />
        )}
        <p className="mt-1 text-[11px] text-muted">Closed-form formulas (Jensen, Mansour and Olsen) as implemented in vessel.js. For early comparison of alternatives only.</p>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Design settings
export function DesignPanel() {
  const design = useStore((s) => s.design);
  const edit = useStore((s) => s.edit);
  const refMesh = useStore((s) => s.refMesh);
  const setRefMesh = useStore((s) => s.setRefMesh);
  const decks = sortedDecks(design);
  const totalPersons = design.spaces.reduce((n, s) => n + s.persons, 0);
  const ov = design.loading.lightshipOverride;
  return (
    <div>
      <Section title="Project">
        <Text label="Design name" value={design.name} onChange={(v) => edit((d) => void (d.name = v))} />
      </Section>
      <Section title="Hull (vessel.js offsets, scaled)">
        <Select
          label="Hull form"
          value={design.hull.custom ? "custom" : design.hull.template}
          options={[...Object.entries(HULL_TEMPLATES).map(([k, t]) => ({ value: k, label: t.label })), ...(design.hull.custom ? [{ value: "custom", label: design.hull.custom.label }] : [])]}
          onChange={(v) =>
            edit((d) => {
              if (v === "custom") return;
              d.hull.template = v;
              delete d.hull.custom;
            })
          }
        />
        <Num label="Length overall LOA" value={design.hull.LOA} unit="m" step={1} min={5} onChange={(v) => edit((d) => void (d.hull.LOA = v))} />
        <Num label="Breadth BOA" value={design.hull.BOA} unit="m" step={0.5} min={2} onChange={(v) => edit((d) => void (d.hull.BOA = v))} />
        <Num label="Moulded depth D" value={design.hull.depth} unit="m" step={0.5} min={1} onChange={(v) => edit((d) => void (d.hull.depth = v))} />
        <Num label="Design draft" value={design.hull.designDraft} unit="m" step={0.1} min={0.1} onChange={(v) => edit((d) => void (d.hull.designDraft = v))} />
        <Num label="Design speed" value={design.hull.designSpeedKn} unit="kn" step={0.5} min={1} onChange={(v) => edit((d) => void (d.hull.designSpeedKn = v))} />
        <Num label="Steel weight coefficient K" value={design.hull.parsonsK} step={0.001} digits={4} min={0.01} onChange={(v) => edit((d) => void (d.hull.parsonsK = v))} />
        <p className="mt-1 text-[11px] text-muted">Import your own hull from File &gt; Import hull offsets (CSV).</p>
      </Section>
      <Section
        title="Decks"
        right={
          <Btn
            onClick={() =>
              edit((d) => {
                const top = sortedDecks(d).at(-1);
                const id = `D${Date.now().toString(36)}`;
                d.decks.push({ id, name: `Deck ${d.decks.length + 1}`, z: (top?.z ?? 0) + 3 });
              })
            }
          >
            Add deck
          </Btn>
        }
      >
        {decks.map((k) => (
          <div key={k.id} className="flex items-center gap-1 py-0.5 text-xs">
            <input type="radio" title="Bulkhead deck" className="accent-[var(--accent)]" checked={design.bulkheadDeckId === k.id} onChange={() => edit((d) => void (d.bulkheadDeckId = k.id))} />
            <input
              className="w-24 rounded-md border border-line bg-surface-2 px-1"
              defaultValue={k.name}
              onBlur={(e) => e.target.value !== k.name && edit((d) => void (d.decks.find((x) => x.id === k.id)!.name = e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="text-muted">z</span>
            <input
              className="w-16 rounded-md border border-line bg-surface-2 px-1 text-right"
              defaultValue={k.z}
              onBlur={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v !== k.z) edit((d) => void (d.decks.find((x) => x.id === k.id)!.z = v));
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="text-muted">m</span>
            <button
              className="ml-auto text-bad disabled:opacity-30"
              disabled={design.spaces.some((s) => s.deckId === k.id || s.topDeckId === k.id) || design.decks.length <= 1}
              title="Remove deck (only when empty)"
              onClick={() => edit((d) => void (d.decks = d.decks.filter((x) => x.id !== k.id)))}
            >
              remove
            </button>
          </div>
        ))}
        <p className="mt-1 text-[11px] text-muted">The round button marks the bulkhead deck used by the flooding check.</p>
      </Section>
      <Section title="People" right={<Btn onClick={() => edit((d) => void (d.people = { passengers: Math.max(0, totalPersons - d.people.crew), crew: d.people.crew }))}>From spaces</Btn>}>
        <Num label="Passengers" value={design.people.passengers} step={1} min={0} digits={0} onChange={(v) => edit((d) => void (d.people.passengers = Math.round(v)))} />
        <Num label="Crew" value={design.people.crew} step={1} min={0} digits={0} onChange={(v) => edit((d) => void (d.people.crew = Math.round(v)))} />
        <KV k="Persons placed in spaces" v={totalPersons} />
        <Num label="Mass per person incl. effects" value={design.loading.personMassKg} unit="kg" step={5} min={0} digits={0} onChange={(v) => edit((d) => void (d.loading.personMassKg = v))} />
      </Section>
      <Section title="Loading">
        <Check
          label="Use my own lightship weight"
          value={!!ov}
          onChange={(v) =>
            edit((d) => {
              const est = useStore.getState().analysis?.condition?.weights.lightship;
              d.loading.lightshipOverride = v ? { massT: Math.round(est?.massT ?? 3000), lcg: +(est?.lcg ?? d.hull.LOA / 2).toFixed(2), kg: +(est?.kg ?? d.hull.depth * 0.8).toFixed(2) } : null;
            })
          }
        />
        {ov && (
          <>
            <Num label="Lightship mass" value={ov.massT} unit="t" step={10} min={0} digits={1} onChange={(v) => edit((d) => void (d.loading.lightshipOverride!.massT = v))} />
            <Num label="Lightship LCG" value={ov.lcg} unit="m" step={0.1} onChange={(v) => edit((d) => void (d.loading.lightshipOverride!.lcg = v))} />
            <Num label="Lightship KG" value={ov.kg} unit="m" step={0.05} onChange={(v) => edit((d) => void (d.loading.lightshipOverride!.kg = v))} />
          </>
        )}
        <Num label="Other deadweight" value={design.loading.deadweight.massT} unit="t" step={10} min={0} digits={1} onChange={(v) => edit((d) => void (d.loading.deadweight.massT = v))} />
        <Num label="Other deadweight LCG" value={design.loading.deadweight.lcg} unit="m" step={0.5} onChange={(v) => edit((d) => void (d.loading.deadweight.lcg = v))} />
        <Num label="Other deadweight KG" value={design.loading.deadweight.kg} unit="m" step={0.1} onChange={(v) => edit((d) => void (d.loading.deadweight.kg = v))} />
        <p className="mt-1 text-[11px] text-muted">Fuel, water and ballast belong in tanks (Tank in the build bar) so their free surface is counted.</p>
      </Section>
      <Section title="Evacuation scenario">
        <Select
          label="Scenario"
          value={design.evacuation.scenario}
          options={[
            { value: "night", label: "Night (R = 10 min)" },
            { value: "day", label: "Day (R = 5 min)" },
          ]}
          onChange={(v) => edit((d) => void (d.evacuation.scenario = v))}
        />
        <Num label="Embarkation + launching E+L" value={design.evacuation.embarkLaunchMin} unit="min" step={1} min={0} max={30} digits={0} onChange={(v) => edit((d) => void (d.evacuation.embarkLaunchMin = v))} />
        <Check label="Ro-ro passenger ship (n = 60 min)" value={design.evacuation.roRo} onChange={(v) => edit((d) => void (d.evacuation.roRo = v))} />
      </Section>
      <Section title="Reference model" right={refMesh && <Btn kind="danger" onClick={() => setRefMesh(null)}>Remove</Btn>}>
        {!refMesh ? (
          <p className="text-[11px] text-muted">Load an STL, OBJ, glTF or GLB file (File &gt; Import 3D reference model) to see it over the arrangement. It is for comparison only and is not used in calculations.</p>
        ) : (
          <>
            <KV k="File" v={refMesh.name} />
            <Check label="Visible" value={refMesh.visible} onChange={(v) => setRefMesh({ ...refMesh, visible: v })} />
            <Num label="Scale" value={refMesh.scale} step={0.01} digits={4} min={0.0001} onChange={(v) => setRefMesh({ ...refMesh, scale: v })} />
            <Num label="Offset x" value={refMesh.offset[0]} unit="m" step={0.5} onChange={(v) => setRefMesh({ ...refMesh, offset: [v, refMesh.offset[1], refMesh.offset[2]] })} />
            <Num label="Offset y" value={refMesh.offset[1]} unit="m" step={0.5} onChange={(v) => setRefMesh({ ...refMesh, offset: [refMesh.offset[0], v, refMesh.offset[2]] })} />
            <Num label="Offset z" value={refMesh.offset[2]} unit="m" step={0.5} onChange={(v) => setRefMesh({ ...refMesh, offset: [refMesh.offset[0], refMesh.offset[1], v] })} />
            <Num label="Rotation about vertical" value={refMesh.rotZ} unit="deg" step={90} digits={0} onChange={(v) => setRefMesh({ ...refMesh, rotZ: v })} />
            <Num label="Opacity" value={refMesh.opacity} step={0.1} min={0.05} max={1} onChange={(v) => setRefMesh({ ...refMesh, opacity: v })} />
          </>
        )}
      </Section>
      <Section title="Rules file">
        <p className="text-[11px] text-muted">
          {RULES.rules.length} rules loaded from rules.json. {RULES.meta.disclaimer}
        </p>
      </Section>
    </div>
  );
}
