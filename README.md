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
| `npm run shots` | render a PNG of every screen in the frame |
| `npm run capture` | render the clips in `capture/` |

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

### Audio

Synthesised, not sampled: engine load through a faked gearbox, wind that takes
over at launch, tyre scrub on slip, landing weight, crash, per-part whooshes,
and a cash-out that climbs a note per facet. No files and no licensing, driven
straight off the simulation.

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

- **The leaderboard is local.** `src/game/daily.js` has the adapter seam;
  `submit` and `top` are the only two functions a Supabase table would replace.
  Provisioning a cloud project is the owner's call, not the build's.
- **Clips carry their whole prefix.** A deterministic replay has to re-simulate
  from step zero, so a landing late in a run stores that run's whole input
  stream — tens of KB, not the few KB an early one costs.
- **The scoring is not balanced against eight cars.** The facet curve was tuned
  against one, and a car that rolls three times as hard as another banks
  proportionally more. That is R9's problem, and it needs the boards to exist
  before it can be judged.
- **The audio is a minimum, not a pass.** Engine, wind, scrub, impacts and the
  cash-out exist. Crowd, PA, chassis groans, an escalating combo sting and any
  music do not.
- **The city arena has not been reframed.** It is still a procedural grid of
  towers — the opposite of an instrument — and `npm run lines --city` will say
  so. It should be rebuilt against the same range logic, not iterated.
- **The scripted driver is a weak proxy for a player.** It lands what it
  launches but only finds a handful of ramps in a round, so `probe:run` is a
  smoke test that the loop runs end to end, not a measure of what the mode is
  worth in someone's hands.
- **Gate D cannot be self-assessed.** Its pass condition is "somebody yells
  during the reel", which needs three people and a room.
