/**
 * DW-070 statement line labels — one vocabulary for the student Statements page and the
 * instructor's itemized team view. Keys = engine OPEX_LINE_KEYS / CF_LINE_KEYS / debt_lines;
 * the six spending levers read from labels.ts STOCK_LABEL. (Moved out of Statements.tsx unchanged.)
 */
import { STOCK_LABEL } from "../labels.js";

export const OPEX_LINE_LABEL: Record<string, string> = {
  quality: STOCK_LABEL.Q, brand: STOCK_LABEL.B, community: STOCK_LABEL.T_emp, investor_relations: STOCK_LABEL.T_inv,
  regulator_relations: STOCK_LABEL.T_gov, operations: STOCK_LABEL.process,
  overhead: "Fixed overhead", tank_upkeep: "Tank upkeep", regulatory: "Regulatory compliance",
  facilities: "Facilities: rent, upkeep, parcels", staff: "Staff wages & signing", key_hires: "Key people: salaries & signing",
  distribution: "Distribution & market entry", pr_events: "PR events", sustainability: "Water efficiency",
  public_goods: "Industry contributions", rnd: "R&D", lobbying: "Lobbying", alliances: "Alliance costs & penalties",
  market_research: "Market research", inventory_holding: "Inventory holding", conduct_fines: "Consumer-protection fines",
  other: "Other programs",
};

export const DEBT_LINE_LABEL: Record<string, string> = { bank: "Bank loan", convertible: "Convertible note", rbf: "Revenue-based financing" };

export const CF_LINE_LABEL: Record<"operating" | "investing" | "financing" | "post_close", Record<string, string>> = {
  operating: { net_income: "Net income", depreciation: "Add back depreciation", inventory_change: "Cash tied up in inventory" },
  investing: { tanks: "New tanks", facilities: "Facilities built", vertical_assets: "Suppliers & distributors bought", capex: "Capital spending", divestment: "Facilities sold" },
  financing: {
    debt_draw: "New borrowing", debt_repay: "Debt repaid", equity: "Equity raised", dividends: "Dividends paid",
    convertible_draw: "Convertible note", convertible_repaid: "Convertible note repaid", rbf_draw: "Revenue-based financing", rbf_repaid: "Revenue-based financing repaid",
  },
  // DW-076: cash that moved after this quarter's books closed (M&A settlement, exit / rebuild).
  post_close: {
    acquisition_paid: "Paid to acquire a rival", acquired_cash: "Cash taken on with the acquired firm", sold_to_acquirer: "Cash transferred to the acquirer",
    rebuild_fresh_capital: "Fresh start: books reset", rebuild_reentry_cost: "Re-entry cost",
  },
};
