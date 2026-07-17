import { Button, Card, Eyebrow, Tag } from "../components/ui.js";
import { SCENARIOS, type Scenario } from "../scenarios/catalog.js";

/**
 * Mini-scenario catalog: each card is one teaching scenario — a short, cranked
 * run that isolates a single strategy concept. Picking one hands the full
 * Scenario (override + horizon + debrief) to the caller, which launches it via
 * useGame().start({ override: s.override, ... }).
 */
export function ScenarioPicker({ onStart, onBack }: { onStart: (s: Scenario) => void; onBack?: () => void }): JSX.Element {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-12">
      <div className="rise">
        {onBack && (
          <button onClick={onBack} className="mb-6 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-inksoft transition-colors hover:text-ink">
            ← Back
          </button>
        )}

        <Eyebrow>Teaching scenarios · one concept per run</Eyebrow>
        <h1 className="display text-4xl leading-tight text-ink sm:text-5xl">
          Mini<span className="text-copper">-scenarios</span>
        </h1>
        <div className="mt-4 h-px w-24 bg-copper" />
        <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-inksoft">
          Each scenario cranks one strategic force into the dominant driver of a short 3–5 round season. Read the objective, play the run, then the debrief ties what happened back to the theory.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {SCENARIOS.map((s) => (
            <Card key={s.id} className="flex flex-col">
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag tone="copper">{s.concept}</Tag>
                <Tag>{s.week}</Tag>
                <span className="ml-auto font-mono text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">
                  {s.horizon} {s.horizon === 1 ? "round" : "rounds"}
                </span>
              </div>

              <div className="display mt-2.5 text-xl leading-snug text-ink">{s.title}</div>
              <p className="mt-1 text-[0.8rem] leading-snug text-inksoft">{s.blurb}</p>

              <div className="mt-3 border-t border-line pt-2.5">
                <div className="text-[0.62rem] uppercase tracking-[0.14em] text-inksoft">Your objective</div>
                <p className="mt-0.5 text-[0.78rem] leading-snug text-ink">{s.objective}</p>
              </div>

              <div className="mt-2.5">
                <div className="text-[0.62rem] uppercase tracking-[0.14em] text-inksoft">The lesson</div>
                <p className="mt-0.5 text-[0.78rem] leading-snug text-inksoft">{s.takeaway}</p>
              </div>

              <div className="mt-auto pt-4">
                <Button variant="go" onClick={() => onStart(s)}>
                  Start scenario →
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <p className="mt-6 max-w-2xl text-[0.72rem] leading-relaxed text-inksoft">
          Scenarios run solo against the adaptive rivals with a fixed seed, so a class plays the same world. Everything outside the featured concept is held at the standard game's baseline.
        </p>
      </div>
    </div>
  );
}
