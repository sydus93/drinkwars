# Strategy Simulation — Model & Engine Specification (v1)

*Build document for the economic core. The companion application spec covers architecture, UI, disclosure flow, and instructor controls. This document leads with the model and data structures; the engine should be buildable and balance-testable in isolation, with no UI dependency.*

---

## Context — Drink Wars

*Folded in from the v1 context addendum (`03_drink_wars_context_addendum.md`, now superseded by this section). The engine stays config-driven and industry-agnostic — this layer is naming and defaults, **not new mechanics**. Internal engine variable names remain generic; beverage vocabulary surfaces only at the config-label and presentation layer.*

**Name:** Drink Wars.

**Premise (student-facing):** *"Your team runs a craft beverage company competing for drinkers across a regional market. Brew your lineup, build capacity, invest in quality and brand, manage your taproom community, your distributors, and the regulators — and decide whether to go it alone or collaborate with rival makers. Then the water table drops, a hop harvest fails, or a new category takes off."*

Context is craft beverage. The "designed-for-not-built" multi-industry convergence (§17) anticipates a later expansion into adjacent categories (spirits, non-alcoholic, coffee) as related horizontal diversification.

**State variables → domain referents (§3):**

| Engine variable | Drink Wars referent |
|---|---|
| `cash` | Operating cash; running dry mid-expansion is the classic craft failure (forced exit). |
| `cap` | Fermentation and packaging capacity; build lag = tanks take time; over-build bleeds fixed cost. |
| `unit_cost` | Brewing efficiency, yield, packaging scale; the learning curve is accumulated brewing experience. |
| `Q` (capability/quality) | Recipe quality, brewing talent, consistency; rewarded by drinkers and competition medals. |
| `B` (brand) | The load-bearing variable here — craft is brand-first; exercises `B` harder than most contexts. |
| `T_emp` | Taproom community, regulars, local scene, employees → productivity + resilience engine. |
| `T_inv` | Investors and lenders → cost-of-capital engine. Craft is capital-hungry and cash-tight, so this bites. |
| `T_gov` | Regulators and the three-tier distribution system → regulatory-burden + retaliation/antitrust engine. |

**Segments (§5, §10):**

| Segment | Referent | Coefficient tilt |
|---|---|---|
| Mass | Approachable lagers / light | Price-sensitive, high volume (high `βp`, low `βq`). |
| Niche | Craft premium — IPAs, specialty | Quality- and brand-sensitive (low `βp`, high `βq`, high `βb`). |
| Frontier (emergent) | Non-alcoholic / functional | Opens at the timed emergence event ("a new category takes off"); seeds the v2 convergence path. |

**Shocks (§9):**

| Role | Referent |
|---|---|
| Slow-burn resilience shock | Water scarcity / drought — the core-input slow burn and primary sustainability lesson. |
| Dramatic trigger shocks | Hop/barley harvest failure; CO2 shortage; packaging/aluminum squeeze — reserved for the live in-class trigger. |
| Endogenous: distress dumping | A failed brewer's inventory floods the market, depressing price next round (§9.3). |
| Endogenous: antitrust | A guild coalition shading into price/capacity coordination raises investigation probability, scaled by `T_gov` (§9.3, §11.4). |

**Resilience note (no new state variable):** the water-scarcity slow burn is mitigated by *prior operations/process investment* (water-efficiency — the structural parallel to snowmaking) and by `T_emp` (community resilience) per §9.4. Both are existing levers; the process stock and `T_emp` carry the resilience role, so no resilience fundamental is added.

**Coopetition (§11):**

| Governance form | Referent |
|---|---|
| Relational / handshake | A collaboration brew — the industry's actual "collaboration over competition" culture. |
| Formal contract | A shared distribution or co-packing agreement. |
| Collective arrangement (3+) | A guild or regional marketing coalition (antitrust tension if it shades into coordination). |

Template referents: joint-marketing pact = collab release; capacity-coordination pact = coordinated output restraint; supply/infrastructure share = shared co-packing or distribution.

