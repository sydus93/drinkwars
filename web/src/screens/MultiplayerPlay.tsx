import { useCallback, useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { RawView, StudentClient } from "../game/multiplayer.js";
import { Play } from "./Play.js";
import { setSelfFirm } from "../lib/teamColors.js";

/**
 * Student multiplayer screen. Polls the transport and renders the SAME Play shell as
 * single-player (Review · Decide · Map, the pro-mode desk filter, the Tap Dispatch) via
 * Play's `mp` mode — a submit-and-wait lifecycle with a round banner and a Leave action.
 * `setSelfFirm` makes the student's chosen colour/emblem apply to their own firm. The Map
 * (City View / Market map) renders the same as single-player, fed by the transport's per-team
 * projections (markets / research-gated rival firms / shocks / hiring pool).
 */
export function MultiplayerPlay({ client, onExit }: { client: StudentClient; onExit: () => void }) {
  const [raw, setRaw] = useState<RawView | null>(client.raw());
  const [busy, setBusy] = useState(false);
  // A casual (anonymous) joiner gets a durable claim code auto-issued — surface it ONCE
  // so they can return to this brewery on any device. Roster students entered their own,
  // so the server flags it not-issued and this stays hidden. Dismissal is per-code.
  const [showClaim, setShowClaim] = useState<boolean>(() => {
    if (!client.claimIssued || !client.claim) return false;
    try { return localStorage.getItem("dw_claim_ack") !== client.claim; } catch { return true; }
  });
  const dismissClaim = () => {
    try { localStorage.setItem("dw_claim_ack", client.claim); } catch { /* ignore */ }
    setShowClaim(false);
  };
  const copyClaim = () => { try { navigator.clipboard?.writeText(client.claim); } catch { /* ignore */ } };

  useEffect(() => { setSelfFirm(client.firmId); }, [client.firmId]);

  const everLoaded = useRef(false);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const v = await client.fetchView();
        if (!live) return;
        everLoaded.current = true;
        setRaw({ ...v });
      } catch {
        // A restored session that never loads is dead (game ended/expired) — drop it.
        if (live && !everLoaded.current) {
          client.clearSaved();
          onExit();
        }
        // otherwise a transient blip — keep the last view
      }
    };
    tick();
    const h = setInterval(tick, 2500);
    return () => { live = false; clearInterval(h); };
  }, [client, onExit]);

  const defaultDecision = useCallback(() => client.defaultDecision(), [client, raw?.round]);
  const submit = useCallback(
    async (d: FirmDecision) => {
      setBusy(true);
      try {
        await client.submit(d);
        setRaw({ ...(await client.fetchView()) });
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  if (!raw) return <div className="p-8 text-inksoft">Connecting to the game…</div>;
  const view = client.toGameView(raw);
  const open = view.lifecycle === "open" && view.ownActive && !view.complete;
  const banner = view.complete
    ? "Season complete — see the final standings in Review."
    : !view.ownActive
      ? "Your brewery has exited the market — watch the shakeout in Review."
      : view.lifecycle === "open"
        ? raw.submitted
          ? "Submitted — you can revise until the instructor locks the round."
          : "Round open — set your decision in Decide and submit."
        : "Round locked — waiting for the instructor to resolve…";
  const submitLabel = raw.submitted ? "Update my decision" : `Submit decision (round ${view.round + 1})`;

  return (
    <>
      {showClaim && (
        <div className="mx-auto mt-3 max-w-[980px] px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--color-copper) 55%, transparent)", background: "color-mix(in srgb, var(--color-copper) 10%, var(--color-panel))" }}>
            <span className="font-mono text-[0.56rem] font-bold uppercase tracking-[0.12em] text-copperdeep">Your return code</span>
            <span className="wordmark text-lg tracking-[0.22em] text-copperdeep">{client.claim}</span>
            <span className="min-w-0 flex-1 text-[0.78rem] leading-snug text-inksoft">Save this to pick your brewery back up on any device — enter it under “Returning player.”</span>
            <button onClick={copyClaim} className="rounded-md border border-line2 bg-panel px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft transition-colors hover:text-copper">Copy</button>
            <button onClick={dismissClaim} className="rounded-md border border-copper px-2.5 py-1 font-mono text-[0.6rem] font-bold uppercase tracking-wide text-copperdeep transition-colors hover:bg-copper/10">Got it</button>
          </div>
        </div>
      )}
      <Play
        view={view}
        busy={busy || !open}
        infoCost={client.infoCost()}
        onPlay={submit}
        defaultDecision={defaultDecision}
        onReset={onExit}
        mp
        seatRole={client.role}
        banner={banner}
        submitLabel={submitLabel}
        footerNote="Your classmates brew at the same time; the instructor resolves the round."
        onExit={onExit}
      />
    </>
  );
}
