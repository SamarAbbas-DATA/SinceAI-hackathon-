/** Promise wrapper around the CAD kernel worker. The worker (and its wasm) loads on first use only. */
import type { Section } from "./kernel";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();

function w() {
  if (!worker) {
    worker = new Worker(new URL("./occ.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.res(e.data);
      else p.rej(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.rej(new Error(e.message || "CAD kernel failed to load"));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function call<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej });
    w().postMessage({ id, ...msg }, transfer);
  });
}

export const occInit = () => call<{ ok: true }>({ type: "init" });
export const occHullStep = (sections: Section[]) => call<{ step: ArrayBuffer; volume: number; bounds: [[number, number, number], [number, number, number]] }>({ type: "hullStep", sections });
export const occReadStep = (data: ArrayBuffer) => call<{ vertices: Float32Array; triangles: Uint32Array; volume: number }>({ type: "readStep", data }, [data]);
