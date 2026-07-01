/** Minimal dependency-free SVG charts, styled to the palette. */
import type { ReactNode } from "react";
import { MONEY_DISPLAY } from "../labels.js";

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
      <text x={PAD} y={11} fontSize="9" fill="var(--color-inksoft)" fontFamily="var(--font-body)" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{formatY(max)}</text>
      <text x={PAD} y={H - 2} fontSize="9" fill="var(--color-inksoft)" fontFamily="var(--font-body)" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{formatY(min)}</text>
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

// ─────────────────────────────────────────────────────────────────────────────
// Editorial Tufte suite — ported from the Claude Design "Core Loop" prototype.
// Hand-drawn SVG, direct-labeled, palette-themed. Fed by real round results.
// ─────────────────────────────────────────────────────────────────────────────

const moneyK = (raw: number): string => {
  const n = raw * MONEY_DISPLAY; // charts receive engine-native money; show at the app's display scale
  const a = Math.abs(n);
  return (n < 0 ? "−$" : "$") + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : `${Math.round(a)}`);
};

type TxtProps = { x: number; y: number; children: ReactNode; fill?: string; size?: number; weight?: number; anchor?: "start" | "middle" | "end"; italic?: boolean; tab?: boolean };
function Txt({ x, y, children, fill = "var(--color-ink)", size = 10, weight = 500, anchor = "start", italic = false, tab = false }: TxtProps) {
  return (
    <text x={x} y={y} fill={fill} fontSize={size} fontWeight={weight} textAnchor={anchor} fontStyle={italic ? "italic" : undefined} fontFamily={tab ? "var(--font-body)" : "'IBM Plex Sans', sans-serif"} style={tab ? { fontVariantNumeric: "tabular-nums lining-nums" } : undefined}>{children}</text>
  );
}

/** P&L bridge — revenue stepping down through costs to net income. */
export function Waterfall({ revenue, cogs, opex, other, net }: { revenue: number; cogs: number; opex: number; other: number; net: number }) {
  const VW = 300, VH = 168, padL = 8, padB = 26, padT = 18;
  const steps = [
    { label: "Revenue", val: revenue, color: "var(--color-copper)", total: false },
    { label: "COGS", val: -cogs, color: "var(--color-clay)", total: false },
    { label: "Opex", val: -opex, color: "var(--color-plum)", total: false },
    { label: "Other", val: -other, color: "var(--color-aero)", total: false },
    { label: "Net", val: net, color: net >= 0 ? "var(--color-hop)" : "var(--color-brick)", total: true },
  ];
  let run = 0;
  const tops: [number, number][] = [];
  steps.forEach((s) => { if (s.total) tops.push([0, net]); else { tops.push([run, run + s.val]); run += s.val; } });
  const allv = [0, revenue, run, net];
  const mx = Math.max(...allv) * 1.08, mn = Math.min(0, ...allv), span = mx - mn || 1;
  const yOf = (v: number) => padT + (1 - (v - mn) / span) * (VH - padT - padB);
  const bw = ((VW - padL * 2) / steps.length) * 0.62, gap = (VW - padL * 2) / steps.length;
  return (
    <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
      <line x1={padL} y1={yOf(0)} x2={VW - padL} y2={yOf(0)} stroke="var(--color-line2)" strokeWidth={1} />
      {steps.map((s, i) => {
        const cx = padL + gap * i + gap / 2; const [a, b] = tops[i];
        const y1 = yOf(Math.max(a, b)), y2 = yOf(Math.min(a, b));
        const connector = i < steps.length - 1 && !steps[i + 1].total;
        return (
          <g key={s.label}>
            <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(2, y2 - y1)} fill={s.color} rx={2} opacity={s.total ? 1 : 0.9} />
            <Txt x={cx} y={y1 - 4} anchor="middle" size={10} weight={600} tab>{moneyK(s.val)}</Txt>
            <Txt x={cx} y={VH - 9} anchor="middle" size={10} weight={500} fill="var(--color-inksoft)">{s.label}</Txt>
            {connector && <line x1={cx + bw / 2} y1={yOf(b)} x2={cx + gap - bw / 2} y2={yOf(b)} stroke="var(--color-inksoft)" strokeWidth={1} strokeDasharray="2 2" opacity={0.55} />}
          </g>
        );
      })}
    </svg>
  );
}

