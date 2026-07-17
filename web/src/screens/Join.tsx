import { useState } from "react";
import { Button } from "../components/ui.js";
import { StudentClient, peekGame, type GamePeek } from "../game/multiplayer.js";
import { FIRM_COLORS, setPlayerColor, setPlayerEmblem } from "../lib/teamColors.js";
import { Emblem, EMBLEM_IDS, FacilityChip } from "../components/FacilityGlyph.js";

/**
 * Student join — a two-step flow so the founding options always match the game:
 *   1. Enter the join code (+ optional claim code). We PEEK the game to learn its
 *      shape without minting a user.
 *   2. Found your firm: name, house colour + mark, and — only for team games — your
 *      C-suite seat. Solo games never show the seat picker (it doesn't apply).
 * Colour/emblem apply to this student's own firm (setSelfFirm runs in MultiplayerPlay).
 */
/** C-suite seats for team games. The server slices each seat's submit by its desk
 *  (mirrors engine ROLE_DESK: ceo→all, cfo→finance, cmo→commercial, coo→operations, chro→people). */
const SEATS: { id: string; label: string; desk: string }[] = [
  { id: "ceo", label: "CEO", desk: "all desks" },
  { id: "cfo", label: "CFO", desk: "finance" },
  { id: "cmo", label: "CMO", desk: "commercial" },
  { id: "coo", label: "COO", desk: "operations" },
  { id: "chro", label: "CHRO", desk: "people" },
];

