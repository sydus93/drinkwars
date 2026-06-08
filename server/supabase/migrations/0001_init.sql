-- Drink Wars — initial schema (application-spec §3, §4; model-spec §15, §18).
-- Postgres + Supabase auth + row-level security. Mirrors the StorageAdapter
-- (server/src/types.ts) so the in-memory and Supabase backends are interchangeable.
--
-- Confidentiality (§3.2): a team reads only its own decisions and private state
-- plus the public info released after each resolution; no team sees another
-- team's pending decisions or another firm's private diagnostics. Raw world
-- snapshots and full results are instructor/service-role only; students see the
-- public projection (public_round) and their own firm_round rows.
--
-- Append-only (§3.3): world_states, round_results, firm_round, beliefs,
-- telemetry, reflections, distinctiveness, public_round reject UPDATE/DELETE, so
-- a resolved round is immutable and the panel is reconstructable.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity & structure
-- ─────────────────────────────────────────────────────────────────────────────

create table users (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'student' check (role in ('student', 'instructor')),
  email       text,
  consent     boolean not null default false,   -- §18 research-use consent
  deid_code   text not null,                     -- de-identification mapping
  created_at  timestamptz not null default now()
);

create table games (
  id             uuid primary key default gen_random_uuid(),
  config         jsonb not null,                 -- model-spec §14
  n_rounds       int not null,
  current_round  int not null default 0,
  lifecycle      text not null default 'open'
                   check (lifecycle in ('open','locked','resolving','published','complete')),
  created_by     uuid references users (id),
  created_at     timestamptz not null default now()
);

create table teams (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references games (id) on delete cascade,
  firm_id   text not null,                        -- engine firm id; v1 one team per firm
  name      text not null,
  status    text not null default 'active',
  unique (game_id, firm_id)
);