**Exit / distinctiveness (§8, §15.4):** craft's real shakeout reads directly — sell the brand while it holds value (clean exit), run out of cash mid-expansion (bankruptcy), launch a new concept (re-entry), or cash out and buy into a winner / fund a disruptor (investor path). Drinkers already group breweries by style, so the strategy map reads immediately as "crowded red ocean of hazy IPAs vs open water."

**Build vocabulary:** brew/lineup (decisions), tanks/capacity (`cap`), taproom (`T_emp`), investors/lenders (`T_inv`), distributors/three-tier (`T_gov`), collab (relational agreement), guild (collective arrangement), category (segment). Keep engine variable names generic; surface the beverage vocabulary only at the presentation and config-label layer.

---

## 1. Purpose and Scope

This document specifies the deterministic economic engine for a turn-based, multi-firm strategy simulation used in an undergraduate capstone course. The engine takes, for a given round, the full set of team decisions plus the current world state, and returns the next world state plus a per-firm results record. It is intentionally backend-agnostic: the resolution logic is a pure function of (state, decisions, config, RNG seed), so it can be validated from a script before any interface exists.

**v1 covers:** one industry, three segments (third emergent), 8–10 firms, the five core state variables, three decomposed stakeholder sub-stocks, a logit demand engine, a derived three-statement finance layer with endogenous cost of capital, exit/re-entry/operator-to-investor mechanics, a probabilistic-plus-triggerable shock system, a pared-down three-form coopetition layer, a sustained balanced-scorecard score plus a badge layer, and the full data-export schema.

**v1 explicitly excludes** (see §17): free-form negotiated agreements, multi-industry/relatedness, individual within-team equity, subjective investor evaluations, stakeholder cross-effects, and continuous (non-round) play. The data model is built to accommodate these without rewrite.

---

## 2. Design Principles

These constraints are load-bearing. Departing from them is how the model goes degenerate or unmaintainable.

**Tiny core, many surface levers.** Every decision domain (marketing, HR, operations, geography, finance) feeds a small set of fundamentals. No decision domain gets its own scoring track or parallel subsystem. The rule for adding any lever: it must route to an existing state variable or engine.

**Stocks with depreciation and lags, not flows.** Intangibles (capability, brand, all three stakeholder sub-stocks) accumulate over rounds and decay without maintenance. This is the single highest-leverage modeling choice: it creates path dependence, rewards strategic commitment over reactive flailing, prevents single-round whipsaw exploits, and makes the decision data interesting because investment becomes a commitment under uncertainty.

**One stakeholder sub-stock, one engine.** In v1 each stakeholder channel routes to exactly one primary engine. Cross-wiring everything to everything produces an untunable feedback tangle. Deliberate cross-effects are a v2 enrichment.

**Config-driven, nothing hardcoded.** Elasticities, cost curves, shock distributions, segment parameters, scorecard weights, agreement and trust knobs, round count — all live in a single config object. This serves three goals simultaneously: instructor tuning without code changes, balance adjustment by editing parameters, and research use (alternative parameterizations are treatment conditions across sections or semesters).

**Finance as a derived layer.** The three statements are overwhelmingly derived from decisions already in the model. They make existing consequences legible; they do not add new machinery beyond a small financing lever set.

**Decouple score from grade.** The engine produces competitive standing; the course awards participation as the graded floor and competitive performance as extra credit only. This is a course-design decision, noted here because it is what keeps exit, risk-taking, and abandonment behaviorally honest in the data.

---

## 3. State Variables

### 3.1 Core firm state (five fundamentals)

Every "comprehensive" lever resolves into one of these.

| Variable | Symbol | Role | Dynamics |
|---|---|---|---|
| Cash / capital | `cash` | Scoreboard and hard constraint. `cash ≤ 0` triggers forced exit. | Updated by the cash-flow statement each round. |
| Capacity | `cap` | Production ceiling. Over-build wastes fixed cost; under-build cedes demand to rivals. | Built by investment with a one-round lag; depreciates. |
| Cost position | `unit_cost` | Effective unit cost. | Derived each round from scale, location, process investment (learning curve), and employee-trust productivity. |
| Capability / quality stock | `Q` | Intangible quality driver of demand attractiveness. | Accumulates from R&D/HR investment with lag; depreciates. |
| Brand / awareness stock | `B` | Intangible awareness driver of demand attractiveness. | Accumulates from marketing investment with lag; depreciates. |

