import { useState } from "react";
import { Button, Card, Eyebrow, Stat } from "../components/ui.js";
import { StudentClient, fetchMyGames, type MyGame } from "../game/multiplayer.js";

/**
 * Returning-player home: enter your claim code → your career summary + every game
 * you're in. Rejoin an active game (resumes your same firm/seat) or review a finished
 * one. The claim code is the durable credential the instructor handed out (roster
 * provisioning); it's remembered locally so the next visit skips the prompt.
 */
export function PlayerHome({ onJoined, onBack }: { onJoined: (c: StudentClient) => void; onBack: () => void }) {
  const [claim, setClaim] = useState<string>(() => { try { return localStorage.getItem("dw_claim") ?? ""; } catch { return ""; } });
  const [player, setPlayer] = useState<{ name: string | null; external_id: string | null } | null>(null);
  const [games, setGames] = useState<MyGame[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async (c: string) => {
    const code = c.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchMyGames(code);
      setPlayer(r.player);
      setGames(r.games);
      try { localStorage.setItem("dw_claim", code); } catch { /* ignore */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setGames(null);
    } finally {
      setBusy(false);
    }
  };

  const rejoin = async (g: MyGame) => {
    if (!g.joinCode) { setErr("This game has no join code."); return; }
    setJoining(g.gameId);
    setErr(null);
    try {
      const c = new StudentClient();
      await c.join(g.joinCode, player?.name ?? "Player", { claim: claim.trim().toUpperCase() });
      await c.fetchView();
      onJoined(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setJoining(null);
    }
  };

  // Career rollup across games with a recorded standing.
  const ranked = (games ?? []).filter((g) => g.rank != null);
  const wins = ranked.filter((g) => g.rank === 1).length;
  const best = ranked.length ? Math.min(...ranked.map((g) => g.rank!)) : null;
  const avg = ranked.length ? Math.round((ranked.reduce((a, g) => a + g.rank!, 0) / ranked.length) * 10) / 10 : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <div className="rise">
        <div className="eyebrow">Returning player</div>
        <h1 className="display mt-2 text-4xl font-semibold">Your games</h1>
        <div className="mt-1 text-sm text-inksoft">Enter the claim code your instructor gave you to pick up where you left off.</div>

        <div className="mt-6 flex gap-2">
          <input value={claim} onChange={(e) => setClaim(e.target.value.toUpperCase())} maxLength={8} placeholder="Claim code" className="flex-1 uppercase tracking-[0.2em]" onKeyDown={(e) => { if (e.key === "Enter") load(claim); }} />
          <Button variant="go" onClick={() => load(claim)} disabled={busy || claim.trim().length < 4}>{busy ? "Loading…" : "Find my games"}</Button>
        </div>
        {err && <div className="mt-3 text-sm text-brick">{err}</div>}

        {player && games && (
          <>
            <Card className="mt-5">
              <Eyebrow>{player.name ?? "Player"}{player.external_id ? ` · ${player.external_id}` : ""}</Eyebrow>
              <div className="mt-2 flex flex-wrap gap-6">
                <Stat label="Games" value={String(games.length)} />
                <Stat label="Finished" value={String(games.filter((g) => g.complete).length)} />
                <Stat label="Wins" value={String(wins)} accent="copper" />
                <Stat label="Best finish" value={best != null ? `#${best}` : "—"} />
                <Stat label="Avg rank" value={avg != null ? `#${avg}` : "—"} />
              </div>
            </Card>

            <div className="mt-4 grid gap-2">
              {games.length === 0 && <Card><div className="text-sm text-inksoft">No games yet. Join one with its code below.</div></Card>}
              {games.map((g) => (
                <Card key={g.gameId} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{g.title || g.teamName || "Untitled game"}</div>
                    <div className="text-[0.72rem] text-inksoft">
                      {g.teamName} · round {Math.min(g.round + 1, g.nRounds)}/{g.nRounds}
                      {g.rank != null && <> · <span className="text-copperdeep">#{g.rank}</span></>}
                      {g.status && g.status !== "active" && <> · {g.status.replace(/_/g, " ")}</>}
                    </div>
                  </div>
                  <span className="rounded-full border px-2 py-0.5 font-mono text-[0.55rem] font-bold uppercase tracking-wide" style={{ borderColor: g.complete ? "var(--color-line2)" : "var(--color-copper)", color: g.complete ? "var(--color-inksoft)" : "var(--color-copperdeep)" }}>{g.complete ? "Complete" : "Active"}</span>
                  <Button variant={g.complete ? "ghost" : "go"} onClick={() => rejoin(g)} disabled={joining === g.gameId}>{joining === g.gameId ? "…" : g.complete ? "Review" : "Rejoin"}</Button>
                </Card>
              ))}
            </div>
          </>
        )}

        <div className="mt-6"><Button variant="ghost" onClick={onBack}>Back</Button></div>
      </div>
    </div>
  );
}
