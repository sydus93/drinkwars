import { useState } from "react";
import { useGame } from "./game/useGame.js";
import { Setup } from "./screens/Setup.js";
import { Play } from "./screens/Play.js";

type Mode = "foolscap" | "sectional";

/** Light (Foolscap) ↔ dark (Sectional Night) — the design system's two co-equal modes. */
function ModeToggle() {
  const [mode, setMode] = useState<Mode>(
    () => (document.documentElement.getAttribute("data-mode") as Mode) || "foolscap",
  );
  const dark = mode === "sectional";
  const toggle = () => {
    const next: Mode = dark ? "foolscap" : "sectional";
    document.documentElement.setAttribute("data-mode", next);
    setMode(next);
  };
  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="fixed bottom-3 right-3 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-line2 bg-panel text-inksoft transition-colors hover:text-copper"
    >
      {dark ? (
        <svg className="lucide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg className="lucide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        </svg>
      )}
    </button>
  );
}

export function App() {
  const { view, busy, start, play, defaultDecision, infoCost, reset } = useGame();
  return (
    <>
      {!view ? (
        <Setup onStart={(name, difficulty) => start({ breweryName: name, difficulty })} busy={busy} />
      ) : (
        <Play view={view} busy={busy} infoCost={infoCost()} onPlay={play} defaultDecision={defaultDecision} onReset={reset} />
      )}
      <ModeToggle />
    </>
  );
}
