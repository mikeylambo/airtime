/**
 * AIRTIME — single source of truth for every tunable number.
 *
 * Rule (inherited from the DESCENT shell): no magic numbers anywhere else in
 * src/. If you find yourself typing a float into a system file, it belongs
 * here instead. Everything a playtester might want to change lives in this
 * file and is reachable at runtime as `window.AIRTIME.TUNING`.
 *
 * Units: metres, kilograms, seconds, radians. World up is +Y. The car's local
 * forward is -Z (three.js convention), local up is +Y, local right is +X.
 *
 * Spec cross-references (airtime-frame-spec.md) are marked as §n.
 */

export const TUNING = {

  // ── Simulation ───────────────────────────────────────────────────────────
  SIM: {
    HZ: 120,                    // physics rate. High: raycast vehicle + jointed
                                // panels need it, and it keeps replays crisp.
    MAX_STEPS_PER_FRAME: 8,     // spiral-of-death guard
    GRAVITY: -22.0,             // §0.1 pillar 1 "gravity always wins" — heavier
                                // than real 9.81 so arcs are punchy, not floaty.
    SEED: 0x51ac,               // deterministic RNG seed (replays, §6.1)
    // Safety rail, not a flight model: no solver artefact may ever launch the
    // car faster than this. If it trips, something upstream is wrong.
    MAX_SPEED_CLAMP: 140,
    SOLVER_ITERATIONS: 8,       // joint stability for the hinged panels
  },

  // ── Car: chassis ─────────────────────────────────────────────────────────
  // §11 Gate A: "car = box with four hinged panels". Half-extents.
  CAR: {
    // Short overhangs and real ground clearance. A long nose on a low body
    // spears the base of every ramp before the front wheels can start
    // climbing it — the first thing the headless drive probe caught.
    HALF: { x: 0.95, y: 0.38, z: 1.95 },   // chassis box half-extents
    MASS: 1150,
    // Centre of mass offset from the box centre. Low and slightly forward:
    // low keeps it from tipping on the ground, forward makes it want to nose
    // down in the air, which is what makes a flat landing an achievement.
    COM: { x: 0, y: -0.26, z: -0.10 },
    // Rotational inertia scaling, per local axis (x=pitch, y=yaw, z=roll).
    // The single biggest knob on how the car tumbles. <1 spins more freely.
    INERTIA_SCALE: { x: 0.86, y: 1.00, z: 0.62 },
    LINEAR_DAMPING: 0.02,
    ANGULAR_DAMPING: 0.18,      // baseline "air resists rotation"; panels add more
    RESTITUTION: 0.0,           // a scraping chassis must never trampoline
    FRICTION: 0.75,
    CCD: true,                  // stops the car tunnelling through ramps at speed
  },

  // ── Car: wheels / raycast vehicle (Rapier DynamicRayCastVehicleController) ─
  WHEEL: {
    RADIUS: 0.46,
    // Connection points relative to chassis centre.
    HALF_TRACK: 0.92,           // ±x
    AXLE_FRONT_Z: -1.58,        // front axle (car faces -Z)
    AXLE_REAR_Z: 1.52,
    CONNECT_Y: -0.10,           // suspension top attach, relative to chassis centre
    SUSPENSION_REST: 0.55,
    // Stiff and long-travel on purpose. Entering the hero ramp at 60 m/s
    // demands ~12 m/s of vertical velocity change; a soft short suspension
    // bottoms out, the chassis ploughs the ramp face, and the car explodes.
    SUSPENSION_STIFFNESS: 190.0,
    SUSPENSION_COMPRESSION: 1.10,
    SUSPENSION_RELAXATION: 1.55,
    MAX_SUSPENSION_TRAVEL: 0.50,
    MAX_SUSPENSION_FORCE: 200000,
    FRICTION_SLIP: 3.2,         // forward grip
    SIDE_FRICTION: 0.62,        // §4 "heavy drift" — deliberately loose
  },

  // ── Ground handling (§4 Burnout feel layer) ──────────────────────────────
  DRIVE: {
    ENGINE_FORCE: 5600,         // per driven wheel
    ENGINE_FORCE_BOOST: 10200,  // while boosting
    REVERSE_FORCE: 2400,
    BRAKE_FORCE: 3800,
    HANDBRAKE_FORCE: 2600,
    HANDBRAKE_SIDE_FRICTION: 0.16,   // drops rear grip → the drift
    DRIVEN_WHEELS: 'rear',      // 'rear' | 'front' | 'all'
    TOP_SPEED: 68,              // m/s soft cap (~245 km/h)
    TOP_SPEED_BOOST: 88,
    SPEED_CAP_FALLOFF: 8,       // m/s over which engine force fades to zero at cap

    STEER_MAX: 0.58,            // radians at full lock, low speed
    STEER_MIN: 0.16,            // radians at full lock, top speed
    STEER_SPEED_FALLOFF: 44,    // m/s at which steering has fully tightened
    STEER_RATE: 6.4,            // rad/s the virtual steering column can move
    STEER_RETURN_RATE: 9.0,     // faster self-centring than turn-in

    // Drift bookkeeping (feeds the boost bar, §4)
    DRIFT_MIN_SLIP_ANGLE: 0.22, // rad between heading and velocity to count
    DRIFT_MIN_SPEED: 12,
  },

  // ── The one bar (§5) — ground boost and air thrust share this meter ───────
  BOOST: {
    MAX: 1.0,
    START: 0.70,                // Gate A: start with enough to feel the tradeoff
    DRAIN_PER_SEC_GROUND: 0.26, // holding boost on the ground
    THRUST_COST: 0.16,          // one air burst (§5)

    // Earn (§4). Traffic near-miss lands with item 6; until then drift, speed
    // and airtime are the earn model. Flagged PLACEHOLDER_* so item 6 can
    // replace them without hunting through systems.
    EARN_DRIFT_PER_SEC: 0.16,
    EARN_AIRTIME_PER_SEC: 0.09, // §4 "airtime itself (small)"
    EARN_SPEED_PER_SEC: 0.030,  // fills while near top speed
    EARN_SPEED_MIN: 42,         // m/s before speed earn kicks in
    EARN_NEARMISS: 0.11,        // §4 — the big one, per near miss
    EARN_ONCOMING_PER_SEC: 0.16,// §4 — driving into the oncoming lane

    // §4 Burnout-chain rule: drain the full bar in one unbroken hold → refill.
    CHAIN_ENABLED: true,
    CHAIN_START_MIN: 0.96,      // must begin the hold this full
    CHAIN_REFILL: 1.0,
  },

  // ── Tease-thrust (§5) — the delta, part A ────────────────────────────────
  // "The car must never fly." Every number here is bounded so that thrust
  // buys you time and attitude, never sustained flight.
  THRUST: {
    BURST_TIME: 0.60,           // §5 "~0.6s"
    COOLDOWN: 0.22,             // between bursts
    AIR_ONLY: true,

    // Mode selection by stick direction at press (§5).
    STICK_DEADZONE: 0.34,       // below this → CORRECT
    FORWARD_CONE: 1.05,         // rad half-angle around stick-up → EXTEND
    BACK_CONE: 1.05,            // rad half-angle around stick-down → DIVE
                                // everything else (sideways) → CORRECT

    // EXTEND — forward push, §5 "adds ~20% airtime"
    EXTEND_ACCEL: 15.5,         // m/s^2 while the burst runs
    EXTEND_VELOCITY_ALIGN: 0.70,// 0 = along chassis forward, 1 = along horizontal
                                // velocity. Blend keeps it usable mid-tumble.
    EXTEND_MAX_UP_COMPONENT: 0.18, // cap on how much of the push may point up —
                                   // this is the clamp that forbids flight.

    // CORRECT — kills angular velocity, saves a tumble
    CORRECT_ANGVEL_KILL: 4.2,   // exponential rate, 1/s (higher = snappier save)
    CORRECT_LEVEL_TORQUE: 5.5,  // gentle torque toward wheels-down
    CORRECT_LEVEL_MAX_RATE: 2.2,// rad/s cap so it assists, never auto-lands

    // DIVE — downward push, commit early
    DIVE_ACCEL: 24.0,
    DIVE_FORWARD_BLEED: 0.30,   // fraction of dive that also kills forward speed
  },

  // ── Body-as-trick: hinged panels (§5.1) — the mechanical signature ────────
  PANELS: {
    AIR_ONLY: true,             // §5.1 "deployable only in air"
    MOTOR_STIFFNESS: 620,       // position motor driving the hinge to target
    MOTOR_DAMPING: 58,
    MOTOR_MAX_FORCE: 4200,
    STOW_STIFFNESS: 900,        // stiffer closing than opening: snaps shut
    STOW_DAMPING: 74,
    MASS: 26,                   // per panel
    THICKNESS: 0.05,

    // Tear-off (§5.1 "can be torn off by a bad landing"): spectacle only.
    TEAROFF_ENABLED: true,
    TEAROFF_IMPACT_SPEED: 17.0, // m/s relative impact on a deployed panel
    TEAROFF_ONLY_WHEN_DEPLOYED: true,

    // Per-slot geometry. `hinge` is the hinge point in chassis-local space;
    // `centerOffset` runs from that hinge to the panel's centre in panel-local
    // space. `axis` is the hinge axis (normalised on load) and `open` the
    // motor's fully-deployed angle.
    //
    // The open angles are not arbitrary. tools/probe-aero.mjs measures the
    // angular acceleration each panel actually produces in level flight, and
    // these values are what make the measured effect match §5.1: hood pitches
    // back, trunk pitches forward, one door rolls, both doors brake.
    DOOR_L: {
      size: { x: 0.06, y: 0.52, z: 1.15 },
      hinge: { x: -0.95, y: -0.02, z: -0.55 },
      centerOffset: { x: 0, y: 0, z: 1.15 },
      axis: { x: -0.55, y: 1, z: 0 },        // dihedral: swings out *and* down,
      open: -1.32, limitMin: -1.45, limitMax: 0.02,   // so one door rolls (§5.1)
      cd: 1.28,
      gain: 2.6,
    },
    DOOR_R: {
      size: { x: 0.06, y: 0.52, z: 1.15 },
      hinge: { x: 0.95, y: -0.02, z: -0.55 },
      centerOffset: { x: 0, y: 0, z: 1.15 },
      axis: { x: 0.55, y: 1, z: 0 },
      open: 1.32, limitMin: -0.02, limitMax: 1.45,
      cd: 1.28,
      gain: 2.6,
    },
    HOOD: {
      size: { x: 0.86, y: 0.05, z: 0.80 },
      hinge: { x: 0, y: 0.44, z: -0.35 },    // cowl hinge, front edge lifts
      centerOffset: { x: 0, y: 0, z: -0.80 },
      axis: { x: 1, y: 0, z: 0 },
      open: 1.16, limitMin: -0.02, limitMax: 1.26,   // steep scoop -> nose up
      cd: 1.34,
      // Roll inertia is ~7x smaller than pitch inertia, so matching *authority*
      // means the pitch surfaces need far more gain than the doors.
      gain: 2.8,
    },
    // The tail flap. It hangs *below* the car, and that is the whole trick:
    // every deployable surface above the centre of mass pitches the nose up,
    // whichever way you angle it, because drag above the CoM always does. Only
    // a surface below the CoM can pitch the nose down, so §5.1's "trunk =
    // pitch forward" is a diffuser flap dropping out of the rear underbody,
    // not a lid lifting off the deck. Measured at -1.4 kN·m by probe-aero.
    TRUNK: {
      size: { x: 0.86, y: 0.05, z: 0.70 },
      hinge: { x: 0, y: -0.30, z: 1.20 },
      centerOffset: { x: 0, y: 0, z: 0.62 },
      axis: { x: 1, y: 0, z: 0 },
      open: 1.00, limitMin: -0.02, limitMax: 1.10,
      cd: 1.34,
      gain: 3.0,
    },
    SPOILER: {
      size: { x: 0.80, y: 0.04, z: 0.30 },
      hinge: { x: 0, y: 0.46, z: 2.02 },
      centerOffset: { x: 0, y: 0, z: -0.30 },
      axis: { x: 1, y: 0, z: 0 },
      open: -1.40, limitMin: -1.50, limitMax: 0.02,  // stands up as a fin
      cd: 1.05,
      gain: 1.0,
      MICRO_LIFT: 0.16,          // §5.1 "some variants add micro-lift"
      YAW_STABILISE: 3.1,        // damps yaw+pitch when deployed
    },
  },

  // ── Aerodynamics (what makes the panels actually steer the air) ──────────
  // Real forces on real bodies. No scripted rotation anywhere.
  AERO: {
    AIR_DENSITY: 1.225,
    // Global gain on panel plate drag — "how much do parts matter". Each panel
    // then has its own `gain` on top, because a door out on a long lateral arm
    // and a hood right over the nose do not need the same multiplier to feel
    // like equals. Sized so the hood's pitch authority is a few rad/s², not
    // the 8 rad/s² that the first guess produced.
    PANEL_SCALE: 0.62,
    PANEL_SKIN_DRAG: 0.11,      // tangential drag along the plate
    CHASSIS_CD: 0.62,           // chassis treated as three plates (x/y/z faces)
    CHASSIS_SCALE: 1.0,
    // ── Per-axis stability ─────────────────────────────────────────────
    // Stability and trick authority are the same dial, and a single centre of
    // pressure forces a choice between them: far enough back to land a
    // hands-off jump and *no* panel input can rotate the car at all; far
    // enough forward to trick and it will not settle.
    //
    // The way out is that they do not have to be the same axis. A tail fin
    // stabilises yaw without touching pitch, so the chassis's three drag
    // plates get their own application points:
    //
    //   side force  -> well behind the CoM  = weathercocks, flies nose-first
    //   vertical    -> almost at the CoM    = pitch stays cheap to start/stop
    //   axial drag  -> at CoM height        = no pitch coupling from drag
    //
    // All three are in chassis-local space, measured from the box centre.
    COP_SIDE: { x: 0, y: -0.26, z: 1.05 },
    COP_LIFT: { x: 0, y: -0.26, z: 0.30 },
    COP_AXIAL: { x: 0, y: -0.26, z: 0.00 },

    // Rotational air drag, per axis, in the car's own frame. Yaw is damped
    // hard (a car should not weathervane), pitch and roll lightly, so flips
    // and rolls are cheap to start and cheap to stop.
    // Body lift coefficient. Scaled per car by cars.js `bodyLift`; a long flat
    // body flying nose-first is a low-aspect wing, and NEEDLE is built on it.
    BODY_LIFT: 0.42,
    ANG_DRAG: { pitch: 0.34, yaw: 1.15, roll: 0.30 },

    // Pillar 1 enforcement. Summed aero force may never push the car up by
    // more than this fraction of its own weight. Gravity always wins, by
    // construction rather than by hoping the tuning holds.
    MAX_LIFT_FRACTION_OF_WEIGHT: 0.55,
    // A true safety clamp. At 9000 N it was binding during ordinary flight,
    // so the hood's authority silently stopped responding to any tuning at all.
    MAX_PANEL_FORCE: 24000,     // N, per panel
    // Where panel drag is applied. 'panel' is the honest path: force hits the
    // panel body and reaches the chassis through the hinge, so a door really
    // does lever the car. 'chassis' applies it at the panel's world position
    // instead — steadier, less alive. Kept as a knob in case the solver
    // complains on low-end hardware.
    // 'chassis' — measured, not assumed. Routing panel drag through the hinge
    // means the motor's limit stop absorbs most of it and hands back a
    // reaction torque of the opposite sign, so the hood pitched the car the
    // wrong way and open doors *pumped* a tumble instead of damping it.
    // Applying each panel's force at that panel's own world position gives the
    // geometry its say and the solver nothing to fight. The panels are still
    // real jointed bodies; they just do not have to carry the load.
    APPLY_TO: 'chassis',        // 'panel' | 'chassis'
  },

  // ── Airtime detection (§3 / item 3) ──────────────────────────────────────
  AIRTIME: {
    COYOTE_TIME: 0.055,         // all wheels off this long before "airborne"
    LAND_GRACE: 0.045,          // wheels back on this long before "landed"
    LAUNCH_MIN_SPEED: 9.0,      // §6 "above-threshold velocity" to arm the camera
    LAUNCH_MIN_UP_VEL: 1.6,     // must actually be going up, not driving off a kerb
    MIN_LOGGED_AIRTIME: 0.30,   // shorter hops are not jumps, not logged

    // Landing quality (§3.1). Angle between chassis up and the contact normal.
    PERFECT_ANGLE: 0.140,       // 8°
    CLEAN_ANGLE: 0.349,         // 20°
    SLOPPY_ANGLE: 0.611,        // 35°
    PERFECT_MIN_WHEELS: 4,
    CLEAN_MIN_WHEELS: 3,
    BOUNCE_VEL: 5.0,            // downward m/s above which a landing "bounced"
    SETTLE_TIME: 0.45,          // window in which the landing must settle
    CRASH_ROOF_ANGLE: 1.92,     // ~110° — past this you are on your roof
    // A resting contact in Rapier sits at roughly zero depth, not deep
    // penetration, so this is a "touching" threshold. It still rejects the
    // broad-phase pairs that made every landing near a ramp read as a crash.
    CHASSIS_CONTACT_DEPTH: 0.01,
    CHASSIS_CRASH_TIME: 0.20,   // chassis grounded this long with no wheels = crash
    // Two different questions need two thresholds. "Is the car resting on its
    // roof" is answered by mere contact; "did the floorpan strike the deck" is
    // not — a hard but legitimate landing compresses the suspension enough to
    // graze, and treating that as a strike marked clean sticks as crashes.
    CHASSIS_CRASH_DEPTH: -0.06,
  },

  // ── Traffic (§4) ─────────────────────────────────────────────────────────
  // Both behaviours ship. Ambient is the accessibility / party toggle;
  // Reactive is Burnout's texture and the funnier default.
  TRAFFIC: {
    MODE: 'reactive',           // 'reactive' | 'ambient'   (Options, §2.1)
    // Spread over the yard's six lanes, 44 cars is one every 74 m — a player
    // can drive a whole approach and meet two. §4 wants traffic to *be* the
    // boost economy, which needs enough of it to weave through.
    COUNT: 76,                  // vehicles alive at once
    SPEED: [14, 26],            // m/s range, rolled per vehicle from the seed
    HALF: { x: 0.92, y: 0.78, z: 2.20 },
    MASS: 1400,

    // Near-miss (§4) — the main boost earn.
    // Centre to centre. Two cars are ~2 m wide each, so 6.5 m is about four
    // metres of air — close enough to flinch at, and at 5.5 a clean lane pass
    // at speed missed it by 20 cm and never paid.
    NEAR_MISS_RADIUS: 6.5,
    NEAR_MISS_MIN_SPEED: 22,    // m/s; crawling past a bus is not a near miss
    NEAR_MISS_REARM: 2.5,       // seconds before the same vehicle can pay again
    ONCOMING_DOT: -0.35,        // player heading vs lane direction to count
    ONCOMING_LANE_HALF: 5.5,    // how close to the lane centre you must be

    // Reactive only.
    // Late and small. Panicking early and swerving hard means the player can
    // never actually get near a car, and near-miss is the whole boost economy.
    REACT_RADIUS: 17,
    SWERVE: 1.8,                // metres of lateral panic
    SWERVE_RATE: 2.6,
    BRAKE: 0.55,                // fraction of speed shed when panicking
    HONK_RADIUS: 13,           // one honk per approach, not per frame

    // §4: "a car landing on traffic is a Moving-vehicle-tier stick; traffic
    // clipping you mid-air is a crash."
    ROOF_TOLERANCE: 1.6,        // how far above the roof still counts as on it
    MIDAIR_CLIP_IS_CRASH: true,
  },

  // ── Scoring: the facet grammar (R1) ──────────────────────────────────────
  // The reference did not ask "what trick was that". It asked how many
  // different things were true at once, then multiplied brutally. Doing one
  // thing beautifully is worth a little; doing seven at once and surviving is
  // worth an absurd amount. That curve is the whole design.
  SCORE: {
    // Per-facet base values. Deliberately flat relative to each other — the
    // *count* is what pays, not any single facet.
    FACET: {
      FLIP: 150, ROLL: 150, SPIN: 100,
      TWIST: 220, TWIST_TIME: 0.45,     // seconds with two axes turning at once
      INVERT: 120, INVERT_ANGLE: 1.75,  // radians of tilt (~100 deg)

      BIG_AIR: 120, BIG_AIR_TIME: 2.4, BIG_AIR_PER_SEC: 90,
      HIGH: 140, HIGH_M: 18,
      FAR: 120, FAR_M: 95, FAR_PER_M: 2.2,
      GAP: 200, GAP_LAUNCH_Y: 4.5,       // launched raised, landed raised
      TRANSFER: 260,                     // landed on a different structure

      WHEELIE: 120, ENDO: 160, TWO_WHEEL: 200,
      GROUND_TIME: 0.6, GROUND_PER_SEC: 60,
      GROUND_MIN_SPEED: 9,        // a wheelie at walking pace is not a wheelie
      WHEELIE_ANGLE: 0.13, ENDO_ANGLE: 0.13,

      NEAR_MISS: 90,
      PURITY: 260,                       // the facet itself; the multiplier is below
    },

    // Facet count -> multiplier and the name it earns. Flat at the bottom so a
    // single clean trick is not punished, steep from four so that stacking is
    // always the strongest thing available.
    FACET_MULT: [
      { mult: 1.0, name: null },
      { mult: 1.5, name: null },
      { mult: 2.5, name: 'TRIPLE' },
      { mult: 4.0, name: 'QUAD' },
      { mult: 6.0, name: 'WILD' },
      { mult: 9.0, name: 'SAVAGE' },
      { mult: 13.0, name: 'INSANE' },
      { mult: 22.0, name: 'MYTHIC' },
      { mult: 30.0, name: 'LEGENDARY' },
      { mult: 42.0, name: 'IMPOSSIBLE' },
    ],

    // Purity (RAW / TOUCHED / FLOWN). Counts only the *stabilising* verbs —
    // the thrust burst, both doors as an air brake, the wing — because our
    // bodywork also creates rotation, and charging for that would make the
    // trick generator the thing that costs you.
    PURITY: {
      RAW: 2.2, RAW_SECONDS: 0.2,
      TOUCHED: 1.5, TOUCHED_SECONDS: 1.0, TOUCHED_BURSTS: 1,
      FLOWN: 1.0,
    },

    EXTRA_ROTATION: 0.60,       // each rotation past the first, per axis
    ROTATION_GRACE: 0.12,       // radians; 353 degrees reads as a 360
    TWIST_RATE: 1.1,            // rad/s an axis must exceed to count as turning

    POSE_PER_SEC: 50,           // held bodywork, per part per second
    POSE_MIN_TIME: 0.20,

    COIN_VALUE: 25,             // flat, outside the bank (routes pay twice)
    COIN_RADIUS: 4.5,

    // Landing multipliers live with the tiers they multiply:
    // LANDING_MULT in sim/airtime.js, TIER in arena/stunt-park.js.
    MEDAL: { bronze: 25000, silver: 70000, gold: 150000, platinum: 320000 },
  },

  // ── Modes (§9) ───────────────────────────────────────────────────────────
  MODES: {
    SHOT: {
      CONE: 0.75,               // radians; how far off the nose a call can be
      RANGE: 260,
      MULTIPLIER: 2.5,          // §9 "hit it for a multiplier"
    },
    STANDING: {
      LIVES: 1,                 // §9 "crash and you're out"
    },
    POTATO: {
      PERIOD: 20,               // §9 "relocates every 20s"
      MULTIPLIER: 2.0,
    },
    PARTY: {
      TURN_SECONDS: 45,         // §9 pass-the-pad
      MAX_PLAYERS: 4,
      GRID_GAP: 7.5,            // lateral spacing on the starting grid
    },
  },

  // ── Recovery (§3: "Repeat until timer ends") ─────────────────────────────
  // The reference puts you back on the road; §4 is explicit that a crash is
  // spectacle and "never a punishment screen". Without this a single bad
  // landing ends the run eighty seconds early with the car on its roof.
  // Named gaps (R6). Generated by `npm run gaps` into arena/gaps.generated.js
  // and matched at runtime by proximity at both ends of the flight.
  GAPS: {
    MATCH_RADIUS: 30,     // metres, applied at both the launch and the landing
    // Vertical City stacks decks nine metres apart, so the vertical tolerance
    // has to be tighter than the horizontal one or a gap onto the top deck
    // matches the same flight two storeys down.
    MATCH_HEIGHT: 7,
    FIRST_BONUS: 4000,    // discovering one, once, ever
    BONUS: 900,           // flying one you already know
  },

  RESPAWN: {
    DELAY: 1.35,                // after the crash cam has had its moment
    STUCK_SPEED: 3.0,           // m/s below which a wrong-way-up car is stuck
    STUCK_TILT: 1.15,           // radians from upright
    STUCK_TIME: 1.6,
    APPROACH: 62,               // metres back from the ramp we drop you at
    SPEED: 16,                  // rolling restart, not a standing one
  },

  // ── Run (§3: one run, 90-120 seconds) ────────────────────────────────────
  RUN: {
    DURATION: 90,
    // R4: long enough to read GO, short enough not to be downtime.
    COUNTDOWN: 1.2,
    // A landing keeps the chain alive if the next launch comes soon enough.
    COMBO_WINDOW: 6.0,
    COMBO_STEP: 0.25,           // +25% per landed stick in the chain
    COMBO_MAX: 3.0,
  },

  // ── Dynamic airtime camera (§6) — the delta, part B, THE GATE ────────────
  CAMERA: {
    STYLE: 'cinematic',         // 'cinematic' | 'classic'  (§6 Options toggle)

    FOV_BASE: 60,
    LOOK_HEIGHT: 1.5,           // aim this far above the car's origin
    NEAR: 0.25,
    FAR: 2400,

    // Output smoothing. Applied after behaviour crossfade so a switch can
    // never produce a cut (§6 "never cut, always ease").
    POS_SMOOTH: 0.085,          // smoothdamp time constant, seconds
    LOOK_SMOOTH: 0.070,
    FOV_SMOOTH: 0.160,

    BLEND_TO_AIR: 0.34,         // crossfade in on launch
    BLEND_TO_GROUND: 0.25,      // §6 "0.25s blend back to chase on touchdown"
    BLEND_BEHAVIOUR: 0.40,      // orbit → chase etc. mid-air

    // Chase-pullback (default, §6)
    CHASE: {
      GROUND_OFFSET: { x: 0, y: 3.60, z: 11.60 },  // behind car, in heading space
      // Look-ahead is how far past the car the camera aims. Large values put
      // the car at the bottom of the frame and fill the shot with sky.
      GROUND_LOOK_AHEAD: 3.5,
      AIR_OFFSET: { x: 0, y: 6.60, z: 19.50 },     // "eases back and up"
      AIR_LOOK_AHEAD: 2.5,
      PULLBACK_TIME: 0.55,      // how long the ease back takes
      FOV_AIR: 76,              // "wider FOV"
      HEADING_SMOOTH: 0.30,     // camera yaw follows velocity heading, lazily
      MIN_GROUND_HEIGHT: 0.85,  // never clip through the deck
    },

    // Orbit (§6, on big airtime)
    ORBIT: {
      MIN_PREDICTED_AIRTIME: 2.0,  // §6 "> 2s"
      RADIUS: 13.5,
      HEIGHT: 4.4,
      REVOLUTIONS: 1.0,            // §6 "orbits the car once"
      START_PHASE: 0.10,           // fraction of hang time before it starts
      END_PHASE: 0.78,             // then resumes chase on descent
      FOV: 70,
      DIRECTION: 1,                // +1 or -1; flipped by launch yaw sign
    },

    // Landing-target lock (§6)
    TARGET_LOCK: {
      FORWARD_CONE: 0.62,          // rad half-angle of the forward cone
      MAX_RANGE: 190,
      SIDE_OFFSET: 12.0,           // camera stands off to the side of car→target
      HEIGHT: 7.5,
      FRAME_BIAS: 0.34,            // 0 = frame car, 1 = frame target
      RANGE_STANDOFF: 0.10,        // extra stand-off per metre of gap
      RANGE_HEIGHT: 0.09,          // extra height per metre of gap
      DOLLY_ZOOM: true,            // §6 "dolly-zooms on approach"
      DOLLY_FOV_NEAR: 46,
      DOLLY_FOV_FAR: 78,
      DOLLY_RANGE: 62,             // distance over which the vertigo runs
    },

    // Garage live preview (§2.1: "one fixed cinematic angle, ~4s")
    // Measured from the garage ramp: airborne z=-16 to z=-67, apex 14.3 m at
    // z=-34. The angle frames that arc three-quarters on.
    PREVIEW: {
      START: { x: -235, y: 1.08, z: 62 },
      EYE: { x: -188, y: 17.0, z: -16 },
      LOOK: { x: -235, y: 10.0, z: -36 },
      FOV: 46,
      SKIP: 2.0,                // skip most of the run-up; §2.1 wants ~4s
      SECONDS: 5.7,
    },

    // Free cam (§2.1 replay theater)
    FREE: { SPEED: 26, BOOST: 3.2, TURN: 1.5 },

    // Showcase / menu camera (§2.1: the car is centre-stage behind the menu)
    SHOWCASE: { RADIUS: 12.5, HEIGHT: 3.4, SPEED: 0.17, FOV: 40, BIAS_X: 6.0 },

    // Speed sense (§4)
    FOV_SPEED_KICK: 17,         // extra degrees at top speed
    FOV_BOOST_KICK: 7,
    SHAKE_START_SPEED: 30,      // m/s
    SHAKE_MAX: 0.16,            // metres of positional jitter at top speed
    SHAKE_FREQ: 24,

    // Crash cam stub (§4 — full version lands with item 11)
    CRASH_SLOWMO: 0.28,
    CRASH_SLOWMO_TIME: 1.10,
  },

  // ── Arena: stunt park gray box (§10a) ────────────────────────────────────
  ARENA: {
    GROUND_SIZE: 620,
    GROUND_FRICTION: 1.0,
    GROUND_RESTITUTION: 0.05,
    SPAWN: { x: 0, y: 1.08, z: 170 },   // long run-up: the hero jump needs speed
    SPAWN_HEADING: 0,           // radians; 0 faces -Z, down the hero run-up
    RESET_HEIGHT: -30,          // fell off the world
    HERO_RAMP_ID: 'hero',       // the ramp the Gate A demo jump uses
  },

  // ── Wear (R7's debts): deformation, and session-long scuffing ────────────
  // The split is a §R requirement. Deformation changes the aerodynamics, so
  // it is derived from a run's own inputs and lives for one run; scuffing is
  // paint, so it costs the simulation nothing and lives for a session.
  WEAR: {
    // Panel strain, in m/s of panel-vs-chassis relative speed. TEAROFF_IMPACT
    // _SPEED is where a panel leaves entirely, so BEND_FULL sits just under
    // it: a panel that nearly came off is nearly ruined.
    // Measured, not guessed: a routine hard landing on a deployed spoiler
    // strains the hinge at ~12 m/s, and that is not "nearly came off" — at
    // BEND_FROM 6 it bent every panel on every landing and the scripted
    // capture jump stopped landing at all. The window is the top of the
    // range, just under tear-off, which is what the sentence above always
    // meant.
    BEND_FROM: 13.5,
    BEND_FULL: 17.0,
    BEND_PER_HIT: 0.45,
    // How far a bent hinge rests open, as a fraction of that panel's own open
    // angle. A door that will not shut is a permanently deployed aero
    // surface, which is the whole physical point of the system.
    SAG_FRACTION: 0.30,

    SCUFF_MIN: 0.12,        // below this an impact leaves no mark at all
    SCUFF_GAIN: 0.55,       // of the *remaining* clean paint, per hit
    SCUFF_DARKEN: 0.72,     // how far a fully scuffed region's trim goes out
  },

  // ── Brake heat (R7) ──────────────────────────────────────────────────────
  // A temperature, not a light bulb: it lags the pedal, keeps glowing while
  // you accelerate away, and stacks across a series of small brakes.
  BRAKES: {
    // Measured, not guessed. At the first numbers the discs settled at 0.04
    // of capacity under a full stop from 55 m/s and never once crossed the
    // glow threshold — a brake glow that cannot glow. These put a hard stop
    // from motorway speed at about three quarters of capacity, and leave
    // nearly half of it a second after the pedal comes up.
    CAPACITY: 80,           // brake·(m/s)·s to saturate the discs
    COOL: 0.35,             // per second, proportional to heat above ambient
    AIRFLOW_COOL: 0.45,     // extra cooling at speed
    AIRFLOW_FULL: 45,       // m/s at which airflow cooling is at full
    GLOW_FROM: 0.22,        // below this the discs are dark
  },

  // ── Breakable props (R7) ─────────────────────────────────────────────────
  PROPS: {
    MASS: 26,
    BREAK_SPEED: 9,         // below this nothing moves, deliberately
    FULL_SPEED: 40,         // where a hit throws a prop as hard as it goes
    REACH: 1.4,             // metres of slop around the chassis box
    BUDGET: 24,             // dynamic bodies at once. The frame rate is a feature
    THROW: 0.55,
    LIFT: 6.5,
  },

  // ── Active billboards (R7) ───────────────────────────────────────────────
  // Brightness is "land here" language, so a sign is bright in proportion to
  // how much it currently *is* a landing target for the car looking at it.
  SIGNS: {
    IDLE: 0.16,             // the arena's ordinary billboard glow
    LIVE: 0.85,             // lined up, in range, in the air
    CONE: 0.55,             // cos of the angle a flight counts as aimed
    NEAR: 25,
    FAR: 140,
    FLASH_TIME: 0.12,       // the art brief's photosensitivity cap, exactly
    DECAY_TIME: 0.9,
  },

  // ── The PA (R7) ──────────────────────────────────────────────────────────
  // Not an announcer: a room. A tannoy two hundred metres away, band-limited
  // to a telephone, syllabic rather than semantic.
  PA: {
    ARENAS: ['city'],       // a stunt park in a void has nobody to announce
    LEVEL: 0.34,
    RATE: 5.2,              // syllables per second
    ATTACK: 0.05,
    RELEASE: 0.22,
    COOLDOWN: 4.5,          // seconds of silence it owes after every call
    CAR_DUCK: 0.6,          // how far a busy car pushes the PA down
    BED_DUCK: 0.45,         // how far the PA pushes the crowd and music down
    FORMANT_LOW: 520,
    FORMANT_HIGH: 1150,
    HUGE: 18000,           // a stick worth announcing
  },

  // ── Render / art (§11 Art gate) ──────────────────────────────────────────
  // Particles and screen effects (R7). Every one of these is a *response* to
  // something the simulation did, so the numbers are rates and lifetimes
  // rather than art direction.
  FX: {
    MAX_PARTICLES: 3000,   // one pooled buffer, never reallocated
    SMOKE_RATE: 90,        // particles per second at full slip
    SMOKE_LIFE: 1.1,
    SPARK_LIFE: 0.55,
    DEBRIS_MIN: 6,
    DEBRIS_MAX: 34,
    DEBRIS_LIFE: 1.5,
    DUST_LIFE: 0.75,
    FLAME_RATE: 140,
    FLAME_LIFE: 0.22,
    SLIP_THRESHOLD: 0.16,  // radians of slip before the tyres start smoking
    SCRAPE_SPARKS: 5,      // per frame while the chassis is grinding
    SHAKE_DECAY: 0.45,     // seconds for a shake to die away
    SHAKE_AMPLITUDE: 0.55, // metres at full severity
    LANDING_SHAKE: 26,     // impact m/s that produces a full-strength shake
    // Speed lines: a screen-space streak field that arrives with speed.
    LINES_FROM: 34,        // m/s at which streaks begin
    LINES_FULL: 78,        // m/s at which they are at full strength
    LINES_MAX_OPACITY: 0.62,
  },

  // ── AFTERGLOW smear (airtime-art-direction.md: geometry, never blur) ─────
  // These are rates, lifetimes and thresholds; the colours live in
  // src/render/theme.js. Everything here is a *response* to motion.
  TRAILS: {
    RIBBON_LIFE: 1.5,          // seconds a trail ribbon takes to fade
    RIBBON_POINTS: 44,         // ring buffer per emitter
    RIBBON_MIN_DIST: 0.35,     // metres between samples
    RIBBON_WIDTH: 0.22,        // metres, half-width at full strength
    RIBBON_MIN_SPEED: 14,      // m/s before wheels start writing light
    // Light dissolves as it nears the lens: a 0.2m-wide ribbon two metres
    // from the camera is a screen-filling slab. probe:dark measured the hero
    // landing at 79% dark before this; ablation put ALL of the violation on
    // ribbon mass inside ~12m of the camera, so the fade reaches 14m and the
    // worst frame comes back at 92% with no width given up.
    LENS_FADE: 14,             // metres over which trail light fades to nothing
    PANEL_DEPLOY_MIN: 0.5,     // deploy fraction before a panel edge writes
    // Rotation ghosts — the flip made visible.
    GHOST_SPIN: 3.2,           // rad/s of |angvel| that spawns shells
    GHOST_EVERY: 0.11,         // seconds between shells while spinning
    GHOST_LIFE: 0.42,          // seconds a shell takes to fade
    GHOST_MAX: 3,              // live shells per player
    // Velocity stretch on the emissive trim.
    STRETCH_FROM: 26,          // m/s where the trim starts to smear
    STRETCH_FULL: 62,          // m/s of full elongation
    STRETCH_MAX: 1.35,         // metres of elongation at full speed
    // Landing splash. The white-hot core obeys the photosensitivity rule:
    // no flash longer than SPLASH_FLASH seconds, ever (release spec §A).
    SPLASH_FLASH: 0.12,
    SPLASH_LIFE: 0.55,         // the expanding ring outline, not a flash
    SPLASH_RADIUS: 9,          // metres at full expansion, scaled by tier
    DECAL_LIFE: 90,            // seconds a Perfect's burn mark survives
    // Persistent lines — the art direction itself: the arena accumulates
    // everyone's flights over a round.
    LINE_LIFE: 75,             // seconds an arc glows after it is flown
    LINE_MIN_SCORE: 400,       // landings below this leave no mark
    LINE_OPACITY: 0.55,
    // Reduce Effects (release spec §A): caps, not a different game.
    REDUCED_RIBBON_POINTS: 18,
    REDUCED_SPLASH_SCALE: 0.4,
  },

  RENDER: {
    // Default look. AFTERGLOW is the direction (airtime-art-direction.md);
    // graybox stays the honest one for judging physics and framing.
    STYLE: 'afterglow',         // 'afterglow' | 'graybox'
    SHADOWS: true,
    SHADOW_MAP: 2048,
    PIXEL_RATIO_CAP: 2,
    EXPOSURE: 1.0,
    FOG_NEAR: 180,
    FOG_FAR: 900,
    WIND_STREAKS: 220,          // speed-sense particles
    STREAK_MIN_SPEED: 26,
  },

  // ── Replay (§6.1) ────────────────────────────────────────────────────────
  REPLAY: {
    // "Every landing over a score threshold auto-saves; nothing is lost."
    // A typical good landing in a first run is worth 200-400, so a threshold
    // above that saves nothing and the theater stays empty.
    AUTOSAVE_SCORE: 240,
    PREROLL: 3.2,               // seconds of run-up kept before the launch
    POSTROLL: 2.0,              // and of run-out after the landing
    MAX_CLIPS: 24,              // per profile, newest kept
    EXPORT_FPS: 30,
    EXPORT_BITRATE: 8_000_000,
  },

  // ── Audio (§10 airtime signature sound) ──────────────────────────────────
  // Synthesised, so these are the actual voices rather than file names.
  AUDIO: {
    ENGINE_GAIN: 0.10,
    AIR_ENGINE: 0.05,           // §10: the engine cuts to wind at launch
    BOOST_LIFT: 1.3,
    IDLE_HZ: 46,
    REDLINE_HZ: 132,
    GEARS: 6,                   // faked, so pitch resets and speed stays audible
    WIND_GAIN: 0.13,
    SCRUB_GAIN: 0.09,

    // R7. The handoff at the lip is the single loudest idea in the audio: the
    // road and the engine drop out and wind and mechanical stress take over.
    // Asymmetric time constants — out fast so the lip is an event, in slightly
    // slower so a landing is not a click.
    ROAD_GAIN: 0.16,
    HANDOFF_OUT: 0.06,          // seconds, ground voices -> air voices
    HANDOFF_IN: 0.10,           // seconds, coming back
    STRESS_GAIN: 0.085,         // hinges and bodywork under load, airborne only

    // The room, and the bed it sits over.
    CROWD_GAIN: 0.10,
    CROWD_BED: 0.16,            // always-on murmur
    CROWD_DECAY: 2.4,           // seconds for a reaction to subside
    MUSIC_GAIN: 0.055,
    MUSIC_BED: 1.0,
    MUSIC_HZ: 55,               // root of the pad
    // "Sticking a 50,000-point stunt and the soundtrack briefly ducks
    // underneath the landing sound. That's premium feel."
    DUCK_FULL_PAYOUT: 45000,    // payout at which the duck is at full depth
    DUCK_FLOOR: 0.22,           // deepest the bed goes
    DUCK_HOLD: 0.75,            // seconds held down before recovering
    DUCK_ATTACK: 0.05,
    DUCK_RELEASE: 0.55,
  },

  // ── UI (§2.1 connective tissue) ──────────────────────────────────────────
  UI: {
    TRANSITION: 0.26,           // §2.1: every transition <= 300ms, eased
    ATTRACT_IDLE: 10,           // §2.1: title demos itself after 10s idle
    RESULT_REEL_DELAY: 1.2,     // beat before the highlight reel auto-plays
    TICKER_LIFE: 2.6,           // how long a named trick stays on the ticker
    TICKER_MAX: 5,
    REEL_CLIPS: 3,              // §9: the top three landings of the round
    REEL_MIN_SCORE: 400,
    REEL_SOLO_SCORE: 12000,     // solo, only interrupt for something worth seeing
  },

  // ── HUD (Gate A diagnostics) ─────────────────────────────────────────────
  HUD: {
    AIRBORNE_FADE: 0.5,         // §2.1 "HUD fades 50% when airborne"
    FADE_TIME: 0.30,
    SHOW_TELEMETRY: true,
  },

  // ── Input ────────────────────────────────────────────────────────────────
  INPUT: {
    GAMEPAD_DEADZONE: 0.16,
    TRIGGER_DEADZONE: 0.06,
    KEYBOARD_STEER_RATE: 4.2,   // how fast a key press ramps a virtual axis
    KEYBOARD_STEER_RETURN: 7.5,
    AIR_CURVE: 0.55,            // stick -> panel deployment; <1 opens early
    MENU_DEADZONE: 0.55,        // a stick has to be pushed, not nudged, in menus
    MENU_REPEAT_DELAY: 0.42,
    MENU_REPEAT_RATE: 0.12,
  },

  // ── Telemetry (§0.1 pillar 3: "Build logs landing rate per session") ─────
  TELEMETRY: {
    ENABLED: true,
    TARGET_LANDING_RATE_NEW: 0.25,   // ~1 in 4
    TARGET_LANDING_RATE_HOUR: 0.75,  // ~3 in 4
    LOG_TO_CONSOLE: false,
  },
};

export default TUNING;
