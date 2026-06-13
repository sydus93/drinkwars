import { useState } from "react";
import type { Difficulty } from "../game/controller.js";
import { Button } from "../components/ui.js";
import { CategoryCoin } from "../components/CategoryIcons.js";
import { ModeSelector } from "./ModeSelector.js";
import type { ModuleSelection } from "../game/multiplayer.js";

const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "relaxed", label: "Relaxed", blurb: "A gentler field — room to find your footing." },
  { id: "competitive", label: "Competitive", blurb: "A balanced field that pushes back." },
  { id: "cutthroat", label: "Cutthroat", blurb: "Aggressive rivals that crowd whatever's working." },
];

export function Setup({ onStart, busy }: { onStart: (name: string, difficulty: Difficulty, modules: ModuleSelection) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("competitive");
  const [showModes, setShowModes] = useState(false);
  const [modules, setModules] = useState<ModuleSelection>({});
  const [modCount, setModCount] = useState(0);
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rise">
        <div className="eyebrow">A craft-beverage strategy simulation</div>
        <h1 className="wordmark mt-2 text-6xl leading-[0.95] text-ink sm:text-7xl">
          Drink<span className="text-copper">&nbsp;Wars</span>
        </h1>
        <div className="mt-4 h-px w-24 bg-copper" />
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-inksoft">
          Run a craft beverage company competing for drinkers across a regional market. Brew your lineup, build capacity, invest in
          quality and brand, and manage your taproom, distributors, and regulators across a sixteen-round season — and adapt as the
          market shifts around you.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {([
            { seg: "mass", t: "Lagers & Light", d: "Lagers, light beers, the familiar pours." },
            { seg: "niche", t: "Craft Premium", d: "IPAs, stouts, and small-batch specialties." },
            { seg: "frontier", t: "Non-Alc / Functional", d: "Non-alcoholic, functional, and zero-proof." },
          ] as const).map((c) => (
            <div key={c.t} className="card p-3">
              <div className="flex items-center gap-2">
                <CategoryCoin seg={c.seg} size={30} />
                <div className="font-semibold">{c.t}</div>
              </div>
              <div className="mt-1 text-[0.8rem] text-inksoft">{c.d}</div>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <div className="eyebrow mb-2">Rival difficulty</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {DIFFICULTIES.map((dd) => (
              <button
                key={dd.id}
                onClick={() => setDifficulty(dd.id)}
                className={`card p-3 text-left transition-all ${difficulty === dd.id ? "border-copper shadow-[0_0_0_1px_var(--color-copper)]" : "hover:border-line2"}`}
              >
                <div className={`font-semibold ${difficulty === dd.id ? "text-copperdeep" : ""}`}>{dd.label}</div>
                <div className="text-[0.72rem] leading-snug text-inksoft">{dd.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Expansion modes — collapsed by default so the first-run surface stays simple. */}
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowModes((v) => !v)}
            className="flex items-center gap-2 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-inksoft transition-colors hover:text-copperdeep"
          >
            <span className={`inline-block transition-transform ${showModes ? "rotate-90" : ""}`}>▸</span>
            Game modes &amp; expansions{modCount > 0 && <span className="rounded-full border border-copper px-2 py-px text-[0.62rem] text-copperdeep">{modCount} on</span>}
          </button>
          {showModes && (
            <div className="mt-3 rounded-md border border-line bg-paper2/40 p-3">
              <ModeSelector onChange={(m, n) => { setModules(m); setModCount(n); }} />
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Name your brewery"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full sm:w-72"
            maxLength={28}
          />
          <Button variant="go" onClick={() => onStart(name, difficulty, modules)} disabled={busy} className="px-6 py-3 text-base">
            {busy ? "Pouring…" : modCount > 0 ? `Start brewing · ${modCount} mode${modCount === 1 ? "" : "s"} →` : "Start brewing →"}
          </Button>
        </div>
        <p className="mt-4 font-mono text-[0.7rem] tracking-wide text-inksoft">
          Single-player · 16 rounds · 7 adaptive AI rivals · runs entirely in your browser
        </p>
      </div>
    </div>
  );
}
