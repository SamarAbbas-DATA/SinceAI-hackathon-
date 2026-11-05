// Adapter between our Design model and the vendored vessel.js library.
// Everything naval-architectural (hull integration, weights, draft solving, resistance, motions)
// is computed by vessel.js; this file only builds its specification and reads results back.
import templatesJson from "../data/hullTemplates.json";
import { Ship, WaveCreator, WaveMotion, HullResistance, f } from "../vendor/vessel/vessel.module.js";
import type { Design, Space, SpaceType, PointMass } from "./types";

export const RHO = 1025; // sea water kg/m3
export const G = 9.81;

export interface HullTemplate {
  label: string;
  reference: { LOA: number; BOA: number; Depth: number };
  attributes: Record<string, unknown>;
  halfBreadths: { stations: number[]; waterlines: number[]; table: (number | null)[][] };
}
export const HULL_TEMPLATES = templatesJson as unknown as Record<string, HullTemplate>;

// Outfit (non-structural lightweight) per deck area. Typical early-design values; editable per space.
export const OUTFIT_KG_PER_M2: Record<SpaceType, number> = {
  cabin: 180,
  corridor: 90,
  stairwell: 160,
  lift: 300,
  public: 150,
  galley: 350,
  engine_room: 900,
  store: 300,
  muster_station: 60,
  tank: 40,
  void: 0,
  other: 150,
};
// Equivalent steel plate thickness (plate + stiffeners) for decks and bulkheads.
export const DECK_EQUIV_THICKNESS = 0.014;
export const BULKHEAD_EQUIV_THICKNESS = 0.012;
export const STEEL_DENSITY = 7850;
/** Liquid densities in kg/m3. */
export const LIQUID_DENSITY: Record<string, number> = { fuel: 850, fresh_water: 1000, ballast: 1025, empty: 0 };
/** Share of a tank's box volume that holds liquid (the rest is structure). */
export const TANK_STRUCTURE_FACTOR = 0.98;
export const TOP_DECK_HEIGHT = 2.8;

export function sortedDecks(design: Design) {
  return [...design.decks].sort((a, b) => a.z - b.z);
}

export function deckHeight(design: Design, deckId: string): number {
  const decks = sortedDecks(design);
  const i = decks.findIndex((d) => d.id === deckId);
  if (i < 0) return TOP_DECK_HEIGHT;
  return i < decks.length - 1 ? decks[i + 1].z - decks[i].z : TOP_DECK_HEIGHT;
}

/** Decks a space occupies (a stairwell or lift can span several). */
export function spaceDeckIds(design: Design, s: Space): string[] {
  const decks = sortedDecks(design);
  const i0 = decks.findIndex((d) => d.id === s.deckId);
  if (i0 < 0) return [];
  const i1 = s.topDeckId ? decks.findIndex((d) => d.id === s.topDeckId) : i0;
  const lo = Math.min(i0, i1 < 0 ? i0 : i1);
  const hi = Math.max(i0, i1 < 0 ? i0 : i1);
  return decks.slice(lo, hi + 1).map((d) => d.id);
}

export function spaceVertical(design: Design, s: Space): { zBase: number; height: number } {
  const ids = spaceDeckIds(design, s);
  const decks = new Map(design.decks.map((d) => [d.id, d]));
  const bottom = decks.get(ids[0]);
  const top = decks.get(ids[ids.length - 1]);
  if (!bottom || !top) return { zBase: 0, height: TOP_DECK_HEIGHT };
  return { zBase: bottom.z, height: top.z + deckHeight(design, top.id) - bottom.z };
}

export function buildHullSpec(design: Design) {
  const t = design.hull.custom ?? HULL_TEMPLATES[design.hull.template] ?? HULL_TEMPLATES.cruise;
  return {
    attributes: {
      ...structuredClone(t.attributes),
      LOA: design.hull.LOA,
      BOA: design.hull.BOA,
      Depth: design.hull.depth,
    },
    halfBreadths: structuredClone(t.halfBreadths),
    style: {},
  };
}

