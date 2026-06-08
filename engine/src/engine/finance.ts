/**
 * Finance layer (§7): derived three statements, endogenous cost of capital
 * (§7.4), and firm valuation (§7.5). The two invariants (§7.2) — balance sheet
 * balances, and cash-flow reconciles to ΔCash — are enforced here and double as
 * engine self-checks. Working-capital change is zero in v1 (all-cash sales, no
 * inventory carried), which makes both identities hold exactly.
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
  extraOpex: number; // §11 formation / breach costs
  cashHit: number; // §9 direct shock damage (resilience-mitigated)
  config: Config;
}

export interface FinanceOutput {
  pnl: PnL;
  balance_sheet: BalanceSheet;
  cash_flow: CashFlow;
  cost_of_capital: { r_debt: number; coverage: number; leverage: number; credit_rationed: boolean };
  next: { cash: number; debt: number; paid_in_capital: number; retained_earnings: number; ppe_book: number };
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

  // --- Operating result ---
  const gross = input.revenue - input.cogs;
  const opex =
    Math.max(0, input.invest.Q) +
    Math.max(0, input.invest.B) +
    Math.max(0, input.invest.T_emp) +
    Math.max(0, input.invest.T_inv) +
    Math.max(0, input.invest.T_gov) +
    Math.max(0, input.invest.process) +
    c.finance.fixed_overhead +
    c.capacity.fixed_cost_per_unit * f.cap +
    regulatoryBurden(f.T_gov, c) +
    Math.max(0, input.extraOpex);
  const depreciation = c.capacity.depreciation * ppeBegin;
  const ebit = gross - opex - depreciation;

  // --- Endogenous cost of capital (§7.4) ---
  const leverage = debtEff / Math.max(equityAfter, EPS);
  let spread =
    c.finance.base_spread +
    c.finance.spread_leverage_k * Math.max(0, leverage - c.finance.leverage_ref) -
    c.finance.spread_tinv_k * (f.T_inv - c.finance.tinv_ref);
  spread = Math.max(0, spread);
  let rDebt = c.finance.r_f + spread;
  let interest = rDebt * debtEff;
  let coverage = interest > EPS ? ebit / interest : ebit >= 0 ? 999 : 0;
  if (coverage < c.finance.coverage_threshold) {
    rDebt += c.finance.coverage_penalty_spread; // punitive reprice
    interest = rDebt * debtEff;
    coverage = interest > EPS ? ebit / interest : ebit >= 0 ? 999 : 0;
    creditRationed = true;
  }

  const netIncome = ebit - interest;

  // --- Dividend (capped by available cash) ---
  const cashPreDividend = cashBegin + (netIncome + depreciation) + (-Math.max(0, input.invest.cap)) + (draw - repay + equityNet);
  const dividend = Math.min(Math.max(0, input.financing.dividend), c.finance.dividend_max_fraction * Math.max(0, cashPreDividend));

  // --- Cash flow (ΔWC = 0) ---
  const operating = netIncome + depreciation;
  const investing = -Math.max(0, input.invest.cap);
  const financing = draw - repay + equityNet - dividend;
  const cashHit = Math.max(0, input.cashHit);
  const deltaCash = operating + investing + financing - cashHit;
  const cashNext = cashBegin + deltaCash;

  // --- Balance sheet update ---
  const debtNext = debtEff;
  const paidNext = paidBegin + equityNet;
  // The shock cash hit is an extraordinary loss → flows through retained earnings
  // so the balance sheet stays balanced (Assets fell by cashHit; Equity must too).
  const retainedNext = retainedBegin + netIncome - dividend - cashHit;
  const ppeNext = ppeBegin + Math.max(0, input.invest.cap) - depreciation;

  const assets = cashNext + ppeNext;
  const equity = paidNext + retainedNext;

  // --- Invariants (§7.2) ---
  if (Math.abs(assets - (debtNext + equity)) > 1e-3) {
    throw new InvariantError(
      `Balance sheet does not balance for ${f.id}: assets=${assets.toFixed(4)} vs L+E=${(debtNext + equity).toFixed(4)}`,
    );
  }
  if (Math.abs(cashNext - cashBegin - deltaCash) > 1e-6) {
    throw new InvariantError(`Cash flow does not reconcile for ${f.id}`);
  }

  return {
    pnl: { revenue: input.revenue, cogs: input.cogs, gross, opex, depreciation, ebit, interest, net_income: netIncome },
    balance_sheet: { cash: cashNext, ppe: ppeNext, assets, debt: debtNext, paid_in: paidNext, retained: retainedNext, equity },
    cash_flow: { operating, investing, financing, delta_cash: deltaCash },
    cost_of_capital: { r_debt: rDebt, coverage, leverage, credit_rationed: creditRationed },
    next: { cash: cashNext, debt: debtNext, paid_in_capital: paidNext, retained_earnings: retainedNext, ppe_book: ppeNext },
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