Standard stock update for `Q` and `B`:

```
Q_{t+1} = (1 - δ_Q) · Q_t + g_Q · invest_Q_{t-lag_Q}
B_{t+1} = (1 - δ_B) · B_t + g_B · invest_B_{t-lag_B}
```

with depreciation `δ`, conversion gain `g`, and investment lag `lag` all in config. Concave conversion (e.g. `g · sqrt(invest)` or log) is recommended to prevent rich-get-richer; see §16.

### 3.2 Stakeholder sub-stocks (three channels, one engine each)

Each is a depreciating stock built by costed investment, mostly orthogonal in v1.

| Sub-stock | Symbol | Primary engine (v1: exactly one) |
|---|---|---|
| Employee / community trust | `T_emp` | Productivity multiplier on the cost engine **and** shock-resilience multiplier. |
| Investor trust | `T_inv` | Cost-of-capital term (debt spread and equity cost). |
| Government trust | `T_gov` | Regulatory-burden opex **and** ban/retaliation and antitrust trigger probabilities. |

Same stock dynamics as §3.1. The teaching payload: stakeholder groups are not interchangeable, and their value is contingent option value (mainly realized under stress), not a steady drip. A firm optimizing the visible scoreboard underinvests in trust and is disproportionately harmed by shocks.

### 3.3 World state

Segment demand sizes `D_s` (with `D_3` inactive until emergence), the active shock timeline, the outstanding-agreements registry, the firm registry (active / exited / re-entered, with cap-table holders — single holder in v1 but modeled as a list), cumulative output per firm (for the learning curve), and the round index.

---

## 4. Decision Space and Lever-to-Fundamental Map

Each round, an active operator firm submits a decision vector. Every lever maps to a fundamental; none introduces a parallel system.

| Lever | Routes to |
|---|---|
| Price per segment `p_{i,s}` | Demand engine directly. |
| Capacity investment | `cap` (lagged). |
| Process / operations investment | `unit_cost` (learning-curve acceleration). |
| Capability / R&D / HR-quality investment | `Q` (lagged). |
| Marketing investment (per segment weighting allowed) | `B` (lagged). |
| Segment allocation / presence | Demand engine (which segments the firm serves and with what intensity). |
| Employee/community investment | `T_emp`. |
| Investor-relations investment | `T_inv`. |
| Government/regulatory investment | `T_gov`. |
| Financing actions (debt draw/repay, equity raise, dividend) | Finance layer (§7). |
| Information purchase (market research) | No state effect; reduces the firm's pre-decision uncertainty and is logged (value-of-information instrument, §15). |
| Agreement actions (form / honor / defect) | Coopetition layer (§11). |
| Exit / re-entry / invest action | Exit layer (§8). |

Fine-grained sub-controls within a domain unlock endogenously through investment (specified in the application spec); the engine accepts the full vector regardless and treats locked controls as zero.

---

## 5. Demand Engine

A logit (multinomial-choice) attraction model, run per segment. Chosen because shares are always valid, decisions map intuitively to share, and the outside option lets total industry demand expand and contract — which makes shakeout emergent rather than scripted.

### 5.1 Attractiveness and share

For firm `i` in segment `s`, representative-consumer utility:

```
U_{i,s} = α_s
        − βp_s · p_{i,s}
        + βq_s · Q_i
        + βb_s · B_i
        + βfit_s · presence_{i,s}
        + agreement_demand_mod_{i,s}      // from §11
```

Within-segment share against an outside option `U0_s`:

```
σ_{i,s} = exp(U_{i,s}) / ( Σ_j exp(U_{j,s}) + exp(U0_s) )
```

