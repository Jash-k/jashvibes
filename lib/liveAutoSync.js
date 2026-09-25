import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { getSetting, setSetting } from '@/models/Setting';
import { syncAllLiveSources, checkAndUpdateChannel } from '@/lib/liveService';

/**
 * Hourly live-source auto-sync (v10.2.0).
 *
 * The GitHub-hosted live sources this release added (Cricket 4K Pack, Willow &
 * FAST TV, Sports Backup) regenerate their playlists every few hours — a
 * playlist synced yesterday can carry yesterday's stream URLs. This scheduler
 * re-runs the exact admin "sync" engine on a timer, then health-probes the
 * cricket pack (the one source riding a single Cloudflare worker) so dead
 * channels surface in workingStatus without anyone pressing anything.
 *
 * Env:
 *   LIVE_SYNC_MINUTES=60   interval (min 15, max 720); 0 disables the scheduler
 * The admin can also pause/resume runs at runtime (Setting 'live_auto_sync'),
 * which wins over the env default — see /api/admin/tv/auto-sync.
 */

const SETTING_KEY = 'live_auto_sync';

// Only plain-HLS sources get the automatic post-sync probe. Jio-family
// channels short-circuit in checkChannelWorking anyway (CDNs block datacenter
// IPs while playing fine on devices), so probing them buys nothing.
const AUTO_SWEEP_SOURCE_IDS = ['romaxa55-sports'];
const AUTO_SWEEP_LIMIT = 120;

const state = (globalThis.__jashLiveAutoSync ||= {
  registered: false,
  running: false,
  startedAt: null,
  finishedAt: null,
  error: '',
  result: null,
  nextRunAt: null,
});

export function getLiveAutoSyncStatus() {
  const { running, startedAt, finishedAt, error, result, nextRunAt } = state;
  return { running, startedAt, finishedAt, error, result, nextRunAt };
}

function liveAutoSyncMinutes() {
  const raw = Number(process.env.LIVE_SYNC_MINUTES ?? 60);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(15, Math.min(720, raw));
}

export async function getLiveAutoSyncConfig() {
  const minutes = liveAutoSyncMinutes();
  let enabled = true;
  let dbOk = true;
  try {
    const stored = await getSetting(SETTING_KEY, { enabled: true });
    enabled = stored?.enabled !== false;
  } catch {
    dbOk = false; // no DB yet — env default applies, the toggle just can't persist
  }
  return { enabled, minutes, dbOk };
}

export async function setLiveAutoSyncEnabled(enabled) {
  await setSetting(SETTING_KEY, { enabled: Boolean(enabled) });
}

/** One full pass: sync every enabled source, then probe the cricket pack. */
export async function runLiveAutoSyncOnce({ trigger = 'schedule' } = {}) {
  if (state.running) return { started: false, status: getLiveAutoSyncStatus() };
  state.running = true;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.error = '';

  try {
    const sync = await syncAllLiveSources({ includeAll: true });
    let sweep = null;
    try {
      await dbConnect();
      let checked = 0;
      let dead = 0;
      for (const sourceId of AUTO_SWEEP_SOURCE_IDS) {
        const channels = await LiveChannel.find({ sourceId }).limit(AUTO_SWEEP_LIMIT);
        for (const channel of channels) {
          const ok = await checkAndUpdateChannel(channel);
          checked += 1;
          if (!ok) dead += 1;
        }
      }
      sweep = { checked, dead };
    } catch (sweepError) {
      sweep = { error: sweepError?.message || 'sweep failed' };
    }
    state.result = { trigger, sync, sweep };
    return { started: true, status: getLiveAutoSyncStatus() };
  } catch (error) {
    state.error = error?.message || 'Auto-sync failed';
    return { started: true, status: getLiveAutoSyncStatus() };
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
  }
}

/** Fire-and-forget trigger (admin "Sync now"). Returns immediately. */
export function startLiveAutoSync({ trigger = 'manual' } = {}) {
  if (state.running) return { started: false, status: getLiveAutoSyncStatus() };
  void runLiveAutoSyncOnce({ trigger }).catch(() => {});
  return { started: true, status: getLiveAutoSyncStatus() };
}

export function registerLiveAutoSyncScheduler() {
  if (state.registered) return;
  state.registered = true;

  const minutes = liveAutoSyncMinutes();
  if (!minutes) {
    console.info('[live-auto-sync] scheduler off (LIVE_SYNC_MINUTES=0)');
    return;
  }

  const tick = async () => {
    try {
      const config = await getLiveAutoSyncConfig();
      if (!config.enabled) return; // paused from admin — skip, keep the timer
      const outcome = await runLiveAutoSyncOnce({ trigger: 'schedule' });
      const summary = outcome?.status?.result?.sync;
      if (Array.isArray(summary)) {
        const okCount = summary.filter((row) => row.ok).length;
        console.info(`[live-auto-sync] pass done: ${okCount}/${summary.length} sources synced`);
      }
    } catch (error) {
      console.error('[live-auto-sync] tick failed:', error?.message || error);
    } finally {
      state.nextRunAt = Date.now() + minutes * 60 * 1000;
    }
  };

  // First pass after a 2-minute settle (let boot traffic die down), then fixed
  // cadence. unref() keeps the timers from holding the process open.
  const firstTimer = setTimeout(() => {
    void tick();
    setInterval(() => void tick(), minutes * 60 * 1000).unref?.();
  }, 2 * 60 * 1000);
  firstTimer.unref?.();

  console.info(`[live-auto-sync] scheduled every ${minutes} min (first pass in 2 min)`);
}
