import { useEffect, useState } from "react";
import type { Facility, FirmDecision, PrPlayType, SegmentId } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { mergeDecision, type CityActions } from "../game/cityActions.js";
import { SEG_LABEL, SEG_TAG, STOCK_LABEL, fmt } from "../labels.js";
import { Button, Card, Eyebrow, Row, Tag } from "./ui.js";
import { AllocationBar } from "./AllocationBar.js";
import { CategoryCoin } from "./CategoryIcons.js";
import { EventModal, type GameEvent } from "./EventModal.js";
import { InfoDot } from "./InfoDot.js";
import { WorldMap } from "./WorldMap.js";
import { MarketDetail } from "./MarketDetail.js";
import { Alliances } from "./Alliances.js";
import { Avatar, SkillStars } from "./People.js";
import { firmColor } from "../lib/teamColors.js";
import { EmployeeDetail } from "./EmployeeDetail.js";
import { FacilityDetail } from "./FacilityDetail.js";

const PR_PLAYS: { id: PrPlayType; label: string; description: string }[] = [
  { id: "festival", label: "Festival sponsorship", description: "A steady brand lift at a community event." },
  { id: "collab", label: "Brewer collaboration", description: "A buzzier co-release — a bigger spike." },
  { id: "viral", label: "Viral label drop", description: "Highest-upside splash — the biggest spike." },
];
const PR_LABEL: Record<PrPlayType, string> = { festival: "Festival sponsorship", collab: "Brewer collab", viral: "Viral label drop" };
const GOOD_LABEL: Record<string, string> = { regional_marketing: "Regional marketing fund", water_commons: "Water-commons pool", quality_certification: "Quality certification" };
const GOOD_BLURB: Record<string, string> = {
  demand: "Lifts demand for everyone in the segment.",
  water_resilience: "Softens the water shock industry-wide.",
  quality: "Raises how much the market rewards quality.",
};

type InvestKey = "invest_Q" | "invest_B" | "invest_process" | "invest_T_emp" | "invest_T_inv" | "invest_T_gov";
const INVEST_FIELDS: { key: InvestKey; label: string; hint: string }[] = [
  { key: "invest_Q", label: STOCK_LABEL.Q, hint: "Brewing talent, recipes, and consistency." },
  { key: "invest_B", label: STOCK_LABEL.B, hint: "Awareness, identity, and reputation." },
  { key: "invest_process", label: STOCK_LABEL.process, hint: "Operational efficiency and yield." },
  { key: "invest_T_emp", label: STOCK_LABEL.T_emp, hint: "Your taproom regulars and crew." },
  { key: "invest_T_inv", label: STOCK_LABEL.T_inv, hint: "Standing with your lenders and investors." },
  { key: "invest_T_gov", label: STOCK_LABEL.T_gov, hint: "Standing with your distributors and regulators." },
];

