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

/**
 * §9 Free Ride: "no clock, nothing scored. Learn the arena."
 *
 * The one mode with no pressure in it, and it exists because five of the six
 * arenas are networks you have to *learn* before Stunt Run is anything but
 * noise. Nothing here is a rule — the absence is the rule.
 */
const freeride = {
  id: 'freeride',
  label: 'FREE RIDE',
  arena: 'park',
  seconds: TUNING.MODES.FREERIDE.SECONDS,
  rules: 'No clock worth watching, no medal, nothing on the line. Go and find out what is in here.',
  scored: false,
};

/**
 * §9 Best Trick: one landing counts — your best.
 *
 * Implemented as a *running maximum* rather than as a separate tally: each
 * landing banks only the difference between itself and the best so far, so the
 * score the player is watching is always exactly their best single stunt and
 * every other system (the HUD, the boards, the reel) keeps working unchanged.
 */
const besttrick = {
  id: 'besttrick',
  label: 'BEST TRICK',
  arena: 'park',
  seconds: TUNING.MODES.BESTTRICK.SECONDS,
  rules: 'One landing counts: your best. Everything else is practice for it.',

  init(sim) { sim.modeState = { best: sim.players.map(() => 0) }; },

  onLanded(player, result, sim) {
    const st = sim.modeState;
    const val = result.landed ? result.total : 0;
    const prev = st.best[player.index] || 0;
    if (val <= prev) {
      return { ...result, payout: 0, coins: 0, total: 0, bestTrick: prev, beaten: false };
    }
    st.best[player.index] = val;
    // The delta, so the running score *is* the best trick.
    return { ...result, total: val - prev, bestTrick: val, beaten: true };
  },
};

/**
 * §9 Combo Run: the chain must never break.
 *
 * The combo window already exists and already compounds; this mode simply
 * removes the safety net, so the question stops being "how much can you bank"
 * and becomes "how long can you keep it alive". A crash is the end.
 */
const combo = {
  id: 'combo',
  label: 'COMBO RUN',
  arena: 'park',
  seconds: TUNING.MODES.COMBO.SECONDS,
  rules: 'One chain. A crash ends the run, whatever the clock says.',

  onLanded(player, result, sim) {
    if (result.landed) return result;
    player.run.eliminate(sim.round.elapsed);
    sim.events.push({ type: 'eliminated', player: player.index });
    return result;
  },

  isOver(sim) { return sim.players.every((p) => !p.run.alive); },
};

/**
 * §9 Survival: the clock is the score.
 *
 * You start with twenty seconds and every landing buys more of them, scaled by
 * how good it was. It is the only mode where a clean single flip is worth
 * something a huge crash is not — and the only one that ends when you stop
 * being able to keep going rather than when a timer says so.
 */
const survival = {
  id: 'survival',
  label: 'SURVIVAL',
  arena: 'park',
  seconds: TUNING.MODES.SURVIVAL.START,
  rules: 'Twenty seconds. Every landing buys more of them. Stop landing and it is over.',

  onLanded(player, result, sim) {
    const S = TUNING.MODES.SURVIVAL;
    if (!result.landed) {
      sim.round.timeLeft = Math.max(0, sim.round.timeLeft - S.CRASH_COST);
      return { ...result, timeAdded: -S.CRASH_COST };
    }
    // Scaled by the facet stack, so surviving rewards the same thing the rest
    // of the game does rather than rewarding safe hops.
    const add = Math.min(S.MAX_ADD,
      S.PER_LANDING + (result.facetCount || 0) * S.PER_FACET);
    sim.round.timeLeft = Math.min(S.CEILING, sim.round.timeLeft + add);
    return { ...result, timeAdded: +add.toFixed(2) };
  },
};

/** §9 Party is a shell around Stunt: split-screen or one pad, same rules. */
const party = {
  id: 'party',
  label: 'PARTY',
  arena: 'park',
  rules: 'Split-screen, or one pad passed around. Same round, same arena.',
};

/**
 * §9 HORSE: pass the pad, and match what the last player did.
 *
 * The rules live in game/horse.js because they are about a *sequence of runs*
 * rather than about one round — the sim has no idea anybody is taking turns.
 * Here it is Stunt with a shorter clock; the letters are the game layer's.
 */
const horse = {
  id: 'horse',
  label: 'HORSE',
  arena: 'park',
  seconds: TUNING.MODES.HORSE.SECONDS,
  rules: 'Set a mark, then everyone has to match it. Miss and you take a letter.',
  party: true,
};

export const MODES = {
  stunt, freeride, shot, besttrick, combo, survival, party, horse, standing, potato,
};

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
