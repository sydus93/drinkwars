import { useState } from "react";
import { MODULE_CATEGORIES, MODULE_REGISTRY, PRESETS, type ModuleMeta } from "drinkwars-engine";
import type { ModuleSelection } from "../game/multiplayer.js";
import { InfoDot } from "../components/InfoDot.js";

/** Only implemented modules can actually be turned on; planned ones render locked
 *  so the catalog (and the architecture) is visible without shipping no-op flags. */
const LIVE = new Set(MODULE_REGISTRY.filter((m) => m.implemented).map((m) => m.id));
const liveOf = (ids: string[]) => ids.filter((id) => LIVE.has(id as ModuleMeta["id"]));

/** Tier is a build-complexity fact; players see it as game depth. */
const DEPTH: Record<ModuleMeta["tier"], { label: string; hint: string }> = {
  A: { label: "light", hint: "A light overlay — adds a lever or twist on top of the fundamentals." },
  B: { label: "deep", hint: "A deeper system — new state, new screens, more to master." },
};

/**
 * The instructor "which expansion pack" surface. A preset is just a named set of
 * flags; instructors can start from one and toggle individual modules, shelved by
 * theme (finance, marketing, geography…). Emits a `{ id: { enabled: true } }` map
 * for every live, selected module — the create endpoint merges it into the config.
 */
export function ModeSelector({ onChange }: { onChange: (modules: ModuleSelection, count: number) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [presetId, setPresetId] = useState<string>("base");
  const [open, setOpen] = useState<Set<string>>(new Set(MODULE_CATEGORIES.map((c) => c.id)));

  const emit = (s: Set<string>) => {
    const m: ModuleSelection = {};
    for (const id of s) m[id] = { enabled: true };
    onChange(m, s.size);
  };
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    const s = new Set(liveOf(p?.modules ?? []));
    setPresetId(id);
    setSelected(s);
    emit(s);
  };
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) {
      s.delete(id);
      // Anything that depended on this module switches off with it.
      for (const m of MODULE_REGISTRY) if (m.deps.includes(id as ModuleMeta["id"]) && s.has(m.id)) s.delete(m.id);
    } else {
      s.add(id);
      // Pull in dependencies automatically (e.g. International needs Geography).
      for (const d of MODULE_REGISTRY.find((m) => m.id === id)?.deps ?? []) if (LIVE.has(d)) s.add(d);
    }
    setPresetId("custom");
    setSelected(s);
    emit(s);
  };
  const toggleOpen = (id: string) => {
    const s = new Set(open);
    s.has(id) ? s.delete(id) : s.add(id);
    setOpen(s);
  };

  const activePreset = PRESETS.find((p) => p.id === presetId);

  return (
    <div className="grid gap-4">
      {/* Preset chips */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-sm text-inksoft">
          <span>Mode preset</span>
          <InfoDot title="Modes are presets">
            A mode is a named set of expansion flags tuned for a course. Pick one as a starting point, then toggle individual modules below. Everything off is the standard v1 game.
          </InfoDot>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              className={`rounded-full border px-3 py-1 text-[0.72rem] font-semibold transition-colors ${presetId === p.id ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper hover:text-ink"}`}
            >
              {p.name}
            </button>
          ))}
          {presetId === "custom" && (
            <span className="rounded-full border border-hop bg-hop/10 px-3 py-1 text-[0.72rem] font-semibold text-hop">Custom</span>
          )}
        </div>
        {activePreset && activePreset.id !== "custom" && (
          <p className="mt-1.5 text-[0.72rem] leading-snug text-inksoft">
            {activePreset.description} <span className="text-inksoft/70">· {activePreset.audience}</span>
          </p>
        )}
      </div>

      {/* Module shelves, grouped by theme */}
      <div className="grid gap-2">
        {MODULE_CATEGORIES.map((cat) => {
          const mods = MODULE_REGISTRY.filter((m) => m.category === cat.id);
          if (!mods.length) return null;
          const onCount = mods.filter((m) => selected.has(m.id)).length;
          const isOpen = open.has(cat.id);
          return (
            <div key={cat.id} className="overflow-hidden rounded-md border border-line">
              <button
                type="button"
                onClick={() => toggleOpen(cat.id)}
                className="flex w-full items-center gap-2 bg-paper2/50 px-3 py-2 text-left transition-colors hover:bg-paper2"
              >
                <span className={`inline-block text-[0.6rem] text-inksoft transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink">{cat.label}</span>
                <InfoDot title={cat.label}>{cat.blurb}</InfoDot>
                <span className="ml-auto font-mono text-[0.62rem] text-inksoft">
                  {onCount > 0 ? <span className="text-copperdeep">{onCount} on</span> : `${mods.filter((m) => m.implemented).length} available`}
                </span>
              </button>
              {isOpen && (
                <div className="grid gap-1.5 p-2">
                  {mods.map((m) => {
                    const on = selected.has(m.id);
                    const locked = !m.implemented;
                    return (
                      <div
                        key={m.id}
                        className={`flex items-start gap-3 rounded-md border p-2.5 transition-colors ${on ? "border-copper bg-copper/[0.06]" : "border-line bg-paper2/30"} ${locked ? "opacity-60" : ""}`}
                      >
                        {/* Toggle */}
                        <button
                          type="button"
                          disabled={locked}
                          aria-pressed={on}
                          onClick={() => toggle(m.id)}
                          className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed ${on ? "border-copper bg-copper justify-end" : "border-line2 bg-paper justify-start"}`}
                        >
                          <span className="mx-0.5 h-3.5 w-3.5 rounded-full bg-paper shadow-sm" style={on ? { background: "var(--color-paper, #fff)" } : {}} />
                        </button>
                        {/* Label */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-ink">{m.name}</span>
                            <span className="font-mono text-[0.56rem] uppercase tracking-[0.1em] text-inksoft">{m.code}</span>
                            <span className="rounded-full border border-line2 px-1.5 py-px text-[0.56rem] uppercase tracking-[0.1em] text-inksoft" title={DEPTH[m.tier].hint}>
                              {DEPTH[m.tier].label}
                            </span>
                            {locked && <span className="rounded-full border border-line2 px-1.5 py-px text-[0.56rem] uppercase tracking-[0.1em] text-inksoft">Planned</span>}
                            {m.requiresMultiplayer && <span className="rounded-full border border-line2 px-1.5 py-px text-[0.56rem] uppercase tracking-[0.1em] text-inksoft">Multiplayer</span>}
                            <InfoDot title={m.name} align="right">
                              <span className="block">{m.blurb}</span>
                              <span className="mt-1 block text-inksoft">Teaches: {m.pedagogy}</span>
                            </InfoDot>
                          </div>
                          <p className="text-[0.72rem] leading-snug text-inksoft">{m.blurb}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[0.66rem] leading-snug text-inksoft">
        Planned modules are scaffolded and will light up as their engine logic lands. Live modules ship off-balance by design — enable per game and tune with play-test data.
      </p>
    </div>
  );
}
