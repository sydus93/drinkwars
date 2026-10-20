import { useCallback, useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { RawView, StudentClient } from "../game/multiplayer.js";
import { Play, UTIL_BTN } from "./Play.js";
import { setSelfFirm } from "../lib/teamColors.js";

/**
 * Student multiplayer screen. Polls the transport and renders the SAME Play shell as
 * single-player (Review · Decide · Map, the pro-mode desk filter, the Tap Dispatch) via
 * Play's `mp` mode — a submit-and-wait lifecycle with a round banner and a Leave action.
 * `setSelfFirm` makes the student's chosen colour/emblem apply to their own firm. The Map
 * (City View / Market map) renders the same as single-player, fed by the transport's per-team
 * projections (markets / research-gated rival firms / shocks / hiring pool).
 *
 * DW-048 (classroom hardening): a submit that fails now SAYS so (it used to throw into the
 * void and the student believed they'd submitted); a submit that lands flashes a receipt;
 * polling backs off when the tab is hidden, the round is locked, or the server is unhappy
 * (an open tab overnight used to make ~34k calls); a dead session (401) exits cleanly with
 * a message instead of spinning; the return code can be re-shown; the instructor's deadline
 * shows as a countdown in the banner.
 */
// DW-050: the poll is a PULSE (≈120 bytes, 3 reads) and the full view is fetched only when
// its stamp moves (or every FULL_REFRESH_MS as a safety net). A class of 25 on a sprint day
// used to cost ~200k full-view calls; this makes the common tick nearly free.
const POLL_OPEN_MS = 4000; // DW-065: was 3000 — every pulse is 4 serialized storage reads project-wide; see multiplayer.ts edgeFetch note // open round, my seat not yet submitted, tab visible
const POLL_SUBMITTED_MS = 8000; // DW-065: was 6000 // I've submitted — waiting on teammates / the instructor
const POLL_WAITING_MS = 8000; // locked/resolving/complete — nothing the student can change
const POLL_HIDDEN_MS = 15000; // tab hidden (resumes instantly on visibilitychange)
const POLL_ERROR_MS = 15000; // after repeated failures (server down / network) — don't hammer
const FULL_REFRESH_MS = 60000; // full view at least this often even if the stamp is quiet
// DW-064: every client in the room notices the same stamp change within one poll of each
// other — a resolve lands and all ~30 fetch the full view at once. That thundering herd is
// what turned a 3s /view into 13s at 35 students in the prod rehearsal. A short random delay
// spreads the burst; it is applied ONLY on a change, never on first load, so opening the app
// is still instant and a student who is waiting on results sees them within ~a second.
const HERD_JITTER_MS = 1200;
// DW-064: the pulse stamp includes every TEAMMATE's write, so in a five-person firm each
// round costs 25 full 21KB view fetches (5 submits x 5 members) — measured at 5.2 per
// student per round in the prod rehearsal, the single biggest source of /view load. A
// teammate's submit still matters (Reconcile, the composed plan), it just does not need to
// land within a second. Round and lifecycle changes DO, and pulse reports them separately,
// so those stay immediate and only teammate writes are coalesced.
const PLAN_COALESCE_MS = 10000; // DW-065: must exceed the longest poll interval (8 s) or it never coalesces in the submitted state

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "passed";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function MultiplayerPlay({ client, onExit }: { client: StudentClient; onExit: () => void }) {
  const [raw, setRaw] = useState<RawView | null>(client.raw());
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null); // "Submitted ✓ 14:02" — cleared on next edit/round
  const [unsent, setUnsent] = useState(false); // DW-080: edited since that submit — the receipt must stop saying ✓
  const [stale, setStale] = useState(false); // the poll has been failing — the view may be behind
  const [dead, setDead] = useState<string | null>(null); // session rejected by the server (401) → exit with a reason
  // A casual (anonymous) joiner gets a durable claim code auto-issued — surface it ONCE
  // so they can return to this brewery on any device. Roster students entered their own,
  // so the server flags it not-issued and this stays hidden. Dismissal is per-code; a
  // "Return code" button brings it back (it used to be gone for good).
  const [showClaim, setShowClaim] = useState<boolean>(() => {
    if (!client.claimIssued || !client.claim) return false;
    try { return localStorage.getItem("dw_claim_ack") !== client.claim; } catch { return true; }
  });
  const dismissClaim = () => {
    try { localStorage.setItem("dw_claim_ack", client.claim); } catch { /* ignore */ }
    setShowClaim(false);
  };
  const copyClaim = () => { try { navigator.clipboard?.writeText(client.claim); } catch { /* ignore */ } };
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setSelfFirm(client.firmId); }, [client.firmId]);

  // ── polling with back-off ──────────────────────────────────────────────────
  const everLoaded = useRef(false);
  const failures = useRef(0);
  const stamp = useRef<string | null>(null);
  const lastFull = useRef(0);
  const lastRound = useRef<number | null>(null);
  const lastLifecycle = useRef<string | null>(null);
  const lastDeadline = useRef<number | null>(null); // a deadline change is 'big' too — the countdown must not lag behind coalescing
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (ms: number) => { if (live) timer = setTimeout(tick, ms); };
    const tick = async () => {
      if (!live) return;
      if (typeof document !== "undefined" && document.hidden) { schedule(POLL_HIDDEN_MS); return; } // resumes on visibilitychange
      try {
        let v = client.raw();
        let changed = true;
        if (v && stamp.current && Date.now() - lastFull.current < FULL_REFRESH_MS) {
          const p = await client.fetchPulse();
          if (!live) return;
          const moved = p.stamp !== stamp.current;
          const big = p.round !== lastRound.current || p.lifecycle !== lastLifecycle.current || p.deadlineAt !== lastDeadline.current;
          if (moved && (big || Date.now() - lastFull.current >= PLAN_COALESCE_MS)) {
            changed = true;
            stamp.current = p.stamp;
            lastRound.current = p.round;
            lastLifecycle.current = p.lifecycle;
            lastDeadline.current = p.deadlineAt;
          } else {
            // Deliberately leave stamp.current alone so a coalesced teammate write is picked
            // up on a later tick rather than dropped.
            changed = false;
          }
        }
        if (changed && v) { await new Promise((r) => setTimeout(r, Math.random() * HERD_JITTER_MS)); if (!live) return; }
        if (changed || !v) {
          const [nv, p] = await Promise.all([client.fetchView(), stamp.current ? Promise.resolve(null) : client.fetchPulse()]);
          if (!live) return;
          v = nv;
          if (p) { stamp.current = p.stamp; lastRound.current = p.round; lastLifecycle.current = p.lifecycle; lastDeadline.current = p.deadlineAt; }
          lastFull.current = Date.now();
          setRaw({ ...v });
        }
        everLoaded.current = true;
        failures.current = 0;
        setStale(false);
        const waiting = v.complete || v.lifecycle !== "open" || v.own?.status !== "active";
        schedule(waiting ? POLL_WAITING_MS : v.submitted ? POLL_SUBMITTED_MS : POLL_OPEN_MS);
      } catch (e) {
        if (!live) return;
        const status = (e as { status?: number })?.status;
        if (status === 401) {
          // The server no longer recognises this session (token invalid, game deleted, or the
          // instructor removed this player — DW-066 says which when it knows).
          client.clearSaved();
          const why = e instanceof Error && /seated|removed/i.test(e.message) ? e.message : "Your session is no longer valid — the game may have been closed. Join again with your code.";
          setDead(why);
          return;
        }
        failures.current += 1;
        // A restored session that never loads is dead (game ended/expired) — drop it.
        if (!everLoaded.current && failures.current >= 3) { client.clearSaved(); onExit(); return; }
        if (failures.current >= 2) setStale(true);
        schedule(failures.current >= 3 ? POLL_ERROR_MS : POLL_OPEN_MS);
      }
    };
    const onVisible = () => { if (!document.hidden) { if (timer) clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    tick();
    const clock = setInterval(() => setNow(Date.now()), 30000); // deadline countdown granularity
    return () => { live = false; if (timer) clearTimeout(timer); clearInterval(clock); document.removeEventListener("visibilitychange", onVisible); };
  }, [client, onExit]);

  // A new round clears the receipt/error (they described the previous one).
  useEffect(() => { setReceipt(null); setSubmitErr(null); }, [raw?.round, raw?.lifecycle]);

  const defaultDecision = useCallback(() => client.defaultDecision(), [client, raw?.round]);
  const submit = useCallback(
    async (d: FirmDecision, covers?: Set<string>, forRound?: number) => {
      setBusy(true);
      setSubmitErr(null);
      try {
        await client.submit(d, covers, forRound);
        setUnsent(false);
        setRaw({ ...(await client.fetchView()) });
        lastFull.current = Date.now();
        stamp.current = null; // next tick re-reads the stamp after our own write
        setReceipt(`Submitted ✓ ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
        return true;
      } catch (e) {
        const status = (e as { status?: number })?.status;
        const m = e instanceof Error ? e.message : String(e);
        // Say what happened in the student's terms. The server's messages are already
        // plain ("cannot submit: round is "locked", not open"); add the next step.
        setSubmitErr(
          status === 401 ? "Your session expired — reload the page and join again with your code; your seat is kept."
          : /already closed/i.test(m) ? `Not submitted — ${m}.`
          : /locked|not open/i.test(m) ? "Not submitted — the instructor has locked this round. Your standing plan trades this quarter; the next round opens after the resolve."
          : /Failed to fetch|NetworkError|network/i.test(m) ? "Not submitted — couldn't reach the game server. Check your connection and press Submit again."
          : `Not submitted — ${m}. Press Submit again.`,
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  if (dead) {
    return (
      <div className="mx-auto mt-16 max-w-[560px] px-4">
        <div className="rounded-lg border border-brick/40 bg-brick/10 px-4 py-3 text-sm text-ink">{dead}</div>
        <button onClick={onExit} className="mt-3 rounded-lg border border-line2 bg-panel2 px-3 py-2 font-mono text-[0.62rem] font-bold uppercase tracking-wide text-inksoft">Back to home</button>
      </div>
    );
  }
  if (!raw) return <div className="p-8 text-inksoft">{stale ? "Still trying to reach the game server…" : "Connecting to the game…"}</div>;
  const view = client.toGameView(raw);
  const open = view.lifecycle === "open" && view.ownActive && !view.complete;
  const deadline = raw.deadlineAt ?? null;
  // DW-049: the deadline LEADS the banner (it used to trail the sentence and went unnoticed).
  const deadlineLead = open && deadline
    ? deadline > now
      ? `⏱ Deadline ${new Date(deadline).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} — ${fmtCountdown(deadline - now)} left · `
      : "⏱ Deadline passed — the instructor may lock at any moment · "
    : "";
  // DW-050: team firms — "submitted" is about MY desk, not the firm (the CEO's submit used to
  // make every teammate's banner say "Submitted").
  const mySeat = raw.teamPlan?.seats.find((s) => s.me);
  const mineIn = mySeat ? mySeat.submitted : !!raw.submitted;
  const othersIn = !!mySeat && !mineIn && raw.teamPlan!.seats.some((s) => !s.me && s.submitted);
  const banner = view.complete
    ? "Season complete — see the final standings in Review."
    : !view.ownActive
      ? "Your brewery has exited the market — watch the shakeout in Review."
      : view.lifecycle === "open"
        ? deadlineLead + (mineIn
          ? (mySeat ? "Your desk is in — revise until the instructor locks the round." : "Submitted — you can revise until the instructor locks the round.")
          : othersIn
            ? "Teammates have submitted — your desk hasn't yet. Set your levers in Decide and submit."
            : "Round open — set your decision in Decide and submit.")
        : view.lifecycle === "resolving"
          ? "Round locked — the instructor is resolving it now…"
          : "Round locked — waiting for the instructor to resolve…";
  const submitLabel = mySeat
    ? (mineIn ? "Update my desk" : `Submit my desk (round ${view.round + 1})`)
    : (raw.submitted ? "Update my decision" : `Submit decision (round ${view.round + 1})`);

  // DW-078: the return-code card and the submit/receipt/stale notices render INSIDE Play, under the
  // header and wire strip (they used to sit above the page, pushing the phone seat bar down), and
  // the "Return code" button joins Leave in the header's utility line.
  const notices = (showClaim || submitErr || receipt || stale) ? (
    <div className="mb-3 grid gap-2">
      {showClaim && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--color-copper) 55%, transparent)", background: "color-mix(in srgb, var(--color-copper) 10%, var(--color-panel))" }}>
          <span className="font-mono text-[0.56rem] font-bold uppercase tracking-[0.12em] text-copperdeep">Your return code</span>
          <span className="wordmark text-lg tracking-[0.22em] text-copperdeep">{client.claim}</span>
          <span className="min-w-0 flex-1 basis-[14rem] text-[0.78rem] leading-snug text-inksoft">Save this to pick your brewery back up on any device — enter it under “My games” on the start screen.</span>
          <span className="flex gap-2">
            <button onClick={copyClaim} className="rounded-md border border-line2 bg-panel px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft transition-colors hover:text-copper">Copy</button>
            <button onClick={dismissClaim} className="rounded-md border border-copper px-2.5 py-1 font-mono text-[0.6rem] font-bold uppercase tracking-wide text-copperdeep transition-colors hover:bg-copper/10">Got it</button>
          </span>
        </div>
      )}
      {submitErr && (
        <div role="alert" className="rounded-lg border border-brick/50 bg-brick/10 px-3 py-2 text-sm text-ink">
          <span className="font-semibold text-brick">Heads up.</span> {submitErr}
        </div>
      )}
      {(receipt && !submitErr) || stale ? (
        <div className="flex flex-wrap gap-2">
          {!submitErr && receipt && (unsent
            ? <div className="rounded-lg border border-gold bg-gold/10 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-wide text-ink">Changed since you submitted — submit again to send it</div>
            : <div className="rounded-lg border border-hop/50 bg-hop/10 px-3 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-wide text-ink">{receipt}</div>)}
          {stale && <div className="rounded-lg border border-gold bg-gold/10 px-3 py-1.5 text-[0.72rem] text-inksoft">Having trouble reaching the game server — showing the last view we got; retrying.</div>}
        </div>
      ) : null}
    </div>
  ) : null;
  const utilities = !showClaim && client.claim
    ? <button onClick={() => setShowClaim(true)} title="Show your return code again" className={UTIL_BTN}>Return code</button>
    : null;

  return (
    <>
      <Play
        notices={notices}
        utilities={utilities}
        calls={client} // DW-077: the calls channel (tickets in the commit panel + the settled column on the results page); inert unless the game has calls on
        gameKey={`${client.gameId || client.claim || "mp"}:${client.firmId}`}
        key={view.own?.id ?? client.firmId} // DW-066: a move to another firm remounts the form (fresh draft for the new desk)
        view={view}
        busy={busy || !open}
        infoCost={client.infoCost()}
        onPlay={submit}
        onUnsentChange={setUnsent}
        defaultDecision={defaultDecision}
        onReset={onExit}
        mp
        seatRole={client.role}
        banner={banner}
        submitLabel={submitLabel}
        footerNote="Your classmates brew at the same time; the instructor resolves the round."
        onExit={onExit}
        standing={raw.standing ?? null}
        gameId={client.gameId || client.token} // DW-077: keys the per-student takeover dismissals (token = a session saved before gameId was persisted)
        deadlineAt={deadline}
      />
    </>
  );
}
