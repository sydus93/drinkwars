-- DW-051: the founder's house colour + mark are the FIRM's, not this browser's —
-- teammates and rivals read them on the board too.
alter table teams add column if not exists color text, add column if not exists emblem text;
