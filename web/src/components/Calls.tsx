/**
 * Calls — the tickets step inside the commit panel (DW-074 channel, DW-077 design §D).
 *
 * Three tickets a seat fills with a tap before the round locks: WHERE WE FINISH, MY GROSS MARGIN
 * (four bands anchored on last round), {TOP RIVAL}'S PRICE (Cut / Hold / Raise). Every option,
 * hint and the pre-selected rival comes from the server's prompts (server/src/forecasts.ts); this
 * file only renders and saves. A tap saves within a second (debounced POST /forecasts) AND the
 * whole set is re-sent with the desk submit (`flush`), so a student who taps and submits in the
 * same breath never loses a call. Editable until lock.
 *
 * A parallel channel: nothing here touches the decision form, the seat merge or the submit path.
 * It fetches on a round / lock change and after its own saves — never on the poll — and renders
 * nothing (and requests nothing) when the game has calls switched off.
 *
 * The tickets sit inside DecisionForm's dark-walnut commit rail, so like CommitRow they use that
 * rail's fixed light-on-dark tones rather than the page's day/night tokens.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ForecastCall, ForecastPrompt, ScoredCall, SeatForecasts, Verdict } from "drinkwars-server";

/** What the tickets need from a game client — the student transport client and the solo
 *  controller both satisfy it. */
export interface CallsClient {
  callsEnabled(): boolean;
  forecasts(): Promise<SeatForecasts>;
  submitForecasts(calls: Record<string, ForecastCall>): Promise<unknown>;
}

export const VERDICT_LABEL: Record<Verdict, string> = { nailed: "Nailed", close: "Close", missed: "Missed" };
export const VERDICT_COLOR: Record<Verdict, string> = { nailed: "var(--color-hop)", close: "var(--color-gold)", missed: "var(--color-brick)" };
/** "Record 5 of 8" — hits of settled calls. */
export const recordText = (c: { hits: number; scored: number } | null | undefined): string => `${c?.hits ?? 0} of ${c?.scored ?? 0}`;
/** This seat's settled calls in season order (round, then ticket order) — the streak bar reads the tail. */
export const settledMine = (d: SeatForecasts | null | undefined): ScoredCall[] =>
  (d?.calls ?? []).filter((c) => c.userId === d?.me && c.verdict != null);

const SAVE_DEBOUNCE_MS = 700;

export interface CallsDesk {
  enabled: boolean;
  data: SeatForecasts | null;
  draft: Record<string, ForecastCall>;
  /** calls currently filled (drives "SUBMIT MY DESK + N CALLS") */
  count: number;
  setCall: (id: string, call: ForecastCall | null) => void;
  /** send the current set now (the desk submit calls this before it posts the decision) */
  flush: () => Promise<void>;
  reload: () => Promise<void>;
  error: string | null;
}

