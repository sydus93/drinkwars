import { useEffect, useSyncExternalStore } from "react";

type Mode = "foolscap" | "sectional";

/** The live `data-mode` on <html>: every toggle on the page reads the same attribute, so an inline
 *  header button and the floating one can never disagree about which icon to show. */
const read = (): Mode => (document.documentElement.getAttribute("data-mode") as Mode) || "foolscap";
const subscribe = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
  return () => mo.disconnect();
};

/** Light (Foolscap) ↔ dark (Sectional Night) — the design system's two co-equal modes.
 *  Floating (bottom-right) everywhere except a game screen, where Play renders the `inline`
 *  one in its header: on a phone the floating button sat on top of the commit sheet and the
 *  results page's "On to round" button (DW-078). */
export function ModeToggle({ inline = false }: { inline?: boolean }) {
  const mode = useSyncExternalStore(subscribe, read, () => "foolscap" as Mode);
  const dark = mode === "sectional";
  const toggle = () => {
    const next: Mode = dark ? "foolscap" : "sectional";
    document.documentElement.setAttribute("data-mode", next);
    try { localStorage.setItem("dw-mode", next); } catch { /* private window — the choice just won't persist */ }
  };
  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={inline
        ? "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-line2 bg-panel text-inksoft transition-colors hover:text-copper"
        : "dw-float-mode fixed bottom-3 right-3 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-line2 bg-panel text-inksoft transition-colors hover:text-copper"}
    >
      {dark ? (
        <svg className="lucide" width={inline ? 14 : 16} height={inline ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg className="lucide" width={inline ? 14 : 16} height={inline ? 14 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        </svg>
      )}
    </button>
  );
}

/** Mounted by a game screen: hides the floating toggle (`:root[data-inplay] .dw-float-mode`). */
export function useInlineModeToggle() {
  useEffect(() => {
    document.documentElement.setAttribute("data-inplay", "");
    return () => document.documentElement.removeAttribute("data-inplay");
  }, []);
}
