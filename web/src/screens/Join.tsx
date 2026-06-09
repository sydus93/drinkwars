import { useState } from "react";
import { Button } from "../components/ui.js";
import { StudentClient } from "../game/multiplayer.js";

/** Student join screen: 6-character code + display (brewery) name. */
export function Join({ onJoined, onBack }: { onJoined: (c: StudentClient) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = new StudentClient();
      await c.join(code.trim().toUpperCase(), name.trim() || "Anonymous");
      await c.fetchView();
      onJoined(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="rise">
        <div className="eyebrow">Join a game</div>
        <h1 className="display mt-2 text-4xl font-semibold">Enter the room</h1>
        <div className="mt-6 grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm text-inksoft">Join code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="6 characters" className="uppercase tracking-[0.3em]" />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-inksoft">Your brewery name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Sediment Co." />
          </label>
          {err && <div className="text-sm text-brick">{err}</div>}
          <div className="flex gap-2">
            <Button onClick={join} disabled={busy || code.trim().length < 4}>{busy ? "Joining…" : "Join →"}</Button>
            <Button variant="ghost" onClick={onBack}>Back</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
