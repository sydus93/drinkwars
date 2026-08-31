-- DW-048: an instructor-announced submission deadline for the CURRENT round. Display-only
-- (students see a countdown; the instructor still locks by hand); cleared on advance.
-- Code tolerates the column being absent (reads null) — but set-deadline fails until this runs.
alter table games add column if not exists deadline_at timestamptz;
