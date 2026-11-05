import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import type { Status } from "../engine/types";
import { STATUS_VAR } from "./theme";

// Minimal controls: underline inputs, hairline separators, no filled chips.
const inputCls = "border-0 border-b border-line bg-transparent px-0.5 py-0.5 text-fg outline-none transition-colors focus:border-accent";

export function Num({ label, value, onChange, step = 0.1, unit, min, max, digits = 2, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string; min?: number; max?: number; digits?: number; hint?: string }) {
  const [txt, setTxt] = useState(String(+value.toFixed(digits)));
  useEffect(() => setTxt(String(+value.toFixed(digits))), [value, digits]);
  const commit = () => {
    const v = parseFloat(txt);
    if (Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
    else setTxt(String(value));
  };
  return (
    <label className="flex items-center justify-between gap-3 py-[3px] text-[12px]" title={hint}>
      <span className="text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <input
          className={`w-20 text-right tabular-nums ${inputCls}`}
          value={txt}
          inputMode="decimal"
          onChange={(e) => setTxt(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const v = (parseFloat(txt) || 0) + (e.key === "ArrowUp" ? step : -step);
              onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, +v.toFixed(6))));
            }
            e.stopPropagation();
          }}
        />
        <span className="w-9 text-[10.5px] text-faint">{unit ?? ""}</span>
      </span>
    </label>
  );
}

export function Slider({ label, value, onChange, min, max, step, unit, digits = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; unit?: string; digits?: number }) {
  return (
    <label className="block py-1 text-[12px]">
      <span className="flex justify-between">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          {value.toFixed(digits)} <span className="text-faint">{unit}</span>
        </span>
      </span>
      <input type="range" className="mt-0.5 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}

export function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (
    <label className="flex items-center justify-between gap-3 py-[3px] text-[12px]">
      <span className="text-muted">{label}</span>
      <input
        className={`w-44 text-right ${inputCls}`}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => txt !== value && onChange(txt)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-[3px] text-[12px]">
      <span className="text-muted">{label}</span>
      <select className={`max-w-48 cursor-pointer text-right ${inputCls}`} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-[3px] text-[12px]">
      <span className="text-muted">{label}</span>
      <span className={`relative h-[14px] w-[26px] rounded-full border transition-colors ${value ? "border-accent bg-accent" : "border-line bg-transparent"}`}>
        <span className={`absolute top-[2px] h-2 w-2 rounded-full transition-all ${value ? "left-[14px] bg-on-accent" : "left-[2px] bg-faint"}`} />
        <input type="checkbox" className="absolute inset-0 cursor-pointer opacity-0" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}

export function Section({ title, children, right, delay = 0 }: { title: string; children: ReactNode; right?: ReactNode; delay?: number }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="label anim-wipe" style={{ animationDelay: `${delay}ms` }}>
          {title}
        </h3>
        {right}
      </div>
      <div className="anim-rise" style={{ animationDelay: `${delay + 60}ms` }}>
        {children}
      </div>
    </section>
  );
}

/** Status shown as a small dot and a word in the status colour. */
export function Badge({ status, children }: { status: Status; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color: STATUS_VAR[status] }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_VAR[status] }} />
      {children ?? status}
    </span>
  );
}

export function Dot({ status, size = 6, style }: { status: Status; size?: number; style?: CSSProperties }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: STATUS_VAR[status], ...style }} />;
}

export function KV({ k, v, unit }: { k: string; v: string | number; unit?: string }) {
  return (
    <div className="flex justify-between py-[3px] text-[12px]">
      <span className="text-muted">{k}</span>
      <span className="tabular-nums">
        {v}
        {unit && <span className="ml-1 text-faint">{unit}</span>}
      </span>
    </div>
  );
}

export function Btn({ children, onClick, kind = "default", title, disabled, className = "" }: { children: ReactNode; onClick: () => void; kind?: "default" | "primary" | "danger" | "ghost"; title?: string; disabled?: boolean; className?: string }) {
  const cls =
    kind === "primary"
      ? "bg-accent text-on-accent hover:brightness-110"
      : kind === "danger"
        ? "text-bad hover:bg-surface-2"
        : kind === "ghost"
          ? "text-muted hover:text-fg"
          : "border border-line text-fg hover:border-faint";
  return (
    <button title={title} disabled={disabled} className={`rounded-[5px] px-2.5 py-[3px] text-[11.5px] transition disabled:opacity-35 ${cls} ${className}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** Thin line icon (24 x 24 path data). */
export function Icon({ d, size = 18, stroke = 1.5, className = "", style }: { d: string; size?: number; stroke?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d={d} />
    </svg>
  );
}

export const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d));
