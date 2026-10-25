/**
 * Recovery ladder — the one ordered place that decides what happens when a
 * stream dies mid-play, instead of four pages each retrying differently.
 *
 * Each rung is a plain object so it is unit-testable and so the chrome can
 * render "Recovering (2/5): switching source…" honestly.
 */

export const RUNGS = {
  RETRY_STREAMING: 'retry-streaming', // Shaka re-fetches the failed segment
  REANCHOR: 'reanchor', // seek back to pull a new playlist window (live)
  CORS_RETRY: 'cors-retry', // retry via server proxy on CORS/403
  RELOAD: 'reload', // full load of the same URL, backoff
  DROP_DRM: 'drop-drm', // retry once with ClearKeys removed
  ROTATE_SOURCE: 'rotate-source', // next fallback stream, position preserved
  POLICY_RECOVER: 'policy-recover', // ask the policy (Jio token → proxy route)
  GIVE_UP: 'give-up',
};

export const DEFAULT_LADDER = [
  RUNGS.RETRY_STREAMING,
  RUNGS.REANCHOR,
  RUNGS.CORS_RETRY,
  RUNGS.RELOAD,
  RUNGS.DROP_DRM,
  RUNGS.ROTATE_SOURCE,
  RUNGS.POLICY_RECOVER,
];

/** rung → { ms, maxTimes } */
const BUDGET = {
  [RUNGS.RETRY_STREAMING]: { delay: 250, maxTimes: 2 },
  [RUNGS.REANCHOR]: { delay: 400, maxTimes: 2 },
  [RUNGS.CORS_RETRY]: { delay: 0, maxTimes: 1 },
  [RUNGS.RELOAD]: { delay: 1000, maxTimes: 2 }, // caller multiplies 1s/2s/4s
  [RUNGS.DROP_DRM]: { delay: 0, maxTimes: 1 },
  [RUNGS.ROTATE_SOURCE]: { delay: 0, maxTimes: 3 },
  [RUNGS.POLICY_RECOVER]: { delay: 0, maxTimes: 2 },
};

const LADDER_MAX_MS = 12_000;

const RUNG_LABELS = {
  [RUNGS.RETRY_STREAMING]: 'Re-fetching this segment…',
  [RUNGS.REANCHOR]: 'Re-anchoring the live window…',
  [RUNGS.CORS_RETRY]: 'CORS blocked — retrying via server proxy…',
  [RUNGS.RELOAD]: 'Reloading this source…',
  [RUNGS.DROP_DRM]: 'Retrying without decryption keys…',
  [RUNGS.ROTATE_SOURCE]: 'Switching to another source…',
  [RUNGS.POLICY_RECOVER]: 'Refreshing access token…',
  [RUNGS.GIVE_UP]: 'This source is not playable.',
};

function times(counts, rung) {
  return Number(counts?.[rung] || 0);
}

/**
 * Decide the next action.
 *
 * @param {object} state
 * @param {number} state.rungIndex          index into `ladder` of the last rung tried (-1 = nothing tried)
 * @param {object} state.attemptCounts      { [rung]: timesTried }
 * @param {number} state.startedAt          ms timestamp when this failure episode began
 * @param {number} state.now                ms timestamp now (injectable for tests)
 * @param {number} state.reloadAttempts     how many RELOADs already done (for the 1s/2s/4s backoff)
 * @param {object} caps  { canRetryStreaming, canReanchor, canReload, hasDrm, hasFallbackSources, hasPolicyRecovery, live, offline, errorKind, aborted, seeking, canCorsRetry, isCorsError }
 * @param {string[]} ladder  override the default ladder order
 * @returns {{rung: string, delayMs: number, message: string, positionPreserved: boolean} | null}
 */
