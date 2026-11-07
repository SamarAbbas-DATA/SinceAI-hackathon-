// Web Worker: plans the fixes off the main thread so the 3D view stays smooth while candidates are tested.
// Messages in:  { type: "plan", design, useAI } | { type: "choice", reqId, answer }
// Messages out: { type: "progress", text, done, total } | { type: "choose", reqId, req } | { type: "done", plan } | { type: "error", message }
import { planFixes, type ChooseRequest } from "./fixes";
import type { Design } from "./types";

type In = { type: "plan"; design: Design; useAI: boolean } | { type: "choice"; reqId: number; answer: { choice: string; reason: string; model?: string } | null };

const waiting = new Map<number, (a: { choice: string; reason: string; model?: string } | null) => void>();
let reqN = 0;

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "choice") {
    waiting.get(m.reqId)?.(m.answer);
    waiting.delete(m.reqId);
    return;
  }
  try {
    const plan = await planFixes(m.design, {
      choose: m.useAI
        ? (req: ChooseRequest) =>
            new Promise((resolve) => {
              const reqId = ++reqN;
              waiting.set(reqId, resolve);
              (self as unknown as Worker).postMessage({ type: "choose", reqId, req });
            })
        : undefined,
      progress: (text, done, total) => (self as unknown as Worker).postMessage({ type: "progress", text, done, total }),
    });
    (self as unknown as Worker).postMessage({ type: "done", plan });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", message: (err as Error).message });
  }
};
