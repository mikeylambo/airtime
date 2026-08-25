# AIRTIME — Rush Reframe

**Frame:** San Francisco Rush 2049 *Stunt Mode*, given 25 years of iteration and
a premium budget. Not "a game about cars that fly."

Rush Stunt Mode was a **vehicular trick-combo sandbox**: find a line, build
speed, launch, improvise a physical stunt, layer stunt properties, recover, land,
watch the score explode, immediately spot the next line. Everything below serves
that sentence.

## How we are treating the reference

We are treating Rush 2049 Stunt Mode **as if it were the base game we are
modding** — except we build every underlying system ourselves rather than
touching Rush's code or assets.

Practically that means:

- **Systems, rules and feel are the brief.** Trick taxonomies, simultaneous-icon
  scoring, wing purity bonuses, cumulative-score unlocks, the shape of a run —
  these are game mechanics, and reimplementing them from scratch is exactly what
  we are doing.
- **Nothing of theirs ships.** No code, no assets, no art, no audio, no car
  models, no names, no logos, no UI lifted frame-for-frame.
- **Arena layouts are the one place the line actually bites.** Recreating Rush
  Stunt 1's geometry object-for-object would be both the riskiest thing on this
  list and the least interesting. We take its *design principles* — compact
  interconnected network, a central vertical feature, perimeter banking that
  returns you to the middle, elevation you can transfer between — and author our
  own park against them. R3's gate is a reachability graph, not a resemblance.
- **Our originality is what we build above the frame.** State-based replay,
  physically simulated bodywork, the cinematic director, per-axis air control.
  None of that existed in 1999.

## Systems inventory

What "modding the base game" means concretely: the reference's stunt systems,
and where each one stands here.

| Reference system | AIRTIME | Where |
|---|---|---|
| Stunt arena as skatepark-for-cars | 2 arenas, both the wrong *shape* — scatters, not networks | R3 |
| Deployable wings for air control | Five hinged aero bodies. Better substrate, worse interface | R2 |
| Flips / rolls / spins | Integrated from real angular velocity, named afterwards | **have** |
| Twist (multi-axis simultaneous) | Not distinguished — the data is there, the facet is not | R1 |
| Wheelie / endo / two-wheel | Missing. Per-wheel contact exists; only the count is used | R1 |
| Simultaneous-stunt icon display | Missing entirely | R1 |
| Multiplier escalation by icon count | **Missing — this is the big one** | R1 |
| Wing-purity bonuses (sparing / none) | Missing, but `burstsThisJump` + pose seconds already tracked | R1 |
| Land it or lose it | Have, and more sophisticated: bounce merge, settle window, four grades | **have** |
| Coins | Have | — |
| Speed pads | Missing | R3 |
| Cumulative stunt score unlocks arenas | Missing; medal-based unlocks exist instead | R7 |
| Obstacle Course as mastery exam | Missing → **The Gauntlet** | R7 |
| Timed run | Have | — |
| Split-screen | Have, with per-viewport camera restraint | — |
| *(no equivalent)* | State-based replay theater | **ours** |
| *(no equivalent)* | Physically simulated bodywork | **ours** |
| *(no equivalent)* | Cinematic camera director | **ours** |
| *(no equivalent)* | Garage setups that change the rigid body | **ours** |

Read down the R1 column: **the reframe is mostly one missing system.** Rush's
scoring rewarded doing several different things at once, violently. Ours rewards
doing one thing well. That single gap is most of the distance between the two.

---

## What Build 1 got right, and keeps

- **Rotation is physics, named afterwards.** The trick tracker integrates the
  car's own angular velocity; nothing is triggered by a button. This is the
  single best idea in the build and the whole facet system rests on it.
- **Landing is a real event** — touchdown, bounce merge, settle window,
  perfect/clean/sloppy/crash, surface identification.
- **Aerodynamics is real.** Five hinged rigid bodies, flat-plate drag applied at
  each part's own position. `npm run probe:aero` measures what each one does and
  checks it against the design, rather than asserting it.
