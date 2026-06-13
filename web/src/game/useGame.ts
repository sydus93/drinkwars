import { useCallback, useRef, useState } from "react";
import type { ConfigOverride, FirmDecision } from "drinkwars-engine";
import { SinglePlayerGame, type Difficulty, type GameView } from "./controller.js";

export function useGame() {
  const ref = useRef<SinglePlayerGame | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async (opts: { breweryName?: string; difficulty?: Difficulty; override?: ConfigOverride } = {}) => {
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
    setView(null);
  }, []);

  return { view, busy, start, play, defaultDecision, infoCost, reset };
}
