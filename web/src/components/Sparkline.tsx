/** A tiny inline SVG trend line with an end-dot — the at-a-glance pulse next to a
 *  number. Color encodes direction by default (up = hop, down = brick). */
export function Sparkline({ values, width = 84, height = 22, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const px = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const py = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const rising = values[values.length - 1] >= values[0];
  const stroke = color ?? (rising ? "var(--color-hop)" : "var(--color-brick)");
  return (
    <svg width={width} height={height} className="inline-block align-middle" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r="2" fill={stroke} />
    </svg>
  );
}
