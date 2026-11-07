# Ship Design Pre-Check

Browser-based 3D ship arrangement editor for early design. Every change to the layout runs naval architecture calculations and checks the rules in `rules.json`. Parts that break a rule are flagged in red or amber, with the source clause shown next to the flag.

Built on [vessel.js](https://github.com/shiplab/vesseljs) (NTNU Ship Design and Operation Lab, MIT licence) for hull geometry, hydrostatics, weights, draft, resistance and motions.

> Early pre-check only. Not an official approval.

## Get the version with the ship designs and logos

The ship designs dropdown, the hull liveries (logos and colours) and their animations live on the `samar-version` branch. Every image they use is committed under `public/` (`public/brand/`, `public/liveries/`, `public/tour/`), so a fresh clone looks and behaves the same on any machine.

```
git clone -b samar-version https://github.com/SamarAbbas-DATA/SinceAI-hackathon-.git
cd SinceAI-hackathon-
npm ci             # installs the exact versions from package-lock.json
npm run dev
```

The tag `reproducible-logos` marks the checked snapshot: `git checkout reproducible-logos`.

## Run

Requires Node.js 18 or newer.

```
npm install
npm run dev        # http://localhost:5173
```

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the verification suite (117 unit and physics tests) |
| `npm run e2e` | Browser test with `npm run dev` running: drives the real app in headless Chrome or Edge (placing, overlap refusal, dragging, undo, all four test animations, PDF download). Screenshots and the PDF land in `e2e-output/` |
| `npm run report` | Prints a full engineering report of the demo ship in the terminal |
| `npm run report -- my.design.json` | Same report for a design you saved from the app |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build in `dist/` |

Deep links: `http://localhost:5173/?panel=stability&deck=D4` (panels: issues, inspect, design, hydro, stability, damage, evac, performance).

## Is AI used?

Not for the checks. Every flag comes from deterministic code: geometry and graph checks plus naval architecture calculations (vessel.js), compared with the numbers in `rules.json`. The checks run automatically about 200 ms after every edit, and the same design always gives the same result.

**Fix with AI** (button next to Test) is the only place a model is used, and it is optional. `src/engine/fixes.ts` proposes repairs for each flag, tries each on a copy of the design and keeps only those that improve the flag without making anything else worse. When several pass, a small model on OpenRouter picks one (`netlify/functions/fix-choice.mts`; default `google/gemini-2.5-flash-lite`, free models as fallback). Without a key, or when the AI is slow, the smallest safe change is used. The run then plays the fixes one by one in 3D with Pause, Skip and Stop, and can be undone in one step.

### Hosting on Netlify

`netlify.toml` builds the site (`npm run build`, publish `dist`, Node 20) and the function at `/api/fix-choice`. Set `OPENROUTER_API_KEY` under Site configuration > Environment variables (optional: `OPENROUTER_MODEL`). Locally, `npm run dev` serves the same function with the key from `.env`.

## Files you can load

| File | What happens |
|---|---|
| `.design.json` | A design saved from this tool |
| vessel.js ship `.json` | Hull offsets, decks, bulkheads, boxes, lifeboats and deadweight from NTNU ShipLab tools |
| Hull offsets `.csv` | Replaces the hull in all calculations. Layout: first row = label, then station x (m, aft to forward); following rows = waterline z (m), then half-breadths (m); empty cell = no hull. Most hull design programs (Maxsurf, FREE!ship, DELFTship, Rhino) can export offsets. A template is under File |
| `.stl`, `.obj`, `.gltf`, `.glb` | Shown as a reference model over the arrangement, auto-scaled to the hull length. Not used in calculations |

Not supported yet: STEP and IGES (they need a large OpenCascade WebAssembly module), DWG, and proprietary formats such as NAPA, Maxsurf `.msd` or AVEVA. Export offsets or a mesh from those tools instead.

## What it calculates

| Area | Method | Library |
|---|---|---|
| Hull form | Offset table (half-breadths), scaled to LOA, BOA and depth | vessel.js `Hull` |
| Upright hydrostatics | Displacement, KB, BMt, BMl, LCB, LCF, Awp, TPC, MCT, Cb, Cp, Cwp, Cm, wetted area | vessel.js `calculateAttributesAtDraft` |
| Weights | Parsons hull steel, deck and bulkhead steel, outfit per space, persons, deadweight, or your own lightship | vessel.js `Ship.getWeight` |
| Floating condition | Draft from displacement, trim from LCG vs LCB, GM | vessel.js `calculateDraftAtMass` |
| Large-angle stability | GZ curve by integrating heeled sections at constant displacement; IS Code 2008 general criteria; free-surface correction of slack tanks | our code on vessel.js offsets |
| Survival craft | Lifeboat capacity per side and liferaft capacity against persons on board | our code |
| Damage stability | Lost-buoyancy method for single and adjacent-pair compartment damage; attained index A vs required R | vessel.js waterplane integration |
| Evacuation | MSC.1/Circ.1533 Annex 2 simplified method (flows, densities, queues, 1.25(R+T) + 2/3(E+L) <= n) | our code |
| Escape routes | Disjoint routes (max-flow), groups of spaces, dead-end corridors (Reg 13) | our code |
| Fire | Main vertical zone size from hull outline per deck; division ratings between room types | our code |
| Resistance | Holtrop-Mennen calm water resistance and effective power | vessel.js `HullResistance` |
| Seakeeping | Heave, pitch and roll in regular waves (closed form) | vessel.js `WaveMotion` |
| Subdivision and plausibility | Collision bulkhead position (SOLAS II-1/12.1, Lf on the 85 % depth waterline); passenger heel from crowding and turning (IS Code 3.1); survival craft height above the waterline; impossible inputs (people in tanks, overfull rooms, low decks, bulkhead deck under water, doors wider than walls) | our code on vessel.js |
| Pipes and cables | Fire main per deck and fire zone, connection to the pumps and pump pressure (static head); watertight bulkhead and collision bulkhead penetrations; fuel oil clearance to exhaust; main cables clear of galleys, laundries and machinery casings | our code |

## How the results were verified

`npm test` runs these checks:

- **Box barge** (`tests/physics.test.ts`): vessel.js volume, KB, BMt = B²/12T, BMl = L²/12T, waterplane and form coefficients match closed-form values. The draft solver recovers a known draft.
- **V-section prism** (the vessel.js `prismaticHull.json` hull): volume L·B·T²/2D, KB = 2T/3 and BMt match the formulas.
- **GZ curve**: matches the wall-sided formula GZ = sin φ (GM + ½ BM tan²φ) to 1 mm up to deck-edge immersion. The initial slope tends to GM.
- **Flooding**: for a central compartment, sinkage equals T·L/(L − μl) and damaged GM equals the hand calculation. End damage trims the ship towards the damaged end. R follows the SOLAS formula ranges.
- **Evacuation** (`tests/evacuation.test.ts`): a corridor, stair and assembly station case is checked step by step against Circ.1533 tables 1.1, 1.2 and 1.3. Queueing at the stair, tF, stair speed, T = (γ + δ) tI and the 60/80 min limit are all covered.
- **Rules** (`tests/rules.test.ts`): the demo ship gives the expected flags. Targeted edits flip the verdicts: fixing a wall rating, a 700 mm stair, removing an exit, removing a stair (dead end), a cabin straddling a fire zone bulkhead, and 36 or fewer passengers.
- **Files** (`tests/io.test.ts`): design JSON round trip is lossless. Exporting to vessel.js format and importing back gives identical hydrostatics.
- **Features** (`tests/features.test.ts`): slack-tank free-surface correction equals rho·l·b³/12 / displacement; an offsets CSV box gives box hydrostatics; overlap detection; stamps and auto doors; lifeboat capacity; every finding carries a fix.
- **Pipes and cables** (`tests/systems.test.ts`): segment distances and clipping against hand values, deckhead heights and riser lengths, the default arrangement, and each pipe and cable rule turned red or amber by a targeted edit.
- **Audit checks** (`tests/audit.test.ts`): heel for a constant lever against tan(phi) = l / GM, the turning lever 0.2 v2/(g LWL)(KG - T/2), the crowding lever, the collision bulkhead band from Lf, and impossible inputs (people in tanks, overfull rooms, low decks, a bulkhead deck under water, doors wider than their wall).
- **Browser** (`scripts/e2e.mjs`): 32 checks on the running app, including placing, overlap refusal, drag snap-back, undo, the four test animations, the PDF download, drawing and dragging a pipe, and the pipe and cable toggles.

## Known limits (read before trusting a number)

- Lightship from vessel.js is a parametric estimate. Enter a real lightship in the Design tab as soon as you have one.
- GZ uses fixed trim, no downflooding angle, and treats the hull as watertight to the moulded depth. Slack tanks are corrected with the rectangular free-surface formula.
- Test mode animations are visual: the motions use vessel.js amplitudes as regular sine waves, and the evacuation walk-through ignores queues. The official evacuation number is the Circ.1533 total shown beside it.
- Damage stability is a simplified lost-buoyancy estimate with full-breadth compartments. It is not the SOLAS II-1 probabilistic calculation.
- Rules marked "assumed" in `rules.json` use placeholder values that must be confirmed with Meyer Turku.  The open questions are in `THINGS_TO_ASK.txt`.
- vessel.js is no longer maintained. It is vendored with two logging patches and one documented bug workaround (see `src/vendor/vessel/PATCHES.md`).

## Layout

```
rules.json            rules, thresholds and sources (single source of truth)
docs/                 downloaded regulation PDFs
src/engine/           calculations, no UI (vessel adapter, stability, flooding, evacuation, topology, rules)
src/ui/               React + three.js editor
src/vendor/vessel/    vendored vessel.js
src/data/             hull templates (from vessel.js examples) and the demo ship
tests/                verification suite
scripts/report.ts     terminal report
```
