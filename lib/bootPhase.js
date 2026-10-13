/**
 * Boot timing rules — plain module, no JSX, so the numbers behind the splash are
 * testable without a browser (`scripts/test-loading-system.cjs` imports it).
 *
 * The splash exists to stop the two failures the old first paint had:
 *   - a bare spinner on flat black, which flashed because the gate could resolve
 *     in 40 ms and the spinner disappeared before it was read;
 *   - the card being mounted twice, so unlocking jumped the layout.
 *
 * A minimum of half a second makes the splash read as intentional rather than as a
 * flash, and the card is hosted on the same background, so the hand-off is a swap of the
 * middle of the screen and nothing else.
 */

import { READY_CAP } from './loadProgress.js';

export const SPLASH_MIN_MS = 500;    // long enough to read as intentional, not a flicker
export const SPLASH_SLOW_MS = 2600;  // past this, say something true to the user
/**
 * The splash leaves when its ring has closed, not the instant the gate answers: the arc
 * sweeps its last 8% over CLOSE_MS (250 ms) after the answer arrives, and the hand-off is
 * that completion — the same rule as a section switch, so "the circle closing" always means
 * "the page is arriving". Kept as its own constant because the tests assert the sum.
 */
export const SPLASH_CLOSE_MS = 250;
export const SPLASH_HANDOFF_MS = SPLASH_MIN_MS + SPLASH_CLOSE_MS;

/**
 * @param {{ status?: 'checking' | 'locked' | 'unlocked' | string, elapsedMs?: number }} input
 * @returns {{ visible: boolean, phase: 'brand' | 'slow' | 'done' }}
 */
export function splashPhase({ status = 'checking', elapsedMs = 0 } = {}) {
  const answered = status === 'unlocked' || status === 'locked';
  if (answered && elapsedMs >= SPLASH_HANDOFF_MS) return { visible: false, phase: 'done' };
  if (elapsedMs >= SPLASH_SLOW_MS) return { visible: true, phase: 'slow' };
  return { visible: true, phase: 'brand' };
}

/**
 * The splash ring, on the same maths as every other ring in the app: creeps to 92% while
 * the gate is answering, then closes the last 8% over SPLASH_CLOSE_MS. Borrowed rather than
 * duplicated so the two can never disagree about what "finished" looks like.
 */
export function splashProgress({ elapsedMs = 0, answered = false, answeredAtMs = 0 } = {}) {
  const floorMs = 900;
  const floor = (1 - Math.exp(-Math.max(0, elapsedMs) / floorMs)) * READY_CAP;
  if (!answered) return Math.min(READY_CAP, floor);
  const since = Math.max(0, elapsedMs - answeredAtMs);
  return Math.min(1, READY_CAP + (1 - READY_CAP) * (since / SPLASH_CLOSE_MS));
}
