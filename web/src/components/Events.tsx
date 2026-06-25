import { Card, Eyebrow } from "./ui.js";
import type { GameEvent } from "./EventModal.js";

// One palette for both the Dispatches rail and the round-review popup, so a shock reads the
// same red in both. The rail now takes ALREADY-PARSED events (see eventFeed.parseEvents) — no
// raw "SHOCK fired: water (cost_spike…)" log lines reach the player.
const KIND_TONE: Record<string, string> = {
  shock: "var(--color-brick)",
  regulatory: "var(--color-gold)",
  market: "var(--color-copper)",
  opportunity: "var(--color-hop)",
  info: "var(--color-inksoft)",
};

export function Events({ events }: { events: GameEvent[] }) {
  if (!events.length) return null;
  return (
    <Card>
      <Eyebrow>Dispatches</Eyebrow>
      <ul className="grid gap-2">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_TONE[e.kind] ?? "var(--color-inksoft)" }} />
            <span>
              <span className="font-semibold text-ink">{e.title}.</span> <span className="text-inksoft">{e.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
