-- 0008 — the gamemaster can edit the PENDING round's world state (DW-066).
--
-- 0001 made world_states append-only with a BEFORE UPDATE OR DELETE trigger that raises on
-- any UPDATE. Two writers the app has shipped since then are plain UPDATEs and were failing in
-- production with "append-only table world_states, UPDATE not permitted":
--
--   1. The gamemaster (DW-037): plant a disruption / cancel one / arm "fire now". These edit
--      shock_timeline + live_triggers on the CURRENT round's stored state — the exact record the
--      next resolve consumes — so replay stays deterministic (the edit is part of the history).
--   2. The forced re-resolve (DW-046): a resolve that died half-way is re-run, and every append
--      is an upsert on its natural key. ON CONFLICT DO UPDATE fires the UPDATE trigger even when
--      the row is byte-identical, so the recovery path raised on its first write.
--
-- Rule after this migration:
--   * every append-only table: DELETE still raises; an UPDATE that changes nothing except
--     created_at (a deterministic retry) is allowed; any other UPDATE raises as before.
--   * world_states additionally: `state` may change while the row's round has NOT resolved yet
--     (round >= games.current_round). Rows for resolved rounds stay frozen. game_id, round and
--     seed are immutable.
--
-- Mirrored in server/src/adapters/memory.ts::updateWorldState.

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'created_at') = (to_jsonb(old) - 'created_at') then
    return new; -- idempotent re-write (a retried resolve): nothing actually changes
  end if;
  raise exception 'append-only table %, % not permitted', tg_table_name, tg_op;
end;
$$;

create or replace function guard_world_state() returns trigger language plpgsql as $$
declare cur int;
begin
  if tg_op = 'DELETE' then
    raise exception 'append-only table %, % not permitted', tg_table_name, tg_op;
  end if;
  if new.game_id is distinct from old.game_id or new.round is distinct from old.round or new.seed is distinct from old.seed then
    raise exception 'append-only table %, key columns are immutable', tg_table_name;
  end if;
  if new.state = old.state then
    return new; -- idempotent re-write
  end if;
  select current_round into cur from games where id = new.game_id;
  if cur is null or new.round < cur then
    raise exception 'append-only table %, UPDATE not permitted (round % already resolved)', tg_table_name, new.round;
  end if;
  return new; -- gamemaster edit on the pending round
end;
$$;

drop trigger if exists world_states_append_only on world_states;
create trigger world_states_append_only before update or delete on world_states
  for each row execute function guard_world_state();
