# AIRTIME — Release Systems (partial reconstruction)

> **Status note.** The full release-systems spec was drafted in the design
> conversation but the document itself was never delivered to the repo — only
> the AFTERGLOW art brief and the Park Editor one-pager arrived. The two
> sections below are reconstructed from that conversation, which named §R and
> §V explicitly and called §R "silent killers, go first". The other section
> letters the briefs reference (§A accessibility, §L font licensing, §M UGC
> moderation) are known to exist but their text is not; re-issue the full doc
> when available and replace this file.
>
> §A, §L and §S below are written from **what was built** rather than from the
> original spec, and are marked as such. If the real document turns up they
> should be checked against it — these are what the build does, not
> necessarily what was asked for.

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

## §S — Save export and import (built, not from the spec)

Everything the game knows about a player lives in localStorage, which does not
survive a cleared browser, a private window, a new machine or a domain change,
and goes without warning. One file, out and back.

The export sweeps the `airtime:` prefix rather than enumerating known keys. An
enumeration is wrong the first time somebody adds a key and forgets this file,
and the failure is silent and surfaces as *somebody else's* lost progress. A
system added later is backed up the day it ships.

Imports carry the §R stamps and act on them: progress is portable across a
physics change — a medal is a medal — but ghosts are input streams that
re-simulate, so they are dropped from a stale-sim import and the screen says
so. A save from a *newer* schema is refused outright rather than written over a
working profile. `npm run probe:save` drives the round trip and the refusals.

## §A — Accessibility guardrails (built, not from the spec)

The binding rules are quoted in the AFTERGLOW brief; what they resolved to:

- **Reduce Effects** — one switch in `render/theme.js` that every emissive
  system reads. Caps the sign flash, dims the brake discs, shortens the trails
  and fades the ghost (it dims, never hides: hiding your opponent is not
  reducing effects, it is leaving the mode).
- **Photosensitivity** — the flash cap is a TUNING constant enforced in
  `render/signs.js`, and a notice is shown once before the first round which
  offers the switch on the spot. A warning that names a risk and then makes you
  go and find the setting is a disclaimer, not a guard.
- **Colourblind palette** — one switch, measured under simulated protanopia,
  deuteranopia and tritanopia; shape-coded trails as the second channel.
- **Remapping** — every keyboard verb is named and rebindable by pressing the
  key. Menu keys deliberately are not: a player who rebinds their way out of
  the menus cannot reach the screen that would fix it.

## §L — Font and display-face licensing (satisfied; three OFL faces)

The UI overhaul introduced a real type system — **Anton** (display / wordmark),
**Barlow Semi Condensed** (UI reading) and **Space Mono** (live data). All
three are under the **SIL Open Font License 1.1**, which permits embedding,
commercial use, and self-hosting on a web page without royalty; the only bars
are selling the fonts standalone and shipping a modified font under a reserved
name, and the build does neither.

They are **self-hosted**, not loaded from Google's CDN: the latin woff2 subsets
(164 KB total) live in `public/fonts/` with an `@font-face` sheet, so there is
no third-party request, no flash of fallback, and the game works offline. Keep
the OFL text with the fonts if the build is ever redistributed as source.

(This supersedes the earlier note that the UI used system fonts only. A
trademark search on the name "AIRTIME" is a separate concern, not this section.)

## Referenced but not reconstructed

- **§O** — onboarding / attract mode. The title screen has an attract hook;
  whether the spec asked for more than that is not known.
- **§D** — distribution: the itch page, watermarked exports.
- **§M** — UGC moderation for shared parks (report button, takedown path).
  Not needed until the park editor ships in v2.
