// "Fix with AI": plans verified fixes in a Web Worker, then plays them one by one in the 3D view
// (camera flies to the spot, the change animates in, the flag turns green). The user watches; Pause, Skip and
// Stop sit in the bar at the bottom. The whole run is one undo step: Keep or Undo all at the end.
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { aiStatus, aiChoose } from "../ai/client";
import { applyActions, focusZ, type FixAction, type FixPlan } from "../engine/fixes";
import type { Design } from "../engine/types";
import { focusOn } from "./three/Viewport";
import { STATUS_VAR } from "./theme";
import { Icon } from "./fields";

let worker: Worker | null = null;
const ctl = { stop: false, skip: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Sleep in small slices so Pause and Stop react quickly. */
async function wait(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end || useStore.getState().fix?.paused) {
    if (ctl.stop) return;
    await sleep(50);
  }
}

export const FIX_ICON = "M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.7-.7-2.6zM18 3v3M19.5 4.5h-3";

/** Start planning (button "Fix with AI"). */
export async function startFix() {
  const st = useStore.getState();
  if (st.fix) return;
  if (st.mode === "test") st.set({ mode: "design" });
  st.select(null);
  st.set({ tool: { kind: "select" }, tourStep: null });
  ctl.stop = false;
  ctl.skip = false;
  st.setFix({ phase: "planning", progress: { text: "Checking the AI service", done: 0, total: 1 }, plan: null, current: 0, paused: false, stopped: false, ai: null, caption: null, scoreStart: st.analysis?.score.score ?? 0, applied: 0, error: undefined });
  const ai = await aiStatus();
  if (!useStore.getState().fix) return; // cancelled meanwhile
  useStore.getState().setFix({ ai, progress: { text: "Testing each fix on a copy of the design", done: 0, total: 1 } });
  worker?.terminate();
  worker = new Worker(new URL("../engine/fixWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = async (e: MessageEvent) => {
    const m = e.data;
    const s = useStore.getState();
    if (!s.fix) return;
    if (m.type === "progress") s.setFix({ progress: { text: m.text, done: m.done, total: m.total } });
    else if (m.type === "choose") {
      s.setFix({ progress: { ...s.fix.progress, text: `AI is choosing between ${m.req.options.length} safe options: ${m.req.finding}` } });
      const answer = await aiChoose(m.req);
      worker?.postMessage({ type: "choice", reqId: m.reqId, answer });
    } else if (m.type === "done") {
      const plan = m.plan as FixPlan;
      worker?.terminate();
      worker = null;
      s.setFix({ phase: plan.steps.length ? "ready" : "finished", plan });
    } else if (m.type === "error") {
      worker?.terminate();
      worker = null;
      s.setFix({ phase: "finished", error: m.message, plan: { steps: [], skipped: [], scoreBefore: 0, scoreAfter: 0, ms: 0, aiCalls: 0 } });
    }
  };
  worker.onerror = () => useStore.getState().setFix({ phase: "finished", error: "The planner stopped unexpectedly." });
  worker.postMessage({ type: "plan", design: useStore.getState().design, useAI: ai.ok });
}

export function cancelFix() {
  worker?.terminate();
  worker = null;
  ctl.stop = true;
  useStore.getState().setFix(null);
}

// ------------------------------------------------------------------ the run

type Tween = { get: (d: Design) => number | undefined; set: (d: Design, v: number) => void; from: number; to: number };

/** Numeric changes glide (rooms, stairs, doors, bulkheads, decks); everything else appears at once. */
function tweensOf(d: Design, actions: FixAction[]): { tweens: Tween[]; instant: FixAction[] } {
  const tweens: Tween[] = [];
  const instant: FixAction[] = [];
  const add = (get: Tween["get"], set: Tween["set"], to: number) => {
    const from = get(d);
    if (from === undefined || from === to) return;
    tweens.push({ get, set, from, to });
  };
  for (const a of actions) {
    if (a.kind === "space") {
      for (const k of ["xCentre", "yCentre", "length", "breadth"] as const) {
        const to = a.set[k];
        if (to !== undefined) add((x) => x.spaces.find((s) => s.id === a.id)?.[k], (x, v) => void (x.spaces.find((s) => s.id === a.id)![k] = v), to);
      }
      if (a.stair?.widthMm !== undefined) add((x) => x.spaces.find((s) => s.id === a.id)?.stair?.widthMm, (x, v) => void (x.spaces.find((s) => s.id === a.id)!.stair!.widthMm = Math.round(v)), a.stair.widthMm);
      const rest = { ...a, set: { ...(a.set.persons !== undefined ? { persons: a.set.persons } : {}) }, stair: a.stair ? { ...a.stair, widthMm: undefined } : undefined };
      if (rest.stair) delete (rest.stair as { widthMm?: number }).widthMm;
      instant.push(rest);
    } else if (a.kind === "door" && a.set.widthMm !== undefined) {
      add((x) => x.doors.find((q) => q.id === a.id)?.widthMm, (x, v) => void (x.doors.find((q) => q.id === a.id)!.widthMm = Math.round(v)), a.set.widthMm);
      for (const k of ["x", "y"] as const) if (a.set[k] !== undefined) add((x) => x.doors.find((q) => q.id === a.id)?.[k], (x, v) => void (x.doors.find((q) => q.id === a.id)![k] = v), a.set[k]!);
    } else if (a.kind === "door") {
      for (const k of ["x", "y"] as const) if (a.set[k] !== undefined) add((x) => x.doors.find((q) => q.id === a.id)?.[k], (x, v) => void (x.doors.find((q) => q.id === a.id)![k] = v), a.set[k]!);
    } else if (a.kind === "bulkhead" && a.set.x !== undefined) {
      add((x) => x.bulkheads.find((b) => b.id === a.id)?.x, (x, v) => void (x.bulkheads.find((b) => b.id === a.id)!.x = v), a.set.x);
      if (a.set.rating) instant.push({ kind: "bulkhead", id: a.id, set: { rating: a.set.rating } });
    } else if (a.kind === "deck") add((x) => x.decks.find((k) => k.id === a.id)?.z, (x, v) => void (x.decks.find((k) => k.id === a.id)!.z = v), a.z);
    else instant.push(a);
  }
  return { tweens, instant };
}

async function animate(actions: FixAction[], ms: number) {
  const st = useStore.getState();
  const { tweens, instant } = tweensOf(st.design, actions);
  const adds = instant.filter((a) => a.kind !== "removeDoor");
  const removes = instant.filter((a) => a.kind === "removeDoor");
  if (adds.length) st.edit((d) => applyActions(d, adds), false);
  if (tweens.length) {
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = () => {
        const u = Math.min(1, (performance.now() - t0) / ms);
        const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; // ease in-out
        useStore.getState().edit((d) => {
          for (const tw of tweens) tw.set(d, tw.from + (tw.to - tw.from) * e);
        }, false);
        if (u < 1 && !ctl.stop) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
  } else await wait(ms * 0.6);
  if (removes.length) useStore.getState().edit((d) => applyActions(d, removes), false);
  // exact final values
  useStore.getState().edit((d) => applyActions(d, actions), false);
}

export async function runFix() {
  const st = useStore.getState();
  const plan = st.fix?.plan;
  if (!plan || st.fix?.phase !== "ready") return;
  ctl.stop = false;
  ctl.skip = false;
  st.beginGesture();
  st.setFix({ phase: "running", current: 0, applied: 0, scoreStart: st.analysis?.score.score ?? plan.scoreBefore });
  let applied = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    if (ctl.stop) break;
    const step = plan.steps[i];
    const s = useStore.getState();
    const d = s.design;
    const f = step.chosen.focus;
    const z = focusZ(d, f);
    s.setFix({ current: i, caption: { title: step.finding, detail: step.chosen.label, ai: step.byAI ? step.byAI.reason : undefined } });
    if (d.decks.some((k) => k.id === f.deckId)) s.set({ activeDeckId: f.deckId });
    focusOn(f.x, f.y, z);
    await wait(1100);
    if (ctl.stop) break;
    if (ctl.skip) {
      ctl.skip = false;
      continue;
    }
    useStore.getState().addFx({ x: f.x, y: f.y, z, kind: "focus" });
    await wait(350);
    await animate(step.chosen.actions, 850);
    applied++;
    useStore.getState().setFix({ applied });
    await wait(450); // analysis runs 200 ms after the last change
    useStore.getState().addFx({ x: f.x, y: f.y, z, kind: "done" });
    useStore.getState().setFix({ caption: { title: step.finding, detail: step.chosen.label, ai: step.byAI?.reason, done: true } });
    await wait(900);
    if (ctl.skip) ctl.skip = false;
  }
  window.dispatchEvent(new CustomEvent("viewport:view", { detail: "3d" }));
  await sleep(700);
  useStore.getState().setFix({ phase: "finished", stopped: ctl.stop, caption: null, applied });
}

export function finishFix(keep: boolean) {
  const st = useStore.getState();
  if (keep) {
    st.commit();
    st.notify(`${st.fix?.applied ?? 0} fixes kept. One Ctrl+Z undoes them all.`, "ok");
  } else {
    st.cancelGesture();
    st.notify("All fixes undone.", "info");
  }
  st.setFix(null);
}

// ------------------------------------------------------------------ the bar at the bottom

export function FixBar() {
  const fix = useStore((s) => s.fix);
  const score = useStore((s) => s.analysis?.score.score ?? 0);
  const [showSkipped, setShowSkipped] = useState(false);
  useEffect(() => setShowSkipped(false), [fix?.phase]);
  if (!fix) return null;
  const plan = fix.plan;
  const aiChip = (
    <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: fix.ai === null ? "var(--faint)" : fix.ai.ok ? "var(--ok)" : "var(--warn)" }} />
      {fix.ai === null ? "Checking AI" : fix.ai.ok ? `AI ${fix.ai.model?.replace(/^.*\//, "") ?? "online"}` : "AI offline: smallest safe change is used"}
    </span>
  );
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button onClick={onClick} className={`rounded-[7px] px-3 py-1.5 text-[11.5px] transition-colors ${primary ? "bg-accent text-white hover:brightness-110" : "border border-line text-fg hover:bg-surface-2"}`}>
      {label}
    </button>
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-4" style={{ background: "linear-gradient(to top, color-mix(in srgb, var(--bg) 88%, transparent), transparent)" }}>
      <div key={fix.phase} data-tour="fixbar" className="anim-rise pointer-events-auto w-[min(720px,calc(100%-32px))] rounded-[12px] border border-line bg-surface/95 px-4 py-3 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <Icon d={FIX_ICON} size={15} className="text-accent" />
          <span className="label">Fix with AI</span>
          <span className="ml-auto">{aiChip}</span>
        </div>

        {fix.phase === "planning" && (
          <>
            <p className="truncate text-[12px] text-fg">{fix.progress.text}</p>
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded bg-surface-2">
              <div className="h-full rounded bg-accent transition-all duration-300" style={{ width: `${Math.min(100, (100 * fix.progress.done) / Math.max(1, fix.progress.total))}%` }} />
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[10.5px] text-faint">Every option is tested against all rules first. The AI only picks between options that already pass.</span>
              {btn("Cancel", cancelFix)}
            </div>
          </>
        )}

        {fix.phase === "ready" && plan && (
          <>
            <p className="text-[12.5px] text-fg">
              {plan.steps.length} fix{plan.steps.length === 1 ? "" : "es"} found, score {plan.scoreBefore} to {plan.scoreAfter}.
              <span className="text-muted">
                {" "}
                {plan.steps.filter((x) => x.byAI).length ? `${plan.steps.filter((x) => x.byAI).length} chosen by AI. ` : ""}
                {plan.skipped.length ? `${plan.skipped.length} left for a designer.` : ""}
              </span>
            </p>
            <ul className="mt-2 max-h-[150px] space-y-1 overflow-y-auto pr-1">
              {(showSkipped ? plan.skipped.map((x) => ({ s: x.status, a: x.finding, b: x.why })) : plan.steps.map((x) => ({ s: x.status, a: x.chosen.label, b: x.finding }))).map((x, i) => (
                <li key={i} className="anim-wipe flex items-start gap-2 text-[11.5px]" style={{ animationDelay: `${i * 30}ms` }}>
                  <span className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: STATUS_VAR[x.s] }} />
                  <span className="min-w-0">
                    <span className="text-fg">{x.a}</span> <span className="text-faint">{x.b}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              {plan.skipped.length > 0 && (
                <button className="text-[10.5px] text-faint hover:text-fg" onClick={() => setShowSkipped((v) => !v)}>
                  {showSkipped ? "Show the fixes" : `Show the ${plan.skipped.length} not fixed`}
                </button>
              )}
              <span className="ml-auto" />
              {btn("Cancel", cancelFix)}
              {btn("Start", () => void runFix(), true)}
            </div>
          </>
        )}

        {fix.phase === "running" && plan && (
          <>
            <div className="flex gap-[3px]">
              {plan.steps.map((_, i) => (
                <span key={i} className="h-[3px] flex-1 rounded transition-colors duration-500" style={{ background: i < fix.applied ? "var(--ok)" : i === fix.current ? "var(--accent)" : "var(--surface-2)" }} />
              ))}
            </div>
            {fix.caption && (
              <div key={`${fix.current}-${fix.caption.done ? 1 : 0}`} className="anim-wipe mt-2.5">
                <p className="text-[10.5px] text-faint">
                  Step {fix.current + 1} of {plan.steps.length} <span className="ml-1">{fix.caption.title}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[13px] text-fg">
                  {fix.caption.done && <span className="h-[6px] w-[6px] rounded-full" style={{ background: "var(--ok)" }} />}
                  {fix.caption.done ? `Fixed: ${fix.caption.detail}` : fix.caption.detail}
                </p>
                {fix.caption.ai && <p className="mt-0.5 text-[11px] text-muted">AI: {fix.caption.ai}</p>}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10.5px] text-faint tabular-nums">Score {score}</span>
              <span className="ml-auto" />
              {btn(fix.paused ? "Resume" : "Pause", () => useStore.getState().setFix({ paused: !fix.paused }))}
              {btn("Skip", () => void (ctl.skip = true))}
              {btn("Stop", () => {
                ctl.stop = true;
                useStore.getState().setFix({ paused: false });
              })}
            </div>
          </>
        )}

        {fix.phase === "finished" && (
          <>
            {fix.error ? (
              <p className="text-[12.5px] text-fg">The fix run could not finish: {fix.error}</p>
            ) : plan && plan.steps.length === 0 && fix.applied === 0 ? (
              <p className="text-[12.5px] text-fg">
                No safe automatic fix found. <span className="text-muted">{plan.skipped.length} flag{plan.skipped.length === 1 ? " needs" : "s need"} a designer's decision.</span>
              </p>
            ) : (
              <p className="text-[12.5px] text-fg">
                {fix.stopped ? "Stopped. " : ""}
                {fix.applied} fix{fix.applied === 1 ? "" : "es"} applied, score {fix.scoreStart} to {score}.
                <span className="text-muted"> Keep them, or undo all in one go.</span>
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              {fix.applied > 0 ? (
                <>
                  {btn("Undo all", () => finishFix(false))}
                  {btn("Keep changes", () => finishFix(true), true)}
                </>
              ) : (
                btn("Close", () => {
                  useStore.getState().cancelGesture();
                  useStore.getState().setFix(null);
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
