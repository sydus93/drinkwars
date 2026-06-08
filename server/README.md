# Drink Wars — Persistence + Orchestration

The layer between the engine and the (future) UI: it persists state, runs the
round lifecycle, invokes the engine, writes the append-only history and research
tables, and enforces the confidentiality rules. This is **application-spec §9
step 3**. It reads/writes the engine only through its public API and never
reimplements resolution logic (§2.3).

Built **local-first**: all orchestration runs behind a `StorageAdapter`, with an
in-memory adapter for tests and local dev. The Supabase schema (Postgres + RLS) is
authored as a migration, to apply when the project is provisioned.

## Run it

```bash
# from repo root once: npm install   (sets up the engine⇄server workspace)
npm run demo   --workspace server    # full game through the lifecycle + replay + research capture
npm test       --workspace server    # lifecycle, guards, append-only, replay, consent
npm run typecheck --workspace server
```

(or `cd server && npm run demo`)

## Layout

```
src/
  types.ts            Orchestration records + the StorageAdapter contract.
  lifecycle.ts        GameOrchestrator — the round state machine + engine invocation.
  adapters/memory.ts  In-memory StorageAdapter (tests / local dev).
  index.ts            Public API.
  demo.ts             End-to-end lifecycle demo.
supabase/
  migrations/0001_init.sql   Postgres schema + RLS + append-only triggers.
test/lifecycle.test.ts
```

## The round lifecycle (§5)

```
open → locked → resolving → published → (open | complete)
```

- **open** — teams `submitDecision()` / revise; revision count + timing tracked (telemetry §15.3).
- **locked** — `lockRound()` shuts the window and flags non-submitters.
- **resolving** — `resolveRound()` zero-fills non-submitters, runs the engine **once**, appends the new world snapshot + results, writes the research tables.
- **published** — results released; `advanceRound()` opens the next round (or marks the game complete).

The orchestrator is storage-agnostic; swap `InMemoryAdapter` for a Supabase
adapter without touching lifecycle logic.

## What's enforced

- **Append-only history (§3.3).** `world_states`, `round_results`, `firm_round`,
  and the research tables reject re-writes (adapter throws; SQL has UPDATE/DELETE
  triggers). A resolved round is immutable.
- **Replayability (§3.3).** `replay()` re-runs the engine from the persisted
  `(config, seed, decisions)` and asserts the recomputed standings match the
  stored history — tested green.
- **Confidentiality (§3.2).** A team submits/reads only its own decisions, only
  while unlocked; no team-facing method exposes another team's pending decisions
  or another firm's private diagnostics. The SQL RLS policies encode this
  (`decisions`/`firm_round` scoped to the owning team; raw `world_states` /
  `round_results` instructor/service-role only; `public_round` for everyone).
- **Consent / de-identification (§18).** Per-user consent flag + de-id code;
  `firm_round` carries team-level consent so export can honor it.

## Deploying to Supabase — remaining steps

The schema + RLS are written; the live binding is not (local-first by choice):

1. `supabase init` + apply `supabase/migrations/0001_init.sql`.
2. Implement a `SupabaseAdapter` (a `StorageAdapter` over `@supabase/supabase-js`).
   The in-memory adapter is the reference for method semantics.
3. Wire Supabase Auth → the `users` table (role, consent, deid_code).
4. Run resolution server-side with the service role (bypasses RLS) and have the
   orchestrator write the `public_round` projection at resolution — students read
   that, not the raw `world_states`/`round_results`. (Locally, `getTeamView`
   derives the same standings from full data, which is fine for instructor/dev.)

These are step-3-completion items; the lifecycle, schema, and contract are done
and tested against the in-memory adapter.
