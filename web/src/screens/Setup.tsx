import { useState } from "react";
import type { Difficulty } from "../game/controller.js";
import { Button } from "../components/ui.js";

const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "relaxed", label: "Relaxed", blurb: "Mixed rivals, lighter investment — room to learn the loop." },
  { id: "competitive", label: "Competitive", blurb: "Several rivals contest Craft Premium directly." },
  { id: "cutthroat", label: "Cutthroat", blurb: "Aggressive, premium-hungry rivals that crowd your best moves." },
];

export function Setup({ onStart, busy }: { onStart: (name: string, difficulty: Difficulty) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("competitive");
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rise">
        <div className="eyebrow">A craft-beverage strategy simulation</div>
        <h1 className="display mt-2 text-6xl font-semibold leading-[0.95] sm:text-7xl">
          Drink<span className="text-copper">&nbsp;Wars</span>
        </h1>
        <div className="mt-4 h-px w-24 bg-copper" />
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink">
          Run a craft beverage company competing for drinkers across a regional market. Brew your lineup, build capacity, invest in
          quality and brand, manage your taproom, distributors and regulators — then the water table drops, a hop harvest fails, or a
          new category takes off.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            { t: "Lagers & Light", d: "Price-sensitive, high volume." },
            { t: "Craft Premium", d: "Quality- and brand-led." },
            { t: "Non-Alc / Functional", d: "An emerging category — if it takes off." },
          ].map((c) => (
            <div key={c.t} className="card p-3">
              <div className="font-semibold">{c.t}</div>
              <div className="text-[0.8rem] text-inksoft">{c.d}</div>
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

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Name your brewery"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full sm:w-72"
            maxLength={28}
          />
          <Button onClick={() => onStart(name, difficulty)} disabled={busy} className="px-6 py-3 text-base">
            {busy ? "Pouring…" : "Start brewing →"}
          </Button>
        </div>
        <p className="mt-4 font-mono text-[0.7rem] tracking-wide text-inksoft">
          Single-player · 16 rounds · 7 adaptive AI rivals · runs entirely in your browser
        </p>
      </div>
    </div>
  );
}
