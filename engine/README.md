# Drink Wars — Engine + Balance Harness

The deterministic economic core for Drink Wars, plus the headless balance harness.
This is **application-spec §9 steps 1–2**: the engine and config loader, then the
balance harness — built and validated **before any UI**. The engine is a pure
function of `(state, decisions, config, seed)` (model-spec §1/§13) and is
backend-agnostic: the same code runs in the balance harness, a future serverless
resolver, and an in-browser single-player prototype.

> Authoritative model: `../01_model_engine_spec.md`. Application layer:
> `../02_application_spec.md`. Section refs (§N) point there.

## Run it

```bash
npm install
npm run smoke        # one game, baseline archetypes, per-round trace
npm run balance      # 24-seed pathology gate + coopetition scenario + CSV export
npm run balance -- 60   # custom seed count
npm test             # unit tests (config, determinism, invariants, lags, emergence)
npm run typecheck    # tsc --noEmit
```

`npm run balance` writes `out/firm_round_sample.csv` (§15.1 long format, Stata-ready).

## Layout

```
src/
  types.ts            All shared types: Config, WorldState, FirmDecision, results.
  rng.ts              Seedable mulberry32 PRNG + per-round seed derivation.
  config/
    defaults.ts       Canonical baseline Drink Wars config (§14).
    schema.ts         validateConfig — range/structure checks.
    load.ts           loadConfig — object | JSON | YAML | path, deep-merged over defaults.
  engine/
    stocks.ts         Lagged, depreciating, concave stock dynamics (§3.1).
    cost.ts           Unit-cost build-up: learning curve, process, productivity (§6).
    demand.ts         Logit demand, capacity rationing, cross-segment substitution (§5).
    finance.ts        Three statements, cost of capital, valuation; invariants (§7).
    coopetition.ts    Agreements: 3 forms × 3 templates, defection, antitrust signal (§11).
    shocks.ts         Timeline roll, live trigger, resilience, antitrust, distress dumping (§9).
    scoring.ts        Sustained balanced scorecard, within-round normalization (§12).
    distinctiveness.ts Mahalanobis + nearest-neighbour strategy distances (§15.4).
    exit.ts           Forced/voluntary exit, re-entry, operator-to-investor (§8).
    init.ts           Game/firm initialization; balanced opening balance sheet.
    resolve.ts        resolveRound — the §13 sequence; the pure function.
  index.ts            Public API + runGame helper.
harness/
  archetypes.ts       Scripted strategy archetypes + decision providers.
  run.ts              Headless run driver + metric extraction; coopetition scenario.
  pathologies.ts      The 8 §16 pathology detectors.
  balance.ts          Gate report entry point.
  smoke.ts            Single-game trace.
test/engine.test.ts   Unit tests.
```

## Design choices worth knowing

- **Working-capital change is zero in v1** (all-cash sales, no inventory carried), so
  the two finance invariants (§7.2) hold exactly and double as engine self-checks —
  `buildStatements` throws `InvariantError` if either ever breaks.
- **The water-resilience mechanic adds no new state variable** (the addendum's "no new
  mechanics" rule): shock mitigation routes through the existing `process` stock +
  `T_emp` (§9.4). `process` is modeled as a stock for path dependence; its params live
  under `costs.process`.
- **`presence[s]`** is one lever doing two jobs: normalized, it allocates capacity
  (`capAlloc = effectiveCap · allocFrac`) *and* drives the βfit utility term — so
  focus-vs-breadth needs no extra machinery.
- **Determinism**: all randomness flows through the seeded RNG, keyed by
  `(config.game.seed, round)`. Same inputs → identical outputs (tested), so any round
  is replayable from `(state, decisions, config, seed)` (app-spec §3.3).

## Balance status (24-seed baseline + adaptive cross-check)

Run `npm run balance` for the live report — it is the source of truth and this table
goes stale. Last refreshed 2026-09-20 (DW-056), base config:

| Gate (§16) | Fixed sweep | Adaptive cross-check |
|---|---|---|
| Finance invariants (§7.2) | PASS — held every firm-round | — |
| Runaway leader | PASS — HHI 0.158 | PASS — HHI 0.171 |
| Memoryless flailing | PASS — autocorr 0.711 | — |
| First-round lottery | PASS — shocks mid/late | — |
| Degenerate cooperation | PASS — antitrust fires on the cartel | — |
| Death spiral / no agency | WARN — bankruptcy 5%; 0/96 behind-at-midpoint firms recovered (expected of *fixed* archetypes — they never reposition) | — |
| Thin-segment monopoly | PASS — no segment > 70% sustained | **FAIL — 87% in `frontier`** |
| Dominant strategy | WARN — balanced 46% / differentiator 38% / brand_builder 8% / niche_specialist 8% | **FAIL — `ad_quality` 79%, `ad_brand` 21%** |

**Verdict: 6 PASS / 2 WARN / 0 FAIL on the fixed sweep; the two FAILs are both in the
adaptive cross-check.** Under the classroom preset
(`DW_MODULES=laborMarket,sustainability`) the fixed sweep is 7 PASS / 1 WARN / 0 FAIL.

**The open question.** Demand-shifting intangible investment (Q/B) is the strongest
lever: whichever agent maxes the highest-β intangible wins. The engine responds
correctly and legibly to every knob — moving `beta_q`/`beta_b` shifts the dominant lever
exactly as expected — so this is **config parity**, not an engine defect. The fixed sweep
has come a long way (single-archetype dominance fell from 100% to a 46/38 top-two split
with `balanced` and `differentiator` nearly tied), but the adaptive best-responders still
converge on quality, because near-deterministic agents sweep on a tiny payoff edge that
real, noisy, human play loosens. Driving adaptive win-share below 60% needs near-exact
strategy parity. Levers: bring `beta_q`/`beta_b` to parity and down; raise price
elasticity/volume; sharpen differential shock exposure for the unprepared (premium leans
skip resilience).

> The adaptive cross-check (`harness/adaptive.ts`) is a best-response agent that
> reprices, reallocates capacity by forecasted profit, and reads shock signals. It
> exists to separate a true exploit from a fixed-bot artifact. The coverage tests
> (`test/coverage.test.ts`) drive the otherwise-unexercised exit/investor/rebuild and
> supply_share/joint_marketing paths — they caught (and we fixed) a balance-sheet
> invariant break in the re-entry cost accounting.