/** Builds a complete vessel.js ship specification (JSON) from the design. */
export function buildShipSpec(design: Design) {
  const { LOA, BOA } = design.hull;
  const decks: Record<string, unknown> = {};
  for (const d of design.decks) {
    decks[d.id] = {
      zFloor: d.z,
      thickness: DECK_EQUIV_THICKNESS,
      xAft: 0,
      xFwd: LOA,
      yCentre: 0,
      breadth: BOA,
      density: STEEL_DENSITY,
    };
  }
  const bulkheads: Record<string, unknown> = {};
  for (const b of design.bulkheads) {
    bulkheads[b.id] = { xAft: b.x, thickness: BULKHEAD_EQUIV_THICKNESS, density: STEEL_DENSITY };
  }
  const baseObjects: unknown[] = [];
  const derivedObjects: unknown[] = [];
  for (const s of design.spaces) {
    const { zBase, height } = spaceVertical(design, s);
    const area = s.length * s.breadth;
    const outfit = s.outfitKgPerM2 ?? OUTFIT_KG_PER_M2[s.type];
    const tank = s.type === "tank" ? (s.tank ?? { content: "empty", fillPct: 0 }) : null;
    // vessel.js "content": tanks hold liquid (density x volume x fullness), other spaces hold persons
    const content = tank
      ? { contentDensity: LIQUID_DENSITY[tank.content], volumeCapacity: area * height * TANK_STRUCTURE_FACTOR, fullness: clamp(tank.fillPct, 0, 100) / 100 }
      : { contentDensity: design.loading.personMassKg, volumeCapacity: s.persons, fullness: 1 };
    baseObjects.push({
      id: `bo_${s.id}`,
      affiliations: { group: s.type },
      boxDimensions: { length: s.length, breadth: s.breadth, height },
      weightInformation: {
        lightweight: area * outfit,
        contentDensity: content.contentDensity,
        volumeCapacity: content.volumeCapacity,
        // tank contents settle at the bottom: cg at half the filled height
        cg: [0, 0, tank ? Math.max(0.05, (height * content.fullness) / 2) : Math.min(1.0, height / 2)],
      },
      baseState: { fullness: content.fullness },
      file3D: "",
    });
    derivedObjects.push({
      id: s.id,
      baseObject: `bo_${s.id}`,
      affiliations: { group: s.type, Deck: s.deckId },
      referenceState: { xCentre: s.xCentre, yCentre: s.yCentre, zBase },
      style: {},
    });
  }
  const deckZ = new Map(design.decks.map((d) => [d.id, d.z]));
  for (const l of design.lsa ?? []) {
    baseObjects.push({ id: `bo_${l.id}`, affiliations: { group: "lsa" }, boxDimensions: { length: 8, breadth: 3, height: 3 }, weightInformation: { lightweight: l.massT * 1000, cg: [0, 0, 1.5] }, baseState: { fullness: 0 } });
    derivedObjects.push({ id: l.id, baseObject: `bo_${l.id}`, affiliations: { group: "lsa" }, referenceState: { xCentre: l.x, yCentre: l.y, zBase: deckZ.get(l.deckId) ?? 0 } });
  }
  const dw = design.loading.deadweight;
  if (dw.massT > 0) {
    baseObjects.push({
      id: "bo_deadweight",
      affiliations: { group: "deadweight" },
      boxDimensions: { length: 1, breadth: 1, height: 1 },
      weightInformation: { lightweight: dw.massT * 1000, cg: [0, 0, 0] },
      baseState: { fullness: 0 },
    });
    derivedObjects.push({
      id: "deadweight",
      baseObject: "bo_deadweight",
      affiliations: { group: "deadweight" },
      referenceState: { xCentre: dw.lcg, yCentre: 0, zBase: dw.kg },
    });
  }
  return {
    attributes: { name: design.name },
    structure: { hull: buildHullSpec(design), decks, bulkheads },
    baseObjects,
    derivedObjects,
    designState: {
      calculationParameters: {
        LWL_design: LOA,
        Draft_design: design.hull.designDraft,
        Cb_design: 0.65,
        speed: design.hull.designSpeedKn,
        K: design.hull.parsonsK,
      },
      objectOverrides: { common: {}, baseByID: {}, derivedByGroup: {}, derivedByID: {} },
    },
  };
}

