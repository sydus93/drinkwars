import { useCallback, useRef, useState } from "react";
import type { ConfigOverride, FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame, type Difficulty, type GameView } from "./controller.js";
import { setPlayerColor } from "../lib/teamColors.js";

export function useGame() {
  const ref = useRef<SinglePlayerGame | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  // Surface a failed start/brew instead of hanging the "Pouring…" / "Brewing…" button
  // forever with no feedback — the button resets and the reason is shown.
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (opts: { breweryName?: string; difficulty?: Difficulty; override?: ConfigOverride; tagline?: string; founding?: { facilities: string[]; hires: string[] } } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const g = new SinglePlayerGame();
      await g.start(opts);
      ref.current = g;
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
  const infoCost = useCallback(() => ref.current?.infoCost() ?? 0, []);

  const reset = useCallback(() => {
    ref.current = null;
    setPlayerColor(null); // back to the default palette until the next firm is founded
    setView(null);
    setError(null);
  }, []);

  return { view, busy, error, start, play, defaultDecision, infoCost, reset };
}
