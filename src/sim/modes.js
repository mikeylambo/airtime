/**
 * Modes (§9).
 *
 * Every mode is the same loop — drive, launch, trick, land — with one rule
 * bolted on. So a mode here is a handful of hooks, not a separate game:
 *
 *   init(sim)                    once, when the round starts
 *   update(dt, sim)              per fixed step
 *   onLaunch(player, launch, sim)
 *   onLanded(player, result, sim) -> result   may rewrite the payout
 *   isOver(sim)                  early finish
 */

import TUNING from '../TUNING.js';
import { makeRng } from './mathx.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** §9 Stunt: "most points in a timed round. The Rush rule." */
const stunt = {
  id: 'stunt',
  label: 'STUNT',
  arena: 'park',
  rules: 'Most points in a timed round. The Rush rule.',
};

/**
 * §9 Call Your Shot: "pick a tagged landing target before launch; hit it for
 * a multiplier."
 *
 * The call is made on the ground, from the targets actually ahead of you, so
 * choosing one is a route decision rather than a menu.
 */
const shot = {
  id: 'shot',
  label: 'CALL YOUR SHOT',
  arena: 'city',
  rules: 'Name a landing target before you launch. Hit it for a multiplier; miss it and the bank pays flat.',

  init(sim) {
    for (const p of sim.players) p.calledTarget = null;
  },

  update(dt, sim) {
    for (const p of sim.players) {
      // On the ground, the call follows the nearest tagged target in front.
      if (p.airborne) continue;
      const t = nearestAhead(sim.park, p, TUNING.MODES.SHOT.CONE, TUNING.MODES.SHOT.RANGE);
      p.calledTarget = t ? t.id : null;
    }
  },

  onLanded(player, result, sim) {
    const called = player.launchCall;
    if (!called) return result;
    if (result.landed && result.target === called) {
      const m = TUNING.MODES.SHOT.MULTIPLIER;
      return { ...result, called, calledHit: true, payout: Math.round(result.payout * m),
               total: Math.round(result.payout * m) + result.coins, calledMult: m };
    }
    return { ...result, called, calledHit: false };
  },

  onLaunch(player) { player.launchCall = player.calledTarget; },
};

/** §9 Last Car Standing: "crash and you're out; last car live wins." */
const standing = {
  id: 'standing',
  label: 'LAST CAR STANDING',
  arena: 'park',
  rules: 'Crash and you are out. Last car live wins.',

  init(sim) { sim.modeState = { lives: TUNING.MODES.STANDING.LIVES }; },

  onLanded(player, result, sim) {
    if (result.landed) return result;
    player.lives = (player.lives ?? TUNING.MODES.STANDING.LIVES) - 1;
    if (player.lives <= 0) {
      player.run.eliminate(sim.round.elapsed);
      sim.events.push({ type: 'eliminated', player: player.index });
    }
    return result;
  },

  isOver(sim) {
    const alive = sim.players.filter((p) => p.run.alive);
    return sim.players.length > 1 ? alive.length <= 1 : alive.length === 0;
  },
};

/**
 * §9 Hot Potato: "one marked landing zone relocates every 20s; only landings
 * inside it score."
 */
const potato = {
  id: 'potato',
  label: 'HOT POTATO',
  arena: 'city',
  rules: 'One marked zone, relocating every 20 seconds. Only landings inside it score.',

  init(sim) {
    const rng = makeRng((TUNING.SIM.SEED ^ 0x0a70) >>> 0);
    const pool = sim.park.targets.filter((t) => t.tagged !== false);
    sim.modeState = { rng, pool, zone: null, t: 0, index: -1 };
    move(sim);
  },

  update(dt, sim) {
    const s = sim.modeState;
    s.t += dt;
    if (s.t >= TUNING.MODES.POTATO.PERIOD) { s.t = 0; move(sim); }
  },

  onLanded(player, result, sim) {
    const zone = sim.modeState.zone;
    if (result.landed && zone && result.target === zone.id) {
      const m = TUNING.MODES.POTATO.MULTIPLIER;
      return { ...result, inZone: true, payout: Math.round(result.payout * m),
               total: Math.round(result.payout * m) + result.coins };
    }
    // Outside the zone the bank simply does not pay. That is the whole mode.
    return { ...result, inZone: false, payout: 0, total: result.coins };
  },
};

function move(sim) {
  const s = sim.modeState;
  if (!s.pool.length) return;
  let i = s.index;
  for (let k = 0; k < 8 && i === s.index; k++) i = Math.floor(s.rng() * s.pool.length);
  s.index = i;
  s.zone = s.pool[i];
  sim.events.push({ type: 'zone', zone: s.zone.id, aim: s.zone.aim });
}

/** §9 Party is a shell around Stunt: split-screen or one pad, same rules. */
const party = {
  id: 'party',
  label: 'PARTY',
  arena: 'park',
  rules: 'Split-screen, or one pad passed around. Same round, same arena.',
};

export const MODES = { stunt, shot, standing, potato, party };

export function getMode(id) { return MODES[id] || MODES.stunt; }

/** The nearest tagged target inside a forward cone — used by Call Your Shot. */
export function nearestAhead(park, player, cone, range) {
  const p = player.car.position;
  const f = player.car.forward;
  const fl = Math.hypot(f.x, f.z) || 1;
  const fx = f.x / fl, fz = f.z / fl;
  let best = null, bestD = Infinity;
  for (const t of park.targets) {
    if (t.tagged === false) continue;
    const dx = t.aim.x - p.x, dz = t.aim.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 15 || d > range) continue;
    const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
    if (ang > cone) continue;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}