export function createShip(design: Design): Ship {
  const ship = new Ship(buildShipSpec(design));
  // vessel.js' Parsons hull weight needs LWL and Cb at the design draft; take them from its own hydrostatics.
  const T = clamp(design.hull.designDraft, 0.05 * design.hull.depth, design.hull.depth);
  const a = ship.structure.hull.calculateAttributesAtDraft(T);
  const cp = ship.designState.calculationParameters;
  cp.LWL_design = a.LWL;
  cp.Cb_design = a.Cb;
  return ship;
}

export interface WeightItem {
  label: string;
  massT: number;
  lcg: number;
  tcg: number;
  vcg: number;
}

export interface WeightBreakdown {
  items: WeightItem[];
  lightship: PointMass & { tcg: number; estimated: boolean };
  total: { massT: number; lcg: number; tcg: number; kg: number };
}

function toItem(label: string, w: { mass: number; cg: { x: number; y: number; z: number } }): WeightItem {
  return { label, massT: w.mass / 1000, lcg: w.cg.x, tcg: w.cg.y, vcg: w.cg.z };
}

function combine(items: { massT: number; lcg: number; tcg: number; vcg: number }[]) {
  const m = items.reduce((s, i) => s + i.massT, 0);
  if (m <= 0) return { massT: 0, lcg: 0, tcg: 0, kg: 0 };
  return {
    massT: m,
    lcg: items.reduce((s, i) => s + i.massT * i.lcg, 0) / m,
    tcg: items.reduce((s, i) => s + i.massT * i.tcg, 0) / m,
    kg: items.reduce((s, i) => s + i.massT * i.vcg, 0) / m,
  };
}

export function computeWeights(design: Design, ship: Ship): WeightBreakdown {
  const state = ship.designState;
  const hull = toItem("Hull steel (vessel.js Parsons estimate)", ship.structure.hull.getWeight(state));
  const struct = ship.structure.getWeight(state);
  const structOnly = struct.mass - hull.massT * 1000;
  const decksBhd: WeightItem = {
    label: "Decks and bulkheads (vessel.js structure)",
    massT: structOnly / 1000,
    lcg: structOnly > 0 ? (struct.cg.x * struct.mass - hull.lcg * hull.massT * 1000) / structOnly : 0,
    tcg: 0,
    vcg: structOnly > 0 ? (struct.cg.z * struct.mass - hull.vcg * hull.massT * 1000) / structOnly : 0,
  };
  type Acc = { mass: number; mx: number; my: number; mz: number };
  const acc = (): Acc => ({ mass: 0, mx: 0, my: 0, mz: 0 });
  const addTo = (a: Acc, m: number, x: number, y: number, z: number) => {
    a.mass += m;
    a.mx += m * x;
    a.my += m * y;
    a.mz += m * z;
  };
  const toW = (label: string, a: Acc): WeightItem => ({
    label,
    massT: a.mass / 1000,
    lcg: a.mass ? a.mx / a.mass : 0,
    tcg: a.mass ? a.my / a.mass : 0,
    vcg: a.mass ? a.mz / a.mass : 0,
  });
  const outfit = acc(),
    persons = acc(),
    liquids = acc(),
    lsa = acc();
  for (const s of design.spaces) {
    const o = ship.derivedObjects[s.id];
    if (!o) continue;
    const st = state.getObjectState(o);
    const wi = o.baseObject.weightInformation;
    const [cx, cy, cz] = wi.cg;
    const x = st.xCentre + cx,
      y = st.yCentre + cy,
      z = st.zBase + cz;
    addTo(outfit, wi.lightweight, x, y, z);
    const content = (wi.contentDensity || 0) * (wi.volumeCapacity || 0) * (st.fullness ?? 1);
    addTo(s.type === "tank" ? liquids : persons, content, x, y, z);
  }
  for (const l of design.lsa ?? []) {
    const o = ship.derivedObjects[l.id];
    if (!o) continue;
    const w = o.getWeight(state);
    addTo(lsa, w.mass, w.cg.x, w.cg.y, w.cg.z);
  }
  const outfitItem = toW("Outfit of spaces (area x load)", outfit);
  const personsItem = toW("Persons and effects", persons);
  const liquidItem = toW("Tank contents", liquids);
  const lsaItem = toW("Lifeboats and liferafts", lsa);
  const dw = design.loading.deadweight;
  const dwItem: WeightItem = { label: "Other deadweight (stores, provisions)", massT: dw.massT, lcg: dw.lcg, tcg: 0, vcg: dw.kg };

  const ov = design.loading.lightshipOverride;
  let lightshipItems: WeightItem[];
  let lightship: WeightBreakdown["lightship"];
  if (ov) {
    lightshipItems = [{ label: "Lightship (user value)", massT: ov.massT, lcg: ov.lcg, tcg: 0, vcg: ov.kg }];
    lightship = { ...ov, tcg: 0, estimated: false };
  } else {
    lightshipItems = [hull, decksBhd, outfitItem, lsaItem];
    const c = combine(lightshipItems);
    lightship = { massT: c.massT, lcg: c.lcg, kg: c.kg, tcg: c.tcg, estimated: true };
  }
  const items = [...lightshipItems, personsItem, liquidItem, dwItem].filter((i) => i.massT > 0);
  return { items, lightship, total: combine(items) };
}