- **Replay is state, not video.** A clip is inputs + seed, so the theater
  re-simulates and can re-shoot from any camera. This is native content
  creation for a game about doing ridiculous things. It stays.
- **The camera director.** Predicted hang time, behaviour selection by launch
  context, never-cut crossfades.

## What Build 1 got wrong

The metagame abstracted away from the fantasy. The loop became *drive → boost →
launch → deploy panels → land on a valuable target*. It should be *find line →
build speed → launch → improvise → layer → recover → land → explosion → next
line*. Similar on paper; very different in the hands.

---

## Three corrections that change the build

### 1. Do not demote the aero panels. Collapse the *interface*.

The panels are the asset. The problem is that the player currently has **eight
air verbs**: left door, right door, hood, tail flap, wing, and three thrust
modes chosen by stick direction. Nobody holds eight verbs in their head at
60 m/s while inverted.

Rush had roughly two: *wings*, and *tilt*.

So: keep every panel, keep the emergent aero, and put an **air-control layer**
on top that drives them.

| Player does | What the panels actually do |
|---|---|
| Stick left/right | asymmetric door deployment → roll |
| Stick forward/back | hood / tail flap → pitch |
| Shoulder (hold) | both doors + wing → air brake, kills rotation |
| A (tap) | thrust burst, mode from stick as now |

The panels stay visible and physical — the door still swings, the flap still
drops, the car still looks like nothing else. The player just stops
*addressing* them individually. A manual binding stays available for anyone who
wants it, but it is not the default and not the tutorial.

**This is an input-mapping change, not a physics change.** The measured §5.1
behaviour is unaffected.

### 2. Purity is nearly free. Ground stunts are not.

`thrust.burstsThisJump` and per-panel `pose[slot]` seconds are already tracked
per flight, so **RAW / TOUCHED / FLOWN** can ship in the same pass as the facet
scorer. That is a days-not-weeks feature and it is the best idea in the
reframe: the assist becomes a risk/reward resource, and there is a real ladder
from *wings wings wings* to *no wings*.

Ground stunts are a different story:

- **Wheelie / endo / two-wheel** — cheap. `vehicle.wheelIsInContact(i)` already
  exists per wheel; the sim only aggregates a count today. Front-pair /
  rear-pair / side-pair classification is a small addition.
- **Wall-ride, transfers, grinds** — not cheap. These need new contact
  classification against surface normals, plus authored surfaces to ride. This
  is R3 work, not R1.

### 3. The centre-of-pressure problem is the hidden blocker

Build 1 established, by sweep, that **aerodynamic stability and trick authority
are the same dial**. With the centre of pressure well behind the centre of mass
the car lands every hands-off jump and *cannot be rotated by any panel input*.
Bring it forward and tricks become possible and the car gets twitchy.

"No wings" as an expert path requires a car that is **rotatable and recoverable
without assistance**. At the current single-dial tuning it is barely both.

The likely fix is to stop treating stability as one number: weathercock the car
in **yaw** (so it flies nose-first and lands predictably) while leaving **pitch
and roll** comparatively free (so flips and rolls are cheap to start and cheap
to stop). That is a real aerodynamics change — per-axis centre of pressure and
per-axis angular damping — not a slider tweak.

**This is the main technical risk in the reframe.** If it does not resolve,
the purity ladder collapses into "everyone uses wings" and R2 fails.

---

## Sequencing correction: audio is diagnostic, not decoration

The reframe puts presentation at phase 5. Audio cannot wait that long — **you
cannot tune air feel deaf.** Engine load tells you where you are in the rev
range without looking; the cut from road noise to wind is how a launch reads;
the landing hit is how you know a stick was clean.

So: a **minimum audible pass** (engine load, tyre scrub, the road-noise→wind
cut at launch, landing weight, crash) sits alongside R2, not after R5. Four or
five sounds. The full pass — crowd, PA, chassis groans, escalating combo sting,
score cashout — stays where the reframe put it.

---

## A tool the arena rebuild needs: the line analyzer

