import { useEffect, useLayoutEffect, useState } from "react";
import { useStore } from "./store";
import { Section, Btn } from "./fields";
import { RULES } from "../engine/rules";
import { DOC_FILES } from "./panels";

// ------------------------------------------------------------------ Guide (how to use)

/** Animated loop: a block is placed, turns red (rule broken), gets fixed, turns green. */
function ConceptAnimation() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);
  const label = ["Build: drop rooms on a deck", "Check: the rules run on every change", "Flag: the broken part is marked red", "Fix: follow the hint and it clears"][phase];
  const blockColor = phase === 2 ? "var(--bad)" : phase === 3 ? "var(--ok)" : "var(--fg)";
  return (
    <div className="py-1">
      <svg viewBox="0 0 320 120" className="w-full">
        <path d="M10 70 L300 70 L310 58 L300 46 L20 46 Z" fill="none" stroke="var(--faint)" strokeWidth="1" />
        <rect x="40" y="48" width="40" height="20" fill="none" stroke="var(--muted)" strokeWidth="1" />
        <rect x="84" y="48" width="40" height="20" fill="none" stroke="var(--muted)" strokeWidth="1" />
        <rect x="210" y="48" width="30" height="20" fill="none" stroke="var(--muted)" strokeWidth="1" />
        <path d="M214 66 h6 v-5 h6 v-5 h6 v-5" fill="none" stroke="var(--muted)" strokeWidth="0.9" />
        <g style={{ transition: "transform 0.7s cubic-bezier(.2,.8,.2,1)", transform: phase === 0 ? "translate(0px,-34px)" : "translate(0px,0px)" }}>
          <rect x="128" y="48" width="46" height="20" fill={blockColor} fillOpacity={phase >= 2 ? 0.22 : 0.08} stroke={blockColor} strokeWidth="1.2" style={{ transition: "all 0.45s" }} />
        </g>
        {phase === 2 && (
          <g className="anim-pop" style={{ transformOrigin: "151px 30px" }}>
            <path d="M151 40 C151 40 145 33 145 28.5 a6 6 0 0 1 12 0 C157 33 151 40 151 40 Z" fill="var(--surface)" stroke="var(--fg)" strokeWidth="0.9" />
            <circle cx="151" cy="28.5" r="2.4" fill="var(--bad)" />
          </g>
        )}
        {phase >= 1 && <path d="M150 100 L150 76" stroke="var(--accent)" strokeWidth="1" className="anim-dash" markerEnd="url(#arr)" />}
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        <text key={phase} x="160" y="113" fontSize="10.5" fill="var(--fg)" textAnchor="middle" className="anim-wipe">
          {label}
        </text>
        <text x="82" y="82" fontSize="7.5" fill="var(--faint)" textAnchor="middle" letterSpacing="1">
          CABINS
        </text>
        <text x="151" y="82" fontSize="7.5" fill="var(--faint)" textAnchor="middle" letterSpacing="1">
          GALLEY
        </text>
        <text x="225" y="82" fontSize="7.5" fill="var(--faint)" textAnchor="middle" letterSpacing="1">
          STAIR
        </text>
      </svg>
      <div className="mt-1 flex justify-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-[2px] w-6 transition-colors" style={{ background: i === phase ? "var(--accent)" : "var(--line)" }} />
        ))}
      </div>
    </div>
  );
}