export interface Hydro {
  T: number;
  dispT: number;
  Vs: number;
  LCB: number;
  KB: number;
  BMt: number;
  BMl: number;
  KMt: number;
  LCF: number;
  Awp: number;
  TPC: number;
  MCT: number;
  Cb: number;
  Cp: number;
  Cwp: number;
  Cm: number;
  LWL: number;
  BWL: number;
  wettedArea: number;
  minXs: number;
  maxXs: number;
}

export function hydroAt(ship: Ship, T: number): Hydro {
  const a = ship.structure.hull.calculateAttributesAtDraft(T);
  const dispT = (a.Vs * RHO) / 1000;
  return {
    T,
    dispT,
    Vs: a.Vs,
    LCB: a.LCB,
    KB: a.KB,
    BMt: a.BMt,
    BMl: a.BMl,
    KMt: a.KB + a.BMt,
    LCF: a.LCF,
    Awp: a.Awp,
    TPC: (a.Awp * RHO) / 100 / 1000,
    MCT: (dispT * a.BMl) / (100 * (a.LWL || 1)),
    Cb: a.Cb,
    Cp: a.Cp,
    Cwp: a.Cwp,
    Cm: a.Cm,
    LWL: a.LWL,
    BWL: a.BWL,
    wettedArea: a.As,
    minXs: a.minXs,
    maxXs: a.maxXs,
  };
}

export function hydrostaticTable(ship: Ship, depth: number, steps = 12): Hydro[] {
  const rows: Hydro[] = [];
  for (let i = 1; i <= steps; i++) rows.push(hydroAt(ship, (depth * i) / steps));
  return rows;
}

export interface Condition {
  weights: WeightBreakdown;
  hydro: Hydro;
  T: number;
  KG: number; // includes the free-surface correction
  KGsolid: number;
  FSC: number; // free-surface correction (m) = sum of free-surface moments / displacement
  freeSurface: { spaceId: string; fsm: number }[]; // t.m per slack tank
  LCG: number;
  TCG: number;
  GMt: number;
  GMl: number;
  trimByStern: number; // m, positive = stern deeper
  draftAft: number;
  draftFwd: number;
  heelDeg: number;
  freeboard: number;
  overloaded: boolean; // displacement exceeds the hull volume up to depth
}

/** Free-surface moment (t.m) of every slack tank: rho_liquid * l * b^3 / 12. Full (>= 98 %) or empty tanks have none. */
export function freeSurfaceMoments(design: Design): { spaceId: string; fsm: number }[] {
  const out: { spaceId: string; fsm: number }[] = [];
  for (const s of design.spaces) {
    if (s.type !== "tank" || !s.tank) continue;
    const rho = LIQUID_DENSITY[s.tank.content] / 1000;
    if (rho <= 0 || s.tank.fillPct <= 0 || s.tank.fillPct >= 98) continue;
    out.push({ spaceId: s.id, fsm: (rho * s.length * s.breadth ** 3) / 12 });
  }
  return out;
}

