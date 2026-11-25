import { resolutionHealth } from '@/lib/live/playback/resolveHealth';
// Client-safe eligibility rules. Never infer playback health from playlist presence.
export const HEALTH_VERSION = 1;
export function healthFingerprintInput(ch = {}) {
  let identityUrl = ch.url || '';
  try { const u=new URL(identityUrl); for(const key of ['__hdnea__','hdnea','hdntl','hdnts'])u.searchParams.delete(key); identityUrl=u.href; } catch {}
  const input = JSON.stringify([identityUrl, ch.format || '', ch.keyId || '', ch.key || '', ch.licenseKey || '', ch.licenseType || '', ch.referer || '', ch.userAgent || '', ch.headers || {}, !!ch.forceProxy]);
  // Change detector only, not an authentication primitive; don't expose keys in health.
  let a=2166136261,b=5381; for (let i=0;i<input.length;i++) { a=Math.imul(a^input.charCodeAt(i),16777619); b=Math.imul(b,33)^input.charCodeAt(i); }
  return `${a>>>0}:${b>>>0}`;
}
export function eligibleLiveVariant(ch = {}, now = Date.now()) {
  const h = ch.playbackHealth;
  return !ch.hidden && ch.playable !== false && String(ch.url||'').startsWith('https://') && resolutionHealth(ch,now).ok && h?.version === HEALTH_VERSION
    && h.state === 'healthy' && Number(h.eligibleUntil) > now
    && h.fingerprintInput === healthFingerprintInput(ch);
}
export function flagshipPriority(ch = {}) {
  const name = String(ch.customName || ch.displayName || ch.name || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  // Regional feeds remain separate and never take the Indian flagship slots.
  if (/\b(?:uk|usa|us|europe|international|singapore|malaysia)\b/.test(name)) return 4;
  if (/^(?:star )?vijay(?: tv)?(?: hd| sd)?$/.test(name)) return 0;
  if (/^sun tv(?: hd| sd)?$/.test(name)) return 1;
  if (/^sony vizha(?: hd| sd)?$/.test(name)) return 2;
  return 3;
}
export function healthTransition(previous = {}, probe, fingerprintInput, now = Date.now()) {
  const same = previous.fingerprintInput === fingerprintInput;
  const old = same ? previous : {};
  if(old.code === 'OWNER_QUARANTINED')return {...old, state:'quarantined', eligibleUntil:0};
  const successes = probe.ok ? Number(old.successes || 0) + 1 : 0;
  const browserUntil = Number(old.browserUntil || 0);
  const browserOnly = probe.code === 'BROWSER_REQUIRED' && browserUntil > now && old.code !== 'OWNER_QUARANTINED';
  const healthy = (probe.ok && successes >= 2 || browserOnly) && browserUntil > now;
  return { version: HEALTH_VERSION, fingerprintInput,
    state: healthy ? 'healthy' : probe.ok ? 'candidate-ready' : 'quarantined',
    successes, failures: probe.ok ? 0 : Number(old.failures || 0) + 1,
    checkedAt: now, browserUntil, browserConfirmedAt: old.browserConfirmedAt || null,
    eligibleUntil: healthy ? Math.min(now + 30*60_000, browserUntil) : 0,
    nextCheckAt: now + (probe.ok ? 5*60_000 : 10*60_000),
    code: probe.code, detail: probe.detail || '', latencyMs: probe.latencyMs || 0,
    manifest: probe.manifest === true, mediaSample: probe.mediaSample === true,
  };
}
