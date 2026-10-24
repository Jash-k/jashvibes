/**
 * lib/live/tokens/hdnea.js — __hdnea__ / hdntl / hdnts expiry handling per-variant
 * Same regex as streamClassifier.readTokenExpiry but per-token type
 */

const RE = {
  hdnea: /(?:__hdnea__|hdnea)=st=\d+~exp=(\d+)~acl=/i,
  hdntl: /exp=(\d+).*hmac=/i,
  hdnts: /exp=(\d+).*hmac=/i,
};

export function readHdneaExpiry(url = '', cookie = '') {
  const hay = `${url} ${cookie}`;
  const m = hay.match(RE.hdnea);
  if (m) {
    const s = Number(m[1]);
    if (s > 1_600_000_000 && s < 4_000_000_000) return s*1000;
  }
  // fallback generic
  const g = hay.match(/(?:exp|expires)[=~%3D]*(\d{9,12})/i);
  if (g) {
    const s = Number(g[1]);
    if (s>1.6e9) return s*1000;
  }
  return null;
}

export function isExpiring(expiresAt, graceMs = 5*60*1000) {
  if (!expiresAt) return false;
  return Date.now() + graceMs >= expiresAt;
}

export function tokenFreshnessLabel(expiresAt) {
  if (!expiresAt) return 'no expiry';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms/60000);
  if (m < 60) return `${m}m left`;
  return `${Math.floor(m/60)}h ${m%60}m`;
}