export function DecisionForm({
  view,
  defaultDecision,
  onPlay,
  busy,
  infoCost,
  onInfoChange,
  submitLabel,
  footerNote,
  poaches: externalPoaches,
  onPoach,
  cityActions,
  decision,
  setDecision,
}: {
  view: GameView;
  defaultDecision: () => Promise<FirmDecision>;
  onPlay: (d: FirmDecision) => void;
  busy: boolean;
  infoCost: number;
  onInfoChange?: (bought: boolean) => void;
  submitLabel?: string;
  footerNote?: string;
  // Talent raids, lifted to the screen so they can be made from a rival's dossier.
  // Optional: when absent (e.g. multiplayer) the form manages its own poach list.
  poaches?: { firm: string; employee: string; offer: number }[];
  onPoach?: (firm: string, employee: string, offer: number) => void;
  // City View actions (builds, market commitments, upkeep), merged into the round decision
  // at submit. When geography is on, the City View tab owns markets + facilities.
  cityActions?: CityActions;
  // The round decision draft. When the parent screen lifts it (single-player Play), it survives
  // tab switches; when absent (multiplayer), the form keeps it locally as before.
  decision?: FirmDecision | null;
  setDecision?: (d: FirmDecision) => void;
}) {
  const [localD, setLocalD] = useState<FirmDecision | null>(null);
  const lifted = setDecision !== undefined;
  const d = lifted ? decision ?? null : localD;
  const writeD = setDecision ?? setLocalD;
  const [prModal, setPrModal] = useState(false);
  const [marketDetail, setMarketDetail] = useState<string | null>(null);
  const [detailEmp, setDetailEmp] = useState<string | null>(null);
  const [detailFac, setDetailFac] = useState<string | null>(null);
  const [siteDistrict, setSiteDistrict] = useState<string>("");
  const activeSegs = view.segments.filter((s) => s.active).map((s) => s.id);

  // When lifted, the parent screen owns init/reset (so the draft survives tab switches);
  // only seed the LOCAL draft here for the multiplayer path.
  useEffect(() => {
    if (lifted) return;
    let live = true;
    defaultDecision().then((dd) => {
      if (live) {
        setLocalD(dd);
        onInfoChange?.(!!dd.buy_info);
      }
    });
    return () => {
      live = false;
    };
  }, [view.round, defaultDecision, onInfoChange, lifted]);

  if (!d) return <Card>Loading lineup…</Card>;

  const set = (patch: Partial<FirmDecision>) => writeD({ ...d, ...patch });
  const setPrice = (s: SegmentId, v: number) => set({ price: { ...d.price, [s]: v } });
  // The decision as it will actually be submitted — draft folded with City View actions + raids.
  // Projected-cash spend is computed from THIS, so market entry / siting done on the City View
  // tab is reflected in the Decide tab's forecast (not just merged silently at submit).
  const effective = mergeDecision(view, d, cityActions, externalPoaches);

  const cash = view.own.cash;
  // Production / inventory mode (only when the game was created with it on).
  const invOn = view.inventoryEnabled;
  const cap = view.own.cap;
  const stock = view.own.inventory_units ?? 0;
  const runRate = d.run_rate ?? 1; // fraction of capacity to brew (1 = full)
  const produced = runRate * cap;
  const sellable = stock + produced;
  const lastSold = view.ownResult?.inventory?.sold ?? null;
  const brewSpend = invOn ? produced * view.unitCostEst : 0; // cash out to brew this round

  // Expansion-module decision controls (gated on what the instructor enabled).
  const mods = view.modules;
  const prOn = !!mods?.prEvents?.enabled;
  const sustOn = !!mods?.sustainability?.enabled;
  const pgOn = !!mods?.publicGoods?.enabled;
  const prCost = mods?.prEvents?.cost ?? 0;
  const prCooldownUntil = view.own.pr_cooldown_until ?? null;
  const prOnCooldown = prCooldownUntil != null && view.round < prCooldownUntil;
  const prSpend = prOn && d?.pr_action && !prOnCooldown ? prCost : 0;
  const waterSpend = sustOn ? Math.max(0, d?.invest_water_efficiency ?? 0) : 0;
  const goods = mods?.publicGoods?.goods ?? [];
  const contribs = d?.public_good_contributions ?? {};
  const pgSpend = pgOn ? Object.values(contribs).reduce((a, b) => a + Math.max(0, b), 0) : 0;
  const rndOn = !!mods?.rndRace?.enabled;
  const rndSpend = rndOn ? Math.max(0, d?.invest_rnd ?? 0) : 0;
  const frontierActive = view.segments.some((s) => s.id === "frontier" && s.active);

  // MOD-B06 vertical assets · MOD-B03 key hires · MOD-B08 instruments · MOD-B07 M&A
  const vertOn = !!mods?.verticalIntegration?.enabled;
  const vertAssets = mods?.verticalIntegration?.assets ?? [];
  const owned = new Set((view.own.vertical_assets ?? []).map((a) => a.id));
  const buying = new Set(d?.buy_vertical ?? []);
  const vertSpend = vertOn ? vertAssets.filter((a) => buying.has(a.id) && !owned.has(a.id)).reduce((s, a) => s + a.cost, 0) : 0;
  const toggleBuy = (id: string) => {
    const next = new Set(buying);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ buy_vertical: [...next] });
  };
  // Talent is ONE system: the named employees roster (MOD-B12) supersedes the older
  // key-role toggles (MOD-B03). When employees is on, the B03 UI/spend is suppressed so the
  // player never sees two parallel hiring surfaces. B03 only shows in games without employees.
  const labOn = !!mods?.laborMarket?.enabled && !mods?.employees?.enabled;
  const labRoles = mods?.laborMarket?.roles ?? [];
  // Retention read: the chance a hire stays, from the same formula the engine uses
  // (employee trust mitigates the base departure probability).
  const labCfg = mods?.laborMarket;
  const tEmp = view.own.T_emp ?? 0;
  const pLeave = labCfg ? labCfg.departure_prob * (1 - labCfg.t_emp_mitigation * (tEmp / (tEmp + labCfg.t_emp_halfsat))) : 0;
  const retentionLabel = pLeave <= 0.03 ? "strong — your people stay" : pLeave <= 0.06 ? "solid" : "shaky — poaching risk is real";
  const retentionTone = pLeave <= 0.03 ? "text-hop" : pLeave <= 0.06 ? "text-copperdeep" : "text-brick";
  const onStaff = new Set((view.own.key_hires ?? []).map((h) => h.role));
  const hiring = new Set(d?.hire_roles ?? []);
  const firing = new Set(d?.fire_roles ?? []);
  const hireSpend = labOn ? labRoles.filter((r) => hiring.has(r.id) && !onStaff.has(r.id)).reduce((s, r) => s + r.signing_bonus + r.salary, 0) : 0;
  const toggleHire = (id: string) => {
    const next = new Set(hiring);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ hire_roles: [...next] });
  };
  const toggleFire = (id: string) => {
    const next = new Set(firing);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ fire_roles: [...next] });
  };
  const fiOn = !!mods?.financialInstruments?.enabled;
  const fiCfg = mods?.financialInstruments;
  const noteOut = view.own.convertible_note ?? null;
  const rbfOut = Math.max(0, view.own.rbf_outstanding ?? 0);
  const instrDraws = fiOn ? Math.max(0, d?.draw_convertible ?? 0) + Math.max(0, d?.draw_rbf ?? 0) : 0;
  const maOn = !!mods?.ma?.enabled;
  const rivals = view.standings.filter((s) => !s.isYou && s.status === "active");
  const bid = d?.acquisition_bid ?? null;
  // M&A reads: distress is public; fair value + floor need market research.
  const researched = !!d?.buy_info || view.infoActive;
  const maMinDistress = mods?.ma?.min_distress_rounds ?? 1;
  const maFloorFrac = mods?.ma?.min_price_fraction ?? 0.75;
  const snapOf = (firmId: string) => view.firms.find((f) => f.firm_id === firmId);
  const maFloor = (firmId: string) => maFloorFrac * Math.max(0, snapOf(firmId)?.valuation ?? 0);
  // Geography (MOD-B01/B02): which markets are open + this firm's capacity split.
  const geoOn = !!mods?.geography?.enabled;
  const intlOn = !!mods?.international?.enabled;
  const markets = geoOn ? (mods!.geography.markets ?? []).filter((m) => m.kind !== "export" || intlOn) : [];
  const entered = view.own.markets_entered ?? ["home"];
  const marketWeights = d?.market_presence ?? { home: 1 };
  const setWeight = (id: string, v: number) => set({ market_presence: { ...marketWeights, [id]: Math.max(0, v) } });
  const effWeights = effective.market_presence ?? { home: 1 };
  const geoEntrySpend = geoOn ? markets.filter((m) => m.kind !== "home" && (effWeights[m.id] ?? 0) > 0 && !entered.includes(m.id)).reduce((a, m) => a + m.entry_cost, 0) : 0;

  // MOD-A09 lobbying · MOD-A05/A06 alliances
  const lobOn = !!mods?.lobbying?.enabled;
  const lobInits = view.lobbyInitiatives ?? [];
  const lobSpend = lobOn ? Math.max(0, d?.lobby_spend ?? 0) : 0;
  const lobTargeted = lobOn && !!(d?.lobby_initiative || d?.lobby_counter);
  const lobSpendEff = lobTargeted ? lobSpend : 0; // the engine only charges spend that has a target
  const setLobby = (patch: Partial<FirmDecision>) => set(patch);
  const coopOn = !!(mods?.contingentContracts?.enabled || mods?.renegotiation?.enabled);
  const renegCallQueued = (d?.agreement_actions ?? []).some((a) => a.type === "renegotiate");
  const renegCallCost = renegCallQueued ? (mods?.renegotiation?.call_cost ?? 0) : 0;

  // MOD-B11 facilities (named physical capacity assets)
  const facOn = !!mods?.facilities?.enabled;
  // With geography on AND a City View available (single-player), markets + facility siting
  // are managed on the City View tab — the form defers to it and merges its actions at submit.
  const cityManaged = geoOn && !!cityActions;
  const facTypes = mods?.facilities?.types ?? [];
  const facDistricts = mods?.facilities?.districts ?? [];
  const facMax = mods?.facilities?.max_facilities ?? 0;
  const facilities = view.own.facilities ?? [];
  const fbuilds = d?.build_facilities ?? [];
  const fmaint = d?.maintain_facilities ?? {};
  const fmothball = new Set(d?.mothball_facilities ?? []);
  const freactivate = new Set(d?.reactivate_facilities ?? []);
  const facIsActive = (fac: Facility) => (freactivate.has(fac.id) ? true : fmothball.has(fac.id) ? false : fac.active);
  // Costs reflect the merged decision (form builds + City View builds), so the forecast is whole.
  const effBuilds = effective.build_facilities ?? [];
  const effMaint = effective.maintain_facilities ?? {};
  const buildCost = facOn ? effBuilds.reduce((s, b) => s + (facTypes.find((t) => t.id === b.type)?.base_cost ?? 0), 0) : 0;
  const maintCost = facOn ? Object.values(effMaint).reduce((s: number, v) => s + Math.max(0, v), 0) : 0;
  const facSpend = buildCost + maintCost;
  const addBuild = (type: string) => set({ build_facilities: [...fbuilds, { type, location: siteDistrict || facDistricts[0]?.id }] });
  const removeBuild = (i: number) => set({ build_facilities: fbuilds.filter((_, j) => j !== i) });
  const renameBuild = (i: number, name: string) => set({ build_facilities: fbuilds.map((b, j) => (j === i ? { ...b, name } : b)) });
  const setMaintain = (id: string, v: number) => set({ maintain_facilities: { ...fmaint, [id]: Math.max(0, v) } });
  const toggleFacActive = (fac: Facility) => {
    const m = new Set(fmothball), r = new Set(freactivate);
    m.delete(fac.id); r.delete(fac.id);
    if (facIsActive(fac)) { if (fac.active) m.add(fac.id); } // schedule mothball
    else if (!fac.active) r.add(fac.id); // schedule reactivate
    set({ mothball_facilities: [...m], reactivate_facilities: [...r] });
  };

  // MOD-B12 employees (named human capital)
  const empOn = !!mods?.employees?.enabled;
  const empRoles = mods?.employees?.roles ?? [];
  const empMax = mods?.employees?.max_employees ?? 0;
  const employees = view.own.employees ?? [];
  const candidates = view.hiringMarket ?? [];
  const ehiring = new Set(d?.hire_employees ?? []);
  const efiring = new Set(d?.fire_employees ?? []);
  const eraises = d?.raise_employees ?? {};
  const roleLabel = (id: string) => empRoles.find((r) => r.id === id)?.label ?? id;
  const fairSalary = (roleId: string, skill: number) => { const r = empRoles.find((x) => x.id === roleId); return r ? r.base_salary * (0.55 + 0.15 * skill) : 0; };
  const hireCost = empOn ? candidates.filter((cnd) => ehiring.has(cnd.id)).reduce((s, cnd) => s + cnd.salary, 0) : 0;
  const raiseCost = empOn ? employees.reduce((s: number, e) => s + Math.max(0, (eraises[e.id] ?? e.salary) - e.salary), 0) : 0;
  // Talent raids: use the lifted list when provided (poaching happens in rival dossiers),
  // otherwise manage them locally. Either way they're injected into the decision at submit.
  const setPoach = onPoach ?? ((firm: string, employee: string, offer: number) => {
    const rest = (d?.poach_employees ?? []).filter((x) => x.employee !== employee);
    set({ poach_employees: offer > 0 ? [...rest, { firm, employee, offer }] : rest });
  });
  const poaches = externalPoaches ?? (d?.poach_employees ?? []);
  const poachSpend = empOn ? poaches.reduce((s: number, x) => s + Math.max(0, x.offer), 0) : 0;
  const empSpend = hireCost + raiseCost + poachSpend;
  const toggleHireEmp = (id: string) => { const n = new Set(ehiring); n.has(id) ? n.delete(id) : n.add(id); set({ hire_employees: [...n] }); };
  const toggleFireEmp = (id: string) => { const n = new Set(efiring); n.has(id) ? n.delete(id) : n.add(id); set({ fire_employees: [...n] }); };
  const setRaise = (id: string, v: number) => set({ raise_employees: { ...eraises, [id]: Math.max(0, v) } });
  const empName = (firm: string, empId: string) => view.firms.find((f) => f.firm_id === firm)?.employees.find((e) => e.id === empId)?.name ?? empId;

  const moduleSpend = prSpend + waterSpend + pgSpend + geoEntrySpend + rndSpend + vertSpend + hireSpend + lobSpendEff + renegCallCost + facSpend + empSpend;
  const anyModuleControls = prOn || sustOn || pgOn || rndOn || vertOn || labOn || maOn || lobOn || facOn || empOn;
  const setContribution = (goodId: string, v: number) => set({ public_good_contributions: { ...contribs, [goodId]: Math.max(0, v) } });
  const prEvent: GameEvent | null = prModal
    ? {
        id: "pr-plan", kind: "opportunity", title: "Plan a PR play",
        body: <>A tactical brand play spikes your buzz this round, then fades fast — tactical, not lasting. Costs {fmt.money(prCost)}.</>,
        detail: "Each angle costs the same; bigger splashes spike harder.",
        choices: [
          ...PR_PLAYS.map((p) => ({ id: p.id, label: p.label, description: p.description, tone: "solid" as const })),
          { id: "none", label: "Skip — no play this round", tone: "ghost" as const },
        ],
      }
    : null;
  const onPrChoose = (cid: string) => { set({ pr_action: cid === "none" ? null : (cid as PrPlayType) }); setPrModal(false); };

  const investSpend = d.invest_cap + d.invest_Q + d.invest_B + d.invest_process + d.invest_T_emp + d.invest_T_inv + d.invest_T_gov;
  const infoSpend = d.buy_info ? infoCost : 0;
  const financeOut = d.debt_repay + d.dividend;
  const financeIn = d.debt_draw + d.equity_raise;
  const netFinancing = financeIn - financeOut;
  const projectedCash = cash - investSpend - infoSpend - brewSpend - moduleSpend + netFinancing + instrDraws; // before this round's sales
  const overcommit = projectedCash < 0;

  const equity = view.own.paid_in_capital + view.own.retained_earnings;
  const leverage = view.own.debt / Math.max(equity, 1e-6);
  const lastCov = view.ownResult?.cost_of_capital.coverage ?? null;
  const lastRate = view.ownResult?.cost_of_capital.r_debt ?? null;

  // Desktop command-center: with expansion content on, the cards split into two
  // columns — run the brewery (left) and grow the empire (right) — so a wide
  // screen shows the whole round at once instead of a long scroll.
  const twoCol = geoOn || anyModuleControls || coopOn;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <EventModal event={prEvent} onChoose={onPrChoose} onClose={() => setPrModal(false)} />
      {detailEmp != null && (() => {
        const emp = employees.find((x) => x.id === detailEmp);
        return emp ? (
          <EmployeeDetail employee={emp} role={empRoles.find((r) => r.id === emp.role)} roleLabel={roleLabel(emp.role)} raiseValue={eraises[emp.id]}
            onRaise={(s) => { setRaise(emp.id, s); setDetailEmp(null); }} onFire={() => toggleFireEmp(emp.id)} firing={efiring.has(emp.id)} onClose={() => setDetailEmp(null)} />
        ) : null;
      })()}
      {detailFac != null && (() => {
        const fac = facilities.find((x) => x.id === detailFac);
        return fac ? (
          <FacilityDetail facility={fac} type={facTypes.find((x) => x.id === fac.type)} round={view.round} maintainValue={fmaint[fac.id]}
            onMaintain={(s) => { setMaintain(fac.id, s); setDetailFac(null); }} active={facIsActive(fac)} onToggleActive={() => toggleFacActive(fac)} onClose={() => setDetailFac(null)} />
        ) : null;
      })()}
      {marketDetail && (() => {
        const m = markets.find((x) => x.id === marketDetail);
        if (!m) return null;
        return (
          <MarketDetail
            market={m}
            view={{ fx: view.fx }}
            weight={marketWeights[m.id] ?? (m.kind === "home" ? 1 : 0)}
            entered={m.kind === "home" || entered.includes(m.id)}
            perf={view.ownResult?.markets?.[m.id] ?? null}
            onClose={() => setMarketDetail(null)}
          />
        );
      })()}
      <div className={`grid content-start gap-4 ${twoCol ? "2xl:grid-cols-2" : ""}`}>
        <div className="grid min-w-0 content-start gap-4">
        {/* Pricing */}
        <Card>
          <Eyebrow>Lineup &amp; Pricing</Eyebrow>
          <div className="mb-3 text-sm text-inksoft">Set your price in each category. Est. unit cost {fmt.price(view.unitCostEst)}.</div>
          <div className="grid gap-3">
            {activeSegs.map((s) => {
              const margin = d.price[s] - view.unitCostEst;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className="flex w-40 items-center gap-2">
                    <CategoryCoin seg={s} size={28} />
                    <div>
                      <div className="text-sm font-semibold">{SEG_LABEL[s] ?? s}</div>
                      <Tag tone="copper">{SEG_TAG[s] ?? s}</Tag>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-inksoft">$</span>
                    <input type="number" step="0.25" min="0" value={d.price[s]} onChange={(e) => setPrice(s, Math.max(0, +e.target.value))} className="w-24 text-right" />
                  </div>
                  <div className={`tnum text-sm ${margin > 0 ? "text-hop" : "text-brick"}`}>{margin >= 0 ? "+" : ""}{margin.toFixed(2)} / unit</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Capacity + presence */}
        <Card>
          <Eyebrow>Tanks &amp; Allocation</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-inksoft">Invest in tank capacity (builds with a one-round lag)</label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-inksoft">$</span>
                <input type="number" step="50" min="0" value={d.invest_cap} onChange={(e) => set({ invest_cap: Math.max(0, +e.target.value) })} className="w-28 text-right" />
              </div>
              <div className="mt-1 text-[0.7rem] text-inksoft tnum">Current capacity: {fmt.int(view.own.cap)} units</div>
            </div>
            <div>
              <label className="text-sm text-inksoft">Capacity allocation — drag the dividers</label>
              <div className="mt-2">
                <AllocationBar
                  segments={activeSegs.map((s) => ({ id: s, label: SEG_TAG[s] ?? s }))}
                  weights={activeSegs.map((s) => d.presence[s] || 0)}
                  onChange={(w) => {
                    const next = { ...d.presence };
                    activeSegs.forEach((s, i) => (next[s] = w[i]));
                    set({ presence: next });
                  }}
                />
              </div>
            </div>
          </div>
          {invOn && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Run the line at</label>
                <span className="tnum text-sm text-copperdeep">{Math.round(runRate * 100)}% of capacity</span>
              </div>
              <input
                type="range" min="0" max="100" step="5"
                value={Math.round(runRate * 100)}
                onChange={(e) => set({ run_rate: Math.max(0, Math.min(1, +e.target.value / 100)) })}
                className="mt-1 w-full"
              />
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-inksoft tnum">
                <span>brew ≈ {fmt.int(produced)} units</span>
                <span>in stock {fmt.int(stock)}</span>
                <span>→ {fmt.int(sellable)} sellable this round</span>
                {lastSold != null && <span>(sold {fmt.int(lastSold)} last round)</span>}
              </div>
              <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">
                Brewing costs cash now ({fmt.money(brewSpend)}); unsold kegs carry over but a share spoils each round.
              </div>
            </div>
          )}
        </Card>

        {/* Investments */}
        <Card>
          <Eyebrow>Build the Brewery</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            {INVEST_FIELDS.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold">{f.label}</label>
                  <span className="tnum text-xs text-inksoft">{fmt.money(d[f.key])}</span>
                </div>
                <input type="range" min="0" max={Math.max(300, Math.round(cash * 0.5))} step="10" value={d[f.key]} onChange={(e) => set({ [f.key]: +e.target.value } as Partial<FirmDecision>)} className="mt-1 w-full" />
                <div className="text-[0.68rem] leading-snug text-inksoft">{f.hint}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[0.68rem] text-inksoft">More controls — financing, distributor &amp; investor relations, collaborations — unlock as the game progresses.</div>
        </Card>

        {/* Financing */}
        <Card>
          <Eyebrow>Financing</Eyebrow>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.72rem] text-inksoft tnum">
            <span>debt {fmt.money(view.own.debt)}</span>
            <span>equity {fmt.money(equity)}</span>
            <span className={leverage > 1.5 ? "text-brick" : ""}>leverage {leverage.toFixed(2)}</span>
            {lastRate != null && <span>borrowing rate {(lastRate * 100).toFixed(1)}%</span>}
            {lastCov != null && <span>coverage {lastCov > 900 ? "∞" : `${lastCov.toFixed(1)}×`}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { key: "debt_draw", label: "Draw debt (cash in)", hint: "Borrow cash now; capped by your leverage." },
              { key: "debt_repay", label: "Repay debt (cash out)", hint: "Lower leverage → cheaper future borrowing." },
              { key: "equity_raise", label: "Raise equity (cash in)", hint: "Raise cash by issuing equity — dilutive, with an issue cost." },
              { key: "dividend", label: "Pay dividend (cash out)", hint: "Returns cash to owners; capped at a fraction of cash." },
            ] as const).map((f) => (
              <div key={f.key}>
                <label className="text-sm font-semibold">{f.label}</label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-inksoft">$</span>
                  <input type="number" step="50" min="0" value={d[f.key]} onChange={(e) => set({ [f.key]: Math.max(0, +e.target.value) } as Partial<FirmDecision>)} className="w-28 text-right" />
                </div>
                <div className="text-[0.66rem] leading-snug text-inksoft">{f.hint}</div>
              </div>
            ))}
          </div>
          {fiOn && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">Alternative financing</span>
                <InfoDot title="Beyond plain debt">A convertible note is cheap cash now — but if you can't repay at maturity it converts into ownership (dilution). Revenue financing takes a slice of every round's sales until you've paid back {((fiCfg?.rbf.multiple ?? 1.3)).toFixed(1)}× what you drew — easy when sales dip, pricey when you boom.</InfoDot>
              </div>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm">Convertible note</label>
                  {noteOut ? (
                    <div className="mt-1 text-[0.72rem] text-inksoft tnum">Outstanding: {fmt.money(noteOut.principal)} · matures r{noteOut.drawn_round + (fiCfg?.convertible.term ?? 4) + 1}</div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-inksoft">$</span>
                      <input type="number" step="50" min="0" value={d.draw_convertible ?? 0} onChange={(e) => set({ draw_convertible: Math.max(0, +e.target.value) })} className="w-28 text-right" />
                    </div>
                  )}
                  <div className="text-[0.66rem] leading-snug text-inksoft">{Math.round((fiCfg?.convertible.rate ?? 0.04) * 100)}%/round · repay in {fiCfg?.convertible.term ?? 4} rounds or it converts to equity.</div>
                </div>
                <div>
                  <label className="text-sm">Revenue financing</label>
                  {rbfOut > 0 ? (
                    <div className="mt-1 text-[0.72rem] text-inksoft tnum">Still owed: {fmt.money(rbfOut)} (paid from sales)</div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-inksoft">$</span>
                      <input type="number" step="50" min="0" value={d.draw_rbf ?? 0} onChange={(e) => set({ draw_rbf: Math.max(0, +e.target.value) })} className="w-28 text-right" />
                    </div>
                  )}
                  <div className="text-[0.66rem] leading-snug text-inksoft">{Math.round((fiCfg?.rbf.payment_rate ?? 0.07) * 100)}% of each round's sales until {(fiCfg?.rbf.multiple ?? 1.3).toFixed(1)}× is repaid.</div>
                </div>
              </div>
            </div>
          )}
        </Card>

        </div>

        <div className="grid min-w-0 content-start gap-4">

        {/* With geography on, the City View tab owns markets + facility siting — point there. */}
        {facOn && cityManaged && (
          <Card>
            <Eyebrow>Facilities &amp; markets</Eyebrow>
            <p className="mt-1 text-sm text-inksoft">Your cities, districts, and facility siting now live on the <b className="text-ink">City View</b> tab — build, enter new markets, and route capacity there. Everything you queue is committed with this round when you brew.</p>
          </Card>
        )}

        {/* Facilities (MOD-B11) — owned physical capacity */}
        {facOn && !cityManaged && (
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <Eyebrow>Facilities</Eyebrow>
              <InfoDot title="Facilities" align="right">
                Your capacity lives in the breweries, taprooms, and lines you own. Build them (a capital expense), keep them in repair (upkeep), or mothball what you don't need. A run-down facility brews less — maintenance protects its output.
              </InfoDot>
            </div>

            {facilities.length > 0 ? (
              <div className="grid gap-2">
                {facilities.map((fac) => {
                  const t = facTypes.find((x) => x.id === fac.type);
                  const active = facIsActive(fac);
                  const online = view.round >= fac.online_round;
                  const condPct = Math.round(fac.condition * 100);
                  const condTone = fac.condition > 0.6 ? "var(--color-hop)" : fac.condition > 0.35 ? "var(--color-gold)" : "var(--color-brick)";
                  const liveCap = t ? Math.round((t.production_capacity ?? t.capacity_contribution ?? 0) * (0.5 + 0.5 * fac.condition)) : 0;
                  return (
                    <div key={fac.id} className={`rounded-md border p-2.5 ${active ? "border-line2 bg-paper2/30" : "border-line bg-paper2/10 opacity-70"}`}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setDetailFac(fac.id)} className="truncate text-left text-sm font-semibold text-ink transition-colors hover:text-copperdeep" title="Facility details">{fac.name}</button>
                        <Tag tone="ink">{t?.label ?? fac.type}</Tag>
                        {!online ? <Tag tone="copper">Building · r{fac.online_round + 1}</Tag> : !active ? <Tag tone="ink">Mothballed</Tag> : null}
                        <button type="button" onClick={() => toggleFacActive(fac)} className="ml-auto shrink-0 text-[0.66rem] font-semibold text-inksoft transition-colors hover:text-copperdeep">
                          {active ? "Mothball" : "Reactivate"}
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="w-16 text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">Condition</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-line">
                          <div className="h-full" style={{ width: `${condPct}%`, background: condTone }} />
                        </div>
                        <span className="tnum w-9 text-right text-[0.66rem] text-inksoft">{condPct}%</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[0.66rem] text-inksoft">
                        <span>{online ? `+${fmt.int(liveCap)} tanks` : "online soon"} · {fmt.money(t?.fixed_cost ?? 0)}/round</span>
                        {active && online && (
                          <label className="flex items-center gap-1">
                            <span>Upkeep $</span>
                            <input type="number" min={0} value={fmaint[fac.id] || ""} onChange={(e) => setMaintain(fac.id, +e.target.value)} placeholder="0"
                              className="tnum w-14 rounded border border-line bg-paper px-1 py-0.5 text-right text-[0.7rem]" />
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[0.74rem] text-inksoft">No facilities yet — build one below to add brewing capacity.</div>
            )}

            {fbuilds.map((b, i) => {
              const t = facTypes.find((x) => x.id === b.type);
              return (
                <div key={`build-${i}`} className="mt-1.5 flex items-center gap-2 rounded-md border border-copper/40 bg-copper/[0.06] px-2 py-1.5">
                  <span className="shrink-0 text-[0.7rem] font-semibold text-copperdeep">Building</span>
                  <input value={b.name ?? ""} onChange={(e) => renameBuild(i, e.target.value)} placeholder={t?.label ?? "Name it"}
                    className="min-w-0 flex-1 rounded border border-line bg-paper px-1.5 py-0.5 text-[0.72rem]" />
                  <span className="tnum shrink-0 text-[0.7rem] text-copperdeep">{fmt.money(t?.base_cost ?? 0)}</span>
                  <button type="button" onClick={() => removeBuild(i)} className="shrink-0 text-inksoft transition-colors hover:text-brick">✕</button>
                </div>
              );
            })}

            {facilities.length + fbuilds.length < facMax ? (
              <div className="mt-3 border-t border-line pt-2">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">
                  <span>Break ground</span>
                  {facDistricts.length > 0 && (
                    <label className="flex items-center gap-1 normal-case tracking-normal">
                      <span>in</span>
                      <select value={siteDistrict || facDistricts[0].id} onChange={(e) => setSiteDistrict(e.target.value)} className="rounded border border-line bg-paper px-1 py-0.5 text-[0.68rem] text-ink">
                        {facDistricts.map((dd) => <option key={dd.id} value={dd.id}>{dd.label} · rent ×{dd.rent_mult}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div className="grid gap-1.5">
                  {facTypes.map((t) => (
                    <button key={t.id} type="button" onClick={() => addBuild(t.id)} disabled={cash < t.base_cost}
                      className="flex items-center gap-2 rounded-md border border-line p-2 text-left transition-colors hover:border-copper disabled:cursor-not-allowed disabled:opacity-40">
                      <span className="text-sm font-semibold text-ink">{t.label}</span>
                      <span className="text-[0.64rem] text-inksoft">+{fmt.int(t.production_capacity ?? t.capacity_contribution ?? 0)} tanks{(t.retail_draw ?? 0) > 0 ? ` · +${fmt.int(t.retail_draw ?? 0)} retail` : ""} · {t.build_rounds}r · {fmt.money(t.fixed_cost)}/rd</span>
                      <span className="tnum ml-auto text-[0.72rem] text-copperdeep">{fmt.money(t.base_cost)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-[0.64rem] text-inksoft">At the facility limit ({facMax}).</div>
            )}

            {facSpend > 0 && (
              <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[0.72rem]">
                <span className="text-inksoft">This round</span>
                <span className="tnum text-ink">
                  {buildCost > 0 && `Build ${fmt.money(buildCost)}`}
                  {buildCost > 0 && maintCost > 0 && " · "}
                  {maintCost > 0 && `Upkeep ${fmt.money(maintCost)}`}
                </span>
              </div>
            )}
          </Card>
        )}

        {/* Team (MOD-B12) — named human capital */}
        {empOn && (
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <Eyebrow>Team</Eyebrow>
              <InfoDot title="Your team" align="right">
                Hire named people from the talent market. Each raises one of your stocks by their skill — but only while they're satisfied. Pay below market or hit hard times and morale slips; at zero they walk, and rivals poach the unhappy. A raise buys loyalty.
              </InfoDot>
            </div>

            {employees.length > 0 ? (
              <div className="grid gap-2">
                {employees.map((e) => {
                  const firingThis = efiring.has(e.id);
                  const satPct = Math.round(e.satisfaction * 100);
                  const satTone = e.satisfaction > 0.6 ? "var(--color-hop)" : e.satisfaction > 0.35 ? "var(--color-gold)" : "var(--color-brick)";
                  return (
                    <div key={e.id} className={`rounded-md border p-2.5 ${firingThis ? "border-brick/50 bg-brick/[0.06] opacity-70" : "border-line2 bg-paper2/30"}`}>
                      <div className="flex items-center gap-2">
                        <Avatar seed={e.avatar_seed} name={e.name} size={26} />
                        <button type="button" onClick={() => setDetailEmp(e.id)} className="truncate text-left text-sm font-semibold text-ink transition-colors hover:text-copperdeep" title="Employee details">{e.name}</button>
                        <SkillStars n={e.skill} />
                        <button type="button" onClick={() => toggleFireEmp(e.id)} className={`ml-auto shrink-0 text-[0.66rem] font-semibold transition-colors ${firingThis ? "text-copperdeep" : "text-inksoft hover:text-brick"}`}>
                          {firingThis ? "Keep" : "Let go"}
                        </button>
                      </div>
                      <div className="mt-0.5 text-[0.64rem] text-inksoft">{roleLabel(e.role)} · {e.tenure_rounds}r tenure · {fmt.money(e.salary)}/round</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="w-16 text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">Morale</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-line"><div className="h-full" style={{ width: `${satPct}%`, background: satTone }} /></div>
                        <span className="tnum w-9 text-right text-[0.66rem] text-inksoft">{satPct}%</span>
                      </div>
                      {!firingThis && (
                        <label className="mt-1 flex items-center justify-end gap-1 text-[0.64rem] text-inksoft">
                          <span>Raise to $</span>
                          <input type="number" min={e.salary} value={eraises[e.id] ?? ""} onChange={(ev) => setRaise(e.id, +ev.target.value)} placeholder={String(e.salary)}
                            className="tnum w-14 rounded border border-line bg-paper px-1 py-0.5 text-right text-[0.7rem]" />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[0.74rem] text-inksoft">No employees yet — hire from the talent market below.</div>
            )}

            {employees.length < empMax && candidates.length > 0 && (
              <div className="mt-3 border-t border-line pt-2">
                <div className="mb-1.5 flex items-center justify-between text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">
                  <span>Talent market</span>
                  <span>{employees.length}/{empMax} on staff</span>
                </div>
                <div className="grid gap-1.5">
                  {candidates.map((cnd) => {
                    const picked = ehiring.has(cnd.id);
                    const fair = fairSalary(cnd.role, cnd.skill);
                    const deal = cnd.salary <= fair * 0.95 ? "underpriced" : cnd.salary >= fair * 1.1 ? "pricey" : "fair";
                    const full = !picked && (cash < cnd.salary || employees.length + ehiring.size >= empMax);
                    return (
                      <button key={cnd.id} type="button" onClick={() => toggleHireEmp(cnd.id)} disabled={full}
                        className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${picked ? "border-copper bg-copper/[0.06]" : "border-line hover:border-copper"}`}>
                        <Avatar seed={cnd.avatar_seed} name={cnd.name} size={24} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold text-ink">{cnd.name}</span><SkillStars n={cnd.skill} /></div>
                          <div className="text-[0.62rem] text-inksoft">{roleLabel(cnd.role)} · <span className={deal === "underpriced" ? "text-hop" : deal === "pricey" ? "text-brick" : ""}>{deal}</span></div>
                        </div>
                        <span className="tnum ml-auto shrink-0 text-[0.72rem] text-copperdeep">{fmt.money(cnd.salary)}/rd</span>
                        <span className="shrink-0 text-[0.66rem] font-semibold text-copperdeep">{picked ? "✓" : "Hire"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">
                <span>Raid rival talent</span>
                <InfoDot title="Poaching" align="right">
                  Scout a rival from their <b>dossier</b> — click their brewery on the Market map or Field tab. With <b>market research</b> bought this round you'll see their crew's pay and morale and can make an offer. Beat their current pay to lure them over; the unhappier they are and the bigger your raise, the likelier they jump — a successful poach costs a one-time signing premium on top of the new salary.
                </InfoDot>
              </div>
              {poaches.length > 0 ? (
                <div className="grid gap-1">
                  {poaches.map((p) => (
                    <div key={p.employee} className="flex items-center gap-2 rounded border border-copper/40 bg-copper/[0.05] px-2 py-1 text-[0.72rem]">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: firmColor(p.firm) }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-ink">{empName(p.firm, p.employee)} <span className="text-inksoft">· {view.names[p.firm] ?? p.firm}</span></span>
                      <span className="tnum shrink-0 text-copperdeep">{fmt.money(p.offer)}/rd</span>
                      <button type="button" onClick={() => setPoach(p.firm, p.employee, 0)} className="shrink-0 text-inksoft transition-colors hover:text-brick" title="Cancel this offer" aria-label="Cancel offer">✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[0.7rem] leading-snug text-inksoft">No raids queued. Open a rival's dossier (click them on the <span className="font-semibold text-copperdeep">Market</span> map or <span className="font-semibold text-copperdeep">Field</span> tab) to scout and poach their people.</div>
              )}
            </div>

            {empSpend > 0 && (
              <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[0.72rem]">
                <span className="text-inksoft">New payroll & offers this round</span>
                <span className="tnum text-ink">{fmt.money(empSpend)}</span>
              </div>
            )}
          </Card>
        )}

        {/* Markets / worldview (MOD-B01 geography, MOD-B02 international). Hidden when the
            City View tab owns markets (single-player); still shown for multiplayer. */}
        {geoOn && markets.length > 1 && !cityManaged && (
          <Card>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Markets</Eyebrow>
              <InfoDot title="Geographic strategy">Your capacity is split across the regions you run — entering a market trades home presence for reach. Regions have different tastes; your brand carries at a discount abroad. Export markets add tariffs &amp; currency swings.</InfoDot>
            </div>
            <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
              <div className="rounded-md border border-line bg-paper2/30 p-1">
                <WorldMap markets={markets} weights={marketWeights} entered={entered} />
              </div>
              <div className="grid content-start gap-2">
                <div className="text-[0.7rem] text-inksoft">Allocate capacity across markets (relative weights):</div>
                {markets.map((m) => {
                  const isIn = m.kind === "home" || entered.includes(m.id);
                  const w = marketWeights[m.id] ?? (m.kind === "home" ? 1 : 0);
                  return (
                    <div key={m.id}>
                      <div className="flex items-center justify-between">
                        <button type="button" onClick={() => setMarketDetail(m.id)} className="group flex items-center gap-1 text-left text-[0.78rem] font-semibold hover:text-copperdeep" title="Market profile">
                          {m.label}
                          <span className="text-[0.6rem] text-inksoft opacity-0 transition-opacity group-hover:opacity-100">ⓘ</span>
                          {m.kind === "export" && <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-hop">export · {Math.round(m.tariff_rate * 100)}% tariff{view.fx[m.id] != null ? ` · FX ${view.fx[m.id].toFixed(2)}` : ""}</span>}
                          {m.kind === "domestic" && <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-copperdeep">region</span>}
                        </button>
                        {!isIn && m.entry_cost > 0 && (marketWeights[m.id] ?? 0) > 0 && <span className="text-[0.64rem] text-brick">enter · {fmt.money(m.entry_cost)}</span>}
                      </div>
                      <input type="range" min="0" max="100" step="5" value={Math.round(w * 100)} onChange={(e) => setWeight(m.id, +e.target.value / 100)} className="w-full" />
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {/* Expansion-module plays & programs (only the enabled ones render) */}
        {anyModuleControls && (
          <Card>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Plays &amp; Programs</Eyebrow>
              <InfoDot title="Expansion modes">These controls appear because your instructor enabled extra modes for this game. They're off in a standard game.</InfoDot>
            </div>

            {prOn && (
              <div className="mt-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Tactical PR</span>
                  {prOnCooldown ? (
                    <span className="text-[0.72rem] text-inksoft">On cooldown · ready round {(prCooldownUntil ?? 0) + 1}</span>
                  ) : d.pr_action ? (
                    <span className="flex items-center gap-2 text-[0.72rem]">
                      <Tag tone="hop">{PR_LABEL[d.pr_action]}</Tag>
                      <button className="text-inksoft underline hover:text-ink" onClick={() => set({ pr_action: null })}>clear</button>
                    </span>
                  ) : (
                    <Button onClick={() => setPrModal(true)} className="px-3 py-1 text-[0.72rem]">Plan a PR play →</Button>
                  )}
                </div>
                <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">
                  A one-off brand splash ({fmt.money(prCost)}) that spikes buzz then decays fast. {view.own.pr_spike > 0.1 ? `Current buzz +${view.own.pr_spike.toFixed(1)}.` : ""}
                </div>
              </div>
            )}

            {sustOn && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Water efficiency</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(waterSpend)}</span>
                </div>
                <input type="range" min="0" max={Math.max(200, Math.round(cash * 0.3))} step="10" value={waterSpend} onChange={(e) => set({ invest_water_efficiency: +e.target.value })} className="mt-1 w-full" />
                <div className="text-[0.68rem] leading-snug text-inksoft">
                  Builds resilience to the water shock &amp; earns regulator goodwill. {view.own.water_efficiency > 0.1 ? `Efficiency stock ${view.own.water_efficiency.toFixed(1)}.` : ""}
                </div>
              </div>
            )}

            {rndOn && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">R&amp;D — the new category</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(rndSpend)}</span>
                </div>
                <input type="range" min="0" max={Math.max(300, Math.round(cash * 0.4))} step="10" value={rndSpend} onChange={(e) => set({ invest_rnd: +e.target.value })} className="mt-1 w-full" />
                <div className="text-[0.68rem] leading-snug text-inksoft">
                  {frontierActive ? "The frontier category is open — R&D no longer pulls it forward." : "Race to open the frontier category early; the leader gets a first-mover head start."}
                  {view.own.rnd_progress > 0.1 ? ` Your progress ${view.own.rnd_progress.toFixed(0)}.` : ""}
                </div>
              </div>
            )}

            {pgOn && goods.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Industry guild</span>
                  <InfoDot title="Public goods">Contributions are a private cost; the benefit is shared by the whole industry. Fund it together — or free-ride and hope others do.</InfoDot>
                </div>
                <div className="mt-1 grid gap-2">
                  {goods.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[0.78rem] font-semibold">{GOOD_LABEL[g.id] ?? g.id}</div>
                        <div className="text-[0.66rem] leading-snug text-inksoft">{GOOD_BLURB[g.benefit] ?? ""}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-inksoft">$</span>
                        <input type="number" step="10" min="0" value={contribs[g.id] ?? 0} onChange={(e) => setContribution(g.id, +e.target.value)} className="w-20 text-right" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vertOn && vertAssets.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Vertical moves</span>
                  <InfoDot title="Own your supply chain">Buying upstream cuts what each barrel costs to make; buying distribution cuts your regulatory drag — but visible vertical control draws antitrust attention. Benefits switch on after the integration period.</InfoDot>
                </div>
                <div className="mt-1 grid gap-2">
                  {vertAssets.map((a) => {
                    const has = owned.has(a.id);
                    const queued = buying.has(a.id);
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[0.78rem] font-semibold">
                            {a.label}
                            <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-copperdeep">{a.type}</span>
                          </div>
                          <div className="text-[0.66rem] leading-snug text-inksoft">
                            {a.type === "upstream" ? `−${Math.round(a.unit_cost_reduction * 100)}% unit cost` : `−${Math.round(a.reg_relief * 100)}% regulatory drag`} · online in {a.integration_lag} rounds · {fmt.money(a.cost)}
                          </div>
                        </div>
                        {has ? (
                          <Tag tone="hop">Owned</Tag>
                        ) : (
                          <Button onClick={() => toggleBuy(a.id)} variant={queued ? "go" : "solid"} className="px-3 py-1 text-[0.72rem]">
                            {queued ? "Buying ✓" : "Buy"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {labOn && labRoles.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Key people</span>
                  <InfoDot title="The talent market">You hire specialists from an open talent market — you're not poaching a specific rival, you're competing for scarce talent. A hire boosts a capability the day they start and takes it with them if they leave. <b>Rivals can poach your people</b> each round; a strong crew culture (employee trust) is what keeps them home. You can see who staffs which rivals in a brewery's dossier.</InfoDot>
                </div>
                <div className="mb-1.5 text-[0.66rem] leading-snug text-inksoft">
                  Retention this round: <span className={retentionTone}>{retentionLabel}</span> — driven by your {STOCK_LABEL.T_emp.toLowerCase()}.
                </div>
                <div className="mt-1 grid gap-2">
                  {labRoles.map((r) => {
                    const employed = onStaff.has(r.id);
                    const queued = hiring.has(r.id);
                    const leaving = firing.has(r.id);
                    const bonusTxt = Object.entries(r.bonus).map(([k, v]) => `+${v} ${STOCK_LABEL[k as "Q"] ?? k}`).join(", ");
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[0.78rem] font-semibold">{r.label}{employed && <span className="ml-1 text-[0.6rem] text-inksoft">· at risk of poaching</span>}</div>
                          <div className="text-[0.66rem] leading-snug text-inksoft">{bonusTxt} · {fmt.money(r.salary)}/round{!employed ? ` · ${fmt.money(r.signing_bonus)} signing` : ""}</div>
                        </div>
                        {employed ? (
                          <Button onClick={() => toggleFire(r.id)} variant="ghost" className="px-3 py-1 text-[0.72rem]">{leaving ? "Leaving ✗" : "On staff · let go?"}</Button>
                        ) : (
                          <Button onClick={() => toggleHire(r.id)} variant={queued ? "go" : "solid"} className="px-3 py-1 text-[0.72rem]">{queued ? "Hiring ✓" : "Hire"}</Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {maOn && rivals.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Acquisitions</span>
                  <InfoDot title="Buying a rival">A bid only lands on a rival in real financial distress (struggling for {maMinDistress}+ rounds), and only at or above a fair-value floor. If it lands you absorb part of their capacity and brand — and all of their debt. Buy market research to see each rival's fair value.</InfoDot>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {rivals.map((r) => {
                    const isBid = bid?.target === r.firm_id;
                    const snap = snapOf(r.firm_id);
                    const targetable = snap ? snap.distressRounds >= maMinDistress : false;
                    return (
                      <button
                        key={r.firm_id}
                        type="button"
                        aria-pressed={isBid}
                        onClick={() => set({ acquisition_bid: isBid ? null : { target: r.firm_id, price: bid?.price ?? Math.round(maFloor(r.firm_id) || 500) } })}
                        title={targetable ? "In distress — acquirable" : "Not currently acquirable"}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.72rem] font-semibold transition-colors ${isBid ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper hover:text-ink"}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${targetable ? "bg-brick" : "bg-line2"}`} />
                        {r.name}
                      </button>
                    );
                  })}
                </div>
                {bid ? (() => {
                  const snap = snapOf(bid.target);
                  const targetable = snap ? snap.distressRounds >= maMinDistress : false;
                  const floor = maFloor(bid.target);
                  return (
                    <div className="mt-2 grid gap-2 rounded-md border border-line bg-paper2/40 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.78rem] text-inksoft">Your offer</span>
                        <span className="flex items-center gap-1">
                          <span className="text-inksoft">$</span>
                          <input type="number" step="50" min="0" value={bid.price} onChange={(e) => set({ acquisition_bid: { ...bid, price: Math.max(0, +e.target.value) } })} className="w-24 text-right" />
                        </span>
                        <Tag tone={targetable ? "hop" : "ink"}>{targetable ? "Distressed · acquirable" : "Not in distress"}</Tag>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-inksoft tnum">
                        {researched && snap ? (
                          <>
                            <span>fair value ≈ {fmt.money(snap.valuation)}</span>
                            <span className={bid.price >= floor ? "text-hop" : "text-brick"}>floor ≈ {fmt.money(floor)} {bid.price >= floor ? "✓ cleared" : "✗ too low"}</span>
                          </>
                        ) : (
                          <span>Buy market research to see their fair value &amp; the bid floor.</span>
                        )}
                      </div>
                      <div className="text-[0.64rem] leading-snug text-inksoft">Settles after the round only if they're distressed and your offer clears the floor — otherwise nothing happens and you keep your cash.</div>
                    </div>
                  );
                })() : (
                  <div className="mt-1 text-[0.66rem] leading-snug text-inksoft">Tap a rival to prepare a bid — a red dot marks one that's distressed enough to acquire. No bid goes out otherwise.</div>
                )}
              </div>
            )}

            {lobOn && lobInits.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Lobbying</span>
                  <InfoDot title="Non-market strategy">Spend to push an industry regulation that suits your position — quality standards reward quality leaders, ad limits hurt brand-heavy rivals, craft promotion grows the premium category. Rivals can counter-lobby to bleed your progress. Heavy <i>offensive</i> lobbying risks an investigation fine, softened by your distributor/regulator standing.</InfoDot>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[0.72rem] text-inksoft">Lobbying budget {lobTargeted ? "" : "— pick a target below"}</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(lobSpendEff)}</span>
                </div>
                <input type="range" min="0" max={Math.max(200, Math.round(cash * 0.3))} step="10" value={lobSpend} onChange={(e) => setLobby({ lobby_spend: +e.target.value })} className="mt-1 w-full" />
                <div className="mt-1 grid gap-1.5">
                  {lobInits.map((it) => {
                    const pushing = d?.lobby_initiative === it.id && !d?.lobby_counter;
                    const countering = d?.lobby_counter === it.id;
                    return (
                      <div key={it.id}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.74rem] font-semibold">{it.label}{it.fired && <span className="ml-1 text-[0.6rem] uppercase tracking-[0.1em] text-hop">· in force</span>}</span>
                          {!it.fired && (
                            <div className="flex shrink-0 gap-1">
                              <button type="button" onClick={() => setLobby({ lobby_initiative: pushing ? null : it.id, lobby_counter: null })}
                                className={`rounded-full border px-2 py-0.5 text-[0.64rem] ${pushing ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper"}`}>Push{pushing ? " ✓" : ""}</button>
                              <button type="button" onClick={() => setLobby({ lobby_counter: countering ? null : it.id, lobby_initiative: null })}
                                className={`rounded-full border px-2 py-0.5 text-[0.64rem] ${countering ? "border-brick bg-brick/10 text-brick" : "border-line2 text-inksoft hover:border-brick"}`}>Counter{countering ? " ✓" : ""}</button>
                            </div>
                          )}
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-line2/40">
                          <div className={`h-full ${it.fired ? "bg-hop" : "bg-copper"}`} style={{ width: `${Math.round(it.pct * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Alliances (MOD-A05 contingent contracts + MOD-A06 renegotiation) */}
        {coopOn && (
          <Card>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Alliances</Eyebrow>
              <InfoDot title="Coopetition">Form a pact with a rival — pool brand, coordinate capacity, or share supply. The governance form is the real choice: a handshake costs trust to break, a formal contract costs cash but supports contingent clauses and renegotiation, a guild is powerful but draws antitrust.</InfoDot>
            </div>
            <div className="mt-2">
              <Alliances view={view} d={d} set={set} />
            </div>
          </Card>
        )}

        {/* Belief + reflection + info */}
        <Card>
          <Eyebrow>Read &amp; Reflect</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={d.buy_info} onChange={(e) => { set({ buy_info: e.target.checked }); onInfoChange?.(e.target.checked); }} />
                Buy market research <span className="tnum text-inksoft">({fmt.money(infoCost)})</span>
              </label>
              <div className={`mt-0.5 text-[0.68rem] ${d.buy_info ? "text-hop" : "text-inksoft"}`}>
                {d.buy_info ? "✓ Rivals' quality, brand, pricing & the strategy map are unlocked in the Field tab." : "Reveals rival positioning in the Field tab this round."}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              Predict your finish rank:
              <input type="number" min="1" max={view.standings.length || 8} value={d.beliefs?.own_rank ?? ""} onChange={(e) => set({ beliefs: { ...d.beliefs, own_rank: e.target.value ? +e.target.value : undefined } })} className="w-16 text-center" />
            </label>
          </div>
          <textarea
            placeholder="One line on your strategy this round…"
            value={d.reflection ?? ""}
            onChange={(e) => set({ reflection: e.target.value })}
            className="mt-3 h-16 w-full resize-none"
          />
        </Card>
        </div>
      </div>

      {/* Pre-submission indicators — pinned on desktop so projected cash and the
          submit button never scroll away while tuning levers */}
      <div className="grid content-start gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <Eyebrow>Before You Brew</Eyebrow>
          <Row label="Cash on hand" value={fmt.money(cash)} />
          {invOn && <Row label="− Brewing this round" value={fmt.money(brewSpend)} />}
          {moduleSpend > 0 && <Row label="− Plays, programs & entry" value={fmt.money(moduleSpend)} />}
          {instrDraws > 0 && <Row label="+ Alternative financing" value={<span className="text-hop">{fmt.signed(instrDraws)}</span>} />}
          <Row label="− Investment & research" value={fmt.money(investSpend + infoSpend)} />
          <Row label={netFinancing >= 0 ? "+ Net financing" : "− Net financing"} value={<span className={netFinancing < 0 ? "text-brick" : "text-hop"}>{fmt.signed(netFinancing)}</span>} />
          <Row label="Projected cash (pre-sales)" value={<span className={overcommit ? "text-brick" : ""}>{fmt.money(projectedCash)}</span>} strong />
          {lastCov != null && <Row label="Interest coverage (last)" value={lastCov > 900 ? "—" : `${lastCov.toFixed(1)}×`} />}
          {overcommit && <div className="mt-2 text-[0.72rem] text-brick">You'd run negative before any sales come in — revenue may cover it, but you risk forced exit.</div>}
        </Card>
        <Button
          variant="go"
          onClick={() => onPlay(mergeDecision(view, d, cityActions, poaches))}
          disabled={busy}
          className="w-full py-3 text-base"
        >
          {busy ? "Working…" : submitLabel ?? `Brew & Resolve Round ${view.round + 1}`}
        </Button>
        <div className="text-center text-[0.68rem] text-inksoft">{footerNote ?? "7 rival breweries (adaptive AI) brew at the same time."}</div>
      </div>
    </div>
  );
}
