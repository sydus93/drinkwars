import { Card, Eyebrow } from "./ui.js";

function tone(e: string): string {
  if (e.startsWith("SHOCK") || e.startsWith("ANTITRUST")) return "var(--color-brick)";
  if (e.startsWith("NEW CATEGORY")) return "var(--color-copper)";
  if (e.startsWith("FORCED EXIT") || e.startsWith("DISTRESS")) return "var(--color-brick)";
  if (e.startsWith("RE-ENTRY") || e.includes("formed")) return "var(--color-hop)";
  return "var(--color-inksoft)";
}

export function Events({ events }: { events: string[] }) {
  if (!events.length) return null;
  return (
    <Card>
      <Eyebrow>Dispatches</Eyebrow>
      <ul className="grid gap-1.5">
        {events.map((e, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone(e) }} />
            <span className="text-ink">{e}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
