/**
 * Playback error taxonomy.
 *
 * Every surface used to carry its own copy of "Shaka 4012 means …" (only
 * /classics had any, and two of its four strings were wrong — 4012 is
 * RESTRICTIONS_CANNOT_BE_MET, not "no usable key"). Codes below are read from
 * shaka-player 4.16.41 `lib/util/error.js` so the copy matches the library.
 *
 * Output shape is what the chrome renders:
 *   { code, label, message, kind, retriable, autoRetry, action, hint }
 * action ∈ 'retry' | 'rotate-source' | 'drop-drm' | 'proxy' | 'refresh-token'
 *          | 'copy-url' | 'external' | 'none'
 */

/** @see shaka.util.Error.Code */
const SHAKA_CODES = {
  // NETWORK (1xxx)
  1000: { label: 'UNSUPPORTED_SCHEME', kind: 'network', message: 'This stream URL uses a protocol the browser cannot fetch.', retriable: false, action: 'rotate-source' },
  1001: { label: 'BAD_HTTP_STATUS', kind: 'network', message: 'The stream server rejected the request.', retriable: true, action: 'rotate-source', hint: 'Usually an expired token or a geo-blocked CDN.' },
  1002: { label: 'HTTP_ERROR', kind: 'network', message: 'The stream server could not be reached.', retriable: true, action: 'rotate-source' },
  1003: { label: 'TIMEOUT', kind: 'network', message: 'The stream took too long to answer.', retriable: true, action: 'retry' },
  1006: { label: 'REQUEST_FILTER_ERROR', kind: 'network', message: 'A request header filter failed.', retriable: false, action: 'none', hint: 'Check the channel headers in Live Service.' },
  1007: { label: 'RESPONSE_FILTER_ERROR', kind: 'network', message: 'A response filter failed.', retriable: false, action: 'none' },
  1010: { label: 'ATTEMPTS_EXHAUSTED', kind: 'network', message: 'The player ran out of fetch retries.', retriable: true, action: 'rotate-source' },
  1011: { label: 'SEGMENT_MISSING', kind: 'network', message: 'A media segment is missing from the stream.', retriable: true, action: 'retry' },

  // TEXT (2xxx) — matters for the subtitle feature
  2000: { label: 'INVALID_TEXT_HEADER', kind: 'text', message: 'That subtitle file is not valid WebVTT.', retriable: false, action: 'none' },
  2001: { label: 'INVALID_TEXT_CUE', kind: 'text', message: 'A subtitle cue could not be parsed.', retriable: false, action: 'none' },
  2012: { label: 'CANNOT_ADD_EXTERNAL_TEXT_TO_SRC_EQUALS', kind: 'text', message: 'External subtitles need the streaming engine, not plain src= playback.', retriable: false, action: 'none' },

  // MEDIA (3xxx)
  3014: { label: 'MEDIA_SOURCE_OPERATION_FAILED', kind: 'decode', message: 'The browser refused the media buffer.', retriable: true, action: 'retry' },
  3015: { label: 'MEDIA_SOURCE_OPERATION_THREW', kind: 'decode', message: 'The demuxer threw while appending media.', retriable: true, action: 'rotate-source', hint: 'Common with MKV/HEVC remuxes or a stale ClearKey pair.' },
  3016: { label: 'VIDEO_ERROR', kind: 'decode', message: 'The video element reported a decode error.', retriable: true, action: 'rotate-source', hint: 'This file may need a codec your device lacks.' },
  3018: { label: 'TRANSMUXING_FAILED', kind: 'decode', message: 'Remuxing this container failed.', retriable: true, action: 'rotate-source' },
  3024: { label: 'STREAMING_NOT_ALLOWED', kind: 'player', message: 'Streaming was not allowed on this element.', retriable: true, action: 'retry' },

  // MANIFEST (4xxx)
  4000: { label: 'UNABLE_TO_GUESS_MANIFEST_TYPE', kind: 'manifest', message: 'This manifest type is not recognisable.', retriable: false, action: 'rotate-source' },
  4001: { label: 'DASH_INVALID_XML', kind: 'manifest', message: 'The DASH manifest is malformed.', retriable: true, action: 'retry' },
  4012: { label: 'RESTRICTIONS_CANNOT_BE_MET', kind: 'drm', message: 'No playable variant satisfies this stream’s restrictions.', retriable: false, action: 'drop-drm', hint: 'Encrypted with keys your browser will not accept, or a resolution it cannot decode.' },
  4015: { label: 'HLS_PLAYLIST_HEADER_MISSING', kind: 'manifest', message: 'That HLS playlist has no #EXTM3U header.', retriable: true, action: 'rotate-source', hint: 'A login page or error page was returned instead of a playlist.' },
  4016: { label: 'INVALID_HLS_TAG', kind: 'manifest', message: 'The HLS playlist contains an invalid tag.', retriable: true, action: 'rotate-source' },
  4017: { label: 'HLS_INVALID_PLAYLIST_HIERARCHY', kind: 'manifest', message: 'The HLS master/media playlist hierarchy is broken.', retriable: true, action: 'rotate-source' },
  4026: { label: 'HLS_KEYFORMATS_NOT_SUPPORTED', kind: 'drm', message: 'This HLS stream uses a key format the player cannot use.', retriable: false, action: 'drop-drm' },
  4032: { label: 'CONTENT_UNSUPPORTED_BY_BROWSER', kind: 'codec', message: 'Your browser cannot decode this file’s codecs.', retriable: false, action: 'rotate-source', hint: 'Pick an mp4/h264/aac copy instead of the HEVC or DTS remux.' },
  4033: { label: 'CANNOT_ADD_EXTERNAL_TEXT_TO_LIVE_STREAM', kind: 'text', message: 'External subtitles are not supported on this live stream.', retriable: false, action: 'none' },
  4036: { label: 'NO_VARIANTS', kind: 'manifest', message: 'The manifest lists no playable variants.', retriable: true, action: 'rotate-source' },
  4040: { label: 'HLS_MSE_ENCRYPTED_MP2T_NOT_SUPPORTED', kind: 'drm', message: 'Encrypted MPEG-2-TS HLS is not supported in this browser.', retriable: false, action: 'rotate-source' },
  4041: { label: 'HLS_MSE_ENCRYPTED_LEGACY_APPLE_MEDIA_KEYS_NOT_SUPPORTED', kind: 'drm', message: 'Legacy Apple `keyformat` DRM is not supported here.', retriable: false, action: 'rotate-source' },
  4053: { label: 'HLS_EMPTY_MEDIA_PLAYLIST', kind: 'manifest', message: 'The media playlist is empty — the broadcast may be off air.', retriable: true, action: 'retry', hint: 'Retry in a few seconds or pick another channel.' },

  // DRM (6xxx)
  6000: { label: 'NO_RECOGNIZED_KEY_SYSTEMS', kind: 'drm', message: 'This browser has no DRM key system the stream accepts.', retriable: false, action: 'rotate-source' },
  6001: { label: 'REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE', kind: 'drm', message: 'The requested DRM configuration is unavailable in this browser.', retriable: false, action: 'drop-drm', hint: 'ClearKey was rejected — retrying without keys.' },
  6002: { label: 'FAILED_TO_CREATE_CDM', kind: 'drm', message: 'The content decryptor could not start.', retriable: true, action: 'retry' },
  6003: { label: 'FAILED_TO_ATTACH_TO_VIDEO', kind: 'drm', message: 'DRM could not attach to the video element.', retriable: true, action: 'retry' },
  6005: { label: 'FAILED_TO_CREATE_SESSION', kind: 'drm', message: 'A DRM session could not be created.', retriable: false, action: 'drop-drm' },
  6007: { label: 'LICENSE_REQUEST_FAILED', kind: 'license', message: 'The license server refused the request.', retriable: true, action: 'refresh-token', hint: 'Token may be expired.' },
  6008: { label: 'LICENSE_RESPONSE_REJECTED', kind: 'license', message: 'The license response was rejected.', retriable: false, action: 'drop-drm' },
  6010: { label: 'ENCRYPTED_CONTENT_WITHOUT_DRM_INFO', kind: 'drm', message: 'This stream is encrypted but no keys were supplied.', retriable: false, action: 'drop-drm', hint: 'Add the ClearKey pair in Live Service → Channels.' },
  6012: { label: 'NO_LICENSE_SERVER_GIVEN', kind: 'license', message: 'No license server is configured for this stream.', retriable: false, action: 'drop-drm' },
  6014: { label: 'EXPIRED', kind: 'license', message: 'The DRM license expired.', retriable: true, action: 'refresh-token' },
  6020: { label: 'MISSING_EME_SUPPORT', kind: 'drm', message: 'This browser lacks EME support.', retriable: false, action: 'rotate-source' },

  // PLAYER (7xxx)
  7000: { label: 'LOAD_INTERRUPTED', kind: 'player', message: 'Playback was interrupted while loading.', retriable: true, action: 'retry' },
};

