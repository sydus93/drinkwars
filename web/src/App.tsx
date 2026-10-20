import { useState } from "react";
import { useGame } from "./game/useGame.js";
import { FirmBuilder } from "./screens/FirmBuilder.js";
import { setPlayerColor, setPlayerEmblem } from "./lib/teamColors.js";
import { Play } from "./screens/Play.js";
import { Lobby } from "./screens/Lobby.js";
import { ScenarioPicker } from "./screens/ScenarioPicker.js";
import type { Scenario } from "./scenarios/catalog.js";
import { Join } from "./screens/Join.js";
import { PlayerHome } from "./screens/PlayerHome.js";
import { MultiplayerPlay } from "./screens/MultiplayerPlay.js";
import { Instructor, instructorWasOpen } from "./screens/Instructor.js";
import { MP_ENABLED, StudentClient } from "./game/multiplayer.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ModeToggle } from "./components/ModeToggle.js";

/** Single-player: the full stack runs in the browser (engine + orchestration + NPCs). */
function Solo() {
  const { view, busy, error, start, play, defaultDecision, infoCost, reset, calls, runId } = useGame();
  if (!view)
    return (
      <>
        {error && (
          <div className="mx-auto mt-4 max-w-[640px] px-4">
            <div className="rounded-lg border border-brick/40 bg-brick/10 px-4 py-3 text-sm text-ink">
              <span className="font-semibold text-brick">Couldn't open the brewery.</span> {error}. Adjust your setup and try again — if it keeps happening, a hard refresh (⌘⇧R) clears any stale cache.
            </div>
          </div>
        )}
        <FirmBuilder
          busy={busy}
          onStart={(c) => {
            setPlayerColor(c.color);
            setPlayerEmblem(c.emblem);
            start({ breweryName: c.name, difficulty: c.difficulty, tagline: c.tagline, founding: c.founding, override: Object.keys(c.modules).length ? ({ modules: c.modules } as never) : undefined });
          }}
        />
      </>
    );
  return <Play view={view} busy={busy} infoCost={infoCost()} onPlay={play} defaultDecision={defaultDecision} onReset={reset} calls={calls} gameKey={runId} />; // DW-077 calls
}

/** Scenario mode: pick a focused challenge → play it with the objective pinned as a banner,
 *  and the debrief surfaced when the short season completes. Reuses the whole Solo stack;
 *  the only new inputs are the config override + the objective/debrief strings. */
function Scenarios({ onExit }: { onExit: () => void }) {
  const { view, busy, error, start, play, defaultDecision, infoCost, reset, calls, runId } = useGame();
  const [active, setActive] = useState<Scenario | null>(null);
  if (!active) return <ScenarioPicker onStart={(s) => { setActive(s); start({ breweryName: "Your Brewery", difficulty: s.id === "blue-water" ? "cutthroat" : "competitive", override: s.override }); }} onBack={onExit} />;
  if (!view) return (
    <div className="mx-auto mt-16 max-w-[640px] px-4 text-center text-inksoft">
      {error ? <span className="text-brick">Couldn't start the scenario: {error}.</span> : "Setting up the scenario…"}
    </div>
  );
  const banner = view.complete ? `Debrief — ${active.debrief}` : `Objective — ${active.objective}`;
  return <Play view={view} busy={busy} infoCost={infoCost()} onPlay={play} defaultDecision={defaultDecision} onReset={() => { setActive(null); reset(); }} banner={banner} onExit={onExit} calls={calls} gameKey={`scenario:${active.id}:${runId}`} />; // DW-077 calls
}

type Screen = "lobby" | "solo" | "scenario" | "join" | "instructor" | "player";

export function App() {
  // Resume a saved student session on load (refresh → same firm, not a new slot).
  const [student, setStudent] = useState<StudentClient | null>(() => (MP_ENABLED ? StudentClient.restore() : null));
  // DW-071: a tab that had the instructor console open comes back into it (reload, app-level
  // error "Reload", accidental refresh) — it used to land on the Lobby, three clicks from the game.
  const [screen, setScreen] = useState<Screen>(() => (MP_ENABLED && instructorWasOpen() ? "instructor" : student ? "join" : "lobby"));

  return (
    // Backstop boundary: keyed on `screen`, so leaving a broken screen clears the error.
    // The finer-grained ones live around each Review panel in Play.tsx and the instructor console.
    <ErrorBoundary scope="app" resetKey={screen} note={screen === "instructor" ? "The game is safe on the server. Reload brings you straight back into this game's console." : undefined}>
      {screen === "lobby" && <Lobby onPick={setScreen} />}
      {screen === "solo" && <Solo />}
      {screen === "scenario" && <Scenarios onExit={() => setScreen("lobby")} />}
      {screen === "join" && MP_ENABLED &&
        (student ? (
          <MultiplayerPlay client={student} onExit={() => { setStudent(null); setScreen("lobby"); }} />
        ) : (
          <Join onJoined={setStudent} onBack={() => setScreen("lobby")} />
        ))}
      {screen === "player" && MP_ENABLED &&
        (student ? (
          <MultiplayerPlay client={student} onExit={() => { setStudent(null); setScreen("player"); }} />
        ) : (
          <PlayerHome onJoined={setStudent} onBack={() => setScreen("lobby")} />
        ))}
      {screen === "instructor" && MP_ENABLED && <Instructor onExit={() => setScreen("lobby")} />}
      <ModeToggle />
    </ErrorBoundary>
  );
}
