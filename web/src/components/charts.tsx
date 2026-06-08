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
