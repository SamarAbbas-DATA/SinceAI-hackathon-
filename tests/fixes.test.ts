// Fix with AI: every planned fix is verified against the whole analysis; the AI can only pick between them.
import { describe, it, expect } from "vitest";
import { demoDesign } from "../src/data/demoDesign";
import { MODELS } from "../src/data/ships";
import { analyze } from "../src/engine/analyze";
import { planFixes, applyActions, type ChooseRequest } from "../src/engine/fixes";

const reds = (a: ReturnType<typeof analyze>) => a.rules.reduce((n, r) => n + r.findings.filter((f) => f.status === "red").length, 0);

describe("fix planner on the demo ferry (no AI)", async () => {
  const start = demoDesign();
  const before = analyze(start, { withCurves: false });
  const plan = await planFixes(start);

  it("finds fixes and raises the score, never lowering it on the way", () => {
    expect(plan.steps.length).toBeGreaterThan(5);
    expect(plan.scoreAfter).toBeGreaterThan(plan.scoreBefore);
    let last = plan.scoreBefore;
    for (const s of plan.steps) {
      expect(s.scoreAfter, s.chosen.label).toBeGreaterThanOrEqual(last);
      last = s.scoreAfter;
    }
  });

  it("replaying the steps reproduces the planned result and removes every red flag it touched", () => {
    const d = demoDesign();
    for (const s of plan.steps) applyActions(d, s.chosen.actions);
    const after = analyze(d, { withCurves: false });
    expect(after.score.score).toBe(plan.scoreAfter);
    expect(reds(after)).toBeLessThan(reds(before));
    expect(after.geometry.filter((g) => g.status === "red")).toEqual([]);
  });

  it("fixes the deliberate problems of the demo with the expected changes", () => {
    const labels = plan.steps.map((s) => s.chosen.label).join("\n");
    expect(labels).toMatch(/Set the wall to A-30/);
    expect(labels).toMatch(/Widen Stair C to 900 mm/);
    expect(labels).toMatch(/Move the collision bulkhead to x 1\d\d\.\d m/);
    expect(labels).toMatch(/Straighten Feeder cable Deck 4/);
    expect(plan.skipped.every((s) => s.why.length > 10)).toBe(true); // every skipped flag says why
  });

  it("does not touch the start design", () => {
    expect(JSON.stringify(start)).toBe(JSON.stringify(demoDesign()));
  });
});

describe("AI choice", () => {
  it("uses the option the AI picks, and only among verified options", async () => {
    const asked: ChooseRequest[] = [];
    const plan = await planFixes(demoDesign(), {
      choose: async (req) => {
        asked.push(req);
        return { choice: req.options[req.options.length - 1].id, reason: "test pick" };
      },
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(4);
    const picked = plan.steps.filter((s) => s.byAI);
    expect(picked.length).toBe(asked.length);
    for (const s of picked) expect(s.byAI!.reason).toBe("test pick");
  });

  it("ignores an invalid AI answer and keeps the smallest change", async () => {
    const plain = await planFixes(demoDesign());
    const bad = await planFixes(demoDesign(), { choose: async () => ({ choice: "not-an-option", reason: "x" }) });
    expect(bad.steps.map((s) => s.chosen.label)).toEqual(plain.steps.map((s) => s.chosen.label));
    expect(bad.steps.some((s) => s.byAI)).toBe(false);
  });
});

describe("model ships", () => {
  it("plans quickly and never makes the clean model worse", async () => {
    const m = MODELS.find((x) => x.id === "ms7")!;
    const plan = await planFixes(m.make());
    expect(plan.ms).toBeLessThan(15000);
    expect(plan.scoreAfter).toBeGreaterThanOrEqual(plan.scoreBefore);
  });
});
