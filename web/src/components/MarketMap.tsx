import { useState } from "react";
import type { SegmentId } from "drinkwars-engine";
import type { GameView, FirmSnapshot, ShockSignal } from "../game/controller.js";
import { Card, Eyebrow, Stat, Tag } from "./ui.js";
import { CategoryCoin } from "./CategoryIcons.js";
import { firmColor } from "../lib/teamColors.js";
import { SEG_LABEL, SEG_CHARACTER, SHOCK_META, ROLE_LABEL, ASSET_LABEL, humanizeId, fmt } from "../labels.js";

/**
 * The Market — the strategic anchor (Cities: Skylines model). Each live consumer
 * segment is a "district" rendered as a full-width street; every firm operating
 * there is a colored pin, placed left→right by price (value → premium) and sized
 * by its share of that district. You read the whole competitive landscape at a
 * glance: who's crowding premium, who owns the value end, where the open ground
 * is. Shocks tint the districts they hit and forewarn the ones that are coming.
 * Click any pin for the full dossier.
 */
export function MarketMap({ view, onInspect }: { view: GameView; onInspect: (firmId: string) => void }) {
  const active = view.segments.filter((s) => s.active);
  const live = view.firms.filter((f) => f.status === "active" || f.focus.length > 0);

  return (
    <div className="grid gap-4">
      <BreweryCard view={view} />
      <ShockBanner shocks={view.shocks} />

      {active.length === 0 ? (
        <Card><Eyebrow>The Market</Eyebrow><div className="text-sm text-inksoft">The market opens once the season begins.</div></Card>
      ) : (
        active.map((seg) => (
          <District key={seg.id} seg={seg.id} demand={seg.D} firms={live} shocks={view.shocks} youId={view.own.id} onInspect={onInspect} />
        ))
      )}

      <Legend firms={view.firms} />
    </div>
  );
}

/** "This is mine." The player's brewery as a named, colored card — identity first,
 *  then the stats that matter, then the people and assets they actually own (when
 *  the labor / vertical modules are live). The Sims/Monopoly ownership anchor. */
