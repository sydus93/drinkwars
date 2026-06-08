# Strategy Simulation — Application Specification (v1)

*Build document for everything around the engine: architecture, persistence, authentication, the round lifecycle, student and instructor interfaces, progressive disclosure, the data-export pipeline, and build sequencing. The companion model & engine spec (`01_model_engine_spec.md`) defines the economic core and is the authoritative source for all state variables, equations, the config schema, and the data tables; this document references them rather than redefining them. The engine is to be treated as a dependency this layer calls, not logic to reimplement.*

---

## Context — Drink Wars

*Folded in from the v1 context addendum (`03_drink_wars_context_addendum.md`, now superseded). The full engine-variable → domain-referent, segment, shock, and coopetition mapping tables live in the **Context** section of the model & engine spec; this layer carries the same naming through the interface.*

**Name:** Drink Wars.

**Premise (student-facing):** *"Your team runs a craft beverage company competing for drinkers across a regional market. Brew your lineup, build capacity, invest in quality and brand, manage your taproom community, your distributors, and the regulators — and decide whether to go it alone or collaborate with rival makers. Then the water table drops, a hop harvest fails, or a new category takes off."*

**Interface vocabulary (presentation/config-label layer only — engine names stay generic):** brew / lineup (decision entry), tanks / capacity (`cap`), recipe quality (`Q`), brand (`B`), taproom community (`T_emp`), investors & lenders (`T_inv`), distributors / three-tier & regulators (`T_gov`), collab (relational agreement), co-packing / distribution deal (formal contract), guild (collective arrangement), category (segment), the new category (frontier emergence). Surface these as UI labels, scenario text, and the data-dictionary glosses; do not rename engine variables or config keys.

---

## 1. Purpose and Scope

This layer turns the deterministic engine into a usable turn-based game: it persists state, authenticates teams and the instructor, collects decision vectors within a submission window, invokes the engine on instructor command, publishes results, and exports the research data. It also owns the learnability problem — making a comprehensive strategy space approachable enough that students actually explore it.

The guiding non-functional requirement: the dashboard must walk the line between wide strategic discretion and intuitive navigation. The complexity that makes a comprehensive sim hard to navigate is largely downstream of model complexity, which the engine's tiny-core design already constrains; the remaining work is interface discipline (progressive disclosure and a diagnostics-first results view).

---

## 2. Architecture

### 2.1 Target: static front-end plus backend-as-a-service

For v1, a static front-end paired with a managed backend (Postgres + authentication + row-level security, e.g. a Supabase-class provider) is the recommended target. Rationale: no server to maintain during the semester, generous free tiers comfortably cover a class, authentication and access control are built in, and data collection becomes a query against owned Postgres tables — which exports cleanly to Stata.

The engine's resolution logic is a pure function of (state, decisions, config, seed) and is therefore backend-agnostic. It runs either as a managed serverless function invoked at resolution or as a small server process; the front-end never resolves rounds. Continuous (non-round) play and a self-hosted droplet are explicitly deferred — turn-based instructor-resolved play needs neither, and students prefer a submit-by-deadline cadence over constant monitoring.

### 2.2 Why round-based collapses complexity

Because outcomes are interdependent across firms in a shared industry, resolution requires server-side computation over all submitted decisions at once. Turn-based, instructor-resolved play makes this a single batch operation per round: collect the full decision set, invoke the engine once, write results. No realtime synchronization, no race conditions, no continuous-time bookkeeping.

### 2.3 Separation of concerns

Three layers, kept independent so the engine can be validated before any interface exists:

- **Engine** (per the model spec): pure resolution function plus a headless harness for balance testing.
- **Persistence and orchestration:** the data model, authentication, the round lifecycle state machine, and the engine invocation.
- **Presentation:** student and instructor interfaces, reading and writing only through the orchestration layer.

---

## 3. Data Model and Persistence

The engine defines the substantive tables (§3 and §15 of the model spec). This layer adds the persistence and access scaffolding around them.

### 3.1 Core entities

