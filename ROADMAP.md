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

## The release shape

Locked 2026-08-24. The governing insight, in the user's words:

> We do not need a massive amount of content to make this feel like a premium
> game. We need an unreasonable amount of depth, feedback, and polish packed
> into a modest amount of content.

So content count is **capped**, not aspired to. Anything that adds breadth at
the expense of depth is a regression.

| | Target | Why this number |
|---|---|---|
| Arenas | **6** | Six players memorise like skateparks beats twenty they forget. 30 hours in one arena should still surface new approaches. |
| Vehicles | **8–12** | Enough that each is a distinct instrument; few enough that each can be tuned by hand and gated by the instrument test. |
| Modes | **7** | Lenses on one game, not seven games. |
| Challenges | **100–150** | The mastery ladder. Structure without narrative. |
| Online live MP | **not in V1** | Ghosts and async boards buy most of the competitive value for a fraction of the engineering. |

### The pitch

> AIRTIME is the definitive standalone vehicular stunt sandbox: part score
> attack, part physics toy, part competitive mastery game, built around
> launching cars into absurd aerial lines and somehow bringing them back down
> clean.

### The arena roster

Each is an *instrument*, not a biome — it has to teach a different routing idea
or it does not ship.

| Arena | Identity | State |
|---|---|---|
| **The Yard** | The pure stunt park. Bowls, towers, banks, transfer lines, verticality. | **built** (R3) |
| **Vertical City** | Rooftops, parking structures, glass towers, traffic, billboards, skybridges. | **built** (R8) — four altitude strata, the Coil, the Stack |
| **Mega Works** | Industrial cranes, pipes, containers, moving machinery, giant drops. | **built** (R10) — routes in *time*; the best surfaces move |
| **Floodway** | Concrete canals, huge banks, drainage tubes, spillways, long-speed lines. | **built** (R10) — the only arena with a *direction* |
| **Skyline** | Massive elevation, suspended structures, wind exposure, terrifying gaps. | **built** (R10) — no ground; a miss is a demotion |
| **The Gauntlet** | Endgame mastery course combining everything. Unlocked, not offered. | **a mode** (R9) — twelve chained trials at 90 challenges; becomes an arena in R10 |

Traffic settles here: it is an **ingredient of Vertical City**, not a universal
boost economy. That resolves the tension left open in Build 2.

### The vehicle roster

Eight instruments. Vector, Dart, Anvil, Needle, Stub, Drifter, Grip, Prototype.

**They are exotics**, and the fantasy is the contradiction: precision objects
being used completely incorrectly. Not luxury as such — *exotic performance
machines*, expensive enough that launching one 150 feet into the air feels
slightly irresponsible. Original marques, no licences: the wedge design
language is fifty years old and shared across a dozen manufacturers, and that
is what we use; no specific car's proportions or lamp signature is reproduced,
which is the same clean-room discipline as everything else here.

The tonal rule, verbatim: **the cars take themselves extremely seriously, the
game absolutely does not.**

And the panels are an **aero system**, not bodywork. R2 collapsed eight panel
verbs into one stick and the panels became actuators rather than controls —
active aero is what that already was, finally saying so. Splitter, diffuser,
wing, and side surfaces; "L·DOOR" read like a bug report.

**The law:** *no car is Level 8 and therefore better than Level 2.* A car is a
different way to play, never a stronger one. Cars are therefore **never gated
behind medals** — unlocking one is unlocking a technique, not a tier. "The best
Anvil player" has to be a real thing somebody can be.

This is mechanically testable and now is: `npm run probe:cars` measures every
car on seven axes and fails the build if any car is Pareto-dominated (worse than
some other car at everything) or if any car is best at nothing.

### The mode roster

Stunt Run (default), Free Ride, Call Your Shot, Best Trick, Combo Run,
Survival, Party Stunts, plus daily/weekly challenges. **Call Your Shot** —
declare the facet criteria before you jump — is new, and it is nearly free: it
is the facet system read backwards.

### Progression is a licence ladder, not a story

Bronze/Silver/Gold/Platinum score thresholds per arena, plus challenge sets
("land a 1080", "three facets in one jump", "20,000 without using wings",
"beat the Vector ghost", "discover every named gap"). Rewards are cars,
liveries, arena variants, tuning parts, advanced trials — and eventually
**The Gauntlet**.

