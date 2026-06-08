> **[FOLDED IN 2026-06-08]** This addendum has been folded into both specs per its own instruction: a "Context — Drink Wars" section now lives near the top of `01_model_engine_spec.md` (with the full mapping tables) and `02_application_spec.md` (interface vocabulary), plus inline domain referents throughout. This file is retained for history only and is **superseded** by those sections — edit the specs, not this. Safe to delete.

# Drink Wars — Context Addendum to the v1 Specs

*Paste-ready handoff. This addendum fixes the game's name and context and maps every engine feature to its concrete domain referent, so the build uses consistent beverage vocabulary from the first commit. It supplements `01_model_engine_spec.md` and `02_application_spec.md`; section numbers below refer to those documents. The engine remains config-driven and context-agnostic — this layer is naming and defaults, not new mechanics.*

**Instruction for Claude Code:** Fold this addendum into both specs (add a "Context" section near the top of each, and apply the domain vocabulary throughout). Then begin the build at the engine-spec §9 sequencing: headless engine core, then the balance harness, before any UI.

---

## Name and Premise

**Name:** Drink Wars.

**Student-facing premise:** *"Your team runs a craft beverage company competing for drinkers across a regional market. Brew your lineup, build capacity, invest in quality and brand, manage your taproom community, your distributors, and the regulators — and decide whether to go it alone or collaborate with rival makers. Then the water table drops, a hop harvest fails, or a new category takes off."*

Context is craft beverage. The data model and engine stay industry-agnostic per the spec; "designed-for-not-built" multi-industry convergence (engine spec §17) anticipates a later expansion into adjacent categories (spirits, non-alcoholic, coffee) as related horizontal diversification.

---

## State Variables → Domain Referents (engine spec §3)

| Engine variable | Drink Wars referent |
|---|---|
| `cash` | Operating cash; running dry mid-expansion is the classic craft failure (forced exit). |
| `cap` | Fermentation and packaging capacity; build lag = tanks take time; over-build bleeds fixed cost. |
| `unit_cost` | Brewing efficiency, yield, packaging scale; the learning curve is accumulated brewing experience. |
| `Q` (capability/quality) | Recipe quality, brewing talent, consistency; rewarded by drinkers and by competition medals. |
| `B` (brand) | The load-bearing variable here — craft is brand-first. Exercises `B` harder than most contexts. |
| `T_emp` | Taproom community, regulars, local scene, employees → productivity + resilience engine. |
| `T_inv` | Investors and lenders → cost-of-capital engine. Craft is capital-hungry and cash-tight, so this bites. |
| `T_gov` | Regulators and the three-tier distribution system → regulatory-burden + retaliation/antitrust engine. |

---

## Segments (engine spec §5, §10)

| Segment | Referent | Coefficient tilt |
|---|---|---|
| Mass | Approachable lagers / light | Price-sensitive, high volume (high `βp`, low `βq`). |
| Niche | Craft premium — IPAs, specialty | Quality- and brand-sensitive (low `βp`, high `βq`, high `βb`). |
| Frontier (emergent) | Non-alcoholic / functional beverages | Opens as the timed emergence event — "a new category takes off"; carries the health/sustainability hook and seeds the v2 convergence path. |

---

## Shocks (engine spec §9)

| Role | Referent | Notes |
|---|---|---|
| Slow-burn resilience shock | Water scarcity / drought | Water is the core input; water-efficiency investment is the resilience lever (structural parallel to snowmaking), differentiated by prior investment per §9.4. No geographic-determinism problem — every brewer faces water. The primary sustainability lesson. |
| Dramatic trigger shocks | Hop/barley harvest failure; CO2 shortage; packaging/aluminum squeeze | Sudden, total, vivid — reserved for the in-class live-trigger moment. Hits the unprepared harder. |
| Endogenous: distress dumping | A failed brewer's inventory floods the market, depressing price next round. | Per §9.3. |
| Endogenous: antitrust/regulatory | Visible coordination (a guild coalition shading into price/capacity coordination) raises investigation probability, scaled by `T_gov`. | Per §9.3, §11.4. |

Use water as the foresight-rewards-resilience slow burn and the harvest/CO2 shocks for drama; together they close the immediacy gap.

---

## Coopetition (engine spec §11) — the strongest-fit layer

| Governance form | Referent |
|---|---|
| Relational / handshake | A collaboration brew — the industry's actual "collaboration over competition" culture. |
| Formal contract | A shared distribution or co-packing agreement. |
| Collective arrangement (3+) | A guild or regional marketing coalition (antitrust tension if it shades into coordination). |

Templates (§11.2): joint-marketing pact = collab release; capacity-coordination pact = coordinated output restraint; supply/infrastructure share = shared co-packing or distribution.

---

## Exit, Distinctiveness, Flavor

Exit/re-entry/investor (§8) all read naturally against craft's real shakeout: sell the brand while it holds value (clean exit), run out of cash mid-expansion (bankruptcy), launch a new concept (re-entry), or cash out and buy into a winner / fund a disruptor (investor path).

Strategic distinctiveness (§15.4) has an intuitive anchor: drinkers already group breweries by style and identity, so the student strategy map reads immediately as "crowded red ocean of hazy IPAs vs open water."

---

## Vocabulary Note for the Build

Apply these terms in UI labels, scenario text, and the data dictionary so the domain stays concrete: brew/lineup (decisions), tanks/capacity, taproom (community stock), distributors/three-tier (government channel), collab (relational agreement), guild (collective arrangement), category (segment). Keep internal engine variable names generic per the spec; surface the beverage vocabulary only at the presentation and config-label layer.