export function Join({ onJoined, onBack }: { onJoined: (c: StudentClient) => void; onBack: () => void }) {
  const [step, setStep] = useState<"enter" | "found">("enter");
  const [peek, setPeek] = useState<GamePeek | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [claim, setClaim] = useState("");
  const [role, setRole] = useState<string>("");
  const [color, setColor] = useState<string>(FIRM_COLORS[0].hex);
  const [emblem, setEmblem] = useState<string>(EMBLEM_IDS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const proceed = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await peekGame(code.trim().toUpperCase());
      setPeek(p);
      if (p.firmMode !== "team") setRole(""); // solo firms have no seats
      setStep("found");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      setPlayerColor(color);
      setPlayerEmblem(emblem);
      const c = new StudentClient();
      await c.join(code.trim().toUpperCase(), name.trim(), { claim: claim.trim() || undefined, role: role || undefined });
      await c.fetchView();
      onJoined(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      // Always clear busy — a thrown join left "Joining…" stuck forever. On success
      // onJoined unmounts us; harmless.
      setBusy(false);
    }
  };

  // ── Step 1 — enter your game ────────────────────────────────────────────────
  if (step === "enter") {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
        <div className="rise">
          <div className="eyebrow">Join a game</div>
          <h1 className="display mt-2 text-4xl font-semibold">Enter your game</h1>
          <div className="mt-1 text-sm text-inksoft">Your instructor shares a 6-character join code. Enter it to found your firm.</div>
          <div className="mt-6 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm text-inksoft">Join code</span>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="6 characters" className="uppercase tracking-[0.3em]" onKeyDown={(e) => { if (e.key === "Enter" && code.trim().length >= 4) proceed(); }} autoFocus />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-inksoft">Claim code <span className="text-[0.7rem]">· optional — if your instructor gave you one, it keeps your games &amp; history</span></span>
              <input value={claim} onChange={(e) => setClaim(e.target.value.toUpperCase())} maxLength={8} placeholder="optional" className="uppercase tracking-[0.2em]" />
            </label>
            {err && <div className="text-sm text-brick">{err}</div>}
            <div className="flex gap-2">
              <Button variant="go" onClick={proceed} disabled={busy || code.trim().length < 4}>{busy ? "Checking…" : "Continue →"}</Button>
              <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
            <div className="text-[0.72rem] text-inksoft">Already have a claim code and want to see your games? Use “Returning player” on the home screen.</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2 — found your firm ────────────────────────────────────────────────
  const isTeam = peek?.firmMode === "team";
  const complete = peek?.lifecycle === "complete";
  const display = name.trim() || "Your Brewery";
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="rise">
        <div className="eyebrow">Join a game · {code.trim().toUpperCase()}</div>
        <h1 className="display mt-2 text-4xl font-semibold">{isTeam ? "Found your team" : "Name your brewery"}</h1>
        <div className="mt-1 text-sm text-inksoft">Your colour &amp; mark are how the class reads you on the board all season.</div>

        {/* game context from the peek */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line2 bg-panel px-3 py-2 text-[0.72rem] text-inksoft">
          {peek?.title && <span className="font-semibold text-ink">{peek.title}</span>}
          <span className="rounded-full border border-line2 px-2 py-0.5 font-mono text-[0.58rem] font-bold uppercase tracking-wide text-copperdeep">{isTeam ? "Team · C-suite" : "Solo"}</span>
          <span>Round {Math.min((peek?.round ?? 0) + 1, peek?.nRounds ?? 0)} / {peek?.nRounds ?? "?"}</span>
          {peek != null && !isTeam && <span>· {peek.slotsOpen}/{peek.slotsTotal} slots open</span>}
        </div>
        {complete && <div className="mt-2 text-[0.72rem] text-brick">This game's season is already complete — you may only be able to review it.</div>}

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1"><span className="text-sm text-inksoft">Brewery name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Sediment Co." autoFocus /></label>

          {isTeam && (
            <div>
              <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">Your seat <span className="text-[0.7rem] lowercase tracking-normal text-inksoft">· each seat owns one desk — leave blank to run the whole firm</span></div>
              <div className="flex flex-wrap gap-1.5">
                {SEATS.map((s) => { const on = role === s.id; return (
                  <button key={s.id} type="button" onClick={() => setRole(on ? "" : s.id)} title={`${s.label} — ${s.desk}`} className="rounded-lg border px-2.5 py-1.5 text-left transition-colors" style={{ borderColor: on ? "var(--color-copper)" : "var(--color-line2)", background: on ? "color-mix(in srgb, var(--color-copper) 12%, var(--color-panel))" : "var(--color-panel)" }}>
                    <span className="font-mono text-[0.66rem] font-bold" style={{ color: on ? "var(--color-copperdeep)" : "var(--color-ink)" }}>{s.label}</span>
                    <span className="ml-1 text-[0.62rem] text-inksoft">{s.desk}</span>
                  </button>
                ); })}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">House colour</div>
            <div className="flex flex-wrap gap-2">
              {FIRM_COLORS.map((c) => { const on = color === c.hex; return (
                <button key={c.id} onClick={() => setColor(c.hex)} title={c.name} className="grid h-10 w-10 place-items-center rounded-[11px] transition-transform hover:scale-105" style={{ background: c.hex, border: on ? "3px solid var(--color-ink)" : "2px solid rgba(0,0,0,.12)" }}>{on && <span className="text-white">✓</span>}</button>
              ); })}
            </div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">House mark</div>
            <div className="flex flex-wrap gap-2">
              {EMBLEM_IDS.map((id) => { const on = id === emblem; return (
                <button key={id} onClick={() => setEmblem(id)} className="grid h-10 w-10 place-items-center rounded-[10px]" style={{ background: on ? color : "var(--color-panel2)", border: on ? "2px solid var(--color-ink)" : "1px solid var(--color-line)" }}><Emblem id={id} size={22} color={on ? "#fff" : "var(--color-copperdeep)"} /></button>
              ); })}
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-line2 bg-panel p-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-[12px]" style={{ background: color, border: "2px solid #fff4e0", boxShadow: `0 0 0 1px ${color}` }}><Emblem id={emblem} size={26} color="#fff" /></span>
            <div className="min-w-0"><div className="display truncate text-lg font-extrabold uppercase leading-none text-ink">{display}</div><div className="text-[0.72rem] text-inksoft">how your sites read on the board</div></div>
            <span className="flex-1" />
            <FacilityChip type="brewery_large" color={color} size={28} mine />
            <FacilityChip type="taproom" color={color} size={28} mine />
          </div>
          {err && <div className="text-sm text-brick">{err}</div>}
          <div className="flex gap-2">
            <Button variant="go" onClick={join} disabled={busy || !name.trim()}>{busy ? "Joining…" : "Join the game →"}</Button>
            <Button variant="ghost" onClick={() => { setStep("enter"); setErr(null); }}>← Different code</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
