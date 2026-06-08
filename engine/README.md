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

Run `npm run balance` for the live report. As of the last tuning pass:

| Gate (§16) | Fixed sweep | Adaptive cross-check |
|---|---|---|
| Finance invariants (§7.2) | PASS — held every firm-round | — |
| Runaway leader | PASS — HHI ≈ 0.20 | PASS — HHI ≈ 0.16 |
| Memoryless flailing | PASS — autocorr ≈ 0.82 | — |
| First-round lottery | PASS — shocks mid/late | — |
| Degenerate cooperation | PASS — antitrust fires on the cartel | — |
| Death spiral / no agency | WARN — bankruptcy ≈ 34%; 0 comebacks among *fixed* archetypes (expected — they never reposition; validate with adaptive play) | bankruptcy ≈ 1.3/8 (best-responders survive) |
| Thin-segment monopoly | PASS — no segment > 70% sustained | WARN — frontier ≈ 83% (quality agent owns the new category) |
| **Dominant strategy** | **FAIL — niche focus wins, split niche_specialist 67% / differentiator 33%** | **FAIL — `ad_quality` wins 100%** |

**Open question for review (the one FAIL).** Demand-shifting intangible investment
(Q/B) is the strongest lever: whichever archetype maxes the highest-β intangible
wins. The engine responds correctly and legibly to every knob — moving `beta_q`/
`beta_b` shifts the dominant lever exactly as expected — so this is **config parity**,
not an engine defect. Tuning improved it a lot (the fixed sweep's single-archetype
dominance fell from 100% to a healthy 67/33 split with a near-tied top of table), but
a quality lean still edges the field, and the adaptive best-responders make it 100%
because near-deterministic agents sweep on a tiny payoff edge. Driving win-share below
60% needs near-exact strategy parity that real (noisy, human) play loosens anyway.
This is exactly the iterative work the instructor config editor (app-spec §7.4) and
the live playtest (§9 step 8) exist for. Levers: bring `beta_q`/`beta_b` to parity and
down; raise price elasticity/volume; sharpen differential shock exposure for the
unprepared (premium leans skip resilience).

> The adaptive cross-check (`harness/adaptive.ts`) is a best-response agent that
> reprices, reallocates capacity by forecasted profit, and reads shock signals. It
> exists to separate a true exploit from a fixed-bot artifact. The coverage tests
> (`test/coverage.test.ts`) drive the otherwise-unexercised exit/investor/rebuild and
> supply_share/joint_marketing paths — they caught (and we fixed) a balance-sheet
> invariant break in the re-entry cost accounting.
