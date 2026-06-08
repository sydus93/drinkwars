import { useRef } from "react";

const COLORS = ["#b5632b", "#5d7c44", "#c2912f", "#7a6cae"];

/**
 * Unified capacity-allocation control: a single bar split across the active
 * categories with draggable dividers (one for two segments, two for three…),
 * so allocation always sums to 100% and is easy to fine-tune. Controlled.
 */
export function AllocationBar({
  segments,
  weights,
  onChange,
}: {
  segments: { id: string; label: string }[];
  weights: number[]; // any scale; normalized internally to 100
  onChange: (weights: number[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const n = segments.length;

  const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
  const pct = total > 0 ? weights.map((w) => (Math.max(0, w) / total) * 100) : weights.map(() => 100 / n);
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + pct[i]);

  const startDrag = (boundary: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const x = ((ev.clientX - rect.left) / rect.width) * 100;
      const lo = cum[boundary - 1];
      const hi = cum[boundary + 1];
      const clamped = Math.max(lo, Math.min(hi, x));
      const next = [...pct];
      next[boundary - 1] = clamped - lo;
      next[boundary] = hi - clamped;
      onChange(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div>
      <div ref={ref} className="relative h-12 w-full select-none overflow-hidden rounded-[2px] border border-line2">
        {segments.map((s, i) => (
          <div
            key={s.id}
            className="absolute top-0 flex h-full flex-col items-center justify-center overflow-hidden text-paper"
            style={{ left: `${cum[i]}%`, width: `${pct[i]}%`, background: COLORS[i % COLORS.length] }}
          >
            {pct[i] > 12 && (
              <>
                <span className="truncate px-1 text-[0.72rem] font-semibold">{s.label}</span>
                <span className="tnum text-[0.7rem]">{pct[i].toFixed(0)}%</span>
              </>
            )}
          </div>
        ))}
        {Array.from({ length: n - 1 }, (_, k) => k + 1).map((b) => (
          <div
            key={b}
            onPointerDown={startDrag(b)}
            className="absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center"
            style={{ left: `${cum[b]}%` }}
          >
            <div className="h-7 w-[3px] rounded-full bg-paper shadow-[0_0_0_1px_rgba(36,28,22,0.3)]" />
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1 text-[0.7rem] text-inksoft">
            <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: COLORS[i % COLORS.length] }} />
            {s.label} <span className="tnum">{pct[i].toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