Segment-specific coefficient vectors (`βp_s, βq_s, βb_s`) define positioning: a price-sensitive mass segment (high `βp`, low `βq`), a quality-sensitive niche (low `βp`, high `βq`), and an emergent frontier segment (§10.3). This delivers focus-vs-breadth and defensible-niche-survival strategies with no new machinery.

The outside option is the collective-feedback mechanism: when the whole industry over-prices or under-invests, `Σ exp(U)` falls relative to `exp(U0)`, total served demand contracts, and the entire industry is punished. This is the deliberate-vs-emergent lesson built into the math.

### 5.2 Capacity rationing

Desired quantity `q*_{i,s} = D_s · σ_{i,s}`. Actual sales are capacity-bounded:

```
q_{i,s} = min( q*_{i,s}, capacity allocated to s )
```

Unmet demand handling (config switch): a `lost_fraction` is lost to the outside option, the remainder redistributes to non-constrained firms in proportion to their residual shares. Keep redistribution single-pass in v1 for determinism.

### 5.3 Thin-segment caution

At 8–10 firms across three segments, a segment can average ~3 firms and drift toward accidental monopoly. The outside-option level and a cross-segment substitution term must be tuned so a near-empty segment does not hand one firm uncontested rents. Flag `U0_s` and any substitution coefficient as high-priority tuning knobs.

---

## 6. Cost and Production Engine

Effective unit cost combines scale/experience, deliberate process investment, location, and employee-trust productivity:

```
unit_cost_i = c_base
            · learning(cum_output_i)          // declines with cumulative experience
            · (1 − process_effect_i)          // bounded by process investment, concave
            · location_factor_i
            / productivity(T_emp_i)            // employee/community trust raises productivity
```

`learning()` follows a standard experience curve with a config learning rate. `productivity(T_emp)` is increasing and bounded (e.g. `1 + κ · T_emp/(T_emp + h)`). Capacity carries a per-unit fixed/maintenance cost so over-building is penalized through the P&L, not only through cash.

---

## 7. Finance Layer (Derived, Legible)

### 7.1 The three statements

Mostly derived from decisions already taken. The statements make consequences visible; they are not a new decision burden beyond §7.3.

**P&L:** `Revenue = Σ_s p_{i,s}·q_{i,s}`; `COGS = Σ_s unit_cost_i·q_{i,s}`; operating expenses = marketing + capability + the three stakeholder investments + fixed overhead + regulatory burden(`T_gov`); minus depreciation of capacity; minus interest (§7.4); equals net income.

**Balance sheet:** Assets (cash + net PP&E) = Liabilities (debt) + Equity (paid-in + retained earnings). Intangible stocks are tracked in firm state but not capitalized on the balance sheet in v1, to avoid a valuation rabbit hole.

**Cash flow:** operating (net income + depreciation − Δworking-capital) + investing (−capex) + financing (debt draw − repay + equity raised − dividends) = ΔCash.

### 7.2 Invariants (enforced and used as engine self-checks)

1. The balance sheet must balance every round: `Assets ≡ Liabilities + Equity`.
2. The cash-flow statement must reconcile to the change in the `cash` state variable: `ΔCash (statement) ≡ cash_{t+1} − cash_t`.

These identities make the "strong P&L, secretly no cash" illusion impossible to fake — the core finance lesson — and double as consistency assertions that catch engine bugs.

### 7.3 Financing levers (available early, ~round 2–3)

Draw or repay debt, raise equity (dilutes existing holders), retain, pay dividend. Simplified but consistent; not an accounting course. The teaching view surfaces interaction indicators (interest-coverage ratio, cash-runway in rounds), not raw statements, in early rounds.

### 7.4 Endogenous cost of capital

```
r_debt_i = r_f + spread(leverage_i, coverage_i, T_inv_i)
```

Spread rises with leverage, falls with coverage and investor trust. Below a coverage threshold, credit is rationed (debt capacity capped) or repriced punitively — so over-leverage with thin coverage can force exit even on a healthy P&L. Equity issuance cost behaves analogously. This is where investor trust earns its single channel.

### 7.5 Firm valuation (for the investor path)

A derived fair value used when an exiting team buys a passive stake:

