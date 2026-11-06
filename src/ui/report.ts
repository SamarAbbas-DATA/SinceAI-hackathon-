// PDF report: summary, all flags (with fixes), deck plans with flagged parts drawn, stability,
// damage and evacuation results, and the sources. Generated in the browser with jsPDF.
import { useStore } from "./store";
import { deckOutline, sortedDecks, spaceDeckIds } from "../engine/vessel";
import { gzAt } from "../engine/stability";
import { ruleDef, RULES } from "../engine/rules";
import { TYPE_COLOR, STATUS_COLOR, TYPE_LABEL } from "./theme";
import type { Finding, Status } from "../engine/types";

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (c: RGB, w: number): RGB => c.map((v) => Math.round(v + (255 - v) * w)) as RGB;
const n = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d));

export async function downloadReport() {
  const st = useStore.getState();
  const a = st.analysis;
  const d = st.design;
  if (!a) return st.notify("Analysis is still running, try again in a moment.", "info");
  st.notify("Building the PDF report...", "info");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210,
    H = 297,
    M = 14,
    CW = W - 2 * M;
  let y = M;
  const page = () => {
    doc.addPage();
    y = M;
  };
  const need = (h: number) => {
    if (y + h > H - M) page();
  };
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const text = (s: string, size = 9, opts: { bold?: boolean; c?: RGB; indent?: number; gap?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    color(opts.c ?? [20, 28, 45]);
    const lines = doc.splitTextToSize(s, CW - (opts.indent ?? 0)) as string[];
    const lh = size * 0.42;
    need(lines.length * lh + 1);
    doc.text(lines, M + (opts.indent ?? 0), y + lh * 0.8);
    y += lines.length * lh + (opts.gap ?? 1.2);
  };
  const heading = (s: string) => {
    need(14);
    y += 2;
    text(s, 13, { bold: true, c: [2, 80, 140] });
    doc.setDrawColor(200, 210, 225);
    doc.line(M, y, W - M, y);
    y += 3;
  };
  const dot = (s: Status, x: number, yy: number, r = 1.6) => {
    const c = hex(STATUS_COLOR[s]);
    doc.setFillColor(c[0], c[1], c[2]);
    doc.circle(x, yy, r, "F");
  };
  const deckName = (id: string) => d.decks.find((k) => k.id === id)?.name ?? id;

  // ---------------------------------------------------------------- page 1: summary
  doc.setFillColor(8, 15, 30);
  doc.rect(0, 0, W, 34, "F");
  doc.setTextColor(230, 240, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Ship Design Pre-Check report", M, 15);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`${d.name}    ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, M, 23);
  doc.setFontSize(8);
  doc.text("Early pre-check only. Not an official approval. Flooding results are simplified estimates.", M, 29);
  y = 42;
  const counts = { red: 0, amber: 0, green: 0, grey: 0 } as Record<Status, number>;
  for (const r of a.rules) counts[r.status]++;
  text(`Compliance score ${a.score.score} / 100  (${counts.red} red, ${counts.amber} amber, ${counts.green} green, ${counts.grey} not yet checkable)`, 12, { bold: true });
  const c = a.condition;
  if (c) {
    text(
      `${d.hull.LOA} x ${d.hull.BOA} x ${d.hull.depth} m (${d.hull.custom?.label ?? d.hull.template} hull). Displacement ${n(c.weights.total.massT, 0)} t, draft ${n(c.T, 2)} m (aft ${n(c.draftAft, 2)} / fwd ${n(c.draftFwd, 2)}), GM ${n(c.GMt, 2)} m incl. free surface ${n(c.FSC, 3)} m, freeboard ${n(c.freeboard, 2)} m. ${d.people.passengers} passengers, ${d.people.crew} crew. ${d.spaces.length} spaces, ${d.doors.length} doors, ${d.bulkheads.length} bulkheads, ${d.lsa.length} survival craft.`,
      9,
    );
  }
  const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
  if (canvas) {
    try {
      const img = canvas.toDataURL("image/jpeg", 0.85);
      const h = (CW * canvas.height) / canvas.width;
      need(h + 4);
      doc.addImage(img, "JPEG", M, y, CW, h);
      y += h + 2;
      text("3D view at the time of export. Red and amber glowing parts are flagged.", 7, { c: [100, 110, 130] });
    } catch {
      /* canvas not readable */
    }
  }
  heading("Rule overview");
  for (const r of a.rules) {
    need(10);
    dot(r.status, M + 1.6, y + 2);
    const before = y;
    text(`${r.title}`, 9.5, { bold: true, indent: 5, gap: 0.3 });
    text(r.summary, 8.5, { indent: 5, c: [70, 80, 100] });
    if (y - before < 6) y = before + 6;
  }

  // ---------------------------------------------------------------- flags
  const all: { rule: string; f: Finding }[] = [...a.geometry.map((f) => ({ rule: "Model check", f })), ...a.rules.flatMap((r) => r.findings.map((f) => ({ rule: r.title, f })))];
  const flagged = all.filter((x) => x.f.status === "red" || x.f.status === "amber");
  const numberOf = new Map<string, number[]>();
  flagged.forEach((x, i) => x.f.targets.forEach((t) => numberOf.set(t, [...(numberOf.get(t) ?? []), i + 1])));
  page();
  heading(`Flags (${flagged.length})`);
  if (!flagged.length) text("No red or amber flags.", 10);
  flagged.forEach((x, i) => {
    need(16);
    dot(x.f.status, M + 1.6, y + 2.1);
    doc.setFontSize(8);
    color([255, 255, 255]);
    const before = y;
    text(`${i + 1}. ${x.f.message}`, 9.5, { bold: true, indent: 5, gap: 0.4 });
    if (x.f.detail) text(x.f.detail, 8.5, { indent: 5, c: [70, 80, 100], gap: 0.4 });
    if (x.f.fix) text(`Fix: ${x.f.fix}`, 8.5, { indent: 5, c: [2, 100, 170], gap: 0.4 });
    text(x.rule, 7, { indent: 5, c: [140, 150, 165], gap: 2 });
    if (y - before < 6) y = before + 6;
  });

  // ---------------------------------------------------------------- deck plans
  const ship = a.ship;
  if (ship) {
    page();
    heading("Deck plans (flagged parts outlined, numbers refer to the flag list)");
    const scale = CW / d.hull.LOA;
    const deckZ = new Map(d.decks.map((k) => [k.id, k.z]));
    for (const deck of [...sortedDecks(d)].reverse()) {
      const sp = d.spaces.filter((s) => spaceDeckIds(d, s).includes(deck.id));
      const lsa = d.lsa.filter((l) => l.deckId === deck.id);
      if (!sp.length && !lsa.length) continue;
      const ph = d.hull.BOA * scale;
      need(ph + 14);
      text(`${deck.name}  (z ${deck.z} m)${deck.id === d.bulkheadDeckId ? "  bulkhead deck" : ""}`, 9.5, { bold: true });
      const top = y + 1;
      const X = (x: number) => M + x * scale;
      const Y = (yy: number) => top + (d.hull.BOA / 2 - yy) * scale;
      const out = deckOutline(ship, deck.z + 0.01, 80);
      doc.setDrawColor(120, 130, 150);
      doc.setLineWidth(0.3);
      for (let i = 0; i < out.length; i++) {
        const p = out[i],
          q = out[(i + 1) % out.length];
        doc.line(X(p[0]), Y(p[1]), X(q[0]), Y(q[1]));
      }
      for (const b of d.bulkheads) {
        const cc = b.kind === "watertight" ? hex("#3b82f6") : hex("#f97316");
        doc.setDrawColor(cc[0], cc[1], cc[2]);
        doc.setLineWidth(0.35);
        doc.setLineDashPattern(b.kind === "watertight" ? [] : [1.2, 0.8], 0);
        doc.line(X(b.x), Y(d.hull.BOA / 2), X(b.x), Y(-d.hull.BOA / 2));
        doc.setLineDashPattern([], 0);
      }
      for (const s of sp) {
        const status = a.statusById.get(s.id);
        const fill = mix(hex(TYPE_COLOR[s.type]), 0.55);
        doc.setFillColor(fill[0], fill[1], fill[2]);
        const bad = status === "red" || status === "amber";
        const stroke = bad ? hex(STATUS_COLOR[status!]) : ([90, 100, 120] as RGB);
        doc.setDrawColor(stroke[0], stroke[1], stroke[2]);
        doc.setLineWidth(bad ? 0.7 : 0.12);
        doc.rect(X(s.xCentre - s.length / 2), Y(s.yCentre + s.breadth / 2), s.length * scale, s.breadth * scale, "FD");
        const nums = numberOf.get(s.id);
        if (nums && bad) {
          doc.setFontSize(5.5);
          doc.setTextColor(stroke[0], stroke[1], stroke[2]);
          doc.setFont("helvetica", "bold");
          doc.text(nums.slice(0, 3).join(","), X(s.xCentre), Y(s.yCentre) + 0.8, { align: "center" });
        }
      }
      doc.setFillColor(60, 40, 10);
      for (const dr of d.doors.filter((x) => x.deckId === deck.id)) doc.rect(X(dr.x) - 0.35, Y(dr.y) - 0.35, 0.7, 0.7, "F");
      for (const l of lsa) {
        const cc = hex(a.statusById.get(l.id) === "red" ? STATUS_COLOR.red : l.kind === "lifeboat" ? "#fb923c" : "#94a3b8");
        doc.setFillColor(cc[0], cc[1], cc[2]);
        doc.ellipse(X(l.x), Y(l.y), l.kind === "lifeboat" ? 4 * scale : 0.8 * scale, l.kind === "lifeboat" ? 1.2 * scale : 0.6 * scale, "F");
      }
      y = top + ph + 4;
      void deckZ;
    }
    need(10);
    text("Legend: fill colour = space type; red / amber outline = flagged; orange dashed = fire zone bulkhead; blue = watertight bulkhead; dark squares = doors; orange ovals = lifeboats.", 7.5, { c: [100, 110, 130] });
    const types = [...new Set(d.spaces.map((s) => s.type))];
    text(types.map((t) => TYPE_LABEL[t]).join(", "), 7.5, { c: [100, 110, 130] });
  }

  // ---------------------------------------------------------------- stability
  if (c) {
    page();
    heading("Loading condition and weights");
    for (const w of c.weights.items) text(`${w.label}: ${n(w.massT, 1)} t at LCG ${n(w.lcg, 2)} m, VCG ${n(w.vcg, 2)} m`, 8.5, { gap: 0.4 });
    text(`Total ${n(c.weights.total.massT, 1)} t, LCG ${n(c.LCG, 2)} m, KG solid ${n(c.KGsolid, 3)} m, free-surface correction ${n(c.FSC, 3)} m, KG fluid ${n(c.KG, 3)} m.`, 8.5, { bold: true, gap: 2 });
    text(`Hydrostatics (vessel.js) at T = ${n(c.T, 3)} m: KB ${n(c.hydro.KB, 3)}, BMt ${n(c.hydro.BMt, 3)}, KMt ${n(c.hydro.KMt, 3)}, GMt ${n(c.GMt, 3)}, GMl ${n(c.GMl, 1)} m, LCB ${n(c.hydro.LCB, 2)}, LCF ${n(c.hydro.LCF, 2)} m, Cb ${n(c.hydro.Cb, 3)}, Cp ${n(c.hydro.Cp, 3)}, TPC ${n(c.hydro.TPC, 2)} t/cm, MCT ${n(c.hydro.MCT, 1)} t.m/cm.`, 8.5);
    const gz = a.gz;
    if (gz) {
      heading("Intact stability");
      const gh = 55;
      need(gh + 10);
      const x0 = M + 10,
        y0 = y + gh,
        gw = CW - 14;
      const maxDeg = gz.points[gz.points.length - 1]?.deg ?? 80;
      const maxGz = Math.max(0.1, ...gz.points.map((p) => p.gz));
      const minGz = Math.min(0, ...gz.points.map((p) => p.gz));
      const PX = (deg: number) => x0 + (deg / maxDeg) * gw;
      const PY = (g: number) => y0 - ((g - minGz) / (maxGz - minGz)) * gh;
      doc.setDrawColor(180, 190, 205);
      doc.setLineWidth(0.2);
      doc.line(x0, PY(0), x0 + gw, PY(0));
      doc.line(x0, y0, x0, y0 - gh);
      for (let deg = 0; deg <= maxDeg; deg += 10) {
        doc.setFontSize(6);
        doc.setTextColor(120, 130, 150);
        doc.text(String(deg), PX(deg), y0 + 3, { align: "center" });
      }
      doc.text(`${n(maxGz, 2)} m`, x0 - 1, PY(maxGz) + 1, { align: "right" });
      doc.setDrawColor(2, 132, 199);
      doc.setLineWidth(0.6);
      for (let i = 1; i < gz.points.length; i++) doc.line(PX(gz.points[i - 1].deg), PY(gz.points[i - 1].gz), PX(gz.points[i].deg), PY(gz.points[i].gz));
      doc.setDrawColor(249, 115, 22);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(PX(gz.deckEdgeDeg), y0, PX(gz.deckEdgeDeg), y0 - gh);
      doc.setLineDashPattern([], 0);
      y = y0 + 6;
      text("GZ curve (m) against heel angle (deg). Dashed: deck edge immersion.", 7.5, { c: [100, 110, 130] });
      const v = ruleDef("INTACT-STABILITY").values;
      const rows: [string, number, number][] = [
        ["Area 0 to 30 deg (m.rad)", gz.area0_30, v.min_area_0_30_m_rad],
        ["Area 0 to 40 deg (m.rad)", gz.area0_40, v.min_area_0_40_m_rad],
        ["Area 30 to 40 deg (m.rad)", gz.area30_40, v.min_area_30_40_m_rad],
        ["GZ at 30 deg (m)", gzAt(gz, 30), v.min_gz_at_30_deg_or_more_m],
        ["Angle of maximum GZ (deg)", gz.angleMaxGZ, v.min_angle_of_max_gz_deg],
        ["Initial GM (m)", c.GMt, v.min_initial_gm_m],
      ];
      for (const [k, val, lim] of rows) {
        need(5);
        dot(val >= lim ? "green" : "red", M + 1.6, y + 1.8, 1.2);
        text(`${k}: ${n(val, 3)}   minimum ${lim}`, 8.5, { indent: 5, gap: 0.5 });
      }
    }
  }

  // ---------------------------------------------------------------- damage + evacuation
  const fl = a.flood;
  if (fl?.ok) {
    heading("Damage stability (simplified estimate)");
    text(`Attained index A = ${n(fl.A, 3)}, required R = ${n(fl.R, 3)} for N = ${fl.N} persons. Bulkhead deck at ${n(fl.bulkheadDeckZ, 2)} m.`, 9, { bold: true });
    for (const k of fl.cases) {
      need(5);
      dot(k.survives ? "green" : "red", M + 1.6, y + 1.8, 1.2);
      text(`${k.compartments.join("+")} (x ${n(k.xAft, 0)} to ${n(k.xFwd, 0)} m), p ${n(k.p, 3)}: draft ${n(k.draft, 2)} m, aft ${n(k.draftAft, 2)} / fwd ${n(k.draftFwd, 2)} m, GM ${n(k.GMd, 2)} m. ${k.reason}`, 8, { indent: 5, gap: 0.5 });
    }
  }
  const e = a.evac;
  if (e?.ok) {
    heading("Evacuation (MSC.1/Circ.1533 Annex 2)");
    text(`Total ${n(e.total / 60, 1)} min against ${n(e.limit / 60, 0)} min: 1.25 x (R ${n(e.R / 60, 1)} + T ${n(e.T / 60, 1)}) + 2/3 x (E+L ${n(e.EL / 60, 1)}). ${e.persons} persons, ${e.mvz} main vertical zones.`, 9, { bold: true });
    for (const s of e.stairs) text(`${d.spaces.find((x) => x.id === s.stairId)?.name}: ${s.persons} persons, inflow ${n(s.FcIn)} p/s, outflow ${n(s.FcOut)} p/s${s.queue ? " (queue)" : ""}`, 8.5, { gap: 0.4 });
    for (const r of [...e.routes].sort((p, q) => q.tI - p.tI).slice(0, 8)) text(`${deckName(r.deckId)} via ${d.spaces.find((x) => x.id === r.stairId)?.name ?? "deck"}: ${r.persons} persons, tI ${n(r.tI, 0)} s`, 8, { gap: 0.3, c: [70, 80, 100] });
  }

  // ---------------------------------------------------------------- sources
  heading("Sources and method");
  text("No AI or language model is used. All results come from deterministic geometry, graph and naval architecture calculations (vessel.js, MIT licence) compared with the thresholds in rules.json.", 8.5);
  for (const s of RULES.sources as { id: string; name: string; url?: string; file?: string }[]) text(`${s.name}  ${s.url ?? s.file ?? ""}`, 7.5, { c: [80, 90, 110], gap: 0.6 });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(140, 150, 165);
    doc.text(`${d.name}  |  page ${i} of ${pages}  |  early pre-check, not an official approval`, W / 2, H - 6, { align: "center" });
  }
  doc.save(`${d.name.replace(/\W+/g, "_")}_precheck_report.pdf`);
  st.notify("Report downloaded.", "ok");
}
