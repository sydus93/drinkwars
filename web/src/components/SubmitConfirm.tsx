/**
 * DW-079: the "Before you submit" check, in-app. It replaces window.confirm, which rendered as an
 * unstyled "localhost says" box with the numbers run together — and a browser that offers
 * "prevent this page from creating more dialogs" turns every later confirm into a silent cancel,
 * so a student's Submit would simply do nothing.
 *
 * Audits accept it through `data-dw="submit-confirm"` / `data-dw="submit-confirm-go"`
 * (scripts/confirm-dialog.mjs), the way they used to accept the native dialog.
 */
import { useEffect, useRef } from "react";

export function SubmitConfirm({ lines, onAnswer }: { lines: string[]; onAnswer: (ok: boolean) => void }) {
  const go = useRef<HTMLButtonElement>(null);
  const answer = useRef(onAnswer);
  answer.current = onAnswer; // Play re-renders on every poll — focus once, never steal it back
  useEffect(() => {
    go.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") answer.current(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="dw-submit-confirm-title" data-dw="submit-confirm" className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onAnswer(false); }}>
      <div className="w-full max-w-md overflow-y-auto rounded-2xl border border-line2 bg-panel p-5 shadow-2xl" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
        <div id="dw-submit-confirm-title" className="display text-[1.15rem] text-ink">Before you submit</div>
        <ul className="mt-3 grid gap-2.5">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2 text-[0.9rem] leading-snug text-ink"><span aria-hidden="true" className="mt-[0.45em] h-1.5 w-1.5 flex-none rounded-full bg-copper" /><span className="min-w-0">{l}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-[0.78rem] leading-snug text-inksoft">Not sure? Go back and talk it over — the commit panel keeps these under “What locks at round end.”</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onAnswer(false)} className="rounded-lg border border-line2 bg-panel px-4 py-2 text-sm text-inksoft hover:text-ink">Go back</button>
          <button ref={go} type="button" data-dw="submit-confirm-go" onClick={() => onAnswer(true)} className="tt-btn tt-btn--go px-4 py-2 text-sm">Submit anyway</button>
        </div>
      </div>
    </div>
  );
}
