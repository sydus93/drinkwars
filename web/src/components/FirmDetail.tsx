import { useEffect } from "react";
import type { GameView, FirmSnapshot } from "../game/controller.js";
import { SEG_LABEL, STOCK_LABEL, fmt } from "../labels.js";
import { Row, Tag } from "./ui.js";
import { Avatar, SkillStars } from "./People.js";

const STATUS_LABEL: Record<string, string> = {
  active: "Trading", acquired: "Acquired", bankrupt: "Bankrupt",
  exited_banked: "Exited (cashed out)", exited_invested: "Exited (turned investor)", exited_rebuilt: "Rebuilt",
};

/** Cap → a public size band, bucketed against the live field (you can eyeball a
 *  brewery's rough scale without buying research). */
function sizeBand(cap: number, allCaps: number[]): string {
  const sorted = [...allCaps].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)] ?? 0;
  const hi = sorted[Math.floor((2 * sorted.length) / 3)] ?? 0;
  if (cap >= hi) return "Large player";
  if (cap <= lo) return "Small player";
  return "Mid-sized";
}

/**
 * Click-out dossier on one brewery. Two tiers, mirroring the research model:
 *  • PUBLIC (always) — standing, status, rough size, the categories they sell in,
 *    and visible financial strain.
 *  • PRIVATE (only with market research bought this round) — exact quality, brand,
 *    pricing, cost, leverage, fair value, and their roster.
 * In multiplayer the private books of classmates aren't transmitted, so only the
 * public tier renders (with a note) — you can't peek at a rival's ledger.
 */