export function computeCondition(design: Design, ship: Ship): Condition {
  const weights = computeWeights(design, ship);
  const M = weights.total.massT * 1000;
  const hull = ship.structure.hull;
  const depth = design.hull.depth;
  const Vdepth = hull.calculateAttributesAtDraft(depth).Vs;
  const overloaded = M / RHO > Vdepth;
  const T = overloaded ? depth : hull.calculateDraftAtMass(M, 0.0005, RHO);
  const hydro = hydroAt(ship, T);
  // Free-surface correction for slack tanks (rectangular tank: i = l b^3 / 12)
  const freeSurface = freeSurfaceMoments(design);
  const fsmTotal = freeSurface.reduce((s, x) => s + x.fsm, 0);
  const KGsolid = weights.total.kg;
  const FSC = weights.total.massT > 0 ? fsmTotal / weights.total.massT : 0;
  const KG = KGsolid + FSC; // "fluid" KG, used for every stability result
  const GMt = hydro.KB + hydro.BMt - KG;
  const GMl = hydro.KB + hydro.BMl - KG;
  const t = GMl !== 0 ? (hydro.LCB - weights.total.lcg) / GMl : 0; // tan(trim angle), positive = by stern
  const draftAft = T + (hydro.LCF - hydro.minXs) * t;
  const draftFwd = T + (hydro.LCF - hydro.maxXs) * t;
  const heelDeg = GMt > 0 ? (Math.atan(weights.total.tcg / GMt) * 180) / Math.PI : NaN;
  return {
    weights,
    hydro,
    T,
    KG,
    KGsolid,
    FSC,
    freeSurface,
    LCG: weights.total.lcg,
    TCG: weights.total.tcg,
    GMt,
    GMl,
    trimByStern: draftAft - draftFwd,
    draftAft,
    draftFwd,
    heelDeg,
    freeboard: depth - Math.max(draftAft, draftFwd),
    overloaded,
  };
}

/** vessel.js StateModules read a "states.discrete" container. We fill it from our condition. */
function statesFor(c: Condition, speedKn: number, headingDeg = 0) {
  const h = c.hydro;
  const floating = {
    ...h,
    T: c.T,
    w: { mass: c.weights.total.massT * 1000, cg: { x: c.LCG, y: c.TCG, z: c.KG } },
    GMt: c.GMt,
    GMl: c.GMl,
    KG: c.KG,
    draftfp: c.draftFwd,
    draftap: c.draftAft,
    Cb: h.Cb,
    Cm: h.Cm,
    Cp: h.Cp,
    Cwp: h.Cwp,
    LCB: h.LCB,
    Vs: h.Vs,
    minXs: h.minXs,
    LWL: h.LWL,
    BWL: h.BWL,
  };
  return {
    discrete: {
      FloatingCondition: { state: floating, thisStateVer: 1 },
      Speed: { state: { speed: speedKn }, thisStateVer: 1 },
      Heading: { state: { heading: headingDeg }, thisStateVer: 1 },
    },
  };
}

export interface ResistancePoint {
  speedKn: number;
  froude: number;
  resistanceKN: number;
  effectivePowerKW: number;
}

/** Holtrop-Mennen calm water resistance from vessel.js HullResistance. */
export function resistanceCurve(ship: Ship, c: Condition, maxKn: number, n = 16): ResistancePoint[] {
  const out: ResistancePoint[] = [];
  const wave = new WaveCreator();
  wave.setWaveDef(0.6, 0, 180); // calm water
  const origError = console.error;
  console.error = () => {}; // vessel.js prints range-of-validity warnings for every call; surfaced separately
  try {
    for (let i = 1; i <= n; i++) {
      const v = (maxKn * i) / n;
      const r = new HullResistance(ship, statesFor(c, v), { D: 1, noProps: 2 }, wave);
      const R = r.totalResistance.Rtadd as number;
      const Pe = r.totalResistance.Pe as number;
      out.push({
        speedKn: v,
        froude: (v * 0.514444) / Math.sqrt(G * c.hydro.LWL),
        resistanceKN: R / 1000,
        effectivePowerKW: Pe / 1000,
      });
    }
  } finally {
    console.error = origError;
  }
  return out.filter((p) => Number.isFinite(p.resistanceKN));
}

