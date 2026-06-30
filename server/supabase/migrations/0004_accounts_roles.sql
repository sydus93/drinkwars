-- Drink Wars — accounts, player identity, team roles & multi-seat firms.
-- Apply AFTER 0003_owner_tag.sql.
--
-- Durable, ADDITIVE schema for three product goals, per the DW decision log:
--   (1) Instructor ROSTER-PROVISIONED accounts + "return to a game"
--   (2) Per-player game history / career across games
--   (3) Role specialties (CEO/CFO/CMO/COO/CHRO) with SUPPORT FOR BOTH solo firms
--       (one player) AND team firms (several players sharing a firm).
--
-- Every column/table is nullable / idempotent / unused-until-opted-in, so existing rows
-- AND the current anonymous-join + per-team `decisions` flow keep working unchanged
-- (all-off parity, same spirit as the engine modules). Heavier app-layer work (the
-- roster-provisioning endpoint, per-seat decision merge at lock) is tracked in the
-- decision log; this migration only lays the data model so those land without a reshape.
--
-- IMPORTANT (prod): prod's migration history was applied by hand (0001–0003), so run
--     supabase migration repair --status applied 0001 0002 0003
-- BEFORE `supabase db push`, else 0001_init re-runs non-idempotently. (See vault DW notes.)

-- ── (1)/(2) Persistent, roster-provisioned player identity ───────────────────────────
-- A stable external id (NetID / institutional email) is the CAREER KEY: the instructor
-- provisions a user once per term, and that same user joins many games, so history accrues
-- to one identity instead of a throwaway anon user per join. display_name gives a
-- consistent human label. Research export still de-identifies via deid_code — these are
-- presentation/identity only and never enter the de-identified panel. Multiple NULLs are
-- allowed (Postgres unique ignores NULL), so legacy anonymous users are unaffected.
alter table users add column if not exists external_id  text unique;  -- NetID, roster key
alter table users add column if not exists display_name text;
alter table users add column if not exists cohort       text;          -- e.g. "F26-CAPSTONE" (roster grouping)

-- An optional human title so a player's game list reads "Fall 2026 Capstone · Game 3".
alter table games add column if not exists title text;

-- Per-game seat mode. 'solo' = one player per firm (today's model, default). 'team' =
-- several players share a firm as C-suite seats (decisions merged at lock). Set at create.
alter table games add column if not exists firm_mode text not null default 'solo'
  check (firm_mode in ('solo','team'));

-- Make "every game this player has played" (career list + return-to-game picker) cheap.
create index if not exists team_members_user_idx on team_members (user_id);

-- ── (3) Role specialty per seat ───────────────────────────────────────────────────────
-- team_members already allows MANY users per team (composite PK); this names what each
-- seat runs. NULL = generic/sole controller (today's behavior). Maps onto the pro-mode
-- desk filter: cmo→Commercial, coo→Operations, cfo→Finance, chro→people, ceo→all+tiebreak.
alter table team_members
  add column if not exists role text
    check (role is null or role in ('ceo','cfo','cmo','coo','chro','member'));

-- ── (3) Multi-seat decision composition (used when firm_mode='team') ──────────────────
-- Each seat edits ONLY its desk's levers; the server merges all of a team's partials into
-- the single per-team `decisions` row at lock, then resolves as today. Mutable until lock
-- (NOT append-only). Solo firms ignore this table and write `decisions` directly, so the
-- existing flow is untouched.
create table if not exists member_decisions (
  game_id    uuid not null references games (id) on delete cascade,
  round      int  not null,
  team_id    uuid not null references teams (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  desk       text,                          -- which desk this seat owns (denormalized from role)
  partial    jsonb not null default '{}',   -- this seat's slice of the FirmDecision
  submitted  boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (game_id, round, user_id)
);

alter table member_decisions enable row level security;
-- A seat reads its OWN partial + its TEAMMATES' partials (so the UI shows "CFO submitted");
-- instructor reads all. A seat writes ONLY its own, and only while not locked.
create policy member_decisions_select on member_decisions for select
  using (is_instructor() or exists (
    select 1 from team_members tm where tm.team_id = member_decisions.team_id and tm.user_id = auth.uid()
  ));
create policy member_decisions_insert on member_decisions for insert
  with check (user_id = auth.uid() and owns_team(team_id));
create policy member_decisions_update on member_decisions for update
  using (user_id = auth.uid() and owns_team(team_id))
  with check (user_id = auth.uid() and owns_team(team_id));

-- ── DEFERRED to a later migration, once the app layer lands ───────────────────────────
--   • A `player_career` view (user_id → games, firms, final rank/score) with
--     security_invoker so RLS still applies — for the player's cross-game dashboard.
--   • A `cohorts` table if roster management grows beyond the users.cohort tag.
