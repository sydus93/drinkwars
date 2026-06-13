/**
 * Finance layer (§7): derived three statements, endogenous cost of capital
 * (§7.4), and firm valuation (§7.5). The two invariants (§7.2) — balance sheet
 * balances, and cash-flow reconciles to ΔCash — are enforced here and double as
 * engine self-checks. With inventory disabled (legacy) working-capital change is
 * zero (all-cash sales, no carry). With inventory enabled, carried stock sits on
 * the balance sheet at cost and operating cash flow subtracts ΔInventory — the
 * identities still hold exactly (the WC term is restored, not approximated).
 */
import type { BalanceSheet, CashFlow, Config, FirmState, PnL, StockKey } from "../types.js";

export class InvariantError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvariantError";
  }
}

export interface FinanceInputs {
  firm: FirmState; // beginning-of-round financial state; stocks already advanced (§13 step 4)
  revenue: number;
  cogs: number;
  invest: { Q: number; B: number; T_emp: number; T_inv: number; T_gov: number; process: number; cap: number };
  financing: { debt_draw: number; debt_repay: number; equity_raise: number; dividend: number };
  extraOpex: number; // §11 formation / breach costs (+ inventory holding cost)
  cashHit: number; // §9 direct shock damage (resilience-mitigated)
  // Inventory (omit / 0 in legacy mode ⇒ WC=0, exactly as before). When carrying
  // stock, COGS is already at weighted-average cost; these add the spoilage write-off
  // and the ΔInventory working-capital term.
  spoilage?: number; // inventory write-off this round
  inventoryValueBegin?: number; // $ cost basis on hand at start of round
  inventoryValueEnd?: number; // $ cost basis carried forward
  spreadReduction?: number; // MOD-B10: reputation lowers the endogenous debt spread
  regBurdenReduction?: number; // MOD-B06: integrated distribution relieves regulatory opex
  round?: number; // current round (needed by MOD-B08 instrument terms)
  instruments?: { draw_convertible: number; draw_rbf: number }; // MOD-B08 draws this round
  config: Config;
}

export interface FinanceOutput {
  pnl: PnL;
  balance_sheet: BalanceSheet;
  cash_flow: CashFlow;
  cost_of_capital: { r_debt: number; coverage: number; leverage: number; credit_rationed: boolean };
  next: {
    cash: number; debt: number; paid_in_capital: number; retained_earnings: number; ppe_book: number;
    convertible_note: { principal: number; drawn_round: number } | null;
    rbf_outstanding: number; rbf_principal: number;
  };
  events: string[]; // MOD-B08 instrument events (conversion, payoff)
}

const EPS = 1e-6;

export function regulatoryBurden(tGov: number, c: Config): number {
  const { regulatory_burden_base, regulatory_burden_halfsat } = c.finance;
  return regulatory_burden_base * (regulatory_burden_halfsat / (tGov + regulatory_burden_halfsat));
}

export function equityIssueCost(tInv: number, c: Config): number {
  const cost = c.finance.equity_issue_cost_base + c.finance.equity_issue_cost_tinv_k * Math.max(0, c.finance.tinv_ref - tInv);
  return Math.min(0.9, Math.max(0, cost));
}