- **game:** the active game instance, holding the config object (the model spec's §14 schema), current round index, and lifecycle state.
- **team:** a competing unit, mapped to one or more student users; holds firm identity and active/exited/investor status.
- **user:** a student or the instructor, with role.
- **firm_state:** current world and per-firm state, versioned by round (an append-only history enables replay and audit).
- **decisions:** submitted decision vectors keyed by team-round, with a submitted/locked flag.
- The research tables from model spec §15 (`firm_round`, `beliefs`, `telemetry`, `strategy_vectors`, `distinctiveness`, `agreements`, reflection text), plus a per-user `consent` flag and de-identification mapping so the data is research-ready from the start.

### 3.2 Access control

Row-level security enforces the central confidentiality rule: a team reads only its own decisions and private state plus the public information released after each resolution; no team sees another team's pending decisions. The instructor reads all. The append-only history table is never mutated after a round resolves.

### 3.3 State persistence and replay

Because the engine is deterministic given (state, decisions, config, seed), persisting those four per round makes any round fully replayable — valuable for debugging balance issues that surface mid-semester and for reconstructing the research panel.

---

## 4. Roles and Authentication

Two roles in v1: **student** (member of a team) and **instructor**. Authentication uses the BaaS provider's built-in auth. Team membership is assigned at setup. The cap table is modeled as a holder list per the engine spec (forward compatibility for v3 within-team equity), but v1 binds one team per firm.

---

## 5. Round Lifecycle

A simple state machine, advanced by the instructor.

1. **Open.** The submission window for round `t` is open. Teams view their dashboard, optionally purchase information, draft and revise decisions, submit belief elicitations, and lock a decision vector before the deadline. Telemetry accrues throughout (§15.3 of the model spec).
2. **Locked.** The window closes (deadline or manual). Unsubmitted teams are treated per the engine's missing-decision rule (locked controls as zero); the application flags non-submitters for the instructor.
3. **Resolve.** The instructor triggers resolution (after previewing/editing any scheduled or live shock for the round, §7). The engine runs once over the full decision set; invariants are checked; the append-only history and all research tables are written.
4. **Published.** Results are released to teams: the diagnostics view, the updated scorecard standing, badge progress, and any public events (a shock, an antitrust action, a firm's exit, a new segment opening). The round index advances and the next window opens.

A weekly cadence of two rounds (decision due before each class) maps the lifecycle onto the course schedule.

---

## 6. Student Interface

### 6.1 The dashboard problem and the disclosure answer

A comprehensive sim should not present a wall of inputs. The interface grows with the team's own strategy and with the game's phase, so no team ever faces the full lever set at once.

### 6.2 Progressive disclosure (the implementation)

Disclosure is hybrid; the rule for sorting a lever is in the engine spec, the mechanics here.

- **Endogenous unlocks (earned through investment).** Fine-grained sub-controls within a domain appear once a team invests in that domain: detailed marketing controls after marketing spend, operational depth after process investment, investor-relations tools after IR investment, R&D/capability tiers as capability accrues. The unlock should read as a consequence of the team's own strategy. The engine accepts the full vector regardless; the interface reveals controls, it does not gate the underlying model.
- **Available early, in simple form.** All decision *domains* are present from early rounds in basic form rather than half the domains being hidden — financing pulls forward to roughly round 2–3, and the coopetition/agreements layer is available from round 1 so partnership commitment-vs-abandonment can accumulate history. Early rounds present few *controls* per domain (so the surface stays learnable and the model stays tunable), not few domains.
- **Timed system events.** The emergent third segment, shock intensification, and late-game positioning fire on the engine's schedule, not on any team's action.

The resulting phase texture is "existing domains deepen and system events fire," not "new domains suddenly appear" — a better model of real strategy and a gentler learning curve. The phase boundaries double as the pedagogical scaffold and, because early rounds have fewer interacting controls, as the balance-tuning schedule.

Indicative phase schedule over ~16 rounds (all timings in config):

| Phase | Rounds | What is live |
|---|---|---|
| 1 | 1–3 | Price, capacity, two segments, basic agreements. Learn the loop. |
| 2 | 4–8 | Financing levers, stakeholder investment, marketing/capability in simple form; fine controls begin unlocking endogenously. |
| 3 | 9–12 | Frontier segment emerges; shocks intensify; exit/re-entry/investor path fully live. |
| 4 | 13–16 | Full complexity, agreement dynamics mature, end-game positioning. |

### 6.3 Decision entry

A per-domain decision form (labeled in beverage terms — brew/lineup, tanks, taproom, distributors, collab/guild) writing to the `decisions` record, with draft state preserved across visits and a clear lock action. Each domain shows only its unlocked controls. A pre-submission summary surfaces the engine's legibility indicators (interest coverage, cash runway) so consequences are visible before locking.

### 6.4 Diagnostics view (results, not just a scoreboard)

The results view must decompose outcomes rather than presenting only ranks. For each firm it shows its within-segment share broken into the attraction factors (price, quality stock, brand stock, fit), the unit-cost build-up, the three statements in summary with the coverage/runway indicators, and stock levels with their depreciation. Making the causal model legible is the actual learning payload and the antidote to the reverse-engineer-why-you-lost frustration of opaque sims.

### 6.5 Strategy map

A 2D projection of the strategy-vector space (model spec §15.4) showing where the team sits relative to rivals — visualizing red-ocean crowding vs open-water distinctiveness. This is positioning pedagogy made visual and is among the highest UX-value elements; it is the student-facing face of the same construct that serves the research metric.

### 6.6 Belief elicitation and reflection

Before locking, teams enter their predictions (own rank, market size, a rival's move); after publication, the diagnostics view shows realized-vs-predicted as calibration feedback. A short free-text rationale box per round captures strategic reasoning. Both write to the research tables and require minimal interface (a few fields), making them high value-to-effort additions.

### 6.7 Information purchase

An optional costed market-research action that reduces the team's pre-decision uncertainty (and is logged as the value-of-information instrument). Presented as a clear cost-bearing choice, not a free reveal.

---

## 7. Instructor Interface

### 7.1 Shock timeline editor

At game setup the engine proposes a rolled shock timeline; the instructor previews, edits magnitudes/timing/signaling mode, and locks it. During play, a live-trigger control fires a configured shock for the in-class deliberate-vs-emergent moment. Endogenous rules (antitrust, distress dumping) fire automatically at resolution and are surfaced as published events.

### 7.2 Resolution controls

Open/close the submission window, view submission status (with non-submitter flags), preview the round's pending shocks, and trigger resolution. A confirmation step before resolution, since the append-only history makes resolution effectively final for that round.

### 7.3 Monitoring

A read-all dashboard: standings, the scorecard components, the agreements registry with governance-form tags and durations, exits/re-entries/investor elections, and any triggered investigations.

### 7.4 Config editor

Direct editing of the config object (model spec §14) between games and, where safe, between rounds. This is the instructor's primary tuning surface — balance adjustment and teaching-emphasis changes happen here, without code changes. Alternative saved configs are the mechanism for running sections or semesters as treatment conditions.

### 7.5 Data export

One-click export of the research tables to CSV (long format where applicable), keyed for direct Stata ingestion, honoring the consent flag and de-identification mapping.

---

## 8. Data Export and Research Pipeline

The export produces the model spec §15 tables. The intended downstream is **Stata**: `firm_round` as the primary firm-round panel; `agreements` analyzed as discrete-time partnership-durability hazards (`stset` then `stcox`/`streg`); `beliefs` for calibration and overconfidence; `telemetry` for decision-process-vs-outcome models; `strategy_vectors` and `distinctiveness` for the optimal-distinctiveness analysis (distinctiveness and its square on performance). The export should ship with a short data dictionary mapping each column to its engine definition so the panel is analysis-ready without reverse-engineering.

---

## 9. Build Sequencing

Balance is the real project risk, so the engine is built and validated before any interface investment.

1. **Engine core, headless.** Implement the resolution function and config loader. No UI.
2. **Balance harness.** Run headless across many seeds and scripted strategy archetypes; check the model spec §16 pathologies; tune config. This must pass before UI work begins.
3. **Persistence and lifecycle.** Data model, auth, RLS, the round state machine, engine invocation, append-only history.
4. **Student interface, phase-1 subset first.** Price/capacity/two-segment decision entry, the diagnostics view, belief elicitation, reflection. Validate the loop end-to-end with a small playtest before adding controls.
5. **Progressive disclosure and remaining domains.** Endogenous unlocks, financing, stakeholder investment, the strategy map.
6. **Coopetition layer.** The three governance forms and templates, plus the agreements registry view.
7. **Instructor tooling.** Shock editor, monitoring, config editor, export.
8. **Full-game playtest and re-tune.** Expect the coopetition and shock knobs to need adjustment against live play.

A self-contained single-player prototype (algorithmic rivals, in-browser, no backend) is a reasonable optional step 0 to feel the core loop and surface model-balance problems early, before committing to persistence.

---

## 10. Operational Notes

- **Non-submission** is handled by the engine's zero-fill rule and flagged to the instructor; the lifecycle never blocks on a missing team.
- **Exited teams** retain interface access in their elected path (banked, investor, or rebuilt firm) so they stay engaged; an exited operator with an investor stake sees that firm's published valuation, not its private decisions.
- **Consent and FERPA** (model spec §18): the consent flag and de-identification fields are part of the schema from the start; pedagogical/aggregate use needs nothing special, and any publication route is gated on the IRB/consent mitigations rather than retrofitted.

---

## 11. v1 / Deferred Boundary (Application Layer)

**In v1:** static front-end plus BaaS; round-based instructor-resolved lifecycle; the student and instructor interfaces above; hybrid progressive disclosure; CSV export to Stata.

**Deferred:** continuous (non-round) play and a self-hosted droplet; any UI for free-form agreement negotiation, multi-industry corporate-strategy views, within-team individual-equity trading, or subjective investor-evaluation interfaces. Per the engine spec, the data model is built so these slot in without a rewrite; this layer simply does not surface them in v1.
