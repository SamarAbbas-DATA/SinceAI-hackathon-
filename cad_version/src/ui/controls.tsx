import { useState, type CSSProperties, type ReactNode } from "react";
import type { Finding, Level } from "../core/analyze";
import type { GzPoint } from "../core/hydro";

export function Icon({ d, size = 16, stroke = 1.5, className = "", style }: { d: string; size?: number; stroke?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  hull: "M2 10h20l-3 7H5l-3-7zM6 10V6h6v4",
  upload: "M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3",
  download: "M12 4v12m0 0l-4-4m4 4l4-4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66l1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14l-1.41-1.41M12 8a4 4 0 100 8 4 4 0 000-8z",
  moon: "M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z",
  reset: "M4 4v6h6M20 20v-6h-6M5.5 15A7 7 0 0018 17.5M18.5 9A7 7 0 006 6.5",
};

export const levelColor: Record<Level, string> = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--muted)" };

export function Dot({ level }: { level: Level }) {
  return <span className="inline-block h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: levelColor[level] }} />;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{title}</span>
        {right}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export function Slider({ label, value, min, max, step, unit, onChange, help, digits }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; help?: string; digits?: number }) {
  const d = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <div title={help}>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="flex items-baseline gap-1">
          <input
            className="w-14 bg-transparent text-right font-mono text-[12px] text-fg outline-none focus:text-accent"
            value={txt ?? value.toFixed(d)}
            onFocus={(e) => setTxt(e.target.value)}
            onChange={(e) => setTxt(e.target.value)}
            onBlur={() => {
              const v = parseFloat(txt ?? "");
              if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
              setTxt(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          {unit && <span className="w-6 text-[10px] text-faint">{unit}</span>}
        </span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-muted">{label}</span>
      <select className="min-w-0 max-w-[60%] border-b border-line bg-transparent py-0.5 text-right text-[12px] text-fg outline-none" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumField({ label, value, onChange, unit, placeholder }: { label: string; value: string; onChange: (v: string) => void; unit?: string; placeholder?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-baseline gap-1">
        <input className="w-20 border-b border-line bg-transparent text-right font-mono text-[12px] text-fg outline-none focus:border-accent" value={value} placeholder={placeholder} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />
        {unit && <span className="w-6 text-[10px] text-faint">{unit}</span>}
      </span>
    </label>
  );
}

export function Row({ k, v, u, level }: { k: string; v: string; u?: string; level?: Level }) {
  return (
    <div className="flex items-baseline justify-between text-[12px]">
      <span className="flex items-center gap-2 text-muted">
        {level && <Dot level={level} />}
        {k}
      </span>
      <span className="font-mono text-fg">
        {v}
        {u && <span className="ml-1 text-[10px] text-faint">{u}</span>}
      </span>
    </div>
  );
}

export function Tabs<T extends string>({ value, items, onChange }: { value: T; items: { id: T; label: string; badge?: Level }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-4 border-b border-line px-4">
      {items.map((it) => (
        <button key={it.id} onClick={() => onChange(it.id)} className={`relative flex items-center gap-1.5 py-2.5 text-[11px] tracking-[0.08em] uppercase transition-colors ${value === it.id ? "text-fg" : "text-muted hover:text-fg"}`}>
          {it.label}
          {it.badge && it.badge !== "ok" && it.badge !== "info" && <Dot level={it.badge} />}
          {value === it.id && <span className="anim-underline absolute right-0 bottom-0 left-0 h-[2px] bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function FindingRow({ f, i }: { f: Finding; i: number }) {
  return (
    <div className="anim-rise border-b border-line px-4 py-2.5" style={{ animationDelay: `${i * 25}ms` }}>
      <div className="flex items-center gap-2 text-[12.5px] text-fg">
        <Dot level={f.level} />
        <span className="font-medium">{f.title}</span>
      </div>
      <div className="mt-1 pl-[14px] text-[11.5px] leading-snug text-fg/85">{f.message}</div>
      {f.detail && <div className="mt-1 pl-[14px] text-[11px] leading-snug text-muted">{f.detail}</div>}
      {f.fix && (
        <div className="mt-1 pl-[14px] text-[11px] leading-snug">
          <span className="text-accent">Fix </span>
          <span className="text-fg/85">{f.fix}</span>
        </div>
      )}
    </div>
  );
}

export function Btn({ children, onClick, disabled, primary, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; title?: string }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-[7px] px-3 py-2 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${primary ? "text-accent" : "text-fg"} hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]`}
    >
      {children}
    </button>
  );
}

/** GZ curve with the 30 and 40 degree marks, deck edge immersion and the vanishing angle. */
export function GzChart({ gz, scale, deckEdge, vanish }: { gz: GzPoint[]; scale: number; deckEdge: number | null; vanish: number }) {
  if (!gz.length) return null;
  const W = 300, H = 150, l = 34, r = 8, t = 10, b = 22;
  const vals = gz.map((p) => p.gz * scale);
  const ymax = Math.max(0.05, ...vals) * 1.15;
  const ymin = Math.max(Math.min(0, ...vals), -ymax * 0.6) * 1.1; // keep the righting part readable
  const X = (a: number) => l + ((W - l - r) * a) / 90;
  const Y = (v: number) => t + ((H - t - b) * (ymax - Math.max(ymin, v))) / (ymax - ymin || 1);
  const path = gz.map((p, i) => `${i ? "L" : "M"}${X(p.heel).toFixed(1)},${Y(p.gz * scale).toFixed(1)}`).join("");
  const ticks = [0, 15, 30, 45, 60, 75, 90];
  const yt = [0, ymax / 2, ymax];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map((a) => (
        <g key={a}>
          <line x1={X(a)} x2={X(a)} y1={t} y2={H - b} stroke="var(--chart-grid)" />
          <text x={X(a)} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--faint)">
            {a}
          </text>
        </g>
      ))}
      {yt.map((v) => (
        <text key={v} x={l - 5} y={Y(v) + 3} fontSize="9" textAnchor="end" fill="var(--faint)">
          {v.toFixed(2)}
        </text>
      ))}
      <line x1={l} x2={W - r} y1={Y(0)} y2={Y(0)} stroke="var(--chart-axis)" />
      {[30, 40].map((a) => (
        <line key={a} x1={X(a)} x2={X(a)} y1={t} y2={H - b} stroke="var(--muted)" strokeDasharray="2 3" />
      ))}
      {deckEdge !== null && <line x1={X(deckEdge)} x2={X(deckEdge)} y1={t} y2={H - b} stroke="var(--warn)" strokeDasharray="1 2" />}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {vanish < 90 && <circle cx={X(vanish)} cy={Y(0)} r={2.5} fill="var(--bad)" />}
      <text x={W - r} y={t + 8} fontSize="9" textAnchor="end" fill="var(--muted)">
        GZ (m, full scale) vs heel (deg)
      </text>
    </svg>
  );
}
