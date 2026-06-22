import { useMemo, useState } from "react";
import { resolveConfig, generateHiringMarket } from "drinkwars-engine";
import type { ConfigOverride } from "drinkwars-engine";
import type { Difficulty } from "../game/controller.js";
import type { ModuleSelection } from "../game/multiplayer.js";
import { Button } from "../components/ui.js";
import { ModeSelector } from "./ModeSelector.js";
import { CategoryCoin } from "../components/CategoryIcons.js";
import { Avatar, SkillStars } from "../components/People.js";
import { FIRM_PALETTE } from "../lib/teamColors.js";
import { fmt } from "../labels.js";

export interface FoundingChoices {
  name: string;
  tagline: string;
  color: string;
  difficulty: Difficulty;
  modules: ModuleSelection;
  founding: { facilities: string[]; hires: string[] };
}

const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: "relaxed", label: "Relaxed", blurb: "A gentler field — room to find your footing." },
  { id: "competitive", label: "Competitive", blurb: "A balanced field that pushes back." },
  { id: "cutthroat", label: "Cutthroat", blurb: "Aggressive rivals that crowd whatever's working." },
];

const FOUNDING_HIRE_CAP = 3;

/** Create-a-firm flow (the Sims "make a specific entity before play" affordance):
 *  Identity → The Field → Founding (assets + team, if those modules are on) → Review.
 *  Founding picks pre-fill the opening round's decision, so they flow through the
 *  normal engine pipeline rather than mutating state. */
