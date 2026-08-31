# AIRTIME — Drift Feasibility Spike: Findings

Answer to `airtime-drift-spike-brief.md`. Numbers, not prose. Everything below
is reproducible: `npm run probe:drift` (add `--verbose` for per-technique
traces). The probe drives the shipping sim exactly as the game does — a drift
it can measure is a drift the game can score.

**Verdict: HOLD.** Three of the four questions come back cheap. The fourth —
physics — comes back expensive, and per the brief's own decision gate that puts
drift on the v2/v3 shelf next to the park editor, not in the next numbered
phase. This is not a rejection. It is the finding the spike existed to produce,
and `probe:drift` now carries it as a red gate that flips to green the day the
physics can hold a slide.

---

## The four measurements

### 1. Facet system — **generalizes cleanly.**

A drift is structurally identical to the ground stunts that already score:
wheelie / endo / two-wheel are each *sustained ground contact + a threshold + an
exit condition that banks into the next flight* (`tricks.js` `updateGround` →
`pendingGround` → `computeFacets`). A drift is the same shape keyed off slip
angle instead of wheel-contact pattern.

Demonstrated (`probe:drift`, Q1): feeding a flight whose `ground` record carries
1.4 s of drift, scored through the **unmodified** `computeFacets`:

| | facets | base | mult | total |
|---|---|---|---|---|
| without drift facet | 4 | 509 | ×4 | 2 036 |
| with drift facet | 5 | 787 | ×6 | 4 722 |

The drift stacks on the same multiplier curve as every other facet — no
special-casing, no reconciliation at combo boundaries. **Cost: one `ground.drift`
field, one `TUNING.SCORE.FACET` entry, one detector line in `updateGround`.** No
parallel system.

### 2. Determinism — **probeable today.**

The whole gate architecture assumes bit-exact, headlessly-driveable sim. Drift
is no exception: `car.slipAngle` and `car.driftTime` are computed and readable
every fixed step already (`car.js`). Running the identical scripted drift twice
produces a bit-exact final state (position/velocity/rotation to 10 dp).

**Cost: a new `tools/probe-drift.mjs` — hours, no sim change.** It already
exists (this spike is it) and gates like everything else in the repo.

### 3. Physics — **needs a new tyre-friction model. Not cheap.**

This is the blocker. The question was: does any car sustain a *controllable*
slide for > 1 s on the current model, with no new tuning constants? Scripted
three inputs (sustained slide at two steer angles, a left→right transition, a
full donut) across five cars, including DRIFTER (`gripRear 0.14`, the car built
to slide):

Longest unbroken controllable slide (drift-time accrued while still on the
wheels), best technique per car:

| car | best sustained slide | note |
|---|---|---|
| DRIFTER | **0.48 s** (transition) | closest to the bar; still half of it |
| VECTOR | 0.04 s | baseline never really slides |
| ANVIL | 0.03 s | |
| PROTO | 0.00 s | |
| GRIP | 0.04 s | and *spins out* trying |

**No car clears 1 s. Best anywhere is 0.48 s (DRIFTER), and it keeps under half
its entry speed getting there.** The handbrake stab (side friction ×0.16) snaps
the rear out, but the slide then scrubs speed hard — the car keeps ~48–57% of
its entry speed — and the drift ends because speed falls under the 12 m/s
threshold or the slip angle collapses back under the 12.6° (0.22 rad) it takes
to count. What the model produces is a *Scandinavian flick / snap-slide* of
0.3–0.5 s, not a held, balanced drift. This is precisely the "accidental drift,
not a real one" outcome the brief flagged as the expensive case.

The fix is not a constant. A held drift needs the rear tyre to *re-grip at a
stable slip angle* — a slip-curve that finds equilibrium instead of a binary
loose-rear that either bogs or spins. That is a slip-angle-aware tyre model (or,
at minimum, decoupling longitudinal slide-scrub from lateral grip so power can
hold speed through the slide). It is new physics, and it is the one thing here
that costs weeks, not hours.

**Prototype — the path is proven.** `DRIVE.DRIFT_ASSIST` (in `TUNING.js`, off
by default) is that slip-angle-aware layer, prototyped: it holds the rear loose
once a slide is established, caps the yaw so the car cannot spin, and regulates
speed along the slide so it cannot bog — the three things the loose-rear model
gets wrong. Enabled, DRIFTER holds a **fully controllable drift for well over a
second** (`npm run probe:drift`, Q3b — 1.7 s+ in the park, 5 s+ on open ground,
tilt ~1°), where the shipping model gives 0.48 s and a spin. So the expensive
dimension is no longer a question mark: the direction works. What remains is
genuinely feel-and-roster work — tuning the assist so every drift-capable car
carries it, giving it the right hand feel, deciding how it interacts with the
handbrake and boost — and only then flipping the flag on. Until it ships on by
default, `probe:drift` stays red on physics (it grades the shipping config), and
the scoring/chain machinery stays dormant behind the same threshold.

### 4. Chain — **existing bank logic extends; one small wrapper.**

`drift → jump → landing` rides the path that already exists: ground stunts bank
into the *next* flight (`pendingGround`), the combo chains through landings
(`round.js addLanding`), so a drift's value banks into the jump exactly like a
wheelie does today. No new intermediate state, no threat to the airtime-only
assumption.

The one gap: a **pure ground line** — a drift with no jump after it — never
resolves, because `snapshot()` only fires on touchdown ("land it or lose it"
literally means a drift that doesn't feed a jump scores nothing). Scoring a
standalone drift LINE needs a small ground-only resolve path that closes on
drift-exit rather than on landing. That's a bounded wrapper, not a rewrite.

---

## Decision gate (from the brief)

| dimension | result | cost |
|---|---|---|
| Facets | generalizes cleanly | cheap |
| Determinism | probeable today, new probe = hours | cheap |
| Chain | bank logic extends; pure-ground LINE = small wrapper | cheap |
| **Physics** | **snap-slide only; needs a tyre model** | **expensive** |

**Any come back expensive → drift is a v2/v3 candidate, not a near-term build
item.** The scoring, determinism and chaining are all ready and waiting; they
are blocked on nothing but the tyre model. When a slip-curve model lands and a
car can hold a > 1 s controllable slide, `probe:drift` goes green on its own, and
drift becomes R13 — spec'd properly with its own pillar doc, gate, and content
plan, on top of machinery this spike has already shown to be cheap.

## What this spike explicitly did not do

No drift VFX, no drift naming, no district design, no scoring UI, no tuning of
the tyre model itself. This was an engineering answer to one question, and the
answer is: everything about drift is cheap except the one thing that makes it a
drift.