"20–30 mundane objects whose interactions create hundreds of lines" is the right
target and the hardest thing here to verify by eye. The current park has 20
ramps but is a **scatter with one hero line**, not a network.

So before authoring: build a **line analyzer**. Ballistically integrate from
every launch surface across a spread of entry speeds and angles, raycast the
arcs against the world, and emit the reachability graph.

That turns "is this park an instrument?" into numbers:

- how many surfaces are reachable from each launch point
- how many surfaces are reachable *from three or more* others (the ones that
  make routing possible)
- orphans — objects nothing can reach or leave
- the longest chain of surfaces linkable without touching the deck

The predictor for this already exists (`predictArc` in `src/sim/airtime.js`,
drag-corrected and accurate to a metre on the hero jump). This is a day of work
and it makes R3 tractable instead of guesswork.

---

## The roadmap

| Phase | Objective | Touches | Gate |
|---|---|---|---|
| **R1 — Stunt grammar** | One jump becomes endlessly expressive | `tricks.js`, new `facets.js`, `score` tuning, HUD ticker, result | A jump with 6+ facets scores an order of magnitude above a clean single flip, and the player can see why |
| **R2 — Air control** | Rush-like airborne mastery | per-axis aero (the COP fix), new air-control layer over `panels.js`, `input.js` | A newcomer can recover most jumps; an expert can land a triple with one 0.2 s touch. Minimum audible pass ships here |
| **R3 — Stunt Park 2.0** | The equivalent of Rush Stunt 1 | line analyzer, then a rebuilt `stunt-park.js` | Analyzer says: no orphans, ≥15 surfaces reachable from 3+ others, a 5-surface chain exists without touching the deck |
| **R4 — Flow** | Eliminate downtime | respawn, restart, run timer, result pacing | Timer expires → back in the air in under 3 seconds, one input |
| **R5 — Premium feel** | One car, one arena, expensive | full audio, speed VFX, crash cam, score cashout presentation | Judged on footage |
| **R6 — Content grammar** | Prove arena variety | 3 more parks, each a different instrument | Each teaches a different routing idea |
| **R7 — Mastery** | Give hundreds of runs purpose | challenges, medals, ghosts, boards, **The Gauntlet** | — |
| **R8 — Party / creator** | Exploit what already exists | split-screen, Call Your Shot, replays, dailies | — |

**Build 2 = R1 + R2 + R3 + R4**, plus the minimum audible pass. Nothing else.

### Build 2's acceptance test

> Give somebody one car, one arena, five minutes and no progression. Do they
> immediately hit restart when the timer expires?

**This cannot be self-assessed.** The build can instrument it — time-to-restart,
session length, landing rate per session, facet counts per jump, how often the
purity ladder is climbed — and those numbers will say whether people are
*improving*. Whether they *want another go* is a human verdict on a human in a
chair.

---

## Shelved, deliberately

Kept in the codebase, taken off the table until Build 2 lands.

- **The city block arena.** A procedural grid of towers is the *opposite* of an
  instrument. When it comes back it should be rebuilt as one, not iterated.
- **Moving targets** (train, helicopter, rotating billboard). They serve "land
  on absurd things", which is being demoted.
- **Four of five modes.** Call Your Shot, Last Car Standing, Hot Potato and
  Party stay in `modes.js` and come out of mode select. Stunt becomes the game.
- **The nine licence tests.** They are written against the current trick
  taxonomy and would need rewriting after R1 regardless. Freeze, then redo as
  R7's challenges.
- **Traffic as the universal boost economy.** Stays in city arenas; stops
  defining the loop. Boost should come from *driving well* — speed held, drift,
  near-misses where there is traffic to miss.
- **Coins.** Currently flat score on authored lines. Re-evaluate after R1: if
  facets carry the scoring weight, coins become a routing hint rather than a
  payout.

### One ordering hazard

Landing tiers and coins are currently load-bearing for the score. **R1 must land
before targets are demoted**, or scores collapse and the game reads as broken in
between.
