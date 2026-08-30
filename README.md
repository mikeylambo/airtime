# AIRTIME

**Rush 2049 stunt-mode frame · Three.js + Rapier · web-first, controller-first**

Drive recklessly to earn boost, hit a ramp, flail through the air with too
little thrust to actually fly, and stick a landing somewhere absurd.

This build is the **Rush Reframe** ([ROADMAP.md](ROADMAP.md)) on top of items
1–13 of the original spec: R1 stunt grammar, R2 air control, R3 the rebuilt
stunt park, R4 flow, and a synthesised audio pass.

`npm run gate` runs all twelve measurable criteria.

---

## Run it

```bash
npm install
npm run dev
```

| | |
|---|---|
| `npm run dev` | play it |
| `npm run gate` | Gate A acceptance checks, headless |
| `npm run probe:run` | a whole 90-second run, headless, with the score breakdown |
| `npm run probe:aero` | measure what each body panel does to the car |
| `npm run probe:modes` | run every §9 mode and check its rule actually bites |
| `npm run probe:facets` | what a jump is worth as it stacks facets |
| `npm run probe:air` | stick-to-rotation mapping, measured |
| `npm run lines` | the arena's reachability graph |
| `npm run gaps` | regenerate the named gaps from that graph |
| `npm run probe:cars` | the instrument gate — is any car a tier? |
| `npm run probe:gaps` | do the named gaps hold up in the real solver |
| `npm run probe:audio` | the soundscape handoff, the duck, the room |
| `npm run probe:fx` | particles as a response, and the pool ceiling |
| `npm run shots` | render a PNG of every screen in the frame |
| `npm run capture` | render the clips in `capture/` |

### The one check that cannot run in CI

Every gate above is headless and runs anywhere. `probe:perf` is the exception:
the art brief's bar is **60 fps solo and 45 fps four-way at 1080p on an
integrated GPU**, and a headless box has no GPU to ask. It falls back to
SwiftShader, which rasterises on the CPU — a useful pessimistic floor, and not
an answer to the question.

So the verdict has to be taken on the target machine, with a display:

```bash
git clone -b <branch> https://github.com/mikeylambo/airtime && cd airtime
npm install          # pulls Puppeteer's own Chromium; no system browser needed
npm run build        # probe:perf drives dist/, not the dev server
node tools/probe-perf.mjs --headful
```

A window opens, four runs go past (solo and four-way, each at full effects and
Reduce Effects), and it exits 0 on PASS, 1 on FAIL. `--frames=N` shortens each
run from the default 240.

**Taken 2026-08-30 on a MacBook Pro: PASS** — 60 fps solo and ≥45 fps four-way
at 1080p. The weak end of "integrated" (an older Intel laptop) is still
untested, so read it as "not GPU-bound on integrated graphics" rather than as a
guarantee for every machine without a dedicated card.

It prints the renderer string it actually got, and **refuses to grade a
software rasteriser under `--headful`** (exit 2) — which is what you get from
`xvfb-run` on a server, and what makes the difference between a perf verdict
and a number. Without a display it will not start at all: Puppeteer says
`Missing X server`. Neither is a bug to work around; both mean *this is not the
machine the question is about*.

## Controls

Gamepad first, keyboard mirrors it. The triggers change meaning in the air,
because §5.1 makes the panels air-only and that frees them up on the ground.

| | Ground | Air |
|---|---|---|
| RT / **W** | throttle | tail flap (pitch forward) |
| LT / **S** | brake | hood (pitch back) |
| LB / **Q** · RB / **E** | — | left door · right door |
| A / **Shift** | boost | thrust burst |
| X / **Space** | handbrake | — |
| Y / **C** | — | wing |
| Stick / **arrows** | steer | pick the thrust mode |

`V` camera style · `B` art style · `Enter` reset. In the replay theater:
`Space` play/pause, `←→` scrub, `C` camera, `K` keyframe, `WASD/RF` free cam,
`X` export 16:9, `Z` export 9:16.

---

## What is actually built

### Physics — all of it Rapier, no fake flight

The car is a `DynamicRayCastVehicleController`: real suspension, real tyre
friction, deliberately loose sideways grip so it drifts. **Nothing changes when
the wheels leave the ramp.** There is no airborne mode and no flight model —
the same rigid body is simply in free flight with no suspension forces, so the
tumble is whatever the launch actually imparted.