export function GuidePanel() {
  const set = useStore((s) => s.set);
  return (
    <div>
      <Section title="What this tool does">
        <ConceptAnimation />
        <p className="mt-2 text-xs leading-relaxed">
          You arrange a ship in 3D: decks, rooms, stairs, doors, bulkheads, tanks and lifeboats. After every change the ship is re-calculated and checked against the rules in <code>rules.json</code>. Anything that breaks a rule glows red or amber, and the Issues tab says what is wrong, why, and how to fix it.
        </p>
        <Btn kind="primary" className="mt-2 w-full" onClick={() => set({ tourStep: 0 })}>
          Start the interactive tour
        </Btn>
      </Section>
      <Section title="Steps">
        <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
          <li>
            <b>Pick a deck</b> at the top of the 3D view. Decks above it are hidden so you can see inside.
          </li>
          <li>
            <b>Pick a space</b> in the build bar at the bottom (or press 1 to 9) and click on the deck. A red preview means it would overlap something.
          </li>
          <li>
            <b>Connect it</b>: select the space and press <i>Auto doors</i>, or use the Emergency door tool (D). Stamps place a whole cabin block or stair core at once.
          </li>
          <li>
            <b>Add bulkheads</b>: watertight ones for flooding, fire zone ones for main vertical zones.
          </li>
          <li>
            <b>Read the flags</b> in the Issues tab. Click one to fly to the part.
          </li>
          <li>
            <b>Test it</b>: switch to Test mode to put the ship in waves, heel it, flood a compartment or watch the evacuation.
          </li>
          <li>
            <b>Report</b>: File &gt; Download PDF report.
          </li>
        </ol>
      </Section>
      <Section title="Mouse and keys">
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
          {[
            ["Left drag", "orbit"],
            ["Right drag", "pan"],
            ["Wheel", "zoom to cursor"],
            ["Double-click space", "fly to it"],
            ["1 to 9, 0", "space types"],
            ["V / D", "select / door"],
            ["W / Z", "watertight / fire zone"],
            ["L / R", "lifeboat / liferaft"],
            ["B / K", "cabin block / stair core"],
            ["T", "design / test mode"],
            ["F", "focus selection"],
            ["Ctrl+Z / Ctrl+Y", "undo / redo"],
            ["Del", "delete"],
            ["Esc", "back to select"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <span className="font-mono text-accent">{k}</span>
              <span className="text-muted">{v}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Files you can load">
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted">
          <li>
            <b className="text-fg">Design file (.design.json)</b>: saved from this tool.
          </li>
          <li>
            <b className="text-fg">vessel.js ship (.json)</b>: hull, decks, bulkheads and boxes from NTNU ShipLab tools.
          </li>
          <li>
            <b className="text-fg">Hull offsets table (.csv)</b>: half-breadths at stations and waterlines, as exported by Maxsurf, FREE!ship, DELFTship or Rhino. Replaces the hull used in all calculations.
          </li>
          <li>
            <b className="text-fg">3D reference model (.stl, .obj, .gltf, .glb)</b>: shown over the arrangement for comparison only.
          </li>
          <li>Not yet: STEP/IGES solids (need an OpenCascade module), DWG, and proprietary formats such as NAPA or AVEVA. Export offsets or a mesh from those tools instead.</li>
        </ul>
        <p className="mt-2 text-[11px] text-muted">Offsets CSV layout: first row is a label then station x positions in metres (aft to forward); each next row is a waterline height z in metres followed by half-breadths in metres. Leave a cell empty where there is no hull.</p>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Sources and method

const METHOD: Record<string, string> = {
  "FIRE-ZONE-SIZE": "Hull outline at each deck height from the vessel.js offsets; zone mean width = waterplane area of the zone / its length.",
  "FIRE-WALL-RATING": "Shared walls found geometrically between touching spaces; required rating looked up per room-type pair.",
  "ESCAPE-TWO-EXITS": "Graph of spaces and doors; maximum number of routes that share no door or space (max-flow); dead ends measured along each corridor.",
  "ESCAPE-STAIR-WIDTH": "Stair properties compared with limits; persons per stair from the evacuation assignment; flights must fit in the stairwell at 45 degrees; emergency doors into a stair at least as wide as the stair.",
  "EVACUATION-TIME": "MSC.1/Circ.1533 Annex 2 hydraulic model: densities, specific flows, queues at stairs, travel times.",
  "FLOOD-SURVIVAL": "Lost-buoyancy method with vessel.js waterplane integration for each single and adjacent-pair damage.",
  "INTACT-STABILITY": "GZ curve by integrating heeled hull sections at constant displacement, free-surface correction included.",
  "LSA-CAPACITY": "Sum of lifeboat capacity per side and liferaft capacity compared with persons on board.",
  "WEIGHT-MARGIN": "Margin weight added at the lightship centre of gravity; draft solved again on the vessel.js hull; new freeboard and GM compared with the limits.",
  "REFERENCE-SHIPS": "Cabin floor area per person, deck-to-deck heights and the rooms each escape route passes through, compared with three real research ships.",
};

export function SourcesPanel() {
  return (
    <div>
      <Section title="Is AI used?">
        <p className="text-xs leading-relaxed">
          No. There is no language model, local or remote, in this tool. Every flag is produced by deterministic code: geometry and graph checks plus naval architecture calculations (vessel.js), compared against the numbers in <code>rules.json</code>. The same design always gives the same result, and every number can be traced to a formula and a source below.
        </p>
      </Section>
      <Section title="How each check is decided">
        {RULES.rules.map((r: { id: string; title: string; source: string; clause: string; status: string }) => (
          <div key={r.id} className="mb-2 text-[11px] leading-relaxed">
            <div className="font-semibold text-fg">{r.title}</div>
            <div className="text-muted">{METHOD[r.id]}</div>
            <div className="text-muted">
              {r.clause}
              {r.status === "assumed" && <span className="text-warn"> (some values still to be confirmed, see THINGS_TO_ASK.txt)</span>}
            </div>
          </div>
        ))}
      </Section>
      <Section title="Documents">
        {RULES.sources.map((s: { id: string; name: string; url?: string; file?: string }) => {
          const local = DOC_FILES[s.id] ?? s.file;
          return (
            <div key={s.id} className="mb-1.5 text-[11px]">
              <div className="text-fg">{s.name}</div>
              <div className="flex gap-3">
                {local && (
                  <a className="text-accent underline" href={`/${encodeURI(local)}`} target="_blank" rel="noreferrer">
                    Local PDF
                  </a>
                )}
                {s.url && (
                  <a className="text-muted underline" href={s.url} target="_blank" rel="noreferrer">
                    Original
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </Section>
      <Section title="Calculation library">
        <p className="text-[11px] leading-relaxed text-muted">vessel.js (NTNU Ship Design and Operation Lab, MIT licence) provides the hull geometry, hydrostatics, weights, draft solver, Holtrop-Mennen resistance and wave motions. Our additions are tested against closed-form results (box barge, V-section prism, wall-sided formula) and against a hand-checked Circ.1533 example.</p>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ Interactive tour

// Optional image per step (files in public/; replace public/tour/model-ships.svg with a screenshot if you like,
// same name, or change the path here).
const STEPS: { target: string; title: string; text: string; image?: string }[] = [
  { target: "menu", title: "Menus", text: "Everything the tool can do is in these menus. Click one to open it, click another to switch." },
  { target: "mode", title: "Design and Test", text: "Design mode is for building. Test mode puts the ship in waves, heels it, floods it or runs the evacuation, with live dials." },
  { target: "decks", title: "Decks", text: "Choose the deck you are working on. Decks above it are hidden so you can see inside." },
  {
    target: "models",
    title: "Model ships",
    text: "Pick the ship to work on: the demo ferry, or Icon of the Seas, Star of the Seas, Legend of the Seas and Mein Schiff 7, built from their published main data. Your edits to each model stay while you switch; they are only lost when the page is reloaded.",
    image: "/tour/model-ships.svg",
  },
  { target: "hotbar", title: "Build bar", text: "Pick a space type or a stamp here, then click on the deck. Number keys 1 to 9 select spaces. Escape route (E): click a room to connect it and see its way out." },
  { target: "tools", title: "Tools", text: "Select and move, emergency doors, watertight and fire zone bulkheads, lifeboats and liferafts. The icons below switch views on and off: hull, waterline, bulkheads, escape routes, emergency door icons and space names." },
  { target: "viewport", title: "3D view", text: "Drag a space to move it, it snaps to neighbours and never overlaps. Hover to lift a space, double-click to fly to it, scroll to zoom where the mouse points." },
  { target: "tabs", title: "Results", text: "Issues lists every flag with what is wrong and how to fix it. The other tabs show hydrostatics, stability, damage, evacuation and performance." },
  { target: "score", title: "Score", text: "The compliance score updates on every change. Green rules pass, amber are close to a limit, red are broken." },
];

export function Tour() {
  const step = useStore((s) => s.tourStep);
  const set = useStore((s) => s.set);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (step === null) return;
    const el = document.querySelector(`[data-tour="${STEPS[step].target}"]`);
    const upd = () => setRect(el ? el.getBoundingClientRect() : new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 2 - 40, 200, 80));
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, [step]);
  if (step === null || !rect) return null;
  const s = STEPS[step];
  const pad = 6;
  const r = rect;
  const cardW = s.image ? 420 : 340;
  const cardH = s.image ? 400 : 190;
  const below = r.bottom + cardH < window.innerHeight;
  const cardTop = below ? r.bottom + 28 : Math.max(12, r.top - cardH);
  const cardLeft = Math.min(Math.max(12, r.left + r.width / 2 - cardW / 2), window.innerWidth - cardW - 12);
  const arrowX = r.left + r.width / 2;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute rounded-lg transition-all duration-300"
        style={{ left: r.left - pad, top: r.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad, boxShadow: "0 0 0 9999px rgba(10,10,10,0.62)", outline: "1px solid var(--accent)" }}
      />
      <div className="anim-bob absolute text-accent" style={{ left: arrowX - 12, top: below ? r.bottom + 4 : r.top - 30, ["--dy" as string]: below ? "6px" : "-6px" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ transform: below ? "none" : "rotate(180deg)" }}>
          <path d="M12 2 L20 14 H14 V22 H10 V14 H4 Z" fill="currentColor" />
        </svg>
      </div>
      <div key={step} className="anim-wipe absolute rounded-md border border-line bg-surface p-4 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)]" style={{ left: cardLeft, top: cardTop, width: cardW }}>
        {s.image && <img src={s.image} alt="" className="mb-3 block aspect-[760/340] w-full rounded border border-line object-cover" />}
        <div className="mb-1 text-[10px] tracking-wider text-muted uppercase">
          Step {step + 1} of {STEPS.length}
        </div>
        <div className="mb-1 text-sm font-semibold">{s.title}</div>
        <p className="text-xs leading-relaxed text-muted">{s.text}</p>
        <div className="mt-3 flex justify-between">
          <Btn kind="ghost" onClick={() => set({ tourStep: null })} title="Close the tour (Esc). Restart it any time from Help or with ?">
            Skip tour
          </Btn>
          <div className="flex gap-1">
            <Btn disabled={step === 0} onClick={() => set({ tourStep: step - 1 })}>
              Back
            </Btn>
            <Btn kind="primary" onClick={() => set({ tourStep: step + 1 < STEPS.length ? step + 1 : null })}>
              {step + 1 < STEPS.length ? "Next" : "Done"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
