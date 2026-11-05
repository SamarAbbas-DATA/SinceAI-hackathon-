// Round trip through the vessel.js ship specification format (export -> import).
import { describe, it, expect } from "vitest";
import { demoDesign } from "../src/data/demoDesign";
import { exportVesselSpec, parseDesign, exportDesign } from "../src/engine/io";
import { createShip, hydroAt } from "../src/engine/vessel";

describe("file formats", () => {
  it("design JSON round trip is lossless", () => {
    const d = demoDesign();
    expect(parseDesign(exportDesign(d))).toEqual(d);
  });

  it("vessel.js export loads back with identical hull hydrostatics and all spaces", () => {
    const d = demoDesign();
    const back = parseDesign(exportVesselSpec(d));
    expect(back.hull.LOA).toBe(d.hull.LOA);
    expect(back.spaces.length).toBe(d.spaces.length);
    expect(back.decks.map((k) => k.z)).toEqual(d.decks.map((k) => k.z).sort((a, b) => a - b));
    const h1 = hydroAt(createShip(d), 5),
      h2 = hydroAt(createShip(back), 5);
    expect(h2.Vs).toBeCloseTo(h1.Vs, 6);
    expect(h2.KB).toBeCloseTo(h1.KB, 6);
    expect(h2.BMt).toBeCloseTo(h1.BMt, 6);
    // space types survive via the vessel.js affiliation group
    expect(back.spaces.find((s) => s.id === "engine")!.type).toBe("engine_room");
  });

  it("rejects unrelated JSON", () => {
    expect(() => parseDesign('{"hello": 1}')).toThrow();
  });
});
