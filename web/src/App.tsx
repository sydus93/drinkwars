import { useGame } from "./game/useGame.js";
import { Setup } from "./screens/Setup.js";
import { Play } from "./screens/Play.js";

export function App() {
  const { view, busy, start, play, defaultDecision, infoCost, reset } = useGame();
  if (!view) return <Setup onStart={(name, difficulty) => start({ breweryName: name, difficulty })} busy={busy} />;
  return <Play view={view} busy={busy} infoCost={infoCost()} onPlay={play} defaultDecision={defaultDecision} onReset={reset} />;
}
