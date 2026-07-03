import { useMemo, useState } from "react";
import { resolveConfig, generateHiringMarket } from "drinkwars-engine";
import type { ConfigOverride } from "drinkwars-engine";
import type { Difficulty } from "../game/controller.js";
import type { ModuleSelection } from "../game/multiplayer.js";
import { Button } from "../components/ui.js";
import { ModeSelector } from "./ModeSelector.js";
import { Avatar, SkillStars } from "../components/People.js";
import { FacilityChip, Emblem, EMBLEM_IDS } from "../components/FacilityGlyph.js";
import { FoundingSiteMap } from "../components/CityView.js";
import { FIRM_COLORS } from "../lib/teamColors.js";
import { fmt } from "../labels.js";

/** A founding facility: a type sited at a chosen spot. `district` is where its rent/output/brand
 *  economics come from; `lot` is the specific home parcel (when spatial siting is available). The
 *  player picks the location in the City View that pops up when they add a facility. */
export interface FoundingFacility {
  type: string;
  district?: string;
  lot?: string;
}

export interface FoundingChoices {
  name: string;
  tagline: string;
  color: string;
  emblem: string;
  difficulty: Difficulty;
  modules: ModuleSelection;
  founding: { facilities: FoundingFacility[]; hires: string[] };
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
  const [color, setColor] = useState<string>(FIRM_COLORS[0].hex);
  const [emblem, setEmblem] = useState<string>(EMBLEM_IDS[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("competitive");
  const [modules, setModules] = useState<ModuleSelection>({});
  const [showModes, setShowModes] = useState(false);
  const [facPick, setFacPick] = useState<FoundingFacility[]>([]);
  const [hirePick, setHirePick] = useState<string[]>([]);
  const [siteFor, setSiteFor] = useState<string | null>(null); // facility type currently being sited (City View popup open)

  const cfg = useMemo(() => resolveConfig(Object.keys(modules).length ? ({ modules } as unknown as ConfigOverride) : undefined), [modules]);
  const facOn = !!cfg.modules?.facilities?.enabled;
  const empOn = !!cfg.modules?.employees?.enabled;
  const facTypes = facOn ? cfg.modules?.facilities?.types ?? [] : [];
  const districts = cfg.modules?.facilities?.districts ?? [];
  const facMax = cfg.modules?.facilities?.max_facilities ?? 0;
  const candidates = empOn ? generateHiringMarket(cfg, cfg.game.seed, 0) : [];
  const roleLabel = (id: string) => cfg.modules?.employees?.roles.find((r) => r.id === id)?.label ?? id;
  const districtLabel = (id?: string) => districts.find((d) => d.id === id)?.label ?? id ?? "—";
  const startCash = cfg.init.starting_cash;
  const typeOf = (id: string) => facTypes.find((t) => t.id === id);
  const facCost = facPick.reduce((s, f) => s + (typeOf(f.type)?.base_cost ?? 0), 0);
  const hireCost = hirePick.reduce((s, id) => s + (candidates.find((c) => c.id === id)?.salary ?? 0), 0);
  const remaining = startCash - facCost - hireCost;
  const hasFounding = facOn || empOn;

  const display = name.trim() || "Your Brewery";
  const steps = ["Identity", "The field", "Founding", "Review"];
  const finish = () => onStart({ name, tagline: "", color, emblem, difficulty, modules, founding: { facilities: facPick, hires: hirePick } });

  // Adding a facility opens the City View so the player picks WHERE it opens — the district
  // (rent × output × brand) it sits in is a real, season-long tradeoff, so the choice is made
  // up front rather than auto-assigned. `placeFac` handles both first placement and "Move".
  const addFac = (id: string) => { if (facPick.some((f) => f.type === id) || facPick.length >= facMax) return; setSiteFor(id); };
  const placeFac = (loc: { lot?: string; district: string }) => {
    const id = siteFor; if (!id) return;
    setFacPick((p) => [...p.filter((f) => f.type !== id), { type: id, lot: loc.lot, district: loc.district }]);
    setSiteFor(null);
  };
  const removeFac = (id: string) => setFacPick((p) => p.filter((f) => f.type !== id));
  const toggleHire = (id: string) => setHirePick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < FOUNDING_HIRE_CAP ? [...p, id] : p));