### The shape is a readout of the physics

Car bodies are generated (`src/render/wedge.js`), never authored. Every
proportion comes from numbers the simulation already holds — chassis
half-extents, wheelbase, track — so the silhouettes come out true: NEEDLE is a
long arrow because it is one, and PROTOTYPE is narrow because narrowness is
literally why it rolls. A player can read a car's behaviour off its stance
before driving it, and eight cars cost one generator plus eight parameter sets
we already had rather than eight modelling jobs.

The visual hull deliberately does **not** match the collider: it overhangs at
both ends and hangs far below, because the car rests on its wheels and a body
drawn to the collider floats half a metre off the road on stilts. The aero
surfaces are likewise drawn smaller than the areas the physics uses — those
areas are gated by `probe:aero` and cannot move, but at full size they draw as
scaffolding over a low body.

### Named gaps

Every arena has named, discoverable gaps and transfers. The line analyzer
already computes the reachability graph, so the notable edges can be
**derived and then named** rather than hand-authored and hoped for. This is the
single cheapest depth-per-byte system in the plan.

### The competitive layer

Not one scoreboard — seven: arena overall, vehicle-specific, stock setup, best
single stunt, RAW/no-wing, daily seed, friends. Plus **ghosts**, which our
replay architecture already gives us nearly free: replays are inputs + seed,
re-simulated, so a ghost is a replay we do not draw the HUD for. Loading a
2.1M ghost and discovering they use a ramp completely differently is how a
community invents technique.

### Two things the vision sharpened

- **RETRY is the most important UI element in the game.** R4 made it 1.20 s.
  That is now a permanent budget, not an achievement — every screen we add has
  to keep one input between "that run ended" and "I am driving".
- **Audio is half the premium illusion**, and specifically the *handoff*:
  engine + road rumble → wind and mechanical stress at the ramp lip → KRRR-THOOM
  on landing, with the music ducking underneath a big stick. Build 2 shipped the
  minimum; R7 owes the handoff, the duck, the crowd and the chassis stress.

### The acceptance clip

The vision ends with a ten-second shot: off a skyscraper, triple corkscrew,
near-miss on a helicopter, one wing for a split second, lands sideways on a
parking garage, suspension nearly collapses, PERFECT STICK, RAW ×2.5, 87,460,
straight back out toward another ramp. **Treat that as a test.** When we can
capture exactly that, unedited, in one take, the game is real.

---

## The roadmap

| Phase | Objective | Touches | Gate | Status |
|---|---|---|---|---|
| **R1 — Stunt grammar** | One jump becomes endlessly expressive | `tricks.js`, `facets.js`, score tuning, HUD, result | A jump with 6+ facets scores an order of magnitude above a clean single flip | **done** — 2 facets ×1.5 → 11 facets ×42 |
| **R2 — Air control** | Rush-like airborne mastery | per-axis aero (the CoP fix), air-control layer, `input.js` | A newcomer recovers most jumps; an expert lands a triple with one 0.2 s touch | **done** — per-axis CoP; eight air verbs collapsed to one stick |
| **R3 — Stunt Park 2.0** | The Yard | line analyzer, rebuilt `stunt-park.js` | No orphans, ≥15 surfaces reachable from 3+, a 5-surface chain off the deck | **done** — 21/21, 16 from 3+, chain of 9 |
| **R4 — Flow** | Eliminate downtime | respawn, restart, timer, result pacing | Timer expires → back in the air in under 3 s, one input | **done** — 1.20 s |
| **R5 — Instruments** | Cars are techniques, not tiers | `cars.js` → 8 vehicles, per-car geometry/inertia/CoP/damping, ungate the roster | No car Pareto-dominated; every car best at something; every car changes measured behaviour | **done** — 8 cars, 7 axes, 0 dominated |
| **R6 — Named gaps** | The cheapest depth in the plan | analyzer → `gaps.js`, discovery tracking, HUD callout, profile | Every arena ships named gaps derived from its own reachability graph | **done** — 12 named in The Yard, discovery tracked |
| **RC — The wedge** | The car stops being a box | `render/wedge.js`, `car-view.js`, aero naming | Silhouettes differ per car and are derived, not authored | **done** — one generator, eight parameter sets, no per-car art |
| **R7 — Premium feel** | The other half of the illusion | audio handoff + duck + crowd, particles, speed lines, shake | Judged on footage — but the handoff, the duck and the emission rules are measured | **done** — soundscape flips in 133 ms, a 60k stick ducks the bed to 0.22 |
| **R8 — Vertical City** | Second instrument | rebuild the city under R3 range logic, traffic as its ingredient | Passes `npm run lines` as a network | **done** — 34 ramps, 0 orphans, 27 reachable from 3+, 84% of flights hold altitude |
| **R9 — Mastery** | Give hundreds of runs purpose | challenges, medals, ghosts, the seven boards, The Gauntlet | 100–150 challenges; a ghost can be loaded and beaten | **done** — 103 challenges, a ghost reproduces its run to 0.0000 m |
| **R10 — Arenas 4–6** | Finish the roster | Mega Works, Floodway, Skyline | Each teaches a routing idea the others do not | **done** — five arenas, none Pareto-dominated, each the maximum on some axis |
| **R11 — Party / creator** | Exploit what exists | Call Your Shot, HORSE, Survival, replay export, dailies | | **done** — ten modes, HORSE, run codes, the daily set |
| **V2 — Park editor** | The ecology engine | piece palette, build/drive flip, validation, park codes, build-then-run | A first-timer builds a >1.5s jump in 5 minutes, no tutorial | one-pager: `airtime-park-editor-v2.md` |

