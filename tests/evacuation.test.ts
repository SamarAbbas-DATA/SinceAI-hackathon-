// Hand-checked case for the MSC.1/Circ.1533 Annex 2 simplified evacuation method.
import { describe, it, expect } from "vitest";
import { blankDesign } from "../src/data/demoDesign";
import { evacuate } from "../src/engine/evacuation";
import type { Design } from "../src/engine/types";

function scenario(stairWidthMm: number): Design {
  const d = blankDesign();
  d.decks = [
    { id: "A", name: "A", z: 6 },
    { id: "B", name: "B", z: 9 },
  ];
  // Deck A: corridor 20 x 2 m, 10 cabins of 4 persons, stair at the forward end
  d.spaces.push({ id: "corr", name: "corr", type: "corridor", deckId: "A", xCentre: 50, yCentre: 0, length: 20, breadth: 2, persons: 0 });
  for (let i = 0; i < 5; i++) {
    d.spaces.push({ id: `p${i}`, name: `p${i}`, type: "cabin", deckId: "A", xCentre: 42 + 4 * i, yCentre: 3, length: 4, breadth: 4, persons: 4 });
    d.spaces.push({ id: `s${i}`, name: `s${i}`, type: "cabin", deckId: "A", xCentre: 42 + 4 * i, yCentre: -3, length: 4, breadth: 4, persons: 4 });
    d.doors.push({ id: `dp${i}`, deckId: "A", x: 42 + 4 * i, y: 1, widthMm: 700 });
    d.doors.push({ id: `ds${i}`, deckId: "A", x: 42 + 4 * i, y: -1, widthMm: 700 });
  }
  d.spaces.push({ id: "st", name: "stair", type: "stairwell", deckId: "A", topDeckId: "B", xCentre: 62, yCentre: 0, length: 4, breadth: 2, persons: 0, stair: { widthMm: stairWidthMm, orientation: "fore-aft", handrailsBothSides: true, flightsPerDeck: 1 } });
  d.doors.push({ id: "dst", deckId: "A", x: 60, y: 0, widthMm: 900 });
  // Deck B: assembly station next to the stair
  d.spaces.push({ id: "ms", name: "muster", type: "muster_station", deckId: "B", xCentre: 68, yCentre: 0, length: 8, breadth: 6, persons: 0 });
  d.doors.push({ id: "dms", deckId: "B", x: 64, y: 0, widthMm: 1200 });
  d.people = { passengers: 40, crew: 0 };
  return d;
}

describe("Circ.1533 Annex 2 simplified evacuation", () => {
  const r = evacuate(scenario(1000), { mvz: 1 });

  it("runs and routes everyone", () => {
    expect(r.ok).toBe(true);
    expect(r.unreachable).toEqual([]);
    expect(r.persons).toBe(40);
  });

  it("initial density 1.0 p/m2 gives Fs and S by table 1.1 interpolation", () => {
    const route = r.routes[0];
    expect(r.routes.length).toBe(1);
    expect(route.density).toBeCloseTo(40 / 40, 6);
    const Fs = 0.65 + ((1.0 - 0.5) / (1.9 - 0.5)) * (1.3 - 0.65);
    expect(route.FcDeck).toBeCloseTo(Fs * 2, 6); // corridor clear width 2 m
  });

  it("stair going up is capped at 0.88 p/m/s and forms a queue", () => {
    const s = r.stairs[0];
    expect(s.up).toBe(true);
    expect(s.queue).toBe(true);
    expect(s.FsOut).toBeCloseTo(0.88, 6);
    expect(s.FcOut).toBeCloseTo(0.88, 6);
  });

  it("flow duration is the longest portion: 40 persons / 0.88 p/s on the stair", () => {
    expect(r.routes[0].tF).toBeCloseTo(40 / 0.88, 4);
  });

  it("stair travel uses table 1.3 speed after the transition (0.44 m/s at Fs 0.88)", () => {
    expect(r.routes[0].tStair).toBeCloseTo((3 * Math.SQRT2) / 0.44, 3);
  });

  it("performance standard 1.25(R+T) + 2/3(E+L) with T = (2 + 0.3) tI", () => {
    expect(r.T).toBeCloseTo(2.3 * r.tI, 6);
    expect(r.total).toBeCloseTo(1.25 * (600 + r.T) + (2 / 3) * 1800, 6);
    expect(r.limit).toBe(3600);
  });

  it("a wider stair removes the queue", () => {
    const w = evacuate(scenario(2500), { mvz: 1 });
    expect(w.stairs[0].queue).toBe(false);
    expect(w.total).toBeLessThan(r.total);
  });

  it("limit is 80 min with more than 3 main vertical zones", () => {
    expect(evacuate(scenario(1000), { mvz: 4 }).limit).toBe(4800);
    expect(evacuate(scenario(1000), { mvz: 3 }).limit).toBe(3600);
  });
});
