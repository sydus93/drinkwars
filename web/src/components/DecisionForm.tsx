import { useEffect, useState, type ReactNode } from "react";
import type { Facility, FirmDecision, PrPlayType, SegmentId } from "drinkwars-engine";
import { DESK_LEVERS, ROLE_DESK, equityCapacity, equityIssueCost } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { keepUntouchedMarkets, mergeDecision, type CityActions } from "../game/cityActions.js";
import { SEG_LABEL, SEG_TAG, STOCK_LABEL, fmt, toDisplayMoney, toEngineMoney, marketName } from "../labels.js";
import { holdLever, leverText, planDiffs, researchBuyer, teamOutcome, unholdLever, type PlanDiff } from "../lib/reconcile.js";
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
// `desk` aligns each stock-investment slider to the officer who owns it (DW-031 L1.5) —
// brand to the CMO, quality/process to the COO, employee relations to People, investor to
// the CFO, regulator to Strategy — so a focused desk shows only its own capital calls.
const INVEST_FIELDS: { key: InvestKey; label: string; hint: string; desk: DeskId }[] = [
  { key: "invest_Q", label: STOCK_LABEL.Q, hint: "Brewing talent, recipes, and consistency.", desk: "operations" },
  { key: "invest_B", label: STOCK_LABEL.B, hint: "Awareness, identity, and reputation.", desk: "commercial" },
  { key: "invest_process", label: STOCK_LABEL.process, hint: "Operational efficiency and yield.", desk: "operations" },
  { key: "invest_T_emp", label: STOCK_LABEL.T_emp, hint: "Your taproom regulars and crew.", desk: "people" },
  { key: "invest_T_inv", label: STOCK_LABEL.T_inv, hint: "Standing with your lenders and investors.", desk: "finance" },
  { key: "invest_T_gov", label: STOCK_LABEL.T_gov, hint: "Standing with your distributors and regulators.", desk: "strategy" },
];

export type DeskId = "all" | "commercial" | "operations" | "people" | "finance" | "strategy";

