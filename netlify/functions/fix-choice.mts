// Netlify Function: picks one of the already-verified fix options with a small model on OpenRouter.
// GET  /api/fix-choice  -> { ok, model }                 (is the key configured?)
// POST /api/fix-choice  -> { choice, reason, model }     (body: { rule, title, finding, options: [{ id, label, size }] })
//
// The key stays on the server (Netlify environment variable OPENROUTER_API_KEY). Inputs are size-capped, the answer
// is forced into a JSON schema whose `choice` must be one of the given ids, and every failure returns an error the
// browser treats as "no AI" (it then keeps the smallest change). Light rate limit and cache per warm instance;
// the hard spending cap is the credit limit on the OpenRouter key.

// Paid models first (fast, about $0.0002 per choice); free models when the account has no credit (OpenRouter
// answers 402) - free models are rate-limited by OpenRouter, so they are only the fallback.
const MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash-lite";
const FALLBACK = process.env.OPENROUTER_FALLBACK_MODEL || "openai/gpt-4.1-nano";
const FREE = (process.env.OPENROUTER_FREE_MODELS || "nvidia/nemotron-3.5-super-vl:free,dots-studio/dots-3-note-preview:free,google/gemma-4-31b-it:free").split(",").map((x) => x.trim()).filter(Boolean);
let paidBlockedUntil = 0; // after a 402 (no credit) skip the paid models for 10 minutes
const LIMIT_PER_10_MIN = 40;

const hits = new Map<string, number[]>();
const cache = new Map<string, { choice: string; reason: string; model: string }>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Option = { id: string; label: string; size: number };
type Body = { rule: string; title: string; finding: string; options: Option[] };

function valid(b: unknown): b is Body {
  const x = b as Body;
  return (
    !!x &&
    typeof x.rule === "string" && x.rule.length <= 60 &&
    typeof x.title === "string" && x.title.length <= 120 &&
    typeof x.finding === "string" && x.finding.length <= 400 &&
    Array.isArray(x.options) && x.options.length >= 2 && x.options.length <= 5 &&
    x.options.every((o) => o && typeof o.id === "string" && o.id.length <= 24 && typeof o.label === "string" && o.label.length <= 200 && typeof o.size === "number")
  );
}

export default async (req: Request, context: { ip?: string }) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (req.method === "GET") return json({ ok: !!key, model: MODEL });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!key) return json({ error: "AI is not configured" }, 503);

  const raw = await req.text();
  if (raw.length > 6000) return json({ error: "request too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!valid(body)) return json({ error: "bad request" }, 400);

  // light rate limit per visitor (per warm function instance)
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "anon";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= LIMIT_PER_10_MIN) return json({ error: "too many requests" }, 429);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();

  const cacheKey = JSON.stringify([body.rule, body.finding, body.options.map((o) => [o.id, o.label])]);
  const cached = cache.get(cacheKey);
  if (cached) return json(cached);

  const ids = body.options.map((o) => o.id);
  const system =
    "You help a ship designer fix one early design-check flag. All options below already pass the deterministic checks; " +
    "choose the one a naval architect would prefer: the least disruptive to the general arrangement, keeping escape routes, " +
    "watertight subdivision and fire safety sensible. Answer with the option id and one short sentence of reason (max 25 words). " +
    "Do not invent options, numbers or regulations.";
  const user = `Rule: ${body.title} (${body.rule})\nFlag: ${body.finding}\nOptions:\n${body.options.map((o) => `- ${o.id}: ${o.label} (change size ${o.size})`).join("\n")}`;

  const schema = {
    type: "json_schema",
    json_schema: {
      name: "fix_choice",
      strict: true,
      schema: {
        type: "object",
        properties: { choice: { type: "string", enum: ids }, reason: { type: "string" } },
        required: ["choice", "reason"],
        additionalProperties: false,
      },
    },
  };
  const deadline = Date.now() + 8500; // stay inside the 10 s limit of a Netlify Function
  const attempts: { models: string[]; paid: boolean }[] = [];
  if (Date.now() >= paidBlockedUntil) attempts.push({ models: [MODEL, FALLBACK], paid: true });
  for (const m of FREE) attempts.push({ models: [m], paid: false });
  let last = "no model available";
  for (const at of attempts) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    const out = await ask(key, at.models, system, user, schema, ids, Math.min(left, at.paid ? 5000 : 6000), !at.paid);
    if ("status" in out) {
      last = out.status;
      if (at.paid && out.status === "402") paidBlockedUntil = Date.now() + 10 * 60 * 1000;
      continue;
    }
    if (cache.size > 500) cache.clear();
    cache.set(cacheKey, out);
    return json(out);
  }
  return json({ error: `AI unavailable (${last})` }, 503);
};

async function ask(
  key: string,
  models: string[],
  system: string,
  user: string,
  schema: unknown,
  ids: string[],
  ms: number,
  noReasoning: boolean,
): Promise<{ choice: string; reason: string; model: string } | { status: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.URL || "https://localhost",
        "X-Title": "Ship Design Pre-Check",
      },
      body: JSON.stringify({
        models,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: 160,
        ...(noReasoning ? { reasoning: { enabled: false } } : {}), // free reasoning models would spend the tokens thinking
        response_format: schema,
      }),
    });
    if (!r.ok) return { status: String(r.status) };
    const j = (await r.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { choice?: string; reason?: string };
    if (!parsed.choice || !ids.includes(parsed.choice)) return { status: "invalid answer" };
    return { choice: parsed.choice, reason: String(parsed.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200), model: j.model || models[0] };
  } catch {
    return { status: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}

export const config = { path: "/api/fix-choice" };
