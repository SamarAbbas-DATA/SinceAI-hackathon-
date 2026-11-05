# Vendored vessel.js

- Source: https://github.com/shiplab/vesseljs, file `build/vessel.module.js`
- Commit: 0ae1a063e0031e231542ae84f682d9e2787395a9
- License: MIT (see LICENSE.md in this folder)

## Local patches
Each patch is marked in the code with `[sincai patch]`.

1. `ShipState.getObjectState`: removed two `console.log` calls that fire on every weight lookup. They flooded the console and slowed live analysis.
2. `Ship.calculateStability`: removed a stray `console.log( trimd )`.

No calculation logic was changed.

## Known vessel.js bug (worked around, not patched)
`Hull.waterlineCalculation(z, { minX, maxX })` crashes when `minX` equals the first station (x = 0) and `maxX` is inside the hull, because the station array is sliced off by one. `boundedWaterline()` in `src/engine/vessel.ts` nudges `minX` by 1 micrometre so vessel.js takes its correct branch. `tests/physics.test.ts` covers this with an aft-end compartment. Hull integration, draft solver, weights, Holtrop resistance and wave motion are used exactly as published.

## Hull templates
`src/data/hullTemplates.json` holds the offset tables (`halfBreadths`) and hull attributes copied from vessel.js `examples/ship_specs/` (Cruise.json, gunnerus.json, PX121.json, prismaticHull.json). The tables are non-dimensional, so the app scales them to any LOA, BOA and Depth.
