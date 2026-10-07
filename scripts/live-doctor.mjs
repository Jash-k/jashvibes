#!/usr/bin/env node
/**
 * tools/live-doctor.mjs — "why is my Live source not playing?"
 *
 * Runs the app's own parser, stream classifier and header builder (via the
 * @/ alias hook in scripts/alias-register.mjs) — read-only, no DB, no writes.
 *
 *   npm run live:doctor -- <m3u-url-or-path>
 *   node --import ./scripts/alias-register.mjs scripts/live-doctor.mjs <m3u-url-or-path> [--sample 6] [--json]
 *
 * What it tells you:
 *   - how old the feed is and whether the CDN tokens in it have expired
 *     (expired tokens = every channel 401/403 = "my sources don't play")
 *   - the format split (HLS vs DASH vs raw TS) and what is unplayable
 *   - which rows only work through the app's server proxy (UA/Referer/Cookie)
 *   - a live probe of a sample, with the exact headers the player sends
 *
 * Exit code 1 when the feed looks broken (all tokens dead, nothing parses,
 * nothing reachable), so CI or a cron can gate on it.
 */
import fs from 'node:fs';
import { classifyStream } from '@/lib/player/streamClassifier';
import { parseLiveSourceChannels, buildPlaybackHeaders } from '@/lib/liveTv';

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--sample']);
const target =
  args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) ||
  (fs.existsSync('jash-live.m3u') ? 'jash-live.m3u' : '');
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const SAMPLE = Math.max(0, Number(flag('sample', 6)) || 0);
const AS_JSON = args.includes('--json');

if (!target) {
  console.error('usage: node tools/live-doctor.mjs <m3u-url-or-path> [--sample N] [--json]');
  process.exit(2);
}

const isUrl = /^https?:\/\//i.test(target);
const line = (char = '─', n = 68) => char.repeat(n);
const out = (...a) => { if (!AS_JSON) console.log(...a); };

/* ------------------------------------------------------------ token audit */

const EXP_RE = /(?<![0-9])(?:exp|expires|hdnts_exp|hdntl_exp)=(\d{9,12})(?![0-9])/gi;

function tokenAudit(channels = []) {
  const now = Date.now();
  const report = { withToken: 0, expired: 0, expiringSoon: 0, valid: 0, noToken: 0, soonest: [], dead: [] };
  for (const channel of channels) {
    const haystack = `${channel.url || ''} ${channel.cookie || ''} ${channel.userAgent || ''} ${channel.referer || ''}`;
    let latest = 0;
    let m;
    EXP_RE.lastIndex = 0;
    while ((m = EXP_RE.exec(haystack))) {
      const ms = Number(m[1]) * 1000;
      if (ms > 1_600_000_000_000 && ms < 4_000_000_000_000) latest = Math.max(latest, ms);
    }
    if (!latest) { report.noToken += 1; continue; }
    report.withToken += 1;
    if (latest < now) { report.expired += 1; report.dead.push({ name: channel.name, expiresAt: latest }); }
    else if (latest - now < 15 * 60_000) { report.expiringSoon += 1; report.soonest.push({ name: channel.name, expiresAt: latest }); }
    else { report.valid += 1; report.soonest.push({ name: channel.name, expiresAt: latest }); }
  }
  report.soonest.sort((a, b) => a.expiresAt - b.expiresAt);
  return report;
}

/* ------------------------------------------------------- sample probing */

