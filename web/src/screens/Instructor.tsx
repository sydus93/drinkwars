import { useEffect, useState } from "react";
import { Button, Card, Eyebrow } from "../components/ui.js";
import { InstructorClient, type InstructorStatus } from "../game/multiplayer.js";
import { InstructorDashboard } from "./InstructorDashboard.js";

/** Instructor console: passcode → create a game → share the code → lock / resolve. */
export function Instructor({ onExit }: { onExit: () => void }) {
  const [pass, setPass] = useState<string>(() => { try { return JSON.parse(localStorage.getItem("dw_instr") || "null")?.pass ?? ""; } catch { return ""; } });
  const [code, setCode] = useState<string>(() => { try { return JSON.parse(localStorage.getItem("dw_instr") || "null")?.joinCode ?? ""; } catch { return ""; } });
  const [client, setClient] = useState<InstructorClient | null>(null);
  const [nFirms, setNFirms] = useState(6);
  const [nRounds, setNRounds] = useState(16);
  const [game, setGame] = useState<{ gameId: string; joinCode: string } | null>(null);
  const [status, setStatus] = useState<InstructorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"controls" | "dashboard">("controls");

  useEffect(() => {
    if (!client || !game) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await client.status(game.gameId);
        if (live) setStatus(s);
      } catch {
        /* keep last status */
      }
    };
    tick();
    const h = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(h);
    };
  }, [client, game]);

  const persist = (gameId: string, joinCode: string) => {
    try {
      localStorage.setItem("dw_instr", JSON.stringify({ pass, gameId, joinCode }));
    } catch {
      /* ignore */
    }
  };

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = new InstructorClient(pass);
      const g = await c.createGame(nFirms, nRounds);
      setClient(c);
      setGame(g);
      persist(g.gameId, g.joinCode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = new InstructorClient(pass);
      const g = await c.resume(code.trim().toUpperCase());
      setClient(c);
      setGame({ gameId: g.gameId, joinCode: g.joinCode });
      persist(g.gameId, g.joinCode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      if (client && game) setStatus(await client.status(game.gameId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!game) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <div className="rise">
          <div className="eyebrow">Instructor</div>
          <h1 className="display mt-2 text-4xl font-semibold">New game</h1>
          <div className="mt-6 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm text-inksoft">Instructor passcode</span>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="set by whoever runs the server" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-inksoft">Firms (slots)</span>
                <input type="number" min={2} max={12} value={nFirms} onChange={(e) => setNFirms(Math.max(2, Math.min(12, +e.target.value)))} />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-inksoft">Rounds</span>
                <input type="number" min={1} max={30} value={nRounds} onChange={(e) => setNRounds(Math.max(1, Math.min(30, +e.target.value)))} />
              </label>
            </div>
            <Button variant="go" onClick={create} disabled={busy || !pass} className="w-full">{busy ? "Creating…" : "Create game"}</Button>
            <div className="flex items-center gap-3 text-[0.64rem] tracking-wide text-inksoft">
              <div className="h-px flex-1 bg-line" />OR RESUME A RUNNING GAME<div className="h-px flex-1 bg-line" />
            </div>
            <label className="grid gap-1">
              <span className="text-sm text-inksoft">Join code of a game in progress</span>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="6 characters" className="flex-1 uppercase tracking-[0.2em]" />
                <Button onClick={resume} disabled={busy || !pass || code.trim().length < 4}>Resume</Button>
              </div>
            </label>
            {err && <div className="text-sm text-brick">{err}</div>}
            <div><Button variant="ghost" onClick={onExit}>Back</Button></div>
          </div>
        </div>
      </div>
    );
  }

  const lc = status?.lifecycle ?? "open";
  const joined = status?.teams.filter((t) => t.joined).length ?? 0;
  const slots = status?.teams.length ?? nFirms;

  const roundKey = `${status?.round ?? 0}:${status?.lifecycle ?? "open"}`;

  return (
    <div className={`mx-auto ${view === "dashboard" ? "max-w-6xl" : "max-w-3xl"} px-4 py-8 sm:px-6`}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line2 pb-4">
        <div>
          <div className="eyebrow">Instructor · {lc}</div>
          <h1 className="display text-3xl font-semibold">Round {Math.min((status?.round ?? 0) + 1, status?.nRounds ?? nRounds)} / {status?.nRounds ?? nRounds}</h1>
        </div>
        <Button variant="ghost" onClick={onExit}>Leave</Button>
      </header>

      <div className="mb-4 flex gap-1 border-b border-line">
        {(["controls", "dashboard"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 px-4 py-2 font-mono text-sm tracking-wide transition-colors ${view === v ? "border-copper text-copperdeep" : "border-transparent text-inksoft hover:text-ink"}`}
          >
            {v === "controls" ? "Controls" : "Dashboard"}
          </button>
        ))}
      </div>

      {view === "controls" ? (
        <>
          <Card className="text-center">
            <Eyebrow>Share this join code</Eyebrow>
            <div className="wordmark mt-1 text-5xl tracking-[0.18em] text-copper">{game.joinCode}</div>
            <div className="mt-1 text-[0.72rem] text-inksoft">Players: open this site → Join a game → enter the code.</div>
          </Card>

          <Card className="mt-4">
            <Eyebrow>Brewers · {joined}/{slots} slots claimed</Eyebrow>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {(status?.teams ?? []).map((t) => (
                <div key={t.teamId} className="flex items-center justify-between border-b border-line py-1 text-sm last:border-0">
                  <span className={t.joined ? "font-semibold" : "text-inksoft"}>{t.joined ? t.name : "— open slot —"}</span>
                  <span className="font-mono text-[0.7rem] text-inksoft">
                    {!t.joined ? "open" : status?.nonSubmitters.includes(t.teamId) ? "waiting" : "submitted"}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {err && <div className="mt-3 text-sm text-brick">{err}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => act(() => client!.lock(game.gameId))} disabled={busy || lc !== "open"}>Lock round</Button>
            <Button onClick={() => act(() => client!.resolve(game.gameId))} disabled={busy || lc !== "locked"}>Resolve round</Button>
            {lc === "complete" && <span className="text-sm text-inksoft">Season complete.</span>}
          </div>
          <div className="mt-2 text-[0.72rem] text-inksoft">Lock closes submissions (open slots play as adaptive NPCs); Resolve runs the engine and opens the next round.</div>
        </>
      ) : (
        client && <InstructorDashboard client={client} gameId={game.gameId} roundKey={roundKey} />
      )}
    </div>
  );
}
