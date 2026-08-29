# AIRTIME — Art Direction Brief: AFTERGLOW

Replaces the graybox-vs-lowpoly art gate. One direction, executed with no seams.

## The look, in one sentence

A dark world where speed and rotation are the only light sources — exotic cars
dragging ribbons of magenta, pink, electric blue and acid green through
near-black arenas, so every jump paints the air and every landing leaves a mark.

## Why this direction (design logic, not taste)

**Error-absorbent.** Emissive edges + darkness hide imperfect models better
than flat shading. An exotic car silhouette with glowing trim reads as style
even when the mesh is crude.

**Clip-native.** Rotation becomes *visible as ribbons* — a tumbling car in 9:16
reads instantly because its motion is drawn in light. The game's signature
mechanic gets a signature image.

**Persistent lines, promoted.** The earlier "jumps leave glowing trails" idea
is no longer a feature — it IS the art direction. The arena accumulates
everyone's lines over a round; best landings burn a permanent mark on the
target.

## Palette tokens (put in TUNING or a THEME object, no hex anywhere else)

| token     | role                      | value (start point) |
|-----------|---------------------------|---------------------|
| VOID      | world base / sky          | `#0A0A12`           |
| ASPHALT   | ground, unlit geometry    | `#16161F`           |
| MAGENTA   | player 1 / primary trail  | `#FF2E9A`           |
| PINK      | heat, boost, crash        | `#FF6EC7`           |
| BLUE      | player 2 / UI primary     | `#2E9AFF`           |
| GREEN     | player 3 / perfect landing| `#39FF88`           |
| VIOLET    | player 4 / secrets        | `#9A2EFF`           |
| WHITE-HOT | landing hit, score punch  | `#F4F4FF`           |

Rules: VOID/ASPHALT own ≥85% of any frame. Neon is *earned* — it comes from
motion, deployment, and payout, never from static decoration. Traffic is dim;
players are bright. Each split-screen player owns one accent color end-to-end
(car trim, trail, HUD, reel chyron).

## Rendering approach — smear, not blur (integrated-GPU rule)

Target hardware has no dedicated GPU. No screen-space motion blur, no heavy
post stack. The smear is built from cheap geometry and shaders:

- **Trail ribbons** — camera-facing triangle strips from each wheel + each
  deployed panel edge, emissive, fading over ~1.5s (persistent-line variant
  fades over the round). Cost: trivial.
- **Velocity stretch** — vertex shader elongates the car's emissive trim along
  velocity above a speed threshold. Fake blur that reads better than real blur.
- **Rotation ghosts** — when |angular velocity| spikes, spawn 2–3 fading
  emissive shells of the car silhouette. This is the flip made visible.
- **Bloom, cheap** — single half-res additive pass on emissives only, or faked
  with pre-blurred sprite glows if the pass misses frame budget.
- **Landing splash** — WHITE-HOT ring + spark sprites scaled by landing tier;
  Perfect burns a lasting decal in the player's color.

Speed-sense (§4) recolors: FOV kick unchanged; "motion blur streaks" become
edge-of-screen ribbon streaks in the player color.

## Cars

Exotic-turn silhouettes: low, wide, hinged drama — scissor doors, big wings,
long tails. Bodies near-black with emissive cut-lines (trim, vents, wheel
rings) in player color. Panels get brighter when deployed — steering the air
literally lights up.

## Arenas

Stunt park = void-space arcade construct: ramps as dark slabs with emissive
edge-strips (edge color encodes ramp grade). City = lightless city at night,
windows sparse, billboards as the only bright objects (they're landing targets
— brightness = "land here" language). Coins are small floating lights defining
the authored lines through the dark.

## UI / type

UI inherits VOID + player color + WHITE-HOT. One display face for numerals
(score, timer), one text face, both with proper licenses (see release spec §L).
Trick ticker punches in WHITE-HOT and decays to player color.

## Accessibility guardrails (binding, see release spec §A)

- **Reduce Effects** toggle: caps trail count, kills rotation ghosts and
  bloom, dims landing splash. Must exist same day the look ships.
- Photosensitivity: no full-screen flashes >3/sec; landing splash ≤120ms;
  crash strobe forbidden.
- Player colors must survive the three common colorblind axes — ship the
  alternate palette behind the existing colorblind option (shape-coded trails:
  solid/dashed/dotted/chevron as backup channel).

## Art gate (replaces old one)

Render the deterministic hero jump in AFTERGLOW and judge on footage:

- Rotation readable as ribbons in a 9:16 crop viewed on a phone at arm's length.
- Landing tier distinguishable with HUD hidden (splash + mark language alone).
- ≥85% dark frame rule holds at the busiest moment (4 players, reactive traffic).
- Perf: 60fps on an integrated-GPU machine, 1080p, single player; ≥45fps 4-way
  split. Measured by `probe:perf`, not eyeballed.
- Reduce Effects mode still reads as the same game.

## Handoff order

1. THEME tokens + trail ribbons + velocity stretch on the existing build.
2. Rotation ghosts + landing splash/decals + emissive ramp edges.
3. Car trim pass (3 archetypes) + arena dressing + UI recolor.
4. `probe:perf` + Reduce Effects + colorblind palette.
5. Re-render all capture clips + screens in AFTERGLOW. Gate on footage.