The five body panels are real rigid bodies on revolute joints with hinge limits
and position motors. Their aerodynamics is a flat-plate model applied at each
part's own position. Nothing in the code says "hood pitches back" — the hood is
a plate on a hinge and the air decides. `npm run probe:aero` measures it:

```
HOOD         pitch  +3.24  yaw  -0.00  roll  -0.00  drag x3.58   §5.1 hood = pitch back
TRUNK        pitch  -3.84  yaw  -0.00  roll  -0.00  drag x4.14   §5.1 trunk = pitch forward
DOOR_L       pitch  -0.21  yaw  +2.81  roll  -7.50  drag x3.57   §5.1 one door = roll
BOTH DOORS   pitch  -0.42  yaw  +0.00  roll  -0.00  drag x6.14   §5.1 both = air brake
SPOILER      pitch  +0.43  yaw  +0.00  roll  +0.00  drag x1.57   §5.1 spoiler = stability
```

Pillar 1 ("gravity always wins") is enforced structurally rather than by tuning
discipline: summed upward aerodynamic force is clamped to a fraction of the
car's weight every step, and the EXTEND thrust has its upward component
hard-clamped. No combination of parts, thrust and tuning can hold the car up.

### The camera (§6)

chase-pullback, orbit (on predicted hang time over 2 s), and landing-target
lock with a dolly-zoom, chosen by launch context; Classic fixed chase in
Options. "Never cut, always ease" is structural: a behaviour change freezes the
current on-screen framing as the outgoing shot and crossfades from it, and the
crossfaded result is smoothed again on the way out.

### Scoring — facets (R1)

The reference did not ask "what trick was that". It asked how many *different
things* were true at once, then multiplied brutally. So a flight is decomposed
into facets — flips, rolls, spins, twist, inverted, big air, height, distance,
gap, transfer, wheelie, endo, two-wheel, near-miss, held bodywork — and the
**count** is the multiplier, from ×1 at one to ×42 at ten.

Rotation is still integrated from the car's own angular velocity and named
after the fact. A player who does not know they did a 540 while inverted with
the tail out gets paid for all three.

```
hands off    2 facets  x1.5              RAW   x2.2   bank  1,049   clean  ->  2,273
one door     5 facets  x6   WILD         RAW   x2.2   bank  9,781   CRASH  ->    175
the works   11 facets  x42  IMPOSSIBLE   FLOWN x1     bank 70,644   CRASH  ->    175
```

Those bottom rows are the mode in one line: a flight worth 70,644 that paid
175 because it did not land. Bank is what the air was worth; payout is what
the ground agreed to.

**Purity** (RAW / TOUCHED / FLOWN) makes the assist a resource rather than a
right — worth ×2.2 down to ×1. It counts only the *stabilising* verbs (the
thrust burst, both doors as an air brake, the wing), because our bodywork also
*creates* rotation and charging for that would make the trick generator the
thing that costs you.

### The car (RC)

The car was a box for four builds, because the physics was the thing that
needed proving. It is now a wedge exotic — and the wedge language is the
*cheapest* car we could possibly draw. It is all straight lines and flat
planes, and curvature is the expensive thing.

It also happens to be what our looks want. AFTERGLOW works by drawing emissive
edges, and an angular body generates clean ones; a curved body gives either no
edges under smooth shading or a mess of triangulation seams.

Nothing is authored per car. [src/render/wedge.js](src/render/wedge.js) lofts
the body, glasshouse and engine cover from cross-sections whose every
proportion comes from the physics — half-extents, wheelbase, track. So NEEDLE
comes out a long low arrow and STUB a short brick, for exactly the reasons they
behave that way. `npm run shots:car` puts them side by side, because a
silhouette is the one thing here that cannot be gated.

Two places where the drawing deliberately disagrees with the simulation, both
for the same reason — the collider is a crash volume, not a shape:

- The **hull overhangs the collider** at both ends and hangs well below it. The
  car rests on its wheels; a body drawn to the collider floats half a metre off
  the road on stilts.
- The **aero surfaces are drawn smaller** than the areas the physics uses. Those
  areas are what make one surface roll the car and two brake it, and
  `npm run probe:aero` gates all six of those claims — but at full size a
  1.7 m hood plate hinged above the deck is most of what you see.

### Cars are instruments, not tiers (R5)

