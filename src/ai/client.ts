// Client for the optional AI choice service (Netlify Function /api/fix-choice, which calls OpenRouter).
// Everything here fails soft: if the service is missing, slow or out of credit, the fix run keeps the
// smallest verified change instead. The AI never sees or returns geometry, only option ids.
import type { ChooseRequest } from "../engine/fixes";

const URL_ = "/api/fix-choice";

export interface AIStatus {
  ok: boolean;
  model?: string;
}

async function withTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Is the AI service configured and reachable? (A missing function on a plain static host just answers "offline".) */
export async function aiStatus(): Promise<AIStatus> {
  if (import.meta.env.DEV && (window as unknown as { __fakeAI?: unknown }).__fakeAI) return { ok: true, model: "test" };
  try {
    const r = await withTimeout(URL_, { method: "GET" }, 4000);
    if (!r.ok) return { ok: false };
    const j = (await r.json()) as { ok?: boolean; model?: string };
    return { ok: !!j.ok, model: j.model };
  } catch {
    return { ok: false };
  }
}

/** Ask the AI to pick one of the verified options. Returns null on any problem. */
export async function aiChoose(req: ChooseRequest): Promise<{ choice: string; reason: string; model?: string } | null> {
  const fake = import.meta.env.DEV ? (window as unknown as { __fakeAI?: (r: ChooseRequest) => { choice: string; reason: string } }).__fakeAI : undefined;
  if (fake) return fake(req);
  try {
    const r = await withTimeout(URL_, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) }, 10000);
    if (!r.ok) return null;
    const j = (await r.json()) as { choice?: string; reason?: string; model?: string };
    if (typeof j.choice !== "string" || !req.options.some((o) => o.id === j.choice)) return null;
    return { choice: j.choice, reason: String(j.reason ?? "").slice(0, 200), model: j.model };
  } catch {
    return null;
  }
}
