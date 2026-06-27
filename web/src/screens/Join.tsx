import { useState } from "react";
import { Button } from "../components/ui.js";
import { StudentClient } from "../game/multiplayer.js";
import { FIRM_COLORS, setPlayerColor, setPlayerEmblem } from "../lib/teamColors.js";
import { Emblem, EMBLEM_IDS, FacilityChip } from "../components/FacilityGlyph.js";

/** Student join + create-a-firm: code + name, then house colour + mark with a live preview.
 *  Colour/emblem apply to this student's own firm (setSelfFirm runs in MultiplayerPlay). */
export function Join({ onJoined, onBack }: { onJoined: (c: StudentClient) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FIRM_COLORS[0].hex);
  const [emblem, setEmblem] = useState<string>(EMBLEM_IDS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      setPlayerColor(color);
      setPlayerEmblem(emblem);
      const c = new StudentClient();
      await c.join(code.trim().toUpperCase(), name.trim() || "Anonymous");
      await c.fetchView();
      onJoined(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const display = name.trim() || "Your Brewery";
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="rise">
        <div className="eyebrow">Join a game</div>
        <h1 className="display mt-2 text-4xl font-semibold">Found your team</h1>
        <div className="mt-1 text-sm text-inksoft">Your colour &amp; mark are how the class reads you on the board all season.</div>
        <div className="mt-6 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1"><span className="text-sm text-inksoft">Join code</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="6 characters" className="uppercase tracking-[0.3em]" /></label>
            <label className="grid gap-1"><span className="text-sm text-inksoft">Brewery name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Sediment Co." /></label>
          </div>
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
            <Button variant="go" onClick={join} disabled={busy || code.trim().length < 4}>{busy ? "Joining…" : "Join the game →"}</Button>
            <Button variant="ghost" onClick={onBack}>Back</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