Eight vehicles, and the law is that **no car is Level 8 and therefore better
than Level 2**. A car is a different way to play, never a stronger one — so
none of them is gated behind medals, and "the best ANVIL player" has to be a
thing somebody can be.

That is testable, and `npm run probe:cars` tests it: every car is flown through
the same eight fixed experiments and the build fails if any car is
**Pareto-dominated** — if some other car is at least as good at everything.
Non-dominated is the precise form of the law: it means that against any rival,
there is always some axis where this car wins.

```
car        top spd     slip     flip     roll   impact airbrake    glide  recover
vector       58.04     4.11     2.71     2.85     5.00     0.06     2.17     6.00
dart         55.90     3.74     4.50     3.48     4.00     0.47     1.95     4.00
anvil        59.62     3.80     2.07     2.14     5.00     0.52     2.25     3.00
...
```

Each car is built around one dominant knob and stays neutral on the others —
GRIP on engine, DRIFTER on rear-axle grip, STUB on pitch inertia, PROTOTYPE on
body width (roll inertia comes out of the box formula as width, so only the
roll car is narrow), ANVIL on suspension, NEEDLE on body lift, DART on panel
area, VECTOR on nothing at all. Anything less disciplined and the winners get
decided by whichever coupling happened to be strongest.

### Named gaps (R6)

Every arena has named, discoverable gaps — and they are **derived, not
authored**. `npm run gaps` takes the reachability graph the line analyzer
already computes, keeps the long, high edges that land somewhere real, and
names them by bearing and shape: the north bank drop, the west kicker step.
Crossing one for the first time is worth 4,000 and is recorded on the profile
forever.

Hand-placing them would be guesswork about geometry the analyzer knows exactly.

### Air control (R2)

The bodywork is five hinged surfaces; the player gets one stick. Left/right
puts a door out and rolls. Up/down works the hood or the tail flap and pitches.
A shoulder throws everything out at once as an air brake. The panels are
actuators, not controls — the door still swings, you just stop addressing it.

Underneath, the chassis has a **per-axis centre of pressure**: side force acts
well behind the centre of mass so the car weathercocks in yaw and flies
nose-first, vertical force acts almost at it so pitch stays cheap to start and
cheap to stop. With a single CoP you must choose between a car that lands
hands-off and a car that can be turned over at all. `npm run probe:axes`.

### The Yard (R3)

Build 1's park was a scatter: 1 of 15 ramps landed you anywhere authored, and
the other fourteen could only put you back on the deck. `npm run lines`
measured it, which is the only reason it was fixable.

The Yard is laid out by *range* instead of by eye — a car leaves a 28° kicker
at 40–50 m/s and travels 60–90 m, so everything sits on rings inside that
envelope, and everything points inward:

```
ramps that land you somewhere authored   21/21  (100%)
ramps that only ever land you on deck    0
ramps nothing can reach                  0
ramps reachable from 3+ others           16
longest chain without touching deck      9
```

### Vertical City (R8)

The Yard is centripetal — rings pointing inward, and the job is finding ways
back out. The city inverts both halves: **its centre is a pit**, not a peak (a
low plaza with a pool on it), and **altitude is the currency**. Four strata,
each a network in its own right, because there is a kicker on every roof aimed
at the next one. Descending is free; ascending costs speed carried from the
street.

```
── city: 34 launchable ramps, 48 structures, 13 tagged targets ──
ramps that only ever land you on deck    0
ramps nothing can reach                  0
ramps reachable from 3+ others          27      (The Yard: 16)
longest chain without touching deck      9
tagged targets no launch reaches         0
flights that hold or gain altitude   163/202  (81%)
```

Two structures carry it. **THE COIL** is a spiral flyover you *drive* —
sixteen wedges on chords of a 26 m circle, one turn, an eight-degree climb —
with its exit tangent aimed at the plaza, so the top of the spiral throws you
at the pool. **THE STACK** is a parking garage with a cantilevered kicker on
every deck: an altitude selector, where overshooting the top deck means
landing on the one below rather than on nothing.

`npm run probe:city` measures the three claims a reachability graph cannot,
because all three are about the simulation: the Coil is a road (a car drives
it to 27 of 28 m), each rung of the ladder is inside one apex of the one
below, and the acceptance clip has its furniture — a 46 m skyscraper to leave,
a three-deck garage to land on, and a helicopter whose near miss pays.

### The other three arenas (R10)

