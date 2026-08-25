import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ScheduledShock } from "drinkwars-engine";
import type { DashEngagementRow, DashPanelRow, DashTeam, InstructorDashboard as DashData } from "drinkwars-server";
import type { GameTimeline, InstructorClient } from "../game/multiplayer.js";
import { Button, Card, Eyebrow, Row, Stat, Tag } from "../components/ui.js";
import { Legend, LineChart, Scatter, type ScatterPoint, type Series } from "../components/charts.js";
import { Events } from "../components/Events.js";
import { parseEvents } from "../components/eventFeed.js";
import { MARKET_META, SEG_LABEL, SHOCK_META, fmt, humanizeId } from "../labels.js";
import { RATIO_DEFS, RATIO_GROUPS, WCS_FACTORS, computeWcs, distressFlags, ratioDisplay } from "../lib/ratios.js";
import { teamColor } from "../lib/teamColors.js";
import { TuningBoard, tuningDefaults, type TuningVals } from "./TuningBoard.js";

type DashTab = "overview" | "monitor" | "balance" | "schedule" | "export" | "trajectories" | "score" | "market" | "strategy" | "coopetition" | "finance" | "team";

// Design IA first (Overview · Monitor · Balance · Schedule · Export), then the deep analytics.
const TABS: { id: DashTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "monitor", label: "Monitor" },
  { id: "balance", label: "Balance" },
  { id: "schedule", label: "Schedule" },
  { id: "export", label: "Export" },
  { id: "trajectories", label: "Trajectories" },
  { id: "score", label: "Score anatomy" },
  { id: "market", label: "Market" },
  { id: "strategy", label: "Strategy map" },
  { id: "coopetition", label: "Coopetition" },
  { id: "finance", label: "Finance & health" },
  { id: "team", label: "Team drill-down" },
];
/** Tabs that need a resolved round; Monitor/Balance/Schedule/Export work from round 0. */
const NEEDS_ROUND = new Set<DashTab>(["overview", "trajectories", "score", "market", "strategy", "coopetition", "finance", "team"]);

const SCORE_KEYS = ["financial", "market", "intangible", "stakeholder"] as const;
// Student-facing labels per the scoring-layer spec §8 — engine keys stay generic.
const SCORE_LABEL: Record<(typeof SCORE_KEYS)[number], string> = {
  financial: "Financial",
  market: "Market",
  intangible: "Preparedness",
  stakeholder: "Standing",
};

// --- formatting helpers -------------------------------------------------------
const fcov = (n: number) => (n > 900 ? "∞" : `${n.toFixed(1)}×`);
const flev = (n: number) => n.toFixed(2);
const fscore = (n: number) => n.toFixed(3);
const ftime = (s: number | null) => (s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const shortName = (t: DashTeam) => (t.joined ? t.name : t.name.replace(/^Open slot/i, "NPC"));

// --- gamemaster (DW-037) labels -----------------------------------------------
const KIND_LABEL: Record<string, string> = { cost_spike: "cost spike", capacity_hit: "capacity hit", demand_drop: "demand drop", demand_boost: "demand boost", cash_hit: "cash hit" };
const shockLabel = (id: string) => SHOCK_META[id]?.label ?? humanizeId(id);
const regionLabel = (r: string) => MARKET_META[r]?.city ?? humanizeId(r);

/** DashPanelRow history → the distressFlags input slice. */
const toDistressRows = (rows: DashPanelRow[]) => rows.map((r) => ({ round: r.round, netIncome: r.netIncome, cash: r.cash, leverage: r.leverage, creditRationed: r.creditRationed, rank: r.rank, belowSafety: r.belowSafety, roundsBelowSafety: r.roundsBelowSafety }));

/** Still-active firms carrying ≥1 distress flag, worst-first. Bankrupt/exited
 *  firms are excluded — they're past distress and would flag forever. */
function firmsInDistress(d: Derived): { firmId: string; flags: string[] }[] {
  const activeIds = new Set(d.latest.filter((p) => p.status === "active").map((p) => p.firmId));
  return d.teams
    .filter((t) => activeIds.has(t.firmId))
    .map((t) => ({ firmId: t.firmId, flags: distressFlags(toDistressRows(d.panelByFirm.get(t.firmId) ?? [])) }))
    .filter((x) => x.flags.length > 0)
    .sort((a, b) => b.flags.length - a.flags.length);
}

// --- derived view over the payload -------------------------------------------
interface Derived {
  data: DashData;
  teams: DashTeam[]; // ordered, stable
  colorByFirm: Map<string, string>;
  nameByFirm: Map<string, string>;
  joinedByFirm: Map<string, boolean>;
  rounds: number[];
  panelByFirm: Map<string, DashPanelRow[]>;
  latest: DashPanelRow[]; // latest resolved round
  latestRound: number;
  engByRound: Map<number, DashEngagementRow[]>;
}

function derive(data: DashData): Derived {
  const teams = data.teams;
  const colorByFirm = new Map(teams.map((t, i) => [t.firmId, teamColor(i)]));
  const nameByFirm = new Map(teams.map((t) => [t.firmId, shortName(t)]));
  const joinedByFirm = new Map(teams.map((t) => [t.firmId, t.joined]));
  const rounds = Array.from({ length: data.meta.resolvedRounds }, (_, i) => i);
  const panelByFirm = new Map<string, DashPanelRow[]>();
  for (const t of teams) panelByFirm.set(t.firmId, []);
  for (const p of [...data.panel].sort((a, b) => a.round - b.round)) {
    if (!panelByFirm.has(p.firmId)) panelByFirm.set(p.firmId, []);
    panelByFirm.get(p.firmId)!.push(p);
  }
  const latestRound = data.meta.resolvedRounds - 1;
  const latest = data.panel.filter((p) => p.round === latestRound).sort((a, b) => a.rank - b.rank);
  const engByRound = new Map<number, DashEngagementRow[]>();
  for (const e of data.engagement) {
    if (!engByRound.has(e.round)) engByRound.set(e.round, []);
    engByRound.get(e.round)!.push(e);
  }
  return { data, teams, colorByFirm, nameByFirm, joinedByFirm, rounds, panelByFirm, latest, latestRound, engByRound };
}

/** Build one Series per team for a chosen metric, in stable team order/colors. */
function teamSeries(d: Derived, get: (p: DashPanelRow) => number): Series[] {
  return d.teams.map((t) => ({
    label: d.nameByFirm.get(t.firmId)!,
    color: d.colorByFirm.get(t.firmId)!,
    data: (d.panelByFirm.get(t.firmId) ?? []).map(get),
  }));
}

// --- small inline visuals -----------------------------------------------------
/** A bar centered at 0 — extends right (color) for positive, left (brick) for negative. */
function DivergingBar({ value, max, color }: { value: number; max: number; color: string }) {
  const m = max || 1;
  const half = (Math.min(1, Math.abs(value) / m) * 100) / 2;
  const pos = value >= 0;
  return (
    <div className="relative h-2 w-full rounded-[2px] bg-line">
      <div className="absolute top-[-1px] h-[10px] w-px bg-line2" style={{ left: "50%" }} />
      <div className="absolute top-0 h-full rounded-[2px]" style={{ background: pos ? color : "var(--color-brick)", left: pos ? "50%" : `${50 - half}%`, width: `${half}%` }} />
    </div>
  );
}

function ColorDot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function ChartCard({ title, series, formatY, zeroBaseline }: { title: string; series: Series[]; formatY?: (n: number) => string; zeroBaseline?: boolean }) {
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <LineChart series={series} formatY={formatY} zeroBaseline={zeroBaseline} />
    </Card>
  );
}

