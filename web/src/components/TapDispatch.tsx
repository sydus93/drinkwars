/**
 * The Tap Dispatch — the round in review as an editorial newspaper (design:
 * "Map · Review"). A masthead, a lead story (the round's biggest dispatch) beside
 * the standings, then the rest of the round's dispatches set in two columns,
 * categorized exactly like the rail (eventFeed kinds). Items that name your house
 * are flagged and float to the top of their column. Pure presentation over the
 * already-parsed event feed — no new engine data.
 */
import { useMemo, type ReactNode } from "react";
import type { GameView } from "../game/controller.js";
import type { EventKind } from "./EventModal.js";
import { parseEvents } from "./eventFeed.js";
import { firmColor } from "../lib/teamColors.js";
import { MARKET_META, fmt } from "../labels.js";

const SECTIONS: { kind: EventKind; glyph: string; label: string; accent: string }[] = [
  { kind: "shock", glyph: "⚠", label: "Disruptions", accent: "var(--color-brick)" },
  { kind: "market", glyph: "◈", label: "Market shifts", accent: "var(--color-copperdeep)" },
  { kind: "regulatory", glyph: "§", label: "Regulatory & financial", accent: "var(--color-copperdeep)" },
  { kind: "opportunity", glyph: "✦", label: "Moves & openings", accent: "var(--color-hop)" },
  { kind: "info", glyph: "ℹ", label: "Notices", accent: "var(--color-inksoft)" },
];
const LEAD_LABEL: Record<EventKind, string> = { shock: "Disruption", market: "Market shift", regulatory: "Regulatory", opportunity: "Opening", info: "Notice" };
const roman = (n: number): string => {
  const m: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = ""; let x = n;
  for (const [v, sy] of m) while (x >= v) { s += sy; x -= v; }
  return s || "—";
};

export function TapDispatch({ view, round, footer }: { view: GameView; round: number; footer?: ReactNode }) {
  const youName = view.names[view.own.id] ?? "";
  const events = useMemo(() => parseEvents(view.events, youName), [view.events, youName]);
  const lead = events.find((e) => e.kind === "shock") ?? events.find((e) => e.kind === "market") ?? events[0] ?? null;
  const sections = useMemo(
    () => SECTIONS.map((s) => ({ ...s, items: events.filter((e) => e.kind === s.kind && e !== lead).sort((a, b) => Number(!!b.mine) - Number(!!a.mine)) })).filter((s) => s.items.length > 0),
    [events, lead],
  );
  const homeCity = view.markets.find((m) => m.kind === "home");
  const edition = homeCity ? MARKET_META[homeCity.id]?.city ?? homeCity.label : "Front Range";
  const youMentions = events.filter((e) => e.mine).length;

  return (
    <div className="mx-auto max-w-[880px] px-1 py-2">
      {/* masthead */}
      <div className="border-b-[3px] border-double border-ink pb-3 text-center">
        <div className="flex justify-between font-mono text-[0.55rem] uppercase tracking-[0.1em] text-inksoft">
          <span>Vol. {roman(round)} · Round {round}</span>
          <span className="hidden sm:inline">The Tap Dispatch</span>
          <span>{edition} Edition</span>
        </div>
        <div className="display my-1 text-[2.4rem] font-black uppercase leading-[0.9] text-ink sm:text-[3.4rem]">The Tap Dispatch</div>
        <div className="font-body text-xs italic text-inksoft">
          {events.length ? `${events.length} dispatch${events.length === 1 ? "" : "es"} from a market on the move${youMentions ? ` — ${youMentions} involve${youMentions === 1 ? "s" : ""} your house.` : "."}` : "A quiet round on the Front Range."}
        </div>
      </div>

      {/* lead story + standings */}
      <div className="grid grid-cols-1 gap-6 border-b border-line2 py-5 md:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          {lead ? (
            <>
              <span className="inline-block rounded-[3px] px-2 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-[0.1em] text-paper" style={{ background: lead.kind === "shock" ? "var(--color-brick)" : lead.kind === "opportunity" ? "var(--color-hop)" : "var(--color-copperdeep)" }}>Lead · {LEAD_LABEL[lead.kind]}</span>
              <div className="display my-2 text-3xl font-extrabold uppercase leading-[0.98] text-ink">{lead.title}</div>
              <div className="font-body text-justify text-sm leading-relaxed text-ink/90">{lead.body}</div>
            </>
          ) : (
            <>
              <span className="inline-block rounded-[3px] bg-hop px-2 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-[0.1em] text-paper">Lead · Steady</span>
              <div className="display my-2 text-3xl font-extrabold uppercase leading-[0.98] text-ink">A Quiet Round In The Valley</div>
              <div className="font-body text-justify text-sm leading-relaxed text-ink/90">No shocks, no shake-ups — the houses held their ground. A good round to invest in what compounds: recipe quality, brand, and the community around your taprooms.</div>
            </>
          )}
        </div>
        <div className="min-w-0 md:border-l md:border-line2 md:pl-5">
          <div className="mb-1.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-copperdeep">Standings · after R{round}</div>
          {view.standings.map((r, i) => (
            <div key={r.firm_id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-0">
              <span className="w-4 font-mono text-[0.7rem] font-bold text-inksoft">{i + 1}</span>
              <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: firmColor(r.firm_id), border: r.isYou ? "1.5px solid #fff4e0" : undefined, boxShadow: r.isYou ? `0 0 0 1px ${firmColor(r.firm_id)}` : undefined }} />
              <span className="display flex-1 truncate text-sm font-bold uppercase tracking-wide" style={{ color: r.isYou ? "var(--color-copperdeep)" : "var(--color-ink)" }}>{r.isYou ? `${r.name} (you)` : r.name}</span>
              <span className="font-mono text-[0.7rem] font-bold text-ink">{fmt.num(r.score, 1)}</span>
              {r.status !== "active" && <span className="font-mono text-[0.5rem] uppercase text-brick">out</span>}
            </div>
          ))}
        </div>
      </div>

      {/* dispatch columns */}
      {sections.length > 0 && (
        <div className="pt-4 [column-count:1] [column-gap:1.6rem] md:[column-count:2]">
          {sections.map((sec) => (
            <div key={sec.kind} className="mb-5 [break-inside:avoid]">
              <div className="mb-2 flex items-center gap-2 border-b-2 border-ink pb-1">
                <span style={{ color: sec.accent }}>{sec.glyph}</span>
                <span className="display text-sm font-extrabold uppercase tracking-[0.04em] text-ink">{sec.label}</span>
                <span className="flex-1" />
                <span className="font-mono text-[0.55rem] text-inksoft">{sec.items.length}</span>
              </div>
              {sec.items.map((e) => (
                <div key={e.id} className={`mb-2.5 text-[0.8rem] leading-snug ${e.mine ? "border-l-2 border-copper pl-2" : ""}`}>
                  <span className="font-bold text-ink">{e.title}.</span> <span className="text-ink/80">{e.body}</span>
                  {e.mine && <span className="ml-1.5 rounded-full border border-copper px-1.5 align-middle font-mono text-[0.5rem] font-bold uppercase text-copperdeep">you</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {footer && <div className="mt-5 flex flex-wrap items-center gap-3 border-t-[3px] border-double border-ink pt-3">{footer}</div>}
    </div>
  );
}
