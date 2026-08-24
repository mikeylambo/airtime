# AIRTIME

**Rush 2049 stunt-mode frame · Three.js + Rapier · web-first, controller-first**

Drive recklessly to earn boost, hit a ramp, flail through the air with too
little thrust to actually fly, and stick a landing somewhere absurd.

This build is **items 1–12 of §12** of `airtime-frame-spec.md` — through
**Gate A** (the delta), **Gate B** (the loop) and **Gate C** (the frame).
Item 13 (split-screen, pass-the-pad, highlight reel, the other three modes) and
item 14 (audio and the polish pass) are not in it.

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

### Scoring (§3.1)

Rotation is integrated from the car's own angular velocity and named *after the
fact* — a player who does not know they did a 540 still gets paid for one. The
maths reproduces the spec's worked examples exactly: a perfect 360 onto a
rooftop is 450, a sloppy 1080 on the road is 220.

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
- **Item 13 modes are listed but locked**: Call Your Shot, Last Car Standing,
  Hot Potato and Party appear in mode select and do not start.
- **No audio.** That is item 14.
