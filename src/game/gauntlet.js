/**
 * THE GAUNTLET (R9) — the mastery exam.
 *
 * The reference's Obstacle Course was the thing you did when you had run out
 * of things to be good at, and the roster gives ours the same job: "endgame
 * mastery course combining everything. **Unlocked, not offered.**"
 *
 * It is a *mode*, not an arena, and that is a deliberate scoping decision
 * rather than a shortcut. The roster describes The Gauntlet as combining
 * everything, and three of the six arenas do not exist yet — an arena built
 * now could only combine the two that do, and would have to be rebuilt the
 * moment Mega Works, Floodway and Skyline land in R10. So The Gauntlet is
 * currently a **chain of short trials across the arenas that exist**, using
 * the licence machinery it is already shaped like, and it becomes an arena in
 * R10 when there is something worth combining.
 *
 * Two rules it does not break:
 *
 * - **One input between stages.** R4's 1.20 s budget is permanent, so a
 *   cleared stage rolls straight into the next one. There is no interstitial
 *   screen to press through.
 * - **A failed stage ends the attempt, and nothing else.** No lives, no
 *   penalty, no progress lost. The Gauntlet is a thing you are trying to do,
 *   not a thing you are being punished by.
 *
 * The last stage is the vision's acceptance clip, verbatim. That is on
 * purpose: the exam ends by asking for the exact ten seconds that the whole
 * project has been calling its definition of done.
 */

const landed = (r) => (r.landings || []).filter((l) => l.landed);
const facets = (l) => l.facetCount || (l.facets || l.tricks || []).length;
const spinDeg = (l) => Math.round((l.rotation || 0) * (180 / Math.PI));

/**
 * Twelve stages, alternating arenas, each one a single sentence a player can
 * hold in their head while driving. The seconds are generous at the top and
 * tight at the bottom — the difficulty is the ask, never the clock.
 */
export const STAGES = [
  {
    id: 'g1', arena: 'park', seconds: 35, name: 'THREE IN A ROW',
    brief: 'Land three in a row without crashing.',
    test: (r) => (r.bestChain || 0) >= 3,
  },
  {
    id: 'g2', arena: 'park', seconds: 45, name: 'SIX AT ONCE',
    brief: 'Land a jump doing six different things at the same time.',
    test: (r) => landed(r).some((l) => facets(l) >= 6),
  },
  {
    id: 'g3', arena: 'city', seconds: 50, name: 'THE BILLBOARD',
    brief: 'Stick a billboard.',
    test: (r) => landed(r).some((l) => l.tier === 'billboard'),
  },
  {
    id: 'g4', arena: 'park', seconds: 45, name: 'FOUR SECONDS',
    brief: 'Land a flight of four seconds or more.',
    test: (r) => landed(r).some((l) => (l.airtime || 0) >= 4),
  },
  {
    id: 'g5', arena: 'city', seconds: 60, name: 'THE SPIRE',
    brief: 'Land on the roof of the skyscraper.',
    test: (r) => landed(r).some((l) => l.target === 'spire'),
  },
  {
    id: 'g6', arena: 'park', seconds: 55, name: 'RAW SIX',
    brief: 'Land a six-facet jump without touching a stabiliser.',
    test: (r) => landed(r).some((l) => facets(l) >= 6 && l.purity && l.purity.id === 'raw'),
  },
  {
    id: 'g7', arena: 'city', seconds: 65, name: 'THE WHOLE STACK',
    brief: 'Land on all three decks of the parking structure.',
    test: (r) => new Set(landed(r).map((l) => l.target)
      .filter((t) => t && t.startsWith('stack_d'))).size >= 3,
  },
  {
    id: 'g8', arena: 'park', seconds: 55, name: 'LAND A 900',
    brief: 'Land a jump carrying nine hundred degrees on one axis.',
    test: (r) => landed(r).some((l) => spinDeg(l) >= 900),
  },
  {
    id: 'g9', arena: 'city', seconds: 50, name: 'THE HELICOPTER',
    brief: 'Pass the helicopter close enough to count.',
    test: (r) => (r.moverNearMisses || 0) >= 1,
  },
  {
    id: 'g10', arena: 'park', seconds: 70, name: 'CHAIN OF EIGHT',
    brief: 'Land eight in a row.',
    test: (r) => (r.bestChain || 0) >= 8,
  },
  {
    id: 'g11', arena: 'city', seconds: 75, name: 'THE SECRET',
    brief: 'Land on the mast. Only the spire can reach it.',
    test: (r) => landed(r).some((l) => l.tier === 'secret'),
  },
  {
    id: 'g12', arena: 'city', seconds: 75, name: 'THE SHOT',
    brief: 'Off the spire, past the helicopter, six facets, land it on a garage deck.',
    test: (r) => (r.moverNearMisses || 0) >= 1 && landed(r).some((l) =>
      facets(l) >= 6 && (l.target || '').startsWith('stack_d')
      && (l.from ? l.from.y > 40 : false)),
  },
];

export const stageAt = (i) => STAGES[i] || null;
export const LENGTH = STAGES.length;

/** A fresh attempt. */
export function begin() {
  return { index: 0, cleared: [], failed: null, started: Date.now(), done: false };
}

/**
 * Resolve one stage against the run that just ended.
 * @returns the same state, advanced — cleared and moved on, or failed and done
 */
export function resolve(state, summary) {
  const stage = stageAt(state.index);
  if (!stage || state.done) return state;
  let ok = false;
  try { ok = !!stage.test(summary); } catch { ok = false; }
  if (ok) {
    state.cleared.push({ id: stage.id, score: summary.score });
    state.index++;
    if (state.index >= LENGTH) state.done = true;
  } else {
    state.failed = stage.id;
    state.done = true;
  }
  return state;
}

/** How deep an attempt got — the number a profile keeps. */
export const depth = (state) => (state ? state.cleared.length : 0);

/**
 * The Gauntlet's own record on a profile: the deepest attempt, ever. Beating
 * it is the endgame, and the endgame is a single integer, which is exactly
 * how a mastery exam should be scored.
 */
export function record(profile, state) {
  const d = depth(state);
  if (d > (profile.gauntlet || 0)) profile.gauntlet = d;
  return profile.gauntlet || 0;
}