```
V_i = net_assets_i + multiple · normalized_earnings_i + premium(Q_i, B_i, stakeholder stocks)
```

`multiple`, the normalization window, and premium weights are config. No negotiation in v1: stakes transact at `V_i`.

---

## 8. Exit, Re-entry, and Operator-to-Investor

### 8.1 Voluntary exit

Recovers partial capital at a liquidation value that **declines the longer a bleeding firm waits**:

```
liquidation_i = base_recovery · assets_i · decay(rounds_below_health_threshold_i)
```

A clean early exit beats a fire sale, so exit *timing* is a genuine decision rather than pure surrender.

### 8.2 Forced exit (bankruptcy)

`cash ≤ 0` (or sustained breach of a solvency covenant) forces exit recovering little. This is the penalty floor that makes exit-timing meaningful.

### 8.3 Re-entry (in v1, guarded)

A re-entered firm pays an entry cost and must be repositioned (different primary segment focus and/or a distinct capability bet) — operationalizing creative destruction rather than a respawn. Anti-churn guards: a one-round cooldown plus an escalating re-entry cost on repeated cycles. Both in config.

### 8.4 Operator-to-investor

On exit a team chooses one of three paths, all unified by the terminal-wealth metric on initial capital:

- **Bank** the payout (cash, earns `r_f`).
- **Invest:** buy a passive equity stake at fair value `V_i` (§7.5) in a surviving firm; the stake's value tracks that firm's subsequent valuation.
- **Rebuild:** start a clean-slate firm (per §8.3) to counterposition or disrupt entrenched incumbents.

The cap table is modeled as a list of holders to keep v3 within-team individual equity forward-compatible, though v1 only ever populates a single holder per firm.

---

## 9. Shock System

### 9.1 Scheduled, editable timeline

At game initialization the engine rolls a shock timeline from config distributions (type, round, magnitude, signaling mode) and presents it to the instructor as an editable, lockable preview — deliberate for the instructor, exogenous-feeling for students.

### 9.2 Live trigger

The instructor can fire a configured shock in real time, for the in-class deliberate-vs-emergent moment.

### 9.3 Endogenous rules (2–3 in v1)

Conditional rules evaluated each resolution:

- **Antitrust / regulatory:** visible coordination (a guild coalition or formal pacts above a coordination threshold) raises investigation probability, scaled down by `T_gov` (the regulator/three-tier channel). A triggered investigation imposes penalties and constrains the implicated agreements.
- **Distress dumping:** a failed brewer's collapse dumps inventory, depressing segment price/attractiveness the following round.
- (Optional third) demand contagion or supply disruption, config-gated.

### 9.4 Resilience differentiation and signaling

Shock impact is reduced by prior resilience investment and by `T_emp`, so pre-shock strategy matters and echoes the disaster-resilience theme. Signaling mode is a data instrument: **unannounced** shocks measure response to pure surprise; **noisily pre-signaled** shocks measure whether teams act on weak signals.

---

## 10. Segments and Industry Emergence

### 10.1 v1 segments

Three: a price-sensitive mass segment (approachable lagers/light), a quality-sensitive niche (craft premium — IPAs, specialty), and an emergent frontier segment (non-alcoholic/functional, the "new category"; `D_3` inactive at start).

### 10.2 Positioning

Achieved entirely through segment-specific demand coefficients (§5.1); no extra machinery.

### 10.3 Emergent third segment

Structurally identical to a positive demand shock. It opens as a **timed system event**, optionally condition-triggered (e.g. total industry capability stock crossing a threshold). Framed in-game as "a new market emerges" — a teachable industry-evolution moment and a first taste of the v2 convergence/divergence theme, using shock-engine machinery already present.

---

## 11. Coopetition Layer (Pared-Down, Live from Early Game)

The pedagogically interesting variation is in the **governance form**, not the agreement content. v1 ships a fixed menu of agreement templates that can be held under three governance forms, available from round 1 so commitment-vs-abandonment history can accumulate.

### 11.1 Three governance forms

