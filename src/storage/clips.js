/**
 * Saved clips (§6.1 / §8 garage wall).
 *
 * A clip is inputs and a seed, so the whole library costs a few KB per entry
 * and lives happily in localStorage until there is a server to put it on.
 */

import TUNING from '../TUNING.js';
import { Storage } from './storage.js';
import { simCurrent } from '../sim/version.js';

/**
 * §R: a clip whose stamp no longer matches still *plays* — a diverged
 * re-simulation is harmless and occasionally funny — but anything that claims
 * to show a real landing (the garage wall, the reel) must skip it.
 */
export const clipStale = (c) => !simCurrent(c);

const key = (slot) => `clips:${slot}`;

export function loadClips(slot) {
  const list = Storage.read(key(slot), []);
  return Array.isArray(list) ? list : [];
}

export function saveClip(slot, clip) {
  const list = loadClips(slot);
  list.unshift(clip);
  while (list.length > TUNING.REPLAY.MAX_CLIPS) list.pop();
  Storage.write(key(slot), list);
  return list;
}

export function deleteClip(slot, id) {
  const list = loadClips(slot).filter((c) => c.id !== id);
  Storage.write(key(slot), list);
  return list;
}

/** §8: "best clips auto-hang in the garage; the trophy case is your own footage." */
export function wallClips(slot, n = 6) {
  return loadClips(slot)
    .filter((c) => !clipStale(c))
    .sort((a, b) => (b.info?.total || 0) - (a.info?.total || 0))
    .slice(0, n);
}