function BreweryCard({ view }: { view: GameView }) {
  const me = view.firms.find((f) => f.isYou);
  const rank = view.standings.findIndex((s) => s.isYou) + 1;
  const n = view.standings.length;
  const color = firmColor(view.own.id);
  const name = view.names[view.own.id] ?? "Your Brewery";
  const hires = me?.keyHires ?? [];
  const assets = me?.verticalAssets ?? [];

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-lg font-bold text-paper shadow-inner" style={{ background: color }}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Your brewery</div>
          <div className="display truncate text-xl leading-tight">{name}</div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <Stat label="Rank" value={rank > 0 ? `#${rank}` : "—"} sub={rank > 0 ? `of ${n}` : view.ownActive ? undefined : "exited"} accent="copper" />
          <Stat label="Market share" value={me ? fmt.pct(me.share) : "—"} />
          <Stat label="Quality" value={fmt.num(view.own.Q, 0)} />
          <Stat label="Brand" value={fmt.num(view.own.B, 0)} />
          <Stat label="Cash" value={fmt.money(view.own.cash)} accent={view.own.cash < 300 ? "brick" : "ink"} />
        </div>
      </div>
      {(hires.length > 0 || assets.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="eyebrow mr-1">Roster & assets</span>
          {hires.map((r, i) => (
            <span key={`h${i}`} className="rounded-md border border-hop/50 bg-hop/[0.07] px-2 py-1 text-[0.72rem] font-semibold text-ink">
              👤 {ROLE_LABEL[r] ?? humanizeId(r)}
            </span>
          ))}
          {assets.map((a, i) => (
            <span key={`a${i}`} className="rounded-md border border-aero/50 bg-aero/[0.07] px-2 py-1 text-[0.72rem] font-semibold text-ink">
              🏭 {ASSET_LABEL[a] ?? humanizeId(a)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Active + foreseeable shocks, framed for the player. Active = happening now;
 *  foreseen = a signaled shock on the way (the player can prepare). */
function ShockBanner({ shocks }: { shocks: ShockSignal[] }) {
  if (!shocks.length) return null;
  const where = (t: ShockSignal["target"]) => (t === "all" ? "industry-wide" : `in ${SEG_LABEL[t] ?? t}`);
  return (
    <div className="grid gap-1.5">
      {shocks.map((s, i) => {
        const meta = SHOCK_META[s.typeId] ?? { label: s.typeId, icon: "⚠", note: "" };
        const tone = s.active ? "brick" : "gold";
        const head = s.active
          ? `${meta.label} is hitting the market now`
          : s.roundsAway <= 1
            ? `Word of a ${meta.label.toLowerCase()} — it could land next round`
            : `Early word of a ${meta.label.toLowerCase()} — perhaps ${s.roundsAway} rounds out`;
        return (
          <div
            key={i}
            className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-[0.78rem]"
            style={{ borderColor: `var(--color-${tone})`, background: `color-mix(in srgb, var(--color-${tone}) 9%, transparent)` }}
          >
            <span className="text-base leading-none">{meta.icon}</span>
            <span className="min-w-0 flex-1 text-ink">
              <span className="font-semibold">{head}</span>
              <span className="text-inksoft"> · {where(s.target)} — {meta.note}.</span>
              {!s.active && <span className="text-inksoft"> Build resilience (process, community, water efficiency) before it hits.</span>}
            </span>
            <Tag tone={tone === "brick" ? "brick" : "copper"}>{s.active ? "Active" : "Incoming"}</Tag>
          </div>
        );
      })}
    </div>
  );
}

const PRICE_MIN = 0.08;
const PRICE_SPAN = 0.84; // keep pins clear of the street edges

function District({ seg, demand, firms, shocks, youId, onInspect }: {
  seg: SegmentId; demand: number; firms: FirmSnapshot[]; shocks: ShockSignal[]; youId: string; onInspect: (firmId: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const char = SEG_CHARACTER[seg] ?? { tagline: "", rewards: "", hue: "var(--color-copper)" };
  const here = firms.filter((f) => f.focus.includes(seg) && (f.priceBySeg[seg] ?? 0) > 0);
  const hitBy = shocks.filter((s) => s.target === seg || s.target === "all");
  const activeHit = hitBy.find((s) => s.active);

  // Price axis: normalize present firms' prices to value (left) → premium (right).
  const prices = here.map((f) => f.priceBySeg[seg] ?? 0);
  const lo = Math.min(...prices, Infinity);
  const hi = Math.max(...prices, -Infinity);
  const span = hi - lo;
  const xOf = (p: number) => PRICE_MIN + (span > 0 ? (p - lo) / span : 0.5) * PRICE_SPAN;
  const maxShare = Math.max(...here.map((f) => f.shareBySeg[seg] ?? 0), 0.0001);

  return (
    <div className="card overflow-hidden">
      {/* District header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3" style={{ background: `color-mix(in srgb, ${char.hue} 7%, transparent)` }}>
        <CategoryCoin seg={seg} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="display text-lg leading-none">{SEG_LABEL[seg] ?? seg}</span>
            <Tag tone="ink">{fmt.int(demand)} demand</Tag>
          </div>
          <div className="mt-0.5 text-[0.72rem] leading-snug text-inksoft">{char.tagline}</div>
        </div>
        {hitBy.map((s, i) => {
          const meta = SHOCK_META[s.typeId] ?? { label: s.typeId, icon: "⚠", note: "" };
          return (
            <span key={i} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em]"
              style={{ borderColor: s.active ? "var(--color-brick)" : "var(--color-gold)", color: s.active ? "var(--color-brick)" : "var(--color-copperdeep)" }}>
              {meta.icon} {meta.label} · {s.active ? "now" : `~${Math.max(s.roundsAway, 0)}r`}
            </span>
          );
        })}
      </div>

      {/* The street */}
      <div className="px-4 pb-2 pt-5" style={activeHit ? { background: "repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-brick) 5%, transparent) 0 10px, transparent 10px 20px)" } : undefined}>
        {here.length === 0 ? (
          <div className="py-6 text-center text-[0.78rem] text-inksoft">Open ground — no one has planted a flag here yet.</div>
        ) : (
          <div className="relative h-24" onMouseLeave={() => setHover(null)}>
            {/* baseline */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
            {here.map((f) => {
              const x = xOf(f.priceBySeg[seg] ?? 0);
              const d = 16 + Math.round(((f.shareBySeg[seg] ?? 0) / maxShare) * 22); // 16–38px
              const c = firmColor(f.firm_id);
              const you = f.firm_id === youId;
              const isHover = hover === f.firm_id;
              return (
                <button
                  key={f.firm_id}
                  onClick={() => onInspect(f.firm_id)}
                  onMouseEnter={() => setHover(f.firm_id)}
                  title={`${f.name} · ${fmt.price(f.priceBySeg[seg] ?? 0)} · ${fmt.pct(f.shareBySeg[seg] ?? 0)} share`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform hover:z-20 hover:scale-110"
                  style={{
                    left: `${x * 100}%`, top: "50%", width: d, height: d,
                    background: c, borderColor: you ? "var(--color-ink)" : "color-mix(in srgb, var(--color-ink) 25%, transparent)",
                    boxShadow: you ? "0 0 0 3px color-mix(in srgb, var(--color-copper) 40%, transparent)" : undefined,
                    zIndex: isHover ? 20 : you ? 10 : 1,
                  }}
                >
                  <span className="sr-only">{f.name}</span>
                </button>
              );
            })}
            {/* hover/you label */}
            {(() => {
              const f = here.find((x) => x.firm_id === (hover ?? youId));
              if (!f) return null;
              const x = xOf(f.priceBySeg[seg] ?? 0);
              return (
                <div className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[0.62rem] font-semibold text-paper"
                  style={{ left: `${Math.min(Math.max(x, 0.12), 0.88) * 100}%`, top: "calc(50% + 26px)" }}>
                  {f.firm_id === youId ? "You" : f.name}
                </div>
              );
            })()}
          </div>
        )}
        {/* axis labels */}
        <div className="mt-1 flex justify-between text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">
          <span>← Value</span>
          <span className="normal-case tracking-normal text-inksoft/70">price positioning</span>
          <span>Premium →</span>
        </div>
      </div>
    </div>
  );
}

/** Who's who — the firm color key, so every pin and standings dot is decodable. */
function Legend({ firms }: { firms: FirmSnapshot[] }) {
  if (!firms.length) return null;
  return (
    <Card>
      <Eyebrow>Who's who</Eyebrow>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {firms.map((f) => (
          <span key={f.firm_id} className={`flex items-center gap-1.5 text-[0.74rem] ${f.status !== "active" ? "opacity-45" : ""}`}>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: firmColor(f.firm_id) }} />
            <span className={f.isYou ? "font-bold text-copperdeep" : "text-ink"}>{f.isYou ? `${f.name} (you)` : f.name}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}