### The 2026-08-29 pivot — AFTERGLOW and the editor

Locked with the user. Three decisions, two documents:

- **AFTERGLOW replaces the art gate** (`airtime-art-direction.md`). Not a
  fourth style next to the other three — the direction. Dark world, neon
  earned from motion; smear built from geometry (trail ribbons, velocity
  stretch, rotation ghosts), never from screen-space blur, because the target
  machine has no dedicated GPU. Persistent lines stop being a feature idea and
  become the art direction itself. The old graybox-vs-lowpoly footage question
  is closed; graybox survives as the diagnostic look only.
- **The park editor is the v2 pillar** (`airtime-park-editor-v2.md`), after
  the premium pass — except its piece-list refactor, which lands *now* while
  arenas are being redressed: every arena becomes a `{piece, position,
  rotation, params}` list over a lot, so the editor later edits the format the
  game already loads. Build-then-run (Ultimate Chicken Horse structure) ships
  with it as the party mode.
- **§R replay versioning goes first** (`airtime-release-systems.md`). Every
  clip and board entry re-simulates inputs, so everything persisted carries a
  simVersion stamp before any physics-adjacent work makes the first orphan.

### Build 6 — what the pivot shipped

All three decisions landed in one cycle, and the claims are numbers:

- **§R, and the replay truth fix.** `probe:replay` exposed that clips never
  actually reproduced their runs — quantised storage vs raw live inputs plus
  unseeded traffic rerolls measured **428 m** of trajectory drift over 40 s.
  Fixed (the sim steps on what the recorder writes; rounds reroll under a
  recorded seed; playback replays the countdown), playback and scrubbing now
  reproduce a recording to **0.0 m, bit-exact**. A reset-in-place world
  drifts 238 m (Rapier warm-start caches), which is why a rewind rebuilds.
- **Arenas are piece lists**, verified byte-identical to their old records —
  array order feeds solver order, so identity was a determinism claim.
- **AFTERGLOW, handoffs 1–5.** Trails/ghosts/stretch/splash built from
  geometry; trim in player colour across three archetypes (BLADE / BRUTE /
  PHANTOM); THEME-spoken tiers, sparse city windows, the UI recolor. The
  gate's measurable rows: dark-frame rule **92.2%** worst frame on the hero
  jump and **95.8%** in a 4-way split with reactive traffic (`probe:dark`,
  ≥85% required — an early 79% violation was ablated to ribbon mass near the
  lens and fixed with a 14 m lens fade, not by thinning the ribbons); the
  colourblind palette holds simulated min pairwise distance **124/120/133**
  across the three axes with four luminance steps; perf floor on a CPU
  rasteriser **353 fps solo / 224 fps 4-way** at 1080p (`probe:perf
  --headful` on a target machine still owed for the formal 60/45 verdict).