async function probe(channel) {
  const headers = buildPlaybackHeaders(channel, channel.url);
  const started = Date.now();
  try {
    const res = await fetch(channel.url, {
      headers: { ...headers, Range: 'bytes=0-4095' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const ms = Date.now() - started;
    const body = res.ok ? (await res.text()).slice(0, 4000) : '';
    const kind = /#EXTM3U/.test(body) ? 'HLS' : /<MPD[\s>]/.test(body) ? 'DASH' : body ? 'other' : '';
    return { status: res.status, ms, kind };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: String(error?.name === 'TimeoutError' ? 'timeout' : error?.message || error).slice(0, 60) };
  }
}

const OK_STATUS = (status) => status === 200 || status === 206;

const verdictFor = ({ status, kind }) => {
  if (OK_STATUS(status) && (kind === 'HLS' || kind === 'DASH')) return 'manifest OK';
  if (OK_STATUS(status)) return 'reachable, but not a manifest (redirect page?)';
  if ([401, 403, 451, 475].includes(status)) return `CDN refused (${status}) — a server IP is often blocked while your phone plays it`;
  if (status === 404) return 'HTTP 404 — URL rotated or dead';
  if (status === 0) return 'network error';
  return `HTTP ${status}`;
};

/* ------------------------------------------------------------------ main */

const report = { target, fetchedAt: new Date().toISOString(), stage: 'fetch', ok: false, findings: [] };

try {
  let text = '';
  let bytes = 0;
  if (isUrl) {
    const res = await fetch(target, { cache: 'no-store', signal: AbortSignal.timeout(30_000), headers: { Accept: 'text/plain,*/*' } });
    if (!res.ok) throw new Error(`source returned HTTP ${res.status}`);
    text = await res.text();
    bytes = text.length;
  } else {
    text = fs.readFileSync(target, 'utf8');
    bytes = text.length;
  }
  report.bytes = bytes;
  report.stage = 'parse';

  const generated = (text.match(/^#GENERATED:(.+)$/m) || [])[1]?.trim() || '';
  const declaredTotal = (text.match(/^#TOTAL:(.+)$/m) || [])[1]?.trim() || '';
  const generatedAgeMin = generated ? Math.round((Date.now() - Date.parse(generated)) / 60_000) : null;
  report.generatedAt = generated || null;
  report.generatedAgeMinutes = generatedAgeMin;
  report.declaredTotal = declaredTotal || null;

  out(line('═'));
  out('  LIVE SOURCE DOCTOR');
  out(line('═'));
  out(`  source        : ${target}`);
  out(`  fetched       : ${(bytes / 1024).toFixed(0)} KB`);
  if (generated) out(`  feed built at : ${generated}  (${generatedAgeMin} min ago)${declaredTotal ? `   declares ${declaredTotal}` : ''}`);
  else out('  feed built at : no #GENERATED header (published by something other than the playlist builder)');

  // The parser fetches by URL; for a local file a data: URL keeps the exact same
  // code path (and Node's fetch supports data: URLs).
  const feedUrl = isUrl ? target : `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
  const channels = await parseLiveSourceChannels(
    { id: 'doctor', label: 'doctor', type: target.endsWith('.json') ? 'json' : 'm3u', url: feedUrl, priority: 99, trustTamil: true },
    { includeAll: true },
  );

  report.parsed = channels.length;
  report.byFormat = channels.reduce((acc, c) => { acc[c.format || 'unknown'] = (acc[c.format || 'unknown'] || 0) + 1; return acc; }, {});
  report.withClearKeys = channels.filter((c) => c.keyId && c.key).length;
  report.withHeaders = channels.filter((c) => c.userAgent || c.referer || c.cookie).length;

  out('');
  out(`  channels parsed        : ${channels.length}`);
  out(`  by format              : ${Object.entries(report.byFormat).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  out(`  unplayable formats     : ${channels.filter((c) => !c.playable).length}`);
  out(`  ClearKey-encrypted     : ${report.withClearKeys}   (never plays on Safari/iOS — no ClearKey CDM)`);
  out(`  need UA/Referer/Cookie : ${report.withHeaders}   (browser cannot set these → the server proxy carries them)`);

  // token audit
  report.tokens = tokenAudit(channels);
  const t = report.tokens;
  out('');
  out('  TOKEN AUDIT');
  out(`    rows carrying a CDN token : ${t.withToken}`);
  if (t.withToken) {
    out(`      expired                 : ${t.expired}   ${t.expired === t.withToken ? '← ALL DEAD: the feed is stale, rebuild it' : ''}`);
    out(`      die within 15 min       : ${t.expiringSoon}`);
    out(`      still valid             : ${t.valid}`);
    for (const row of t.soonest.slice(0, 3)) out(`        earliest expiry: ${new Date(row.expiresAt).toISOString()}  ${String(row.name).slice(0, 34)}`);
  }
  out(`    rows with no token        : ${t.noToken}`);

  // sample probe
  report.stage = 'probe';
  const step = Math.max(1, Math.floor(channels.length / Math.max(1, SAMPLE)));
  const picks = [];
  for (let i = 0; i < channels.length && picks.length < SAMPLE; i += step) picks.push(channels[i]);
  out('');
  out('  SAMPLE PROBE (from this machine — a datacenter IP may be refused where your browser is not)');
  const probes = [];
  for (const channel of picks) {
    const result = await probe(channel);
    probes.push({ name: channel.name, format: channel.format, url: channel.url.slice(0, 90), ...result, verdict: verdictFor(result) });
    out(`    ${String(result.status).padStart(3)}  ${String(result.kind || '').padEnd(4)}  ${String(channel.name).slice(0, 30).padEnd(30)} ${probe_line(result)}`);
  }
  report.probes = probes;
  report.reachable = probes.filter((p) => OK_STATUS(p.status) && (p.kind === 'HLS' || p.kind === 'DASH')).length;

  /* --------------------------------------------------------- verdict */

  // Two piles: `findings` are actionable and set the exit code, `notes` are
  // plain information (a ClearKey row is not a bug, and this machine's IP being
  // refused says nothing about the feed).
  const findings = [];
  const notes = [];

  if (!channels.length) findings.push('nothing parsed — check the URL/format (m3u vs json) and that the file is public');
  const staleShare = t.withToken ? t.expired / t.withToken : 0;
  if (t.withToken && staleShare === 1) findings.push(`every token row is expired (${t.expired}/${t.withToken}) — the feed has not been rebuilt since ${generated || 'its last publish'}; make the rebuild workflow actually run (it must live at .github/workflows/ on the repo ROOT)`);
  else if (staleShare >= 0.5) findings.push(`${t.expired}/${t.withToken} token rows are already expired — the feed is stale; rebuild every ~30 min`);
  if (generatedAgeMin !== null && generatedAgeMin > 45) findings.push(`feed is ${generatedAgeMin} min old; token feeds need rebuilding every ~30 min`);

  const refused = probes.filter((x) => [403, 451, 475].includes(x.status)).length;
  if (SAMPLE > 0 && report.reachable === 0 && refused === 0) {
    findings.push('no sampled channel returned a manifest from this machine — the feed is stale or those URLs are dead; open one in a browser to confirm');
  } else if (SAMPLE > 0 && refused > 0) {
    notes.push(`CDNs refused this machine on ${refused}/${probes.length} sampled channels (403/451/475) — a datacenter IP often is; re-check from your own network before calling those channels dead`);
  }

  if (report.withClearKeys) notes.push(`${report.withClearKeys} rows are ClearKey-encrypted: fine on Chrome/Edge/Firefox, unsupported on Safari/iOS by design`);
  if (report.withHeaders) notes.push(`${report.withHeaders} rows need a specific User-Agent / Referer / Cookie: a plain browser or VLC cannot send them — the app's server proxy can`);

  report.findings = findings;
  report.notes = notes;

  out('');
  out(line('─'));
  if (!findings.length) {
    out('  VERDICT: the feed looks healthy. If channels still do not play, the problem is app-side:');
    out('           source not added → not synced → channels not mapped to a catalog.');
    notes.forEach((n) => out(`  NOTE   : ${n}`));
  } else {
    findings.forEach((f, i) => out(`  ${i === 0 ? 'VERDICT' : '       '}: ${f}`));
  }
  out(line('─'));
  out('');
  out('  App-side checklist (Admin → TV Service):');
  out('    1. Sources → the feed URL is listed, enabled, type m3u, trustTamil ON');
  out('    2. Sync → the source reports parsed/kept counts (a 0 means the URL, not the app)');
  out('    3. Channels → map the ones you want into MainCH/Sports/… (unmapped = never shown)');
  out('    4. LIVE_SYNC_MINUTES=15 on the host, and one scheduler instance only');
  out('    5. Jio-family rows need a fresh __hdnea__ token (env JIO_COOKIE or Tools → paste)');

  report.ok = findings.length === 0;
  if (AS_JSON) console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  if (AS_JSON) console.log(JSON.stringify({ ...report, error: String(error?.message || error) }, null, 2));
  else {
    console.error(`  doctor failed at stage "${report.stage}": ${error?.message || error}`);
    if (String(error?.message || '').includes('HTTP 404')) console.error('  → the URL is wrong or the file is not on the default branch. Check it in a browser first.');
  }
  process.exit(1);
}

function probe_line(result) {
  if ((result.status === 200 || result.status === 206) && (result.kind === 'HLS' || result.kind === 'DASH')) return `manifest OK (${result.kind})`;
  if ([401, 403, 451, 475].includes(result.status)) return `CDN refused (${result.status}) — server IP blocked, may play on your device`;
  if (result.status === 404) return 'HTTP 404 — URL rotated/dead';
  if (result.status === 0) return `no response (${result.error || 'network'})`;
  return `HTTP ${result.status}`;
}