/** Owns the tickets' state for a screen. `round`/`open` changes trigger the one read per lifecycle step. */
export function useCallsDesk(client: CallsClient | null | undefined, round: number, open: boolean): CallsDesk {
  const enabled = !!client?.callsEnabled();
  const [data, setData] = useState<SeatForecasts | null>(null);
  const [draft, setDraft] = useState<Record<string, ForecastCall>>({});
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (!client || !enabled) return;
    try {
      const d = await client.forecasts();
      setData(d);
      if (!dirty.current) setDraft(d.mine ?? {});
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [client, enabled]);

  const loadedFor = useRef("");
  useEffect(() => {
    const key = `${round}:${open}`;
    if (!enabled || loadedFor.current === key) return;
    loadedFor.current = key;
    dirty.current = false;
    void reload();
  }, [enabled, reload, round, open]);

  const save = useCallback(async () => {
    if (!client || !enabled || !dirty.current) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const calls = draftRef.current;
    try {
      await client.submitForecasts(calls);
      dirty.current = false;
      setError(null);
      const d = await client.forecasts();
      setData(d);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [client, enabled]);

  const setCall = useCallback((id: string, call: ForecastCall | null) => {
    setDraft((d) => { const n = { ...d }; if (call) n[id] = call; else delete n[id]; return n; });
    dirty.current = true;
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, SAVE_DEBOUNCE_MS);
  }, [save]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const count = useMemo(() => Object.values(draft).filter((c) => c && c.value !== "" && c.value != null).length, [draft]);
  return { enabled: enabled && !!data?.enabled, data, draft, count, setCall, flush: save, reload, error };
}

// Fixed light-on-dark tones of the commit rail (see DecisionForm's CommitRow).
const RAIL = { ink: "#f4e6c8", soft: "#bda079", faint: "#a98a5f", line: "rgba(255,240,205,.22)", fill: "rgba(0,0,0,.18)", selBg: "#f4e6c8", selInk: "#1b130c", err: "#e59178" };

/** The three tickets. Mount through DecisionForm's `callsSlot` (above Submit). */
export function CallsTickets({ desk, round, open }: { desk: CallsDesk; round: number; open: boolean }) {
  if (!desk.enabled || !desk.data) return null;
  const prompts = desk.data.prompts ?? [];
  const record = recordText(desk.data.calibration?.me);
  return (
    <div className="mt-3 grid gap-2.5 border-t pt-3" style={{ borderColor: RAIL.line }} data-dw="calls-tickets">
      <div className="flex items-baseline justify-between gap-3">
        <span className="display text-[1.15rem] font-semibold" style={{ color: RAIL.ink }}>Your calls for Round {round + 1}</span>
        <span className="tnum text-[0.78rem]" style={{ color: RAIL.soft }}>Record {record}</span>
      </div>
      <div className="-mt-1.5 text-[0.74rem]" style={{ color: RAIL.soft }}>{open ? "Optional. Settled when the round resolves." : "Locked with the round. Settled when it resolves."}</div>
      {prompts.map((p) => <Ticket key={p.id} prompt={p} call={desk.draft[p.id]} open={open} onPick={(v) => desk.setCall(p.id, v == null ? null : { value: v, ...(p.target ? { target: p.target } : {}) })} />)}
      {desk.error && <div className="text-[0.72rem]" style={{ color: RAIL.err }}>Calls not saved — {desk.error}</div>}
    </div>
  );
}

function Ticket({ prompt, call, open, onPick }: { prompt: ForecastPrompt; call: ForecastCall | undefined; open: boolean; onPick: (v: string | number | null) => void }) {
  const picked = call?.value != null && call.value !== "" ? String(call.value) : null;
  return (
    <div className="grid gap-2 rounded-[12px] px-3 py-2.5" style={{ border: `1px ${picked ? "solid" : "dashed"} ${picked ? "rgba(244,230,200,.55)" : RAIL.line}`, background: RAIL.fill }} data-dw-ticket={prompt.id} data-filled={picked ? "1" : "0"}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em]" style={{ color: RAIL.soft }}>{prompt.title}</span>
        <span className="tnum text-[0.72rem]" style={{ color: RAIL.faint }}>{prompt.hint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={prompt.title}>
        {prompt.options.map((o) => {
          const on = picked === String(o.value);
          return (
            <button key={String(o.value)} type="button" disabled={!open} aria-pressed={on} onClick={() => onPick(on ? null : o.value)}
              className="min-w-[3rem] rounded-[10px] px-2.5 py-1.5 font-mono text-[0.8rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{ border: `1px solid ${on ? RAIL.selBg : RAIL.line}`, background: on ? RAIL.selBg : "transparent", color: on ? RAIL.selInk : RAIL.ink, fontVariantNumeric: "tabular-nums" }}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "SUBMIT MY DESK + 3 CALLS" / "(NO CALLS)" — the design's submit label, for a screen that builds its own. */
export const callsSuffix = (count: number | undefined): ReactNode => (count == null ? null : count > 0 ? ` + ${count} call${count === 1 ? "" : "s"}` : " (no calls)");
