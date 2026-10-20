/**
 * DW-077 event copy (design/round-ux-2026-10 §A) — what a market event means, in the voice of
 * the takeover card and the wire strip, for every shock the engine can fire × every seat ×
 * both phases (announced → hits). Pure: reads the GameView only for cheap live numbers (the
 * COO's unit cost, the firm's capacity).
 *
 * The `water` and `demand_slump` (Recession) seat lines are ported from the mockup's `FOR` object
 * in `Event Moment.dc.html` (verbatim, except that "next round" became `{eta}` so the same line
 * stays honest when the ETA is "when this round closes" or "in about 2 rounds"); the rest were written in the same register — concrete,
 * one lever named, no hype — and should be reviewed by the instructor before a class sees them.
 *
 * Phases: "announced" = a signaled shock the engine lists ahead of time (`active:false,
 * roundsAway ≥ 0`); "hits" = `active:true`. Unannounced shocks (water / harvest / co2) only ever
 * appear as hits, but every id carries both phases so a gamemaster-planted one reads correctly.
 */
import type { GameView, ShockSignal } from "../game/controller.js";
import { SEG_LABEL, fmt, marketName } from "../labels.js";
import type { SeatRole } from "./seatColors.js";

export type WirePhase = "announced" | "hits";
export type CopyRole = SeatRole | "member";
export interface SeatLine { short: string; long: string }
type Live = (view: GameView, eta: string, share: number, phase: WirePhase) => SeatLine;
type SeatCopy = Record<CopyRole, SeatLine | Live>;

export interface WireEvent {
  key: string; // stable across the announced → hits transition: `${typeId}:${round}:${target}`
  phase: WirePhase;
  tone: "red" | "amber";
  tag: string; // HITTING NOW · NEXT ROUND · THIS ROUND · IN n ROUNDS
  when: string; // ROUND n · ~ROUND n
  kicker: string; // ON THE WIRE · ROUND n · HITTING NOW
  scope: string; // INDUSTRY-WIDE · LAGERS & LIGHT …
  title: string; // Water shortage
  summary: string; // input costs spike sharply this round
  headline: string; // The water shortage is here
  subline: string; // It hits every brewery this round. Input costs spike sharply.
  short: string; // For your desk: … (strip)
  long: string; // What it means for your desk (takeover)
}

const L = (short: string, long: string): SeatLine => ({ short, long });
/** Mean magnitudes from engine/src/config/defaults.ts — for a "roughly" number, not a promise. */
const COST_MEAN: Record<string, number> = { water: 0.35, harvest: 0.55 };
const CO2_CAP_MEAN = 0.28;

interface ShockCopy {
  title: string;
  summary: Record<WirePhase, string>;
  headline: Record<WirePhase, string>;
  subline: Record<WirePhase, string>;
  seats: Record<WirePhase, SeatCopy>;
}

const costUp = (id: string): Live => (view, _eta, share, phase) => {
  const now = view.unitCostEst;
  // DW-080: a shock only shows as "hits" once it has fired, so last round's unit cost (the estimate's
  // basis) already carries the spike — multiplying again counted it twice.
  if (phase === "hits") return L(`Est. unit cost holds near ${fmt.price(now)} while it lasts.`, `Last round's unit cost (${fmt.price(now)}) already carries the spike; expect about the same until it passes. Idle tanks still cost upkeep, so add capacity only for volume you can sell.`);
  const up = now * (1 + (COST_MEAN[id] ?? 0.35) * share);
  return L(`Est. unit cost rises to about ${fmt.price(up)}.`, `Est. unit cost rises from ${fmt.price(now)} to about ${fmt.price(up)} before resilience softens it. Idle tanks still cost upkeep, so add capacity only for volume you can sell.`);
};

