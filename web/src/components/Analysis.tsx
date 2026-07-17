/**
 * The analytics "dashboard spine" (design spec §2), composed into the Review → Analysis
 * tab. Bridges and decompositions that make the game's causal chain legible — the antidote
 * to "reverse-engineer why we lost." Firm-level and all-visible (the shared picture a team
 * decides from). Pure views over `view.ownResult` + `view.history` + `view.firms`; the
 * individual chart primitives live in Dashboards.tsx.
 */
import type { GameView } from "../game/controller.js";
import { Card, Eyebrow } from "./ui.js";
import { fmt } from "../labels.js";
import {
  PnLBridge, UnitCostBridge, CashBridge, CapacityVsDemand, EvaBars,
  DuPont, ScorecardRadar, RankBump, CostOfCapitalCockpit, StateSmallMultiples,
} from "./Dashboards.js";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <div className="mt-1 grid gap-5 lg:grid-cols-2">{children}</div>
    </Card>
  );
}

export function Analysis({ view }: { view: GameView }) {
  const r = view.ownResult;
  if (!r) return <Card>The analysis dashboards open once a round has resolved.</Card>;
  const you = view.firms.find((f) => f.isYou) ?? null;
  const field = view.firms.filter((f) => !f.isYou);
  // Opening cash = closing − net change this round (CashFlow carries no opening/closing).
  const opening = r.balance_sheet.cash - r.cash_flow.delta_cash;

  return (
    <div className="grid gap-4">
      <Section title="Profit & cost — where the money goes">
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">P&amp;L bridge</div><PnLBridge pnl={r.pnl} /></div>
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">Unit-cost build-up</div><UnitCostBridge buildup={r.cost_buildup} /></div>
      </Section>

      <Section title="Operations — the supply-constrained view">
        <div className="lg:col-span-2"><CapacityVsDemand result={r} cap={view.own.cap} /></div>
      </Section>

      <Section title="Capital — cash & the cost of money">
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">Cash bridge</div><CashBridge cash={r.cash_flow} opening={opening} /></div>
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">Cost-of-capital cockpit</div><CostOfCapitalCockpit coc={r.cost_of_capital} /></div>
      </Section>

      <Section title="Value & position — the integrative read">
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">Balanced scorecard</div><ScorecardRadar you={r.scorecard_norm} /></div>
        {you && <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">DuPont — ROE decomposed</div><DuPont you={you} result={r} field={field} /></div>}
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">Economic value added</div><EvaBars history={view.history} /></div>
        <div><div className="mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">Rank over the season</div><RankBump history={view.history} standings={view.standings} /></div>
      </Section>

      {view.inventoryEnabled && r.inventory && (
        <Card>
          <Eyebrow>Working capital &amp; inventory</Eyebrow>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
            {([
              ["Produced", fmt.int(r.inventory.produced), "brewed this round"],
              ["Sold", fmt.int(r.inventory.sold), "shipped to buyers"],
              ["On hand", fmt.int(r.inventory.end), "carried to next round"],
              ["Spoiled", fmt.int(r.inventory.spoiled), "written off"],
              ["Turnover", `${r.inventory.turnover.toFixed(1)}×`, "sold ÷ avg on-hand"],
            ] as [string, string, string][]).map(([label, value, hint]) => (
              <div key={label}>
                <div className="font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">{label}</div>
                <div className="text-[0.95rem] font-bold tabular-nums text-ink">{value}</div>
                <div className="text-[0.66rem] leading-snug text-inksoft">{hint}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[0.7rem] leading-snug text-inksoft">Cash frozen in kegs earns nothing and risks spoilage — high turnover frees working capital. This panel is live only in inventory mode.</div>
        </Card>
      )}

      <Section title="Trajectories — the whole firm at a glance">
        <div className="lg:col-span-2"><StateSmallMultiples history={view.history} /></div>
      </Section>
    </div>
  );
}
