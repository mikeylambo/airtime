# The boards, on a server

The game ships with `LocalBoard` and needs no server at all. This directory is
what it takes to point the seven boards at Supabase instead.

## Provisioning

1. Create (or pick) a project.
2. Run `0001_boards.sql` against it — SQL editor, `supabase db push`, or the
   MCP `apply_migration` tool.
3. Put the project URL and its publishable (anon) key in `.env.local`:

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

`src/main.js` calls `boardFromEnv()` at boot and switches the adapter if both
are set. Nothing else in the game changes: not the boards, not the
qualification rules, not the result screen, not the daily. That is the whole
reason `submit` and `top` are the only two functions an adapter has.

## What this is honest about

Without accounts, `driver` is a uuid the client mints and keeps in
localStorage. It is enough to make "one row per driver per board" true, and it
stops one player overwriting another's row. It does **not** stop somebody
posting a score they did not earn — the insert policy has to accept a number
from an anonymous client, and no amount of policy writing changes that.

The fix is already built and is not a policy at all: **a score is a replay.**
A clip is inputs and a seed, `probe:replay` measures re-simulation at 0.0 m
bit-exact, and R9 bakes ghosts out of exactly that. So the verified version of
this table stores the clip alongside the score and an edge function
re-simulates it before the row becomes visible. That is a server-side physics
build, which is a real project rather than a config change — hence the
unverified table now, and the note here rather than a claim in the roadmap.
