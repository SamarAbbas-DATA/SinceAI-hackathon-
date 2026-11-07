// Prints the pipe and cable checks for every model ship (npx vite-node scripts/check-systems.ts).
import { MODELS } from "../src/data/ships";
import { analyze } from "../src/engine/analyze";

const IDS = ["PIPE-FIRE-MAIN", "PIPE-WATERTIGHT", "PIPE-FUEL-HOT", "CABLE-ROUTING"];
for (const m of MODELS) {
  const d = m.make();
  const a = analyze(d, { withCurves: false });
  console.log(`\n${m.label}: ${d.runs.length} runs, score ${a.score.score}, ${a.ms.toFixed(0)} ms`);
  for (const r of a.rules.filter((x) => IDS.includes(x.ruleId))) {
    console.log(`  ${r.status.padEnd(5)} ${r.ruleId}: ${r.summary}`);
    for (const f of r.findings) console.log(`        ${f.status} ${f.message}`);
  }
}
