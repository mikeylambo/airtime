-- AIRTIME — the seven boards, as one table (R9).
--
-- Seven boards are one table with a `board` column, because they are seven
-- *views of the same run*: a stock VECTOR run on today's seed with every
-- landing RAW is filed on five of them at once, and duplicating the row is
-- cheaper and far simpler than seven tables that have to agree with each
-- other. The client decides which boards a run qualifies for
-- (src/game/boards.js); this table only has to store and sort.

create table if not exists public.airtime_scores (
  id          bigint generated always as identity primary key,
  board       text        not null,
  key         text        not null,
  driver      uuid        not null,
  name        text        not null,
  car         text        not null,
  arena       text        not null,
  mode        text        not null,
  day         date,
  -- What this board ranks by. Six boards rank the run's score; BEST STUNT
  -- ranks one landing, which is why the ranked value is its own column
  -- rather than being assumed to be `score`.
  value       bigint      not null check (value >= 0),
  score       bigint      not null check (score >= 0),
  medal       text,
  stock       boolean     not null default false,
  raw         boolean     not null default false,
  best_stunt  bigint      not null default 0,
  -- §R: the physics stamp travels with the row. A score set under a
  -- different build is stored but never shown, because it is not comparable
  -- to a run made today, and the client filters on this server-side.
  sim         text        not null,
  schema      int         not null default 1,
  created_at  timestamptz not null default now()
);

-- One row per driver per board. A player beating their own score replaces
-- it rather than filling the top ten with themselves.
create unique index if not exists airtime_scores_one_per_driver
  on public.airtime_scores (board, key, driver);

-- The only query the game makes.
create index if not exists airtime_scores_ranked
  on public.airtime_scores (board, key, sim, value desc);

alter table public.airtime_scores enable row level security;

-- Anybody may read a board.
drop policy if exists airtime_scores_read on public.airtime_scores;
create policy airtime_scores_read
  on public.airtime_scores for select
  to anon, authenticated
  using (true);

-- Anybody may post a score, and may only ever replace their own row. Without
-- accounts `driver` is a client-minted uuid, so this stops one player
-- overwriting another's row; it does not stop a determined person posting a
-- number they did not earn. See supabase/README.md — the fix is that a score
-- carries its replay, and the replay re-simulates.
drop policy if exists airtime_scores_insert on public.airtime_scores;
create policy airtime_scores_insert
  on public.airtime_scores for insert
  to anon, authenticated
  with check (true);

drop policy if exists airtime_scores_update on public.airtime_scores;
create policy airtime_scores_update
  on public.airtime_scores for update
  to anon, authenticated
  using (true)
  with check (true);
