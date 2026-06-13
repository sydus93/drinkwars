import { useEffect, type ReactNode } from "react";

/** A choice presented inside an event pop-up. `description` renders as a second
 *  line so the consequence is legible in-box (not buried in a tooltip). */
export interface EventChoice {
  id: string;
  label: string;
  description?: ReactNode;
  tone?: "go" | "solid" | "ghost";
  disabled?: boolean;
}

export type EventKind = "shock" | "opportunity" | "regulatory" | "market" | "info";

/** A round-specific event surfaced to a player. Module resolution logic emits
 *  these; the modal renders them with a tone, a glyph, and clear in-box choices. */
export interface GameEvent {
  id: string;
  kind: EventKind;
  title: string;
  body: ReactNode;
  detail?: ReactNode; // smaller secondary line (e.g. "Severity reduced by your water efficiency")
  choices?: EventChoice[]; // omit ⇒ an acknowledge-only notice
  dismissable?: boolean; // allow closing without choosing (default true for notices)
  mine?: boolean; // does this dispatch involve the player's own brewery?
}

const KIND: Record<EventKind, { accent: string; glyph: string; label: string; ring: string }> = {
  shock: { accent: "text-brick", glyph: "⚠", label: "Disruption", ring: "border-brick" },
  opportunity: { accent: "text-hop", glyph: "✦", label: "Opportunity", ring: "border-hop" },
  regulatory: { accent: "text-copperdeep", glyph: "§", label: "Regulatory", ring: "border-copper" },
  market: { accent: "text-copperdeep", glyph: "◈", label: "Market shift", ring: "border-copper" },
  info: { accent: "text-ink", glyph: "ℹ", label: "Notice", ring: "border-line2" },
};

function toneClass(tone: EventChoice["tone"]): string {
  if (tone === "go") return "tt-btn tt-btn--go w-full text-sm";
  if (tone === "ghost") return "tt-inset w-full px-4 py-2 font-body text-sm font-semibold text-ink";
  return "tt-btn w-full text-sm";
}

/**
 * Elegant centered pop-up for a single round event. Choices are rendered as full
 * buttons with a consequence line; if the event has no choices it shows an
 * acknowledge button. Pass `event = null` to render nothing.
 */
export function EventModal({ event, onChoose, onClose }: { event: GameEvent | null; onChoose?: (choiceId: string) => void; onClose?: () => void }) {
  const dismissable = event?.dismissable ?? !event?.choices?.length;
  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissable) onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [event, dismissable, onClose]);

  if (!event) return null;
  const k = KIND[event.kind];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose?.(); }}
    >
      <div className={`rise w-full max-w-md overflow-hidden rounded-lg border-2 bg-paper shadow-2xl ${k.ring}`}>
        <div className="flex items-center gap-3 border-b border-line px-5 pt-4 pb-3">
          <span className={`text-2xl leading-none ${k.accent}`} aria-hidden>{k.glyph}</span>
          <div className="min-w-0">
            <div className={`text-[0.6rem] font-semibold uppercase tracking-[0.16em] ${k.accent}`}>{k.label}</div>
            <h3 className="display truncate text-xl font-semibold leading-tight text-ink">{event.title}</h3>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="text-sm leading-relaxed text-ink">{event.body}</div>
          {event.detail && <div className="mt-2 text-[0.74rem] leading-snug text-inksoft">{event.detail}</div>}
        </div>
        <div className="grid gap-2 px-5 pb-5">
          {event.choices?.length ? (
            event.choices.map((c) => (
              <button key={c.id} disabled={c.disabled} onClick={() => onChoose?.(c.id)} className={`${toneClass(c.tone)} text-left disabled:opacity-40 disabled:cursor-not-allowed`}>
                <span className="block font-semibold">{c.label}</span>
                {c.description && <span className="mt-0.5 block text-[0.72rem] font-normal opacity-80">{c.description}</span>}
              </button>
            ))
          ) : (
            <button onClick={() => onClose?.()} className="tt-btn w-full text-sm">Got it</button>
          )}
        </div>
      </div>
    </div>
  );
}