/** Holtrop-Mennen validity ranges quoted in vessel.js. */
export function holtropValidity(c: Condition): string[] {
  const w: string[] = [];
  const LB = c.hydro.LWL / c.hydro.BWL;
  const BT = c.hydro.BWL / c.T;
  if (LB <= 3.9 || LB >= 15) w.push(`L/B = ${LB.toFixed(2)} outside 3.9 to 15`);
  if (BT <= 2.1 || BT >= 4) w.push(`B/T = ${BT.toFixed(2)} outside 2.1 to 4`);
  if (c.hydro.Cp <= 0.55 || c.hydro.Cp >= 0.85) w.push(`Cp = ${c.hydro.Cp.toFixed(3)} outside 0.55 to 0.85`);
  return w;
}

export interface MotionResult {
  heaveAmp: number; // m
  pitchAmpDeg: number;
  rollAmpDeg: number;
  verticalMotion: number; // m, at the chosen position
  verticalAcc: number; // m/s2
  encounterFreq: number;
  naturalRollPeriod: number; // s
}

/** Closed-form ship motions in regular waves (Jensen et al.) from vessel.js WaveMotion. */
export function motions(
  ship: Ship,
  c: Condition,
  opts: { speedKn: number; waveFreq: number; waveAmp: number; relHeadingDeg: number; positionPct: number },
): MotionResult {
  const wave = new WaveCreator();
  // avoid exactly beam seas in the pitch/heave formula (division by k cos(beta) = 0)
  const h = Math.abs((opts.relHeadingDeg % 180) - 90) < 0.5 ? opts.relHeadingDeg + 0.5 : opts.relHeadingDeg;
  wave.setWaveDef(opts.waveFreq, opts.waveAmp, h);
  const origError = console.error;
  console.error = () => {};
  try {
    const m = new WaveMotion(ship, statesFor(c, opts.speedKn, 0), wave, opts.positionPct, 20);
    const vm = m.verticalMotion;
    const roll = m.rollAmp as number;
    return {
      heaveAmp: vm.heaveAmp,
      pitchAmpDeg: (Math.abs(vm.pitchAmp) * 180) / Math.PI,
      rollAmpDeg: (Math.abs(roll) * 180) / Math.PI,
      verticalMotion: vm.verticalMov,
      verticalAcc: vm.verticalAcc,
      encounterFreq: m.coefficients.encounter_frequency,
      naturalRollPeriod: (2 * c.hydro.BWL * Math.PI * 0.4) / Math.sqrt(G * Math.max(c.GMt, 1e-6)),
    };
  } finally {
    console.error = origError;
  }
}

/**
 * vessel.js waterlineCalculation limited to xa..xb.
 * Workaround for a vessel.js bug: with minX exactly equal to the first station and maxX inside
 * the hull, it slices its station array off by one and crashes. Nudging minX by 1 micrometre
 * takes the other (correct) branch with the same result.
 */
export function boundedWaterline(ship: Ship, z: number, xa: number, xb: number) {
  const hull = ship.structure.hull;
  const LOA = hull.attributes.LOA;
  const s0 = hull.halfBreadths.stations[0] * LOA;
  const minX = xa <= s0 ? s0 + 1e-6 : xa;
  return hull.waterlineCalculation(z, { minX, maxX: Math.min(xb, LOA) });
}

/** Half-breadth of the moulded hull at (x, z), using vessel.js offset interpolation. */
export function halfBreadthAt(ship: Ship, x: number, z: number): number {
  const hull = ship.structure.hull;
  const wl = hull.getWaterline(z).map((v) => (v === null || Number.isNaN(v) ? 0 : v));
  const sts = hull.halfBreadths.stations.map((s) => s * hull.attributes.LOA);
  if (x < sts[0] || x > sts[sts.length - 1]) return 0;
  return f.linearFromArrays(sts, wl as number[], x);
}

/** Deck outline polygon (x, y) at height z, port and starboard. */
export function deckOutline(ship: Ship, z: number, samples = 60): [number, number][] {
  const LOA = ship.structure.hull.attributes.LOA;
  const port: [number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const x = (LOA * i) / samples;
    const hb = halfBreadthAt(ship, x, z);
    port.push([x, Math.max(hb, 0)]);
  }
  const star = port.map(([x, y]) => [x, -y] as [number, number]).reverse();
  return [...port, ...star];
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
