-- 0009 — calls / forecast commitment (DW-074). REQUIRED since DW-077 turned calls on by default:
-- ship it with `npm run deploy` (db:push). Never list 0009 in a `migration repair` — that marks it
-- applied without creating the table. Idempotent (if-not-exists / drop-if-exists), so a re-run is safe.
--
-- One row per seat per round: the 1–3 predictions that seat logged before the round locked
-- (own rank, shopper share, gross margin, a rival's price move — the catalog lives in
-- server/src/forecasts.ts). A channel of its own: nothing in decisions / member_decisions /
-- the merge / resolve reads this table, and the season score never does. Realized values and
-- scores are computed on READ from round_results, so nothing here is written at resolve.
--
-- Mutable until lock, like member_decisions (so NOT in the append-only trigger list of
-- 0001/0008). The server (service role) is the only writer in the shipped app and enforces
-- "open rounds only" + "your own seat only"; the policies below are the same same-firm-eyes
-- rule member_decisions has, for any future direct client read.
--
-- Without it, every game with calls on (the default) loses the call tickets and the calls readout;
-- the dashboard degrades gracefully (DW-080) but the feature is gone.

create table if not exists forecasts (
  game_id    uuid not null references games (id) on delete cascade,
  round      int  not null,
  team_id    uuid not null references teams (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  role       text,                          -- the seat held when the call was made
  calls      jsonb not null default '{}',   -- { item_id: { value, target? } }
  updated_at timestamptz not null default now(),
  primary key (game_id, round, user_id)
);
-- (no separate game_id index: the primary key leads with game_id)

-- Explicit Data API grants: from 2026-10-30 Supabase no longer auto-grants new public tables, and
-- the edge function reaches this table through PostgREST as service_role. authenticated gets only
-- what the policies below cover; anon gets nothing. Grants are idempotent.
grant select, insert, update, delete on forecasts to service_role;
grant select, insert, update on forecasts to authenticated;

alter table forecasts enable row level security;
-- A seat reads its own and its teammates' calls; the instructor reads all. Never a rival's.
drop policy if exists forecasts_select on forecasts;
create policy forecasts_select on forecasts for select
  using (is_instructor() or exists (
    select 1 from team_members tm where tm.team_id = forecasts.team_id and tm.user_id = auth.uid()
  ));
drop policy if exists forecasts_insert on forecasts;
create policy forecasts_insert on forecasts for insert
  with check (user_id = auth.uid() and owns_team(team_id));
drop policy if exists forecasts_update on forecasts;
create policy forecasts_update on forecasts for update
  using (user_id = auth.uid() and owns_team(team_id))
  with check (user_id = auth.uid() and owns_team(team_id));