| Form | Formation cost | Enforcement | Defection | Tests |
|---|---|---|---|---|
| Relational / handshake | None | None | Free, but burns `T_emp`/`T_inv` and the counterparty's future willingness | Relational governance, reputation |
| Formal contract | Setup cost | Breach penalty | Costly (penalty); reduces flexibility | TCE, contractual governance, hold-up |
| Collective arrangement (3+ firms) | Moderate | Partial / norm-based | Free-rider and defection pressure rising with group size | Olson / Ostrom collective action |

### 11.2 Templates (choose template + counterparty, not custom terms)

- **Joint-marketing pact** (collab release): pooled `B` effect across signatories in a chosen segment.
- **Capacity-coordination pact** (coordinated output restraint): signatories restrain capacity for higher joint margins (raises antitrust probability).
- **Supply/infrastructure share** (shared co-packing or distribution): shared fixed cost lowering each signatory's `unit_cost`.

Each template resolves as a modifier on the demand and/or cost engine plus a trust effect; collective arrangements additionally feed the antitrust trigger. No new scoring track.

### 11.3 v1 boundary

No free-form terms, no renegotiation, no side-payments. These are v2 dials.

### 11.4 Degeneracy guards (expect post-playtest tuning)

Two failure directions: nobody cooperates (defection too cheap) or everyone forms a stable cartel (industry goes sleepy). The trust-cost of defection guards the first; the antitrust trigger guards the second. Expose both as prominent config knobs; plan to tune them against live play.

---

## 12. Scoring

### 12.1 Scoreboard: sustained balanced scorecard

One headline metric, balance-tested. Each component is scored on **accumulated/sustained** performance across rounds (round-averaged or area-under-the-curve), not a final snapshot — which kills the end-game liquidation exploit and operationalizes "sustained advantage" literally.

| Component | Weight | Content |
|---|---|---|
| Financial health | 30% | Sustained profitability (ROIC/margin) + balance-sheet soundness (coverage/leverage in healthy bands) + cash resilience (rounds above a safety threshold). |
| Market position | 30% | Sustained within-segment share, weighted so defensible niche leadership counts comparably to mass share; optional share-stability credit. |
| Intangible capital | 20% | `Q` and `B` net of depreciation — the durable, hard-to-imitate base. Rewards the strategic-commitment play. |
| Stakeholder support | 20% | Mean of the three sub-stocks. Prices the contingent, insurance-like investment the visible scoreboard otherwise underweights. |

The 30/30/20/20 tilt says financial and market results are the *proof* of advantage while intangibles and stakeholders are its *sources* — present but not dominating. Flatten toward 25/25/25/25 to make the soft factors bite harder. All weights and within-component blends are config.

Within-round normalization (percentile or z-score across active firms) before accumulation keeps components comparable and robust to scale.

### 12.2 Badge layer (many, loose, not mutually balance-tested)

Orthogonal recognition, not a single optimization target, so badges need not be balanced against one another. Suggested set: most profitable, highest market capitalization, most distinctive/protected position (§15.4), most stakeholder support, best comeback, cleanest exit (best exit-timing recovery), best investor return (terminal wealth / IRR on initial capital — the investor-path metric). Each badge is a teaching artifact: many ways to play well, often in tension.

---

## 13. Round Resolution Sequence

Determinism requires a fixed order of operations. Given prior state, the submitted decision vectors, config, and a seed:

1. **Ingest decisions.** Validate; treat locked or missing controls as zero. Log telemetry and belief elicitations (§15).
2. **Apply financing actions.** Debt/equity/dividend update cash and capital structure; recompute `r_debt`, coverage, credit availability.
3. **Resolve agreement actions.** Form/honor/defect; update the agreements registry and apply trust effects of defection.
4. **Update lagged stocks to current.** Capacity from prior investment; `Q`, `B`, stakeholder stocks from lagged investment net of depreciation.
5. **Evaluate timed and endogenous events.** Segment emergence; scheduled shocks; endogenous rules (antitrust, distress dumping) using pre-shock state.
6. **Compute unit cost** per firm (§6).
7. **Compute attractiveness, shares, desired and capacity-rationed quantities** per segment (§5), applying agreement demand modifiers and any active shock effects.
8. **Build the three statements**; enforce both invariants (§7.2); update `cash` and balance sheet.
9. **Apply resilience-differentiated shock damage** where shocks hit (§9.4).
10. **Check solvency / exit conditions.** Forced exits; process voluntary exits and investor-path elections; settle investor stakes at updated valuations.
11. **Compute distinctiveness vectors and metrics** (§15.4) on the round's strategy profile.
12. **Update the running scorecard** (§12.1) with this round's normalized components.
13. **Emit the per-firm results record and the next world state**; advance the round index.

