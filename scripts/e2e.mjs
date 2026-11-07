// Browser interaction test: drives the real app in headless Chrome over the DevTools protocol.
// Start the dev server first (npm run dev), then: npm run e2e
// Env: CHROME=path/to/chrome  APP_URL=http://localhost:5173/
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const URL_ = process.env.APP_URL ?? "http://localhost:5173/";
const PORT = 9333;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
const outDir = path.resolve("e2e-output");
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f));

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmp}`, "--window-size=1600,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let results = [];
const browserErrors = [];
const check = (name, ok, info = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
};

async function main() {
  let ver;
  for (let i = 0; i < 50 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${URL_}`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") browserErrors.push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") browserErrors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval error");
    return r.result?.result?.value;
  };
  const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
  const click = async (p) => {
    await mouse("mouseMoved", p.x, p.y);
    await sleep(80);
    await mouse("mousePressed", p.x, p.y, 1);
    await sleep(40);
    await mouse("mouseReleased", p.x, p.y, 0);
    await sleep(500);
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  const S = "window.__store.getState()";

  await send("Runtime.enable");
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outDir });
  for (let i = 0; i < 60; i++) {
    if (await ev(`!!window.__store && !!${S}.analysis && !!window.__project`)) break;
    await sleep(250);
  }
  check("app loads and analysis runs", await ev(`!!${S}.analysis && ${S}.analysis.errors.length === 0`));
  check("starts from the default demo ferry", await ev(`${S}.design.name.startsWith('Demo') && ${S}.design.spaces.length === 118`), await ev(`${S}.design.name + ', ' + ${S}.design.spaces.length + ' spaces'`));
  await sleep(1800); // the guided tour opens itself on every start; close it so it does not cover the 3D view
  check("guided tour opens on every start", (await ev(`${S}.tourStep`)) === 0);
  check("emergency door icons are hidden until switched on", (await ev(`${S}.view.showDoors`)) === false);
  await shot("tour");
  await ev(`${S}.set({ tourStep: null, activeDeckId: 'D3' })`);
  await sleep(2500);
  await shot("design-dark");
  await ev(`${S}.select({ kind: 'space', id: 'galley' }); ${S}.set({ activeDeckId: 'D4' })`);
  await sleep(1200);
  await shot("inspect-dark");
  await ev(`${S}.select(null); ${S}.set({ panel: 'issues', activeDeckId: 'D3' }); ${S}.setTheme('light')`);
  await sleep(1500);
  await shot("design-light");
  await ev(`${S}.setTheme('dark'); ${S}.setView({ isolateDeck: true }); window.dispatchEvent(new CustomEvent('viewport:view', { detail: 'plan' }))`);
  await sleep(2500);

  // place a cabin on free deck
  const n0 = await ev(`${S}.design.spaces.length`);
  await ev(`${S}.set({ tool: { kind: 'space', type: 'cabin' } })`);
  await click(await ev(`window.__project(96, 0, 9.02)`));
  const n1 = await ev(`${S}.design.spaces.length`);
  check("click places a cabin on free deck area", n1 === n0 + 1, `${n0} -> ${n1}`);

  // overlapping placement is refused
  await click(await ev(`window.__project(50, 3, 9.02)`));
  const n2 = await ev(`${S}.design.spaces.length`);
  const toast = await ev(`${S}.toast?.text ?? ''`);
  check("placing on top of a cabin is refused with a message", n2 === n1 && /overlap/.test(toast), toast.slice(0, 70));

  // drag into an overlap snaps back
  await ev(`${S}.set({ tool: { kind: 'select' } })`);
  const a = await ev(`window.__project(22, 3, 10.5)`);
  const b = await ev(`window.__project(25.5, 3, 9.02)`);
  await mouse("mouseMoved", a.x, a.y);
  await sleep(80);
  await mouse("mousePressed", a.x, a.y, 1);
  await sleep(60);
  const pressedOn = await ev(`(${S}.selection?.id ?? 'none') + ' / ' + document.elementFromPoint(${a.x}, ${a.y})?.tagName`);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, 1);
    await sleep(40);
  }
  const xDuring = await ev(`${S}.design.spaces.find(s => s.id === 'D3-cabP20').xCentre`);
  await mouse("mouseReleased", b.x, b.y, 0);
  await sleep(600);
  check("a dragged cabin follows the cursor over other rooms", Math.abs(xDuring - 22) > 2, `x during drag = ${xDuring}`);
  const xBack = await ev(`${S}.design.spaces.find(s => s.id === 'D3-cabP20').xCentre`);
  const dragToast = await ev(`${S}.toast?.text ?? ''`);
  check("dragging a cabin into its neighbour is undone", Math.abs(xBack - 22) < 0.01 && /Moved back/.test(dragToast), `x = ${xBack}; pressed on ${pressedOn}; ${dragToast.slice(0, 70)}`);

  // valid drag moves the new cabin
  const newId = await ev(`${S}.design.spaces.at(-1).id`);
  const c0 = await ev(`window.__project(96, 0, 10.5)`);
  const c1 = await ev(`window.__project(100, 0, 9.02)`);
  await mouse("mouseMoved", c0.x, c0.y);
  await sleep(80);
  await mouse("mousePressed", c0.x, c0.y, 1);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", c0.x + ((c1.x - c0.x) * i) / 8, c0.y + ((c1.y - c0.y) * i) / 8, 1);
    await sleep(40);
  }
  await mouse("mouseReleased", c1.x, c1.y, 0);
  await sleep(600);
  const xMoved = await ev(`${S}.design.spaces.find(s => s.id === '${newId}').xCentre`);
  check("dragging a cabin to free space moves it", Math.abs(xMoved - 100) < 0.8, `x = ${xMoved}`);

  // undo with the keyboard
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", modifiers: 2, windowsVirtualKeyCode: 90 });
  await sleep(400);
  const xUndo = await ev(`${S}.design.spaces.find(s => s.id === '${newId}')?.xCentre`);
  check("Ctrl+Z undoes the move", Math.abs(xUndo - 96) < 0.01, `x = ${xUndo}`);
  await sleep(500);
  await shot("design-plan");

  // a room in the water (outside the hull) is refused
  await ev(`${S}.set({ tool: { kind: 'space', type: 'tank' } })`);
  const nw0 = await ev(`${S}.design.spaces.length`);
  await click(await ev(`window.__project(60, 24, 9.02)`));
  const wetToast = await ev(`${S}.toast?.text ?? ''`);
  check("placing a tank outside the hull is refused", (await ev(`${S}.design.spaces.length`)) === nw0 && /outside the hull/.test(wetToast), wetToast.slice(0, 70));

  // emergency door tool: a click near the wall between two cabins (no door there yet) adds a connecting door
  await ev(`${S}.set({ tool: { kind: 'door' } })`);
  const d0 = await ev(`${S}.design.doors.length`);
  const dp = await ev(`window.__project(28.4, 3.2, 9.02)`);
  await mouse("mouseMoved", dp.x, dp.y);
  await sleep(300);
  await shot("door-preview");
  await click(dp);
  await sleep(700);
  const d1 = await ev(`${S}.design.doors.length`);
  const conn = await ev(`(() => { const d = ${S}.design.doors.at(-1); const c = ${S}.analysis.graph.conns.find(k => k.id === d.id); return c ? [c.a, c.b].sort().join(' + ') : 'none'; })()`);
  check("emergency door tool adds a door that connects two rooms", d1 === d0 + 1 && conn === 'D3-cabP24 + D3-cabP28', conn);
  await ev(`${S}.undo(); ${S}.set({ tool: { kind: 'select' } })`);
  await sleep(400);

  // escape route tool: a cabin without its door gets it back and its route is shown
  await ev(`${S}.edit((d) => { d.doors = d.doors.filter((q) => !(q.deckId === 'D3' && q.x === 34 && q.y === 1)); })`);
  await sleep(400);
  const r0 = await ev(`${S}.design.doors.length`);
  await ev(`${S}.set({ tool: { kind: 'route' } })`);
  await click(await ev(`window.__project(34, 3.5, 9.02)`));
  await sleep(700);
  const routeConn = await ev(`(() => { const d = ${S}.design.doors.at(-1); const c = ${S}.analysis.graph.conns.find(k => k.id === d.id); return c ? [c.a, c.b].sort().join(' + ') : 'none'; })()`);
  const routeToast = await ev(`${S}.toast?.text ?? ''`);
  check("escape route tool connects a room and shows its route", (await ev(`${S}.design.doors.length`)) === r0 + 1 && routeConn === 'D3-cabP32 + D3-corr1' && (await ev(`${S}.view.showRoutes`)) && /Escape route from D3 cabin P32/.test(routeToast), routeToast.slice(0, 90));
  await shot("escape-route");
  await ev(`${S}.undo(); ${S}.undo(); ${S}.setView({ showRoutes: false }); ${S}.set({ tool: { kind: 'select' } })`);
  await sleep(400);

  // test mode: waves
  await ev(`window.dispatchEvent(new CustomEvent('viewport:view', { detail: '3d' })); ${S}.set({ mode: 'test', panel: 'test' }); ${S}.setTest({ kind: 'sea', running: true, restart: Date.now() })`);
  await sleep(4500);
  const sea = await ev(`({ t: window.__live.t, n: window.__live.history.length, h: Math.max(...window.__live.history.map(x => Math.abs(x.a))) })`);
  check("waves test animates the ship (time runs, heave moves)", sea.t > 2 && sea.n > 10 && sea.h > 0.1, JSON.stringify(sea));
  await shot("test-waves");

  await ev(`${S}.setTest({ kind: 'heel', heelSweep: true, restart: Date.now() })`);
  await sleep(4500);
  const heel = await ev(`({ deg: window.__live.heelDeg, gz: window.__live.gz })`);
  check("heel test sweeps the heel angle and reads GZ", heel.deg > 2 && heel.gz > 0, JSON.stringify(heel));
  await shot("test-heel");

  const lost = await ev(`${S}.analysis.flood.cases.findIndex(c => !c.survives)`);
  await ev(`${S}.setTest({ kind: 'flood', floodCase: ${Math.max(0, lost)}, restart: Date.now() })`);
  await sleep(9000); // headless rendering is slow; the animation needs about 7.5 s
  const fl = await ev(`({ p: window.__live.floodProgress, fwd: window.__live.draftFwd })`);
  check("flooding test reaches the damaged waterline", fl.p > 0.99 && fl.fwd > 5.5, JSON.stringify(fl));
  await shot("test-flood");

  await ev(`${S}.setTest({ kind: 'evac', restart: Date.now() })`);
  await sleep(6000);
  const ev2 = await ev(`({ arrived: window.__live.evacArrived, total: window.__live.evacTotal })`);
  check("evacuation walk-through moves people to the assembly stations", ev2.arrived > 0 && ev2.total > 100, JSON.stringify(ev2));
  await shot("test-evac");

  // PDF report
  const before = fs.readdirSync(outDir).filter((f) => f.endsWith(".pdf")).length;
  await ev(`window.__report()`);
  await sleep(3000);
  const pdfs = fs.readdirSync(outDir).filter((f) => f.endsWith(".pdf"));
  const size = pdfs.length ? fs.statSync(path.join(outDir, pdfs[pdfs.length - 1])).size : 0;
  check("PDF report downloads", pdfs.length > before && size > 20000, `${pdfs.at(-1)} ${Math.round(size / 1024)} kB`);

  // model picker: switch to Icon of the Seas, edit, switch away and back; the edit is kept in memory
  await ev(`${S}.set({ mode: 'design', panel: 'issues' })`);
  await sleep(300);
  const pick = async (label) => {
    await ev(`document.querySelector('[data-tour=models] button').click()`);
    await sleep(250);
    await ev(`[...document.querySelectorAll('[data-tour=models] div button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
    await sleep(2500);
  };
  await pick("Icon of the Seas");
  const icon = await ev(`({ name: ${S}.design.name, decks: ${S}.design.decks.length, spaces: ${S}.design.spaces.length, errors: ${S}.analysis?.errors.length, red: ${S}.analysis?.rules.filter(r => r.status === 'red').map(r => r.ruleId).join(',') })`);
  check("model picker loads Icon of the Seas (20 decks, only the fire zone width red)", icon.name === "Icon of the Seas" && icon.decks === 20 && icon.errors === 0 && icon.red === "FIRE-ZONE-SIZE", JSON.stringify(icon));
  await shot("model-icon");
  // hull livery: painted and opaque when zoomed out, transparent when zoomed in
  await sleep(2500);
  const far = await ev(`window.__liveryOpacity ?? -1`);
  await shot("livery-icon");
  await ev(`(() => { const s = ${S}.design.spaces.find(x => x.type === 'cabin'); window.dispatchEvent(new CustomEvent('viewport:focus', { detail: { x: s.xCentre, y: s.yCentre, z: 30 } })); })()`);
  await sleep(3500);
  const near = await ev(`window.__liveryOpacity ?? -1`);
  check("hull livery is opaque zoomed out and fades when zoomed in", far > 0.9 && near < 0.05, JSON.stringify({ far, near, dbg: await ev(`window.__liveryDebug`) }));
  await shot("livery-icon-zoomed");
  await ev(`window.dispatchEvent(new CustomEvent('viewport:view', { detail: 'side' }))`);
  await sleep(2500);
  await shot("livery-icon-side");
  await ev(`window.dispatchEvent(new CustomEvent('viewport:view', { detail: '3d' }))`);
  await sleep(1500);
  await ev(`${S}.edit(d => { d.spaces.find(s => s.type === 'cabin').name = 'E2E renamed cabin'; })`);
  await pick("Demo ferry");
  const back = await ev(`({ name: ${S}.design.name, spaces: ${S}.design.spaces.length })`);
  await pick("Icon of the Seas");
  const kept = await ev(`${S}.design.spaces.some(s => s.name === 'E2E renamed cabin') && ${S}.past.length > 0`);
  check("switching models keeps each model's edits", back.name.startsWith("Demo") && back.spaces > 100 && kept, JSON.stringify(back));
  check("leaving the page warns about unsaved edits", await ev(`${S}.hasUnsavedEdits()`));
  await shot("model-icon-framed");
  await pick("Mein Schiff 7");
  await sleep(2500);
  await shot("livery-ms7");
  await ev(`window.dispatchEvent(new CustomEvent('viewport:view', { detail: 'side' }))`);
  await sleep(2500);
  await shot("livery-ms7-side");
  await ev(`window.dispatchEvent(new CustomEvent('viewport:view', { detail: 'bow' }))`);
  await sleep(2500);
  await shot("livery-ms7-bow");
  await ev(`${S}.set({ panel: 'issues' })`);
  await pick("Demo ferry");
  await ev(`${S}.set({ panel: 'issues' })`);
  await sleep(800);
  check("issues show the source document with page and quote", await ev(`document.body.innerText.includes('Open p. ') && document.body.innerText.includes('Source')`));
  await shot("issues-sources");
  // tour step for the model picker shows its image
  await ev(`${S}.set({ tourStep: 3 })`);
  await sleep(1200);
  check("tour has a model picker step with an image", await ev(`!!document.querySelector('img[src="/tour/model-ships.svg"]')?.complete && document.querySelector('img[src="/tour/model-ships.svg"]').naturalWidth > 0`));
  await shot("tour-models");
  await ev(`${S}.set({ tourStep: null })`);

  // ---- pipes and cables
  await ev(`${S}.set({ tourStep: null, activeDeckId: 'D3', panel: 'issues', tool: { kind: 'select' } }); ${S}.select(null); ${S}.setView({ isolateDeck: true }); window.dispatchEvent(new CustomEvent('viewport:view', { detail: '3d' }))`);
  await sleep(2500);
  check("pipes and cables are shown by default", await ev(`${S}.view.showPipes && ${S}.view.showCables && ${S}.design.runs.length >= 15`), `${await ev(`${S}.design.runs.length`)} runs`);
  check("pipe and cable checks flag the fuel line at the exhaust and the feeder over the galley", await ev(`['PIPE-FUEL-HOT', 'CABLE-ROUTING'].every((id) => ${S}.analysis.rules.find((r) => r.ruleId === id).status === 'amber') && ['PIPE-FIRE-MAIN', 'PIPE-WATERTIGHT'].every((id) => ${S}.analysis.rules.find((r) => r.ruleId === id).status === 'green')`));
  await shot("pipes-3d");
  await ev(`window.dispatchEvent(new CustomEvent('viewport:view', { detail: 'plan' }))`);
  await sleep(2500);
  const zD3 = await ev(`(() => { const d = ${S}.design.decks; const a = d.find(k => k.id === 'D3').z, b = d.find(k => k.id === 'D4').z; return b - 0.06; })()`);
  const nr0 = await ev(`${S}.design.runs.length`);
  await ev(`${S}.set({ tool: { kind: 'run', run: 'bilge_ballast' } })`);
  await click(await ev(`window.__project(96, 6, ${zD3})`));
  await click(await ev(`window.__project(104, 6.4, ${zD3})`)); // straightened along x
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))`);
  await sleep(500);
  const drawn = await ev(`(() => { const r = ${S}.design.runs.at(-1); return { n: ${S}.design.runs.length, kind: r.kind, pts: r.points.map(p => [p.x, p.y, p.deckId]) }; })()`);
  check("Pipe tool draws a straight pipe under the deckhead", drawn.n === nr0 + 1 && drawn.kind === "bilge_ballast" && drawn.pts.length === 2 && Math.abs(drawn.pts[0][1] - drawn.pts[1][1]) < 0.01 && Math.abs(drawn.pts[1][0] - drawn.pts[0][0] - 8) < 0.6, JSON.stringify(drawn));
  await shot("pipe-drawn");
  // drag the end handle of the selected pipe sideways
  await ev(`${S}.set({ tool: { kind: 'select' } }); ${S}.select({ kind: 'run', id: ${S}.design.runs.at(-1).id })`);
  await sleep(400);
  const h0 = await ev(`window.__project(${drawn.pts[1][0]}, ${drawn.pts[1][1]}, ${zD3})`);
  const h1 = await ev(`window.__project(${drawn.pts[1][0]}, 3, ${zD3})`);
  await mouse("mouseMoved", h0.x, h0.y);
  await sleep(80);
  await mouse("mousePressed", h0.x, h0.y, 1);
  await sleep(60);
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", h0.x + ((h1.x - h0.x) * i) / 8, h0.y + ((h1.y - h0.y) * i) / 8, 1);
    await sleep(40);
  }
  await mouse("mouseReleased", h1.x, h1.y, 0);
  await sleep(500);
  const yEnd = await ev(`${S}.design.runs.at(-1).points[1].y`);
  check("dragging a pipe handle moves that bend", Math.abs(yEnd - 3) < 0.4, `y = ${yEnd}`);
  await ev(`${S}.undo()`);
  check("undo puts the bend back", Math.abs((await ev(`${S}.design.runs.at(-1).points[1].y`)) - drawn.pts[1][1]) < 0.01);
  await ev(`document.querySelector('button[title="Cables"]').click()`);
  await sleep(300);
  check("the Cables button hides the cables", (await ev(`${S}.view.showCables`)) === false);
  await ev(`document.querySelector('button[title="Cables"]').click()`);
  await ev(`${S}.select({ kind: 'run', id: 'feeder-D4' }); ${S}.set({ activeDeckId: 'D4' })`);
  await sleep(1200);
  check("selecting a cable opens its inspector with its flag", await ev(`document.body.innerText.includes('Switchboard feeder cable') && document.body.innerText.includes('runs through Galley')`));
  await shot("cable-inspector");

  const errors = await ev(`${S}.analysis.errors`);
  check("no calculation errors", errors.length === 0, errors.join("; "));
  ws.close();
}

main()
  .catch((e) => {
    console.error(e);
    results.push(false);
  })
  .finally(() => {
    chrome.kill();
    const failed = results.filter((x) => !x).length;
    if (browserErrors.length) console.log(`\nBrowser console errors (${browserErrors.length}):\n  ${[...new Set(browserErrors)].slice(0, 8).join("\n  ")}`);
    console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots and PDF in ${outDir}`);
    process.exit(failed ? 1 : 0);
  });
