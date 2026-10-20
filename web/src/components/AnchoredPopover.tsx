/**
 * DW-079: the City View's on-map popovers (lease a parcel / manage a facility), rendered in a
 * portal at the top layer. They used to live inside the City View's sticky column — a stacking
 * context that sits UNDER the page's sticky tab bar (z-20) — so the part of a tall popover that
 * rose above the map slid beneath the frosted bar (Devin's playtest, 10-15).
 *
 * Phone/tablet: a bottom sheet. Desktop: anchored to the parcel at `at` (percent of the `stage`
 * box) — above it if there's room, else below, never under the tab bar, scrolling inside if
 * neither side fits. Re-placed on scroll, resize and content growth (picking a type adds the
 * bid row). Escape or a click outside closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const SHEET_STYLE = { borderColor: "var(--color-copperdeep)", background: "var(--color-panel)", boxShadow: "0 -14px 30px rgba(40,25,8,.42)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" };
const POP_STYLE = { borderColor: "var(--color-copperdeep)", background: "var(--color-panel)", boxShadow: "0 14px 30px rgba(40,25,8,.42)" };

export function AnchoredPopover({ stage, at, width, label, onClose, children }: {
  stage: RefObject<HTMLElement | null>; at: { l: number; t: number }; width: number; label: string; onClose: () => void; children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const { l, t } = at;

  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const s = stage.current?.getBoundingClientRect(), el = body.current;
      if (!s || !el) return;
      const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 8;
      const tabs = document.querySelector("[data-dw-tabs]")?.getBoundingClientRect();
      const floor = tabs && tabs.bottom > 0 ? tabs.bottom + m : m; // never under the sticky tab bar
      const ax = s.left + (s.width * l) / 100, ay = s.top + (s.height * t) / 100;
      const room = Math.max(140, vh - m - floor);
      const h = Math.min(el.offsetHeight + 26, room); // + p-3 padding and border
      let top = ay - h - 14;                                       // above the parcel,
      if (top < floor) top = ay + 12;                              // else below it,
      top = Math.max(floor, Math.min(top, vh - m - h));            // and always on screen (scrolls inside if tall)
      const left = Math.min(Math.max(m, ax - width / 2), vw - m - width);
      setPos((p) => (p && p.left === left && p.top === top && p.maxH === room ? p : { left, top, maxH: room }));
    };
    const sched = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", sched, true);
    window.addEventListener("resize", sched);
    const ro = new ResizeObserver(sched);
    if (body.current) ro.observe(body.current);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", sched, true); window.removeEventListener("resize", sched); ro.disconnect(); };
  }, [stage, l, t, width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <>
      <div onClick={onClose} className="fixed inset-0 z-40" />
      <div role="dialog" aria-modal="true" aria-label={label} data-dw="map-popover" className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t p-4 lg:hidden" style={SHEET_STYLE}>{children}</div>
      <div role="dialog" aria-modal="true" aria-label={label} data-dw="map-popover" className="fixed z-50 hidden overflow-y-auto rounded-xl border p-3 lg:block" style={{ ...POP_STYLE, left: pos?.left ?? 0, top: pos?.top ?? 0, width, maxHeight: pos?.maxH, visibility: pos ? "visible" : "hidden" }}>
        <div ref={body}>{children}</div>
      </div>
    </>,
    document.body,
  );
}
