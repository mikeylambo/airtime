/**
 * HORSE (R11).
 *
 * The playground game, played with cars: somebody sets a mark, everybody else
 * has to match it, and missing costs you a letter. Five letters and you are
 * out.
 *
 * It lives here rather than in `sim/modes.js` because the simulation has no
 * idea anybody is taking turns — a mode is a rule bolted onto *one round*, and
 * HORSE is a rule about a sequence of them. The sim's job is to hand back a
 * summary; this decides what the summary means.
 *
 * The mark is deliberately **the facet count of the best landing**, not the
 * score. Score is a product of tier multipliers, chain and purity, so matching
 * a score means reproducing a whole route; matching a facet count means doing
 * the same *number of things at once*, which is a thing you can watch somebody
 * do and then try. That is the entire social contract of the game, and it is
 * the one number in the build that reads as a dare.
 *
 * The setter's own run is never a miss. Whoever leads sets the mark by doing
 * something, and the worst that can happen to them is that it was easy.
 */

import TUNING from '../TUNING.js';

export const WORD = TUNING.MODES.HORSE.WORD;

/** A fresh game. */
export function begin(players) {
  return {
    players: Array.from({ length: players }, (_, i) => ({ index: i, letters: 0, out: false })),
    turn: 0,
    setter: 0,        // whose mark everybody is chasing
    mark: null,       // { facets, by, name } or null on the first turn of a round
    history: [],
    over: false,
    winner: null,
  };
}

/** The best facet count a run actually landed. */
export function markOf(summary) {
  return (summary.landings || [])
    .filter((l) => l.landed)
    .reduce((a, l) => Math.max(a, l.facetCount || 0), 0);
}

const alive = (st) => st.players.filter((p) => !p.out);

/**
 * Resolve one turn.
 * @returns { result: 'set'|'matched'|'missed'|'skip', letter?, state }
 */
export function resolve(state, summary) {
  if (state.over) return { result: 'skip', state };
  const me = state.players[state.turn];
  const got = markOf(summary);
  let result;

  if (!state.mark) {
    // The setter. Landing nothing sets a mark of zero, which is its own
    // punishment: everybody matches it for free and the pad comes straight
    // back round.
    state.mark = { facets: got, by: me.index };
    state.setter = me.index;
    result = 'set';
  } else if (got >= state.mark.facets) {
    result = 'matched';
  } else {
    me.letters++;
    if (me.letters >= WORD.length) me.out = true;
    result = 'missed';
  }

  state.history.push({ player: me.index, got, needed: state.mark.facets, result });

  // Next living player. If the pad comes back to the setter, the mark has been
  // survived by everybody and a new one is set.
  const n = state.players.length;
  let next = state.turn;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (!state.players[next].out) break;
  }
  state.turn = next;
  if (next === state.setter) state.mark = null;

  const live = alive(state);
  if (live.length <= 1) {
    state.over = true;
    state.winner = live.length ? live[0].index : null;
  }
  return { result, letter: me.letters, state };
}

/** "H O R S _" — what the scoreboard shows. */
export function spell(letters) {
  return WORD.split('').map((c, i) => (i < letters ? c : '_')).join(' ');
}

export const standings = (state) => state.players.map((p) => ({
  index: p.index, letters: p.letters, word: spell(p.letters), out: p.out,
}));