export function nextRecoveryAction(state = {}, caps = {}, ladder = DEFAULT_LADDER) {
  const {
    rungIndex = -1,
    attemptCounts = {},
    startedAt = 0,
    now = Date.now(),
    reloadAttempts = 0,
    maxLadderMs = LADDER_MAX_MS,
  } = state;

  // Never fight the user or a cancelled load.
  if (caps.aborted) return null;

  // A seek into a part of the file that has not been fetched yet looks exactly
  // like a stall from here (no currentTime progress for seconds), but the only
  // thing that fixes it is waiting.
  if (caps.seeking) return null;

  // Offline: don't burn the ladder, just wait for the browser to come back.
  if (caps.offline) {
    return { rung: RUNGS.RELOAD, delayMs: 0, message: 'Offline — waiting for the connection…', positionPreserved: true, hold: true };
  }

  if (startedAt && now - startedAt > maxLadderMs) return null;

  const applicable = ladder.filter((rung) => rungApplies(rung, caps));
  if (!applicable.length) return null;

  const lastIndex = rungIndex >= 0 ? ladder.indexOf(ladder[rungIndex]) : -1;

  for (let i = lastIndex + 1; i < ladder.length; i += 1) {
    const rung = ladder[i];
    if (!applicable.includes(rung)) continue;
    const budget = BUDGET[rung] || { delay: 0, maxTimes: 1 };
    if (times(attemptCounts, rung) >= budget.maxTimes) continue;
    return {
      rung,
      delayMs: rung === RUNGS.RELOAD ? 1000 * 2 ** Math.max(0, reloadAttempts) : budget.delay,
      message: RUNG_LABELS[rung],
      positionPreserved: true,
    };
  }

  // Rungs exhausted but retries remain cheap for transient network errors
  const retryable = caps.errorKind === 'network' || caps.errorKind === 'timeout';
  if (retryable && startedAt && now - startedAt < maxLadderMs) {
    const softRung = caps.hasFallbackSources ? RUNGS.ROTATE_SOURCE : caps.canReanchor ? RUNGS.REANCHOR : null;
    if (softRung && times(attemptCounts, softRung) < (BUDGET[softRung].maxTimes + 1)) {
      return { rung: softRung, delayMs: 1500, message: RUNG_LABELS[softRung], positionPreserved: true, soft: true };
    }
  }

  return null;
}

function rungApplies(rung, caps = {}) {
  switch (rung) {
    case RUNGS.RETRY_STREAMING:
      return Boolean(caps.canRetryStreaming) && caps.errorKind !== 'drm';
    case RUNGS.REANCHOR:
      return Boolean(caps.canReanchor) && Boolean(caps.live);
    case RUNGS.CORS_RETRY:
      return Boolean(caps.canCorsRetry) && (caps.isCorsError || caps.errorKind === 'network');
    case RUNGS.RELOAD:
      return Boolean(caps.canReload);
    case RUNGS.DROP_DRM:
      return Boolean(caps.hasDrm);
    case RUNGS.ROTATE_SOURCE:
      return Boolean(caps.hasFallbackSources);
    case RUNGS.POLICY_RECOVER:
      return Boolean(caps.hasPolicyRecovery);
    default:
      return false;
  }
}

/**
 * Which rungs are actually available for this source
 */
export function capabilitiesFor({ engine, url, hasDrm, fallbackUrls = [], policy, live, model, error, seeking = false, canCorsRetry = false } = {}) {
  const msg = String(error?.message || '');
  const isCorsError = /cors|blocked|cross-origin|failed to fetch|networkerror/i.test(msg) || error?.code === 1001;
  return {
    canRetryStreaming: Boolean(engine?.retryStreaming),
    canReanchor: Boolean(model?.canSeek) || Boolean(live),
    canReload: Boolean(url),
    hasDrm: Boolean(hasDrm),
    hasFallbackSources: (fallbackUrls?.length || 0) > 0,
    hasPolicyRecovery: typeof policy?.recover === 'function',
    canCorsRetry: Boolean(canCorsRetry),
    isCorsError,
    errorKind: error?.kind || 'unknown',
    seeking: Boolean(seeking),
    aborted: error?.kind === 'aborted',
    offline: error?.kind === 'offline',
  };
}

/**
 * Heuristic: is this error likely a CORS issue?
 */
export function isCorsLikeError(error) {
  const msg = String(error?.message || error?.data?.[1] || '').toLowerCase();
  return /cors|cross-origin|blocked by|failed to fetch|networkerror|access-control/i.test(msg);
}
