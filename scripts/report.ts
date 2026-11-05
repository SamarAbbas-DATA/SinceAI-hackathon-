// Prints a full engineering report for a design file (or the built-in demo) to the terminal.
// Usage: npm run report                 (demo design)
//        npm run report -- my-ship.json (design saved from the app)
import fs from "node:fs";
import { demoDesign } from "../src/data/demoDesign";
import { analyze } from "../src/engine/analyze";
import type { Design } from "../src/engine/types";

const file = process.argv[2];
const design: Design = file ? JSON.parse(fs.readFileSync(file, "utf8")) : demoDesign();
const a = analyze(design);
const f = (v: number | undefined | null, d = 2) => (v === undefined || v === null || !Number.isFinite(v) ? "-" : v.toFixed(d));

console.log(`\n=== ${design.name} ===  (analysis ${a.ms.toFixed(0)} ms)`);
if (a.errors.length) console.log("ERRORS:", a.errors);
const c = a.condition!;
console.log(`\nMain dimensions: LOA ${design.hull.LOA} m, BOA ${design.hull.BOA} m, depth ${design.hull.depth} m, hull form "${design.hull.template}"`);
console.log("\nWeights:");
for (const w of c.weights.items) console.log(`  ${w.label.padEnd(42)} ${f(w.massT, 1).padStart(9)} t  LCG ${f(w.lcg)}  VCG ${f(w.vcg)}`);
console.log(`  ${"TOTAL".padEnd(42)} ${f(c.weights.total.massT, 1).padStart(9)} t  LCG ${f(c.LCG)}  KG ${f(c.KG)}`);
console.log(`\nFloating condition: T ${f(c.T, 3)} m, trim by stern ${f(c.trimByStern, 3)} m (aft ${f(c.draftAft)} / fwd ${f(c.draftFwd)}), freeboard ${f(c.freeboard)} m`);
console.log(`  KB ${f(c.hydro.KB)}  BMt ${f(c.hydro.BMt)}  KMt ${f(c.hydro.KMt)}  GMt ${f(c.GMt, 3)} m  GMl ${f(c.GMl, 1)} m`);
console.log(`  Cb ${f(c.hydro.Cb, 3)}  Cp ${f(c.hydro.Cp, 3)}  Cwp ${f(c.hydro.Cwp, 3)}  LWL ${f(c.hydro.LWL)}  BWL ${f(c.hydro.BWL)}  TPC ${f(c.hydro.TPC)} t/cm  MCT ${f(c.hydro.MCT, 1)} t.m/cm`);
if (a.gz) console.log(`\nGZ: max ${f(a.gz.maxGZ, 3)} m at ${a.gz.angleMaxGZ} deg, range ${f(a.gz.rangeDeg, 1)} deg, areas 0-30 ${f(a.gz.area0_30, 3)}, 0-40 ${f(a.gz.area0_40, 3)}, 30-40 ${f(a.gz.area30_40, 3)} m.rad`);
if (a.resistance.length) {
  const p = a.resistance.reduce((b, r) => (Math.abs(r.speedKn - design.hull.designSpeedKn) < Math.abs(b.speedKn - design.hull.designSpeedKn) ? r : b));
  console.log(`\nResistance (Holtrop, vessel.js) at ${f(p.speedKn, 1)} kn: ${f(p.resistanceKN, 0)} kN, Pe ${f(p.effectivePowerKW, 0)} kW, Fn ${f(p.froude, 3)}`);
  if (a.holtropWarnings.length) console.log("  Validity warnings:", a.holtropWarnings.join("; "));
}
if (a.evac?.ok) {
  const e = a.evac;
  console.log(`\nEvacuation (Circ.1533 Annex 2): persons ${e.persons}, tI ${f(e.tI / 60)} min, T ${f(e.T / 60)} min, total ${f(e.total / 60)} min vs n ${f(e.limit / 60, 0)} min`);
  for (const s of e.stairs) console.log(`  ${s.stairId}: ${s.persons} persons, Fc in ${f(s.FcIn)} p/s, out ${f(s.FcOut)} p/s${s.queue ? " (queue)" : ""}`);
}
if (a.flood?.ok) {
  console.log(`\nFlooding (simplified): A ${f(a.flood.A, 3)} vs R ${f(a.flood.R, 3)} (N ${a.flood.N})`);
  for (const k of a.flood.cases) console.log(`  ${k.compartments.join("+").padEnd(7)} x ${f(k.xAft, 1)}-${f(k.xFwd, 1)}  p ${f(k.p, 3)}  ${k.survives ? "survives" : "LOST    "}  T ${f(k.draft)}  GM ${f(k.GMd)}  ${k.reason}`);
}
console.log(`\nRules (score ${a.score.score} over ${a.score.counted} active rules):`);
for (const r of a.rules) {
  console.log(`  [${r.status.toUpperCase().padEnd(5)}] ${r.ruleId.padEnd(20)} ${r.summary}`);
  for (const x of r.findings.slice(0, 6)) {
    console.log(`           - ${x.status}: ${x.message}`);
    if (x.fix) console.log(`             fix: ${x.fix}`);
  }
  if (r.findings.length > 6) console.log(`           ... ${r.findings.length - 6} more`);
}
if (a.geometry.length) {
  console.log("\nGeometry:");
  for (const g of a.geometry) console.log(`  ${g.status}: ${g.message}`);
}
console.log("\nEarly pre-check only. Not an official approval.\n");