export function FirmBuilder({ onStart, busy }: { onStart: (c: FoundingChoices) => void; busy: boolean }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [color, setColor] = useState<string>(FIRM_PALETTE[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("competitive");
  const [modules, setModules] = useState<ModuleSelection>({});
  const [facPick, setFacPick] = useState<string[]>([]);
  const [hirePick, setHirePick] = useState<string[]>([]);

  const cfg = useMemo(() => resolveConfig(Object.keys(modules).length ? ({ modules } as unknown as ConfigOverride) : undefined), [modules]);
  const facOn = !!cfg.modules?.facilities?.enabled;
  const empOn = !!cfg.modules?.employees?.enabled;
  const facTypes = facOn ? cfg.modules?.facilities?.types ?? [] : [];
  const facMax = cfg.modules?.facilities?.max_facilities ?? 0;
  const candidates = empOn ? generateHiringMarket(cfg, cfg.game.seed, 0) : [];
  const roleLabel = (id: string) => cfg.modules?.employees?.roles.find((r) => r.id === id)?.label ?? id;
  const startCash = cfg.init.starting_cash;
  const facCost = facPick.reduce((s, id) => s + (facTypes.find((t) => t.id === id)?.base_cost ?? 0), 0);
  const hireCost = hirePick.reduce((s, id) => s + (candidates.find((c) => c.id === id)?.salary ?? 0), 0);
  const remaining = startCash - facCost - hireCost;
  const hasFounding = facOn || empOn;

  const display = name.trim() || "Your Brewery";
  const steps = ["Identity", "The field", "Founding", "Review"];
  const finish = () => onStart({ name, tagline, color, difficulty, modules, founding: { facilities: facPick, hires: hirePick } });

  const toggleFac = (id: string) => setFacPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < facMax ? [...p, id] : p));
  const toggleHire = (id: string) => setHirePick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < FOUNDING_HIRE_CAP ? [...p, id] : p));

  const BrandCard = (
    <div className="card overflow-hidden">
      <div className="h-2 w-full" style={{ background: color }} />
      <div className="p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-xl font-bold text-paper shadow-inner" style={{ background: color }}>
            {display.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="display truncate text-xl leading-tight">{display}</div>
            {tagline.trim() && <div className="truncate text-[0.8rem] italic text-inksoft">"{tagline.trim()}"</div>}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <div className="rise">
        <div className="eyebrow">Found your brewery</div>
        <h1 className="wordmark mt-1 text-5xl leading-[0.95] text-ink sm:text-6xl">
          Drink<span className="text-copper">&nbsp;Wars</span>
        </h1>

        {/* Stepper */}
        <div className="mt-6 flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] transition-colors ${i === step ? "text-copperdeep" : i < step ? "text-inksoft hover:text-ink" : "text-line2"}`}
              >
                <span className={`grid h-5 w-5 place-items-center rounded-full border text-[0.62rem] ${i === step ? "border-copper bg-copper text-paper" : i < step ? "border-line2 text-inksoft" : "border-line text-line2"}`}>{i + 1}</span>
                <span className="hidden sm:inline">{s}</span>
              </button>
              {i < steps.length - 1 && <span className="h-px w-4 bg-line" />}
            </div>
          ))}
        </div>

        <div className="mt-6 min-h-[18rem]">
          {/* STEP 0 — Identity */}
          {step === 0 && (
            <div className="grid gap-5 sm:grid-cols-[1fr_18rem]">
              <div className="grid content-start gap-4">
                <label className="grid gap-1">
                  <span className="text-sm text-inksoft">Brewery name</span>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your brewery" maxLength={28} className="w-full" />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm text-inksoft">Tagline <span className="text-inksoft/60">(optional)</span></span>
                  <input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Small batch, big heart" maxLength={60} className="w-full" />
                </label>
                <div className="grid gap-1.5">
                  <span className="text-sm text-inksoft">Brewery colors</span>
                  <div className="flex flex-wrap gap-2">
                    {FIRM_PALETTE.map((c) => (
                      <button key={c} type="button" onClick={() => setColor(c)} aria-label="Pick color"
                        className={`h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? "border-ink" : "border-line2"}`}
                        style={{ background: c, boxShadow: color === c ? "0 0 0 3px color-mix(in srgb, var(--color-ink) 18%, transparent)" : undefined }} />
                    ))}
                  </div>
                  <span className="text-[0.7rem] text-inksoft">Your color marks you on the map, the leaderboard, and every chart.</span>
                </div>
              </div>
              <div className="grid content-start gap-2">
                <span className="eyebrow">Your mark</span>
                {BrandCard}
              </div>
            </div>
          )}

          {/* STEP 1 — The field */}
          {step === 1 && (
            <div className="grid gap-5">
              <div>
                <div className="eyebrow mb-2">Rival difficulty</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DIFFICULTIES.map((dd) => (
                    <button key={dd.id} type="button" onClick={() => setDifficulty(dd.id)}
                      className={`card p-3 text-left transition-all ${difficulty === dd.id ? "border-copper shadow-[0_0_0_1px_var(--color-copper)]" : "hover:border-line2"}`}>
                      <div className={`font-semibold ${difficulty === dd.id ? "text-copperdeep" : ""}`}>{dd.label}</div>
                      <div className="text-[0.72rem] leading-snug text-inksoft">{dd.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-2">Game modes &amp; expansions</div>
                <div className="rounded-md border border-line bg-paper2/40 p-3">
                  <ModeSelector onChange={(m) => setModules(m)} />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — Founding (assets + team) */}
          {step === 2 && (
            <div className="grid gap-5">
              {!hasFounding ? (
                <div className="card p-5 text-center">
                  <div className="display text-lg">Starting lean</div>
                  <p className="mt-1 text-sm text-inksoft">No facility or labor expansions are on, so you open with the standard starting capacity and no roster. Turn on <span className="text-copperdeep">Facilities</span> or <span className="text-copperdeep">Employees</span> in the previous step to found with physical assets and a team.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="eyebrow">Founding budget</div>
                    <div className={`tnum text-sm font-semibold ${remaining < 0 ? "text-brick" : "text-ink"}`}>{fmt.money(remaining)} <span className="text-inksoft">of {fmt.money(startCash)} left</span></div>
                  </div>

                  {facOn && (
                    <div>
                      <div className="mb-1.5 text-sm font-semibold text-ink">Starting facilities <span className="text-[0.7rem] font-normal text-inksoft">· {facPick.length}/{facMax}</span></div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {facTypes.map((t) => {
                          const on = facPick.includes(t.id);
                          const afford = on || (remaining - t.base_cost >= 0 && facPick.length < facMax);
                          return (
                            <button key={t.id} type="button" onClick={() => toggleFac(t.id)} disabled={!afford}
                              className={`flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors disabled:opacity-40 ${on ? "border-copper bg-copper/[0.06]" : "border-line hover:border-copper"}`}>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-ink">{t.label}</div>
                                <div className="text-[0.64rem] text-inksoft">+{fmt.int(t.capacity_contribution)} tanks · {fmt.money(t.fixed_cost)}/rd</div>
                              </div>
                              <span className="tnum shrink-0 text-[0.72rem] text-copperdeep">{fmt.money(t.base_cost)}</span>
                              <span className="shrink-0 text-[0.7rem] font-semibold text-copperdeep">{on ? "✓" : "+"}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {empOn && (
                    <div>
                      <div className="mb-1.5 text-sm font-semibold text-ink">Founding team <span className="text-[0.7rem] font-normal text-inksoft">· {hirePick.length}/{FOUNDING_HIRE_CAP}</span></div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {candidates.map((cnd) => {
                          const on = hirePick.includes(cnd.id);
                          const afford = on || (remaining - cnd.salary >= 0 && hirePick.length < FOUNDING_HIRE_CAP);
                          return (
                            <button key={cnd.id} type="button" onClick={() => toggleHire(cnd.id)} disabled={!afford}
                              className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:opacity-40 ${on ? "border-copper bg-copper/[0.06]" : "border-line hover:border-copper"}`}>
                              <Avatar seed={cnd.avatar_seed} name={cnd.name} size={26} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold text-ink">{cnd.name}</span><SkillStars n={cnd.skill} /></div>
                                <div className="text-[0.62rem] text-inksoft">{roleLabel(cnd.role)}</div>
                              </div>
                              <span className="tnum shrink-0 text-[0.72rem] text-copperdeep">{fmt.money(cnd.salary)}/rd</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 3 — Review */}
          {step === 3 && (
            <div className="grid gap-4 sm:grid-cols-[18rem_1fr]">
              {BrandCard}
              <div className="grid content-start gap-2 text-sm">
                <Row label="Rivals" value={DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? difficulty} />
                <Row label="Expansions" value={Object.keys(modules).length ? `${Object.keys(modules).length} on` : "Standard game"} />
                {facOn && <Row label="Starting facilities" value={facPick.length ? facPick.map((id) => facTypes.find((t) => t.id === id)?.label).join(", ") : "None"} />}
                {empOn && <Row label="Founding team" value={hirePick.length ? `${hirePick.length} hired` : "None"} />}
                {hasFounding && <Row label="Opening cash after founding" value={fmt.money(remaining)} strong />}
                <p className="mt-2 text-[0.74rem] leading-snug text-inksoft">Your founding picks are queued into round one — you can still adjust them before you brew.</p>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
          {step < steps.length - 1 ? (
            <Button variant="go" onClick={() => setStep((s) => s + 1)} disabled={remaining < 0}>
              {remaining < 0 ? "Over budget" : "Next →"}
            </Button>
          ) : (
            <Button variant="go" onClick={finish} disabled={busy || remaining < 0} className="px-6 py-3 text-base">
              {busy ? "Pouring…" : "Open for business →"}
            </Button>
          )}
        </div>
        <p className="mt-4 font-mono text-[0.7rem] tracking-wide text-inksoft">Single-player · 16 rounds · 7 adaptive AI rivals · runs entirely in your browser</p>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-0 ${strong ? "font-semibold" : ""}`}>
      <span className="text-inksoft">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}
