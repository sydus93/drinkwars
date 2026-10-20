import { useCallback, useMemo, useRef, useState } from "react";
import type { ConfigOverride, FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame, type Difficulty, type GameView } from "./controller.js";
import { setPlayerColor, setPlayerEmblem } from "../lib/teamColors.js";

export function useGame() {
  const ref = useRef<SinglePlayerGame | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  // Surface a failed start/brew instead of hanging the "Pouring…" / "Brewing…" button
  // forever with no feedback — the button resets and the reason is shown.
  const [error, setError] = useState<string | null>(null);
  // DW-080: one id per solo RUN — the results page and the event takeover remember dismissals per
  // game, and a constant "solo" key (with the fixed seed's identical shocks) meant a second solo
  // run never showed either. Solo games live in memory only, so a start-time id is enough.
  const [runId, setRunId] = useState("solo");

  const start = useCallback(async (opts: { breweryName?: string; difficulty?: Difficulty; override?: ConfigOverride; tagline?: string; founding?: { facilities: { type: string; district?: string; lot?: string }[]; hires: string[] } } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const g = new SinglePlayerGame();
      await g.start(opts);
      ref.current = g;
      setRunId(`solo:${Date.now().toString(36)}`);
      setView(await g.view());
    } catch (e) {
      console.error("Failed to start game:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const play = useCallback(async (decision: FirmDecision) => {
    if (!ref.current) return;
    setBusy(true);
    setError(null);
    try {
      await ref.current.play(decision);
      setView(await ref.current.view());
    } catch (e) {
      console.error("Failed to resolve round:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const defaultDecision = useCallback(() => ref.current!.defaultDecision(), []);
  // DW-077: the calls channel for the solo seat (Play's `calls` prop) — stable identity, reads the live controller.
  const calls = useMemo(() => ({
    callsEnabled: () => !!ref.current?.callsEnabled(),
    forecasts: () => ref.current!.forecasts(),
    submitForecasts: (c: Parameters<SinglePlayerGame["submitForecasts"]>[0]) => ref.current!.submitForecasts(c),
  }), []);
  const infoCost = useCallback(() => ref.current?.infoCost() ?? 0, []);

  const reset = useCallback(() => {
    ref.current = null;
    setPlayerColor(null); // back to the default palette until the next firm is founded
    setPlayerEmblem(null);
    setView(null);
    setError(null);
  }, []);

  return { view, busy, error, start, play, defaultDecision, infoCost, reset, calls, runId };
}