// =============================================================================
// Panels
// =============================================================================

function OverviewPanel({ d }: { d: Derived }) {
  const latest = d.latest;
  const active = latest.filter((p) => p.status === "active").length;
  const bankrupt = latest.filter((p) => p.status === "bankrupt").length;
  const exited = latest.filter((p) => p.status.startsWith("exited") || p.status === "acquired").length;
  const scores = latest.map((p) => p.scoreCumulative);
  const top = scores.length ? Math.max(...scores) : 0;
  const med = scores.length ? [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)] : 0;
  const unitsServed = latest.reduce((a, p) => a + p.totalQSold, 0);
  const segActive = d.data.market.filter((m) => m.round === d.latestRound && m.active).length;

  const eng = d.engByRound.get(d.latestRound) ?? [];
  const joinedEng = eng.filter((e) => d.joinedByFirm.get(e.firmId));
  const submitted = joinedEng.filter((e) => e.submitted).length;
  const nonSub = joinedEng.filter((e) => !e.submitted).map((e) => d.nameByFirm.get(e.firmId)!);
  const revs = joinedEng.map((e) => e.revisionCount);
  const avgRev = revs.length ? revs.reduce((a, b) => a + b, 0) / revs.length : 0;
  const times = joinedEng.map((e) => e.timeToDecideS).filter((x): x is number => x != null);
  const avgTime = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const boughtInfo = joinedEng.filter((e) => e.infoPurchased).length;

  const lo = Math.min(...scores, 0);
  const hi = Math.max(...scores, 0.01);
  const span = hi - lo || 1;
  const events = d.data.events.find((e) => e.round === d.latestRound)?.events ?? [];
  const distressed = firmsInDistress(d);

  return (
    <div className="grid gap-4">
      {distressed.length > 0 && (
        <Card className="border-l-4 border-l-brick">
          <Eyebrow>Firms in trouble</Eyebrow>
          <div className="grid gap-1.5">
            {distressed.map((f) => (
              <div key={f.firmId} className="flex flex-wrap items-center gap-1.5">
                <ColorDot color={d.colorByFirm.get(f.firmId)!} />
                <span className="text-sm font-semibold">{d.nameByFirm.get(f.firmId)}</span>
                {f.flags.map((fl) => (
                  <Tag key={fl} tone="brick">{fl}</Tag>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-[0.7rem] text-inksoft">Full ratio breakdown on the Finance &amp; health tab.</div>
        </Card>
      )}
      <Card>
        <Eyebrow>Class snapshot · through round {d.latestRound + 1}</Eyebrow>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Round" value={`${d.data.meta.currentRound + (d.data.meta.lifecycle === "complete" ? 0 : 1)}/${d.data.meta.nRounds}`} sub={({ open: "Lobby open", locked: "In progress", complete: "Complete" } as Record<string, string>)[d.data.meta.lifecycle] ?? d.data.meta.lifecycle} accent="copper" />
          <Stat label="Active" value={active} accent="hop" />
          <Stat label="Bankrupt / exited" value={`${bankrupt} / ${exited}`} accent={bankrupt ? "brick" : "ink"} />
          <Stat label="Top score" value={fscore(top)} />
          <Stat label="Median score" value={fscore(med)} />
          <Stat label="Units sold (last rd)" value={fmt.int(unitsServed)} sub={`${segActive} segments live`} />
        </div>
        {d.data.meta.setup && (
          <div className="mt-2 text-[0.7rem] text-inksoft">
            <span className="font-mono uppercase tracking-wide text-copperdeep">Setup ·</span> {d.data.meta.setup.firmMode === "team" ? "team firms (C-suite chairs)" : "solo firms"} · {d.data.meta.setup.nFirms} slots · {d.data.meta.setup.modules.length ? `${d.data.meta.setup.modules.length} expansion modules (${d.data.meta.setup.modules.map(humanizeId).join(", ")})` : "base game, no expansion modules"}
            {d.data.meta.setup.frontierRound != null && <> · new category R{d.data.meta.setup.frontierRound + 1}</>}
            {d.data.meta.setup.exportRound != null && <> · exports open R{d.data.meta.setup.exportRound + 1}</>}
            {d.data.meta.setup.practiceRounds > 0 && <> · first {d.data.meta.setup.practiceRounds} round{d.data.meta.setup.practiceRounds === 1 ? "" : "s"} practice (unscored)</>}
            {d.data.meta.setup.terminalWeight > 0 && <> · terminal weight {Math.round(d.data.meta.setup.terminalWeight * 100)}%</>}
            · no-show = {d.data.meta.setup.noShowPolicy === "carry" ? "carry last plan" : "zero-fill"} · seed {d.data.meta.setup.seed}
          </div>
        )}
      </Card>

      <Card>
        <Eyebrow>Standings — sustained scorecard</Eyebrow>
        <div className="grid gap-1.5">
          {latest.map((p) => (
            <div key={p.firmId} className="flex items-center gap-2 px-1 py-1">
              <span className="tnum w-5 text-right text-sm text-inksoft">{p.rank}</span>
              <ColorDot color={d.colorByFirm.get(p.firmId)!} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{d.nameByFirm.get(p.firmId)}</span>
                  {!d.joinedByFirm.get(p.firmId) && <Tag>NPC</Tag>}
                  {p.status !== "active" && <Tag tone={p.status === "bankrupt" ? "brick" : "copper"}>{p.status.replace("exited_", "")}</Tag>}
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-line">
                  <div className="h-full" style={{ width: `${((p.scoreCumulative - lo) / span) * 100}%`, background: d.colorByFirm.get(p.firmId)! }} />
                </div>
              </div>
              <span className="tnum w-24 text-right text-xs text-inksoft">{fmt.money(p.cash)}</span>
              <span className="tnum w-14 text-right text-sm">{fscore(p.scoreCumulative)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <Eyebrow>Engagement · last resolved round</Eyebrow>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Submitted" value={`${submitted}/${joinedEng.length}`} accent={nonSub.length ? "brick" : "hop"} />
          <Stat label="Avg revisions" value={avgRev.toFixed(1)} />
          <Stat label="Avg time to decide" value={ftime(avgTime)} />
          <Stat label="Bought research" value={`${boughtInfo}/${joinedEng.length}`} />
        </div>
        {nonSub.length > 0 && <div className="mt-2 text-[0.72rem] text-brick">Didn't submit: {nonSub.join(", ")} — carried last quarter's standing plan (prices, presence, standing investments; one-shot moves don't repeat).</div>}
        {joinedEng.length === 0 && <div className="mt-2 text-[0.72rem] text-inksoft">No human teams yet — all slots are adaptive NPCs.</div>}
      </Card>

      {events.length > 0 && <Events events={parseEvents(events)} />}
    </div>
  );
}

function TrajectoriesPanel({ d }: { d: Derived }) {
  const charts: { title: string; get: (p: DashPanelRow) => number; fmtY?: (n: number) => string; zero?: boolean }[] = [
    { title: "Cumulative score", get: (p) => p.scoreCumulative, fmtY: (n) => n.toFixed(2) },
    { title: "Cash", get: (p) => p.cash, fmtY: fmt.money, zero: true },
    { title: "Market share", get: (p) => p.share, fmtY: fmt.pct, zero: true },
    { title: "Net income", get: (p) => p.netIncome, fmtY: fmt.money, zero: true },
    { title: "Recipe quality (Q)", get: (p) => p.Q, fmtY: (n) => n.toFixed(0) },
    { title: "Brand (B)", get: (p) => p.B, fmtY: (n) => n.toFixed(0) },
    { title: "Equity", get: (p) => p.equity, fmtY: fmt.money, zero: true },
    { title: "Leverage", get: (p) => p.leverage, fmtY: flev, zero: true },
  ];
  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Teams</Eyebrow>
        <Legend series={d.teams.map((t) => ({ label: d.nameByFirm.get(t.firmId)!, color: d.colorByFirm.get(t.firmId)!, data: [] }))} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((c) => (
          <ChartCard key={c.title} title={c.title} series={teamSeries(d, c.get)} formatY={c.fmtY} zeroBaseline={c.zero} />
        ))}
      </div>
    </div>
  );
}

function ScorePanel({ d }: { d: Derived }) {
  const w = d.data.meta.weights;
  const latest = d.latest;
  // Weighted contribution c_k = weight_k * normalized_k for the latest round.
  const contrib = (p: DashPanelRow, k: (typeof SCORE_KEYS)[number]) => w[k] * p.scoreNorm[k];
  const maxAbs = Math.max(0.01, ...latest.flatMap((p) => SCORE_KEYS.map((k) => Math.abs(contrib(p, k)))));

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>What's winning · weighted component contribution (last round)</Eyebrow>
        <div className="mb-2 text-[0.72rem] text-inksoft">
          Weights — Financial {fmt.pct(w.financial)}, Market {fmt.pct(w.market)}, Preparedness {fmt.pct(w.intangible)}, Standing {fmt.pct(w.stakeholder)}. Bars are weight × within-round normalized score (right = ahead of the field, left = behind).
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                <th className="py-1 pr-3">Team</th>
                {SCORE_KEYS.map((k) => (
                  <th key={k} className="px-2 py-1">{SCORE_LABEL[k]}</th>
                ))}
                <th className="py-1 pl-2">Leans on</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((p) => {
                const lean = [...SCORE_KEYS].sort((a, b) => contrib(p, b) - contrib(p, a))[0];
                return (
                  <tr key={p.firmId} className="border-t border-line align-middle">
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-1.5"><ColorDot color={d.colorByFirm.get(p.firmId)!} /><span className="truncate font-semibold">{d.nameByFirm.get(p.firmId)}</span></span>
                    </td>
                    {SCORE_KEYS.map((k) => (
                      <td key={k} className="px-2 py-1.5" style={{ minWidth: 80 }}>
                        <DivergingBar value={contrib(p, k)} max={maxAbs} color={d.colorByFirm.get(p.firmId)!} />
                      </td>
                    ))}
                    <td className="py-1.5 pl-2"><Tag tone="copper">{SCORE_LABEL[lean]}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {SCORE_KEYS.map((k) => (
          <ChartCard key={k} title={`${SCORE_LABEL[k]} (normalized, over rounds)`} series={teamSeries(d, (p) => p.scoreNorm[k])} formatY={(n) => n.toFixed(1)} zeroBaseline />
        ))}
      </div>
    </div>
  );
}

function MarketPanel({ d }: { d: Derived }) {
  const segIds = d.data.meta.segments.map((s) => s.id);
  // Demand vs served per segment, over rounds.
  const demandSeries = (segId: string): Series[] => {
    const rows = d.data.market.filter((m) => m.segment === segId).sort((a, b) => a.round - b.round);
    return [
      { label: "Demand", color: "var(--color-inksoft)", data: rows.map((m) => m.D) },
      { label: "Served", color: "var(--color-copper)", data: rows.map((m) => m.total_q) },
    ];
  };
  // Latest-round competitive split per segment.
  const latest = d.latest;
  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Demand vs. served</Eyebrow>
        <Legend series={[{ label: "Demand (D)", color: "var(--color-inksoft)", data: [] }, { label: "Units served", color: "var(--color-copper)", data: [] }]} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        {segIds.map((s) => (
          <ChartCard key={s} title={SEG_LABEL[s] ?? s} series={demandSeries(s)} formatY={fmt.int} zeroBaseline />
        ))}
      </div>
      <Card>
        <Eyebrow>Who holds each segment · last round</Eyebrow>
        <div className="grid gap-3">
          {segIds.map((s) => {
            const parts = latest
              .map((p) => ({ firmId: p.firmId, q: p.segments[s]?.q_sold ?? 0 }))
              .filter((x) => x.q > 0)
              .sort((a, b) => b.q - a.q);
            const total = parts.reduce((a, x) => a + x.q, 0);
            return (
              <div key={s}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{SEG_LABEL[s] ?? s}</span>
                  <span className="tnum text-inksoft">{fmt.int(total)} units</span>
                </div>
                {total > 0 ? (
                  <div className="mt-1 flex h-3 w-full overflow-hidden rounded-[2px] border border-line">
                    {parts.map((x) => (
                      <div key={x.firmId} title={`${d.nameByFirm.get(x.firmId)}: ${fmt.int(x.q)} (${fmt.pct(x.q / total)})`} style={{ width: `${(x.q / total) * 100}%`, background: d.colorByFirm.get(x.firmId)! }} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-[0.72rem] text-inksoft">No sales this round.</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

const STRAT_DIMS: { key: string; label: string; get: (p: DashPanelRow) => number; fmt: (n: number) => string }[] = [
  { key: "unitCost", label: "Unit cost", get: (p) => p.unitCost, fmt: fmt.price },
  { key: "meanPrice", label: "Avg price", get: (p) => p.meanPrice, fmt: fmt.price },
  { key: "Q", label: "Recipe quality", get: (p) => p.Q, fmt: (n) => n.toFixed(0) },
  { key: "B", label: "Brand", get: (p) => p.B, fmt: (n) => n.toFixed(0) },
  { key: "cap", label: "Capacity", get: (p) => p.cap, fmt: fmt.int },
  { key: "share", label: "Market share", get: (p) => p.share, fmt: fmt.pct },
  { key: "T_emp", label: "Taproom community", get: (p) => p.T_emp, fmt: (n) => n.toFixed(0) },
  { key: "T_inv", label: "Investor relations", get: (p) => p.T_inv, fmt: (n) => n.toFixed(0) },
  { key: "T_gov", label: "Regulator relations", get: (p) => p.T_gov, fmt: (n) => n.toFixed(0) },
  { key: "leverage", label: "Leverage", get: (p) => p.leverage, fmt: flev },
];

function StrategyPanel({ d }: { d: Derived }) {
  const [xKey, setXKey] = useState("unitCost");
  const [yKey, setYKey] = useState("B");
  const xDim = STRAT_DIMS.find((x) => x.key === xKey)!;
  const yDim = STRAT_DIMS.find((x) => x.key === yKey)!;
  const latest = d.latest;
  const scores = latest.map((p) => p.scoreCumulative);
  const sLo = Math.min(...scores, 0);
  const sHi = Math.max(...scores, 0.01);
  const sizeFor = (p: DashPanelRow) => 4 + ((p.scoreCumulative - sLo) / (sHi - sLo || 1)) * 6;

  const pts: ScatterPoint[] = latest.map((p) => ({
    label: d.nameByFirm.get(p.firmId)!,
    color: d.colorByFirm.get(p.firmId)!,
    x: xDim.get(p),
    y: yDim.get(p),
    size: sizeFor(p),
    faded: p.status !== "active",
  }));

  const hasDist = latest.some((p) => p.distinctiveness);
  const distPts: ScatterPoint[] = latest
    .filter((p) => p.distinctiveness)
    .map((p) => ({ label: d.nameByFirm.get(p.firmId)!, color: d.colorByFirm.get(p.firmId)!, x: p.distinctiveness!.mahalanobis, y: p.scoreCumulative, size: 5, faded: p.status !== "active" }));

  const Select = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-[2px] border border-line2 bg-paper px-1 py-0.5 font-mono text-xs text-ink">
      {STRAT_DIMS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
    </select>
  );

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Strategy map · pick the axes (point size = cumulative score)</Eyebrow>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-inksoft">
          <span>Y: <Select value={yKey} onChange={setYKey} /></span>
          <span>X: <Select value={xKey} onChange={setXKey} /></span>
        </div>
        <Scatter points={pts} xLabel={xDim.label} yLabel={yDim.label} fmtX={xDim.fmt} fmtY={yDim.fmt} />
        <div className="text-[0.7rem] text-inksoft">Spread out = distinctive positioning; clusters = a crowded contest.</div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Eyebrow>Distinctiveness · last round</Eyebrow>
          {hasDist ? (
            <div className="grid gap-1.5">
              {[...latest].filter((p) => p.distinctiveness).sort((a, b) => b.distinctiveness!.mahalanobis - a.distinctiveness!.mahalanobis).map((p) => {
                const max = Math.max(...latest.filter((x) => x.distinctiveness).map((x) => x.distinctiveness!.mahalanobis), 0.01);
                return (
                  <div key={p.firmId} className="flex items-center gap-2">
                    <ColorDot color={d.colorByFirm.get(p.firmId)!} />
                    <span className="w-28 truncate text-sm">{d.nameByFirm.get(p.firmId)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-[2px] bg-line">
                      <div className="h-full" style={{ width: `${(p.distinctiveness!.mahalanobis / max) * 100}%`, background: d.colorByFirm.get(p.firmId)! }} />
                    </div>
                    <span className="tnum w-12 text-right text-xs text-inksoft">{p.distinctiveness!.mahalanobis.toFixed(2)}</span>
                  </div>
                );
              })}
              <div className="mt-1 text-[0.7rem] text-inksoft">Mahalanobis distance from the industry centroid — higher = more strategically unusual.</div>
            </div>
          ) : (
            <div className="text-sm text-inksoft">Distinctiveness needs ≥2 active firms; not available yet.</div>
          )}
        </Card>
        <Card>
          <Eyebrow>Does differentiation pay?</Eyebrow>
          {distPts.length >= 2 ? (
            <>
              <Scatter points={distPts} xLabel="Distinctiveness (Mahalanobis)" yLabel="Cumulative score" fmtX={(n) => n.toFixed(2)} fmtY={fscore} />
              <div className="text-[0.7rem] text-inksoft">Each team at the last round. Watch for the inverted-U: moderate distinctiveness often outscores both the crowd and the extreme outlier.</div>
            </>
          ) : (
            <div className="text-sm text-inksoft">Not enough data yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CoopetitionPanel({ d }: { d: Derived }) {
  const ags = d.data.agreements;
  const TPL: Record<string, string> = { joint_marketing: "Joint marketing", capacity_coordination: "Capacity coord.", supply_share: "Supply share" };
  const TPL_ABBR: Record<string, string> = { joint_marketing: "JM", capacity_coordination: "CC", supply_share: "SS" };
  const teams = d.teams;

  if (ags.length === 0) {
    return (
      <Card>
        <Eyebrow>Coopetition</Eyebrow>
        <div className="text-sm text-inksoft">No agreements formed yet. When teams partner (joint marketing, capacity coordination, supply share), the alliances and their dissolutions show up here.</div>
      </Card>
    );
  }

  // Partner matrix: for each unordered pair, the most recent agreement (if any).
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const byPair = new Map<string, (typeof ags)[number]>();
  for (const a of ags) {
    for (let i = 0; i < a.signatories.length; i++) {
      for (let j = i + 1; j < a.signatories.length; j++) {
        byPair.set(pairKey(a.signatories[i], a.signatories[j]), a);
      }
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Partner matrix</Eyebrow>
        <div className="overflow-x-auto">
          <table className="border-collapse text-center text-xs">
            <thead>
              <tr>
                <th className="p-1" />
                {teams.map((t) => (
                  <th key={t.firmId} className="p-1"><ColorDot color={d.colorByFirm.get(t.firmId)!} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((rt) => (
                <tr key={rt.firmId}>
                  <th className="whitespace-nowrap p-1 text-left font-normal"><span className="flex items-center gap-1"><ColorDot color={d.colorByFirm.get(rt.firmId)!} /><span className="truncate">{d.nameByFirm.get(rt.firmId)}</span></span></th>
                  {teams.map((ct) => {
                    if (rt.firmId === ct.firmId) return <td key={ct.firmId} className="bg-panel2 p-1 text-inksoft">·</td>;
                    const a = byPair.get(pairKey(rt.firmId, ct.firmId));
                    return (
                      <td key={ct.firmId} className="border border-line p-1">
                        {a ? <span className={a.active ? "font-semibold text-copperdeep" : "text-inksoft line-through"} title={`${TPL[a.template]} · ${a.form}${a.active ? "" : " (dissolved)"}`}>{TPL_ABBR[a.template]}</span> : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[0.7rem] text-inksoft">JM = joint marketing · CC = capacity coordination · SS = supply share. Struck-through = dissolved.</div>
      </Card>

      <Card>
        <Eyebrow>Agreement register</Eyebrow>
        <div className="grid gap-1">
          {ags.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 text-sm last:border-0">
              <span className="flex items-center gap-2">
                {a.active ? <Tag tone="hop">active</Tag> : <Tag tone="brick">{a.dissolutionType ?? "ended"}</Tag>}
                <span className="font-semibold">{TPL[a.template] ?? a.template}</span>
                <span className="text-inksoft">({a.form}{a.segment ? ` · ${SEG_LABEL[a.segment] ?? a.segment}` : ""})</span>
              </span>
              <span className="text-[0.72rem] text-inksoft">
                {a.signatories.map((s) => d.nameByFirm.get(s) ?? s).join(" + ")} · formed R{a.formationRound + 1}{a.dissolutionRound != null ? ` → ended R${a.dissolutionRound + 1}` : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function FinancePanel({ d }: { d: Derived }) {
  const latest = [...d.latest];
  const riskTone = (p: DashPanelRow): "hop" | "copper" | "brick" => {
    if (p.status !== "active") return "brick";
    if (p.creditRationed || p.coverage < 1 || p.cash < 0) return "brick";
    if (p.belowSafety || p.coverage < 2 || p.leverage > 1.5) return "copper";
    return "hop";
  };
  const riskLabel = (p: DashPanelRow) => {
    if (p.status !== "active") return p.status.replace("exited_", "exit·");
    if (p.creditRationed) return "credit rationed";
    if (p.coverage < 1) return "can't cover interest";
    if (p.cash < 0) return "cash negative";
    // The engine's covenant clock: below the cash safety line counts toward forced exit
    // (3 quarters) and acquirability (4) even when the P&L looks fine.
    if (p.belowSafety) return `below safety line${(p.roundsBelowSafety ?? 0) > 1 ? ` · ${p.roundsBelowSafety}q` : ""}`;
    if (p.coverage < 2 || p.leverage > 1.5) return "watch";
    return "healthy";
  };
  // Ratio table: latest round per firm, with a trend arrow vs 3 rounds back.
  const ratioTrend = (p: DashPanelRow, def: (typeof RATIO_DEFS)[number]): ReactNode => {
    const prevRow = (d.panelByFirm.get(p.firmId) ?? []).find((r) => r.round === d.latestRound - 3);
    const cur = def.compute(p);
    const prev = prevRow ? def.compute(prevRow) : null;
    if (cur == null || prev == null || cur === prev) return null;
    const good = def.better === "high" ? cur > prev : cur < prev;
    return <span className={`ml-0.5 text-[0.6rem] ${good ? "text-hop" : "text-brick"}`}>{cur > prev ? "▲" : "▼"}</span>;
  };

  const activeRows = latest.filter((p) => p.status === "active");
  const wcs = computeWcs(activeRows);
  const distressed = firmsInDistress(d);
  const distressedIds = new Set(distressed.map((f) => f.firmId));
  const healthy = latest.filter((p) => p.status === "active" && !distressedIds.has(p.firmId));

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Solvency canaries · last round</Eyebrow>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                <th className="py-1 pr-2">Team</th>
                <th className="py-1 pr-2 text-right">Cash</th>
                <th className="py-1 pr-2 text-right">Net income</th>
                <th className="py-1 pr-2 text-right">Coverage</th>
                <th className="py-1 pr-2 text-right">Leverage</th>
                <th className="py-1 pr-2 text-right">Debt rate</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {latest.map((p) => (
                <tr key={p.firmId} className="border-t border-line">
                  <td className="py-1.5 pr-2"><span className="flex items-center gap-1.5"><ColorDot color={d.colorByFirm.get(p.firmId)!} /><span className="truncate font-semibold">{d.nameByFirm.get(p.firmId)}</span></span></td>
                  <td className={`py-1.5 pr-2 text-right ${p.cash < 0 ? "text-brick" : ""}`}>{fmt.money(p.cash)}</td>
                  <td className={`py-1.5 pr-2 text-right ${p.netIncome < 0 ? "text-brick" : "text-hop"}`}>{fmt.money(p.netIncome)}</td>
                  <td className={`py-1.5 pr-2 text-right ${p.coverage < 1 ? "text-brick" : ""}`}>{fcov(p.coverage)}</td>
                  <td className={`py-1.5 pr-2 text-right ${p.leverage > 1.5 ? "text-brick" : ""}`}>{flev(p.leverage)}</td>
                  <td className="py-1.5 pr-2 text-right">{(p.rDebt * 100).toFixed(1)}%</td>
                  <td className="py-1.5"><Tag tone={riskTone(p)}>{riskLabel(p)}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <Eyebrow>Distress watch</Eyebrow>
        {distressed.length === 0 ? (
          <div className="text-sm text-inksoft">No active firm is flagging — the field is solvent.</div>
        ) : (
          <div className="grid gap-1.5">
            {distressed.map((f) => (
              <div key={f.firmId} className="flex flex-wrap items-center gap-1.5">
                <ColorDot color={d.colorByFirm.get(f.firmId)!} />
                <span className="text-sm font-semibold">{d.nameByFirm.get(f.firmId)}</span>
                {f.flags.map((fl) => (
                  <Tag key={fl} tone="brick">{fl}</Tag>
                ))}
              </div>
            ))}
          </div>
        )}
        {distressed.length > 0 && healthy.length > 0 && (
          <div className="mt-2 text-[0.72rem] text-inksoft">Healthy: {healthy.map((p) => d.nameByFirm.get(p.firmId)).join(", ")}.</div>
        )}
      </Card>

      <Card>
        <Eyebrow>Financial ratios · round {d.latestRound + 1} (quarterly figures)</Eyebrow>
        <div className="mb-2 text-[0.72rem] text-inksoft">Arrows compare against three rounds back — ▲ improving, ▼ deteriorating, in whichever direction matters for that ratio.</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                <th className="py-1 pr-2">Ratio</th>
                {latest.map((p) => (
                  <th key={p.firmId} className="px-2 py-1 text-right"><span className="flex items-center justify-end gap-1"><ColorDot color={d.colorByFirm.get(p.firmId)!} /><span className="truncate">{d.nameByFirm.get(p.firmId)}</span></span></th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum">
              {RATIO_GROUPS.map((g) => (
                <Fragment key={g.id}>
                  <tr>
                    <td colSpan={latest.length + 1} className="pb-0.5 pt-2 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-copperdeep">{g.label}</td>
                  </tr>
                  {RATIO_DEFS.filter((def) => def.group === g.id).map((def) => (
                    <tr key={def.key} className="border-t border-line">
                      <td className="whitespace-nowrap py-1 pr-2 text-inksoft">{def.label}</td>
                      {latest.map((p) => (
                        <td key={p.firmId} className="whitespace-nowrap px-2 py-1 text-right">{ratioDisplay(def, def.compute(p))}{ratioTrend(p, def)}</td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {wcs.length >= 2 && (
        <Card>
          <Eyebrow>Weighted competitive strength · round {d.latestRound + 1}</Eyebrow>
          <div className="mb-2 text-[0.72rem] text-inksoft">Each factor min–max rated 1–10 across active firms; cell = rating · weighted score. Importance weight × strength rating → weighted score, the Key Success Factors table, live.</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                  <th className="py-1 pr-2">Factor · weight</th>
                  {wcs.map((w) => (
                    <th key={w.firmId} className="px-2 py-1 text-right"><span className="flex items-center justify-end gap-1"><ColorDot color={d.colorByFirm.get(w.firmId)!} /><span className="truncate">{d.nameByFirm.get(w.firmId)}</span></span></th>
                  ))}
                </tr>
              </thead>
              <tbody className="tnum">
                {WCS_FACTORS.map((f) => (
                  <tr key={f.key} className="border-t border-line">
                    <td className="whitespace-nowrap py-1 pr-2 text-inksoft">{f.label} · {fmt.pct(f.weight)}</td>
                    {wcs.map((w) => (
                      <td key={w.firmId} className="whitespace-nowrap px-2 py-1 text-right">{w.ratings[f.key].toFixed(1)} <span className="text-inksoft">· {(f.weight * w.ratings[f.key]).toFixed(2)}</span></td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-line2 font-semibold">
                  <td className="py-1.5 pr-2">Overall</td>
                  {wcs.map((w, i) => (
                    <td key={w.firmId} className="whitespace-nowrap px-2 py-1.5 text-right">{w.overall.toFixed(2)} <span className="font-normal text-inksoft">#{i + 1}</span></td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function TeamPanel({ d }: { d: Derived }) {
  const [firmId, setFirmId] = useState<string>(() => d.teams[0]?.firmId ?? "");
  const team = d.teams.find((t) => t.firmId === firmId) ?? d.teams[0];
  if (!team) return <Card>No teams.</Card>;
  const color = d.colorByFirm.get(team.firmId)!;
  const rows = d.panelByFirm.get(team.firmId) ?? [];
  const last = rows.at(-1);
  const eng = d.data.engagement.filter((e) => e.firmId === team.firmId).sort((a, b) => a.round - b.round);
  const segIds = d.data.meta.segments.map((s) => s.id);
  const oneSeries = (get: (p: DashPanelRow) => number, label: string): Series[] => [{ label, color, data: rows.map(get) }];

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Team drill-down</Eyebrow>
        <div className="flex flex-wrap gap-1.5">
          {d.teams.map((t) => (
            <button
              key={t.firmId}
              onClick={() => setFirmId(t.firmId)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${t.firmId === firmId ? "border-copper text-copperdeep" : "border-line2 text-inksoft hover:text-ink"}`}
            >
              <ColorDot color={d.colorByFirm.get(t.firmId)!} />
              {d.nameByFirm.get(t.firmId)}
            </button>
          ))}
        </div>
        {last && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rank" value={`#${last.rank}`} accent="copper" />
            <Stat label="Score" value={fscore(last.scoreCumulative)} />
            <Stat label="Cash" value={fmt.money(last.cash)} accent={last.cash < 0 ? "brick" : "ink"} />
            <Stat label="Status" value={<Tag tone={last.status === "active" ? "hop" : "brick"}>{last.status.replace("exited_", "exit·")}</Tag>} />
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Score" series={oneSeries((p) => p.scoreCumulative, "score")} formatY={(n) => n.toFixed(2)} />
        <ChartCard title="Cash" series={oneSeries((p) => p.cash, "cash")} formatY={fmt.money} zeroBaseline />
        <ChartCard title="Market share" series={oneSeries((p) => p.share, "share")} formatY={fmt.pct} zeroBaseline />
        <ChartCard title="Net income" series={oneSeries((p) => p.netIncome, "net income")} formatY={fmt.money} zeroBaseline />
      </div>

      {last && (
        <Card>
          <Eyebrow>Last round · category economics</Eyebrow>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2 text-right">Price</th>
                  <th className="py-1 pr-2 text-right">Share</th>
                  <th className="py-1 pr-2 text-right">Units sold</th>
                  <th className="py-1 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {segIds.map((s) => {
                  const sr = last.segments[s];
                  if (!sr) return null;
                  return (
                    <tr key={s} className="border-t border-line">
                      <td className="py-1 pr-2">{SEG_LABEL[s] ?? s}</td>
                      <td className="py-1 pr-2 text-right">{sr.price > 0 ? fmt.price(sr.price) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{fmt.pct(sr.share)}</td>
                      <td className="py-1 pr-2 text-right">{fmt.int(sr.q_sold)}</td>
                      <td className="py-1 text-right">{fmt.money(sr.revenue)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <Row label="Unit cost" value={fmt.price(last.unitCost)} />
            <Row label="Coverage" value={fcov(last.coverage)} />
            <Row label="Leverage" value={flev(last.leverage)} />
            <Row label="Valuation" value={fmt.money(last.valuation)} />
          </div>
        </Card>
      )}

      <Card>
        <Eyebrow>Decision process, beliefs &amp; reflections</Eyebrow>
        {eng.length === 0 ? (
          <div className="text-sm text-inksoft">No decisions recorded (NPC or not yet played).</div>
        ) : (
          <div className="grid gap-2">
            {eng.map((e) => (
              <div key={e.round} className="border-b border-line pb-2 last:border-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.72rem] text-inksoft tnum">
                  <span className="font-semibold text-ink">Round {e.round + 1}</span>
                  <span>{e.submitted ? "submitted" : "no submission"}</span>
                  <span>{e.revisionCount} revisions</span>
                  <span>{ftime(e.timeToDecideS)}</span>
                  {e.infoPurchased && <span className="text-copperdeep">bought research</span>}
                  {e.predictedRank != null && (
                    <span>
                      predicted #{e.predictedRank} · actual #{e.realizedRank ?? "—"}
                      {e.beliefScore != null && <span className="text-inksoft"> ({fmt.pct(e.beliefScore)} accurate)</span>}
                    </span>
                  )}
                </div>
                {e.reflection && <div className="mt-1 text-sm italic text-ink">“{e.reflection}”</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// =============================================================================
// Dashboard shell
// =============================================================================

/** Monitor — where each team stands (joined/bot, last decision, cash, rank). Live this-round
 *  submission status lives on the controls screen; this is the resolved-round snapshot. */
function MonitorPanel({ d }: { d: Derived }) {
  const lastEng = d.engByRound.get(d.latestRound) ?? [];
  const engByFirm = new Map(lastEng.map((e) => [e.firmId, e]));
  const panelByFirm = new Map(d.latest.map((p) => [p.firmId, p]));
  return (
    <Card>
      <Eyebrow>Monitor · teams</Eyebrow>
      <div className="mb-3 text-sm text-inksoft">Where each team stands{d.latestRound >= 0 ? ` after round ${d.latestRound + 1}` : ""}. Live this-round submission status is on the controls screen.</div>
      <div className="grid grid-cols-[1.6fr_1.1fr_1fr_0.7fr] gap-2 border-b border-line pb-1 font-mono text-[0.55rem] uppercase tracking-wide text-inksoft"><span>Team</span><span>Last decision</span><span className="text-right">Cash</span><span className="text-right">Rank</span></div>
      {d.teams.map((t) => {
        const e = engByFirm.get(t.firmId); const p = panelByFirm.get(t.firmId);
        return (
          <div key={t.firmId} className="grid grid-cols-[1.6fr_1.1fr_1fr_0.7fr] items-center gap-2 border-b border-line py-1.5 last:border-0">
            <span className="flex min-w-0 items-center gap-2"><ColorDot color={d.colorByFirm.get(t.firmId)!} /><span className="truncate text-sm font-semibold text-ink">{d.nameByFirm.get(t.firmId)}</span>{!t.joined && <Tag tone="ink">bot</Tag>}</span>
            <span>{e ? <Tag tone={e.submitted ? "hop" : "ink"}>{e.submitted ? `submitted${e.revisionCount > 0 ? ` · ${e.revisionCount} rev` : ""}` : "no decision"}</Tag> : <span className="text-[0.7rem] text-inksoft">awaiting round 1</span>}</span>
            <span className="tnum text-right text-sm text-ink">{p ? fmt.money(p.cash) : "—"}</span>
            <span className="tnum text-right text-sm font-semibold text-copperdeep">{p ? `#${p.rank}` : "—"}</span>
          </div>
        );
      })}
    </Card>
  );
}

/** Balance — the Tuning Board as a planning/reference surface. Game balance is fixed at
 *  creation, so this doesn't mutate a running game; it's for noting settings to reuse. */
function BalancePanel() {
  const [vals, setVals] = useState<TuningVals>(() => tuningDefaults());
  return (
    <div className="grid gap-3">
      <Card><Eyebrow>Balance · the Tuning Board</Eyebrow><div className="text-sm text-inksoft">Game balance is set when you create a game (New game → Balance &amp; tuning). Experiment here and save settings to reuse as a treatment condition next section — this board does not change a game already in progress.</div></Card>
      <TuningBoard value={vals} onChange={setVals} />
    </div>
  );
}

/** One scheduled-shock chip on the forward timeline: what/how hard/how long/where,
 *  planted vs rolled vs fired, and a remove button while it can still be pulled. */
function ShockChip({ s, removable, busy, onRemove }: { s: ScheduledShock; removable: boolean; busy: boolean; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[3px] border border-line px-2 py-0.5 text-[0.7rem]">
      <span className="font-semibold text-ink">{shockLabel(s.type_id)}</span>
      <span className="tnum text-inksoft">
        {KIND_LABEL[s.kind] ?? s.kind}{s.target && s.target !== "all" ? ` (${SEG_LABEL[s.target] ?? s.target})` : ""} · {fmt.pct(s.magnitude)}{s.duration > 1 ? ` · ${s.duration} rds` : ""}{s.region ? ` · ${regionLabel(s.region)}` : ""}
      </span>
      <Tag tone={s.locked ? "copper" : "ink"}>{s.locked ? "planted" : "rolled"}</Tag>
      {s.fired && <Tag tone="brick">fired</Tag>}
      {removable && !s.fired && (
        <button onClick={onRemove} disabled={busy} className="px-0.5 text-inksoft transition-colors hover:text-brick disabled:opacity-40" title="remove from the schedule">✕</button>
      )}
    </span>
  );
}

/** Schedule — the gamemaster board (DW-037): past rounds retrospective, current +
 *  future rounds show the forward shock schedule (engine-rolled and instructor-
 *  planted), with plant / remove / fire-now controls. */
function SchedulePanel({ d, client, gameId, roundKey }: { d: Derived; client: InstructorClient; gameId: string; roundKey: string }) {
  const [tl, setTl] = useState<GameTimeline | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Plant form. magnitude/duration null = use the catalog type's default.
  const [formRound, setFormRound] = useState<number | null>(null);
  const [typeId, setTypeId] = useState("");
  const [mag, setMag] = useState<number | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  const [region, setRegion] = useState("");

  const refresh = useCallback(async () => {
    try {
      setTl(await client.timeline(gameId));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [client, gameId]);
  useEffect(() => {
    refresh();
  }, [refresh, roundKey]); // roundKey: re-pull the timeline after a resolve so fired/current rows are right

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await op();
      await refresh(); // mutations return partial payloads; refetch keeps catalog/triggers/timeline in one state
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const eventsByRound = new Map(d.data.events.map((e) => [e.round, e.events] as const));
  const nRounds = d.data.meta.nRounds;
  const running = d.data.meta.lifecycle !== "complete";
  const curRound = tl?.round ?? d.data.meta.currentRound;
  const sel = tl?.catalog.find((c) => c.id === typeId) ?? tl?.catalog[0];
  // Clamp so a selection made before a resolve can't point at a now-past round.
  const plantRound = Math.min(Math.max(formRound ?? curRound + 1, curRound), nRounds - 1);
  const plantRounds = Array.from({ length: nRounds - curRound }, (_, i) => curRound + i);
  const selectCls = "rounded-[2px] border border-line2 bg-paper px-1 py-0.5 font-mono text-xs text-ink";

  const plant = () => {
    if (!sel) return;
    run(() =>
      client.scheduleShock(gameId, {
        type_id: sel.id,
        round: plantRound,
        ...(mag != null ? { magnitude: mag } : {}),
        ...(dur != null ? { duration: dur } : {}),
        ...(sel.regional && region ? { region } : {}),
      }),
    );
  };

  return (
    <Card>
      <Eyebrow>Schedule · the gamemaster board</Eyebrow>
      <div className="mb-3 text-sm text-inksoft">
        Past rounds show what fired; current and future rounds show the forward schedule — engine-rolled and instructor-planted. Students see a planted event only per that shock's own signaling: unannounced types stay a surprise (planting does not telegraph).
      </div>
      {err && <div className="mb-2 text-[0.72rem] text-brick">{err}</div>}
      {!tl && !err && <div className="mb-2 text-[0.72rem] text-inksoft">Loading the shock timeline…</div>}

      {tl && running && (
        <div className="mb-3 rounded-md border border-line px-3 py-2">
          <div className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">Fire now · lands when round {curRound + 1} resolves</div>
          <div className="flex flex-wrap gap-1.5">
            {tl.catalog.map((c) => {
              const armed = tl.liveTriggers.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => run(() => client.setLiveTrigger(gameId, c.id, !armed))}
                  disabled={busy}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[0.65rem] transition-colors disabled:opacity-40 ${armed ? "border-brick text-brick" : "border-line2 text-inksoft hover:text-ink"}`}
                  style={armed ? { background: "color-mix(in srgb, var(--color-brick) 10%, transparent)" } : undefined}
                >
                  {armed ? "armed · " : ""}{shockLabel(c.id)} <span className="opacity-70">({KIND_LABEL[c.kind] ?? c.kind})</span>
                </button>
              );
            })}
          </div>
          {tl.liveTriggers.length > 0 && <div className="mt-1.5 text-[0.68rem] text-inksoft">Click an armed trigger to disarm it before the resolve.</div>}
        </div>
      )}

      {tl && sel && running && (
        <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2 rounded-md border border-line px-3 py-2">
          <span className="mr-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">Plant a disruption</span>
          <label className="grid gap-0.5 text-[0.58rem] uppercase tracking-wide text-inksoft">
            Round
            <select value={plantRound} onChange={(e) => setFormRound(Number(e.target.value))} className={selectCls}>
              {plantRounds.map((r) => (
                <option key={r} value={r}>R{r + 1}{r === curRound ? " (current)" : ""}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5 text-[0.58rem] uppercase tracking-wide text-inksoft">
            Type
            <select value={sel.id} onChange={(e) => { setTypeId(e.target.value); setMag(null); setDur(null); setRegion(""); }} className={selectCls}>
              {tl.catalog.map((c) => (
                <option key={c.id} value={c.id}>{shockLabel(c.id)} — {KIND_LABEL[c.kind] ?? c.kind}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5 text-[0.58rem] uppercase tracking-wide text-inksoft">
            Magnitude
            <input type="number" min={0.05} max={sel.kind === "demand_drop" ? 0.9 : sel.kind === "cash_hit" ? 1 : 1.5} step={0.05} value={mag ?? sel.magnitude_mean} onChange={(e) => setMag(Number(e.target.value))} className={`${selectCls} w-16`} title={sel.kind === "demand_drop" || sel.kind === "demand_boost" ? "fraction of segment demand (0.2 = ±20%)" : sel.kind === "cash_hit" ? "fraction of cash on hand" : "multiplier on cost / capacity"} />
          </label>
          <label className="grid gap-0.5 text-[0.58rem] uppercase tracking-wide text-inksoft">
            Rounds
            <input type="number" min={1} max={6} step={1} value={dur ?? sel.duration} onChange={(e) => setDur(Number(e.target.value))} className={`${selectCls} w-12`} />
          </label>
          {sel.regional && tl.regions.length > 0 && (
            <label className="grid gap-0.5 text-[0.58rem] uppercase tracking-wide text-inksoft">
              Region
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={selectCls}>
                <option value="">everywhere</option>
                {tl.regions.map((r) => (
                  <option key={r} value={r}>{regionLabel(r)}</option>
                ))}
              </select>
            </label>
          )}
          <Button variant="ghost" onClick={plant} disabled={busy}>Plant</Button>
        </div>
      )}

      <div className="grid gap-1.5">
        {Array.from({ length: nRounds }, (_, r) => {
          const resolved = r <= d.latestRound;
          const cur = r === d.data.meta.currentRound && running;
          const past = resolved ? parseEvents(eventsByRound.get(r) ?? []).filter((e) => e.kind === "shock") : [];
          const scheduled = !resolved && tl ? tl.timeline.filter((s) => s.round === r) : [];
          return (
            <div key={r} className="flex items-start gap-3 rounded-md border px-3 py-2" style={{ borderColor: cur ? "var(--color-copper)" : "var(--color-line)", background: resolved ? "var(--color-panel)" : "color-mix(in srgb, var(--color-panel2) 40%, transparent)" }}>
              <span className="w-12 pt-0.5 font-mono text-[0.62rem] font-bold uppercase text-copperdeep">R{r + 1}</span>
              <div className="min-w-0 flex-1">
                {resolved ? (
                  past.length ? <div className="flex flex-wrap gap-1.5">{past.map((e, i) => <Tag key={i} tone="brick">{e.title}</Tag>)}</div> : <span className="text-[0.72rem] text-inksoft">calm — no shocks</span>
                ) : scheduled.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {scheduled.map((s) => (
                      <ShockChip key={s.id} s={s} removable={r >= curRound} busy={busy} onRemove={() => run(() => client.unscheduleShock(gameId, s.id))} />
                    ))}
                  </div>
                ) : (
                  <span className="text-[0.72rem] italic text-inksoft">{cur ? "in progress — nothing scheduled" : "nothing scheduled"}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const EXPORT_TABLES = ["firm_round — per firm × round panel", "agreements — coopetition pacts", "beliefs & reflections", "engagement & telemetry", "market evolution"];
/** Export — research data download (the panel + agreements + beliefs + telemetry) for Stata/R. */
function ExportPanel({ exporting, onExport }: { exporting: boolean; onExport: (f: "csv" | "json") => void }) {
  return (
    <Card>
      <Eyebrow>Export · research data</Eyebrow>
      <div className="mb-3 text-sm text-inksoft"><strong>CSV</strong> — the tidy per-firm-per-round panel for grading and analysis (one row per firm per resolved round: financials, stocks, market position, scorecard with practice-round flag and bridge, engagement/beliefs/reflection, and the team's members with NetIDs and chairs). <strong>JSON</strong> — everything, including agreements, market evolution and the event log.</div>
      <div className="mb-3 grid gap-1">{EXPORT_TABLES.map((t) => <div key={t} className="flex items-center gap-2 text-[0.78rem] text-ink"><span className="h-1.5 w-1.5 flex-none rounded-full bg-copper" />{t}</div>)}</div>
      <div className="flex gap-2"><Button variant="go" onClick={() => onExport("csv")} disabled={exporting}>Download CSV</Button><Button variant="ghost" onClick={() => onExport("json")} disabled={exporting}>Download JSON</Button></div>
    </Card>
  );
}

export function InstructorDashboard({ client, gameId, roundKey }: { client: InstructorClient; gameId: string; roundKey: string }) {
  const [data, setData] = useState<DashData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<DashTab>("overview");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await client.dashboard(gameId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, gameId]);

  // Refetch when a round resolves / lifecycle changes (roundKey), and on mount.
  useEffect(() => {
    load();
  }, [load, roundKey]);

  const exportFile = async (format: "csv" | "json") => {
    setExporting(true);
    try {
      const blob = await client.exportData(gameId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `drinkwars-${gameId}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const d = useMemo(() => (data ? derive(data) : null), [data]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 font-mono text-xs tracking-wide transition-colors ${tab === t.id ? "border-copper text-copperdeep" : "border-transparent text-inksoft hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[0.7rem] text-inksoft">refreshing…</span>}
          <Button variant="ghost" onClick={load} disabled={loading}>Refresh</Button>
          <Button variant="ghost" onClick={() => exportFile("csv")} disabled={exporting || !data}>Export CSV</Button>
          <Button variant="ghost" onClick={() => exportFile("json")} disabled={exporting || !data}>JSON</Button>
        </div>
      </div>

      {err && <div className="text-sm text-brick">{err}</div>}

      {!d ? (
        <Card><div className="text-sm text-inksoft">Loading dashboard…</div></Card>
      ) : (
        <>
          {tab === "monitor" && <MonitorPanel d={d} />}
          {tab === "balance" && <BalancePanel />}
          {tab === "schedule" && <SchedulePanel d={d} client={client} gameId={gameId} roundKey={roundKey} />}
          {tab === "export" && <ExportPanel exporting={exporting} onExport={exportFile} />}
          {NEEDS_ROUND.has(tab) && (d.data.meta.resolvedRounds === 0 ? (
            <Card>
              <Eyebrow>No rounds resolved yet</Eyebrow>
              <div className="text-sm text-inksoft">Lock and resolve the first round to populate the analytics. Monitor, Balance, Schedule, and Export are available now.</div>
            </Card>
          ) : (
            <>
              {tab === "overview" && <OverviewPanel d={d} />}
              {tab === "trajectories" && <TrajectoriesPanel d={d} />}
              {tab === "score" && <ScorePanel d={d} />}
              {tab === "market" && <MarketPanel d={d} />}
              {tab === "strategy" && <StrategyPanel d={d} />}
              {tab === "coopetition" && <CoopetitionPanel d={d} />}
              {tab === "finance" && <FinancePanel d={d} />}
              {tab === "team" && <TeamPanel d={d} />}
            </>
          ))}
        </>
      )}
    </div>
  );
}
