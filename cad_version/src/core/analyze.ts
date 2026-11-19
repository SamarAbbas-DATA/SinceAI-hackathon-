/**
 * One call that turns a closed mesh + print settings + test load into every number and flag the UI shows.
 * Works for generated hulls and for imported models.
 */
import { bbox, massProps, overhang, placeOnBed, rotX, size, topology, transform, type Mesh, type Overhang, type Topology } from "./mesh";
import { deckEdgeAngle, equilibrium, gzArea, gzCurve, RHO_FRESH, RHO_SEA, vanishingAngle, type Equilibrium, type GzPoint } from "./hydro";
import { bedFit, printMass, PRINTERS, type BedFit, type PrintMass, type PrintSettings } from "./print";
import { LIMITS } from "./limits";

export type Level = "ok" | "warn" | "bad" | "info";

export interface Finding {
  id: string;
  group: "float" | "stability" | "print" | "geometry";
  level: Level;
  title: string;
  message: string; // what
  detail: string; // why, measured vs limit
  fix: string; // how
}

export interface Load {
  mass: number; // g, test weight placed on deck
  xFrac: number; // its position along the length, 0 = transom, 1 = bow
  height: number; // its centre of gravity above the deck, mm
}

export const DEFAULT_LOAD: Load = { mass: 40, xFrac: 0.45, height: 5 };

export interface AnalysisInput {
  mesh: Mesh; // design orientation: z up, x along the length, mm
  print: PrintSettings;
  load: Load;
  water: "fresh" | "sea";
  lambda: number; // full scale / model
  stemHalf?: number; // thinnest half-width (generated hulls), mm
  printFlip: boolean; // print upside down (deck on the bed)
  weighedPrint?: number | null; // g, measured mass of the printed part; replaces the estimate
}

export interface Analysis {
  topo: Topology;
  dims: [number, number, number];
  volume: number;
  printMass: PrintMass;
  totalMass: number;
  G: [number, number, number];
  eq: Equilibrium | null;
  gz: GzPoint[];
  is: { gm0: number; area30: number; area40: number; area3040: number; gz30: number; maxGzAngle: number; vanish: number; deckEdge: number | null } | null;
  printMesh: Mesh; // oriented and centred on the bed, mm
  overhang: Overhang;
  overhangOther: Overhang;
  fit: BedFit;
  findings: Finding[];
}

export const HEELS = Array.from({ length: 19 }, (_, i) => i * 5); // 0..90 deg

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);

export function printOrient(m: Mesh, flipped: boolean): Mesh {
  return placeOnBed(flipped ? transform(m, rotX(180)) : m);
}

