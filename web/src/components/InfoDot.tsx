import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small circular "?" that reveals a context card on click (and on hover for
 * pointer devices). The Cities: Skylines / Sims affordance — every control can
 * carry an explanation without cluttering the surface. Closes on outside-click,
 * Escape, or a second click.
 */
export function InfoDot({ title, children, align = "left" }: { title?: ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex group" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={typeof title === "string" ? `Info: ${title}` : "More info"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="flex h-[1.05rem] w-[1.05rem] items-center justify-center rounded-full border border-line2 text-[0.62rem] font-bold leading-none text-inksoft transition-colors hover:border-copper hover:text-copperdeep"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-[1.45rem] z-30 block w-64 max-w-[calc(100vw-1.5rem)] rounded-md border border-line2 bg-paper p-3 text-left shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {title && <span className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-copperdeep">{title}</span>}
          <span className="block text-[0.74rem] leading-snug text-ink">{children}</span>
        </span>
      )}
    </span>
  );
}