const COPY: Record<string, ShockCopy> = {
  water: {
    title: "Water shortage",
    summary: { announced: "a drought is forming; input costs will spike", hits: "input costs spike sharply this round" },
    headline: { announced: "A water shortage is coming", hits: "The water shortage is here" },
    subline: { announced: "Expected to land {eta}. Input costs spike for every brewery.", hits: "It hits every brewery this round. Input costs spike sharply." },
    seats: {
      hits: {
        ceo: L("Every desk pays more per drink this round.", "Every desk’s unit cost rises this round. Water efficiency, on your desk under Plays & programs, is the lever that softens the hit."),
        cfo: L("Margins compress before sales land.", "Margins compress before sales come in. Projected cash already carries the higher cost, so check interest coverage before you draw more debt."),
        coo: costUp("water"),
        cmo: L("Rivals face the same cost spike.", "Rivals face the same cost spike. Holding price protects share; raising it protects margin. That trade is yours."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. A head brewer adds recipe quality, which holds share while rivals cut corners."),
        member: L("Every drink costs more to brew this round.", "Every drink costs more to brew this round. Water efficiency softens it; a price hold protects share, a price rise protects margin."),
      },
      announced: {
        ceo: L("Put water efficiency in place before it lands {eta}.", "The spike lands {eta}. Water efficiency bought now is in place when it does; bought after, it only helps the next one."),
        cfo: L("Costs jump {eta}; keep cash for it.", "Unit costs jump {eta}. A cash buffer carries the margin squeeze better than debt drawn in the middle of it."),
        coo: L("Lock in process gains before costs jump.", "Brewing operations and water efficiency invested now land before the spike. Capacity bought now arrives into a higher-cost round."),
        cmo: L("Price for a higher cost base {eta}.", "Every rival’s cost rises with yours {eta}. Set prices this round with that in mind; a last-minute raise reads as panic."),
        chro: L("Morale cushions a cost shock.", "Taproom community is part of the firm’s resilience. Built now, it softens the spike when it lands."),
        member: L("A cost spike lands {eta}.", "Input costs spike {eta}. Water efficiency and process investment made now are the only ones that count when it hits."),
      },
    },
  },
  harvest: {
    title: "Harvest failure",
    summary: { announced: "a poor hop and barley harvest is expected", hits: "grain and hop costs spike hard this round" },
    headline: { announced: "A bad harvest is coming", hits: "The harvest has failed" },
    subline: { announced: "Expected to land {eta}. Hop and barley prices jump for everyone.", hits: "Hop and barley prices jump this round for every brewery. One round, but a steep one." },
    seats: {
      hits: {
        ceo: L("The steepest cost spike in the game, for one round.", "Unit cost takes its biggest jump of the season this round. Process and community resilience soften it; nothing bought today lands in time."),
        cfo: L("Expect thin or negative margin this quarter.", "Gross margin thins or turns negative this round. Decide now whether cash on hand covers it or whether a debt draw bridges it."),
        coo: costUp("harvest"),
        cmo: L("Everyone’s cost just jumped; price for it.", "Every rival pays the same spike. A modest price rise holds margin without losing much share; a deep one hands share to anyone who holds."),
        chro: L("Hold the crew; cutting now costs more later.", "Cutting people to save a round’s cost loses skill you rebuild slowly. The spike is one round; a lost head brewer is many."),
        member: L("Grain and hop costs spike this round.", "Every drink costs far more to brew this round. Price covers some of it; the rest is a one-quarter margin hit to plan around."),
      },
      announced: {
        ceo: L("Brace for a steep cost spike {eta}.", "A one-round cost spike lands {eta}. Process investment made now softens it; capacity bought now arrives into it."),
        cfo: L("Set aside cash for a thin quarter {eta}.", "Margin collapses for one quarter {eta}. Keep cash on hand rather than paying it out; a dividend now is a debt draw later."),
        coo: L("Brewing operations now, not after.", "Brewing operations invested this round is in place when the spike lands {eta}. Hold the capacity plan until it passes."),
        cmo: L("Plan the price move — costs jump {eta}.", "Costs jump for every brewery {eta}. Decide the price response now so the move is deliberate, not a reaction."),
        chro: L("Resilience now; no layoffs then.", "Taproom community built now is resilience when the spike lands. Plan to carry the crew through one thin quarter."),
        member: L("A steep one-round cost spike lands {eta}.", "Input costs jump hard for one round {eta}. Process investment now and a cash buffer are the two things that help."),
      },
    },
  },
  co2: {
    title: "CO₂ & packaging squeeze",
    summary: { announced: "a packaging and CO₂ shortage is building", hits: "brewing capacity is constrained this round" },
    headline: { announced: "A packaging squeeze is coming", hits: "The CO₂ squeeze is here" },
    subline: { announced: "Expected to land {eta}. Cans, CO₂ and kegs run short; tanks cannot run full.", hits: "Cans, CO₂ and kegs ran short. Every brewery runs below capacity this round." },
    seats: {
      hits: {
        ceo: L("Tanks run below capacity this round.", "Effective capacity drops this round for everyone. Volume you cannot brew is share you cannot hold; process resilience softens the cut."),
        cfo: L("Less volume, same fixed cost.", "Revenue falls with volume while upkeep and interest do not. Check that cash covers the quarter before adding financing."),
        coo: (view) => L(`Effective capacity falls to about ${fmt.int(view.own.cap * (1 - CO2_CAP_MEAN))} drinks.`, `Effective capacity falls from ${fmt.int(view.own.cap)} to about ${fmt.int(view.own.cap * (1 - CO2_CAP_MEAN))} drinks before resilience softens it. Point the run rate at the category that earns the most per drink.`),
        cmo: L("Less to sell; price the scarcity.", "You will sell fewer drinks than demand wants this round. Raising price where demand is strongest turns the shortfall into margin."),
        chro: L("No direct hit on your levers.", "No direct hit on your levers. A constrained line is a good round to invest in the crew; the volume is not there to lose."),
        member: L("You cannot brew at full capacity this round.", "Capacity is cut for one round. Sell the drinks you can brew where they earn the most, and let the shortfall fall on the weakest category."),
      },
      announced: {
        ceo: L("Capacity gets cut {eta}.", "Tanks run below capacity {eta}. Capacity bought now does not escape the cut; process resilience built now softens it."),
        cfo: L("A low-volume quarter is coming.", "Volume drops {eta} while fixed costs stay. Hold cash rather than committing it to capacity that will sit idle through the squeeze."),
        coo: L("Do not add tanks into a squeeze.", "Capacity bought now arrives constrained {eta}. Brewing operations invested now is the resilience that limits the cut."),
        cmo: L("Plan prices for a short-supply round.", "Supply falls {eta}, for everyone. Prices set high where demand is firm turn a shortfall into margin rather than lost sales."),
        chro: L("Resilience and morale before the squeeze.", "Taproom community built now is part of the resilience that limits the capacity cut {eta}."),
        member: L("A capacity cut lands {eta}.", "Every brewery runs below capacity {eta}. Process resilience now limits the cut; new tanks arrive into it."),
      },
    },
  },
  demand_slump: {
    title: "Recession",
    summary: { announced: "expected {eta}", hits: "demand softens across the board this round" },
    headline: { announced: "A recession is coming", hits: "The recession is here" },
    subline: { announced: "Expected to land {eta}. Demand softens across the board.", hits: "Demand softens across every category this round. Shoppers buy less, and trade down." },
    seats: {
      announced: {
        ceo: L("Build resilience before demand softens {eta}.", "Demand softens {eta}. You have this round to build resilience: process, community and water efficiency."),
        cfo: L("Revenue likely drops {eta}.", "Revenue likely drops {eta}. A cash buffer now beats drawing debt when sales are down."),
        coo: L("New tanks come online as demand falls.", "Capacity you buy now comes online just as demand falls. Holding level is the cautious call."),
        cmo: L("Shoppers trade down.", "Shoppers trade down in a recession. Value pricing on Lagers & Light matters more {eta}."),
        chro: L("Retention gets harder.", "Taproom community supports retention when demand dips. Hires signed now still cost the same {eta}."),
        member: L("Demand softens {eta}; keep cash.", "Demand softens {eta}. Build a cash buffer and hold the capacity plan; shoppers trade down, so value pricing matters."),
      },
      hits: {
        ceo: L("Fewer shoppers in every category.", "Demand is down across the board. Share is won on value and brand now, not capacity; hold the big spends until it lifts."),
        cfo: L("Revenue is down; protect the cash line.", "Revenue falls this quarter. Projected cash already carries it. Skip the dividend and avoid new debt the thinner revenue has to service."),
        coo: L("Expect idle capacity; trim the run rate.", "You will sell less than you can brew. Trim the run rate rather than pay to brew into inventory, and defer capacity."),
        cmo: L("Shoppers trade down this round.", "Shoppers trade down. A sharper Lagers & Light price holds volume; a premium raise loses it. Brand spend keeps working after the slump."),
        chro: L("Keep the crew; it is a two-round dip.", "A slump is the wrong time to lose people and the right time to build community. Hires still cost the same; morale is cheaper to keep than rebuild."),
        member: L("Demand is down across the board.", "Shoppers buy less and trade down this round. Value pricing holds volume; hold the big spends until demand lifts."),
      },
    },
  },
  craft_wave: {
    title: "Festival season",
    summary: { announced: "a demand surge is expected across every category", hits: "demand surges across the board this round" },
    headline: { announced: "Festival season is coming", hits: "Festival season is here" },
    subline: { announced: "Expected to land {eta}. Tourists and festivals lift demand in every category.", hits: "Festivals and tourists lift demand in every category this round. Everyone sells more; the question is who can brew it." },
    seats: {
      announced: {
        ceo: L("Demand lifts {eta}; capacity decides who wins.", "Demand rises {eta} for everyone. Capacity bought now comes online in time; brand built now meets the surge."),
        cfo: L("Fund capacity now; revenue follows {eta}.", "A capex ask now pays back {eta} when sales rise. Debt drawn for tanks that sell out is the good kind."),
        coo: L("Add tanks now; they arrive into the surge.", "Capacity bought this round comes online as demand surges {eta}. This is the round the build lag works for you."),
        cmo: L("A surge rewards brand and price discipline.", "Demand rises {eta}. Brand built now meets it; hold price so the surge turns into volume, not into a rival’s share."),
        chro: L("Staff up before the rush.", "More volume needs a crew that can brew it. A head brewer signed now is on the line when demand surges {eta}."),
        member: L("A demand surge lands {eta}.", "Demand surges {eta} for every brewery. Capacity and brand built now are what turn it into sales."),
      },
      hits: {
        ceo: L("Everyone sells more; capacity caps it.", "Demand is up in every category. Sales are capped by what you can brew, so point capacity at the category that earns the most."),
        cfo: L("Revenue lifts; bank it.", "Revenue rises this quarter. Projected cash already carries it. Pay down debt or hold the buffer; the lift is two rounds, not permanent."),
        coo: L("Run the line full; shortfall is lost share.", "Demand exceeds what you can brew. Run at full rate and allocate tanks to the category with the best margin per drink."),
        cmo: L("Raise where demand outruns supply.", "Shoppers want more than the market can brew. A measured price rise where you sell out turns the surge into margin."),
        chro: L("A busy line strains morale.", "Volume is up and the crew feels it. Taproom community now keeps satisfaction up through the rush."),
        member: L("Demand surges this round.", "Every category sells more this round. Brew at full rate and raise price where you sell out."),
      },
    },
  },
  health_shift: {
    title: "Health & wellness shift",
    summary: { announced: "tastes are turning away from Lagers & Light", hits: "Lagers & Light demand falls this round" },
    headline: { announced: "Tastes are turning", hits: "The wellness shift is here" },
    subline: { announced: "Expected to land {eta}. Drinkers turn away from Lagers & Light for several rounds.", hits: "Drinkers are turning away from Lagers & Light. Demand there falls this round and stays down for a few." },
    seats: {
      announced: {
        ceo: L("Lagers & Light shrinks {eta}; reposition.", "The mass category shrinks {eta} and stays smaller for several rounds. Weight the firm toward Craft Premium and the new category now."),
        cfo: L("Model lower Lagers & Light revenue {eta}.", "Revenue from Lagers & Light falls {eta} for several rounds. Fund the shift toward premium now rather than after the sales are gone."),
        coo: L("Point new capacity away from Lagers & Light.", "Capacity bought now should serve Craft Premium or the new category. Tanks pointed at Lagers & Light arrive into falling demand."),
        cmo: L("Shift brand and price toward premium.", "Lagers & Light demand falls {eta}. Brand built now carries into Craft Premium; a lower mass price only fights over a shrinking pool."),
        chro: L("Quality talent matters more in premium.", "The shift rewards recipe quality. A head brewer signed now is on the line when premium share is up for grabs."),
        member: L("Lagers & Light shrinks {eta}.", "Demand for Lagers & Light falls {eta} and stays down. Shift price, brand and capacity toward Craft Premium and the new category."),
      },
      hits: {
        ceo: L("Lagers & Light is shrinking.", "Mass-market demand is down and stays down for a few rounds. The firms that gain are the ones already weighted toward premium."),
        cfo: L("Lagers & Light revenue is down for a while.", "Revenue from the mass category falls this quarter and the next few. Treat it as structural, not a blip, when you plan financing."),
        coo: L("Idle Lagers & Light capacity; reallocate.", "Tanks allocated to Lagers & Light will run under demand. Move the capacity split toward Craft Premium."),
        cmo: L("Fight for premium, not for the shrinking pool.", "Lagers & Light shoppers are leaving. Cutting its price fights over fewer of them; brand and a premium position win the ones moving up."),
        chro: L("Quality talent earns more now.", "Premium share is won on recipe quality. The head brewer and crew morale matter more this round than last."),
        member: L("Lagers & Light demand is down.", "Mass-market demand falls this round and stays down. Move price, brand and capacity toward Craft Premium and the new category."),
      },
    },
  },
  na_moment: {
    title: "Non-alcoholic goes mainstream",
    summary: { announced: "the new category is about to take off", hits: "demand for the new category jumps this round" },
    headline: { announced: "Non-alcoholic is about to go mainstream", hits: "Non-alcoholic has gone mainstream" },
    subline: { announced: "Expected to land {eta}. Demand for Non-Alc / Functional jumps and stays up for several rounds.", hits: "Demand for Non-Alc / Functional jumps this round and stays up for several. The firms already there sell out." },
    seats: {
      announced: {
        ceo: L("Position in the new category before it jumps.", "The new category jumps {eta}. Entering now, with capacity and brand behind it, is worth more than entering after."),
        cfo: L("Fund the new-category entry now.", "Demand for the new category jumps {eta}. Capital spent on it this round pays back as that demand arrives."),
        coo: L("Point capacity at the new category.", "Capacity bought now should serve Non-Alc / Functional. It comes online as that demand jumps {eta}."),
        cmo: L("Build brand in the new category now.", "Shoppers move into Non-Alc / Functional {eta}. Brand built now is what they find; a premium price there holds when demand outruns supply."),
        chro: L("The new category needs new skills.", "A head brewer with the right skills matters for a new recipe. Sign now so the crew is ready when demand jumps {eta}."),
        member: L("The new category jumps {eta}.", "Demand for Non-Alc / Functional jumps {eta}. Capacity, brand and a position there now meet it; later is too late for the first wave."),
      },
      hits: {
        ceo: L("The new category is where growth is.", "Non-Alc / Functional demand is up and stays up. Firms already positioned there sell out; a late entry still catches the tail."),
        cfo: L("New-category revenue lifts; fund it.", "Revenue from the new category jumps this quarter. Capital pointed there now compounds across the rounds the lift lasts."),
        coo: L("Shift capacity to the new category.", "Demand in Non-Alc / Functional outruns supply. Reallocate tanks toward it and add capacity for the rounds the lift lasts."),
        cmo: L("Price up where you sell out.", "Shoppers want more Non-Alc / Functional than the market can brew. Raise price there and keep brand spend on it."),
        chro: L("A new recipe needs the right crew.", "The new category rewards recipe quality. A head brewer and crew morale are the levers that hold share there."),
        member: L("Non-Alc / Functional demand jumps.", "Demand for the new category jumps this round and stays up. Point capacity, price and brand at it."),
      },
    },
  },
};

const FALLBACK: ShockCopy = {
  title: "Market disruption",
  summary: { announced: "a market disruption is expected", hits: "the market is disrupted this round" },
  headline: { announced: "A disruption is coming", hits: "A market disruption has hit" },
  subline: { announced: "Expected to land {eta}.", hits: "It affects every brewery this round." },
  seats: {
    announced: Object.fromEntries(["ceo", "cfo", "coo", "cmo", "chro", "member"].map((r) => [r, L("A disruption lands {eta}.", "A market disruption lands {eta}. Keep cash on hand and hold the big spends until it passes.")])) as SeatCopy,
    hits: Object.fromEntries(["ceo", "cfo", "coo", "cmo", "chro", "member"].map((r) => [r, L("The market is disrupted this round.", "A market disruption is in effect this round. Keep cash on hand and hold the big spends until it passes.")])) as SeatCopy,
  },
};

/** Stable identity for a shock across the announced → hits transition. */
export const shockKey = (s: ShockSignal): string => `${s.typeId}:${s.round}:${s.target}${s.region ? `:${s.region}` : ""}`;

/** A regional shock (a drought strikes one market) only touches firms that PRODUCE there, scaled by
 *  that share (`exposure`, same factor as the resolver). Spared firms get their own seat lines. */
const pctOf = (x: number) => `${Math.round(x * 100)}%`;
function exposureLine(label: string, exposure: number | undefined): string {
  if (exposure == null) return "";
  if (exposure <= 0) return ` None of your production is there — you're spared this one.`;
  if (exposure >= 0.995) return ` All of your production is there.`;
  return ` About ${pctOf(exposure)} of your production is there, so you take that share of the hit.`;
}
const spared = (label: string): Record<CopyRole, SeatLine> => ({
  ceo: L(`Spared — none of your production is in ${label}.`, `Your tanks sit outside ${label}, so rivals brewing there carry this cost spike. Production spread across regions is what keeps it that way.`),
  cfo: L("No cost hit for you this round.", `Your unit cost holds. Rivals brewing in ${label} take the margin squeeze, so their cash will be tighter than yours.`),
  coo: L(`Your tanks are outside ${label}; unit cost holds.`, `Your unit cost holds this round. Any capacity you site in ${label} later carries this risk with it.`),
  cmo: L(`Rivals brewing in ${label} pay more per drink.`, `Rivals brewing in ${label} pay more per drink this round. If they raise prices, holding yours takes share.`),
  chro: L("No hit on your levers or your costs.", "No hit on your levers or your costs this round."),
  member: L(`Spared — none of your production is in ${label}.`, `Your tanks sit outside ${label}, so your unit cost holds. Rivals brewing there pay more per drink; if they raise prices, a price hold takes share.`),
});
export const shockPhase = (s: ShockSignal): WirePhase => (s.active ? "hits" : "announced");

export function eventCopy(shock: ShockSignal, role: string | null | undefined, view: GameView): WireEvent {
  const c = COPY[shock.typeId] ?? FALLBACK;
  const phase = shockPhase(shock);
  const r: CopyRole = (["ceo", "cfo", "coo", "cmo", "chro"] as const).includes(role as SeatRole) ? (role as SeatRole) : "member";
  const away = Math.max(shock.roundsAway, 0);
  const fireRound = shock.round + 1; // engine rounds are 0-based; the UI counts from 1
  const eta = phase === "hits" ? "now" : away <= 0 ? "when this round closes" : away === 1 ? "next round" : `in about ${away} rounds`;
  const fill = (s: string) => s.replace(/\{eta\}/g, eta);
  const regional = shock.region ? marketName(shock.region, shock.regionLabel) : null; // the City View's name for it
  const share = regional ? (shock.exposure ?? 1) : 1;
  const line = regional && shock.exposure != null && shock.exposure <= 0 ? spared(regional)[r] : c.seats[phase][r];
  const sl = typeof line === "function" ? line(view, eta, share, phase) : line;
  const subline = regional
    ? (phase === "hits" ? `It hits breweries producing in ${regional} this round.` : `Expected to land {eta}, on breweries producing in ${regional}.`) + exposureLine(regional, shock.exposure)
    : c.subline[phase];
  const curRound = Math.min(view.round + 1, view.nRounds);
  return {
    key: shockKey(shock),
    phase,
    tone: phase === "hits" ? "red" : "amber",
    tag: phase === "hits" ? "HITTING NOW" : away <= 0 ? "THIS ROUND" : away === 1 ? "NEXT ROUND" : `IN ${away} ROUNDS`,
    when: phase === "hits" || away <= 0 ? `ROUND ${phase === "hits" ? curRound : fireRound}` : `~ROUND ${fireRound}`,
    kicker: phase === "hits" ? `ON THE WIRE · ROUND ${curRound} · HITTING NOW` : "ON THE WIRE · ANNOUNCED",
    scope: regional ? `${regional.toUpperCase()} ONLY` : shock.target === "all" ? "INDUSTRY-WIDE" : (SEG_LABEL[shock.target] ?? String(shock.target)).toUpperCase(),
    title: c.title,
    summary: fill(c.summary[phase]) + (regional ? ` (${regional} producers)` : ""),
    headline: c.headline[phase],
    subline: fill(subline),
    short: fill(sl.short),
    long: fill(sl.long),
  };
}