export function buildStatements(input: FinanceInputs): FinanceOutput {
  const f = input.firm;
  const c = input.config;
  const cashBegin = f.cash;
  const debtBegin = f.debt;
  const paidBegin = f.paid_in_capital;
  const retainedBegin = f.retained_earnings;
  const ppeBegin = f.ppe_book;

  // --- Financing actions (§13 step 2) ---
  const issueCost = equityIssueCost(f.T_inv, c);
  const equityNet = Math.max(0, input.financing.equity_raise) * (1 - issueCost);
  const repay = Math.min(Math.max(0, input.financing.debt_repay), debtBegin);

  // Credit rationing: cap the new draw so post-financing leverage ≤ max_leverage.
  const equityAfter = paidBegin + equityNet + retainedBegin;
  const maxNewDebt = c.finance.max_leverage * Math.max(equityAfter, EPS);
  const requestedDraw = Math.max(0, input.financing.debt_draw);
  const allowedDraw = Math.max(0, maxNewDebt - (debtBegin - repay));
  const draw = Math.min(requestedDraw, allowedDraw);
  let creditRationed = draw < requestedDraw - EPS;

  const debtEff = debtBegin + draw - repay;

  // --- MOD-B08 financial instruments (convertible note + revenue-based financing) ---
  // Both fold into the balance-sheet debt line; their distinct pricing lives here.
  const fi = c.modules?.financialInstruments;
  const fiOn = !!fi?.enabled;
  const round = input.round ?? 0;
  const events: string[] = [];
  let conv = f.convertible_note ?? null;
  let rbfOut = Math.max(0, f.rbf_outstanding ?? 0);
  let rbfPrin = Math.max(0, f.rbf_principal ?? 0);
  let convDraw = 0;
  let rbfDraw = 0;
  let convInterest = 0;
  let rbfInterest = 0;
  let rbfPrinPaid = 0;
  let convRepaid = 0;
  let convConverted = 0;
  if (fiOn) {
    // Interest accrues on the note balance carried into the round.
    if (conv) convInterest = fi.convertible.rate * conv.principal;
    // RBF: pay a fixed slice of revenue until the obligation is cleared. The slice
    // splits into principal (debt amortization) and fee (interest expense).
    if (rbfOut > EPS) {
      const pay = Math.min(fi.rbf.payment_rate * Math.max(0, input.revenue), rbfOut);
      rbfPrinPaid = Math.min(rbfPrin, pay / fi.rbf.multiple);
      rbfInterest = pay - rbfPrinPaid;
      rbfOut -= pay;
      rbfPrin -= rbfPrinPaid;
      if (rbfOut <= EPS) {
        rbfOut = 0;
        rbfPrin = 0;
        events.push(`FINANCING: ${f.id} pays off its revenue-based financing`);
      }
    }
    // New draws (one instrument of each kind at a time).
    if (!conv && (input.instruments?.draw_convertible ?? 0) > 0) {
      convDraw = Math.min(Math.max(0, input.instruments!.draw_convertible), fi.convertible.max_equity_fraction * Math.max(equityAfter, 0));
      if (convDraw > EPS) conv = { principal: convDraw, drawn_round: round };
      else convDraw = 0;
    }
    if (rbfOut <= EPS && (input.instruments?.draw_rbf ?? 0) > 0) {
      rbfDraw = Math.min(Math.max(0, input.instruments!.draw_rbf), fi.rbf.max_revenue_fraction * Math.max(0, input.revenue));
      if (rbfDraw > EPS) {
        rbfOut = rbfDraw * fi.rbf.multiple;
        rbfPrin = rbfDraw;
      } else rbfDraw = 0;
    }
  }

  // --- Operating result ---
  const gross = input.revenue - input.cogs;
  const spoilage = Math.max(0, input.spoilage ?? 0); // inventory write-off
  const invBegin = Math.max(0, input.inventoryValueBegin ?? 0);
  const invEnd = Math.max(0, input.inventoryValueEnd ?? 0);
  const deltaInventory = invEnd - invBegin; // working-capital change (0 in legacy mode)
  const opex =
    Math.max(0, input.invest.Q) +
    Math.max(0, input.invest.B) +
    Math.max(0, input.invest.T_emp) +
    Math.max(0, input.invest.T_inv) +
    Math.max(0, input.invest.T_gov) +
    Math.max(0, input.invest.process) +
    c.finance.fixed_overhead +
    c.capacity.fixed_cost_per_unit * f.cap +
    regulatoryBurden(f.T_gov, c) * (1 - Math.min(1, Math.max(0, input.regBurdenReduction ?? 0))) +
    Math.max(0, input.extraOpex);
  const depreciation = c.capacity.depreciation * ppeBegin;
  const ebit = gross - opex - spoilage - depreciation;

  // --- Endogenous cost of capital (§7.4) — leverage counts ALL debt-like balances ---
  const instrDebtNow = (conv?.principal ?? 0) + rbfPrin;
  const leverage = (debtEff + instrDebtNow) / Math.max(equityAfter, EPS);
  let spread =
    c.finance.base_spread +
    c.finance.spread_leverage_k * Math.max(0, leverage - c.finance.leverage_ref) -
    c.finance.spread_tinv_k * (f.T_inv - c.finance.tinv_ref) -
    Math.max(0, input.spreadReduction ?? 0); // MOD-B10 reputation discount
  spread = Math.max(0, spread);
  let rDebt = c.finance.r_f + spread;
  let interest = rDebt * debtEff + convInterest + rbfInterest;
  let coverage = interest > EPS ? ebit / interest : ebit >= 0 ? 999 : 0;
  if (coverage < c.finance.coverage_threshold) {
    rDebt += c.finance.coverage_penalty_spread; // punitive reprice (bank debt only)
    interest = rDebt * debtEff + convInterest + rbfInterest;
    coverage = interest > EPS ? ebit / interest : ebit >= 0 ? 999 : 0;
    creditRationed = true;
  }

  const netIncome = ebit - interest;

  // --- Convertible maturity (MOD-B08): repay if the cash is there, else convert ---
  const cashPreMaturity =
    cashBegin + (netIncome + depreciation - deltaInventory) - Math.max(0, input.invest.cap) +
    (draw - repay + equityNet) + convDraw + rbfDraw - rbfPrinPaid;
  if (fiOn && conv && convDraw === 0 && round >= conv.drawn_round + fi.convertible.term) {
    if (cashPreMaturity >= conv.principal) {
      convRepaid = conv.principal;
      events.push(`FINANCING: ${f.id} repays its convertible note at maturity`);
    } else {
      convConverted = conv.principal;
      events.push(`DILUTION: ${f.id}'s convertible note converts to equity at maturity`);
    }
    conv = null;
  }

  // --- Dividend (capped by available cash; cash tied up in new stock isn't available) ---
  const cashPreDividend = cashPreMaturity - convRepaid;
  const dividend = Math.min(Math.max(0, input.financing.dividend), c.finance.dividend_max_fraction * Math.max(0, cashPreDividend));

  // --- Cash flow (operating subtracts ΔInventory; = 0 in legacy mode) ---
  const operating = netIncome + depreciation - deltaInventory;
  const investing = -Math.max(0, input.invest.cap);
  const financing = draw - repay + equityNet - dividend + convDraw + rbfDraw - rbfPrinPaid - convRepaid;
  const cashHit = Math.max(0, input.cashHit);
  const deltaCash = operating + investing + financing - cashHit;
  const cashNext = cashBegin + deltaCash;

  // --- Balance sheet update ---
  const debtNext = debtEff; // bank debt carried in firm state
  const instrDebtNext = (conv?.principal ?? 0) + rbfPrin; // instrument balances (also debt)
  const debtTotal = debtNext + instrDebtNext; // the balance-sheet debt line
  const paidNext = paidBegin + equityNet + convConverted; // conversion = debt → equity
  // The shock cash hit is an extraordinary loss → flows through retained earnings
  // so the balance sheet stays balanced (Assets fell by cashHit; Equity must too).
  const retainedNext = retainedBegin + netIncome - dividend - cashHit;
  const ppeNext = ppeBegin + Math.max(0, input.invest.cap) - depreciation;

  const assets = cashNext + ppeNext + invEnd;
  const equity = paidNext + retainedNext;

  // --- Invariants (§7.2) ---
  if (Math.abs(assets - (debtTotal + equity)) > 1e-3) {
    throw new InvariantError(
      `Balance sheet does not balance for ${f.id}: assets=${assets.toFixed(4)} vs L+E=${(debtTotal + equity).toFixed(4)}`,
    );
  }
  if (Math.abs(cashNext - cashBegin - deltaCash) > 1e-6) {
    throw new InvariantError(`Cash flow does not reconcile for ${f.id}`);
  }

  return {
    pnl: { revenue: input.revenue, cogs: input.cogs, gross, opex, spoilage, depreciation, ebit, interest, net_income: netIncome },
    balance_sheet: { cash: cashNext, ppe: ppeNext, inventory: invEnd, assets, debt: debtTotal, paid_in: paidNext, retained: retainedNext, equity },
    cash_flow: { operating, investing, financing, delta_cash: deltaCash },
    cost_of_capital: { r_debt: rDebt, coverage, leverage, credit_rationed: creditRationed },
    next: {
      cash: cashNext, debt: debtNext, paid_in_capital: paidNext, retained_earnings: retainedNext, ppe_book: ppeNext,
      convertible_note: conv, rbf_outstanding: rbfOut, rbf_principal: rbfPrin,
    },
    events,
  };
}

/** Firm valuation for the investor path (§7.5). */
export function firmValuation(f: FirmState, c: Config): number {
  const netAssets = f.cash + f.ppe_book - f.debt; // = book equity
  const window = Math.max(1, c.finance.valuation.normalization_window);
  const recent = f.ni_history.slice(-window);
  const normEarnings = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const pw = c.finance.valuation.premium_weights;
  const premium =
    pw.Q * f.Q + pw.B * f.B + pw.T_emp * f.T_emp + pw.T_inv * f.T_inv + pw.T_gov * f.T_gov + pw.cap * f.cap + pw.process * f.process;
  return netAssets + c.finance.valuation.multiple * normEarnings + premium;
}

/** Keys used by the valuation premium (kept here to stay in sync with the type). */
export const PREMIUM_KEYS: StockKey[] = ["cap", "Q", "B", "T_emp", "T_inv", "T_gov", "process"];