  // The live identity card + how the firm's sites read on the map — the design's
  // right-rail preview; shape shows what a site does, colour + mark show it's yours.
  const Preview = (
    <div className="grid content-start gap-3.5">
      <div className="overflow-hidden rounded-2xl border border-line2" style={{ boxShadow: "0 10px 26px rgba(40,25,8,.16)" }}>
        <div className="relative flex h-[74px] items-center justify-center" style={{ background: color }}>
          <div className="absolute inset-0 opacity-[.16]" style={{ background: "radial-gradient(circle at 30% 20%, #fff 0, transparent 50%)" }} />
          <div className="grid h-[50px] w-[50px] place-items-center rounded-[13px]" style={{ background: "rgba(255,255,255,.16)", border: "1.5px solid rgba(255,255,255,.4)" }}>
            <Emblem id={emblem} size={30} color="#fff" />
          </div>
        </div>
        <div className="bg-panel px-4 py-3.5">
          <div className="display text-2xl font-black uppercase leading-none text-ink">{display}</div>
          <div className="mt-1 text-[0.72rem] text-inksoft">Home market · Front Range</div>
          <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: `color-mix(in srgb, ${color} 13%, var(--color-panel))`, border: `1px solid color-mix(in srgb, ${color} 40%, var(--color-line))` }}>
            <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
            <span className="font-mono text-[0.55rem] font-bold uppercase" style={{ color }}>Your colour</span>
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="mb-2.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-inksoft">How your sites read on the map</div>
        <div className="flex justify-around">
          {([["brewery_large", "brew"], ["brewpub", "mix"], ["taproom", "sell"]] as [string, string][]).map(([t, lbl]) => (
            <div key={t} className="flex flex-col items-center gap-1.5">
              <FacilityChip type={t} color={color} size={40} mine />
              <span className="font-mono text-[0.5rem] uppercase text-inksoft">{lbl}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1.5">
            <span className="grid h-10 w-10 place-items-center rounded-[11px]" style={{ background: color, border: "2px solid #fff4e0", boxShadow: `0 0 0 1px ${color}, 0 3px 7px rgba(40,25,8,.3)` }}><Emblem id={emblem} size={22} color="#fff" /></span>
            <span className="font-mono text-[0.5rem] uppercase text-inksoft">badge</span>
          </div>
        </div>
        <div className="mt-3 text-[0.7rem] leading-snug text-inksoft">Shape shows what a site <b className="text-ink">does</b>; your colour and mark show it's <b className="text-ink">yours</b>.</div>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="mb-2 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-inksoft">You open round 1 with</div>
        {([["Seed capital", fmt.money(startCash)], facOn ? ["Starting sites", facPick.length ? `${facPick.length} sited` : "pick on the map"] : ["Home lease", "1 lot"], ["Format", `${cfg.game.n_rounds ?? 16}-round season`]] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-1.5 last:border-0"><span className="text-[0.8rem] text-ink">{k}</span><span className="font-mono text-[0.72rem] font-bold text-copperdeep">{v}</span></div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-10">
      <div className="rise">
        <div className="eyebrow">Found your brewery</div>
        <h1 className="wordmark mt-1 text-5xl leading-[0.95] text-ink sm:text-6xl">
          Drink<span className="text-copper">&nbsp;Wars</span>
        </h1>

        {/* Stepper */}
        <div className="mt-6 flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <button type="button" onClick={() => i < step && setStep(i)} className={`flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.1em] transition-colors ${i === step ? "text-copperdeep" : i < step ? "text-inksoft hover:text-ink" : "text-line2"}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full border text-[0.62rem] ${i === step ? "border-copper bg-copper text-paper" : i < step ? "border-line2 text-inksoft" : "border-line text-line2"}`}>{i + 1}</span>
                <span className="hidden sm:inline">{s}</span>
              </button>
              {i < steps.length - 1 && <span className="h-px w-4 bg-line" />}
            </div>
          ))}
        </div>

        <div className="mt-6 min-h-[20rem]">
          {/* STEP 0 — Identity */}
          {step === 0 && (
            <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
              <div className="grid content-start gap-5">
                <div>
                  <div className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">01 · Brewery name</div>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hopline Brewing" maxLength={24} className="display w-full !text-2xl !uppercase" style={{ fontWeight: 800 }} />
                </div>
                <div>
                  <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">02 · House colour</div>
                  <div className="flex flex-wrap gap-2.5">
                    {FIRM_COLORS.map((c) => {
                      const on = color === c.hex;
                      return (
                        <button key={c.id} type="button" onClick={() => setColor(c.hex)} title={c.name} className="grid h-[52px] w-[52px] place-items-center rounded-[13px] transition-transform hover:scale-105" style={{ background: c.hex, border: on ? "3px solid var(--color-ink)" : "2px solid rgba(0,0,0,.12)", boxShadow: on ? "0 4px 12px rgba(40,25,8,.3)" : "inset 0 1px 0 rgba(255,255,255,.25)" }}>
                          {on && <span className="text-xl text-white">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-copperdeep">03 · House mark</div>
                  <div className="flex flex-wrap gap-2.5">
                    {EMBLEM_IDS.map((id) => {
                      const on = id === emblem;
                      return (
                        <button key={id} type="button" onClick={() => setEmblem(id)} className="grid h-[50px] w-[50px] place-items-center rounded-[12px]" style={{ background: on ? color : "var(--color-panel2)", border: on ? "2px solid var(--color-ink)" : "1px solid var(--color-line)" }}>
                          <Emblem id={id} size={26} color={on ? "#fff" : "var(--color-copperdeep)"} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[0.7rem] text-inksoft">Your colour and mark are how every rival reads you on the map all season.</div>
                </div>
              </div>
              <div className="lg:border-l lg:border-line lg:pl-6">{Preview}</div>
            </div>
          )}

          {/* STEP 1 — The field */}
          {step === 1 && (
            <div className="grid gap-5">
              <div>
                <div className="eyebrow mb-2">Rival difficulty</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DIFFICULTIES.map((dd) => (
                    <button key={dd.id} type="button" onClick={() => setDifficulty(dd.id)} className={`card p-3 text-left transition-all ${difficulty === dd.id ? "border-copper shadow-[0_0_0_1px_var(--color-copper)]" : "hover:border-line2"}`}>
                      <div className={`font-semibold ${difficulty === dd.id ? "text-copperdeep" : ""}`}>{dd.label}</div>
                      <div className="text-[0.72rem] leading-snug text-inksoft">{dd.blurb}</div>
                    </button>
                  ))}
                </div>
              </div>
              {/* Modes are collapsed by default — accept the standard game and jump right in,
                  or open to customize (facilities, geography, employees, conduct, alliances). */}
              <div>
                <button type="button" onClick={() => setShowModes((v) => !v)} className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-paper2/40 px-3 py-2.5 text-left transition-colors hover:border-line2">
                  <span className="min-w-0">
                    <span className="eyebrow block">Game modes &amp; expansions</span>
                    <span className="text-[0.72rem] text-inksoft">{Object.keys(modules).length ? `${Object.keys(modules).length} on · tap to adjust` : "Standard game — tap to add facilities, geography, employees…"}</span>
                  </span>
                  <span className={`shrink-0 text-inksoft transition-transform ${showModes ? "rotate-90" : ""}`} aria-hidden>▸</span>
                </button>
                {showModes && (
                  <div className="mt-2 rounded-md border border-line bg-paper2/40 p-3">
                    <ModeSelector onChange={(m) => setModules(m)} />
                  </div>
                )}
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
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <div className="text-sm font-semibold text-ink">Starting facilities <span className="text-[0.7rem] font-normal text-inksoft">· {facPick.length}/{facMax}</span></div>
                        <div className="text-[0.66rem] text-inksoft">Home market · Front Range — you choose the district</div>
                      </div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {facTypes.map((t) => {
                          const pick = facPick.find((f) => f.type === t.id);
                          const on = !!pick;
                          const afford = on || (remaining - t.base_cost >= 0 && facPick.length < facMax);
                          return (
                            <div key={t.id} className={`flex items-center gap-2 rounded-md border p-2.5 ${on ? "border-copper bg-copper/[0.06]" : afford ? "border-line" : "border-line opacity-40"}`}>
                              <FacilityChip type={t.id} color={color} size={26} mine />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-ink">{t.label}</div>
                                {on ? (
                                  <div className="truncate text-[0.64rem] font-semibold text-copperdeep">📍 {districtLabel(pick!.district)} · {fmt.money(t.fixed_cost)}/rd upkeep</div>
                                ) : (
                                  <div className="text-[0.64rem] text-inksoft">+{fmt.int(t.production_capacity ?? t.capacity_contribution ?? 0)} drinks/rd{(t.retail_draw ?? 0) > 0 ? ` · +${fmt.int(t.retail_draw ?? 0)} retail` : ""} · {fmt.money(t.base_cost)}</div>
                                )}
                              </div>
                              {on ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button type="button" onClick={() => setSiteFor(t.id)} className="rounded border border-line2 px-1.5 py-1 font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-copperdeep">Move</button>
                                  <button type="button" onClick={() => removeFac(t.id)} className="rounded border border-line2 px-1.5 py-1 font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-inksoft">Remove</button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => addFac(t.id)} disabled={!afford} className="shrink-0 rounded border border-copper px-2 py-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide text-copperdeep transition-colors hover:bg-copper/10 disabled:opacity-40">Site →</button>
                              )}
                            </div>
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
                            <button key={cnd.id} type="button" onClick={() => toggleHire(cnd.id)} disabled={!afford} className={`flex items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:opacity-40 ${on ? "border-copper bg-copper/[0.06]" : "border-line hover:border-copper"}`}>
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
            <div className="grid gap-5 lg:grid-cols-[24rem_1fr]">
              {Preview}
              <div className="grid content-start gap-2 text-sm">
                <Row label="Rivals" value={DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? difficulty} />
                <Row label="Expansions" value={Object.keys(modules).length ? `${Object.keys(modules).length} on` : "Standard game"} />
                {facOn && <Row label="Starting facilities" value={facPick.length ? facPick.map((f) => `${typeOf(f.type)?.label ?? f.type} · ${districtLabel(f.district)}`).join(", ") : "None"} />}
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
            <Button variant="go" onClick={() => setStep((s) => s + 1)} disabled={remaining < 0}>{remaining < 0 ? "Over budget" : "Next →"}</Button>
          ) : (
            <Button variant="go" onClick={finish} disabled={busy || remaining < 0} className="px-6 py-3 text-base">{busy ? "Pouring…" : `Found ${display.split(" ")[0]} →`}</Button>
          )}
        </div>
        <p className="mt-4 font-mono text-[0.7rem] tracking-wide text-inksoft">Single-player · 16 rounds · seven rival breweries</p>
      </div>

      {/* City View popup — choose WHERE the selected facility opens (district = rent/output/brand) */}
      {siteFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setSiteFor(null); }}>
          <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line2 bg-paper shadow-2xl">
            <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <FacilityChip type={siteFor} color={color} size={24} mine />
              <div className="min-w-0">
                <div className="display text-lg leading-tight text-ink">Where should your {typeOf(siteFor)?.label ?? "facility"} open?</div>
                <div className="text-[0.72rem] leading-snug text-inksoft">Rent, output and brand draw all follow the district — pick the spot that fits the build.</div>
              </div>
              <span className="flex-1" />
              <button type="button" onClick={() => setSiteFor(null)} className="shrink-0 rounded-md border border-line2 px-3 py-1.5 text-sm text-inksoft transition-colors hover:border-line hover:text-ink">Cancel</button>
            </header>
            <div className="overflow-y-auto p-4">
              <FoundingSiteMap cfg={cfg} color={color} placed={facPick.filter((f) => f.type !== siteFor)} sitingType={siteFor} onPick={placeFac} />
            </div>
          </div>
        </div>
      )}
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
