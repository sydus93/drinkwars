/**
 * Calls read-out (DW-074; DW-077 verdicts) — the instructor's view of the calls channel: who
 * called what this round, how past calls settled (NAILED / CLOSE / MISSED), and each seat's and
 * team's record ("hits of settled"). Renders nothing and requests nothing unless the game was
 * created with calls on (`enabled` is read off the dashboard payload, which carries `forecasts`
 * only for such games).
 */
import { useCallback, useEffect, useState } from "react";
import type { InstructorForecasts, Verdict } from "drinkwars-server";
import type { InstructorClient } from "../game/multiplayer.js";
import { Button, Card, Eyebrow } from "./ui.js";
import { VERDICT_COLOR, VERDICT_LABEL, recordText } from "./Calls.js";

const SEAT: Record<string, string> = { ceo: "CEO", cfo: "CFO", cmo: "CMO", coo: "COO", chro: "CHRO" };
const KIND: Record<string, string> = { team_rank: "Team rank", gross_margin: "Gross margin", rival_price: "Rival's price", own_share: "Shopper share" };

function VerdictTag({ v }: { v: Verdict | null }) {
  if (!v) return <span className="text-inksoft">—</span>;
  return <span className="rounded-[5px] px-2 py-0.5 font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em]" style={{ background: VERDICT_COLOR[v], color: "var(--color-paper)" }}>{VERDICT_LABEL[v]}</span>;
}

export function CallsReadout({ client, gameId, roundKey, enabled, colorByFirm, nameByFirm }: { client: InstructorClient; gameId: string; roundKey: string; enabled: boolean; colorByFirm: Map<string, string>; nameByFirm: Map<string, string> }) {
  const [v, setV] = useState<InstructorForecasts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [round, setRound] = useState<number | null>(null); // null = follow the latest round with calls
  const load = useCallback(async () => {
    try { setV(await client.forecasts(gameId)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [client, gameId]);
  useEffect(() => { if (enabled) void load(); }, [enabled, load, roundKey]);

  if (!enabled) return null;
  const calls = v?.calls ?? [];
  const rounds = [...new Set(calls.map((c) => c.round))].sort((a, b) => a - b);
  const shown = round ?? rounds.at(-1) ?? v?.round ?? 0;
  const label = (c: (typeof calls)[number]) => (c.item === "rival_price" ? `${nameByFirm.get(c.target ?? "") ?? c.targetName ?? "Rival"}'s price` : KIND[c.item] ?? c.item);

  return (
    <Card>
      <Eyebrow>Calls · forecast commitment</Eyebrow>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-base text-inksoft">
        <span>What each chair called before lock, and how it settled. The record counts NAILED and CLOSE as hits of settled calls (close = within 2 margin points or one rank place). Never touches the season score.</span>
        <span className="flex-1" />
        <Button onClick={load}>Refresh</Button>
      </div>
      {err && <div className="mb-2 text-base text-brick">{err}</div>}
      {!v ? <div className="text-base text-inksoft">Loading…</div> : (
        <div className="grid gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="text-left font-mono text-xs uppercase tracking-[0.08em] text-inksoft">
                  <th className="py-1 pr-3">Team</th><th className="py-1 pr-3">Record</th><th className="py-1 pr-3">Calls made</th><th className="py-1 pr-3">Chairs · filled this round · record</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {(v.teams ?? []).filter((t) => t.seats.length > 0).map((t) => (
                  <tr key={t.teamId} className="border-t border-line align-top">
                    <td className="py-1 pr-3"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: colorByFirm.get(t.firmId) ?? "var(--color-inksoft)" }} />{nameByFirm.get(t.firmId) ?? t.name}</td>
                    <td className="py-1 pr-3 font-semibold">{recordText(t.calibration)}</td>
                    <td className="py-1 pr-3">{t.calibration.calls}</td>
                    <td className="py-1 pr-3">
                      {t.seats.map((s) => (
                        <span key={s.userId} className={`mr-2 inline-block rounded-[2px] border px-1.5 py-0.5 ${s.calledThisRound ? "border-hop" : "border-line2 text-inksoft"}`}>
                          <b className="font-mono">{SEAT[s.role ?? ""] ?? "—"}</b> {s.name ?? "Player"} · {s.calledThisRound} · {recordText(s.calibration)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rounds.length > 0 && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-base">
                <span className="font-mono text-xs uppercase tracking-[0.08em] text-inksoft">Round</span>
                {rounds.map((r) => (
                  <button key={r} onClick={() => setRound(r)} aria-pressed={r === shown} className={`rounded-md border px-2 py-0.5 ${r === shown ? "border-copper bg-copper/10 font-semibold text-copperdeep" : "border-line2 text-inksoft"}`}>{r + 1}</button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr className="text-left font-mono text-xs uppercase tracking-[0.08em] text-inksoft">
                      <th className="py-1 pr-3">Team</th><th className="py-1 pr-3">Chair</th><th className="py-1 pr-3">Call</th><th className="py-1 pr-3">Called</th><th className="py-1 pr-3">Came in</th><th className="py-1 pr-3">Verdict</th><th className="py-1 pr-3">Why</th>
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {calls.filter((c) => c.round === shown).map((c) => (
                      <tr key={`${c.userId}:${c.item}`} className="border-t border-line">
                        <td className="py-1 pr-3">{nameByFirm.get(c.firmId) ?? c.firmId}</td>
                        <td className="py-1 pr-3"><b className="font-mono">{SEAT[c.role ?? ""] ?? "—"}</b> {c.name ?? ""}</td>
                        <td className="py-1 pr-3">{label(c)}</td>
                        <td className="py-1 pr-3 font-semibold">{c.valueLabel}</td>
                        <td className="py-1 pr-3">{c.realizedLabel ?? <span className="text-inksoft">{v.round === c.round && v.lifecycle !== "complete" ? "pending" : "n/a"}</span>}</td>
                        <td className="py-1 pr-3"><VerdictTag v={c.verdict} /></td>
                        <td className="py-1 pr-3 text-inksoft">{c.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {rounds.length === 0 && <div className="text-base text-inksoft">No chair has filled a ticket yet.</div>}
        </div>
      )}
    </Card>
  );
}
