# Progress

## Status (2026-11-05)
Core engine, rules, early warnings, editor, test mode and PDF report all work and are tested.

Done in session 2:
- Flag text rewritten: every finding has what / why / fix; summaries are plain sentences. "Assumed / ask Meyer" badges removed from the UI and collected in `THINGS_TO_ASK.txt`.
- `INSTRUCTIONS.txt` maps tasks to files; `CLAUDE.md` tells Claude to read it every session and after a reset.
- Overlap prevention: placing, dragging (snaps back), typing sizes, duplicating and stamps all refuse overlaps with a message.
- New parts: tanks with contents and filling (free-surface correction in GM), lifeboats and liferafts with new rule LSA-CAPACITY, cabin-block and stair-core stamps, auto doors, "set every wall to minimum rating".
- Imports: hull offsets CSV (replaces the hull in all calculations), STL / OBJ / glTF / GLB reference models, vessel.js JSON (now including lifeboats and deadweight). CSV template download.
- UI: dark theme default with light toggle, new palette, hover lift on spaces, pulsing flags, zoom to cursor with damping, double-click to fly, menu bar (File, Edit, Build, View, Analyze, Test, Help), floating tool rail, game-style build bar with hotkeys and counts, toasts.
- Test mode: waves (vessel.js motions on an animated sea), heel sweep with GZ, flooding animation to the damaged waterline, evacuation walk-through with moving people; live dials and traces.
- PDF report (jsPDF): summary with 3D snapshot, all flags with fixes, deck plans with flagged parts outlined and numbered, weights, GZ, damage cases, evacuation, sources.
- How to use tab (animated concept loop + interactive tour with spotlight and arrows, auto-starts on first visit) and Sources tab (method per rule, documents, "no AI used").
- Bug found by the browser test and fixed: room boxes swallowed pointer moves, so dragging across other rooms and previews over rooms did not work. Moves are now read at window level and intersected with the deck plane.
- Tests: 52 unit/physics tests, 14 browser checks (`npm run e2e`).

Done in session 3:
- Stair rule now follows the downloaded USCG PRG SOLAS-01 (quotes FSS Code 13.2.1.1): below 900 mm is red; 800 mm only for the Reg 13 dispensation case. Stair C (850 mm) in the demo is now red.
- UI redesign after the reference videos: neutral charcoal / off-white themes, dark-orange accent, crisp status colours without glow, thin monochrome icons that light up on hover, minimal right panel (rows, hairlines, underlined tabs), polygon wireframe sea with brighter crests, rooms assemble on load, map-style pins above flagged rooms, wipe/pop animations, drifting line fragments.
- Browser test now also takes dark, light, inspector and tour screenshots; a pin-blocks-drag bug it found is fixed (pins are visual only).

Done in session 4 (2026-11-06):
- Stair checks (ESCAPE-STAIR-WIDTH): the flights must fit in the stairwell box (length needed = rise per flight / tan 45 degrees; width needed = clear width, or 2 x clear width with 2+ flights per deck), and a stair needs a door on its top and bottom deck. Demo results unchanged. 3 new tests (55 total).
- Inspector stair section shows the climb, rise per flight, length and width needed versus actual, and people arriving versus passing per second.
- Dropdown lists use theme colours in both themes (were white with light text on Windows in dark mode).
- Build bar and tool rail: soft rounded tile in the tool colour on hover/active, icon fades slightly.
- Rules without a downloaded PDF (fire zone, fire walls, stability, lifeboats) now link to the online source page.

## To-do
### Docs and data
- [ ] Download the USCG stair PDF by hand (see THINGS_TO_ASK.txt)
- [ ] Get answers to Q1 to Q9 in THINGS_TO_ASK.txt and update rules.json

### Next
1. [ ] Resize handles in 3D (now via inspector numbers)
2. [ ] Rotate spaces by 90 degrees (stairs across the ship)
3. [ ] Wing (asymmetric) compartments and heel in damage cases
4. [ ] Analysis in a Web Worker for bigger designs (now about 250 ms for 116 spaces)
5. [ ] STEP / IGES import via an OpenCascade WebAssembly module (large download)
6. [ ] Optional: Claude explains a flag from `docs/` excerpts (verdict stays deterministic)
7. [ ] Code-split three.js and jsPDF to cut the bundle size