**Judged on footage, still open:** rotation-as-ribbons in a 9:16 crop,
landing tier readable with the HUD hidden, and Reduce Effects reading as the
same game — the re-rendered clips in `public/clips` are the exhibits.

**Build 2 = R1–R4** + minimum audio. **Build 3 = R5 + R6.** **Build 4 = R7.**

### Build 2 — what shipped

`npm run gate` runs the measurable criteria. The three that mattered:

- **The R2 blocker resolved.** Stability and trick authority are the same dial
  only if you insist on one centre of pressure. Splitting it per axis — side
  force behind the CoM to weathercock in yaw, vertical force almost at it so
  pitch stays free — buys both. `npm run probe:axes`.
- **Facets, and what they cost.** A jump doing two things banks 1,049. The
  same launch doing eleven banks 70,644 — a 67x span across one ramp. And the
  row that says everything: that 70,644 flight crashed and paid 175.
- **The park was measurably a scatter.** 1 of 15 ramps landed you anywhere
  authored. The Yard is 21 of 21, with a nine-ramp chain that never touches
  the ground. `npm run lines`.

### Build 4 — what R7 bought

The vision says audio is half the premium illusion and names the mechanism:
*engine and road rumble become wind and mechanical stress at the lip.* That is
a claim about levels over time, so the mix was pulled out of the Web Audio
graph into a pure model (`src/audio/mix.js`) and measured:

```
the mix goes 65% air after              133 ms   (worst 133 ms)
the mix is back under 45% air after     312 ms   (worst 325 ms)
a 60,000 stick pulls the bed to         0.22
a 900 hop pulls the bed to              0.98
and the bed is back up 3 s later at     0.99
```

The road is now its own voice rather than part of the engine, which is what
makes the lip land: an engine that merely gets quieter reads as lifting off the
throttle, a road that *stops* reads as the wheels leaving the ground.

Particles are held to the same standard — the emission decisions live in `Fx`
rather than in the render loop precisely so they can be driven headlessly:

```
gripping at 40 m/s (slip 0.05)           0 particles
sliding  at 40 m/s (slip 0.55)          35 particles
sliding, but airborne                    0 particles
crash vs hard landing                   66 vs 26 particles
peak live over a 20 s drift             54 of 3,000
```

**Owed by R7 and now paid (Build 9):** panel deformation and session-long
scuffing, breakable props, active billboards, a PA, and brake glow. The
acceptance clip's furniture arrived with R8, and its last stage is The
Gauntlet's twelfth.

### Build 7 — R8, and the city as an instrument

The old city measured **4 orphan ramps and 6 reachable from three or more**:
every launch was street to roof, and every roof was a dead end. It is authored
now, against its own routing idea rather than The Yard's.

**The Yard is centripetal.** Rings pointing inward, a tower in the middle, and
the player's job is finding ways back out. Vertical City inverts both halves:
the centre is a *pit* (a low plaza with a pool on it), and altitude is the
currency. Four strata — street 0, mezzanine 12, roofs 24–34, the spire at 46 —
and each one is a network in its own right, because there is a kicker on every
roof aimed at the next one. Descending is free; ascending costs speed carried
from the street.

Two structures carry it. **THE COIL** is a spiral flyover you *drive* — sixteen
wedges on chords of a 26 m circle, one full turn, an eight-degree climb — and
its exit tangent is aimed at the plaza, so the top of the spiral throws you at
the pool. **THE STACK** is a parking structure with a cantilevered kicker on
every deck: an altitude selector, where overshooting the top deck means landing
on the one below rather than on nothing.

```
── city: 34 launchable ramps, 48 structures, 13 tagged targets ──
ramps that only ever land you on deck    0
ramps nothing can reach                  0
ramps reachable from 3+ others          27      (The Yard: 16)
longest chain without touching deck      9
tagged targets no launch reaches         0

strata       street   mezz   roof    sky
  from street        1     27     25      0
  from mezz          5     21     58      3
  from roof          4     12     23      3
  from sky           1      5     12      2
flights that hold or gain altitude   163/202  (81%)
```

