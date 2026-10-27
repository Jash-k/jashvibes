/**
 * lib/live/v2/policy.js — client-side playback policy for V2 channels.
 *
 * The server resolve route returns the origin manifest, the harvested
 * __hdnea__ token and the ClearKey pair. This policy mirrors the reference
 * app's mechanics:
 *   - Shaka fast-start profile (small initial buffer, 500 kbps ABR seed)
 *   - a request filter that appends the account token to every Jio-family
 *     request (manifest + segments), idempotently and only on Jio hosts
 *   - ClearKey delivered directly to Shaka's DRM config — no license server
 */
import { V2_FAST_PROFILE, appendHdnea, isJioHost } from '@/lib/live/v2/feed';

export function createV2Policy(channel = {}, resolved = {}) {
  const cookie = String(resolved.cookie || '');
  const clearKeys = resolved.clearKeys && typeof resolved.clearKeys === 'object'
    ? { ...resolved.clearKeys } : {};
  const originUrl = String(resolved.originUrl || channel.url || '');
  const drm = Object.keys(clearKeys).length ? { clearKeys } : {};

  return {
    name: 'jio-v2',
    live: true,
    needsMuxjs: true,
    ambient: false,
    loadTimeoutMs: 30_000,
    playerConfig: V2_FAST_PROFILE,

    async resolve() {
      return {
        url: appendHdnea(originUrl, cookie),
        kind: 'auto',
        live: true,
        allowNativeHls: true,
        drm,
        hasDrm: Boolean(Object.keys(drm).length),
        hasClearKeys: Boolean(Object.keys(clearKeys).length),
        hasDrmServers: false,
        http: {
          // Shaka hands every request through this filter before dispatch.
          // Relative DASH segment URLs resolve against the manifest origin,
          // so the host check covers them too.
          requestFilter: (type, request) => {
            if (!request?.uris || !cookie) return;
            request.uris = request.uris.map((uri) => (
              isJioHost(uri) ? appendHdnea(uri, cookie) : uri
            ));
          },
        },
        meta: {
          jio: true,
          channel: channel.name || channel.id || 'v2',
          tokenSource: resolved.tokenSource || '',
        },
      };
    },

    // V2 has no source ladder: recovery is driven by the engine's built-in
    // streaming retries (V2_FAST_PROFILE), never a policy rung.
    async recover() { return { retry: false }; },
    hasRecovery: () => false,
    describe: () => ({ source: 'jio-v2', tokenSource: resolved.tokenSource || '' }),
  };
}
