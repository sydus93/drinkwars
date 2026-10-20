/**
 * DW-072 #6 — the instructor's field view of demand, across every resolved round.
 *
 * One category at a time: who charged what, how good and how known each firm was, and what
 * share of shoppers that bought them — scrubbable round by round, with the whole season as
 * small multiples underneath. Read-only over the dashboard payload (DW-067 fields; older
 * exports simply lack the Wanted / pull columns). Sized to project: body text ≥ 16px.
 */
import { useState } from "react";
import type { DashPanelRow, InstructorDashboard as DashData } from "drinkwars-server";
import { Card, Eyebrow } from "./ui.js";
import { Scatter, type ScatterPoint } from "./charts.js";
import { SEG_LABEL, fmt } from "../labels.js";

const PULL_TERMS = ["price", "quality", "brand", "fit", "other"] as const;

/** Rows serving `seg` in round `r` (firms that priced or sold there). NOT filtered on status:
 *  status is post-round, so a firm that sold all quarter and went bankrupt at its close would
 *  vanish from the very round its shoppers were real (and the shares shown would not add up). */
function serving(panel: DashPanelRow[], seg: string, r: number): DashPanelRow[] {
  return panel.filter((p) => p.round === r && p.segments[seg] && (p.segments[seg].price > 0 || p.segments[seg].q_sold > 0));
}

/** Multi-firm line chart over rounds that tolerates gaps (a firm not serving that round) and
 *  marks the scrubbed round. One y-axis, min/max printed at the corners. */
