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
      footerNote="Your classmates (and adaptive NPCs in any open slots) brew at the same time. The instructor resolves the round."
      onExit={onExit}
    />
  );
}
