# Hull Workshop

Design a hull, check it, print it, test it in water. Separate app from the main pre-check (repo root).

    npm install
    npm run dev        # http://localhost:5173
    npm test           # physics (analytic box barge), hull watertightness, exporters, CAD kernel STEP round trip
    npm run build && npm run e2e   # headless Chrome: renders, STEP in the browser, all downloads, re-import

Netlify: add a second site from this repo with Base directory = `cad_version` (netlify.toml is here).

## What it does
- Parametric hull (full-scale metres, printed at a chosen model length). Same sections feed the mesh and the CAD loft.
- Exact hydrostatics on any closed mesh (`src/core/hydro.ts`): draft, trim, KB, BM, GM, GZ curve, IMO IS Code 2008 2.2 criteria at full scale.
- Print model (`src/core/print.ts`): printed mass from shell + infill, cost, bed fit with diagonal placement, overhang/support check.
- Import STEP, STL, OBJ, 3MF; same checks.
- Export: STEP (OpenCascade via replicad, in a web worker), 3MF and STL print-ready (oriented, rotated to fit, centred on the bed), OBJ, GLB, text report.
- Water test: weighed print mass replaces the estimate; measured drafts and an inclining test (measured GM) against the prediction.

Thresholds live in `src/core/limits.ts`. Early pre-check, not an official approval.