`npm run lines` proves an arena is a *network*. It cannot prove an arena is a
**different** network — six arenas that are all "ramps pointing at things,
76 m apart" would pass it six times while being one arena with six skins. So
`npm run probe:arenas` is **`probe:cars` applied to arenas**, with the roster's
own law: no arena Pareto-dominated, every arena the maximum on some axis.

```
  arena     retention  verticali  direction     motion   altitude   exposure   openness
  park           0.51       0.00       0.09       0.00       0.00       0.40       0.48
  city           0.49       1.00       0.11       0.19       0.18       0.36       0.50
  works          0.29       1.00       0.06       0.21       0.23       0.49       0.42
  flood          0.20       1.00       0.27       0.00       0.14       0.17       0.33
  sky            0.33       0.52       0.03       0.08       0.60       0.35       0.44
```

- **MEGA WORKS routes in time.** A skip on a rail, a swinging jib, a conveyor
  that only pays face-up: the reachability graph opens and closes, and the
  skill is leaving at the moment the arrival will be somewhere.
- **FLOODWAY has a direction.** Three terraces serpentine — east, west, east —
  joined by spillways you drive. Its walls face inward, so drifting wide
  returns you to the line carrying the speed you took into it.
- **SKYLINE has no ground.** Everything is 44–92 m up and one spiral, at the
  far edge, is the way back. A missed landing is a demotion, not a crash.

### Mastery (R9)

**Ghosts.** A ghost is not a second car in your world — one that were would be
shoved by you and would stop being the run it recorded. It is *baked*: §R
already measured that re-simulating a clip reproduces its run bit-exact, so
the clip is re-simulated once, in its own world, and what is kept is the
trajectory. Eight floats a step and no physics at all. The eighth is the
score, which is what turns a shape on the road into an opponent.

**Seven boards, one idea:** a run is filed everywhere it qualifies. Arena,
vehicle, stock setup, best single stunt, RAW, daily seed, friends — and the
player nowhere near the top of the arena board can be first in the world on
the one they care about. Six are stored; FRIENDS is a *lens*, because a friend
list is a fact about a client rather than about a score.

**103 challenges, generated rather than listed** — templates run against the
arenas and the roster, so no challenge asks for a pool in an arena that has no
pool. Cars are never gated behind them: the ladder hands out arenas, modes and
eventually The Gauntlet.

### The mode roster and run codes (R11)

Seven lenses on one game, not seven games — the same loop with one rule bolted
on. **Free Ride** (no clock, no medal, off the boards), **Call Your Shot**,
**Best Trick** (a running maximum, so the score you are watching is always
your best single stunt), **Combo Run** (one chain; a crash ends it),
**Survival** (twenty seconds, and every landing buys more of them),
**Party Stunts**, and **HORSE**, whose mark is the *facet count* of the best
landing rather than the score — a score means reproducing a route, a facet
count means doing the same number of things at once, which is a thing you can
watch somebody do and then try.

And the replay architecture's quiet gift: **a run is a string.** A clip is
inputs and a seed, so sharing one needs no upload, no account and no server —
a twenty-second run is 1,750 characters — and what arrives is not a video, it
is the run, re-simulating on their machine to 0.0000 m. It loads as a ghost,
because the thing you do with somebody's run is try to beat it.

### Audio

Synthesised, not sampled: engine load through a faked gearbox, wind that takes
over at launch, tyre scrub on slip, landing weight, crash, per-part whooshes,
and a cash-out that climbs a note per facet. No files and no licensing, driven
straight off the simulation.

### Reduce Effects (§A)

One switch, whole game — `render/theme.js`, next to the colourblind one, for
the same reason: every consumer follows without carrying its own copy. It
shipped covering the trails, and then three later emissive systems ignored it
because each carried the flag itself or never asked.

What each system does with it is a judgement rather than a blanket kill.
**Signs** dim and stop punching to white but still say "land here" — that is
gameplay information. **Brake discs** dim to 35% rather than going out; a
glowing brake is a readout. **The ghost** dims and never disappears, because
hiding it would be leaving the mode rather than reducing effects.

`npm run probe:dark` shoots both scenarios twice and holds the end-to-end
claim: with Reduce Effects on, no frame is ever brighter.

### The premium debts, paid (R7)

Five things the premium pass owed, and the five most tempting things in the
game to fake — all of them look finished in a screenshot and none survives a
number, so all five are models a probe drives (`npm run probe:wear`).

