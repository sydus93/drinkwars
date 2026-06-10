# Drink Wars — Persistence + Orchestration

The layer between the engine and the UI: it persists state, runs the round
lifecycle, invokes the engine, writes the append-only history and research
tables, and enforces the confidentiality rules. This is **application-spec §9
step 3**. It reads/writes the engine only through its public API and never
reimplements resolution logic (§2.3).

Built **local-first** behind a `StorageAdapter`: an in-memory adapter backs tests
and local dev, and a **Supabase adapter** (Postgres + RLS) backs production — the
orchestrator never changes between them. Two parity transports expose it: a local
`node:http` server (`npm run serve`) and a **Supabase Edge Function** (Deno) for
production. The instructor analytics dashboard is a read-only aggregator over the
same persisted history (`src/dashboard.ts`).

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
  types.ts             Orchestration records + the StorageAdapter contract.
  lifecycle.ts         GameOrchestrator — the round state machine + engine invocation.
  adapters/memory.ts   In-memory StorageAdapter (tests / local dev).
  adapters/supabase.ts Supabase StorageAdapter (production).
  transport.ts         Local node:http transport (npm run serve; DW_ADAPTER=memory|supabase).
  edge-core.ts         Bundle entry for the Edge Function (npm run build:edge).
  dashboard.ts         Instructor analytics aggregator + CSV/JSON export (read-only).
  index.ts             Public API.
  demo.ts              End-to-end lifecycle demo.
supabase/
  functions/drinkwars/index.ts   Edge Function transport (Deno) — parity with transport.ts.
  config.toml                    verify_jwt=false (the function does its own gating).
  migrations/0001_init.sql       Postgres schema + RLS + append-only triggers.
  migrations/0002_join_code.sql  Per-game student join code.
  migrations/0003_owner_tag.sql  Instructor passcode-tier game ownership (control scoping).
test/*.test.ts
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

## Running the backend

**Local transport** (great for development; works with no DB in memory mode):

```bash
DW_ADAPTER=memory   npm run serve     # in-memory, no Supabase needed
DW_ADAPTER=supabase npm run serve     # against your Supabase project (needs server/.env)
```

**Supabase / production:**

1. Create a Supabase project; copy `.env.example` → `.env` and fill in your keys
   (the `service_role` key is secret — `.env` is gitignored and never committed).
2. Apply the migrations in `supabase/migrations/` (Supabase SQL editor or `supabase db push`).
3. Deploy the Edge Function: `npm run build:edge` (bundles `edge-core.ts` →
   `drinkwars-core.js`) then `supabase functions deploy drinkwars`. `config.toml`
   pins `verify_jwt=false` so the function does its own gating across redeploys.
4. Set the instructor passcodes as function secrets:
   `supabase secrets set DW_INSTRUCTOR_PASS=… DW_INSTRUCTOR_PASS_TEST=…`.

**Instructor passcodes & scoping.** Routes are gated on `DW_INSTRUCTOR_PASS`. An
optional `DW_INSTRUCTOR_PASS_TEST` is a second full-access passcode (e.g. for a
colleague) that is **scoped to only the games it creates**; the primary passcode is
a super-user over all games. Both transports enforce this identically.

Resolution runs server-side with the service role (bypassing RLS) and writes the
`public_round` projection students read — they never see raw `world_states` /
`round_results`. The in-memory adapter is the reference for method semantics, so
the lifecycle, schema, and contract stay verified against it.