export function DecisionForm({
  view,
  defaultDecision,
  onPlay,
  unsent = false,
  onEdited,
  busy,
  infoCost,
  onInfoChange,
  infoLocked = false,
  submitLabel,
  footerNote,
  poaches: externalPoaches,
  onPoach,
  cityActions,
  decision,
  setDecision,
  desk = "all",
  seatRole,
  standing,
  callsCount = 0,
  callsSlot,
}: {
  /** DW-077: the calls tickets (section D) mount inside the commit panel, above Submit; the
   *  count rides on the submit label ("… + 2 calls"). */
  callsCount?: number;
  callsSlot?: ReactNode;
  /** DW-073 team firms: this player's seat + the firm's standing plan (the merge base), so the
   *  commit dial prices what the TEAM will trade on, not just this form. */
  seatRole?: string | null;
  standing?: FirmDecision | null;
  view: GameView;
  defaultDecision: () => Promise<FirmDecision>;
  onPlay: (d: FirmDecision) => void;
  /** DW-080: this seat changed its desk after its last submit — the server still has the old slice */
  unsent?: boolean;
  /** DW-080: a user edit the form makes outside `setDecision` (a Keep mine hold) */
  onEdited?: () => void;
  busy: boolean;
  infoCost: number;
  onInfoChange?: (bought: boolean) => void;
  /** Solo: the research was revealed this round, so the purchase can no longer be unticked. */
  infoLocked?: boolean;
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
  // Pro-mode desk filter (also the future role-scoping hook): "all" shows every lever card;
  // a desk shows only its cards. Hosted in Play; multiplayer leaves it "all".
  desk?: DeskId;
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
  const [sheetAll, setSheetAll] = useState(false); // DW-077 phone sheet: first 2 rows, then "+N more · see all"
  const [, bump] = useState(0); // DW-077 "Keep mine" holds live in a module map (reconcile.holdLever) — re-render after one
  const activeSegs = view.segments.filter((s) => s.active).map((s) => s.id);
  // Pro-mode desk filter: hide a lever card when a specific desk is selected and it isn't this one.
  const deskCls = (dk: DeskId) => (desk === "all" || desk === dk ? "" : "hidden");

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
  // DW-082: a seat off the people desk mirrors the firm's raids — overlaying its empty local list read as
  // "Your form: none" (a phantom Poach offers row on the CFO / CMO / COO). Play overlays raids only when
  // the list is non-empty; the panel does the same.
  const offPeople = !!(seatRole && view.teamPlan) && !["all", "people"].includes(ROLE_DESK[seatRole ?? ""] ?? "all");
  const merged = mergeDecision(view, d, cityActions, offPeople && !externalPoaches?.length ? undefined : externalPoaches);
  const effective = seatRole && view.teamPlan ? keepUntouchedMarkets(view, merged, d, cityActions) : merged;
  // DW-073: the projection prices the MERGE OUTCOME — the engine's own team merge with this form
  // submitted now (DW-052 overlaid teammates' desks unconditionally, which was wrong once an
  // untouched desk stopped winning). Sprint 1: a CEO's dial read +$237k while the plan that
  // actually traded went bankrupt, because the dial priced only his own form.
  // `proj` feeds the spend lines below; `d` keeps driving the inputs.
  const proj = teamOutcome(view, seatRole, effective, standing)?.decision ?? effective;
  // DW-077: every lever where this form and the plan that will lock disagree — who decides, what
  // locks, what was typed — from the engine's own merge (reconcile.planDiffs). Team firms only.
  const team = !!(seatRole && view.teamPlan && standing);
  const diffs = team ? planDiffs(view, seatRole, effective, standing) : { rows: [] as PlanDiff[], follow: 0 };
  const diffMap = new Map(diffs.rows.map((r) => [String(r.field), r]));
  const diffOf = (f: keyof FirmDecision) => diffMap.get(String(f));
  const T = (f: keyof FirmDecision, v: unknown) => leverText(String(f), v, view);
  // The lever's control: a 2px border in red (a teammate's number locks) or green (yours is used).
  const leverStyle = (f: keyof FirmDecision) => { const r = diffOf(f); if (!r) return undefined; const c = r.winner === "me" ? "var(--color-hop)" : "var(--color-brick)"; return { borderColor: c, boxShadow: `0 0 0 1px ${c}`, accentColor: c } as const; };
  const LeverNote = ({ f }: { f: keyof FirmDecision }) => { const r = diffOf(f); if (!r) return null; return (
    <div className={`mt-0.5 text-[0.7rem] leading-snug ${r.winner === "me" ? "text-hop" : "text-brick"}`}>
      {r.winner === "me" ? <><b>Yours is used{r.pending ? " once you submit" : ""}: {T(f, r.mine)}</b> · {r.whoShort}</> : <><b>Locks at {T(f, r.locks)}</b> · {r.whoShort}</>}
    </div>
  ); };
  // "Take the CEO's numbers": the CEO's entry into this form for every differing lever on my desk.
  const takeCeo = () => { const patch: Partial<FirmDecision> = {}; for (const r of diffs.rows) if (r.ceoValue !== undefined) (patch as Record<string, unknown>)[String(r.field)] = r.ceoValue; set(patch); };
  // A hold must carry a value: a lever the form lacks (the CMO's "markets served" before the firm's
  // first entry) gets an explicit "none", or the hold held nothing and the CEO's entry stood (DW-082).
  const emptyLike = (v: unknown): unknown => Array.isArray(v) ? [] : v !== null && typeof v === "object" ? {} : typeof v === "number" ? 0 : typeof v === "boolean" ? false : null;
  const holdRows = (rs: PlanDiff[]) => {
    const patch: Record<string, unknown> = {};
    for (const r of rs) { const f = String(r.field); if (r.restore !== undefined) patch[f] = r.restore; else if ((d as unknown as Record<string, unknown>)[f] === undefined) patch[f] = emptyLike(r.locks); holdLever(view.round, f); }
    if (Object.keys(patch).length) set(patch as Partial<FirmDecision>);
    onEdited?.(); bump((n) => n + 1);
  };
  // "Keep mine" (a specialist's own desk): hold every differing own-desk lever at this form's value.
  const isCeoSeat = (ROLE_DESK[seatRole ?? ""] ?? "all") === "all";
  const keepMine = () => holdRows(diffs.rows.filter((r) => r.ownDesk));
  const canAct = team && !isCeoSeat && diffs.rows.some((r) => r.ownDesk && (r.ceoValue !== undefined || r.winner === "them"));
  // DW-082: one row's own button (a teammate's word on a desk that isn't theirs). Keep mine / Cancel it
  // hold that lever — a change made now, so it outranks the earlier word and the row flips to "once you
  // submit"; Undo takes back a hold not yet sent. (One panel-wide Keep mine held every row at once and,
  // judged as last submitted, flipped none of them — the 10-20 playtest found it looked dead.)
  const rowAction = (r: PlanDiff) => { if (r.action === "undo") { unholdLever(view.round, String(r.field)); bump((n) => n + 1); } else holdRows([r]); };
  const actionLabel = (a: PlanDiff["action"]) => (a === "cancel" ? "Cancel it" : a === "undo" ? "Undo" : a === "take" ? "Use theirs" : "Keep mine");
  const roundNo = Math.min(view.round + 1, view.nRounds);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  // The submit label: counts the levers that still follow a teammate after this submit, then the calls.
  const submitText = (short = false) => {
    if (busy) return "Working…";
    const base = submitLabel ?? (team ? `${unsent ? "Update" : "Submit"} my desk (round ${roundNo})` : `Brew & Resolve Round ${roundNo}`);
    const follow = diffs.follow > 0 ? (short ? ` · ${diffs.follow} follow team` : ` · ${plural(diffs.follow, "lever")} follow${diffs.follow === 1 ? "s" : ""} teammates`) : "";
    const calls = callsCount > 0 ? ` + ${plural(callsCount, "call")}` : "";
    return `${follow || calls ? base.replace(/\s*\(round \d+\)$/i, "") : base}${follow}${calls}`;
  };

  const cash = view.own.cash;
  // Production / inventory mode (only when the game was created with it on).
  const invOn = view.inventoryEnabled;
  const cap = view.own.cap;
  const stock = view.own.inventory_units ?? 0;
  const runRate = d.run_rate ?? 1; // fraction of capacity to brew (1 = full)
  const produced = runRate * cap;
  const sellable = stock + produced;
  const lastSold = view.ownResult?.inventory?.sold ?? null;

  // Expansion-module decision controls (gated on what the instructor enabled).
  const mods = view.modules;
  const prOn = !!mods?.prEvents?.enabled;
  const sustOn = !!mods?.sustainability?.enabled;
  const pgOn = !!mods?.publicGoods?.enabled;
  const prCost = mods?.prEvents?.cost ?? 0;
  const prCooldownUntil = view.own.pr_cooldown_until ?? null;
  const prOnCooldown = prCooldownUntil != null && view.round < prCooldownUntil;
  const goods = mods?.publicGoods?.goods ?? [];
  const contribs = d?.public_good_contributions ?? {};
  const pgSpend = pgOn ? Object.values(contribs).reduce((a, b) => a + Math.max(0, b), 0) : 0;
  const rndOn = !!mods?.rndRace?.enabled;
  const frontierActive = view.segments.some((s) => s.id === "frontier" && s.active);

  // MOD-B06 vertical assets · MOD-B03 key hires · MOD-B08 instruments · MOD-B07 M&A
  const vertOn = !!mods?.verticalIntegration?.enabled;
  const vertAssets = mods?.verticalIntegration?.assets ?? [];
  const owned = new Set((view.own.vertical_assets ?? []).map((a) => a.id));
  const buying = new Set(d?.buy_vertical ?? []);
  const buyingP = new Set(proj?.buy_vertical ?? []);
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
  const hiringP = new Set(proj?.hire_roles ?? []);
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
  const maOn = !!mods?.ma?.enabled;
  const rivals = view.standings.filter((s) => !s.isYou && s.status === "active");
  const bid = d?.acquisition_bid ?? null;
  // M&A reads: distress is public; fair value + floor need market research.
  const researched = !!d?.buy_info || view.infoActive;
  const buyer = team && infoLocked ? researchBuyer(view) : null; // DW-081: the team's purchase, credited
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
  const effWeights = proj.market_presence ?? { home: 1 };

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
  const effBuilds = proj.build_facilities ?? [];
  const effMaint = proj.maintain_facilities ?? {};
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
  const ebids = d?.hire_bids ?? {};
  // Hire cost = salary + any signing bonus (the bonus only actually lands if the hire
  // is contested and you win, but budget for the full commitment).
  const ehiringP = new Set(proj?.hire_employees ?? []);
  const ebidsP = proj?.hire_bids ?? {};
  const eraisesP = proj?.raise_employees ?? {};
  // Talent raids: use the lifted list when provided (poaching happens in rival dossiers),
  // otherwise manage them locally. Either way they're injected into the decision at submit.
  const setPoach = onPoach ?? ((firm: string, employee: string, offer: number) => {
    const rest = (d?.poach_employees ?? []).filter((x) => x.employee !== employee);
    set({ poach_employees: offer > 0 ? [...rest, { firm, employee, offer }] : rest });
  });
  const poaches = externalPoaches ?? (d?.poach_employees ?? []);
  const toggleHireEmp = (id: string) => {
    const n = new Set(ehiring);
    if (n.has(id)) { n.delete(id); const { [id]: _drop, ...rest } = ebids; set({ hire_employees: [...n], hire_bids: rest }); }
    else { n.add(id); set({ hire_employees: [...n] }); }
  };
  const setHireBid = (id: string, v: number) => set({ hire_bids: { ...ebids, [id]: Math.max(0, v) } });
  const toggleFireEmp = (id: string) => { const n = new Set(efiring); n.has(id) ? n.delete(id) : n.add(id); set({ fire_employees: [...n] }); };
  const setRaise = (id: string, v: number) => set({ raise_employees: { ...eraises, [id]: Math.max(0, v) } });
  const empName = (firm: string, empId: string) => view.firms.find((f) => f.firm_id === firm)?.employees.find((e) => e.id === empId)?.name ?? empId;

  const anyModuleControls = prOn || sustOn || pgOn || rndOn || vertOn || labOn || maOn || lobOn || facOn || empOn;
  // DW-071: each play inside "Plays & Programs" shows to the desk that OWNS its lever at merge
  // (seats.ts DESK_LEVERS). The card used to hide wholesale from people + finance — so in the
  // labor-market game the CHRO, who owns hire_roles, never saw Key people, shipped an untouched
  // [] every submit, and erased the CEO's hires (game 1, one team). Card shows if any play does.
  const playsVisible = desk === "all" || ([
    [prOn, "pr_action"], [sustOn, "invest_water_efficiency"], [rndOn, "invest_rnd"], [pgOn && goods.length > 0, "public_good_contributions"],
    [vertOn && vertAssets.length > 0, "buy_vertical"], [labOn && labRoles.length > 0, "hire_roles"],
    [maOn && rivals.length > 0, "acquisition_bid"], [lobOn && lobInits.length > 0, "lobby_spend"],
  ] as const).some(([on, lever]) => on && (DESK_LEVERS[desk] as readonly string[] | undefined)?.includes(lever)); // owner read from seats.ts, not copied
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

  // DW-071: investors fund at most a share of the firm's valuation (0 once it's ≤ 0). Same
  // function, same beginning-of-round state as the resolver, so the forecast is the result.
  const equityCap = view.finance ? equityCapacity(view.own, { finance: view.finance }) : Infinity;
  const equityGated = Number.isFinite(equityCap);
  // Equity lands NET of the issue fee (the engine's own rate; it rises as investor relations fall) —
  // the dial used to count the gross raise and overstate cash by the fee.
  const issueFee = view.finance ? equityIssueCost((view.own as { T_inv?: number }).T_inv ?? 0, { finance: view.finance } as never) : 0;
  // DW-077: ONE pricing of a decision — the dial prices the TEAM's plan (`proj`) and, when the
  // plans differ, this form alone (`effective`), through the same function, so the two numbers
  // under "What locks" can never disagree about the maths.
  const costsOf = (p: FirmDecision) => {
    const brewSpend = invOn ? (p.run_rate ?? runRate) * cap * view.unitCostEst : 0; // cash out to brew this round
    const prSpend = prOn && p.pr_action && !prOnCooldown ? prCost : 0;
    const waterSpend = sustOn ? Math.max(0, p.invest_water_efficiency ?? 0) : 0; // (the slider shows the form's own value)
    const rndSpend = rndOn ? Math.max(0, p.invest_rnd ?? 0) : 0;
    const buyingP = new Set(p.buy_vertical ?? []);
    const vertSpend = vertOn ? vertAssets.filter((a) => buyingP.has(a.id) && !owned.has(a.id)).reduce((s, a) => s + a.cost, 0) : 0;
    const hiringP = new Set(p.hire_roles ?? []);
    const hireSpend = labOn ? labRoles.filter((r) => hiringP.has(r.id) && !onStaff.has(r.id)).reduce((s, r) => s + r.signing_bonus + r.salary, 0) : 0;
    const instrDraws = fiOn ? Math.max(0, p.draw_convertible ?? 0) + Math.max(0, p.draw_rbf ?? 0) : 0;
    const w = p.market_presence ?? { home: 1 };
    const geoEntrySpend = geoOn ? markets.filter((m) => m.kind !== "home" && (w[m.id] ?? 0) > 0 && !entered.includes(m.id)).reduce((a, m) => a + m.entry_cost, 0) : 0;
    const buildCost = facOn ? (p.build_facilities ?? []).reduce((s, b) => s + (facTypes.find((t) => t.id === b.type)?.base_cost ?? 0), 0) : 0;
    const maintCost = facOn ? Object.values(p.maintain_facilities ?? {}).reduce((s: number, v) => s + Math.max(0, v), 0) : 0;
    const facSpend = buildCost + maintCost;
    const ehiringP = new Set(p.hire_employees ?? []);
    const ebidsP = p.hire_bids ?? {};
    const hireCost = empOn ? candidates.filter((cnd) => ehiringP.has(cnd.id)).reduce((s, cnd) => s + cnd.salary + Math.max(0, ebidsP[cnd.id] ?? 0), 0) : 0;
    const eraisesP = p.raise_employees ?? {};
    const raiseCost = empOn ? employees.reduce((s: number, e) => s + Math.max(0, (eraisesP[e.id] ?? e.salary) - e.salary), 0) : 0;
    const poachSpend = empOn ? (p.poach_employees ?? []).reduce((s: number, x) => s + Math.max(0, x.offer), 0) : 0;
    const empSpend = hireCost + raiseCost + poachSpend;
    const moduleSpend = prSpend + waterSpend + pgSpend + geoEntrySpend + rndSpend + vertSpend + hireSpend + lobSpendEff + renegCallCost + facSpend + empSpend;
    const investSpend = p.invest_cap + p.invest_Q + p.invest_B + p.invest_process + p.invest_T_emp + p.invest_T_inv + p.invest_T_gov;
    const infoSpend = p.buy_info || infoLocked ? infoCost : 0; // DW-081: a landed team purchase is spent, whatever this form says
    const financeOut = p.debt_repay + p.dividend;
    const financeIn = p.debt_draw + Math.min(p.equity_raise, equityCap) * (1 - issueFee);
    const netFinancing = financeIn - financeOut;
    const projectedCash = cash - investSpend - infoSpend - brewSpend - moduleSpend + netFinancing + instrDraws; // before this round's sales
    return { brewSpend, instrDraws, buildCost, maintCost, facSpend, empSpend, moduleSpend, investSpend, infoSpend, netFinancing, projectedCash };
  };
  const { brewSpend, instrDraws, buildCost, maintCost, facSpend, empSpend, moduleSpend, investSpend, infoSpend, netFinancing, projectedCash } = costsOf(proj);
  const myCash = proj === effective ? projectedCash : costsOf(effective).projectedCash; // this form alone
  const overcommit = projectedCash < 0;

  const equity = view.own.paid_in_capital + view.own.retained_earnings;
  // DW-082: with book equity at or below zero the ratio means nothing (it read ~10¹²×); the engine clamps at 10×
  const leverage = Math.min(10, view.own.debt / Math.max(equity, 1e-6));
  const levText = equity <= 0 ? "n/m (equity ≤ 0)" : `${leverage.toFixed(2)}×`;
  const lastCov = view.ownResult?.cost_of_capital.coverage ?? null;
  const lastRate = view.ownResult?.cost_of_capital.r_debt ?? null;

  // Desktop command-center: with expansion content on, the cards split into two
  // columns — run the brewery (left) and grow the empire (right) — so a wide
  // screen shows the whole round at once instead of a long scroll.
  const twoCol = geoOn || anyModuleControls || coopOn;

  return (
    <div className="grid gap-4 pb-20 lg:grid-cols-[minmax(0,1fr)_320px] lg:pb-0">
      <EventModal event={prEvent} onChoose={onPrChoose} onClose={() => setPrModal(false)} />
      {detailEmp != null && (() => {
        const emp = employees.find((x) => x.id === detailEmp);
        return emp ? (
          <EmployeeDetail employee={emp} role={empRoles.find((r) => r.id === emp.role)} roleLabel={roleLabel(emp.role)} cfg={mods?.employees} raiseValue={eraises[emp.id]}
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
        <Card className={deskCls("commercial")}>
          <Eyebrow>Lineup &amp; Pricing</Eyebrow>
          <div className="mb-3 text-sm text-inksoft">Set your price in each category. Est. unit cost {fmt.price(view.unitCostEst)}.</div>
          <div className="grid gap-3">
            {activeSegs.map((s) => {
              const margin = d.price[s] - view.unitCostEst;
              return (
                <div key={s} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex w-36 min-w-0 items-center gap-2 sm:w-40">
                    <CategoryCoin seg={s} size={28} />
                    <div>
                      <div className="text-sm font-semibold">{SEG_LABEL[s] ?? s}</div>
                      <Tag tone="copper">{SEG_TAG[s] ?? s}</Tag>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-inksoft">$</span>
                    <input type="number" step="0.25" min="0" value={d.price[s]} onChange={(e) => setPrice(s, Math.max(0, +e.target.value))} className="w-24 text-right" style={leverStyle("price")} />
                  </div>
                  <div className={`tnum text-sm ${margin > 0 ? "text-hop" : "text-brick"}`}>{margin >= 0 ? "+$" : "−$"}{Math.abs(margin).toFixed(2)} / drink</div>
                </div>
              );
            })}
          </div>
          <LeverNote f="price" />
        </Card>

        {/* Capacity + presence */}
        <Card className={deskCls("operations")}>
          <Eyebrow>Tanks &amp; Allocation</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-inksoft">Invest in tank capacity (builds with a one-round lag)</label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-inksoft">$</span>
                <input type="number" step="5000" min="0" value={toDisplayMoney(d.invest_cap)} onChange={(e) => set({ invest_cap: Math.max(0, toEngineMoney(+e.target.value)) })} className="w-28 text-right" style={leverStyle("invest_cap")} />
              </div>
              <LeverNote f="invest_cap" />
              {(() => {
                // Bridge dollars ↔ drinks. Tanks cost a flat $/unit, arrive after the build lag, and a
                // fixed share of what you already own wears out every quarter — so part of any spend
                // only holds you level. All three numbers come from this game's config, not constants.
                const cc = view.capacity;
                if (!cc || !(cc.gain > 0)) return <div className="mt-1 text-[0.7rem] text-inksoft tnum">Current capacity: {fmt.int(view.own.cap)} units</div>;
                const perUnit = 1 / cc.gain;
                const added = d.invest_cap * cc.gain;
                const wear = view.own.cap * cc.depreciation;
                const holdLevel = wear * perUnit;
                const next = view.own.cap - wear + (cc.lag <= 1 ? added : 0);
                const net = next - view.own.cap;
                const when = cc.lag <= 0 ? "this round" : cc.lag === 1 ? "next round" : `in ${cc.lag} rounds`;
                return (
                  <div className="mt-1.5 grid gap-0.5 text-[0.7rem] text-inksoft tnum">
                    <div>Tanks cost <b className="text-ink">{fmt.price(perUnit)}</b> per unit of quarterly capacity.</div>
                    <div>This spend buys <b className="text-ink">+{fmt.int(added)}</b> units, online {when}.</div>
                    <div>Wear-out this quarter: <b className="text-ink">−{fmt.int(wear)}</b> units ({Math.round(cc.depreciation * 100)}% of what you own). Holding level costs {fmt.money(holdLevel)}.</div>
                    <div className="mt-0.5 border-t border-line pt-0.5">
                      Capacity: {fmt.int(view.own.cap)} now →{" "}
                      <b className={net < 0 ? "text-brick" : "text-ink"}>{fmt.int(next)}</b> next round
                      <span className={net < 0 ? "text-brick" : "text-hop"}> ({net >= 0 ? "+" : "−"}{fmt.int(Math.abs(net))})</span>
                    </div>
                    <div>Every unit you own costs {fmt.price(cc.fixed_cost_per_unit)}/qtr in upkeep, brewed or idle.</div>
                  </div>
                );
              })()}
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
                style={leverStyle("run_rate")}
              />
              <LeverNote f="run_rate" />
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

        {/* Investments — each stock slider carries its owning desk, so a focused cockpit
            shows only its own capital calls (brand→CMO, quality/process→COO, etc.). */}
        <Card className={desk === "all" || INVEST_FIELDS.some((f) => f.desk === desk) ? "" : "hidden"}>
          <Eyebrow>Build the Brewery</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            {INVEST_FIELDS.map((f) => (
              <div key={f.key} className={deskCls(f.desk)}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold">{f.label}</label>
                  <span className="tnum text-xs text-inksoft">{fmt.money(d[f.key])}</span>
                </div>
                <input type="range" min="0" max={Math.max(120_000, Math.round(cash * 0.5))} step="1000" value={d[f.key]} onChange={(e) => set({ [f.key]: +e.target.value } as Partial<FirmDecision>)} className="mt-1 w-full" style={leverStyle(f.key)} />
                <LeverNote f={f.key} />
                <div className="text-[0.68rem] leading-snug text-inksoft">{f.hint}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Financing */}
        <Card className={deskCls("finance")}>
          <Eyebrow>Financing</Eyebrow>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.72rem] text-inksoft tnum">
            <span>debt {fmt.money(view.own.debt)}</span>
            <span>equity {fmt.money(equity)}</span>
            <span className={leverage > (view.scoring?.healthy_leverage ?? 1.5) ? "text-brick" : ""}>
              debt-to-equity {levText}
              <InfoDot title="Debt-to-equity (leverage)">
                Total debt ÷ book equity, where equity is the capital paid in plus the profit you have kept (retained earnings). {equity <= 0 ? <>Your equity is {fmt.money(equity)}, so the ratio has no meaning: losses have used up the owners' stake and the firm runs on what it owes.</> : <>At {leverage.toFixed(2)}× you owe {fmt.money(view.own.debt)} against {fmt.money(equity)} of equity.</>}
                {view.finance && <> Lenders start charging more once you pass <b>{view.finance.leverage_ref.toFixed(1)}×</b>, and will not lend at all beyond <b>{view.finance.max_leverage.toFixed(1)}×</b>.</>}
                {" "}Above <b>{(view.scoring?.healthy_leverage ?? 1.5).toFixed(1)}×</b> the figure turns red: your scorecard reads the balance sheet as stretched. Raising equity or repaying debt lowers it; a loss lowers equity and so raises it even if you borrow nothing.
              </InfoDot>
            </span>
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
                  <input type="number" step="5000" min="0" value={toDisplayMoney(d[f.key] as number)} onChange={(e) => set({ [f.key]: Math.max(0, toEngineMoney(+e.target.value)) } as Partial<FirmDecision>)} className="w-28 text-right" style={leverStyle(f.key)} />
                </div>
                <LeverNote f={f.key} />
                <div className="text-[0.66rem] leading-snug text-inksoft">{f.hint}</div>
                {f.key === "equity_raise" && equityGated && (
                  equityCap < 1
                    ? <div className="text-[0.66rem] leading-snug text-brick">Equity market closed: your losses have pushed your valuation to zero or below, so no investor will buy in.</div>
                    : <div className={`text-[0.66rem] leading-snug tnum ${d.equity_raise > equityCap ? "text-brick" : "text-inksoft"}`}>Investors will fund up to <b>{fmt.money(equityCap)}</b> this quarter ({Math.round((view.finance?.equity_gate?.max_fraction_of_valuation ?? 0) * 100)}% of your valuation){d.equity_raise > equityCap ? " — only that much will be raised." : "."}</div>
                )}
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
                      <input type="number" step="5000" min="0" value={toDisplayMoney(d.draw_convertible ?? 0)} onChange={(e) => set({ draw_convertible: Math.max(0, toEngineMoney(+e.target.value)) })} className="w-28 text-right" style={leverStyle("draw_convertible")} />
                    </div>
                  )}
                  <LeverNote f="draw_convertible" />
                  <div className="text-[0.66rem] leading-snug text-inksoft">{Math.round((fiCfg?.convertible.rate ?? 0.04) * 100)}%/round · repay in {fiCfg?.convertible.term ?? 4} rounds or it converts to equity.</div>
                </div>
                <div>
                  <label className="text-sm">Revenue financing</label>
                  {rbfOut > 0 ? (
                    <div className="mt-1 text-[0.72rem] text-inksoft tnum">Still owed: {fmt.money(rbfOut)} (paid from sales)</div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-inksoft">$</span>
                      <input type="number" step="5000" min="0" value={toDisplayMoney(d.draw_rbf ?? 0)} onChange={(e) => set({ draw_rbf: Math.max(0, toEngineMoney(+e.target.value)) })} className="w-28 text-right" style={leverStyle("draw_rbf")} />
                    </div>
                  )}
                  <LeverNote f="draw_rbf" />
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
          <Card className={deskCls("operations")}>
            <Eyebrow>Facilities &amp; markets</Eyebrow>
            <p className="mt-1 text-sm text-inksoft">Your cities, districts, and facility siting now live on the <b className="text-ink">City View</b> tab — build, enter new markets, and route capacity there. Everything you queue is committed with this round when you brew.</p>
          </Card>
        )}

        {/* Facilities (MOD-B11) — owned physical capacity */}
        {facOn && !cityManaged && (
          <Card className={deskCls("operations")}>
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
                        <span>{online ? `+${fmt.int(liveCap)} drinks/rd` : "online soon"} · {fmt.money(t?.fixed_cost ?? 0)}/round</span>
                        {active && online && (
                          <label className="flex items-center gap-1">
                            <span>Upkeep $</span>
                            <input type="number" min={0} step="500" value={fmaint[fac.id] ? toDisplayMoney(fmaint[fac.id]) : ""} onChange={(e) => setMaintain(fac.id, toEngineMoney(+e.target.value))} placeholder="0"
                              className="tnum w-16 rounded border border-line bg-paper px-1 py-0.5 text-right text-[0.7rem]" />
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
                      <span className="text-[0.64rem] text-inksoft">+{fmt.int(t.production_capacity ?? t.capacity_contribution ?? 0)} drinks/rd{(t.retail_draw ?? 0) > 0 ? ` · +${fmt.int(t.retail_draw ?? 0)} retail` : ""} · {t.build_rounds}r · {fmt.money(t.fixed_cost)}/rd</span>
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
          <Card className={deskCls("people")}>
            <div className="mb-2 flex items-center gap-2">
              <Eyebrow>Team</Eyebrow>
              <InfoDot title="Your team" align="right">
                Hire named people from the talent market. Each raises one of your stocks by their skill — but only while they're satisfied. Pay below market or hit hard times and morale slips; at zero they walk, and rivals poach the unhappy.{mods?.employees?.loyalty ? ` Quarters served with good morale build loyalty: a loyal veteran contributes up to +${Math.round(mods.employees.loyalty.cap * 100)}% more and is harder to poach — and all of it walks out the door with them.` : " A raise buys loyalty."}
              </InfoDot>
            </div>

            {employees.length > 0 ? (
              <div className="grid gap-2">
                {employees.map((e) => {
                  const firingThis = efiring.has(e.id);
                  const satPct = Math.round(e.satisfaction * 100);
                  const satTone = e.satisfaction > 0.6 ? "var(--color-hop)" : e.satisfaction > 0.35 ? "var(--color-gold)" : "var(--color-brick)";
                  // DW-075: the loyalty dividend and this quarter's poach roll, from the engine's own formulas.
                  const loyCfg = mods?.employees?.loyalty;
                  const loy = loyCfg ? Math.min(loyCfg.cap, e.loyalty ?? 0) : 0;
                  const poachRisk = mods?.employees && e.tenure_rounds >= 1 ? mods.employees.poach_base * (1 - e.satisfaction) * (loyCfg ? 1 - loyCfg.poach_shield * (loy / loyCfg.cap) : 1) : 0;
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
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.64rem] text-inksoft">
                        <span>{roleLabel(e.role)} · {e.tenure_rounds}r tenure · {fmt.money(e.salary)}/round</span>
                        {loyCfg && (
                          <span className="tnum rounded-[2px] px-1 font-semibold" style={{ background: loy > 0 ? "color-mix(in srgb, var(--color-hop) 14%, transparent)" : "var(--color-line)", color: loy > 0 ? "var(--color-hop)" : "var(--color-inksoft)" }} title={`Loyalty dividend: ${e.tenure_rounds} quarter${e.tenure_rounds === 1 ? "" : "s"} × morale — multiplies their contribution; lost if they leave`}>
                            +{Math.round(loy * 100)}% loyalty
                          </span>
                        )}
                        {mods?.employees && (
                          <span className="tnum" style={{ color: poachRisk > 0.03 ? "var(--color-brick)" : undefined }} title="Chance a rival lures them away when this round resolves: base × (1 − morale), shielded by loyalty">
                            poach risk {e.tenure_rounds >= 1 ? `${(poachRisk * 100).toFixed(1)}%` : "—"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="w-16 text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">Morale</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-line"><div className="h-full" style={{ width: `${satPct}%`, background: satTone }} /></div>
                        <span className="tnum w-9 text-right text-[0.66rem] text-inksoft">{satPct}%</span>
                      </div>
                      {!firingThis && (
                        <label className="mt-1 flex items-center justify-end gap-1 text-[0.64rem] text-inksoft">
                          <span>Raise to $</span>
                          <input type="number" min={toDisplayMoney(e.salary)} step="500" value={eraises[e.id] != null ? toDisplayMoney(eraises[e.id]) : ""} onChange={(ev) => setRaise(e.id, toEngineMoney(+ev.target.value))} placeholder={String(Math.round(toDisplayMoney(e.salary)))}
                            className="tnum w-16 rounded border border-line bg-paper px-1 py-0.5 text-right text-[0.7rem]" />
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
                      <div key={cnd.id} className={`rounded-md border transition-colors ${picked ? "border-copper bg-copper/[0.06]" : "border-line"}`}>
                        <button type="button" onClick={() => toggleHireEmp(cnd.id)} disabled={full}
                          className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40">
                          <Avatar seed={cnd.avatar_seed} name={cnd.name} size={24} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold text-ink">{cnd.name}</span><SkillStars n={cnd.skill} /></div>
                            <div className="text-[0.62rem] text-inksoft">{roleLabel(cnd.role)} · <span className={deal === "underpriced" ? "text-hop" : deal === "pricey" ? "text-brick" : ""}>{deal}</span></div>
                          </div>
                          <span className="tnum ml-auto shrink-0 text-[0.72rem] text-copperdeep">{fmt.money(cnd.salary)}/rd</span>
                          <span className="shrink-0 text-[0.66rem] font-semibold text-copperdeep">{picked ? "✓" : "Hire"}</span>
                        </button>
                        {/* Talent competition: a candidate is ONE person — if a rival goes for
                            them too, the higher signing bonus wins; only the winner pays. */}
                        {picked && (
                          <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
                            <span className="text-[0.58rem] leading-snug text-inksoft">Signing bonus <span className="opacity-75">· optional — wins them if a rival bids too; only the winner pays</span></span>
                            <span className="flex shrink-0 items-center gap-1"><span className="text-[0.68rem] text-inksoft">$</span><input type="number" min="0" step="500" value={ebids[cnd.id] ?? 0} onChange={(e) => setHireBid(cnd.id, +e.target.value)} className="w-20 text-right text-[0.7rem]" /></span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-3 border-t border-line pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">
                <span>Raid rival talent</span>
                <InfoDot title="Poaching" align="right">
                  Scout a rival from their <b>dossier</b> — click their brewery in Field &amp; Intel (or on the map). With <b>market research</b> bought this round you'll see their crew's pay and morale and can make an offer. Beat their current pay to lure them over; the unhappier they are and the bigger your raise, the likelier they jump — a successful poach costs a one-time signing premium on top of the new salary.
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
          <Card className={deskCls("commercial")}>
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
                          {marketName(m.id, m.label)}
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
          <Card className={playsVisible ? "" : "hidden"}>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Plays &amp; Programs</Eyebrow>
              <InfoDot title="Plays & programs">One-off moves and standing programs that sit on top of your core price, capacity and investment decisions. A <b>play</b> is a single-round action you choose to run or not — it costs money this round and its effect fades. A <b>program</b> is a standing commitment you fund every round and that builds up over time. Each card below says what it costs and what it moves. Which ones appear depends on how your instructor set up this game.</InfoDot>
            </div>

            {prOn && (
              <div className={`mt-2 border-t border-line pt-3 ${deskCls("commercial")}`}>
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
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("operations")}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Water efficiency</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(Math.max(0, d.invest_water_efficiency ?? 0))}</span>
                </div>
                <input type="range" min="0" max={Math.max(80_000, Math.round(cash * 0.3))} step="1000" value={Math.max(0, d.invest_water_efficiency ?? 0)} onChange={(e) => set({ invest_water_efficiency: +e.target.value })} className="mt-1 w-full" style={leverStyle("invest_water_efficiency")} />
                <LeverNote f="invest_water_efficiency" />
                <div className="text-[0.68rem] leading-snug text-inksoft">
                  Builds resilience to the water shock &amp; earns regulator goodwill. {view.own.water_efficiency > 0.1 ? `Efficiency stock ${view.own.water_efficiency.toFixed(1)}.` : ""}
                </div>
              </div>
            )}

            {rndOn && (
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("operations")}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">R&amp;D — the new category</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(Math.max(0, d.invest_rnd ?? 0))}</span>
                </div>
                <input type="range" min="0" max={Math.max(120_000, Math.round(cash * 0.4))} step="1000" value={Math.max(0, d.invest_rnd ?? 0)} onChange={(e) => set({ invest_rnd: +e.target.value })} className="mt-1 w-full" style={leverStyle("invest_rnd")} />
                <LeverNote f="invest_rnd" />
                <div className="text-[0.68rem] leading-snug text-inksoft">
                  {frontierActive ? "The frontier category is open — R&D no longer pulls it forward." : "Race to open the frontier category early; the leader gets a first-mover head start."}
                  {view.own.rnd_progress > 0.1 ? ` Your progress ${view.own.rnd_progress.toFixed(0)}.` : ""}
                </div>
              </div>
            )}

            {pgOn && goods.length > 0 && (
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("strategy")}`}>
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
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("operations")}`}>
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
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("people")}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Key people</span>
                  <InfoDot title="The talent market">Each role is yours to fill — a rival hiring the same role doesn't take it from you, and it doesn't matter who submits first. A hire lands when the round resolves, as long as you can cover the signing bonus plus the first salary; if you can't, the round's news says so. A hire boosts a capability the day they start and takes it with them if they leave: each round some chance they move on to another job, which a strong crew culture (employee trust) makes rarer. Any seat on your team can request a hire. You can see who staffs which rivals in a brewery's dossier.</InfoDot>
                </div>
                <div className="mb-1.5 text-[0.66rem] leading-snug text-inksoft">
                  Retention this round: <span className={retentionTone}>{retentionLabel}</span> — driven by your {STOCK_LABEL.T_emp.toLowerCase()}.
                  {labCfg?.tenure_bonus && <> A hire's bonus grows +{Math.round(labCfg.tenure_bonus.rate * 100)}% a quarter to ×{labCfg.tenure_bonus.cap.toFixed(1)} — and leaves with them.</>}
                </div>
                {/* DW-071: say plainly who is on the payroll — game-1 teams couldn't tell whether a hire had landed. */}
                <div className="mb-1.5 text-[0.7rem] leading-snug">
                  <b>On staff now:</b>{" "}
                  {(view.own.key_hires ?? []).length
                    // DW-075: tenure + the bonus multiplier the stock currently carries (×1 = the flat hire bonus).
                    ? (view.own.key_hires ?? []).map((h) => `${labRoles.find((r) => r.id === h.role)?.label ?? h.role} (since R${h.hired_round + 1}${labCfg?.tenure_bonus ? ` · ${Math.max(0, view.round - h.hired_round)}q · bonus ×${(h.tenure_mult ?? 1).toFixed(1)}` : ""})`).join(" · ")
                    : <span className="text-inksoft">nobody yet — a hire you request shows up here after the round resolves.</span>}
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
                          <div className="text-[0.78rem] font-semibold">{r.label}{employed && <span className="ml-1 text-[0.6rem] text-hop">· on staff</span>}</div>
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
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("strategy")}`}>
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
                          <input type="number" step="5000" min="0" value={toDisplayMoney(bid.price)} onChange={(e) => set({ acquisition_bid: { ...bid, price: Math.max(0, toEngineMoney(+e.target.value)) } })} className="w-24 text-right" />
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
              <div className={`mt-3 border-t border-line pt-3 ${deskCls("strategy")}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Lobbying</span>
                  <InfoDot title="Non-market strategy">Spend to push an industry regulation that suits your position — quality standards reward quality leaders, ad limits hurt brand-heavy rivals, craft promotion grows the premium category. Rivals can counter-lobby to bleed your progress. Heavy <i>offensive</i> lobbying risks an investigation fine, softened by your distributor/regulator standing.</InfoDot>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[0.72rem] text-inksoft">Lobbying budget {lobTargeted ? "" : "— pick a target below"}</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(lobSpendEff)}</span>
                </div>
                <input type="range" min="0" max={Math.max(80_000, Math.round(cash * 0.3))} step="1000" value={lobSpend} onChange={(e) => setLobby({ lobby_spend: +e.target.value })} className="mt-1 w-full" style={leverStyle("lobby_spend")} />
                <LeverNote f="lobby_spend" />
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
          <Card className={deskCls("strategy")}>
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
        <Card className={deskCls("commercial")}>
          <Eyebrow>Read &amp; Reflect</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={d.buy_info || infoLocked} disabled={infoLocked} onChange={(e) => { if (infoLocked) return; set({ buy_info: e.target.checked }); onInfoChange?.(e.target.checked); }} />
                Buy market research <span className="tnum text-inksoft">({fmt.money(infoCost)})</span>
              </label>
              <LeverNote f="buy_info" />
              <div className={`mt-0.5 text-[0.68rem] ${d.buy_info || infoLocked ? "text-hop" : "text-inksoft"}`}>
                {infoLocked
                  ? `✓ Purchased for this round${buyer ? ` by ${buyer}` : ""} — the report is already in your team's hands, so it can't be returned. Rivals' quality, brand, pricing & the strategy map are open in the Field & Intel tab.`
                  : d.buy_info ? "✓ Rivals' quality, brand, pricing & the strategy map are unlocked in the Field & Intel tab." : `Reveals rival positioning in the Field & Intel tab this round${team ? " — for the whole team; any chair can buy it" : ""}. Once you open the report, the purchase stands.`}
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

      {/* Commit panel (DW-077, design §C "What locks at round end") — pinned on desktop. Leads with
          the cash the TEAM's plan locks; when this form differs, the form-alone number under it, the
          differs block (who decides · locks · you typed), then Submit. Solo firms: the same rail
          without the team block. */}
      <div className="grid content-start gap-3 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100vh-5.25rem)] lg:self-start lg:overflow-y-auto">
        {/* Dark-walnut commit rail (dark in both modes; metallic top glint). With many differing
            levers the rail outgrows the viewport — it scrolls within its sticky column, so the
            Submit button at its foot is always reachable (the right rail in Play.tsx does the same). */}
        <div className="overflow-hidden rounded-[15px]" style={{ background: "var(--tt-wood)", border: "1px solid rgba(0,0,0,.4)", boxShadow: "inset 0 1px 0 rgba(255,240,205,.16), 0 0 0 1px var(--metal), 0 18px 36px rgba(0,0,0,.4)" }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(0,0,0,.32)", background: "linear-gradient(rgba(255,220,150,.10), rgba(255,220,150,0))" }}>
            <span className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em]" style={{ color: "#f0b94e" }}>{team ? "What locks at round end" : "Commit the round"}</span>
            <span className="font-mono text-[0.55rem] uppercase tracking-wide" style={{ color: "#bda079" }}>Round {roundNo}</span>
          </div>
          <div className="px-4 pt-3 pb-3">
            <div className="font-mono text-[0.58rem] uppercase tracking-[0.1em]" style={{ color: "#bda079" }}>{team ? "On the team's plan · projected cash · pre-sales" : "Projected cash · pre-sales"}</div>
            <div className="tnum text-[2.6rem] font-bold leading-none" style={{ color: overcommit ? "#e59178" : "#f4e6c8" }}>{fmt.money(projectedCash)}</div>
            {team && diffs.rows.length > 0 && Math.abs(myCash - projectedCash) >= 0.5 && (
              <div className="mt-1 text-[0.8rem]" style={{ color: "#bda079" }}>Your form alone would give <b className="tnum" style={{ color: "#f2e4c4" }}>{fmt.money(myCash)}</b></div>
            )}
            <div className="mt-3 grid gap-1 pt-2.5" style={{ borderTop: "1px solid rgba(255,240,205,.13)" }}>
              <CommitRow label="Cash on hand" value={fmt.money(cash)} />
              {invOn && brewSpend > 0 && <CommitRow label="Brewing" value={`−${fmt.money(brewSpend)}`} />}
              {investSpend + infoSpend > 0 && <CommitRow label="Investment & research" value={`−${fmt.money(investSpend + infoSpend)}`} />}
              {moduleSpend > 0 && <CommitRow label="Plays, programs & entry" value={`−${fmt.money(moduleSpend)}`} />}
              {instrDraws > 0 && <CommitRow label="Alt. financing" value={`+${fmt.money(instrDraws)}`} tone="hop" />}
              {netFinancing !== 0 && <CommitRow label="Net financing" value={fmt.signed(netFinancing)} tone={netFinancing < 0 ? "brick" : "hop"} />}
              {lastCov != null && lastCov <= 900 && <CommitRow label="Interest coverage (last)" value={`${lastCov.toFixed(1)}×`} />}
            </div>
          </div>
          {team && (diffs.rows.length > 0 ? (
            <div data-testid="plan-differs" className="grid gap-2.5 px-4 py-3" style={{ background: "rgba(216,106,82,.14)", borderTop: "3px solid #e59178", color: "#f2e4c4" }}>
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-base font-bold" style={{ background: "#e59178", color: "#1b130c" }}>{diffs.rows.length}</span>
                <span className="text-[1.02rem] font-semibold leading-tight">{diffHeadline(diffs)}</span>
              </div>
              {/* One stacked block per lever (lever + who decides, then LOCKS, then YOU TYPED). A
                  three-column table squeezed the lever column to nothing in this ~320px rail as soon
                  as a value ran long — the names overprinted the numbers. */}
              <div className="grid text-[0.8rem]">
                {diffs.rows.map((r) => {
                  const mineWins = r.winner === "me";
                  const sameVal = mineWins || leverText(String(r.field), r.locks, view) === leverText(String(r.field), r.mine, view);
                  const tag = "w-[4.6rem] shrink-0 font-mono text-[0.52rem] font-semibold uppercase tracking-[0.1em]";
                  return (
                    <div key={String(r.field)} className="grid min-w-0 gap-1 py-2" style={{ borderTop: "1px solid rgba(255,240,205,.14)" }}>
                      <div className="leading-snug"><b>{r.label}</b><span className="block text-[0.74rem]" style={{ color: "#bda079" }}>{r.who}</span></div>
                      <div className="flex min-w-0 items-baseline gap-2"><span className={tag} style={{ color: "#bda079" }}>Locks</span><span className="tnum min-w-0 font-bold" style={{ color: mineWins ? "#9fce63" : "#e59178" }}>{T(r.field, r.locks)}</span></div>
                      {!mineWins && <div className="flex min-w-0 items-baseline gap-2"><span className={tag} style={{ color: "#bda079" }}>{r.changed ? "You typed" : "Your form"}</span><span className="tnum min-w-0" style={{ color: "#bda079", textDecoration: sameVal ? "none" : "line-through" }}>{T(r.field, r.mine)}</span></div>}
                      {r.action && <button type="button" data-dw-action={r.action} onClick={() => rowAction(r)} className="justify-self-start rounded-[8px] px-2.5 py-1 font-mono text-[0.6rem] font-bold uppercase tracking-wide" style={{ border: `${r.action === "undo" ? 1 : 2}px solid ${r.action === "undo" ? "rgba(255,240,205,.35)" : "#f2e4c4"}`, color: r.action === "undo" ? "#bda079" : "#f2e4c4" }}>{actionLabel(r.action)}</button>}
                    </div>
                  );
                })}
              </div>
              {canAct && (
                <div className="flex gap-2">
                  {!isCeoSeat && <button type="button" onClick={takeCeo} disabled={!diffs.rows.some((r) => r.ceoValue !== undefined)} className="flex-1 rounded-[10px] px-2 py-2 font-mono text-[0.66rem] font-bold uppercase tracking-wide disabled:opacity-40" style={{ border: "2px solid #f2e4c4", color: "#f2e4c4" }}>Take the CEO's numbers</button>}
                  <button type="button" onClick={keepMine} className="flex-1 rounded-[10px] px-2 py-2 font-mono text-[0.66rem] font-bold uppercase tracking-wide" style={{ border: "1px solid rgba(255,240,205,.35)", color: "#bda079" }}>Keep mine</button>
                </div>
              )}
              <div className="text-[0.74rem] leading-snug" style={{ color: "#bda079" }}>
                {(ROLE_DESK[seatRole ?? ""] ?? "all") === "all"
                  ? "These levers sit on a seated teammate's desk, so their number is used where they changed it; where they left a lever at last round's value, yours runs. An empty chair carries last round's plan unless someone covers it. A teammate's cover stands until you change that lever — then, as CEO, yours is final for the round: Keep mine (or Cancel it, for a build or hire) overrules a cover, and Use theirs takes their number."
                  : `A lever you leave at last round's value follows the CEO. Change it yourself (or Keep mine) to override.${canAct ? " A hold is a promise until you submit." : ""}`}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2.5 text-[0.84rem]" style={{ borderTop: "1px solid rgba(255,240,205,.13)", color: "#f2e4c4" }}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: unsent ? "#f0b94e" : "#9fce63" }} />{unsent ? "You've changed your desk since you submitted — the team's plan still has your last submit. Update to send it." : "Your form matches the team's plan."}</div>
          ))}
          <div className="px-4 pb-3 pt-2" style={{ borderTop: team ? "1px solid rgba(255,240,205,.13)" : undefined }}>
            {overcommit && <div className="mb-3 rounded-lg px-3 py-2 text-[0.72rem]" style={{ background: "rgba(216,106,82,.16)", border: "1px solid rgba(216,106,82,.5)", color: "#eaa088" }}>Spending exceeds cash on hand — draw financing or trim a desk before brewing.</div>}
            {callsSlot && <div className="mb-3">{callsSlot}</div>}
            {unsent && diffs.rows.length > 0 && <div className="mb-2 rounded-lg px-3 py-2 text-[0.72rem] leading-snug" style={{ background: "rgba(240,185,78,.14)", border: "1px solid rgba(240,185,78,.45)", color: "#f2d9a0" }}>You've changed your desk since you submitted — it isn't on the team's plan until you update.</div>}
            <Button variant="go" onClick={() => onPlay(mergeDecision(view, d, cityActions, poaches))} disabled={busy} className="mt-1 w-full py-3 text-base">
              {submitText()}
            </Button>
            <div className="mt-1.5 text-center text-[0.66rem]" style={{ color: "#a98a5f" }}>{footerNote ?? "Seven rival breweries brew at the same time."}</div>
          </div>
        </div>
      </div>
      {/* Mobile-only bottom sheet — the differs block (first 2 rows, then "+N more"), TEAM LOCKS and the
          submit button, always reachable while tuning desks (pr-16 clears the day/night toggle). */}
      <div data-dw="commit-sheet" className="fixed inset-x-0 bottom-0 z-30 border-t border-line2 bg-panel/95 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))", borderRadius: "20px 20px 0 0", boxShadow: "0 -10px 30px rgba(0,0,0,.25)" }}>
        {team && diffs.rows.length > 0 && (
          <div className="grid gap-1 px-4 py-2.5" style={{ background: "color-mix(in srgb, var(--color-brick) 12%, var(--color-panel))", borderTop: "3px solid var(--color-brick)", borderRadius: "20px 20px 0 0" }}>
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[0.78rem] font-bold text-paper" style={{ background: "var(--color-brick)" }}>{diffs.rows.length}</span>
              <span className="text-[0.9rem] font-semibold leading-tight text-ink">{diffHeadline(diffs)}</span>
            </div>
            {(sheetAll ? diffs.rows : diffs.rows.slice(0, 2)).map((r) => (
              <div key={String(r.field)} className="grid min-w-0 gap-0.5 border-t border-line pt-1 text-[0.82rem]">
                <span className="min-w-0 truncate"><b className="text-ink">{r.label}</b> <span className="text-inksoft">· {r.winner === "me" ? "yours" : r.whoShort}</span></span>
                <span className="min-w-0 leading-snug"><b className={`tnum ${r.winner === "me" ? "text-hop" : "text-brick"}`}>{T(r.field, r.locks)}</b> {r.winner === "them" && <span className="tnum text-inksoft line-through">{T(r.field, r.mine)}</span>}</span>
                {r.action && <button type="button" data-dw-action={r.action} onClick={() => rowAction(r)} className="justify-self-start rounded-md border border-line2 px-2 py-0.5 font-mono text-[0.6rem] font-bold uppercase tracking-wide text-ink">{actionLabel(r.action)}</button>}
              </div>
            ))}
            {diffs.rows.length > 2 && <button type="button" onClick={() => setSheetAll((v) => !v)} className="text-left font-mono text-[0.62rem] font-semibold text-inksoft">{sheetAll ? "show less" : `+${diffs.rows.length - 2} more · see all`}</button>}
          </div>
        )}
        {unsent && <div className="px-4 pt-2 text-[0.72rem] leading-snug text-gold">Changed since you submitted — update to send it.</div>}
        <div className="flex items-center gap-3 px-4 pt-2.5">
          <div className="shrink-0">
            <div className="font-mono text-[0.5rem] uppercase tracking-[0.1em] text-inksoft">{team ? "Team locks" : "Cash · pre-sales"}</div>
            <div className="tnum text-lg font-bold leading-none" style={{ color: overcommit ? "var(--color-brick)" : "var(--color-ink)" }}>{fmt.money(projectedCash)}</div>
          </div>
          <button onClick={() => onPlay(mergeDecision(view, d, cityActions, poaches))} disabled={busy} className="tt-btn tt-btn--go ml-auto min-w-0 whitespace-normal text-center leading-tight">
            {busy ? "Working…" : submitText(true)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The differs-block headline: singular/plural, and honest when every differing lever is yours. */
function diffHeadline({ rows }: { rows: PlanDiff[] }): string {
  const n = rows.length, them = rows.filter((r) => r.winner === "them").length;
  const notices = rows.filter((r) => r.winner === "me" && /in your form/.test(r.who)).length; // a teammate's cover my form carries
  // DW-081: "not yours" only where you changed the lever — else your form just carries last round's value
  const notYours = rows.some((r) => r.winner === "them" && r.changed) ? ", not yours" : "";
  if (them === n) return n === 1 ? "1 lever locks at a teammate's number" : `${n} levers lock at a teammate's number${notYours}`;
  if (them === 0 && notices === n) return n === 1 ? "1 lever set by a teammate for an empty chair — your form carries it" : `${n} levers set by teammates for empty chairs — your form carries them`;
  if (them === 0) return n === 1 ? "1 lever differs from a teammate's entry — yours is used" : `${n} levers differ from a teammate's entry — yours are used`;
  return `${them} of ${n} differing levers lock at a teammate's number${notYours}`;
}

// Rows inside the dark-walnut commit rail — fixed light-on-dark tones (mode-independent).
function CommitRow({ label, value, tone }: { label: string; value: string; tone?: "hop" | "brick" }) {
  return (
    <div className="flex items-baseline justify-between text-[0.78rem]">
      <span style={{ color: "#bda079" }}>{label}</span>
      <span className="tnum font-semibold" style={{ color: tone === "hop" ? "#9fce63" : tone === "brick" ? "#e59178" : "#f2e4c4" }}>{value}</span>
    </div>
  );
}