Three of those rows are new, and two of them changed the arena:

- **The strata matrix** is the routing idea stated as numbers rather than as
  prose. `probe:city` then checks the claim the matrix cannot: that each rung
  of the ladder is inside *one apex* of the one below.
- **"Tagged targets no launch reaches"** caught four of five billboards and the
  mast sited where nothing could land — prizes behind glass, which is the
  failure the old city made everywhere. They are placed from the measurement
  now: the analyzer knows where every descending arc crosses billboard
  altitude, and the billboards stand in the five busiest of those corridors.
- **"Deck-only ramps"** caught the Coil's exit kicker guessed onto the far side
  of its own circle, firing out of the city into bare ground. It is derived
  from the helix now.

And `probe:city` measures the three claims a reachability graph structurally
cannot, because all three are about the simulation rather than the geometry:
**the Coil is a road** (a car drives it to 27 of 28 m; ten wedges of 45° was a
spiral staircase that dropped a car at 5.5 m, and sixteen of 22.5° is a road),
**the strata are real**, and **the acceptance clip has its furniture** — a
46 m skyscraper to leave, a three-deck garage to land on, and a helicopter
whose near miss now *pays*. That last one was a bug the vision exposed: near
misses lived in `traffic.js` and required speed **over the ground**, which
disqualifies every moment of a shot whose whole point is that the car is in
the air.

### Build 8 — R9, and what a ghost turned out to be

The gate was "100–150 challenges; a ghost can be loaded and beaten". Both
hold, and the interesting half is the ghost.

**A ghost is not a second car in your world.** One that were would be shoved
by you, would shove you, and would perturb the traffic you are both driving
through — and the moment it is touched it stops being the run it recorded. So
a ghost is **baked**: §R already measured that re-simulating a clip reproduces
its run bit-exact, so the clip is re-simulated once, in its own world, and
what is kept is the trajectory. After that it is eight floats a step and no
physics at all, which is why racing one costs a transform a frame on a machine
with no GPU. `probe:mastery` measures the bake against the run it came from:

```
a baked ghost is the run it recorded    0.0000 m worst over 7,201 steps
and it carries the score it had banked  0 worst error
loading one, in the browser             481 steps in 289 ms
```

The eighth float is the score. A ghost that is only a shape is scenery; a
ghost carrying what it had banked *by this moment* is an opponent, and the
HUD delta against a car you can see is the whole retention loop.

**Seven boards is one idea: a run is filed everywhere it qualifies.** A stock
VECTOR run on today's seed with every landing RAW lands on five of them at
once, and the player nowhere near the top of the arena board can be first in
the world on the one they care about. Six are stored; FRIENDS is a *lens* over
the arena board, because a friend list is a fact about a client rather than
about a score. The adapter contract is still exactly two functions, now with a
board id so a server can index and filter itself — `supabase/0001_boards.sql`
plus `game/supabase-board.js` is the whole of a real backend, and
`supabase/README.md` is honest about what an anonymous insert policy cannot
promise.

**103 challenges, generated rather than listed.** Hand-writing 130 objects is
130 chances to ask for a pool in an arena that has no pool, so the sets are
templates run against the arenas and the roster — the same discipline as
derived gaps. `probe:mastery` checks the two things that actually matter about
a generated ladder: every challenge applies to something that exists, and
**none of them completes itself** (a challenge an empty run satisfies gates
nothing). Cars are never gated: the ladder hands out arenas, modes and
eventually The Gauntlet.

**The Gauntlet is a mode, not an arena, and that is a scoping decision.** The
roster describes it as combining everything, and three of six arenas do not
exist — one built now could only combine the two that do and would be rebuilt
in R10. So it is twelve chained trials across the arenas that exist, using the
licence machinery it is already shaped like, unlocked at 90 challenges. Its
last stage is the acceptance clip, verbatim.

Three things R9 forced that were not R9:

- **Call Your Shot never worked.** Its multiplier compared `result.target`
  against the call, and the trick result never carried a target — only the raw
  landing record did. It has presumably never fired.
- **A landing now carries its own flight** (`rotation`, `from`, `landedAt`), so
  "land a 900" reads the rotation rather than reading the name off a facet.