create table team_members (
  team_id  uuid not null references teams (id) on delete cascade,
  user_id  uuid not null references users (id) on delete cascade,
  primary key (team_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Round state (append-only history) + decisions (mutable until locked)
-- ─────────────────────────────────────────────────────────────────────────────

create table world_states (
  game_id    uuid not null references games (id) on delete cascade,
  round      int not null,
  state      jsonb not null,                      -- engine WorldState
  seed       bigint not null,
  created_at timestamptz not null default now(),
  primary key (game_id, round)
);

create table decisions (
  game_id         uuid not null references games (id) on delete cascade,
  round           int not null,
  team_id         uuid not null references teams (id) on delete cascade,
  firm_id         text not null,
  decision        jsonb not null,                 -- engine FirmDecision
  submitted       boolean not null default false,
  locked          boolean not null default false,
  revision_count  int not null default 0,
  submitted_at    timestamptz,
  first_opened_at timestamptz,
  primary key (game_id, round, team_id)
);

create table round_results (             -- full per-firm detail; instructor-only
  game_id    uuid not null references games (id) on delete cascade,
  round      int not null,
  result     jsonb not null,                       -- engine RoundResult
  created_at timestamptz not null default now(),
  primary key (game_id, round)
);

create table public_round (              -- student-facing published projection
  game_id    uuid not null references games (id) on delete cascade,
  round      int not null,
  events     jsonb not null default '[]',          -- public events (shocks, exits, antitrust)
  standings  jsonb not null default '[]',          -- firm_id, rank, score, status
  market     jsonb not null default '[]',          -- per-segment D / total_q / active
  created_at timestamptz not null default now(),
  primary key (game_id, round)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Research tables (model-spec §15) — Stata export targets
-- ─────────────────────────────────────────────────────────────────────────────

create table firm_round (                -- §15.1; one row per firm-round
  game_id    uuid not null references games (id) on delete cascade,
  round      int not null,
  firm_id    text not null,
  team_id    uuid references teams (id),
  consent    boolean not null default false,
  deid_code  text not null,
  data       jsonb not null,                       -- full FirmRoundResult; export flattens
  primary key (game_id, round, firm_id)
);

create table agreements (                -- §15.6; partnership-durability survival data
  game_id          uuid not null references games (id) on delete cascade,
  agreement_id     text not null,
  form             text not null,
  template         text not null,
  signatories      text[] not null,
  formation_round  int not null,
  dissolution_round int,
  dissolution_type text,
  primary key (game_id, agreement_id)
);

create table beliefs (                   -- §15.2; calibration / overconfidence
  game_id          uuid not null references games (id) on delete cascade,
  round            int not null,
  team_id          uuid not null references teams (id) on delete cascade,
  pred_own_rank    int,
  pred_market_size double precision,
  pred_rival_move  text,
  real_own_rank    int,
  real_market_size double precision,
  score            double precision,
  primary key (game_id, round, team_id)
);

create table telemetry (                 -- §15.3; decision process
  game_id         uuid not null references games (id) on delete cascade,
  round           int not null,
  team_id         uuid not null references teams (id) on delete cascade,
  revision_count  int not null default 0,
  info_purchased  boolean not null default false,
  submitted       boolean not null default false,
  submitted_at    timestamptz,
  time_to_decide_s double precision,
  primary key (game_id, round, team_id)
);

create table reflections (               -- §15.5; qualitative corpus
  game_id  uuid not null references games (id) on delete cascade,
  round    int not null,
  team_id  uuid not null references teams (id) on delete cascade,
  text     text not null,
  primary key (game_id, round, team_id)
);

create table distinctiveness (           -- §15.4
  game_id          uuid not null references games (id) on delete cascade,
  round            int not null,
  firm_id          text not null,
  mahalanobis      double precision not null,
  nearest_neighbor double precision not null,
  primary key (game_id, round, firm_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only enforcement (§3.3)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table %, % not permitted', tg_table_name, tg_op;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['world_states','round_results','public_round','firm_round','beliefs','telemetry','reflections','distinctiveness']
  loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function forbid_mutation();', t, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function is_instructor() returns boolean language sql stable as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.role = 'instructor');
$$;

create or replace function is_game_member(g uuid) returns boolean language sql stable as $$
  select is_instructor() or exists (
    select 1 from team_members tm join teams t on t.id = tm.team_id
    where t.game_id = g and tm.user_id = auth.uid()
  );
$$;

create or replace function owns_team(t uuid) returns boolean language sql stable as $$
  select exists (select 1 from team_members tm where tm.team_id = t and tm.user_id = auth.uid());
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────────────

alter table users           enable row level security;
alter table games           enable row level security;
alter table teams           enable row level security;
alter table team_members    enable row level security;
alter table world_states    enable row level security;
alter table decisions       enable row level security;
alter table round_results   enable row level security;
alter table public_round    enable row level security;
alter table firm_round      enable row level security;
alter table agreements      enable row level security;
alter table beliefs         enable row level security;
alter table telemetry       enable row level security;
alter table reflections     enable row level security;
alter table distinctiveness enable row level security;

-- users: see self; instructor sees all.
create policy users_self on users for select using (id = auth.uid() or is_instructor());

-- games / teams / team_members: visible to game members; instructor manages.
create policy games_read on games for select using (is_game_member(id));
create policy games_write on games for all using (is_instructor()) with check (is_instructor());
create policy teams_read on teams for select using (is_game_member(game_id));
create policy teams_write on teams for all using (is_instructor()) with check (is_instructor());
create policy members_read on team_members for select using (is_instructor() or owns_team(team_id));

-- decisions: a team reads/writes ONLY its own, and only while not locked;
-- instructor reads all. No team can ever see another team's pending decision.
create policy decisions_select on decisions for select
  using (is_instructor() or owns_team(team_id));
create policy decisions_insert on decisions for insert
  with check (owns_team(team_id) and not locked);
create policy decisions_update on decisions for update
  using (owns_team(team_id) and not locked)
  with check (owns_team(team_id) and not locked);

-- Raw world snapshots & full results: instructor / service-role only.
create policy world_states_read on world_states for select using (is_instructor());
create policy round_results_read on round_results for select using (is_instructor());

-- Public projection: any game member may read.
create policy public_round_read on public_round for select using (is_game_member(game_id));

-- firm_round: a team sees ONLY its own firm's diagnostics (§6.4); instructor all.
create policy firm_round_read on firm_round for select
  using (is_instructor() or owns_team(team_id));

-- Other research tables: own team's rows; instructor all.
create policy agreements_read on agreements for select using (is_game_member(game_id));
create policy beliefs_read on beliefs for select using (is_instructor() or owns_team(team_id));
create policy telemetry_read on telemetry for select using (is_instructor() or owns_team(team_id));
create policy reflections_read on reflections for select using (is_instructor() or owns_team(team_id));
create policy distinctiveness_read on distinctiveness for select using (is_game_member(game_id));

-- NOTE: round resolution runs server-side with the service role (which bypasses
-- RLS), writing world_states/round_results/firm_round/public_round/etc. Students
-- never write these; they only INSERT/UPDATE their own decisions (above).
