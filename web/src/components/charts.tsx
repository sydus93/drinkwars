/** Minimal dependency-free SVG charts, styled to the palette. */

const W = 320;
const H = 110;
const PAD = 8;

export interface Series {
  label: string;
  color: string;
  data: number[];
}

export function LineChart({ series, formatY = (n: number) => n.toFixed(0), zeroBaseline = false }: { series: Series[]; formatY?: (n: number) => string; zeroBaseline?: boolean }) {
  const all = series.flatMap((s) => s.data).filter((n) => Number.isFinite(n));
  if (all.length === 0) return <div className="text-xs text-inksoft">No data yet.</div>;
  let min = Math.min(...all, zeroBaseline ? 0 : Infinity);
  let max = Math.max(...all, zeroBaseline ? 0 : -Infinity);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const len = Math.max(...series.map((s) => s.data.length), 1);
  const x = (i: number) => PAD + (len <= 1 ? 0 : (i / (len - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD);
  const zeroY = y(0);
  const showZero = min < 0 && max > 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full">
      {showZero && <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="var(--color-line2)" strokeWidth="1" strokeDasharray="3 3" />}
      {series.map((s, si) => {
        const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const lastI = s.data.length - 1;
        return (
          <g key={si}>
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {lastI >= 0 && <circle cx={x(lastI)} cy={y(s.data[lastI])} r="2.6" fill={s.color} />}
          </g>
        );
      })}
      <text x={PAD} y={11} fontSize="9" fill="var(--color-inksoft)" fontFamily="var(--font-mono)">{formatY(max)}</text>
      <text x={PAD} y={H - 2} fontSize="9" fill="var(--color-inksoft)" fontFamily="var(--font-mono)">{formatY(min)}</text>
    </svg>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1 text-[0.68rem] text-inksoft">
          <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export interface ScatterPoint {
  label: string;
  color: string;
  x: number;
  y: number;
  size?: number; // radius, default 4
  faded?: boolean; // exited / inactive
}

/** Dependency-free 2D scatter with labelled axes. Points are plotted on auto-scaled
 *  axes; each carries its own color/size/fade. Used for the strategy map (single-
 *  player) and the instructor strategy panel (every team plotted at once). */
export function Scatter({ points, xLabel, yLabel }: { points: ScatterPoint[]; xLabel: string; yLabel: string }) {
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finite.length === 0) return <div className="text-xs text-inksoft">No data yet.</div>;
  const SW = 360, SH = 260, L = 44, RM = 16, TM = 14, BM = 40;
  const xs = finite.map((p) => p.x);
  const ys = finite.map((p) => p.y);
  let xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (xmin === xmax) { xmin -= 1; xmax += 1; }
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const sx = (v: number) => L + ((v - xmin) / (xmax - xmin)) * (SW - L - RM);
  const sy = (v: number) => SH - BM - ((v - ymin) / (ymax - ymin)) * (SH - TM - BM);

  return (
    <svg viewBox={`0 0 ${SW} ${SH}`} className="w-full">
      <line x1={L} y1={SH - BM} x2={SW - RM} y2={SH - BM} stroke="var(--color-line2)" />
      <line x1={L} y1={TM} x2={L} y2={SH - BM} stroke="var(--color-line2)" />
      <text x={(L + SW - RM) / 2} y={SH - 6} fontSize="10" textAnchor="middle" fill="var(--color-inksoft)" fontFamily="var(--font-mono)">{xLabel} →</text>
      <text transform={`rotate(-90 12 ${(TM + SH - BM) / 2})`} x={12} y={(TM + SH - BM) / 2} fontSize="10" textAnchor="middle" fill="var(--color-inksoft)" fontFamily="var(--font-mono)">↑ {yLabel}</text>
      {finite.map((p, i) => {
        const r = p.size ?? 4;
        return (
          <g key={i} opacity={p.faded ? 0.4 : 1}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={r} fill={p.color} />
            <text x={sx(p.x) + r + 2} y={sy(p.y) + 3} fontSize="8.5" fill={p.color} fontFamily="var(--font-mono)">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal comparison bar: your value against a reference range (field). */
export function CompareBar({ label, you, ref_, max, fmt }: { label: string; you: number; ref_: number; max: number; fmt: (n: number) => string }) {
  const m = max > 0 ? max : 1;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-inksoft">{label}</span>
        <span className="tnum">
          <span className="font-semibold text-copperdeep">{fmt(you)}</span> <span className="text-inksoft">· field {fmt(ref_)}</span>
        </span>
      </div>
      <div className="relative mt-1 h-2 w-full rounded-[2px] bg-line">
        <div className="absolute top-0 h-full rounded-[2px] bg-copper" style={{ width: `${Math.min(100, (you / m) * 100)}%` }} />
        <div className="absolute top-[-2px] h-3 w-[2px] bg-ink" style={{ left: `${Math.min(100, (ref_ / m) * 100)}%` }} title="field median" />
      </div>
    </div>
  );
}
