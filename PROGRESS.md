# Progress

## Status (2026-11-07)
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

Done in session 5 (2026-11-07):
- New sources in docs/Sources reviewed: NOAA SWATH research ship design report (1990) and general arrangement drawings of G.O. Sars, GA 23007 and GA2017117 (60 m fishery research vessel). They are reference ships, not rules; only implementable parts were taken.
- New rule WEIGHT-MARGIN (NOAA Tables 1 and 8): design and build margin 6.8 % plus service life margin 4.5 % of lightship added at the lightship KG; draft solved again (grownCondition in vessel.ts, analytic box test); freeboard and GM checked.
- New rule REFERENCE-SHIPS (amber hints): cabin area per person (7.5 m2), deck-to-deck height (2.5 m), escape routes through rooms (NOAA 2.4.2).
- ESCAPE-STAIR-WIDTH: emergency doors into a stair at least as wide as the stair (REG13 guidance G5.1, amber). Demo now shows this for Stairs A and B.
- Emergency doors: renamed in the UI, drawn thicker with a screen-size exit icon on the active deck, door tool snaps to the nearest wall between two rooms (3 m), green/amber preview, refuses duplicates, width = stair width into stairs (emergencyDoorWidth), door inspector "Set to stair width".
- App always starts from the default demo ferry; File > Restore last session brings back the previous browser session.
- Rooms whose centre is outside the hull (in the water) are refused when placing, stamping, dragging, typing coordinates or duplicating (centreOutsideHull).
- Tests: 63 unit/physics, 17 browser checks.

Done in session 6 (2026-11-07, branch samar-version):
- Interactive tour opens on every start (not only the first visit); every step has "Skip tour" (Esc also closes it).
- Emergency door icons are hidden by default. New view toggle "Emergency door icons" (tool rail and View menu) shows them and brightens the doors; they also show on the active deck while the door tool is on, and on the selected door.
- Hover/active tiles on the tool rail and build bar are stronger (same colours, more opacity).
- Demo ferry shows 5 reference-ship hints (REFERENCE-SHIPS, from docs/Sources; rule logic unchanged, only the demo design): two Deck 4 family cabins sleep 3 in 16 m2 (5.3 m2 per person, GA 23007 gives 7.5); an open Deck 6 sun deck only 2.3 m above Deck 5 (G.O. Sars smallest 2.5 m); and on Decks 2, 3 and 4 a small room aft of Stair B (crew store, laundry, pantry) with a connecting door to cabin S52, whose escape route runs through it (NOAA 2.4.2). Each cabin keeps a corridor door in its far corner (5 m from the connecting door). Side effects: three amber "exits only 2.2 m apart" flags for those small rooms; Deck 6 adds deck steel, so GM 5.51 to 4.99 m and freeboard 3.52 to 3.33 m (all stability and flooding checks still pass). WEIGHT-MARGIN stays green: forcing it would need several thousand tonnes and break the other showcase results. Score 60. The rule card "Open PDF" link opens the matching file in docs/Sources.
- Escape route tool (bottom bar, hotkey E, also Build menu): click a room; missing emergency doors to its neighbouring corridors / stairwells are added (autoDoors), escape routes are switched on, the room is selected and its route to an assembly station is drawn in red with a message (length, stairs, assembly station). Rooms with no persons get their route drawn too. Uses the same graph and shortestRoute as the checks; no rule changed.
- Tests: 64 unit/physics, 19 browser checks (flooding animation wait raised from 7.5 to 9 s: it was flaky on slow headless runs).

Done in session 7 (2026-11-07, branch samar-version):
- Model ships: picker at the top right of the 3D view (replaces the design name in the header) with the demo ferry, Icon of the Seas (2023), Star of the Seas (2025), Legend of the Seas (2026) and Mein Schiff 7 (2024). Built by a parametric generator in src/data/ships.ts from published main data (sources in the file and THINGS_TO_ASK Q12). Checks: Icon class only red on fire zone width (real 48.47 m beam vs the 40 m rule, kept on purpose), Mein Schiff 7 all green; both have amber stair-queue hints. scripts/check-ships.ts prints every model's results; scripts/calibrate-ships.ts recalibrates lightship/KG.
- Switching models keeps each model's edits and undo history in memory (no download, no prompt); the browser asks before reload/close when any model has edits.
- Deck bar shows compact numbers when a ship has more than 8 decks; 3D view frames the chosen ship (camera presets scale with length above 120 m; the demo view is unchanged).
- Interactive tour has a "Model ships" step with an image (public/tour/model-ships.svg, replace with a screenshot of the same name if wanted).
- Speed: connections() caches spaces per deck and disjointRoutes() uses a reverse-name array instead of scanning its id map (same results). Icon-class analysis about 0.4 s (was 1.2 s); demo faster too.
- Tests: 84 unit/physics (tests/ships.test.ts new), 23 browser checks.

Done in session 8 (2026-11-07, branch samar-version):
- Sources on every flag: rules.json has "refs" per rule (document, clause, exact quote, PDF page; "match" picks the clause for a finding by its text) and a short name and local file per source. runRules attaches the clause to each finding (no check logic changed). Issues: "Source" line with Open links under every rule summary (visible when closed), and under every finding the clause, page, quote and "Open p. N" (local PDF opened at that page, or the online source). PDF report prints the source per flag. tests/sources.test.ts checks every finding on every model has a clause and every page points to an existing PDF.
- "+ Add emergency doors" under every flag that names rooms: autoDoors on each flagged room (undoable), message when nothing can be added.
- Hull livery for the model ships (src/ui/three/livery.ts): outer shell = hull body to the moulded depth plus one tier per deck as long as its rooms, cut at the active deck when decks above are hidden. Painted canvases per side (text reads correctly on both): Royal Caribbean white with navy crown and anchor near the stern and the ship name at the bow in EB Garamond (closest free match to Galliard); Mein Schiff navy hull, red boot-top, white sweep line and white script logo; window/balcony bands per deck use; lifeboats painted on. Opaque from 0.9 L camera distance, gone below 0.6 L, eased fade; never blocks clicks. Model ships open on their top deck so the whole painted hull shows. Logo files in public/liveries (made from reference_images/logo_reference).
- Livery fixes: superstructure tiers continue towards the bow with a raked front (0.7 m back per metre of height) and the lower tiers reach the transom, so the ship no longer looks cut off; the wireframe hull and the deck plates cross-fade out while the painted shell is shown (they caused dark wedges); scene fog scales with ship length above 120 m (demo unchanged) and the painted shell is not fogged, so long ships stay bright end to end; tier tops are self-lit.
- Meyer Turku logo in the header (public/brand/meyer-turku.png, inverted on the dark theme).
- Browser test prints browser console errors; new checks for livery fade and sources. Tests: 91 unit/physics, 25 browser checks.

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
