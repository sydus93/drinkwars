import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A small circular "?" that reveals a context card on click (and on hover for
 * pointer devices). The Cities: Skylines / Sims affordance — every control can
 * carry an explanation without cluttering the surface. Closes on outside-click,
 * Escape, or a second click.
 */
export function InfoDot({ title, children, align = "left" }: { title?: ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  // The card is portalled to <body> and positioned from the button's viewport rect, so it
  // sits above every panel (the commit dial, sticky HUD, overflow-clipped cards) — a z-index
  // inside a stacking context could never guarantee that.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) { setPos(null); return; }
    const place = () => {
      const r = ref.current!.getBoundingClientRect();
      const width = Math.min(256, window.innerWidth - 24);
      const left = align === "right" ? Math.max(12, r.right - width) : Math.min(r.left, window.innerWidth - width - 12);
      const ch = card.current?.offsetHeight ?? 0;
      const below = r.bottom + 6;
      const top = ch && below + ch > window.innerHeight - 8 && r.top - ch - 6 > 8 ? r.top - ch - 6 : below;
      setPos({ top, left, width });
    };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (ref.current && !ref.current.contains(t) && !card.current?.contains(t)) setOpen(false); };
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
      {open && createPortal(
        <span
          ref={card}
          role="tooltip"
          onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
          className="fixed z-[1000] block rounded-md border border-line2 bg-paper p-3 text-left shadow-lg"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width ?? 256, visibility: pos ? "visible" : "hidden" }}
        >
          {title && <span className="mb-1 block text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-copperdeep">{title}</span>}
          <span className="block text-[0.74rem] leading-snug text-ink">{children}</span>
        </span>, document.body)}
    </span>
  );
}
