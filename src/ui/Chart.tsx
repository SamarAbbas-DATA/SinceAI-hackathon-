// Minimal SVG line chart (no charting dependency).
export interface Series {
  name: string;
  color: string;
  points: [number, number][];
  dashed?: boolean;
}

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function Chart({
  series,
  xLabel,
  yLabel,
  height = 200,
  vLines = [],
  hLines = [],
}: {
  series: Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
  vLines?: { x: number; label: string; color?: string }[];
  hLines?: { y: number; label: string; color?: string }[];
}) {
  const W = 340,
    H = height,
    m = { l: 44, r: 10, t: 10, b: 32 };
  const all = series.flatMap((s) => s.points).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!all.length) return <div className="p-4 text-xs text-muted">No data</div>;
  let x0 = Math.min(...all.map((p) => p[0]), ...vLines.map((v) => v.x)),
    x1 = Math.max(...all.map((p) => p[0]), ...vLines.map((v) => v.x));
  let y0 = Math.min(0, ...all.map((p) => p[1]), ...hLines.map((h) => h.y)),
    y1 = Math.max(...all.map((p) => p[1]), ...hLines.map((h) => h.y));
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) y1 = y0 + 1;
  y1 += (y1 - y0) * 0.05;
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const xt = ticks(x0, x1),
    yt = ticks(y0, y1);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke="var(--chart-grid)" />
            <text x={m.l - 4} y={sy(v) + 3} fontSize="9" textAnchor="end" fill="var(--muted)">
              {Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : +v.toFixed(3)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line x1={sx(v)} x2={sx(v)} y1={m.t} y2={H - m.b} stroke="var(--chart-grid)" />
            <text x={sx(v)} y={H - m.b + 12} fontSize="9" textAnchor="middle" fill="var(--muted)">
              {+v.toFixed(3)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} stroke="var(--chart-axis)" />
        {hLines.map((h, i) => (
          <g key={`h${i}`}>
            <line x1={m.l} x2={W - m.r} y1={sy(h.y)} y2={sy(h.y)} stroke={h.color ?? "#e63946"} strokeDasharray="4 3" />
            <text x={W - m.r - 2} y={sy(h.y) - 3} fontSize="9" textAnchor="end" fill={h.color ?? "#e63946"}>
              {h.label}
            </text>
          </g>
        ))}
        {vLines.map((v, i) => (
          <g key={`v${i}`}>
            <line x1={sx(v.x)} x2={sx(v.x)} y1={m.t} y2={H - m.b} stroke={v.color ?? "#64748b"} strokeDasharray="4 3" />
            <text x={sx(v.x) + 3} y={m.t + 9} fontSize="9" fill={v.color ?? "#64748b"}>
              {v.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth={1.8}
            strokeDasharray={s.dashed ? "5 3" : undefined}
            points={s.points
              .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
              .map(([x, y]) => `${sx(x)},${sy(y)}`)
              .join(" ")}
          />
        ))}
        <text x={(W + m.l) / 2} y={H - 4} fontSize="10" textAnchor="middle" fill="var(--fg)">
          {xLabel}
        </text>
        <text x={10} y={(H - m.b) / 2} fontSize="10" textAnchor="middle" fill="var(--fg)" transform={`rotate(-90 10 ${(H - m.b) / 2})`}>
          {yLabel}
        </text>
      </svg>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 px-1 text-[11px] text-muted">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
