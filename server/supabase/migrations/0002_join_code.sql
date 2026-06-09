-- Drink Wars — multiplayer join codes (apply AFTER 0001_init.sql).
--
-- A per-game code a student enters to claim an open team slot. Validated
-- server-side with the service role; never read by the client (the games
-- SELECT policy is restricted to game members, and a joiner is not a member
-- yet, so the code is shared out-of-band by the instructor).
alter table games add column if not exists join_code text unique;