function TrendMini({ title, rounds, lines, at, fmtY }: { title: string; rounds: number[]; lines: { color: string; label: string; data: (number | null)[] }[]; at: number; fmtY: (n: number) => string }) {
  const W = 300, H = 120, PL = 6, PR = 6, PT = 18, PB = 16;
  const all = lines.flatMap((l) => l.data).filter((v): v is number => v != null && Number.isFinite(v));
  if (!all.length || rounds.length === 0) return null;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const n = rounds.length;
  const x = (i: number) => PL + (n <= 1 ? (W - PL - PR) / 2 : (i / (n - 1)) * (W - PL - PR));
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
  const atI = rounds.indexOf(at);
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-sm font-semibold text-ink">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title} by round`}>
        {atI >= 0 && <line x1={x(atI)} x2={x(atI)} y1={PT - 4} y2={H - PB} stroke="var(--color-copper)" strokeWidth="1.5" strokeDasharray="3 3" />}
        {lines.map((l) => {
          // Break the polyline wherever the firm was absent.
          const segs: string[][] = [];
          let cur: string[] = [];
          l.data.forEach((v, i) => {
            if (v == null || !Number.isFinite(v)) { if (cur.length) segs.push(cur); cur = []; return; }
            cur.push(`${x(i)},${y(v)}`);
          });
          if (cur.length) segs.push(cur);
          return (
            <g key={l.label}>
              {segs.map((s, i) => (s.length > 1 ? <polyline key={i} points={s.join(" ")} fill="none" stroke={l.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" /> : null))}
              {atI >= 0 && l.data[atI] != null && <circle cx={x(atI)} cy={y(l.data[atI]!)} r="3.4" fill={l.color} />}
            </g>
          );
        })}
        <text x={PL} y={11} fontSize="11" fill="var(--color-inksoft)" fontFamily="var(--font-body)">{fmtY(hi)}</text>
        <text x={PL} y={H - 3} fontSize="11" fill="var(--color-inksoft)" fontFamily="var(--font-body)">{fmtY(lo)}</text>
        <text x={W - PR} y={H - 3} fontSize="11" textAnchor="end" fill="var(--color-inksoft)" fontFamily="var(--font-body)">R1–R{rounds[rounds.length - 1] + 1}</text>
      </svg>
    </div>
  );
}

export function FieldDemandCard({ data, colorByFirm, nameByFirm }: { data: DashData; colorByFirm: Map<string, string>; nameByFirm: Map<string, string> }) {
  const segIds = data.meta.segments.map((s) => s.id).filter((s) => data.panel.some((p) => p.segments[s] && (p.segments[s].price > 0 || p.segments[s].q_sold > 0)));
  const rounds = Array.from({ length: data.meta.resolvedRounds }, (_, i) => i);
  const last = rounds[rounds.length - 1] ?? 0;
  const [seg, setSeg] = useState<string>(segIds[0] ?? "mass");
  const [picked, setPicked] = useState<number | null>(null); // null = follow the latest round
  const r = picked == null ? last : Math.min(picked, last);
  if (!segIds.length || !rounds.length) return null;

  const rows = serving(data.panel, seg, r).sort((a, b) => b.segments[seg].share - a.segments[seg].share);
  const rich = rows.some((p) => p.segments[seg].q_desired != null);
  const hasPull = rows.filter((p) => p.segments[seg].pull).length >= 2;
  const avg = hasPull ? Object.fromEntries(PULL_TERMS.map((t) => [t, rows.reduce((a, p) => a + (p.segments[seg].pull?.[t] ?? 0), 0) / rows.length])) as Record<string, number> : null;
  const rel = (p: DashPanelRow) => (avg ? PULL_TERMS.reduce((a, t) => a + (p.segments[seg].pull?.[t] ?? 0) - avg[t], 0) : null);
  const mk = data.market.find((m) => m.round === r && m.segment === seg);
  const name = (f: string) => nameByFirm.get(f) ?? f;
  const color = (f: string) => colorByFirm.get(f) ?? "var(--color-inksoft)";

  const pts: ScatterPoint[] = rows.map((p) => ({ label: name(p.firmId), color: color(p.firmId), x: p.segments[seg].price, y: p.segments[seg].share, size: 4 + 6 * Math.min(1, p.Q / Math.max(1, ...rows.map((q) => q.Q))) }));

  // Season lines for the selected category: every firm that ever served it.
  const firms = [...new Set(data.panel.filter((p) => p.segments[seg] && (p.segments[seg].price > 0 || p.segments[seg].q_sold > 0)).map((p) => p.firmId))];
  const line = (get: (p: DashPanelRow) => number) => firms.map((f) => ({
    label: name(f), color: color(f),
    data: rounds.map((rr) => { const p = serving(data.panel, seg, rr).find((x) => x.firmId === f); return p ? get(p) : null; }),
  }));

  const btn = (on: boolean) => `rounded-[2px] border px-2.5 py-1 font-mono text-sm ${on ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:text-ink"}`;
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

  return (
    <Card>
      <Eyebrow>Field view · demand by category, round by round</Eyebrow>
      <div className="mb-3 text-base text-inksoft">
        Who charged what, how good and how known each brewery was, and the share of shoppers that bought them. Scrub the rounds to replay the season.
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
          {segIds.map((s) => <button key={s} className={btn(s === seg)} onClick={() => setSeg(s)}>{SEG_LABEL[s] ?? s}</button>)}
        </div>
        <div className="flex items-center gap-2">
          <button className={btn(false)} onClick={() => setPicked(Math.max(0, r - 1))} disabled={r <= 0} aria-label="Previous round">←</button>
          <input type="range" min={0} max={last} value={r} onChange={(e) => setPicked(Number(e.target.value))} aria-label="Round" className="w-40 accent-[var(--color-copper)]" />
          <button className={btn(false)} onClick={() => setPicked(r + 1 >= last ? null : r + 1)} disabled={r >= last} aria-label="Next round">→</button>
          <span className="tnum font-mono text-base font-semibold text-ink">Round {r + 1}</span>
          {picked != null && r !== last && <button className="text-sm text-copperdeep underline" onClick={() => setPicked(null)}>latest</button>}
        </div>
      </div>

      {mk && <div className="tnum mb-2 text-base text-inksoft">{SEG_LABEL[seg] ?? seg} · round {r + 1}: {fmt.int(mk.D)} drinkers · {fmt.int(mk.total_q)} served</div>}

      {rows.length === 0 ? (
        <div className="text-base text-inksoft">Nobody served this category in round {r + 1}.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <Scatter points={pts} xLabel="Price" yLabel="Shopper share" fmtX={fmt.price} fmtY={fmt.pct} />
            <div className="text-sm text-inksoft">Bigger dot = higher recipe quality. Up-and-right = charging more and still drawing shoppers.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="text-left font-mono text-xs uppercase tracking-[0.08em] text-inksoft">
                  <th className="py-1 pr-2">Firm</th>
                  <th className="py-1 pr-2 text-right">Price</th>
                  <th className="py-1 pr-2 text-right">Quality</th>
                  <th className="py-1 pr-2 text-right">Brand</th>
                  <th className="py-1 pr-2 text-right">Shoppers</th>
                  {rich && <th className="py-1 pr-2 text-right">Wanted</th>}
                  <th className="py-1 pr-2 text-right">Sold</th>
                  {hasPull && <th className="py-1 text-right" title="Total pull against the field average in this category: +0.1 ≈ 10% more shoppers">Pull vs field</th>}
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((p) => {
                  const sr = p.segments[seg];
                  const pv = rel(p);
                  const out = sr.q_desired != null && sr.q_desired > 0 && sr.q_sold < 0.97 * sr.q_desired;
                  return (
                    <tr key={p.firmId} className="border-t border-line">
                      <td className="py-1.5 pr-2"><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: color(p.firmId) }} />{name(p.firmId)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmt.price(sr.price)}</td>
                      <td className="py-1.5 pr-2 text-right">{p.Q.toFixed(0)}</td>
                      <td className="py-1.5 pr-2 text-right">{p.B.toFixed(0)}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold">{fmt.pct(sr.share)}</td>
                      {rich && <td className="py-1.5 pr-2 text-right">{sr.q_desired != null ? fmt.int(sr.q_desired) : "—"}</td>}
                      <td className={`py-1.5 pr-2 text-right ${out ? "font-semibold text-brick" : ""}`} title={out ? "sold out: shoppers wanted more than the tanks could pour" : ""}>{fmt.int(sr.q_sold)}</td>
                      {hasPull && (
                        <td className={`py-1.5 text-right ${pv != null && pv > 0.05 ? "text-hop" : pv != null && pv < -0.05 ? "text-brick" : "text-inksoft"}`}
                          title={sr.pull && avg ? PULL_TERMS.map((t) => `${t === "other" ? "alliances/location" : t} ${signed(sr.pull![t] - avg[t])}`).join(" · ") : ""}>
                          {pv != null ? signed(pv) : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-1 text-sm text-inksoft">Quality and brand are the firm's stocks (all categories). Sold in red = sold out. Hover a pull figure for its parts.</div>
          </div>
        </div>
      )}

      {rounds.length > 1 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TrendMini title="Price" rounds={rounds} at={r} fmtY={fmt.price} lines={line((p) => p.segments[seg].price)} />
          <TrendMini title="Shopper share" rounds={rounds} at={r} fmtY={fmt.pct} lines={line((p) => p.segments[seg].share)} />
          <TrendMini title="Quality" rounds={rounds} at={r} fmtY={(n) => n.toFixed(0)} lines={line((p) => p.Q)} />
          <TrendMini title="Brand" rounds={rounds} at={r} fmtY={(n) => n.toFixed(0)} lines={line((p) => p.B)} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {firms.map((f) => <span key={f} className="flex items-center gap-1.5 text-sm text-inksoft"><span className="inline-block h-0.5 w-4" style={{ background: color(f) }} />{name(f)}</span>)}
      </div>
    </Card>
  );
}
