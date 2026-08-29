# AIRTIME — Release Systems (partial reconstruction)

> **Status note.** The full release-systems spec was drafted in the design
> conversation but the document itself was never delivered to the repo — only
> the AFTERGLOW art brief and the Park Editor one-pager arrived. The two
> sections below are reconstructed from that conversation, which named §R and
> §V explicitly and called §R "silent killers, go first". The other section
> letters the briefs reference (§A accessibility, §L font licensing, §M UGC
> moderation) are known to exist but their text is not; re-issue the full doc
> when available and replace this file.

## §R — Replay versioning (implemented in the current build cycle)

Every clip, ghost, leaderboard entry, and future park **re-simulates inputs**;
one physics tweak orphans all of them unless everything carries a simVersion
stamp.

The stamp has two parts, both stored on every persisted record:

- `schema` — the storage format version, bumped by hand when the record shape
  changes.
- `sim` — the simulation identity: a hash of every physics-affecting TUNING
  section plus a hand-bumped physics-code counter. Any tuning or physics-code
  change that would make an old input stream produce a different flight
  changes the stamp *automatically*, so nothing depends on a human remembering
  that a suspension tweak breaks replays.

Handling rules:

- **Clips** — stamped at save. A clip whose `sim` no longer matches still
  *plays* (a diverged re-simulation is harmless and occasionally funny) but is
  labelled OLD PHYSICS in the replay list and excluded from the garage wall
  and the highlight reel, both of which claim to show real landings.
- **Leaderboard entries** — stamped at submit. `top()` filters to the current
  stamp: a score set under different physics is not comparable and must not
  sit above one set under the current build.
- **Ghosts / parks (future)** — carry the same stamp; the loader refuses a
  mismatched ghost (a ghost that diverges is a lie about what the rival did)
  and re-validates a mismatched park before it can be shared.

**Clip-prefix snapshot fix**, same section: a clip is a window into the
round's input streams and re-simulates from step zero, which is correct — but
the clip must *snapshot* everything it depends on at save time (its own copy
of meta, setup, stamps), never share live references with the recorder; and
playback must not rebuild the physics world more than once per entry, nor per
seek. Scrubbing re-simulates the prefix in place; only entering the theater
builds a world.

## §V — Validated leaderboards (with the server, not before)

Submit input streams, not scores: the server re-simulates the run with the
deterministic node-side sim and publishes the score *it* computed. The
existing headless sim makes real anti-cheat nearly free. Requires §R stamps so
the server knows which sim to run. Lands with the Supabase board adapter.

## Referenced but not reconstructed

- **§A** — accessibility guardrails (Reduce Effects, photosensitivity limits,
  colorblind palette). The binding rules are quoted in the AFTERGLOW brief.
- **§L** — font/display-face licensing for the UI pass.
- **§M** — UGC moderation for shared parks (report button, takedown path).