export function FirmDetail({
  firm,
  view,
  infoActive,
  poaches = [],
  onPoach,
  onClose,
}: {
  firm: FirmSnapshot;
  view: GameView;
  infoActive: boolean;
  poaches?: { firm: string; employee: string; offer: number }[];
  onPoach?: (firm: string, employee: string, offer: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ranked = [...view.firms].sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((f) => f.firm_id === firm.firm_id) + 1;
  const fieldMaxQ = Math.max(...view.firms.map((f) => f.Q), 1);
  const fieldMaxB = Math.max(...view.firms.map((f) => f.B), 1);
  const fieldMaxScore = Math.max(...view.firms.map((f) => f.score), 0.01);

  const maOn = !!view.modules?.ma?.enabled;
  const maCfg = view.modules?.ma;
  const labOn = !!view.modules?.laborMarket?.enabled;
  const vertOn = !!view.modules?.verticalIntegration?.enabled;
  const roleLabel = (id: string) => view.modules?.laborMarket?.roles.find((r) => r.id === id)?.label ?? id.replace(/_/g, " ");
  const assetLabel = (id: string) => view.modules?.verticalIntegration?.assets.find((a) => a.id === id)?.label ?? id.replace(/_/g, " ");
  // MOD-B12 employees: scoutable, poachable crew (rivals only, gated on market research).
  const empOn = !!view.modules?.employees?.enabled;
  const empRoleLabel = (id: string) => view.modules?.employees?.roles.find((r) => r.id === id)?.label ?? id.replace(/_/g, " ");
  const canPoach = empOn && !firm.isYou && firm.status === "active" && firm.employees.length > 0;

  const distressed = firm.distressRounds >= 1;
  const acquirable = maOn && maCfg && firm.distressRounds >= maCfg.min_distress_rounds && firm.status === "active";
  const floorBid = maCfg ? maCfg.min_price_fraction * Math.max(0, firm.valuation) : 0;
  const avgPrice = (() => {
    const ps = Object.values(firm.priceBySeg).filter((p) => p > 0);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
  })();

  const bar = (v: number, max: number, color = "var(--color-copper)") => (
    <span className="inline-flex h-1.5 w-20 overflow-hidden rounded-[2px] border border-line align-middle">
      <span style={{ width: `${Math.min(100, Math.max(0, (v / max) * 100))}%`, background: color }} />
    </span>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rise flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border-2 border-copper bg-paper shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
          <div className="min-w-0">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-copperdeep">Brewery dossier</div>
            <h3 className="display truncate text-xl font-semibold leading-tight text-ink">
              {firm.name}{firm.isYou && <span className="ml-2 align-middle"><Tag tone="copper">You</Tag></span>}
            </h3>
          </div>
          <button onClick={onClose} className="shrink-0 text-inksoft transition-colors hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* PUBLIC — always visible */}
          <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-inksoft">Public record</div>
          <div className="grid gap-1">
            <Row label="Standing" value={<span>#{rank > 0 ? rank : "—"} of {view.firms.length} · {bar(firm.score, fieldMaxScore)} <span className="tnum ml-1">{firm.score.toFixed(2)}</span></span>} />
            <Row label="Status" value={<Tag tone={firm.status === "active" ? "hop" : firm.status === "bankrupt" ? "brick" : "ink"}>{STATUS_LABEL[firm.status] ?? firm.status}</Tag>} />
            <Row label="Size" value={sizeBand(firm.cap, view.firms.map((f) => f.cap))} />
            <Row label="Sells in" value={firm.focus.length ? firm.focus.map((s) => SEG_LABEL[s] ?? s).join(" · ") : "—"} />
            <Row label="Approx. market share" value={fmt.pct(firm.share)} />
            {distressed && <Row label="Health" value={<span className="text-brick">Showing financial strain ({firm.distressRounds} round{firm.distressRounds === 1 ? "" : "s"})</span>} />}
          </div>

          {/* PRIVATE — research-gated */}
          <div className="mt-4 flex items-center gap-2">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-inksoft">Confidential fundamentals</div>
            {!infoActive && <Tag tone="ink">locked</Tag>}
          </div>

          {infoActive ? (
            <div className="mt-1 grid gap-1">
              <Row label={STOCK_LABEL.Q} value={<span>{bar(firm.Q, fieldMaxQ, "var(--color-hop)")} <span className="tnum ml-1">{firm.Q.toFixed(0)}</span></span>} />
              <Row label={STOCK_LABEL.B} value={<span>{bar(firm.B, fieldMaxB)} <span className="tnum ml-1">{firm.B.toFixed(0)}</span></span>} />
              <Row label="Avg price" value={avgPrice ? fmt.price(avgPrice) : "—"} />
              <Row label="Unit cost" value={firm.unitCost ? fmt.price(firm.unitCost) : "—"} />
              <Row label="Capacity" value={`${fmt.int(firm.cap)} tanks`} />
              <Row label="Last net income" value={<span className={firm.netIncome < 0 ? "text-brick" : "text-hop"}>{fmt.signed(firm.netIncome)}</span>} />
              <Row label="Leverage" value={<span className={firm.leverage > 1.5 ? "text-brick" : ""}>{firm.leverage.toFixed(2)}</span>} />
              <Row label="Cash · debt" value={`${fmt.money(firm.cash)} · ${fmt.money(firm.debt)}`} />
              {labOn && <Row label="Key people" value={firm.keyHires.length ? firm.keyHires.map(roleLabel).join(" · ") : "none on staff"} />}
              {vertOn && <Row label="Vertical assets" value={firm.verticalAssets.length ? firm.verticalAssets.map(assetLabel).join(" · ") : "none"} />}

              {maOn && !firm.isYou && (
                <div className="mt-2 rounded-md border border-line bg-paper2/40 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.78rem] font-semibold">Acquisition read</span>
                    <Tag tone={acquirable ? "hop" : "ink"}>{acquirable ? "Acquirable" : "Not a target"}</Tag>
                  </div>
                  <Row label="Fair value (est.)" value={fmt.money(firm.valuation)} />
                  {acquirable ? (
                    <Row label="Min. bid to clear" value={<span className="text-copperdeep">{fmt.money(floorBid)}</span>} />
                  ) : (
                    <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">
                      Only breweries in financial distress for ≥ {maCfg!.min_distress_rounds} rounds can be acquired. This one isn't there{firm.distressRounds > 0 ? ` yet (${firm.distressRounds} round${firm.distressRounds === 1 ? "" : "s"} so far)` : ""}.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1 rounded-md border border-line bg-paper2/30 p-3">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 opacity-40 blur-[2px]">
                <Row label="Quality" value="██" />
                <Row label="Brand" value="██" />
                <Row label="Avg price" value="$█.██" />
                <Row label="Fair value" value="$████" />
              </div>
              <p className="mt-2 text-[0.72rem] leading-snug text-inksoft">
                Tick <span className="font-semibold text-copperdeep">Buy market research</span> in your decision to reveal exact quality, brand, pricing, cost, leverage{maOn ? ", fair value," : ""} and their crew.
              </p>
            </div>
          )}

          {/* Their crew — scout & poach (rivals only; the roster itself is research-gated) */}
          {canPoach && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-2">
                <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-inksoft">Their crew · talent raid</div>
                {!infoActive && <Tag tone="ink">locked</Tag>}
              </div>
              {infoActive ? (
                <div className="grid gap-1.5">
                  {firm.employees.map((e) => {
                    const queued = poaches.find((p) => p.employee === e.id);
                    const satTone = e.satisfaction > 0.6 ? "text-hop" : e.satisfaction > 0.35 ? "text-copperdeep" : "text-brick";
                    return (
                      <div key={e.id} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[0.72rem] ${queued ? "border-copper bg-copper/[0.06]" : "border-line bg-paper2/30"}`}>
                        <Avatar seed={`${firm.firm_id}_${e.id}`} name={e.name} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5"><span className="truncate font-semibold text-ink">{e.name}</span><SkillStars n={e.skill} /></div>
                          <div className="text-[0.62rem] text-inksoft">{empRoleLabel(e.role)} · {fmt.money(e.salary)}/rd · morale <span className={satTone}>{Math.round(e.satisfaction * 100)}%</span></div>
                        </div>
                        {onPoach && (
                          <input
                            type="number" min={0} value={queued?.offer || ""}
                            onChange={(ev) => onPoach(firm.firm_id, e.id, Math.max(0, +ev.target.value))}
                            placeholder="offer $" title="Your salary offer — beat their current pay to lure them over"
                            className="tnum w-20 shrink-0 rounded border border-line bg-paper px-1.5 py-1 text-right text-[0.72rem]"
                          />
                        )}
                      </div>
                    );
                  })}
                  <p className="mt-0.5 text-[0.64rem] leading-snug text-inksoft">
                    Offer above their current pay to lure them across. The unhappier they are and the bigger your raise, the likelier they jump — a successful raid adds a one-time signing premium. Queued offers settle when you brew the round.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-line bg-paper2/30 p-3 text-[0.72rem] leading-snug text-inksoft">
                  {firm.name} employs <span className="font-semibold text-ink">{firm.employees.length}</span> specialist{firm.employees.length === 1 ? "" : "s"}. Tick <span className="font-semibold text-copperdeep">Buy market research</span> in your decision to see who they are — names, pay, and morale — and to make a poaching offer.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
