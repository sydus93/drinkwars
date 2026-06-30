import { useEffect, useState } from "react";
import { Button, Card, Eyebrow } from "../components/ui.js";
import { InstructorClient, type InstructorStatus, type ModuleSelection } from "../game/multiplayer.js";
import { InstructorDashboard } from "./InstructorDashboard.js";
import { ModeSelector } from "./ModeSelector.js";
import { TuningBoard, tuningToOverride, tuningDefaults, type TuningVals } from "./TuningBoard.js";

/** Instructor console: passcode → create a game → share the code → lock / resolve. */
export function Instructor({ onExit }: { onExit: () => void }) {
  const [pass, setPass] = useState<string>(() => { try { return JSON.parse(localStorage.getItem("dw_instr") || "null")?.pass ?? ""; } catch { return ""; } });
  const [code, setCode] = useState<string>(() => { try { return JSON.parse(localStorage.getItem("dw_instr") || "null")?.joinCode ?? ""; } catch { return ""; } });
  const [client, setClient] = useState<InstructorClient | null>(null);
  const [nFirms, setNFirms] = useState(6);
  const [nRounds, setNRounds] = useState(16);
  const [modules, setModules] = useState<ModuleSelection>({});
  const [modCount, setModCount] = useState(0);
  const [tuneVals, setTuneVals] = useState<TuningVals>(() => tuningDefaults());
  const [showTune, setShowTune] = useState(false);
  const tuned = JSON.stringify(tuneVals) !== JSON.stringify(tuningDefaults());
  const [game, setGame] = useState<{ gameId: string; joinCode: string } | null>(null);
  const [status, setStatus] = useState<InstructorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"controls" | "dashboard">("controls");
  const [firmMode, setFirmMode] = useState<"solo" | "team">("solo");
  const [title, setTitle] = useState("");
  const [rosterText, setRosterText] = useState("");
  const [cohort, setCohort] = useState("");
  const [provisioned, setProvisioned] = useState<{ external_id: string; name: string; claim_code: string; existing: boolean }[] | null>(null);
  const [provBusy, setProvBusy] = useState(false);

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
      const g = await c.createGame(nFirms, nRounds, modules, tuned ? tuningToOverride(tuneVals) : undefined, { firmMode, title: title.trim() || undefined });
      setClient(c);
      setGame(g);
      persist(g.gameId, g.joinCode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Provision a class roster → persistent accounts + durable claim codes to hand out. */
  const provision = async () => {
    setProvBusy(true);
    setErr(null);
    try {
      const roster = rosterText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const parts = l.split(/[,\t]/).map((p) => p.trim());
        return { external_id: parts[0], name: parts.slice(1).join(" ").trim() || parts[0] };
      }).filter((r) => r.external_id);
      if (!roster.length) { setErr("Add at least one NetID, Name line"); return; }
      const c = new InstructorClient(pass);
      const r = await c.provisionRoster(roster, cohort.trim() || undefined);
      setProvisioned(r.students);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProvBusy(false);
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
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        {showTune && (
          <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "radial-gradient(120% 90% at 12% -10%, #fbf2df 0%, #ece0c4 55%, #e7d4af 100%)" }}>
            <div className="flex flex-none items-center gap-3 border-b border-line2 bg-panel px-5 py-3">
              <div><div className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-copperdeep">Instructor · balance &amp; tuning</div><div className="display text-xl font-extrabold uppercase text-ink">The Tuning Board</div></div>
              <div className="flex-1" />
              <button onClick={() => setTuneVals(tuningDefaults())} className="rounded-lg border border-line2 bg-panel2 px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wide text-inksoft">Reset all</button>
              <Button variant="go" onClick={() => setShowTune(false)}>Done</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4"><TuningBoard value={tuneVals} onChange={setTuneVals} /></div>
          </div>
        )}
        <div className="rise">
          <div className="eyebrow">Instructor</div>
          <h1 className="display mt-2 text-4xl font-semibold">New game</h1>
          <div className="mt-6 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm text-inksoft">Instructor passcode</span>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Enter your instructor passcode" />
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
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-inksoft">Game title <span className="text-[0.7rem]">· optional</span></span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Fall 26 Capstone · Game 1" />
              </label>
              <div className="grid gap-1">
                <span className="text-sm text-inksoft">Firm type</span>
                <div className="flex gap-1.5">
                  {(["solo", "team"] as const).map((m) => { const on = firmMode === m; return (
                    <button key={m} type="button" onClick={() => setFirmMode(m)} title={m === "team" ? "Several students share a firm as CEO/CFO/CMO/COO" : "One student per firm"} className="flex-1 rounded-md border px-2 py-2 font-mono text-[0.6rem] font-bold uppercase tracking-wide transition-colors" style={{ borderColor: on ? "var(--color-copper)" : "var(--color-line2)", background: on ? "color-mix(in srgb, var(--color-copper) 12%, var(--color-panel))" : "var(--color-panel)", color: on ? "var(--color-copperdeep)" : "var(--color-inksoft)" }}>{m === "solo" ? "Solo" : "Team · C-suite"}</button>
                  ); })}
                </div>
              </div>
            </div>
            <div className="rounded-md border border-line bg-paper2/40 p-3">
              <ModeSelector onChange={(m, n) => { setModules(m); setModCount(n); }} />
            </div>
            <div className="rounded-md border border-line bg-paper2/40 p-3">
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">Roster provisioning <span className="lowercase tracking-normal text-inksoft">· optional — create accounts + claim codes for return-to-game &amp; history</span></div>
              <textarea value={rosterText} onChange={(e) => setRosterText(e.target.value)} rows={3} placeholder={"NetID, Name  (one per line)\njdoe123, Jane Doe\nbsmith, Ben Smith"} className="mt-2 w-full rounded border border-line bg-panel p-2 font-mono text-[0.72rem]" />
              <div className="mt-2 flex items-center gap-2">
                <input value={cohort} onChange={(e) => setCohort(e.target.value)} maxLength={32} placeholder="Cohort (e.g. F26-CAP)" className="flex-1 text-sm" />
                <Button onClick={provision} disabled={provBusy || !pass || !rosterText.trim()}>{provBusy ? "Provisioning…" : "Provision"}</Button>
              </div>
              {provisioned && (
                <div className="mt-3">
                  <div className="mb-1 font-mono text-[0.58rem] uppercase tracking-wide text-inksoft">Distribute these claim codes — each student enters theirs on Join:</div>
                  <div className="max-h-40 overflow-y-auto rounded border border-line bg-panel">
                    {provisioned.map((s) => (
                      <div key={s.external_id} className="flex items-center justify-between border-b border-line px-2 py-1 text-[0.72rem] last:border-0">
                        <span className="text-ink">{s.name} <span className="text-inksoft">· {s.external_id}</span></span>
                        <span className="font-mono font-bold tracking-[0.15em] text-copperdeep">{s.claim_code}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setShowTune(true)} className="flex items-center justify-between rounded-md border border-line bg-paper2/40 px-3 py-2.5 text-left">
              <span className="flex items-center gap-2"><span className="text-base">⚙</span><span><span className="block text-sm font-semibold text-ink">Balance &amp; tuning</span><span className="text-[0.7rem] text-inksoft">Optional — sliders for demand, trade, shocks &amp; conduct</span></span></span>
              <span className="font-mono text-[0.62rem] uppercase tracking-wide text-copperdeep">{tuned ? "Customized →" : "Default →"}</span>
            </button>
            <Button variant="go" onClick={create} disabled={busy || !pass} className="w-full">
              {busy ? "Creating…" : modCount > 0 ? `Create game · ${modCount} module${modCount === 1 ? "" : "s"}` : "Create game · standard"}
            </Button>
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

  const LIFECYCLE_LABEL: Record<string, string> = { open: "Lobby open", locked: "Round in progress", complete: "Season complete" };
  const lcRaw = status?.lifecycle ?? "open";
  const lc = LIFECYCLE_LABEL[lcRaw] ?? lcRaw;
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
            <Button onClick={() => act(() => client!.lock(game.gameId))} disabled={busy || lcRaw !== "open"}>Lock round</Button>
            <Button onClick={() => act(() => client!.resolve(game.gameId))} disabled={busy || lcRaw !== "locked"}>Resolve round</Button>
            {lcRaw === "complete" && <span className="text-sm text-inksoft">Season complete.</span>}
          </div>
          <div className="mt-2 text-[0.72rem] text-inksoft">Lock closes submissions (open slots play as adaptive NPCs); Resolve runs the engine and opens the next round.</div>
        </>
      ) : (
        client && <InstructorDashboard client={client} gameId={game.gameId} roundKey={roundKey} />
      )}
    </div>
  );
}
