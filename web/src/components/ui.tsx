import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow mb-1">{children}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "solid",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "solid" | "ghost" | "go";
  className?: string;
}) {
  const base = "transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const styles =
    variant === "go"
      ? "tt-btn tt-btn--go text-sm"
      : variant === "ghost"
        ? "tt-inset px-4 py-2 font-body text-sm font-semibold text-ink hover:opacity-90 active:translate-y-px"
        : "tt-btn text-sm";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: "copper" | "hop" | "brick" | "ink" }) {
  const color = accent === "copper" ? "text-copper" : accent === "hop" ? "text-hop" : accent === "brick" ? "text-brick" : "text-ink";
  return (
    <div>
      <div className="text-[0.62rem] uppercase tracking-[0.14em] text-inksoft">{label}</div>
      <div className={`tnum text-xl font-semibold leading-tight ${color}`}>{value}</div>
      {sub != null && <div className="text-[0.7rem] text-inksoft">{sub}</div>}
    </div>
  );
}

export function Delta({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const c = value > 0.5 ? "text-hop" : value < -0.5 ? "text-brick" : "text-inksoft";
  return <span className={`tnum ${c}`}>{fmt(value)}</span>;
}

/** A labeled proportion bar (e.g., decomposing a share or a cost build-up). */
export function Bar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-[2px] border border-line">
      {segments.map((s, i) => (
        <div key={i} title={`${s.label}: ${s.value.toFixed(2)}`} style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

export function Tag({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "copper" | "hop" | "brick" }) {
  const map = {
    ink: "border-line2 text-inksoft",
    copper: "border-copper text-copperdeep",
    hop: "border-hop text-hop",
    brick: "border-brick text-brick",
  } as const;
  return <span className={`font-mono text-[0.6rem] uppercase tracking-[0.12em] border rounded-full px-2 py-0.5 ${map[tone]}`}>{children}</span>;
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 border-b border-line last:border-0 ${strong ? "font-semibold" : ""}`}>
      <span className="text-sm text-inksoft">{label}</span>
      <span className="tnum text-sm text-ink">{value}</span>
    </div>
  );
}
