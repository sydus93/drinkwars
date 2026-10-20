/**
 * DW-072 #5 — the instructor's live view of what every team has submitted this round: each
 * chair's slice, and the composed plan lock/resolve will run. Built because in Sprint 1 the
 * instructor could not see, mid-game, that firm 1's CEO entries were not landing.
 *
 * Which seat a composed value "came from" is the engine's precedence rule, not this panel's:
 * `engineWhoWins` reads the provenance out of composeTeamDecision (DW-073), the same function
 * the server merges with and the students' Reconcile card reads. Panel
 * callers get it by default (null = the standing plan, or a payload with no standing).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import { composeTeamDecision, DESK_LEVERS, ROLE_DESK, sameLever, seatTouched, type Composition, type SeatPartial } from "drinkwars-engine";
import type { InstructorTeamDecision, InstructorTeamDecisions, InstructorTeamSeat } from "drinkwars-server";
import type { InstructorClient } from "../game/multiplayer.js";
import { Button, Card, Eyebrow, Tag } from "./ui.js";
import { SEG_LABEL, fmt, marketName } from "../labels.js";
import { leverLabel, shareText } from "../lib/reconcile.js";

type Lever = keyof FirmDecision;

/** HOOK (DW-072 #1): the engine's single precedence function plugs in here. Return the index
 *  (into `seats`) of the seat whose value resolves for `lever`, or null for the standing plan. */
export type WhoWins = (lever: Lever, seats: InstructorTeamSeat[], composed: FirmDecision, standing: FirmDecision | null) => number | null;

/** DW-073: the engine's own provenance. Seats are re-merged once per payload (cached by array). */
const compCache = new WeakMap<InstructorTeamSeat[], { comp: Composition; idx: number[]; standing: FirmDecision | null } | null>();
export const engineWhoWins: WhoWins = (lever, seats, composed, standing) => {
  let hit = compCache.get(seats);
  if (hit === undefined || hit?.standing !== standing) {
    const idx: number[] = [];
    const parts: SeatPartial[] = [];
    seats.forEach((s, i) => {
      if (!s.submitted || !s.partial) return;
      idx.push(i);
      parts.push({ desk: (s.desk ?? (s.role ? ROLE_DESK[s.role] ?? "all" : "all")) as SeatPartial["desk"], partial: s.partial, updated_at: s.updatedAt, touched: s.touched });
    });
    hit = standing ? { comp: composeTeamDecision({ ...standing, firm_id: composed.firm_id }, parts), idx, standing } : null;
    compCache.set(seats, hit);
  }
  if (!hit) return null;
  const k = hit.comp.from[lever];
  return k === undefined ? null : hit.idx[k];
};

const DESKS: { id: keyof typeof DESK_LEVERS; label: string }[] = [
  { id: "commercial", label: "Marketing" },
  { id: "operations", label: "Operations" },
  { id: "people", label: "People" },
  { id: "finance", label: "Finance" },
  { id: "strategy", label: "Strategy" },
];
const DESK_OWNER: Record<string, string> = { commercial: "CMO", operations: "COO", people: "CHRO", finance: "CFO", strategy: "CEO" };
const SKIP = new Set<string>(["reflection", "beliefs"]); // free text / forecasts — not trading levers

/** Canonical JSON (sorted keys) so jsonb key order never reads as a difference. */
const canon = (v: unknown): string => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = sameLever; // the engine's equality (empties equal, cents equal)
const isSet = (v: unknown) => v !== undefined;