type Score = { financial: number; market: number; intangible: number; stakeholder: number };
/** Scorecard radar — your four normalized pillars (vs the field average when supplied). */
export function RadialScore({ you, field }: { you: Score; field?: Score | null }) {
  const S = 200, c = S / 2, R = 70;
  const axes: [keyof Score, string][] = [["financial", "Financial"], ["market", "Market"], ["intangible", "Intangible"], ["stakeholder", "Stakeholder"]];
  const ang = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const pt = (i: number, v: number): [number, number] => [c + Math.cos(ang(i)) * R * v, c + Math.sin(ang(i)) * R * v];
  const ringPath = (g: number) => axes.map((_, i) => { const q = pt(i, g); return `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }).join(" ") + " Z";
  const polyPath = (vals: Score) => axes.map(([k], i) => { const q = pt(i, Math.max(0, Math.min(1, vals[k]))); return `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`; }).join(" ") + " Z";
  return (
    <svg width={250} height={165} viewBox="-64 -4 318 210" style={{ maxWidth: "100%" }}>
      {[0.25, 0.5, 0.75, 1].map((g) => <path key={g} d={ringPath(g)} fill="none" stroke="var(--color-line2)" strokeWidth={0.75} opacity={0.55} />)}
      {axes.map((_, i) => { const q = pt(i, 1); return <line key={i} x1={c} y1={c} x2={q[0]} y2={q[1]} stroke="var(--color-line2)" strokeWidth={0.75} opacity={0.55} />; })}
      {field && <path d={polyPath(field)} fill="none" stroke="var(--color-inksoft)" strokeWidth={1.5} strokeDasharray="3 2" strokeLinejoin="round" />}
      <path d={polyPath(you)} fill="var(--color-copper)" fillOpacity={0.16} stroke="var(--color-copper)" strokeWidth={2} strokeLinejoin="round" />
      {axes.map(([k], i) => { const q = pt(i, Math.max(0, Math.min(1, you[k]))); return <circle key={k} cx={q[0]} cy={q[1]} r={2.6} fill="var(--color-copper)" />; })}
      {axes.map(([, lab], i) => { const q = pt(i, 1.24); const anchor = Math.abs(Math.cos(ang(i))) < 0.3 ? "middle" : Math.cos(ang(i)) > 0 ? "start" : "end"; return <Txt key={lab} x={q[0]} y={q[1] + 3} anchor={anchor} size={10} weight={600} fill="var(--color-inksoft)">{lab}</Txt>; })}
    </svg>
  );
}

/** Where you stand in the field — histogram of a public metric with your bin lit. */
export function Distribution({ vals, you, fmtTick = (n) => n.toFixed(1) }: { vals: number[]; you: number; fmtTick?: (n: number) => string }) {
  const VW = 300, VH = 140, padL = 8, padB = 26, padT = 10;
  if (vals.length === 0) return null;
  const mn = Math.min(...vals, you), mx = Math.max(...vals, you);
  const nb = 6, step = (mx - mn) / nb || 1;
  const bins = new Array(nb).fill(0);
  vals.forEach((v) => { let i = Math.floor((v - mn) / step); if (i >= nb) i = nb - 1; if (i < 0) i = 0; bins[i]++; });
  const bmx = Math.max(...bins) || 1, bw = (VW - padL * 2) / nb;
  const yOf = (count: number) => padT + (1 - count / bmx) * (VH - padT - padB);
  const youBin = Math.min(nb - 1, Math.max(0, Math.floor((you - mn) / step)));
  return (
    <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
      {bins.map((count, i) => { const x = padL + bw * i, y = yOf(count); return (
        <g key={i}>
          <rect x={x + 1.5} y={y} width={bw - 3} height={VH - padB - y} fill={i === youBin ? "var(--color-copper)" : "var(--color-clay)"} opacity={i === youBin ? 1 : 0.5} rx={2} />
          <Txt x={x + bw / 2} y={VH - 13} anchor="middle" size={9} fill="var(--color-inksoft)" tab>{fmtTick(mn + step * i)}</Txt>
        </g>
      ); })}
      <Txt x={padL + bw * youBin + bw / 2} y={yOf(bins[youBin]) - 5} anchor="middle" size={9.5} weight={700} fill="var(--color-copperdeep)">you</Txt>
    </svg>
  );
}
