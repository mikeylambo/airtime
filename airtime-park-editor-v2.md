# AIRTIME v2 — Park Editor (one-pager)

**Frame reference:** THPS Create-A-Park / Halo Forge / Trackmania sharing. Not
Fortnite — no building during play (it breaks camera choreography and
authored-space scoring). Build and run are separate phases.

**Sequencing:** enters after the premium pass and Gate D. Exception: the
arena-piece refactor (below) should happen *now*, during current work, because
it's nearly free while arenas are being redressed and it makes v2 a feature
instead of a rewrite.

## Why it exists

The editor is the ecology engine. Arenas-as-content is the biggest cost
center; arenas-as-UGC is the retention engine (Trackmania, 20 years). Park
codes travel with clips ("run my line"), daily lines become community lines,
and the leaderboard population problem solves itself at any scale above tiny.

## Do-now refactor (goes into the current build cycle)

Arenas already live as data. Formalize it: every arena is a **piece list** —
`{piece, position, rotation, params}` — over a lot mesh — and both shipped
arenas are rebuilt as piece lists. The editor then edits the same format the
game already loads. Cost now: small. Cost later if skipped: total.

## The editor (v2 build)

- **Lot:** one flat/bowled base per theme (park-void, city-night), fixed bounds.
- **Palette v1 (~12 pieces):** kicker ramp (3 grades), quarterpipe, gap block,
  rooftop slab, billboard target, pool target, rail/edge strip, coin line tool,
  traffic lane spline, mover (train | helicopter | sliding billboard), spawn
  pad, decor light.
- **Placement:** controller-first cursor, grid snap + free nudge, rotate/scale
  within per-piece limits, undo stack. No terrain sculpting v1.
- **Piece budget** per park (perf guardrail, from `probe:perf` numbers).
- **Test loop:** one button flips build→drive at the cursor; the §2.1
  "airborne in ≤3 inputs" rule applies inside the editor.

## Validation (automatic, on save)

Headless sim (existing node-side sim makes this cheap): spawn reachable, ≥1
ramp produces ≥1.5s air for the mid archetype, all targets landable, piece
budget respected, out-of-bounds floor kills. Invalid parks save as drafts,
can't be shared.

## Sharing

A park serializes to compact JSON → **park code** (short string, shareable
anywhere) + Supabase row (code, name, author, piece list, version stamp).
Clips exported from a community park carry the park code on the title card.
Browse screen: newest / most-run / most-clipped; report button (see release
spec §M for UGC moderation).

## Build-then-run (party mode, ships with editor)

Ultimate Chicken Horse structure: each round, every player places ONE piece
(simultaneous, 20s timer), then everyone runs the evolving park. 5 rounds,
cumulative score. The arena gets progressively stupider because the room made
it that way — the drunk game, perfected.

## Gates

- **Editor gate:** a first-time player builds a park that produces a >1.5s
  jump within 5 minutes, no tutorial.
- **Ecology gate:** a stranger's park produces a clip you'd export.
- **Party gate:** build-then-run makes the room yell at the *placement* phase,
  not just the runs.

## Names note

If the editor thrives, this is the moment AIRTIME outgrows "Rush finished" and
the marquee name question reopens — revisit title + IP check at v2 launch, not
before.
