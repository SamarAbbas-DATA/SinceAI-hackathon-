// Builds every model ship, runs the full analysis and prints timing, floating condition and rule results.
// Usage: npx vite-node scripts/check-ships.ts [modelId]
import { MODELS } from "../src/data/ships";
import { analyze } from "../src/engine/analyze";
const only = process.argv[2];
for (const m of MODELS.filter((x) => x.id !== "demo" && (!only || x.id === only))) {
  let t0 = performance.now();
  const d = m.make();
  const tb = performance.now() - t0;
  t0 = performance.now();
  const a = analyze(d);
  const ta = performance.now() - t0;
  const c = a.condition;
  console.log(`\n== ${m.label}: ${d.spaces.length} spaces, ${d.doors.length} doors, build ${tb.toFixed(0)} ms, analyze ${ta.toFixed(0)} ms (engine ${a.ms.toFixed(0)} ms)`);
  console.log(`   persons ${d.people.passengers}+${d.people.crew}  T ${c?.T.toFixed(2)}  trim ${c?.trim?.toFixed?.(2)}  GM ${c?.GMt.toFixed(2)}  KG ${c?.KG.toFixed(2)}  disp ${c?.weights.total.massT.toFixed(0)}  freeboard ${c?.freeboard.toFixed(2)} overloaded ${c?.overloaded}`);
  if (a.errors.length) console.log("   ERRORS", a.errors);
  for (const g of a.geometry.slice(0, 6)) console.log("   GEOM", g.status, g.message);
  if (a.geometry.length > 6) console.log(`   ... ${a.geometry.length} geometry issues`);
  if (process.env.FLOOD) for (const fc of a.flood?.cases ?? []) if (!fc.survives) console.log("   LOST", fc.name, fc.xAft.toFixed(0), fc.xFwd.toFixed(0), "T", fc.draft?.toFixed(2), "aft", fc.draftAft?.toFixed(2), "fwd", fc.draftFwd?.toFixed(2), fc.reason);
  for (const r of a.rules) {
    console.log(`   [${r.status.padEnd(5)}] ${r.ruleId.padEnd(20)} ${r.summary.slice(0, 150)}`);
    for (const f of r.findings.slice(0, 4)) console.log(`        - ${f.status}: ${f.message.slice(0, 140)}`);
    if (r.findings.length > 4) console.log(`        ... ${r.findings.length} findings`);
  }
}