**Deformation is physical and lives for one run; scuffing is cosmetic and
lives for a session.** That split is a §R requirement, not taste: a bent hinge
rests open, which is a permanently deployed aero surface and a real change to
how the car flies, so it has to be derived from a run's own inputs. Paint
costs the simulation nothing, so it can accumulate across runs — session state
that affected physics would mean a clip recorded in hour three does not
reproduce in hour one. So *what you can feel resets every run; what you can
see accumulates*, and in AFTERGLOW "damaged" reads as the car's own light
going out where it has been hit.

The strain that bends a panel is the same measurement that decides tear-off,
and only the top of its range counts — a routine hard landing strains a hinge
at about 12 m/s, and that is not "nearly came off". The first numbers bent
every panel on every landing and the scripted capture jump stopped landing at
all, which is how the window was found.

**Props break above a speed and are inert below it.** Kinematic until hit hard
enough, then dynamic and thrown, with a budget — a bollard that twitches when
you brush it promises physics it is not running. They are filtered against the
geometry: a prop standing inside a solid is dropped, because a bollard
embedded in the Coil is a car being fired into the sky by a traffic cone. The
Yard gets none: it is a void-space arcade construct and clutter argues with
that.

**Brake heat is an integral, not a light bulb** — it lags the pedal, keeps
glowing while you accelerate away, and stacks across a series of small brakes.
It is work rather than pressure, so it appears at the end of a straight and
never in a car park, and a brake in mid-air heats nothing.

**Active billboards say the one thing they already mean, louder.** AFTERGLOW's
rule is that billboards are the only bright objects because brightness is
"land here" language, so a sign is bright in proportion to how much it
currently *is* a landing target: aligned, in range, airborne. Landing on one
punches it to WHITE-HOT for 120 ms, which is the art brief's own
photosensitivity cap.

**The PA is a room, not an announcer.** A tannoy two hundred metres away,
band-limited to a telephone, syllabic rather than semantic — from inside a car
at seventy you know somebody announced something and could not repeat it,
which is the correct amount of information and the honest version of the
fiction rather than a placeholder for a voice pack. It never talks over
itself, owes silence between calls, and is ducked *by* the car rather than the
other way round.

### Premium feel (R7)

The vision's claim is that *audio is half the premium illusion*, and that the
mechanism is the handoff: engine and road rumble become wind and mechanical
stress at the lip. That is a claim about levels over time, which is a claim
that can be checked — so the mix is a pure model with no Web Audio in it
([src/audio/mix.js](src/audio/mix.js)), and `npm run probe:audio` drives real
jumps through it:

```
the mix goes 65% air after              133 ms
the mix is back under 45% air after     312 ms
a 60,000 stick pulls the bed to         0.22
a 900 hop pulls the bed to              0.98
```

The **road** is its own voice now, not part of the engine. That is the whole
trick: an engine that merely gets quieter reads as lifting off the throttle,
whereas a road that *stops* reads as the wheels leaving the ground. Underneath
it there is a crowd that reacts rather than drones, and a synthesised bed that
a big stick ducks out from under itself.

Particles are held to the same standard. The emission decisions live in `Fx`,
not in the render loop, so `npm run probe:fx` can check that smoke appears
where the tyres are actually slipping and nowhere else, that a crash throws
more than a landing does, and that a real run never overruns the pool.

### Traffic (§4)

Both behaviours ship. Reactive swerves, brakes and honks; Ambient holds its
lane. Driving the lanes and running oncoming fills the boost bar and the safe
centre line does not — that is the whole trade:

```
mode      line               | near  oncoming  earned
reactive  clean centre line  |    0      0.0s    0.24
reactive  alongside lane     |    9      6.9s    1.00
```

### The frame (§2)

Title, profile (3 slots), main menu, mode select, arena select, pre-run,
in-run, result, garage, replays, theater, licences, leaderboard, options.
Menus are DOM over a live 3D world, so there is nothing to load between nodes
and every transition is under 300 ms.

### Garage (§7)

Three archetypes, four sliders, part variants and liveries resolve into the
actual numbers the rigid body, suspension, thrust and panels are built from —
`src/sim/cars.js`. Change a slider and the car is a different object in the
world, and the live preview jump fires so you watch rather than read:

