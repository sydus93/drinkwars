/**
 * DW-070 on the instructor side — one team's statements opened into their line items, round by
 * round, against the field. Built for the question Sprint 1 could not answer at the projector:
 * "where did this team's cash go?" (one firm's operating expense doubled in a round and nobody,
 * the team included, could see which line did it).
 *
 * Reads the dashboard panel rows as they are (opex / opexLines / cfLines / debtLines, DW-070).
 * A section total with no lines that round was resolved before the engine itemized: it prints
 * "·" and the card says so. Lines that are zero in every round are hidden. The field median is
 * across every firm still trading that round — instructor-only, so rival figures are fair here.
 */
import { CF_LINE_KEYS, OPEX_LINE_KEYS } from "drinkwars-engine";
import type { DashPanelRow } from "drinkwars-server";
import { fmt } from "../labels.js";
import { CF_LINE_LABEL, DEBT_LINE_LABEL, OPEX_LINE_LABEL } from "../lib/statementLabels.js";
import { Card, Eyebrow } from "./ui.js";

type Lines = Partial<Record<string, number>> | undefined;
interface Section {
  id: string; label: string; open?: boolean;
  /** which direction of change is good news (colours Δ) */
  good: "up" | "down" | null;
  order: readonly string[]; names: Record<string, string>;
  lines: (p: DashPanelRow) => Lines;
  /** the section total; defaults to the sum of its lines (the engine's own invariant) */
  total?: (p: DashPanelRow) => number;
}

const sum = (l: Lines) => Object.values(l ?? {}).reduce((a: number, b) => a + (b ?? 0), 0);
const cf = (sec: keyof typeof CF_LINE_KEYS) => (p: DashPanelRow): Lines => p.cfLines?.[sec];
const SECTIONS: Section[] = [
  { id: "opex", label: "Operating expense", open: true, good: "down", order: OPEX_LINE_KEYS, names: OPEX_LINE_LABEL, lines: (p) => p.opexLines, total: (p) => p.opex },
  { id: "cfOp", label: "Cash from operations", good: "up", order: CF_LINE_KEYS.operating, names: CF_LINE_LABEL.operating, lines: cf("operating") },
  { id: "cfInv", label: "Cash from investing", good: null, order: CF_LINE_KEYS.investing, names: CF_LINE_LABEL.investing, lines: cf("investing") },
  { id: "cfFin", label: "Cash from financing", good: null, order: CF_LINE_KEYS.financing, names: CF_LINE_LABEL.financing, lines: cf("financing") },
  { id: "cfOther", label: "Shock & other cash", good: "up", order: CF_LINE_KEYS.other, names: { shock: "Shock damage" }, lines: cf("other") },
  // DW-076: moves after the books closed (M&A settlement, rebuild) — the bridge from closing to next opening cash.
  { id: "cfPost", label: "After the books closed (M&A, rebuild)", good: null, order: CF_LINE_KEYS.post_close, names: CF_LINE_LABEL.post_close, lines: cf("post_close") },
  { id: "debt", label: "Debt outstanding", good: "down", order: ["bank", "convertible", "rbf"], names: DEBT_LINE_LABEL, lines: (p) => p.debtLines, total: (p) => p.debt },
];

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const money = (n: number | null | undefined) => (n == null ? "·" : Math.abs(n) < 0.5 ? "—" : n < 0 ? `−${fmt.money(-n)}` : fmt.money(n));

