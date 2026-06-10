# 🍺 Drink Wars

**A turn-based craft-beverage strategy simulation — a teaching tool for business strategy, and a research instrument for how people actually compete.**

[**▶ Play the live demo**](https://devinstein.me/drinkwars/) · [Design philosophy](#-design-philosophy) · [Run it locally](#-running-it-locally) · [For educators & researchers](#-for-educators--researchers) · MIT licensed

> *Your team runs a craft beverage company competing for drinkers across a regional market. Brew your lineup, build capacity, invest in quality and brand, manage your taproom community, your distributors, and the regulators — and decide whether to go it alone or collaborate with rival makers. Then the water table drops, a hop harvest fails, or a new category takes off.*

Drink Wars is a multi-firm strategy simulation built for an undergraduate **capstone** course, doubling as a **strategy-research data instrument**. Each round, teams make integrated decisions across marketing, operations, HR, finance, and geography; a deterministic economic engine resolves the market; and the results feed both the classroom debrief and (with consent) research analysis. The economic core is deliberately industry-agnostic — craft beverage is a configurable skin — so the same engine can later host other industries.

> ⚠️ **Work in progress.** This is an active MVP heading toward its first classroom run (~fall 2026). It's shared openly to gather feedback and to be useful to other educators and researchers. Expect rough edges — [feedback is very welcome](#-feedback--contributing).

---

## ▶ Play it

**No install** — the single-player prototype runs entirely in your browser against adaptive AI rivals:

### → [devinstein.me/drinkwars](https://devinstein.me/drinkwars/)

**Or locally** (single-player needs no backend, no accounts, no config):

```bash
git clone https://github.com/sydus93/drinkwars.git
cd drinkwars
npm install
npm run dev --workspace web      # → http://localhost:5173
```

Pick a difficulty and run one brewery against seven best-response bots.

---

## What you do each round

- **Price** each beverage category for your local market.
- **Allocate capacity** across segments with a single drag-to-split bar (focus vs. breadth is one lever).
- **Invest** in the durable stocks that win over time — product **quality**, **brand**, operational **process**, and your **stakeholders** (employees/community, investors, regulators).
- **Finance** the plan — draw or repay debt, raise equity, pay dividends — while two accounting invariants keep the books honest.
- **Buy market research** (a real, costed value-of-information action) to reveal rival intel and the price×quality strategy map.
- **Cooperate or compete** — form joint-marketing, supply-sharing, or co-development agreements with rivals… and watch antitrust and defection risk.

Then a **shock** may hit — a scheduled event, an endogenous antitrust action, a distressed rival dumping inventory, or a brand-new category opening up. You're scored on a **sustained balanced scorecard** (financial / market / intangible / stakeholder), not a single quarter's profit.

---

## 🧭 Design philosophy

These are the load-bearing choices that make the model feel like strategy rather than a spreadsheet:

- **Tiny core, many surface levers.** Every decision — marketing, HR, ops, finance, geography — routes into a *small* set of fundamentals. No lever gets its own scoring track.
- **Stocks with depreciation and lags, not flows.** Quality, brand, and the three stakeholder sub-stocks *accumulate and decay*. This is the highest-leverage choice: it creates path dependence, rewards commitment, and kills single-round exploits.
- **One stakeholder sub-stock, one engine.** Employees/community → productivity + resilience. Investors → cost of capital. Government → regulatory burden + antitrust. No cross-wiring in v1.
- **Config-driven, nothing hardcoded.** Every elasticity, curve, weight, and knob lives in one config object — instructor tuning, balance adjustment, and research treatment conditions all happen there.
- **Finance as a derived layer.** The three statements fall out of decisions already made; two accounting invariants double as engine self-checks (the engine throws if the balance sheet ever fails to balance).
- **Decouple score from grade.** Participation is the graded floor; competitive performance is extra-credit only — which keeps exit, risk-taking, and abandonment behaviorally honest in the research data.

---

## 🏗 Architecture

A TypeScript monorepo (npm workspaces) in three independent layers, all runnable headless with `tsx` (no build step except the web bundle):

| Layer | Package | What it is |
|---|---|---|
| **Engine** | [`engine/`](engine/) | A pure `(state, decisions, config, seed) → (next state, results)` resolution function, plus a balance harness. Backend-agnostic and browser-safe. |
| **Orchestration** | [`server/`](server/) | `GameOrchestrator` — round lifecycle, engine invocation, append-only history, replay — behind a `StorageAdapter` (in-memory for tests/dev; Supabase for production). Plus the instructor analytics aggregator. |
| **Presentation** | [`web/`](web/) | React / Vite / Tailwind v4 UI. The single-player prototype runs engine + orchestration + adaptive NPCs **entirely client-side**; the same components drive live multiplayer and the instructor console. |

**Determinism & replay.** All randomness flows through a seeded PRNG keyed by `(seed, round)`, so any resolved round is exactly replayable from `(state, decisions, config, seed)`. The server verifies this on every game (`replay()` recomputes standings and asserts they match stored history).

**Stack:** TypeScript · React 18 · Vite 6 · Tailwind v4 · Supabase (Postgres + RLS + Edge Functions, Deno) · `node:test`. No charting library — the SVG charts are dependency-free.

---

## 📁 Repository layout

```
drinkwars/
├── engine/    Deterministic economic engine + balance harness (pure TS, no backend)
├── server/    Orchestration: round lifecycle, StorageAdapter (in-memory + Supabase),
│              Edge Function transport, instructor analytics dashboard + CSV/JSON export
├── web/       React/Vite/Tailwind UI: single-player, live multiplayer, instructor console
│
├── 01_model_engine_spec.md            ← authoritative model spec (the economic core)
├── 02_application_spec.md             ← authoritative app spec (architecture, lifecycle, research)
└── 03_drink_wars_context_addendum.md  ← craft-beverage context & naming addendum
```

Each package has its own README with deeper detail: [`engine/README.md`](engine/README.md) (model + live balance gate), [`server/README.md`](server/README.md) (lifecycle, schema, RLS, Supabase deploy), [`web/README.md`](web/README.md) (UI structure + design tokens).

---

## 💻 Running it locally

Prerequisites: **Node ≥ 20** and npm. From the repo root, `npm install` once (it wires up the workspace).

**Single-player web app** (no backend):
```bash
npm run dev --workspace web        # → http://localhost:5173
npm run build --workspace web      # production bundle
```

**Engine + balance harness** (headless):
```bash
npm run smoke   --workspace engine   # one game, baseline archetypes, per-round trace
npm run balance --workspace engine   # multi-seed pathology gate + coopetition scenario + CSV export
npm test        --workspace engine   # unit tests (config, determinism, invariants, lags, emergence)
```
`npm run balance` writes `engine/out/firm_round_sample.csv` in a tidy, Stata-ready long format.

**Orchestration layer** (in-memory, no DB):
```bash
npm run demo --workspace server      # full game through the lifecycle + replay + research capture
npm test     --workspace server      # lifecycle, guards, append-only, replay, multiplayer/bot-fill
```

---

## 👩‍🏫 Multiplayer & instructor mode

Single-player needs nothing. **Multiplayer** adds a backend so a class can play together with an instructor running the rounds.

**How it works.** A small server holds the authority: instructors create / lock / resolve games (passcode-gated); students join by a 6-character code and submit decisions; unclaimed slots play as adaptive NPCs (bot-fill). The server ships in two parity transports — a local `node:http` server for dev, and a **Supabase Edge Function** (Deno) for production. Both sides support **session resume** (a student refresh rejoins the same firm; the instructor reconnects by code).

**Instructor console.** Behind the passcode: a live roster, lock/resolve controls, and an **analytics dashboard** — overview KPIs & standings, per-team trajectories, score anatomy ("what's winning"), market evolution, a strategy/distinctiveness map, a coopetition register, finance/solvency canaries, and a per-team drill-down (decision process, belief accuracy, reflections). Everything exports to **CSV (tidy, per-firm-per-round) and JSON** for offline analysis.

**Passcodes & scoping.** The instructor routes are gated on `DW_INSTRUCTOR_PASS`. An optional `DW_INSTRUCTOR_PASS_TEST` grants a second, full-access passcode you can hand to a colleague to try things out — it is **scoped to only the games it creates**, while the primary passcode is a super-user over all games.

**Set it up** (sketch — see [`server/README.md`](server/README.md) for the schema, RLS, and deploy detail):
1. Create a Supabase project; copy `server/.env.example` → `server/.env` and fill in your keys.
2. Apply the migrations in `server/supabase/migrations/`.
3. Run the local transport — `DW_ADAPTER=supabase npm run serve --workspace server` — or deploy the Edge Function: `npm run build:edge --workspace server` then `supabase functions deploy drinkwars`.
4. Build the web app with multiplayer enabled: `VITE_ENABLE_MP=1 VITE_TRANSPORT_URL=<your-function-url> npm run build --workspace web`.

> Secrets live only in `server/.env` (gitignored) and Supabase function secrets — never in the repo. `server/.env.example` is the safe template.

---

## 🎓 For educators & researchers

- **Tune it without touching code.** Every elasticity, curve, weight, segment, and shock lives in one config object (`engine/src/config/`). Difficulty, treatment conditions, and balance adjustments are all config.
- **It's a data instrument.** The orchestrator captures an append-only history plus research tables (per-firm-round outcomes, decision telemetry, predicted-rank beliefs, free-text reflections, strategic-distinctiveness, coopetition agreements), with per-user consent and de-identification. The instructor dashboard exports it all as CSV/JSON.
- **Balance is an open, transparent question.** Strategy sims live or die on balance, so the engine validates itself against eight pathology detectors before any UI — and the current state (including the one honest open `FAIL` around dominant-strategy tuning) is documented in [`engine/README.md`](engine/README.md#balance-status-24-seed-baseline--adaptive-cross-check). Real-player data is the next input.
- **Authoritative design docs** live in the repo: [`01_model_engine_spec.md`](01_model_engine_spec.md) (the economic model) and [`02_application_spec.md`](02_application_spec.md) (architecture, lifecycle, research pipeline).

If you're considering using this in a course or study, I'd genuinely like to hear from you — see below.

---

## 📌 Project status

| Area | Status |
|---|---|
| Economic engine + balance harness | ✅ Built, tested, multi-seed validated |
| Orchestration (lifecycle, replay, research capture) | ✅ Built, tested |
| Single-player web prototype | ✅ Live at devinstein.me/drinkwars |
| Multiplayer (Supabase + Edge Function, join codes, bot-fill, resume) | ✅ Live |
| Instructor analytics dashboard + CSV/JSON export | ✅ Built |
| Balance philosophy / dominant-strategy tuning | 🔬 Open — settling with real-player data |
| Inventory / demand-side play, per-cohort organization, identified-student mode | 🗺 Roadmap |

---

## 💬 Feedback & contributing

This is a solo academic project very much in progress, and feedback is the reason it's public. If you play it, teach with it, or read the model and have thoughts — **please open a [GitHub issue](https://github.com/sydus93/drinkwars/issues)** (bugs, balance observations, pedagogy ideas, or "this confused me"). PRs are welcome too, but an issue first is the best way to start a conversation.

---

## 📖 Citation

If you use Drink Wars in teaching or research, please cite it (see [`CITATION.cff`](CITATION.cff)):

> Stein, D. (2026). *Drink Wars: A craft-beverage strategy simulation for teaching and strategy research* [Software]. https://github.com/sydus93/drinkwars

---

## ⚖️ License

[MIT](LICENSE) © 2026 Devin Stein. Use it, teach with it, build on it — attribution appreciated.

---

## ✍️ Author

**Devin Stein** — Colorado State University. Built as a capstone teaching simulation and a strategy-research instrument. More at [devinstein.me](https://devinstein.me).