```
car     launch  apex   air    landing
dart     65.7   38.8  3.52s  clean
vector   61.4   32.1  2.94s  clean
anvil    56.5   28.2  2.89s  sloppy
```

### Modes and party (§9)

All five modes run. Each is the same loop with one rule bolted on
(`src/sim/modes.js`), and `npm run probe:modes` exercises each rule directly:

```
potato:         inside the zone 800, outside it 0
standing:       2 of 3 crashed -> 1 alive, round over true
call your shot: called and hit 750, called and missed 300
```

**Split-screen** puts two to four cars in *one* world on one clock — not four
worlds side by side, so they can hit each other. Per-viewport cameras are
pinned to chase-pullback, because §6 is explicit that an orbit does not survive
a quartered screen. **Pass-the-pad** is 45-second turns with a scoreboard
between them, on the full screen and the full camera.

Every round, in every mode, ends with the **highlight reel**: the top three
landings replayed full-screen under the cinematic camera before anybody sees a
score. Because a clip is inputs rather than footage, the reel is re-simulating
the round, and it follows whichever driver earned the landing.

### Replay (§6.1)

A clip is inputs and a seed, so the theater does not play footage back — it
re-runs the jump. That is why any saved landing can be re-shot under a
different camera, flown through with a free cam, keyframed, and exported to
16:9 or 9:16. Every landing over the threshold saves itself.

### Tuning

Every feel number is in **`src/TUNING.js`** and reachable at runtime as
`window.AIRTIME.TUNING`. No magic numbers anywhere else in `src/`.

---

## Architecture

```
src/TUNING.js            every feel number, one object
src/sim/                 headless — no three.js below this line
  physics car panels     Rapier world, raycast vehicle, hinged bodywork
  aero thrust boost      flat-plate aerodynamics, tease-thrust, the one bar
  airtime tricks run     launch/landing, trick naming, the round
  traffic movers         §4 traffic, §6.2 train / helicopter / billboard
  cars replay telemetry  garage setups, state-based replay, landing rate
src/arena/               two arenas as data: stunt park, city block
src/render/              three.js: scene, car, arena, camera director, art
src/ui/                  screen manager and every §2 screen
src/game/                licences, daily seed, leaderboard adapter
tools/                   headless probes, the gate, capture and screenshot rigs
```

`src/sim` never imports three.js, so the entire simulation runs in node. That
is what makes `npm run gate` and `npm run probe:run` real checks rather than
screenshots.

## Known gaps

- **The leaderboard is local until it is pointed at a project.** The Supabase
  adapter and its schema are in the build (`src/game/supabase-board.js`,
  `supabase/0001_boards.sql`); setting `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` switches to it and nothing else changes. Running
  the migration against a real project is the owner's call, not the build's —
  and `supabase/README.md` is honest that an anonymous insert policy cannot
  stop somebody posting a score they did not earn. The fix for that is already
  built and is not a policy: a score is a replay, and a replay re-simulates.
- **Clips carry their whole prefix.** A deterministic replay has to re-simulate
  from step zero, so a landing late in a run stores that run's whole input
  stream — tens of KB, not the few KB an early one costs.
- **The scoring is not balanced against eight cars.** The facet curve was tuned
  against one, and a car that rolls three times as hard as another banks
  proportionally more. The boards exist now (R9), so this is judgeable — but
  judging it needs runs by somebody who is trying, not by a scripted driver.
- **The glass does not break.** Panels detach and bend, and the car scuffs
  across a session; the glasshouse is still one unbreakable volume.
- **The Gauntlet is a mode, not an arena**, and since R10 that is a design
  choice rather than a scoping one: one arena "combining everything" is
  necessarily a worse version of each of the five routing ideas, blended until
  none of them reads. It is eighteen stages across all five instead.
- **The scripted driver cannot drive the new arenas.** It finds the hero jump
  in The Yard and flails everywhere else — in Skyline it never gets off the
  deck, because the way up is a spiral it has no idea how to take. `probe:run`
  is a smoke test that the loop runs, and it is a weaker one in five arenas
  than it was in two.
- **The scripted driver is a weak proxy for a player.** It lands what it
  launches but only finds a handful of ramps in a round, so `probe:run` is a
  smoke test that the loop runs end to end, not a measure of what the mode is
  worth in someone's hands.
- **Gate D cannot be self-assessed.** Its pass condition is "somebody yells
  during the reel", which needs three people and a room.
