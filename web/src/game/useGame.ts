import { useCallback, useRef, useState } from "react";
import type { ConfigOverride, FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame, type Difficulty, type GameView } from "./controller.js";
import { setPlayerColor } from "../lib/teamColors.js";

export function useGame() {
  const ref = useRef<SinglePlayerGame | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async (opts: { breweryName?: string; difficulty?: Difficulty; override?: ConfigOverride; tagline?: string; founding?: { facilities: string[]; hires: string[] } } = {}) => {
    setBusy(true);
    const g = new SinglePlayerGame();
    await g.start(opts);
    ref.current = g;
    setView(await g.view());
    setBusy(false);
  }, []);

  const play = useCallback(async (decision: FirmDecision) => {
    if (!ref.current) return;
    setBusy(true);
    await ref.current.play(decision);
    setView(await ref.current.view());
    setBusy(false);
  }, []);

  const defaultDecision = useCallback(() => ref.current!.defaultDecision(), []);
  const infoCost = useCallback(() => ref.current?.infoCost() ?? 0, []);

  const reset = useCallback(() => {
    ref.current = null;
    setPlayerColor(null); // back to the default palette until the next firm is founded
    setView(null);
  }, []);

  return { view, busy, start, play, defaultDecision, infoCost, reset };
}