const MONEY = /^(invest_|debt_|equity_raise|dividend|lobby_spend|public_good)/;
function show(lever: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (lever === "run_rate") return fmt.pct(v);
    if (MONEY.test(lever)) return fmt.money(v);
    return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (Array.isArray(v)) return v.length === 0 ? "none" : `${v.length} item${v.length > 1 ? "s" : ""}`;
  if (typeof v === "object") {
    const ents = Object.entries(v as Record<string, unknown>);
    if (!ents.length) return "—";
    // capacity / market presence are relative weights (the engine normalises them) — show the split
    if (lever === "presence") return shareText(ents, (k) => SEG_LABEL[k] ?? k);
    if (lever === "market_presence") return shareText(ents, (k) => marketName(k));
    return ents.map(([k, x]) => `${SEG_LABEL[k] ?? marketName(k)} ${typeof x === "number" ? (lever === "price" ? fmt.price(x) : MONEY.test(lever) ? fmt.money(x) : x.toLocaleString("en-US", { maximumFractionDigits: 2 })) : canon(x)}`).join(" · ");
  }
  return String(v);
}
const roleTag = (s: InstructorTeamSeat) => (s.role ? s.role.toUpperCase() : "—");
const ago = (t: number | null) => {
  if (t == null) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

/** Default credit-by-value (provenance, not precedence): seats whose submitted value equals the composed one. */
function creditedByValue(lever: Lever, seats: InstructorTeamSeat[], composed: FirmDecision): number[] {
  return seats.map((s, i) => (s.submitted && s.partial && isSet(s.partial[lever]) && same(s.partial[lever], composed[lever]) ? i : -1)).filter((i) => i >= 0);
}

/** DW-074: did this chair CHANGE the lever this round (its own record; inferred against the
 *  standing plan for a slice stored without one)? */
const changed = (s: InstructorTeamSeat, l: Lever, standing: FirmDecision | null): boolean =>
  !!s.partial && (standing ? seatTouched({ partial: s.partial, touched: s.touched }, l, standing) : (s.touched?.includes(l as string) ?? true));
/** An entry a chair deliberately made that is NOT what will run — the Sprint-1 failure, made loud. */
const unused = (s: InstructorTeamSeat, l: Lever, t: InstructorTeamDecision): boolean =>
  !!t.composed && s.submitted && !!s.partial && s.partial[l] !== undefined && changed(s, l, t.standing) && !same(s.partial[l], t.composed[l]);
export const unusedEntries = (t: InstructorTeamDecision): number =>
  t.seats.reduce((n, s) => n + (Object.values(DESK_LEVERS).flat() as Lever[]).filter((l) => !SKIP.has(l as string) && unused(s, l, t)).length, 0);

function TeamCard({ t, color, name, whoWins, showAll }: { t: InstructorTeamDecision; color: string; name: string; whoWins?: WhoWins; showAll: boolean }) {
  const composed = t.composed;
  const nUnused = unusedEntries(t);
  const status = t.locked ? <Tag tone="copper">locked</Tag> : t.submitted ? <Tag tone="hop">submitted</Tag> : <Tag tone="ink">no decision yet</Tag>;
  const rows = DESKS.map((d) => ({
    desk: d,
    levers: (DESK_LEVERS[d.id] as Lever[]).filter((l) => !SKIP.has(l as string)).filter((l) => {
      if (showAll) return true;
      const touched = t.seats.some((s) => s.submitted && s.partial && isSet(s.partial[l]));
      const moved = composed && t.standing ? !same(composed[l], t.standing[l]) : false;
      return touched || moved;
    }),
  })).filter((x) => x.levers.length);

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
        <span className="text-lg font-semibold text-ink">{name}</span>
        {status}
        {nUnused > 0 && <span className="rounded-[2px] border border-brick bg-brick/10 px-2 py-0.5 text-sm font-semibold text-brick">{nUnused} entr{nUnused === 1 ? "y" : "ies"} entered but not used</span>}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {t.seats.length === 0 && <span className="text-base text-inksoft">No one seated — an NPC (when bot-fill is on) plays this firm at lock.</span>}
        {t.seats.map((s) => (
          <span key={s.userId} className={`rounded-[2px] border px-2 py-1 text-sm ${s.submitted ? "border-hop text-ink" : "border-line2 text-inksoft"}`}>
            <b className="font-mono">{roleTag(s)}</b> {s.name} · {s.submitted ? `submitted ${ago(s.updatedAt)}` : "not submitted"}
          </span>
        ))}
      </div>
      {!composed ? (
        t.seats.length ? <div className="text-base text-inksoft">Nothing submitted yet.</div> : null
      ) : rows.length === 0 ? (
        <div className="text-base text-inksoft">Every lever is on the standing plan; no chair has changed anything.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-left font-mono text-xs uppercase tracking-[0.08em] text-inksoft">
                <th className="py-1 pr-2">Lever</th>
                <th className="py-1 pr-2">Will run</th>
                <th className="py-1 pr-2">{whoWins ? "From" : "Matches"}</th>
                {t.seats.map((s) => <th key={s.userId} className="py-1 pr-2">{roleTag(s)} submitted</th>)}
              </tr>
            </thead>
            <tbody className="tnum">
              {rows.map(({ desk, levers }) => [
                <tr key={desk.id}><td colSpan={3 + t.seats.length} className="pt-2 font-mono text-xs uppercase tracking-[0.08em] text-copperdeep">{desk.label} desk · {DESK_OWNER[desk.id]}</td></tr>,
                ...levers.map((l) => {
                  const credit = whoWins ? (() => { const w = whoWins(l, t.seats, composed, t.standing); return w == null ? [] : [w]; })() : creditedByValue(l, t.seats, composed);
                  const fromStanding = credit.length === 0 && t.standing && same(composed[l], t.standing[l]);
                  return (
                    <tr key={`${desk.id}.${l as string}`} className="border-t border-line align-top">
                      {/* the students' word for it; the export column name on hover (DW-080: raw keys read as debug output) */}
                      <td className="py-1 pr-2 text-sm" title={l as string}>{leverLabel(l as string)}</td>
                      <td className="py-1 pr-2 font-semibold">{show(l as string, composed[l])}</td>
                      <td className="py-1 pr-2 text-sm text-inksoft">{credit.length ? credit.map((i) => roleTag(t.seats[i])).join(", ") : fromStanding ? "standing plan" : "—"}</td>
                      {t.seats.map((s) => {
                        const v = s.partial?.[l];
                        if (!s.submitted || !isSet(v)) return <td key={s.userId} className="py-1 pr-2 text-sm text-line2">·</td>;
                        const differs = !same(v, composed[l]);
                        const did = changed(s, l, t.standing);
                        // changed + not running = an entry that is being overridden (loud);
                        // not changed + differs = a desk default that yielded (quiet).
                        const cls = differs ? (did ? "bg-brick/10 font-semibold text-brick" : "text-inksoft") : "text-ink";
                        const tip = differs ? (did ? "this chair entered this value and it is NOT what will run" : "left at last round's value — another chair's change runs instead") : did ? "changed by this chair this round" : "";
                        return (
                          <td key={s.userId} className={`py-1 pr-2 text-sm ${cls}`} title={tip}>
                            {differs ? (did ? "✗ " : "") : did ? "✎ " : ""}{show(l as string, v)}{differs && !did ? " (left alone)" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function TeamDecisionsPanel({ client, gameId, roundKey, colorByFirm, nameByFirm, whoWins = engineWhoWins }: { client: InstructorClient; gameId: string; roundKey: string; colorByFirm: Map<string, string>; nameByFirm: Map<string, string>; whoWins?: WhoWins }) {
  const [v, setV] = useState<InstructorTeamDecisions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  // One request at a time, newest wins: a slow reply for an old round must not overwrite the new
  // one, and ticks never stack behind a slow call (students' reads share the same queue).
  const flight = useRef<{ busy: boolean; seq: number }>({ busy: false, seq: 0 });
  const load = useCallback(async (force = false) => {
    const f = flight.current;
    if (f.busy && !force) return;
    const seq = ++f.seq;
    f.busy = true;
    setBusy(true);
    try { const r = await client.teamDecisions(gameId); if (seq === f.seq) { setV(r); setErr(null); } }
    catch (e) { if (seq === f.seq) setErr(e instanceof Error ? e.message : String(e)); }
    finally { if (seq === f.seq) { f.busy = false; setBusy(false); } }
  }, [client, gameId]);
  useEffect(() => { load(true); }, [load, roundKey]);
  // While the round is open, follow submits — but not from a hidden tab.
  useEffect(() => {
    if (v?.lifecycle !== "open") return;
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => clearInterval(id);
  }, [load, v?.lifecycle]);

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>Team decisions · round {v ? v.round + 1 : "…"}{v ? ` · ${v.lifecycle}` : ""}</Eyebrow>
        <div className="mb-2 text-base text-inksoft">
          What each chair has submitted, and what will actually run at lock. <b>✎</b> = the chair changed that lever this round. <span className="font-semibold text-brick">✗ red</span> = a chair entered a value that is NOT what will run — go and tell that team.
          {" "}“From” is the chair whose value runs, by the same rule the server merges with: a chair who changed a lever on their own desk wins; one who left it at last round's value yields to the CEO.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => load(true)} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</Button>
          <label className="flex items-center gap-2 text-base text-inksoft"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show every lever</label>
          {v?.lifecycle === "open" && <span className="text-sm text-inksoft">auto-refreshes every 10 s while the round is open</span>}
        </div>
        {err && <div className="mt-2 text-base text-brick">{err}</div>}
      </Card>
      {v?.teams.map((t) => (
        <TeamCard key={t.teamId} t={t} color={colorByFirm.get(t.firmId) ?? "var(--color-inksoft)"} name={nameByFirm.get(t.firmId) ?? t.name} whoWins={whoWins} showAll={showAll} />
      ))}
    </div>
  );
}
