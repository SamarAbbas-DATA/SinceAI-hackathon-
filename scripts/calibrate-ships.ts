// Finds the lightship weight, LCG and KG that make each model ship float at its published draught,
// level, with a chosen GM, and reports the stability verdicts. Paste the result into src/data/ships.ts.
// Usage: npx vite-node scripts/calibrate-ships.ts <modelId> <targetGM> [<targetGM> ...]
import { MODELS } from "../src/data/ships";
import { createShip, computeCondition } from "../src/engine/vessel";
import { analyze } from "../src/engine/analyze";
const [id, ...gms] = process.argv.slice(2);
const m = MODELS.find((x) => x.id === id)!;
for (const gmArg of gms.length ? gms : ["5"]) {
  const d = m.make();
  const ship = createShip(d);
  const T0 = d.hull.designDraft;
  const gmTarget = parseFloat(gmArg);
  const ls = d.loading.lightshipOverride!;
  for (let it = 0; it < 40; it++) {
    const c = computeCondition(d, ship);
    const disp = c.weights.total.massT;
    ls.massT += (T0 - c.T) * c.hydro.TPC * 100;
    ls.lcg += ((c.hydro.LCB - c.LCG) * disp) / ls.massT;
    ls.kg += ((c.GMt - gmTarget) * disp) / ls.massT;
    if (Math.abs(c.T - T0) < 0.005 && Math.abs(c.trimByStern) < 0.02 && Math.abs(c.GMt - gmTarget) < 0.02) break;
  }
  const a = analyze(d);
  const c = a.condition!;
  const st = (rid: string) => a.rules.find((r) => r.ruleId === rid)!;
  console.log(`${m.label} GM ${gmTarget}: { massT: ${Math.round(ls.massT)}, lcg: ${ls.lcg.toFixed(2)}, kg: ${ls.kg.toFixed(2)} } T ${c.T.toFixed(3)} trim ${c.trimByStern.toFixed(3)} | INTACT ${st("INTACT-STABILITY").status} (${st("INTACT-STABILITY").summary}) | MARGIN ${st("WEIGHT-MARGIN").status} | FLOOD ${st("FLOOD-SURVIVAL").status}`);
}
