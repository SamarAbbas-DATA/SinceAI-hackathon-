/// <reference lib="webworker" />
/** Runs OpenCascade off the main thread so the UI never freezes while the kernel loads (about 10 MB) or works. */
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { setOC } from "replicad";
import { buildHullStep, readStep, type Section } from "./kernel";

let ready: Promise<void> | null = null;
function init() {
  if (!ready)
    ready = (async () => {
      const OC = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => wasmUrl });
      setOC(OC as never);
    })();
  return ready;
}

type Req = { id: number; type: "init" } | { id: number; type: "hullStep"; sections: Section[] } | { id: number; type: "readStep"; data: ArrayBuffer };

self.onmessage = async (e: MessageEvent<Req>) => {
  const r = e.data;
  try {
    await init();
    if (r.type === "init") return self.postMessage({ id: r.id, ok: true });
    if (r.type === "hullStep") {
      const out = await buildHullStep(r.sections);
      return self.postMessage({ id: r.id, ok: true, ...out }, [out.step]);
    }
    if (r.type === "readStep") {
      const out = await readStep(r.data);
      return self.postMessage({ id: r.id, ok: true, ...out }, [out.vertices.buffer, out.triangles.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: r.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
