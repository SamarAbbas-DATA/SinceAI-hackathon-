# Ship Design Pre-Check (Meyer Turku challenge)

**First step, every session and after every context reset: read `INSTRUCTIONS.txt` and follow it.** It lists the files to read (always `PROGRESS.md` and `THINGS_TO_ASK.txt`) and which files belong to which kind of task.

**Challenge:** "Understanding ship design rules and compliance". Help engineers understand complex ship rules and catch compliance issues early in design.

**Idea:** A game-like 3D ship arrangement editor in the browser. You place rooms, stairs, doors, fire zone and watertight bulkheads, tanks and lifeboats on decks of a parametric (or imported) hull. After every change the ship is recalculated and checked against `rules.json`. Broken parts glow red or amber, and every flag says what is wrong, why it matters and how to fix it. A Test mode animates the ship in waves, heeling, flooding and evacuating, with live dials. A PDF report shows all flags on deck plans. No AI is used: all checks are deterministic.

## Stack
- Vite + React 18 + TypeScript, Tailwind v4 (theme tokens in `src/index.css`, dark default), Zustand, jsPDF. No backend.
- three.js via @react-three/fiber + drei.
- vessel.js (MIT, unmaintained) vendored at `src/vendor/vessel/vessel.module.js`: hull geometry, hydrostatics, weights, draft, Holtrop resistance, wave motions. See `src/vendor/vessel/PATCHES.md`. Do not edit calculation logic there.
- Vitest for unit/physics tests, `scripts/e2e.mjs` for browser tests over the Chrome DevTools protocol, `npm run report` for a terminal report.

## Architecture
- `src/engine/` is pure TS, UI-free, testable in Node: `vessel.ts` (adapter, weights, tanks, free surface), `stability.ts` (GZ), `flooding.ts`, `evacuation.ts` (Circ.1533 Annex 2), `topology.ts` (adjacency, doors, routing, max-flow, overlap), `generators.ts` (stamps, auto doors, default pipes and cables), `systems.ts` (pipe and cable geometry), `rules.ts`, `analyze.ts`, `io.ts`.
- `src/ui/`: `store.ts`, `App.tsx`, `three/Viewport.tsx`, `Inspector.tsx`, `panels.tsx`, `TestPanel.tsx`, `help.tsx`, `report.ts`, `three/runs.tsx` (pipes and cables).
- Coordinates follow vessel.js: x forward from the stern, y to port, z up from the keel. The three.js scene wraps everything in one group rotated -90 deg about X.

## Rules
- `rules.json` is the single source of truth for thresholds. Never hard-code a threshold. A new rule needs an entry there plus a function in `RULE_FUNCS`.
- Every finding must have `message` (what), `detail` (why / measured vs limit) and `fix` (how). Write plain, specific sentences that name the part.
- Values not taken from a downloaded document go into `THINGS_TO_ASK.txt`; the UI does not show "assumed" badges.
- Always label results "early pre-check, not an official approval" and flooding results "simplified estimate".

## Visual style (from reference_images/: Onshape screenshots, "reference 3d ui" LP5 map video, wave GIF, animation video)
- Minimal and calm. Neutral charcoal dark theme (default) and warm off-white light theme; no blue cast. One accent: dark orange (`--accent`).
- Use the tokens in `src/index.css` (`bg`, `surface`, `surface-2`, `line`, `fg`, `muted`, `faint`, `accent`, `bad`, `warn`, `ok`). Do not use raw Tailwind palette colours (sky, rose, slate...) in UI code.
- Icons are thin monochrome line silhouettes (`Icon` in fields.tsx). On hover or when active, build bar and tool rail icons fade slightly and sit on a soft rounded tile in their own colour at low alpha (`HoverTile` in App.tsx). No other filled backgrounds.
- Status colours are crisp: small dots, 2 px lines, solid tints. No glow, no pulsing, no filled badges.
- Text tabs with an accent underline, uppercase micro labels (`.label`), hairline separators instead of cards.
- Motion: masked wipe reveals (`anim-wipe`), staggered pops (`anim-pop`), rise-in (`anim-rise`), rooms assemble on load, drifting line fragments. Keep it subtle.
- Water is a polygon wireframe (displaced quad grid, crests brighter), not a liquid surface.

## Conventions
- Spaces must never overlap: use `editSpace()` / `overlapsWith()` for any edit that moves or resizes a space. A space whose centre is outside the hull is refused too (`centreOutsideHull`).
- Doors are called "emergency doors" in the UI; every door counts as an exit in the escape and evacuation checks.
- The app always starts from the default demo ferry (`demoDesign()`); keep its existing flags as a showcase. The previous session is only restored from File.
- Physics changes need an analytic test. Interaction changes need `npm run e2e`.
- No emojis in UI text or docs.
- Keep it light: build on vessel.js and existing libraries.