- **`groundClimb`** — the most altitude gained without ever leaving the ground.
  It is how "did you drive the Coil" is answered without teaching the sim what
  a Coil is.

And `probe:menus` is new for a reason that has nothing to do with R9: the
menus are DOM, and a screen whose `onEnter` throws fails no physics probe. It
opens all 24 in a real browser and fails on any page error.

### Build 9 — R7's debts, and the line §R draws through them

Five things, and the five most tempting in the game to fake: a dent nobody can
see, a scuff that goes to black in ten minutes, a bollard that twitches, a
brake light dressed up as a temperature, a tannoy that talks over the engine.
All five look finished in a screenshot; none survives a number. So all five
are models `probe:wear` drives, and the interesting part is where the line
between two of them fell.

**Deformation is physical and lives for one run. Scuffing is cosmetic and
lives for a session.** That is a §R requirement rather than a preference. A
bent hinge rests open, which is a permanently deployed aero surface — bend all
five and the same inputs put the car **109 m** somewhere else after twelve
seconds — so it has to be derived from the run's own inputs, and it is: the
strain that bends a panel is the same relative-velocity measurement that
decides tear-off. Paint costs the simulation nothing, so it can accumulate
across runs; session state that changed physics would mean a clip recorded in
hour three does not reproduce in hour one. *What you can feel resets every
run; what you can see accumulates.* WEAR and PROPS are in the §R hash and
BRAKES, SIGNS and PA are not, and that list is the same sentence again.

Three of the five were retuned because the probe said so, not because they
looked wrong:

- **Deformation bent everything.** At the first threshold a routine hard
  landing (~12 m/s of hinge strain) bent a panel, and the scripted capture
  jump stopped landing at all. The window is the top of the range, just under
  tear-off, which is what "a panel that nearly came off" always meant.
- **Brake heat could not glow.** The first constants settled the discs at
  **0.04** of capacity under a full stop from 55 m/s, against a glow threshold
  of 0.22. They now reach about three quarters of capacity on that stop and
  hold 45% of it a second after the pedal comes up.
- **Props stood inside buildings.** Bollard lines authored as lines run
  through whatever the city built along them. They are filtered against the
  geometry now — 16 of 78 dropped — because a bollard embedded in the Coil is
  a car being fired into the sky by a traffic cone.

And one that was found the hard way. A ring of cones went into The Yard and
`probe:audio` went from five hero jumps to **zero launches**: one cone had
landed on the spawn straight. The Yard gets no props at all now — it is a
void-space arcade construct and clutter argues with that — and street
furniture belongs to the arena that has streets.

The other bug this phase found was not R7's. Two of the five hinges open
through a *negative* angle (the left door and the wing), so the obvious
`Math.max(sag, commanded)` clamped both of them shut and the car silently lost
half its aero. `probe:run` caught it as a 3,294-point run scoring zero.

**Perf, after all three phases.** On the CPU rasteriser, solo runs 280–325 fps
and the 4-way split 102–139 fps at 1080p — down from 353/224, and noisy enough
in this container that the range matters more than any single number. Still
several times the 60/45 target, and the formal verdict still needs
`probe:perf --headful` on a real target machine.

### Build 10 — R10 and R11, and the law that came with them

**Three arenas, and a gate that is not `npm run lines`.** The line analyzer
proves an arena is a *network*; it cannot prove an arena is a **different**
network, and six arenas that are all "ramps pointing at things, 76 m apart"
would pass it six times while being one arena with six skins. That is the
failure a capped-content release cannot afford, because the whole argument for
six instead of twenty is that each is worth thirty hours.

So `probe:arenas` is **`probe:cars` applied to arenas**, with the roster's own
law: no arena may be Pareto-dominated, and every arena must be the maximum on
some axis. If an arena is not the most anything, it is not teaching anything.

```
  arena     retention  verticali  direction     motion   altitude   exposure   openness
  park           0.51       0.00       0.09       0.00       0.00       0.40       0.48
  city           0.49       1.00       0.11       0.19       0.18       0.36       0.50
  works          0.29       1.00       0.06       0.21       0.23       0.49       0.42
  flood          0.20       1.00       0.27       0.00       0.14       0.17       0.33
  sky            0.33       0.52       0.03       0.08       0.60       0.35       0.44

park:retention  city:verticality/openness  works:motion/exposure
flood:direction  sky:altitude
```