/** HTMLMediaElement MediaError.code */
const MEDIA_ERROR_CODES = {
  1: { label: 'ABORT', kind: 'aborted', message: 'Playback was aborted by the browser.', retriable: true, action: 'retry' },
  2: { label: 'NETWORK', kind: 'network', message: 'The network connection dropped while loading.', retriable: true, action: 'retry' },
  3: { label: 'DECODE', kind: 'decode', message: 'The file is corrupt or uses an unsupported codec.', retriable: true, action: 'rotate-source' },
  4: { label: 'SRC_NOT_SUPPORTED', kind: 'codec', message: 'This source format cannot be played in the browser.', retriable: false, action: 'rotate-source', hint: 'Direct-playable formats are mp4 (h264/aac), webm, and HLS/DASH manifests.' },
};

/** Shaka category → coarse kind, for codes we have no copy for. */
const CATEGORY_KINDS = {
  1: 'network',
  2: 'text',
  3: 'decode',
  4: 'manifest',
  5: 'network',
  6: 'drm',
  7: 'player',
};

export function describeShakaCode(code, detail = null) {
  const known = SHAKA_CODES[Number(code)];
  if (known) return { code: Number(code), ...known, data: detail?.data || [] };
  return {
    code: Number(code) || null,
    label: 'UNKNOWN',
    kind: CATEGORY_KINDS[Math.floor(Number(code) / 1000)] || 'player',
    message: detail?.message || `Playback failed (player error ${code}).`,
    retriable: true,
    action: 'retry',
    data: detail?.data || [],
  };
}

