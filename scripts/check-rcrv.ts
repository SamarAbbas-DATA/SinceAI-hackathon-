// Prints the RCRV analysis: draught, trim, GM and every red or amber finding. Usage: npx vite-node scripts/check-rcrv.ts [--calibrate GM]
import { rcrvDesign } from "../src/data/rcrv";
import { createShip, computeCondition } from "../src/engine/vessel";
import { analyze } from "../src/engine/analyze";
import { overlaps } from "../src/engine/topology";

const args = process.argv.slice(2);
const d = rcrvDesign();
if (args[0] === "--calibrate") {
  const gm = parseFloat(args[1] ?? "1.6");
  const ship = createShip(d);
  const ls = d.loading.lightshipOverride!;
  for (let it = 0; it < 60; it++) {
    const c = computeCondition(d, ship);
    const disp = c.weights.total.massT;
    ls.massT += (d.hull.designDraft - c.T) * c.hydro.TPC * 100;
    ls.lcg += ((c.hydro.LCB - c.LCG) * disp) / ls.massT;
    ls.kg += ((c.GMt - gm) * disp) / ls.massT;
  }
  console.log(`RCRV_LIGHTSHIP = { massT: ${Math.round(ls.massT)}, lcg: ${ls.lcg.toFixed(2)}, kg: ${ls.kg.toFixed(2)} }`);
}
const a = analyze(d);
const c = a.condition!;
console.log(`persons: ${d.people.passengers} science + ${d.people.crew} crew; spaces ${d.spaces.length}, doors ${d.doors.length}, runs ${d.runs.length}`);
console.log(`T ${c.T.toFixed(3)} trim ${c.trimByStern.toFixed(3)} GM ${c.GMt.toFixed(2)} disp ${c.weights.total.massT.toFixed(0)} t  score ${a.score.score}`);
console.log("overlaps", overlaps(d));
for (const r of a.rules) {
  console.log(`${r.status.padEnd(5)} ${r.ruleId}: ${r.summary}`);
  for (const f of r.findings.filter((f) => f.status === "red" || f.status === "amber").slice(0, 8)) console.log(`    ${f.status} ${f.message}`);
}
for (const g of a.geometry.filter((g) => g.status !== "green").slice(0, 12)) console.log(`geom ${g.status} ${g.message}`);