Steps 5 and 7 must read the same pre-event snapshot to keep endogenous-rule evaluation order-independent.

---

## 14. Config Schema

A single object (JSON or YAML). Indicative structure; exact keys at build time.

```yaml
game:
  n_rounds: 16            # any N; phase structure fixed, count tunable 14–18
  n_firms: 10
  seed: 12345
segments:
  - {id: mass,     alpha, beta_p, beta_q, beta_b, beta_fit, D0, growth, U0}
  - {id: niche,    ...}
  - {id: frontier, active_at: emergent, trigger: capability_threshold, ...}
demand:
  unmet_demand_lost_fraction: 0.5
  cross_segment_substitution: 0.1
costs:
  c_base, learning_rate, process_effect_max, capacity_fixed_cost, location_factors
stocks:
  Q:  {depreciation, gain, lag, conversion: concave}
  B:  {depreciation, gain, lag, conversion: concave}
  T_emp: {depreciation, gain, lag}
  T_inv: {depreciation, gain, lag}
  T_gov: {depreciation, gain, lag}
finance:
  r_f, debt_spread_fn_params, coverage_threshold, equity_issue_cost
  valuation: {multiple, normalization_window, premium_weights}
exit:
  base_recovery, liquidation_decay, bankruptcy_recovery
  reentry: {cost, cost_escalation, cooldown_rounds, reposition_required: true}
shocks:
  timeline_distributions: [...]
  signaling_modes: [unannounced, signaled_noisy]
  resilience_effect, endogenous_rules: {antitrust:{...}, distress_dumping:{...}}
coopetition:
  forms: {relational:{...}, formal:{setup_cost, breach_penalty}, collective:{...}}
  templates: {joint_marketing:{...}, capacity_coordination:{...}, supply_share:{...}}
  defection_trust_cost, antitrust_coordination_threshold
scoring:
  weights: {financial: 0.30, market: 0.30, intangible: 0.20, stakeholder: 0.20}
  accumulation: round_average    # or auc
  normalization: zscore_within_round
disclosure:
  endogenous_unlocks: [marketing_fine, ops_fine, ir_fine, rnd_tiers]
  timed_unlocks: {financing: 2, segment_frontier: emergent, shock_intensify: 10}
```

Treating alternative config files as treatment conditions is the intended research workflow.

---

## 15. Data Instruments and Export Schema

All tables export to CSV with stable keys, designed for direct ingestion into **Stata** (one observation per firm-round where applicable; long format preferred for panel work).

### 15.1 Decisions and outcomes

`firm_round` — one row per firm per round: all submitted levers, resolved quantities/prices per segment, unit cost, the three statements' line items, every state variable post-resolution, scorecard components (raw and normalized), active status.

### 15.2 Belief elicitation

Before resolution each round, teams predict own rank, total market size, and a named rival's headline move; a small accuracy bonus uses a proper scoring rule. `beliefs` table stores predictions, realized values, and scored error → calibration curves and overconfidence measures.

### 15.3 Decision telemetry

`telemetry` table: time-to-decide, revision count before submit, whether information was purchased before deciding, early-vs-deadline submission, and intra-team disagreement (if members submit individual recommendations before the team locks one). Uniquely available to a custom engine; supports decision-process-vs-outcome analysis under uncertainty.

### 15.4 Strategic distinctiveness

Each firm-round is a vector in a fully defined strategy space (prices, capacity, segment allocation, `Q`, `B`, the three stakeholder stocks, capital structure). Because the data-generating process is known, the usual archival hard part — defining comparable dimensions — is solved by construction.

