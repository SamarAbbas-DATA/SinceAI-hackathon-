// Browser test: drives the built app in headless Chrome over the DevTools protocol.
// Usage: npm run build && npm run e2e   (starts vite preview itself)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
const PORT = 9333, APP = 4180;
const outDir = path.resolve("e2e-output");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hw-e2e-"));
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(APP), "--strictPort", "--host", "127.0.0.1"], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmp}`, "--window-size=1600,900", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const check = (name, ok, info = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`));

async function main() {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${APP}/`)).ok) break; } catch { await sleep(300); } }
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:${APP}/`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
  };
  const send = (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval error");
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.result.data, "base64"));
  };
  const clickText = (t) => ev(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes(${JSON.stringify(t)})); if (!b) return false; b.click(); return true; })()`);
  const waitText = async (t, ms = 60000) => { for (let i = 0; i < ms / 250; i++) { if (await ev(`document.body.innerText.includes(${JSON.stringify(t)})`)) return true; await sleep(250); } return false; };
  const files = () => fs.readdirSync(outDir);
  const waitFile = async (ext, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { const f = files().find((x) => x.endsWith(ext)); if (f) { await sleep(300); return f; } await sleep(250); } return null; };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: outDir });
  check("app renders", await waitText("Hull Workshop", 20000), errors.join(" | ").slice(0, 600) + " BODY:" + (await ev("document.body.innerHTML.slice(0,300)")));
  if (!results[0]) throw new Error("no render");
  check("checks list shows", await waitText("watertight solid"));
  await sleep(1500);
  await shot("1-float");

  await clickText("On the print bed");
  await sleep(1000);
  await shot("2-printbed");
  await clickText("In water");

  await clickText("Stability");
  check("GZ chart and IS Code table", await waitText("Angle of max GZ"));
  await sleep(500);
  await shot("3-stability");

  await clickText("Export");
  await sleep(300);
  await clickText("STEP solid");
  check("STEP built in the browser worker", await waitText("STEP solid written", 90000));
  const step = await waitFile(".step");
  check("STEP file downloaded", !!step, step ?? "");
  if (step) check("STEP header", fs.readFileSync(path.join(outDir, step), "utf8").startsWith("ISO-10303-21"));
  const msg = await ev(`[...document.querySelectorAll("div")].map(d=>d.textContent).find(t=>t.startsWith("STEP solid written"))`);
  console.log("      ", msg);
  await clickText("3MF (.3mf)");
  const tmf = await waitFile(".3mf");
  check("3MF downloaded", !!tmf);
  await clickText("STL (.stl)");
  const stl = await waitFile(".stl");
  check("STL downloaded", !!stl);
  if (stl) { const b = fs.readFileSync(path.join(outDir, stl)); check("STL size matches triangle count", b.length === 84 + 50 * b.readUInt32LE(80), `${b.readUInt32LE(80)} triangles`); }
  await clickText("OBJ (.obj)"); check("OBJ downloaded", !!(await waitFile(".obj")));
  await clickText("glTF binary"); check("GLB downloaded", !!(await waitFile(".glb")));
  await clickText("Check report"); check("report downloaded", !!(await waitFile(".txt")));
  await shot("4-export");

  // import the STEP we just exported: STEP -> kernel -> mesh -> analysis
  if (step) {
    await clickText("Import");
    await sleep(300);
    const doc = await send("DOM.getDocument", {});
    const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "input[type=file]" });
    await send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [path.join(outDir, step)] });
    await clickText("Checks");
    check("imported STEP is a watertight solid", await waitText("Closed, watertight solid", 60000));
    check("imported STEP floats", await waitText("Draft", 20000));
    await clickText("Checks");
    await sleep(800);
    await shot("5-import-step");
  }
  if (stl) {
    const doc = await send("DOM.getDocument", {});
    const q = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "input[type=file]" });
    await send("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [path.join(outDir, stl)] });
    await sleep(1500);
    check("re-imported STL is watertight", await waitText("Closed, watertight solid", 20000));
  }
  await ev(`document.querySelector("button[title=Theme]").click()`);
  await clickText("Design");
  await sleep(1200);
  await shot("6-light");
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
}

main()
  .catch((e) => (console.error(e), results.push(false)))
  .finally(() => {
    chrome.kill();
    server.kill();
    const ok = results.every(Boolean);
    console.log(ok ? `\nALL ${results.length} PASSED` : `\n${results.filter((r) => !r).length} FAILED`);
    setTimeout(() => process.exit(ok ? 0 : 1), 500);
  });
