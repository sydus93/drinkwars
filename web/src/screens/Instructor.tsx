import { useEffect, useState } from "react";
import { Button, Card, Eyebrow } from "../components/ui.js";
import { MODULE_REGISTRY } from "drinkwars-engine";
import { InstructorClient, type GameSummary, type InstructorStatus, type ModuleSelection } from "../game/multiplayer.js";
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
  const [practiceRounds, setPracticeRounds] = useState(0);
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
  const [provErrors, setProvErrors] = useState<{ external_id: string; error: string }[]>([]);
  const [provBusy, setProvBusy] = useState(false);
  const [deadlineMins, setDeadlineMins] = useState<number>(20); // DW-050: minutes from now (the native datetime-local picker left its value empty when typed — Announce never enabled)
  const [moving, setMoving] = useState<{ userId: string; name: string; toTeamId: string; role: string } | null>(null); // DW-048 move dialog
  const [myGames, setMyGames] = useState<GameSummary[] | null>(null); // DW-049 game list
  const [flash, setFlash] = useState<string | null>(null); // DW-049: transient confirmations (announced/copied)
  const [seatText, setSeatText] = useState(""); // DW-050 seat plan: "NetID, Firm, Chair" per line
  const [seatResult, setSeatResult] = useState<{ seated: { external_id: string; name: string; team: string; role: string; moved: boolean }[]; errors: { external_id: string; error: string }[] } | null>(null);

  useEffect(() => {
    if (!client || !game) return;
    let live = true;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return; // DW-048: a backgrounded console doesn't poll
      try {
        const s = await client.status(game.gameId);
        if (live) setStatus(s);
      } catch {
        /* keep last status */
      }
    };
    tick();
    const h = setInterval(tick, 2500);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(h);
      document.removeEventListener("visibilitychange", onVisible);
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
      // Practice rounds ride along as the scoring accumulation window (drop_first): the round
      // header and the students' scorecard announce them; the rounds still resolve and publish.
      const tuning = tuned ? tuningToOverride(tuneVals) : {};
      const override = practiceRounds > 0 ? { ...tuning, scoring: { ...(tuning as { scoring?: object }).scoring, accumulation_window: { drop_first: practiceRounds, tail_only: null } } } : tuning;
      const g = await c.createGame(nFirms, nRounds, modules, Object.keys(override).length ? (override as typeof tuning) : undefined, { firmMode, title: title.trim() || undefined });
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
      // One student per line, "NetID, Name" (tab or comma). NetIDs are case-insensitive and
      // duplicates collapse to the first line — a re-paste is safe and idempotent.
      const seen = new Set<string>();
      const roster = rosterText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const parts = l.split(/[,\t]/).map((p) => p.trim());
        return { external_id: parts[0], name: parts.slice(1).join(" ").trim() || parts[0] };
      }).filter((r) => { const k = r.external_id.toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
      if (!roster.length) { setErr("Add at least one NetID, Name line"); return; }
      const c = new InstructorClient(pass);
      const r = await c.provisionRoster(roster, cohort.trim() || undefined);
      setProvisioned(r.students);
      setProvErrors(r.errors ?? []);
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

  // DW-049 ────────────────────────────────────────────────────────────────────
  const flashMsg = (m: string) => { setFlash(m); window.setTimeout(() => setFlash((f) => (f === m ? null : f)), 2500); };
  const copy = (s: string, what = "Copied ✓") => { try { navigator.clipboard?.writeText(s); flashMsg(what); } catch { /* ignore */ } };
  const loadGames = async () => {
    setBusy(true);
    setErr(null);
    try { setMyGames((await new InstructorClient(pass).listGames()).games); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const openGame = (g: GameSummary) => {
    const c = new InstructorClient(pass);
    setClient(c);
    setGame({ gameId: g.gameId, joinCode: g.joinCode ?? "" });
    persist(g.gameId, g.joinCode ?? "");
  };
  const rename = () => {
    const t = window.prompt("Game title (blank to clear)", status?.title ?? "");
    if (t === null || !client || !game) return;
    act(() => client.rename(game.gameId, t.trim() || null));
  };
  const exportCsv = async () => {
    if (!client || !game) return;
    try {
      const blob = await client.exportData(game.gameId, "csv");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `drinkwars-${(status?.title || game.joinCode).replace(/[^\w-]+/g, "_")}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const copyCodes = () => {
    const lines = (status?.teams ?? []).flatMap((t) => (t.members ?? []).map((m) => [t.name, m.name, m.externalId ?? "", m.role?.toUpperCase() ?? "", m.claim ?? ""].join("\t")));
    copy(["Firm\tName\tNetID\tSeat\tReturn code", ...lines].join("\n"), `Copied ${lines.length} return codes ✓`);
  };
  const applySeats = async () => {
    if (!client || !game) return;
    // "NetID, Firm, Chair" or "NetID, Name, Firm, Chair" — a Name column provisions the
    // account on the fly (idempotent), so one paste does roster + seats.
    const rows = seatText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const p = l.split(/[,\t]/).map((x) => x.trim()); return p.length >= 4 ? { external_id: p[0], name: p[1], team: p[2], role: p[3].toLowerCase() } : { external_id: p[0] ?? "", name: "", team: p[1] ?? "", role: (p[2] ?? "").toLowerCase() }; });
    if (!rows.length) { setErr("Add at least one NetID, Firm, Chair line"); return; }
    setBusy(true); setErr(null);
    try {
      const named = rows.filter((r) => r.name);
      if (named.length) await client.provisionRoster(named.map((r) => ({ external_id: r.external_id, name: r.name })), cohort.trim() || undefined);
      const r = await client.applySeatPlan(game.gameId, rows.map(({ external_id, team, role }) => ({ external_id, team, role }))); setSeatResult(r); setStatus(await client.status(game.gameId)); flashMsg(`Seated ${r.seated.length}${r.errors.length ? ` · ${r.errors.length} row${r.errors.length === 1 ? "" : "s"} need attention` : " ✓"}`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const fmtCountdown = (ms: number) => { const m = Math.floor(ms / 60000); return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

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
            <label className="grid gap-1">
              <span className="text-sm text-inksoft">Practice rounds <span className="text-[0.7rem]">· played and published, but not scored — the round header and each team's scorecard say so</span></span>
              <input type="number" min={0} max={Math.max(0, nRounds - 1)} value={practiceRounds} onChange={(e) => setPracticeRounds(Math.max(0, Math.min(Math.max(0, nRounds - 1), Math.round(+e.target.value || 0))))} className="w-24" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-inksoft">Game title <span className="text-[0.7rem]">· optional</span></span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Fall 26 Capstone · Game 1" />
              </label>
              <div className="grid gap-1">
                <span className="text-sm text-inksoft">Firm type</span>
                <div className="flex gap-1.5">
                  {(["solo", "team"] as const).map((m) => { const on = firmMode === m; return (
                    <button key={m} type="button" onClick={() => setFirmMode(m)} title={m === "team" ? "Several students share a firm as CEO/CFO/CMO/COO/CHRO" : "One student per firm"} className="flex-1 rounded-md border px-2 py-2 font-mono text-[0.6rem] font-bold uppercase tracking-wide transition-colors" style={{ borderColor: on ? "var(--color-copper)" : "var(--color-line2)", background: on ? "color-mix(in srgb, var(--color-copper) 12%, var(--color-panel))" : "var(--color-panel)", color: on ? "var(--color-copperdeep)" : "var(--color-inksoft)" }}>{m === "solo" ? "Solo" : "Team · C-suite"}</button>
                  ); })}
                </div>
              </div>
            </div>
            <div className="rounded-md border border-line bg-paper2/40 p-3">
              <ModeSelector onChange={(m, n) => { setModules(m); setModCount(n); }} />
            </div>
            <div className="rounded-md border border-line bg-paper2/40 p-3">
              <div className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">Roster <span className="lowercase tracking-normal text-inksoft">· optional — semester identities (NetID → return code), independent of any game. Skip it if you'll paste a seat plan with names inside the game.</span></div>
              <textarea value={rosterText} onChange={(e) => setRosterText(e.target.value)} rows={3} placeholder={"NetID, Name  (one per line)\njdoe123, Jane Doe\nbsmith, Ben Smith"} className="mt-2 w-full rounded border border-line bg-panel p-2 font-mono text-[0.72rem]" />
              <div className="mt-2 flex items-center gap-2">
                <input value={cohort} onChange={(e) => setCohort(e.target.value)} maxLength={32} placeholder="Cohort (e.g. F26-CAP)" className="flex-1 text-sm" />
                <Button onClick={provision} disabled={provBusy || !pass || !rosterText.trim()}>{provBusy ? "Provisioning…" : "Provision"}</Button>
              </div>
              {provErrors.length > 0 && (
                <div className="mt-2 rounded border border-brick/50 bg-brick/10 px-2 py-1.5 text-[0.72rem] text-ink">
                  {provErrors.length} row{provErrors.length === 1 ? "" : "s"} could not be provisioned — the rest went through. Fix and re-paste just these:
                  {provErrors.map((e) => <div key={e.external_id} className="font-mono text-[0.68rem]">{e.external_id}: {e.error}</div>)}
                </div>
              )}
              {provisioned && (
                <div className="mt-3">
                  <div className="mb-1 font-mono text-[0.58rem] uppercase tracking-wide text-inksoft">Distribute these claim codes — each student enters theirs on Join ({provisioned.filter((s) => s.existing).length} already had accounts; their codes are unchanged):</div>
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
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-inksoft">Your games <span className="text-[0.7rem]">· resume, export, or check on any past game</span></span>
                <Button variant="ghost" onClick={loadGames} disabled={busy || !pass}>{myGames ? "Refresh" : "Show my games"}</Button>
              </div>
              {myGames && (myGames.length === 0 ? <div className="text-[0.72rem] text-inksoft">No games under this passcode yet.</div> : (
                <div className="max-h-64 overflow-y-auto rounded border border-line bg-panel">
                  {myGames.map((g) => (
                    <div key={g.gameId} className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-[0.74rem] last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ink">{g.title || <span className="text-inksoft">Untitled</span>} <span className="font-mono text-inksoft">· {g.joinCode}</span></div>
                        <div className="text-[0.66rem] text-inksoft">{g.lifecycle === "complete" ? "Complete" : `Round ${Math.min(g.round + 1, g.nRounds)}`} / {g.nRounds} · {g.firmMode === "team" ? "teams" : "solo"} · {g.joined}/{g.nFirms} firms · {g.players} player{g.players === 1 ? "" : "s"} · {new Date(g.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
                      </div>
                      <Button variant="ghost" onClick={() => openGame(g)} disabled={busy}>Open</Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {err && <div className="text-sm text-brick">{err}</div>}
            <div><Button variant="ghost" onClick={onExit}>Back</Button></div>
          </div>
        </div>
      </div>
    );
  }

  const LIFECYCLE_LABEL: Record<string, string> = { open: "Submissions open", locked: "Locked — ready to resolve", resolving: "Resolving…", published: "Resolved — opening next round", complete: "Season complete" };
  const lcRaw = status?.lifecycle ?? "open";
  const lc = LIFECYCLE_LABEL[lcRaw] ?? lcRaw;
  const joined = status?.teams.filter((t) => t.joined).length ?? 0;
  const slots = status?.teams.length ?? nFirms;
  const isTeam = status?.firmMode === "team";

  const roundKey = `${status?.round ?? 0}:${status?.lifecycle ?? "open"}`;

  return (
    <div className={`mx-auto ${view === "dashboard" ? "max-w-6xl" : "max-w-3xl"} px-4 py-8 sm:px-6`}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line2 pb-4">
        <div>
          <div className="eyebrow">Instructor · {lc}</div>
          <h1 className="display text-3xl font-semibold">Round {Math.min((status?.round ?? 0) + 1, status?.nRounds ?? nRounds)} / {status?.nRounds ?? nRounds}</h1>
          <div className="mt-1 text-sm text-inksoft">{status?.title || <span className="italic">Untitled game</span>} <button onClick={rename} disabled={!status} className="ml-1 font-mono text-[0.6rem] uppercase tracking-wide text-copperdeep hover:underline">✎ rename</button></div>
        </div>
        <div className="flex items-center gap-3">
          {flash && <span className="rounded-md border border-hop/50 bg-hop/10 px-2 py-1 text-[0.72rem] text-ink">{flash}</span>}
          <Button variant="ghost" onClick={onExit}>Leave</Button>
        </div>
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

          {isTeam && lcRaw !== "complete" && (
            <Card className="mt-4">
              <Eyebrow>Seat plan · optional</Eyebrow>
              <div className="mt-1 text-[0.72rem] text-inksoft">Pre-assign this game's firms and chairs. One line per student: <span className="font-mono">NetID, Name, Firm, Chair</span> (chair = CEO · CFO · CMO · COO · CHRO; Name may be omitted for students already on the roster). This creates any missing accounts, seats everyone, and their return codes appear on the Brewers card above. Firm is just a working label for who sits together (<span className="font-mono">Group 1</span> is fine) — the CEO names the brewery and picks its colour/mark when they first arrive; nobody else sees your label after that. Re-paste to move people. Students then open the site → Join → join code + return code → straight to their chair.</div>
              <textarea value={seatText} onChange={(e) => setSeatText(e.target.value)} rows={6} placeholder={"jdoe1, Jane Doe, Group 1, CEO\nasmith2, Al Smith, Group 1, CFO\nbwong3, Bo Wong, Group 2, CEO"} className="mt-2 w-full font-mono text-[0.72rem]" />
              <div className="mt-2 flex items-center gap-2">
                <Button onClick={applySeats} disabled={busy || !seatText.trim()}>Apply seat plan</Button>
                {seatResult && <span className="text-[0.72rem] text-inksoft">{seatResult.seated.length} seated{seatResult.seated.some((s) => s.moved) ? ` (${seatResult.seated.filter((s) => s.moved).length} moved)` : ""}{seatResult.errors.length ? ` · ${seatResult.errors.length} not seated` : ""}</span>}
              </div>
              {seatResult && seatResult.errors.length > 0 && (
                <div className="mt-2 rounded border border-brick/50 bg-brick/10 px-2 py-1.5 text-[0.72rem] text-ink">
                  Fix and re-paste just these:
                  {seatResult.errors.map((e, i) => <div key={i} className="font-mono text-[0.68rem]">{e.external_id}: {e.error}</div>)}
                </div>
              )}
            </Card>
          )}

          {/* DW-049: what this game was configured with — the instructor couldn't see it mid-game. */}
          <Card className="mt-4">
            <Eyebrow>Set-up · fixed at creation</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.76rem] text-ink">
              <span><b>{status?.nFirms ?? slots}</b> firms</span>
              <span><b>{status?.nRounds ?? nRounds}</b> rounds{(status?.practiceRounds ?? 0) > 0 ? ` (${status?.practiceRounds} practice)` : ""}</span>
              <span>{isTeam ? "Team · C-suite" : "Solo"}</span>
              {status?.createdAt ? <span className="text-inksoft">created {new Date(status.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(status?.modules ?? []).length === 0
                ? <span className="text-[0.7rem] text-inksoft">Standard game — no expansion modules.</span>
                : (status?.modules ?? []).map((id) => { const meta = MODULE_REGISTRY.find((m) => m.id === id); return <span key={id} title={meta?.blurb} className="rounded border border-line2 bg-panel2 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">{meta?.name ?? id}</span>; })}
            </div>
            <div className="mt-1 text-[0.68rem] text-inksoft">Modules and tuning are baked into the world at creation — to change them, create a new game. Siting facilities within a city needs <i>Facilities &amp; physical capacity</i>; poaching needs <i>Employees &amp; human capital</i> plus market research that round.</div>
          </Card>

          <Card className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>Brewers · {joined}/{slots} slots claimed{isTeam ? " · per chair" : ""}</Eyebrow>
              {joined > 0 && <button onClick={copyCodes} title="Copy every player's return code as a tab-separated list (paste into a sheet or email)" className="font-mono text-[0.6rem] uppercase tracking-wide text-copperdeep hover:underline">Copy return codes</button>}
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {(status?.teams ?? []).map((t) => (
                <div key={t.teamId} className="border-b border-line py-1 text-sm last:border-0">
                  <div className="flex items-center justify-between">
                    <span className={t.joined ? "font-semibold" : "text-inksoft"}>{t.joined ? t.name : "— open slot —"}</span>
                    <span className="font-mono text-[0.7rem] text-inksoft">
                      {!t.joined ? "open · NPC at lock" : status?.nonSubmitters.includes(t.teamId) ? "waiting" : "submitted"}
                    </span>
                  </div>
                  {/* DW-048: every chair with its own submit state + remove/move — a wrong-firm join
                      or a dropped student used to be permanent. */}
                  {(t.members ?? []).map((m) => (
                    <div key={m.userId} className="ml-2 mt-0.5 flex items-center gap-2 text-[0.72rem]">
                      <span className={m.submitted ? "text-hop" : "text-inksoft"} title={m.submitted ? "submitted this round" : "nothing submitted this round"}>{m.submitted ? "●" : "○"}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{m.name}{m.externalId ? <span className="text-inksoft"> · {m.externalId}</span> : null}</span>
                      {m.claim && <button onClick={() => copy(m.claim!, `Copied ${m.name}'s return code ✓`)} title="Return code — click to copy; the student enters it under “Returning player” on any device" className="font-mono text-[0.62rem] tracking-[0.12em] text-copperdeep hover:underline">{m.claim}</button>}
                      {m.role && <span className="font-mono text-[0.58rem] uppercase text-copperdeep">{m.role}</span>}
                      {isTeam && <button onClick={() => setMoving({ userId: m.userId, name: m.name, toTeamId: t.teamId, role: m.role ?? "" })} disabled={busy} className="font-mono text-[0.58rem] uppercase text-inksoft hover:text-copper">move</button>}
                      <button onClick={() => { if (window.confirm(`Remove ${m.name} from ${t.name}? Their seat frees up and anything they submitted this round is dropped. They can re-join with their claim code.`)) act(() => client!.removeMember(game.gameId, t.teamId, m.userId)); }} disabled={busy} className="font-mono text-[0.58rem] uppercase text-inksoft hover:text-brick">remove</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {moving && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-copper/50 bg-panel2 p-2 text-[0.78rem]">
                <span>Move <b>{moving.name}</b> to</span>
                <select value={moving.toTeamId} onChange={(e) => setMoving({ ...moving, toTeamId: e.target.value })} className="text-sm">
                  {(status?.teams ?? []).map((t) => <option key={t.teamId} value={t.teamId}>{t.joined ? t.name : `— open slot — (${t.name})`}</option>)}
                </select>
                <span>as</span>
                <select value={moving.role} onChange={(e) => setMoving({ ...moving, role: e.target.value })} className="text-sm">
                  <option value="">seat…</option>
                  {["ceo", "cfo", "cmo", "coo", "chro"].map((r) => {
                    const taken = (status?.teams.find((t) => t.teamId === moving.toTeamId)?.members ?? []).some((m) => m.role === r && m.userId !== moving.userId);
                    return <option key={r} value={r} disabled={taken}>{r.toUpperCase()}{taken ? " (taken)" : ""}</option>;
                  })}
                </select>
                <Button onClick={() => { const mv = moving; setMoving(null); act(() => client!.moveMember(game.gameId, mv.userId, mv.toTeamId, mv.role)); }} disabled={busy || !moving.role}>Move</Button>
                <Button variant="ghost" onClick={() => setMoving(null)}>Cancel</Button>
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <Eyebrow>Submission deadline · this round</Eyebrow>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {status?.deadlineAt ? (
                <span className="text-ink">Announced: <b>{new Date(status.deadlineAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>{status.deadlineAt < Date.now() ? <span className="text-brick"> · passed</span> : <span className="text-inksoft"> · {fmtCountdown(status.deadlineAt - Date.now())} left</span>}</span>
              ) : (
                <span className="text-inksoft">None announced — students see no countdown.</span>
              )}
              <span className="flex-1" />
              <span className="flex items-center gap-1 text-[0.72rem] text-inksoft">
                {[10, 20, 30, 45, 60].map((m) => <button key={m} type="button" onClick={() => setDeadlineMins(m)} className={`rounded border px-1.5 py-0.5 font-mono text-[0.6rem] ${deadlineMins === m ? "border-copper text-copperdeep" : "border-line2 text-inksoft hover:text-ink"}`}>{m}m</button>)}
                <input type="number" min={1} max={1440} value={deadlineMins} onChange={(e) => setDeadlineMins(Math.max(1, Math.min(1440, Math.round(+e.target.value || 0))))} className="w-16 text-sm" aria-label="minutes from now" />
                <span>min from now → <b className="text-ink">{new Date(Date.now() + deadlineMins * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b></span>
              </span>
              <Button onClick={() => { const t = Date.now() + deadlineMins * 60000; act(() => client!.setDeadline(game.gameId, t).then(() => flashMsg("Deadline announced ✓ — students now see a countdown in their round banner"))); }} disabled={busy || lcRaw !== "open"}>Announce</Button>
              {status?.deadlineAt ? <Button variant="ghost" onClick={() => act(() => client!.setDeadline(game.gameId, null))} disabled={busy}>Clear</Button> : null}
            </div>
            <div className="mt-1 text-[0.7rem] text-inksoft">Display-only: students see "⏱ Deadline 2:40 PM — 18 min left" leading their round banner. You still lock by hand; the deadline clears when the next round opens. Announce again to extend.</div>
          </Card>

          {err && <div className="mt-3 text-sm text-brick">{err}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => {
              const missing = (status?.teams ?? []).filter((t) => t.joined && status?.nonSubmitters.includes(t.teamId)).map((t) => t.name);
              const q = missing.length
                ? `Lock round ${(status?.round ?? 0) + 1}? ${missing.length} claimed firm${missing.length === 1 ? " hasn't" : "s haven't"} submitted (${missing.join(", ")}) — they'll trade on last quarter's standing plan. You can Unlock if this is a mistake.`
                : `Lock round ${(status?.round ?? 0) + 1}? Every claimed firm has submitted. Students can no longer revise.`;
              if (window.confirm(q)) act(() => client!.lock(game.gameId));
            }} disabled={busy || lcRaw !== "open"}>Lock round</Button>
            {lcRaw === "locked" && <Button variant="ghost" onClick={() => act(() => client!.unlock(game.gameId))} disabled={busy}>Unlock</Button>}
            <Button onClick={() => { if (window.confirm(`Resolve round ${(status?.round ?? 0) + 1}? This runs the engine and publishes results to every student — it cannot be undone.`)) act(() => client!.resolve(game.gameId)); }} disabled={busy || lcRaw !== "locked"}>Resolve round</Button>
            {lcRaw === "resolving" && <Button variant="ghost" onClick={() => act(() => client!.resolve(game.gameId, { force: true }))} disabled={busy}>Retry resolve</Button>}
            {lcRaw === "published" && <Button variant="ghost" onClick={() => act(() => client!.advance(game.gameId))} disabled={busy}>Open next round</Button>}
            {lcRaw === "complete" && <span className="text-sm text-inksoft">Season complete — export the data or start a new game.</span>}
            <span className="flex-1" />
            <Button variant="ghost" onClick={exportCsv} disabled={busy}>Export CSV</Button>
            {lcRaw !== "complete" && (
              <Button variant="ghost" onClick={() => { if (window.confirm(`End this game now? The season closes after round ${status?.round ?? 0} of ${status?.nRounds ?? nRounds}. Students see “Season complete”; results, the dashboard and the CSV export stay available. This cannot be undone.`)) act(() => client!.endGame(game.gameId)); }} disabled={busy || lcRaw === "resolving"}>End game</Button>
            )}
          </div>
          <div className="mt-2 text-[0.72rem] text-inksoft">
            Lock closes submissions (open slots play as adaptive NPCs; a claimed team that missed the deadline carries last quarter's standing plan) — Unlock re-opens it; Resolve runs the engine and opens the next round.
            {lcRaw === "resolving" && <span className="text-brick"> If this stays on “Resolving…” for more than a few seconds the call was interrupted — Retry resolve re-runs the same round safely.</span>}
          </div>
        </>
      ) : (
        client && <InstructorDashboard client={client} gameId={game.gameId} roundKey={roundKey} />
      )}
    </div>
  );
}