export function analyze(inp: AnalysisInput): Analysis {
  const { mesh, print, load } = inp;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const topo = topology(mesh);
  const box = bbox(mesh);
  const dims = size(box);
  const mp = massProps(mesh);
  const est = printMass(mesh, print);
  const k0 = inp.weighedPrint && inp.weighedPrint > 0 && est.total > 0 ? inp.weighedPrint / est.total : 1;
  const pm = k0 === 1 ? est : { ...est, shell: est.shell * k0, infill: est.infill * k0, total: est.total * k0, cost: est.cost * k0 };
  const printer = PRINTERS.find((p) => p.id === print.printer) ?? PRINTERS[0];

  // ---------- geometry ----------
  if (!topo.watertight)
    add({
      id: "watertight",
      group: "geometry",
      level: "bad",
      title: "Mesh is not watertight",
      message: `The model has ${topo.boundaryEdges} open edges, ${topo.nonManifoldEdges} non-manifold edges and ${topo.flippedEdges} flipped edges.`,
      detail: "Slicers guess how to fill holes, so the print can come out with missing walls, and volume and buoyancy cannot be computed exactly.",
      fix: "Repair the mesh in your CAD tool (close holes, unify normals) or export a solid STEP instead of a surface model.",
    });
  else
    add({ id: "watertight", group: "geometry", level: "ok", title: "Closed, watertight solid", message: `${topo.triangles.toLocaleString()} triangles, ${topo.shells} shell${topo.shells > 1 ? "s" : ""}, all edges shared by exactly two faces.`, detail: "Slicers and CAD tools read it as one solid.", fix: "" });
  if (topo.degenerate > 0)
    add({ id: "degenerate", group: "geometry", level: "warn", title: "Zero-area triangles", message: `${topo.degenerate} triangles have no area.`, detail: "Most slicers ignore them, some report errors.", fix: "Run a mesh repair or re-export with a finer tolerance." });

  // ---------- print ----------
  const pmesh = printOrient(mesh, inp.printFlip);
  const ov = overhang(pmesh, LIMITS.print.overhangDeg);
  const ovOther = overhang(printOrient(mesh, !inp.printFlip), LIMITS.print.overhangDeg);
  const pd = size(bbox(pmesh));
  const fit = bedFit(pd[0], pd[1], pd[2], printer, print.margin);

  if (!fit.fits)
    add({
      id: "bed",
      group: "print",
      level: "bad",
      title: "Does not fit the printer",
      message: `${f1(pd[0])} x ${f1(pd[1])} x ${f1(pd[2])} mm does not fit the ${printer.name} bed (${printer.bed.join(" x ")} mm, ${print.margin} mm margin).`,
      detail: !fit.heightOk ? `Height ${f1(pd[2])} mm exceeds ${printer.bed[2]} mm.` : `Longest length that fits this shape is ${f1(fit.maxLengthAny)} mm (placed diagonally).`,
      fix: `Set the printed length to ${Math.floor(fit.maxLengthAny)} mm or less, or pick a larger printer.`,
    });
  else
    add({
      id: "bed",
      group: "print",
      level: fit.angle > 0 ? "info" : "ok",
      title: fit.angle > 0 ? `Fits the bed when turned ${f1(fit.angle)} deg` : "Fits the bed",
      message: `${f1(pd[0])} x ${f1(pd[1])} x ${f1(pd[2])} mm on the ${printer.name}.`,
      detail: fit.angle > 0 ? "It is too long to lie straight, so STL and 3MF exports are already rotated to the diagonal." : `Up to ${f1(fit.maxLengthStraight)} mm would fit straight.`,
      fix: "",
    });

  const supportPct = ov.fraction * 100;
  add({
    id: "overhang",
    group: "print",
    level: ov.fraction > LIMITS.print.overhangWarn ? "warn" : "ok",
    title: ov.fraction > LIMITS.print.overhangWarn ? "Needs support material" : "Prints without supports",
    message: `${f1(supportPct)} % of the surface faces down steeper than ${LIMITS.print.overhangDeg} deg ${inp.printFlip ? "with the deck on the bed" : "keel down"}.`,
    detail: `Bed contact area ${f1(ov.bedArea / 100)} cm2. Other orientation: ${f1(ovOther.fraction * 100)} % needs support.`,
    fix:
      ov.fraction > LIMITS.print.overhangWarn
        ? ovOther.fraction < ov.fraction
          ? `Flip the print orientation (${inp.printFlip ? "keel down" : "deck down"}): it reduces support to ${f1(ovOther.fraction * 100)} %.`
          : "Enable tree supports in the slicer; sand the support marks before testing in water."
        : "",
  });

  const minWall = LIMITS.print.minWallLines * print.lineWidth;
  add({
    id: "wall",
    group: "print",
    level: print.wall + 1e-9 < minWall ? "warn" : "ok",
    title: print.wall + 1e-9 < minWall ? "Walls may leak" : "Walls thick enough to stay sealed",
    message: `Shell ${f2(print.wall)} mm = ${f1(print.wall / print.lineWidth)} lines of ${print.lineWidth} mm.`,
    detail: `Below ${LIMITS.print.minWallLines} lines, FDM walls weep water into the infill: the model gets heavier and floats lower than predicted.`,
    fix: print.wall + 1e-9 < minWall ? `Use at least ${f2(minWall)} mm (${LIMITS.print.minWallLines} walls) and 5 top and bottom layers.` : "Use the same wall count and top/bottom layers in the slicer.",
  });

  if (inp.stemHalf !== undefined) {
    const minF = LIMITS.print.minFeatureLines * print.lineWidth;
    if (inp.stemHalf * 2 < minF - 1e-6)
      add({ id: "stem", group: "print", level: "warn", title: "Bow tip thinner than the nozzle line", message: `The stem is ${f2(inp.stemHalf * 2)} mm wide.`, detail: `Features under ${f2(minF)} mm (${LIMITS.print.minFeatureLines} lines) print rough or not at all.`, fix: "Increase the printed length or bow fullness." });
  }

  // ---------- floating ----------
  const totalMass = pm.total + load.mass;
  const loadG: [number, number, number] = [box.min[0] + load.xFrac * dims[0], 0, box.max[2] + load.height];
  const G: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) G[k] = (pm.total * pm.G[k] + load.mass * loadG[k]) / totalMass;

  let eq: Equilibrium | null = null;
  let gz: GzPoint[] = [];
  let is: Analysis["is"] = null;
  if (topo.watertight && mp.volume > 0) {
    const rho = inp.water === "sea" ? RHO_SEA : RHO_FRESH;
    eq = equilibrium(mesh, { mass: totalMass, G, rho }, mp.volume);
    const D = dims[2];
    const L = dims[0];
    if (eq.sinks) {
      add({
        id: "floats",
        group: "float",
        level: "bad",
        title: "Sinks",
        message: `Total mass ${f1(totalMass)} g is more than the ${f1(mp.volume * rho)} g of water the closed hull can displace.`,
        detail: "With every millimetre submerged the hull still cannot carry the weight.",
        fix: `Remove at least ${f1(totalMass - mp.volume * rho * 0.75)} g of load, lower the infill, or make the hull larger.`,
      });
    } else {
      const fbMin = D - Math.max(eq.Ta, eq.Tf);
      const fbShare = fbMin / D;
      add({
        id: "freeboard",
        group: "float",
        level: fbShare < LIMITS.model.freeboardBad ? "bad" : fbShare < LIMITS.model.freeboardWarn ? "warn" : "ok",
        title: fbShare < LIMITS.model.freeboardWarn ? "Low freeboard" : "Floats with good freeboard",
        message: `Draft ${f1(eq.Tm)} mm amidships, ${f1(fbMin)} mm freeboard at the lowest end (${f1(fbShare * 100)} % of the depth).`,
        detail: `Reserve buoyancy ${f1(eq.reserve * 100)} %. Small waves and splashes swamp the deck below ${f1(LIMITS.model.freeboardWarn * 100)} % freeboard.`,
        fix: fbShare < LIMITS.model.freeboardWarn ? `Reduce the load by about ${f1((LIMITS.model.freeboardWarn - fbShare) * D * eq.c.Awp * rho)} g, lower the infill, or increase the depth.` : "",
      });
      const trimRatio = (eq.Tf - eq.Ta) / L;
      const aTrim = Math.abs(trimRatio);
      const gPct = ((G[0] - box.min[0]) / L) * 100;
      add({
        id: "trim",
        group: "float",
        level: aTrim > LIMITS.model.trimBad ? "bad" : aTrim > LIMITS.model.trimWarn ? "warn" : "ok",
        title: aTrim > LIMITS.model.trimWarn ? (trimRatio > 0 ? "Trims by the bow" : "Trims by the stern") : "Floats level",
        message: `Aft draft ${f1(eq.Ta)} mm, forward draft ${f1(eq.Tf)} mm (trim ${f2(eq.trim)} deg).`,
        detail: `Limit ${f1(LIMITS.model.trimWarn * 100)} % of length. The centre of gravity is at ${f1(gPct)} % of the length from the stern; the hull settles until buoyancy is right under it.`,
        fix: aTrim > LIMITS.model.trimWarn ? `Move the test load ${trimRatio > 0 ? "aft" : "forward"} (load position slider) until the drafts match.` : "",
      });
    }

    if (!eq.sinks) {
      gz = gzCurve(mesh, { mass: totalMass, G, rho }, eq.trim, HEELS);
      const k = inp.lambda / 1000; // model mm -> full-scale m
      const peak = gz.reduce((a, b) => (b.gz > a.gz ? b : a), gz[0]);
      is = {
        gm0: eq.GM * k,
        area30: gzArea(gz, 0, 30) * k,
        area40: gzArea(gz, 0, 40) * k,
        area3040: gzArea(gz, 30, 40) * k,
        gz30: Math.max(...gz.filter((p) => p.heel >= 30).map((p) => p.gz)) * k,
        maxGzAngle: peak.heel,
        vanish: vanishingAngle(gz),
        deckEdge: deckEdgeAngle(gz),
      };
      add({
        id: "gm",
        group: "stability",
        level: eq.GM <= 0 ? "bad" : is.gm0 < LIMITS.isCode.gm0 ? "warn" : "ok",
        title: eq.GM <= 0 ? "Capsizes: negative GM" : "Initial stability (GM)",
        message: `GM ${f2(eq.GM)} mm on the model = ${f2(is.gm0)} m at full scale (1:${Math.round(inp.lambda)}).`,
        detail: `KB ${f1(eq.KB)} + BM ${f1(eq.BM)} - KG ${f1(G[2])} mm. ${LIMITS.isCode.source} asks for GM at least ${LIMITS.isCode.gm0} m.`,
        fix: eq.GM <= 0 || is.gm0 < LIMITS.isCode.gm0 ? "Lower the test load (height slider), widen the beam, or use a boxier section. Beam has the biggest effect: BM grows with B squared." : "",
      });
      const crit: [string, number, number, string][] = [
        ["Area 0-30 deg", is.area30, LIMITS.isCode.area30, "m rad"],
        ["Area 0-40 deg", is.area40, LIMITS.isCode.area40, "m rad"],
        ["Area 30-40 deg", is.area3040, LIMITS.isCode.area3040, "m rad"],
        ["GZ at 30 deg or more", is.gz30, LIMITS.isCode.gz30, "m"],
        ["Angle of max GZ", is.maxGzAngle, LIMITS.isCode.maxGzAngle, "deg"],
      ];
      const failed = crit.filter(([, v, lim]) => v < lim);
      add({
        id: "iscode",
        group: "stability",
        level: failed.length ? "warn" : "ok",
        title: failed.length ? `${failed.length} of 5 IS Code GZ criteria not met` : "Meets the IS Code GZ criteria",
        message: crit.map(([n, v, lim, u]) => `${n}: ${u === "deg" ? f1(v) : f3(v)} ${u} (min ${lim})`).join("; ") + ".",
        detail: `Full-scale equivalent of the model GZ curve. Vanishing angle ${f1(is.vanish)} deg${is.deckEdge !== null ? `, deck edge under water from ${is.deckEdge} deg` : ""}. Early pre-check, not an official approval.`,
        fix: failed.length ? "More freeboard (depth) raises the GZ curve at large angles; a lower centre of gravity raises it everywhere." : "",
      });
    }
  } else if (!topo.watertight) {
    add({ id: "floats", group: "float", level: "info", title: "Floating not computed", message: "Hydrostatics need a closed solid.", detail: "Volume of an open mesh is undefined.", fix: "Repair the mesh first." });
  }

  return { topo, dims, volume: mp.volume, printMass: pm, totalMass, G, eq, gz, is, printMesh: pmesh, overhang: ov, overhangOther: ovOther, fit, findings };
}