The axes earned their keep twice over. `motion` read **zero for every arena**,
including the two built around machinery — movers are their own list, not
tagged targets, so the metric was counting nothing. And Skyline came back
*dominated and the maximum on nothing*: its pads catch their own flights, so
"exposure" could not see the one thing the arena is about. `altitude` is that
axis, and it exists because the gate said the arena did not earn its place.

- **MEGA WORKS routes in time.** Its best surfaces move — a skip on a rail, a
  swinging jib, a conveyor that only pays face-up — so the reachability graph
  *opens and closes* and the skill is leaving at the moment the arrival will be
  somewhere. The static half is a safety net on purpose: a mistimed launch
  lands on a container, never on the concrete.
- **FLOODWAY has a direction**, and it is the only arena that does. Three
  terraces serpentine — top runs east, middle runs west, bottom runs east —
  joined by spillways you *drive*. Its walls face inward, so drifting wide
  returns you to the line carrying the speed you took into it: the arena
  forgives a bad line and punishes a slow one.
- **SKYLINE has no ground.** Everything is 44–92 m up and there is one spiral
  back, at the far edge, that costs most of a round. A missed landing is not a
  crash, it is a *demotion*. Its inverse is Floodway, deliberately.

Four things the analyzer caught that eyes would not have:

- Mega Works had every launch pointing at the middle, so the outer ring was
  decoration — one orphan ramp and two tagged targets nothing could reach. It
  has outward launches and loading aprons now.
- Floodway's first layout put kickers 150 m apart on 600 m terraces: **nothing
  in the arena was reachable from three others.** At the pitch a car actually
  covers it is a chain of nine.
- A single 600 m quarter-pipe wall builds convex hulls Rapier accepts and then
  refuses to make colliders from. Floodway's walls are cast in 40 m sections,
  like real ones.
- Skyline's peak had four roll-offs firing at the compass; two went clean out
  of the arena. The peak launches at *named neighbours* now, like every other
  pad.

And the billboards and masts in all three are sited **from the measurement** —
the corridors where descending arcs actually cross sign height — because
placing them by eye put nine of them where nothing could land, which is the
same failure the city made and the same readout that caught it.

**The Gauntlet is eighteen stages across all five arenas**, and it stays a mode
rather than becoming an arena. That was a scoping decision in R9 and it is a
design decision now: one arena "combining everything" is necessarily a worse
version of each of the five ideas, blended until none of them reads. The exam
asks the centripetal question in The Yard, the altitude question in the City,
the timing question in Mega Works, the momentum question in Floodway and the
commitment question in Skyline — each in the place built to ask it — and still
ends on the acceptance clip.

**R11: seven lenses, and two things that are not modes.**

Free Ride (no clock, no medal, off the boards), Best Trick (a *running
maximum*, so the score you are watching is always your best single stunt and
every other system keeps working unchanged), Combo Run (one chain; a crash
ends it), Survival (twenty seconds, and every landing buys more of them,
scaled by the facet stack) and HORSE, whose letters live in the game layer
because the simulation has no idea anybody is taking turns. HORSE's mark is
the **facet count** of the best landing rather than the score: a score means
reproducing a whole route, a facet count means doing the same number of things
at once, which is a thing you can watch somebody do and then try.

And the replay architecture's quiet gift: **a run is a string.** A clip is
inputs and a seed, so sharing a run needs no upload, no account and no server
— a twenty-second run is 1,750 characters — and what arrives is not a video,
it is the run, re-simulating on their machine to **0.0000 m** over 2,401
steps. It loads as a ghost, because the thing you do with somebody's run is
try to beat it. A code from another physics build is refused with the reason.

The daily set is three challenges chosen by the date, the same three for
everybody, drawn from the ladder that already exists — a daily asking for
something the game does not otherwise ask for is a second game.

### Build 2's acceptance test

> Give somebody one car, one arena, five minutes and no progression. Do they
> immediately hit restart when the timer expires?

**This cannot be self-assessed.** The build can instrument time-to-restart,
session length, landing rate and facet counts, and those say whether people are
*improving*. Whether they *want another go* is a human verdict.

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
