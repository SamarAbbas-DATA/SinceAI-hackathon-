// Every flag names the document behind it: local PDF with page number, or the online source.
import { describe, it, expect } from "vitest";
import { MODELS } from "../src/data/ships";
import { analyze } from "../src/engine/analyze";
import { RULES, ruleRefs, refForFinding } from "../src/engine/rules";

// the downloaded documents, as paths relative to the project root
const PDFS = new Set(Object.keys(import.meta.glob("../docs/**/*.pdf")).map((k) => k.replace(/^\.\.\//, "")));

describe("source references", () => {
  it("every rule has at least one reference, and local ones point to an existing PDF page", () => {
    for (const r of RULES.rules as { id: string }[]) {
      const refs = ruleRefs(r.id);
      expect(refs.length, r.id).toBeGreaterThan(0);
      for (const x of refs) {
        expect(x.file || x.url, `${r.id} ${x.id}`).toBeTruthy();
        if (x.page) expect(PDFS.has(x.file!), x.file).toBe(true);
      }
    }
  });

  it.each(MODELS.map((m) => [m.label, m]))("every finding on %s carries its clause", (_, m) => {
    const a = analyze(m.make(), { withCurves: false });
    for (const r of a.rules) for (const f of r.findings) expect(f.ref, `${r.ruleId}: ${f.message}`).toBeTruthy();
  });

  it("picks the clause that matches the finding", () => {
    const ref = (id: string, message: string) => refForFinding(id, { status: "red", message, targets: [] })!;
    expect(ref("ESCAPE-TWO-EXITS", "D3 corridor has a 12.0 m dead end.").page).toBe(4);
    expect(ref("ESCAPE-STAIR-WIDTH", "Stair C is 850 mm wide; escape stairs must be at least 900 mm.").clause).toMatch(/13\.2\.1\.1/);
    expect(ref("ESCAPE-STAIR-WIDTH", "4 emergency doors into Stair A are 900 mm wide, narrower than the 1200 mm stair.").clause).toMatch(/G5\.1/);
    expect(ref("EVACUATION-TIME", "Queue at Stair B: people arrive at 3.5 persons/s").page).toBe(4);
    expect(ref("REFERENCE-SHIPS", "The escape route from D2 cabin S52 leads through D2 crew store.").quote).toMatch(/general passageways/);
  });
});
