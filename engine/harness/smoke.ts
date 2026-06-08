/**
 * Smoke test: run one full game with the baseline archetype assignment and print
 * a per-round summary. If buildStatements' invariants (§7.2) ever break, this
 * throws — so a clean completion is itself an invariant check across a full game.
 */
import { runGame } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import { BASELINE_ASSIGNMENT, makeProvider } from "./archetypes.js";

const config = loadConfig();
const provider = makeProvider(BASELINE_ASSIGNMENT);
const { history, finalWorld } = runGame(config, provider);

console.log(`Drink Wars smoke run — ${config.game.n_firms} firms, ${config.game.n_rounds} rounds, seed ${config.game.seed}\n`);

for (const r of history) {
  const active = r.firm_results.length;
  const totalQ = r.market.reduce((a, m) => a + m.total_q, 0);
  const totalRev = r.firm_results.reduce((a, f) => a + f.pnl.revenue, 0);
  const totalNI = r.firm_results.reduce((a, f) => a + f.pnl.net_income, 0);
  const minCash = Math.min(...r.firm_results.map((f) => f.balance_sheet.cash));
  const segStr = r.market.filter((m) => m.active).map((m) => `${m.segment}:D${m.D.toFixed(0)}/q${m.total_q.toFixed(0)}`).join(" ");
  console.log(
    `R${String(r.round).padStart(2)} | firms ${active} | q ${totalQ.toFixed(0).padStart(4)} | rev ${totalRev.toFixed(0).padStart(5)} | ΣNI ${totalNI.toFixed(0).padStart(6)} | minCash ${minCash.toFixed(0).padStart(6)} | ${segStr}` +
      (r.events.length ? `\n        events: ${r.events.join("; ")}` : ""),
  );
}

console.log("\nFinal standings (cumulative scorecard):");
const last = history[history.length - 1];
const ranked = [...last.firm_results].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
for (const f of ranked) {
  const fw = finalWorld.firms.find((x) => x.id === f.firm_id)!;
  console.log(
    `  ${f.firm_id.padEnd(8)} score ${f.scorecard_cumulative.toFixed(3).padStart(7)} | ${fw.status.padEnd(14)} | cash ${fw.cash.toFixed(0).padStart(6)} | equity ${f.balance_sheet.equity.toFixed(0).padStart(6)} | Q ${fw.Q.toFixed(1)} B ${fw.B.toFixed(1)} | maha ${(f.distinctiveness?.mahalanobis ?? 0).toFixed(2)}`,
  );
}

const bankrupt = finalWorld.firms.filter((f) => f.status === "bankrupt").length;
console.log(`\nBankruptcies: ${bankrupt}/${config.game.n_firms}. Frontier active: ${finalWorld.segments.find((s) => s.id === "frontier")?.active}.`);
