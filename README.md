# AIRTIME — Gate A

**Rush 2049 stunt-mode frame · Three.js + Rapier · web-first, controller-first**

Drive recklessly to earn boost, hit a ramp, flail through the air with too
little thrust to actually fly, and stick a landing somewhere absurd.

This build is **items 1–4 of §12** of `airtime-frame-spec.md`, stopping at
**Gate A** — the delta. It is the part of the design nobody has proven yet:

1. **Tease-thrust** (§5) — a car that flies badly on purpose.
2. **Body-as-trick** (§5.1) — doors, hood, tail flap and wing that steer the air.
3. **The dynamic airtime camera** (§6) — three behaviours chosen by launch context.

Everything else in the spec — scoring, boost economy, traffic, the frame
screens, the garage, replay theater, modes — is deliberately *not* here. Gate A
comes first because if the camera does not make a mediocre jump feel cinematic,
the delta fails and the whole shape of the game changes.

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
| `npm run capture` | render the Gate A clips to `capture/` |
| `npm run probe:aero` | measure what each body panel does to the car |
| `npm run probe:jump` | measure the hero jump |

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

`V` camera style · `B` art style · `Enter` reset

---

## What is actually built

### Physics — all of it Rapier, no fake flight

The car is a `DynamicRayCastVehicleController`: real suspension, real tyre
friction, deliberately loose sideways grip so it drifts. **Nothing changes when
the wheels leave the ramp.** There is no airborne mode and no flight model —
the same rigid body is simply in free flight with no suspension forces, so the
tumble is whatever the launch actually imparted.

The five body panels are real rigid bodies on revolute joints with hinge limits
and position motors. Their aerodynamics is a flat-plate model: drag normal to
each face, scaled by how far the part is deployed, applied at that part's own
position. Nothing in the code says "hood pitches back" — the hood is a plate on
a hinge and the air decides.

`npm run probe:aero` measures it:

```
HOOD         pitch  +3.24  yaw  -0.00  roll  -0.00  drag x3.58   §5.1 hood = pitch back
TRUNK        pitch  -3.84  yaw  -0.00  roll  -0.00  drag x4.14   §5.1 trunk = pitch forward
DOOR_L       pitch  -0.21  yaw  +2.81  roll  -7.50  drag x3.57   §5.1 one door = roll
DOOR_R       pitch  -0.21  yaw  -2.81  roll  +7.50  drag x3.57   §5.1 one door = roll (mirrored)
BOTH DOORS   pitch  -0.42  yaw  +0.00  roll  -0.00  drag x6.14   §5.1 both = air brake
SPOILER      pitch  +0.43  yaw  +0.00  roll  +0.00  drag x1.57   §5.1 spoiler = stability
```

Pillar 1 ("gravity always wins") is enforced structurally rather than by
tuning discipline: the summed upward aerodynamic force is clamped to a fraction
of the car's weight every step (`AERO.MAX_LIFT_FRACTION_OF_WEIGHT`), and the
EXTEND thrust has its upward component hard-clamped
(`THRUST.EXTEND_MAX_UP_COMPONENT`). No combination of parts, thrust and tuning
can hold the car up.

### The camera (§6) — the gate

Three behaviours, selected by launch context, plus the Classic fixed chase from
Options:

- **chase-pullback** — eases back and up, wider FOV, car centred.
- **orbit** — one revolution when the predicted hang time exceeds 2 s, then
  hands back to chase on the descent.
- **landing-target lock** — when a tagged target is in the forward cone, frames
  car and target together and dolly-zooms as the gap closes.

"Never cut, always ease" is structural, not stylistic. A behaviour change
freezes the current on-screen framing as the outgoing shot and crossfades from
it; the crossfaded result is then smoothed again on the way out. There is no
path through `src/render/camera-rig.js` that teleports the camera.

### Tuning

Every feel number in the game is in **`src/TUNING.js`** and reachable at
runtime as `window.AIRTIME.TUNING`. No magic numbers anywhere else in `src/`.
Fifteen groups: `SIM CAR WHEEL DRIVE BOOST THRUST PANELS AERO AIRTIME CAMERA
ARENA RENDER HUD INPUT TELEMETRY`.

### Determinism

Fixed 120 Hz timestep, seeded RNG, no `Math.random` in the simulation. The
three camera clips are the *same* jump — same seed, same input script — shot
three ways; nothing varies except the thing being judged. This is the seam the
state-based replay of §6.1 plugs into.

### Telemetry (pillar 3)

The build logs landing rate per session, as the spec asks, so the "1 in 4 for a
new player, 3 in 4 an hour in" band can be tuned from data rather than opinion.
It is on the HUD and in `window.AIRTIME.telemetry()`.

---

## Architecture

```
src/TUNING.js            every feel number, one object
src/sim/                 headless — no three.js below this line
  physics.js             Rapier world, collision layers
  car.js                 chassis + raycast vehicle + ground handling
  panels.js              five hinged panels: joints, motors, tear-off
  aero.js                flat-plate aerodynamics + the lift clamp
  thrust.js              tease-thrust (§5): extend / correct / dive
  boost.js               the one bar (§5) + burnout chain (§4)
  airtime.js             launch detect, ballistic prediction, landing quality
  telemetry.js           landing rate per session (pillar 3)
  sim.js                 the whole simulation, node-runnable
src/arena/               stunt park as data: 18 ramps, 10 tagged targets
src/render/              three.js: scene, car, arena, camera director, art
src/ui/hud.js            in-run HUD
src/demo-jump.js         the deterministic Gate A jump
tools/                   headless probes, the gate, the capture rig
```

`src/sim` never imports three.js, so the entire simulation runs in node. That
is what makes `npm run gate` a real check rather than a screenshot.

## Not in this build (by design)

Scoring and the trick bank (item 5), boost earn from traffic and near-miss
(item 6), the run timer and result screen (item 7), the frame screens (item 8),
garage and car roster (item 9), arena 2 (item 10), replay theater (item 11),
medals and licences (item 12), split-screen and the other modes (item 13).

The boost bar earns from drift, speed and airtime as a placeholder so the §5
tradeoff can be felt at all; those terms are marked `PLACEHOLDER_` in TUNING
for item 6 to replace.