Computed post-hoc (Stata-friendly):

- Standardize each dimension **within round**; optionally factor-reduce (PCA / factor analysis) to latent dimensions (cost-focus, differentiation, stakeholder-orientation, financial-aggressiveness).
- Two complementary measures, kept distinct because they are different constructs: **Mahalanobis distance to the within-round centroid** (global rarity, in the whitened space so correlated levers do not double-count) and **nearest-neighbor distance** (local competitive crowding).
- Trajectories from the panel: rising distinctiveness (deliberate differentiation) vs falling (herding); shrinking industry variance (convergence) vs widening (divergence).
- Headline analysis: distinctiveness × performance with a squared term, to test optimal distinctiveness (too crowded penalized, too idiosyncratic penalized, interior peak).

Stored in a `strategy_vectors` table (standardized dimensions) plus a `distinctiveness` table (the two distances per firm-round). Triple-use: the same construct powers a student-facing strategy map (application spec), the research metric, and an empirical operationalization of strategic uniqueness.

### 15.5 Reflection text

One short free-text rationale per firm-round → a qualitative corpus of strategic reasoning suitable for later coding.

### 15.6 Agreements

`agreements` table: one row per agreement with governance-form tag, template, signatories, formation round, dissolution round (or survived-to-end), and dissolution type (defection vs mutual). This is a clean partnership-durability survival dataset by governance form — directly analyzable as a discrete-time hazard model in Stata (e.g. `stcox` / `streg` after `stset`).

---

## 16. Balance Traps and Tuning Notes

Documented so the prototype is built defensively and balance is validated before students see it.

1. **Runaway leader.** Multiplicative attractiveness hands the early winner everything. Mitigations: concave returns on every lever, capacity constraints, and the demand-contracting outside option.
2. **Dominant strategy / exploit.** Ensure every lever sits inside a genuine tradeoff (price↔margin, focus↔breadth, invest-now↔cash-buffer). Red-team each parameterization before deployment.
3. **Memoryless flailing.** Prevented by stocks-with-lags (§2).
4. **Death spiral with no agency.** Mitigations: niche refuges, re-entry, partial-capital exit, grade-decoupling.
5. **First-round lottery.** Suppress early randomness; scale shocks toward mid/late rounds.
6. **Degenerate cooperation.** See §11.4.
7. **Thin-segment monopoly.** See §5.3.

Validation workflow: run the engine headless across many seeds and scripted strategy archetypes, check for the above pathologies, and tune config before any UI work. Balance is the real project risk; the split into two specs exists to allow this validation in isolation.

---

## 17. v1 / Deferred Boundary

**In v1:** everything specified above.

**Designed-for, not built (forward-compatible in the data model):**

- Free-form negotiated agreements, renegotiation, side-payments (extends §11).
- Multi-industry with relatedness: treat an industry as a parameterized instance of this engine; let firm state span instances; relatedness becomes a coefficient matrix (capability transfers at a discount to related industries; unrelated diversification gets no transfer plus a focus penalty). Convergence/divergence is that matrix evolving over time. v1 must avoid hardcoding single-industry assumptions.
- Individual within-team equity / markets for corporate control (the investor stakeholder relationship turned inward). The cap-table-as-holder-list (§8.4) is the forward-compatibility hook.
- Subjective investor evaluations of firm relationships (needs differentiated investor relationships first).
- Stakeholder cross-effects (relaxing the one-stock-one-engine rule).
- Continuous (non-round) play.

---

## 18. Research-Use Note (Non-Engine)

Purely pedagogical and aggregate-teaching use of the resulting data requires nothing special. Publishing on student decision data makes this human-subjects research: IRB approval, FERPA compliance, and the coercion concern around tying participation to extra credit all apply. The standard mitigations are an equivalent alternative for the credit, consent collected so it cannot affect grading, and consent ideally gathered after grades post. The grade-decoupling design (§2) helps on the coercion dimension. This note is recorded here only so the data schema's consent flag and de-identification fields are built in from the start.