/**
 * Normalise anything thrown/reported during playback into one shape.
 * Accepts: Shaka errors (`{code, category, data}`), `MediaError`, DOMExceptions,
 * AbortErrors, plain strings, and Error instances.
 */
export function mapPlaybackError(error, { offline = false } = {}) {
  if (!error) {
    return { kind: 'unknown', message: 'Playback failed.', retriable: true, action: 'retry' };
  }

  if (typeof error === 'string') {
    return { kind: 'unknown', message: error, retriable: true, action: 'retry' };
  }

  const name = error.name || '';
  if (name === 'AbortError' || /aborted/i.test(String(error.message || ''))) {
    if (offline) {
      return { kind: 'offline', message: 'You are offline — playback resumes when the connection returns.', retriable: true, autoRetry: true, action: 'none' };
    }
    return { kind: 'aborted', message: 'Loading was cancelled.', retriable: true, action: 'retry' };
  }

  if (name === 'NotAllowedError') {
    return {
      kind: 'autoplay',
      message: 'Autoplay with sound was blocked by the browser. Playback started muted — tap the speaker to unmute.',
      retriable: false,
      action: 'none',
    };
  }

  // Shaka error
  if (typeof error.code === 'number' && (error.category !== undefined || error.data !== undefined || error.severity !== undefined)) {
    const described = describeShakaCode(error.code, error);
    if (offline && described.kind === 'network') {
      return { ...described, kind: 'offline', message: 'You are offline — this stream could not be fetched.', autoRetry: true, action: 'none' };
    }
    return described;
  }

  // MediaError on the element
  if (typeof error.code === 'number' && MEDIA_ERROR_CODES[error.code]) {
    return { code: error.code, ...MEDIA_ERROR_CODES[error.code] };
  }

  const message = String(error.message || 'Playback failed.').trim();

  // Common upstream shapes that never reach the player as structured errors.
  if (/HTTP\s*(401|403|451)|forbidden|unauthorized/i.test(message)) {
    return { kind: 'network', message: `${message} — the token behind this stream is probably expired.`, retriable: true, action: 'refresh-token', hint: 'Refresh the Jio token in Live Service → Tools.' };
  }
  if (/failed to fetch|networkerror|load failed|ERR_/i.test(message)) {
    return { kind: 'network', message: offline ? 'You are offline.' : 'The stream host could not be reached.', retriable: true, action: 'rotate-source' };
  }
  if (/timed? out|timeout/i.test(message)) {
    return { kind: 'timeout', message: 'The stream took too long to start.', retriable: true, action: 'retry' };
  }
  if (/does not support|not supported|unsupported/i.test(message)) {
    return { kind: 'codec', message, retriable: false, action: 'rotate-source' };
  }

  return { kind: 'unknown', message, retriable: true, action: 'retry' };
}

/**
 * Shaka errors that mean "the DRM config is the problem" — the exact set the
 * live page used to hand-code (6001 / category 6) so the DRM-drop retry keeps
 * firing, from one place.
 */
export function isDrmConfigError(error) {
  const mapped = mapPlaybackError(error);
  return mapped.kind === 'drm' || Number(error?.code) === 6001 || Number(error?.category) === 6;
}

/** Errors worth asking the policy layer to recover from (token refresh etc). */
export function isTokenRejected(error) {
  const mapped = mapPlaybackError(error);
  return mapped.action === 'refresh-token' || /401|403|451/.test(String(error?.message || mapped.message || ''));
}

export { SHAKA_CODES as SHAKA_ERROR_CODES, MEDIA_ERROR_CODES };
