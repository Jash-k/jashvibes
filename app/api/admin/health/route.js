import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import { adminDeny } from '@/lib/adminAuth';
import AdminAction from '@/models/AdminAction';
import CatalogOverride from '@/models/CatalogOverride';
import LyricsOverride from '@/models/LyricsOverride';
import MusicPlaylist from '@/models/MusicPlaylist';
import StremioAddon from '@/models/StremioAddon';
import VaultOverride from '@/models/VaultOverride';
import LiveChannel from '@/models/LiveChannel';
import LiveSource from '@/models/LiveSource';
import { getCachedScrape, cacheAgeMs, isSyncDue } from '@/lib/tamilmvPayload';
import { readExtras } from '@/lib/extrasStore';
import { getLiveAutoSyncStatus } from '@/lib/liveAutoSync';
import { buildOrphanReport } from '@/lib/catalogOrphans';
import { findDuplicateGroups } from '@/lib/catalogBulk';
import { listAdminCatalog } from '@/lib/catalogAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/health — one screen that answers "is anything wrong?".
 *
 * Every section is gathered in isolation and reports its own failure, because a dashboard that
 * 500s when one collection is missing tells you nothing at all. Each number is either read from the
 * thing itself (counts, ages, statuses) or taken from the audit trail (when a sync last ran) —
 * never estimated.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;

  const sections = {
    database: await safe(sectionDatabase),
    catalog: await safe(sectionCatalog),
    overrides: await safe(sectionOverrides),
    vault: await safe(sectionVault),
    lyrics: await safe(sectionLyrics),
    live: await safe(sectionLive),
    music: await safe(sectionMusic),
    stremio: await safe(sectionStremio),
    extras: await safe(sectionExtras),
    history: await safe(sectionHistory),
    release: safeSync(sectionRelease),
  };

  const problems = [];
  if (sections.database?.ok === false) problems.push({ level: 'bad', text: 'The database is not reachable.' });
  for (const [name, section] of Object.entries(sections)) {
    if (section && section.ok === false && name !== 'database') problems.push({ level: 'warn', text: `${name}: ${section.error}` });
  }
  if (sections.catalog?.syncDue) problems.push({ level: 'warn', text: `The catalogue cache is ${sections.catalog.ageLabel} old — a sync is due.` });
  if (sections.overrides?.orphans) problems.push({ level: 'warn', text: `${sections.overrides.orphans} override(s) no longer point at any row.` });
  if (sections.overrides?.duplicateGroups) problems.push({ level: 'info', text: `${sections.overrides.duplicateGroups} duplicate group(s) found in the catalogue.` });
  if (sections.live?.dead) problems.push({ level: 'info', text: `${sections.live.dead} live channel(s) are marked dead.` });

  return NextResponse.json({ ok: true, at: new Date().toISOString(), sections, problems }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Never let one awkward collection take the dashboard down with it. */
async function safe(fn) {
  try {
    await dbConnect();
    return await fn();
  } catch (error) {
    return { ok: false, error: error.message || 'read failed' };
  }
}

function safeSync(fn) {
  try {
    return fn();
  } catch (error) {
    return { ok: false, error: error.message || 'read failed' };
  }
}

async function sectionDatabase() {
  const started = Date.now();
  const ready = mongoose.connection.readyState; // 1 = connected
  let ping = null;
  try {
    await mongoose.connection.db?.admin?.().ping?.();
    ping = Date.now() - started;
  } catch { ping = null; }
  return {
    ok: ready === 1,
    readyState: ready,
    state: ['disconnected', 'connected', 'connecting', 'disconnecting'][ready] || String(ready),
    latencyMs: ping,
    database: mongoose.connection.name || '',
  };
}

async function sectionCatalog() {
  const doc = await getCachedScrape();
  const age = cacheAgeMs(doc);
  const movies = doc?.movies?.length || 0;
  const series = doc?.series?.length || 0;
  return {
    ok: true,
    movies,
    series,
    titles: movies + series,
    refreshedAt: doc?.refreshedAt || doc?.updatedAt || null,
    ageMs: age,
    ageLabel: labelAge(age),
    syncDue: isSyncDue(doc),
    stale: age === null || age > 24 * 3600 * 1000,
  };
}

async function sectionOverrides() {
  const docs = await CatalogOverride.find({}).lean();
  const { rows } = await listAdminCatalog({ pageSize: 100000, filter: 'all', sort: 'home', section: 'all' });
  const report = buildOrphanReport(docs, rows);
  const groups = findDuplicateGroups(rows);
  return {
    ok: true,
    total: docs.length,
    hidden: docs.filter((doc) => doc.hidden).length,
    pinned: docs.filter((doc) => doc.pinned).length,
    corrected: docs.filter((doc) => doc.titleOverride || doc.yearOverride || doc.qualityOverride).length,
    orphans: report.count,
    duplicateGroups: groups.length,
    duplicateRows: groups.reduce((total, group) => total + group.rows.length, 0),
    catalogueRows: rows.length,
  };
}

async function sectionVault() {
  const docs = await VaultOverride.find({}).lean();
  const hidden = docs.filter((doc) => doc.hidden).length;
  const latest = docs.reduce((newest, doc) => {
    const at = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
    return at > newest ? at : newest;
  }, 0);
  return {
    ok: true,
    overrides: docs.length,
    hidden,
    visible: docs.length - hidden,
    lastEdit: latest ? new Date(latest).toISOString() : null,
  };
}

async function sectionLyrics() {
  const docs = await LyricsOverride.find({}).lean();
  const latest = docs.reduce((newest, doc) => {
    const at = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
    return at > newest ? at : newest;
  }, 0);
  return {
    ok: true,
    overrides: docs.length,
    // `origin: 'admin'` is what the panel writes; anything else came in from the app side.
    fromAdmin: docs.filter((doc) => doc.origin === 'admin').length,
    lastEdit: latest ? new Date(latest).toISOString() : null,
  };
}

async function sectionLive() {
  const [sources, channels] = await Promise.all([
    LiveSource.find({}).lean(),
    LiveChannel.find({}).lean(),
  ]);
  const alive = sources.filter((doc) => doc.deleted !== true);
  let status = null;
  try { status = getLiveAutoSyncStatus(); } catch { status = null; }
  const channelsByStatus = {};
  for (const doc of channels) {
    const key = String(doc.workingStatus || 'unknown');
    channelsByStatus[key] = (channelsByStatus[key] || 0) + 1;
  }
  return {
    ok: true,
    sources: alive.length,
    sourcesEnabled: alive.filter((doc) => doc.enabled !== false).length,
    channels: channels.length,
    mapped: channels.filter((doc) => (doc.catalogs || []).length).length,
    hidden: channels.filter((doc) => doc.hidden).length,
    favorite: channels.filter((doc) => doc.favorite).length,
    dead: channels.filter((doc) => String(doc.workingStatus || '').toLowerCase() === 'dead').length,
    byStatus: channelsByStatus,
    autoSync: status || null,
  };
}

async function sectionMusic() {
  const playlists = await MusicPlaylist.find({}).lean();
  const tracks = playlists.reduce((total, doc) => total + (doc.trackCount || 0), 0);
  const matched = playlists.reduce((total, doc) => total + (doc.matchedCount || 0), 0);
  return {
    ok: true,
    playlists: playlists.length,
    tracks,
    matched,
    // A parity dip here is the earliest sign that the music matcher stopped finding songs.
    matchRate: tracks ? Math.round((matched / tracks) * 100) : null,
  };
}

async function sectionStremio() {
  const addons = await StremioAddon.find({}).lean();
  return {
    ok: true,
    addons: addons.length,
    enabled: addons.filter((doc) => doc.enabled !== false).length,
    catalog: addons.filter((doc) => doc.kind !== 'watch').length,
    watch: addons.filter((doc) => doc.kind === 'watch').length,
  };
}

async function sectionExtras() {
  const { registry, source } = await readExtras('');
  return { ok: true, sites: registry?.sites?.length || 0, version: registry?.version ?? null, source };
}

async function sectionHistory() {
  const [latest, day, week] = await Promise.all([
    AdminAction.findOne({}).sort({ at: -1 }).lean(),
    AdminAction.countDocuments({ at: { $gte: new Date(Date.now() - 86400000) } }),
    AdminAction.countDocuments({ at: { $gte: new Date(Date.now() - 7 * 86400000) } }),
  ]);
  const lastSync = await AdminAction.findOne({ action: { $in: ['catalog.sync', 'catalog.purge'] } }).sort({ at: -1 }).lean();
  const lastSweep = await AdminAction.findOne({ action: 'live.sweep' }).sort({ at: -1 }).lean();
  return {
    ok: true,
    total: await AdminAction.countDocuments({}),
    last24h: day,
    last7d: week,
    latestAt: latest?.at || null,
    latest: latest ? { summary: latest.summary, action: latest.action } : null,
    lastSyncAt: lastSync?.at || null,
    lastSweepAt: lastSweep?.at || null,
  };
}

function sectionRelease() {
  const file = path.join(process.cwd(), 'RELEASE-MANIFEST.json');
  if (!fs.existsSync(file)) return { ok: true, present: false };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    ok: true,
    present: true,
    release: manifest.release || '',
    files: manifest.files?.length ?? manifest.fileCount ?? null,
    modules: manifest.modules?.length ?? manifest.moduleCount ?? null,
    generatedAt: manifest.generatedAt || null,
  };
}

function labelAge(ms) {
  if (ms === null || ms === undefined) return 'unknown';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