export function TeamItemized({ rows, field, color }: { rows: DashPanelRow[]; field: DashPanelRow[]; color: string }) {
  if (!rows.length) return null;
  const rounds = rows.map((r) => r.round);
  const last = rows.at(-1)!, prev = rows.at(-2);
  // The field, per round: every firm still trading (this team included — a median, not a rival list).
  const fieldAt = new Map<number, DashPanelRow[]>();
  for (const p of field) if (p.status === "active") fieldAt.set(p.round, [...(fieldAt.get(p.round) ?? []), p]);
  const legacy = rows.some((r) => !r.opexLines);

  const delta = (a: number | null, b: number | null, good: Section["good"]) => {
    if (a == null || b == null || Math.abs(a - b) < 0.5) return <span className="text-inksoft">—</span>;
    const up = a > b;
    const tone = good == null ? "text-inksoft" : (good === "up") === up ? "text-hop" : "text-brick";
    return <span className={tone}>{fmt.signed(a - b)}</span>;
  };

  return (
    <Card>
      <Eyebrow>Itemized statements · where the money went</Eyebrow>
      <div className="mb-2 text-sm text-inksoft">
        Each total opens into the lines that make it up, round by round. <b>Field</b> is the median across every brewery still trading in the latest round; a figure in <span className="font-semibold text-brick">red</span> is more than 1.5× it.
        {legacy && <> Rounds marked “·” were resolved before statements were itemized; only the total exists.</>}
      </div>
      <div className="grid gap-2">
        {SECTIONS.map((sec) => {
          const itemized = rows.map((r) => sec.lines(r));
          const totalOf = (p: DashPanelRow): number | null => (sec.total ? sec.total(p) : sec.lines(p) ? sum(sec.lines(p)) : null);
          const keys = sec.order.filter((k) => itemized.some((l) => Math.abs(l?.[k] ?? 0) >= 0.5));
          const totals = rows.map(totalOf);
          if (!keys.length && totals.every((t) => t == null || Math.abs(t) < 0.5)) return null;
          const fieldLast = fieldAt.get(last.round) ?? [];
          const fieldTotal = (round: number) => median((fieldAt.get(round) ?? []).map(totalOf).filter((x): x is number => x != null));
          const fieldLine = (k: string) => median(fieldLast.filter((p) => sec.lines(p)).map((p) => sec.lines(p)?.[k] ?? 0));
          const gap = (mine: number | null, f: number | null) => (mine != null && f != null && Math.abs(f) >= 1 && Math.abs(mine) > 1.5 * Math.abs(f) && Math.abs(mine - f) >= 5_000);
          return (
            <details key={sec.id} open={sec.open} className="rounded-[4px] border border-line">
              <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm">
                <span className="font-semibold text-ink">{sec.label}</span>
                <span className="tnum text-ink">{money(totals.at(-1))}</span>
                <span className="tnum text-xs">{delta(totals.at(-1) ?? null, prev ? totalOf(prev) : null, sec.good)} <span className="text-inksoft">vs last round</span></span>
                <span className="tnum text-xs text-inksoft">field {money(fieldTotal(last.round))}</span>
              </summary>
              <div className="overflow-x-auto px-3 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                      <th className="py-1 pr-2 text-left">Line</th>
                      {rounds.map((r) => <th key={r} className="py-1 pr-2">R{r + 1}</th>)}
                      <th className="py-1 pr-2">Δ</th>
                      <th className="py-1">Field R{last.round + 1}</th>
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {keys.map((k) => {
                      const mine = itemized.at(-1)?.[k] ?? (itemized.at(-1) ? 0 : null);
                      const before = prev ? (sec.lines(prev) ? sec.lines(prev)?.[k] ?? 0 : null) : null;
                      const f = fieldLine(k);
                      return (
                        <tr key={k} className="border-t border-line text-right">
                          <td className="py-1 pr-2 text-left text-inksoft">{sec.names[k] ?? k}</td>
                          {itemized.map((l, i) => <td key={rounds[i]} className={`py-1 pr-2 ${i === itemized.length - 1 && gap(mine, f) ? "font-semibold text-brick" : ""}`} title={i === itemized.length - 1 && gap(mine, f) ? "More than 1.5× the field median" : undefined}>{money(l ? l[k] ?? 0 : null)}</td>)}
                          <td className="py-1 pr-2">{delta(mine, before, sec.good)}</td>
                          <td className="py-1 text-inksoft">{money(f)}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-line2 text-right font-semibold">
                      <td className="py-1 pr-2 text-left"><span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />Total</td>
                      {totals.map((t, i) => <td key={rounds[i]} className="py-1 pr-2">{money(t)}</td>)}
                      <td className="py-1 pr-2">{delta(totals.at(-1) ?? null, prev ? totalOf(prev) : null, sec.good)}</td>
                      <td className="py-1 text-inksoft">{money(fieldTotal(last.round))}</td>
                    </tr>
                    <tr className="text-right text-inksoft">
                      <td className="py-1 pr-2 text-left">Field median</td>
                      {rounds.map((r) => <td key={r} className="py-1 pr-2">{money(fieldTotal(r))}</td>)}
                      <td className="py-1 pr-2" />
                      <td className="py-1" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </Card>
  );
}
