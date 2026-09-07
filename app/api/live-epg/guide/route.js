import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import { getGuide, lineupFingerprint, lookupEpgChannels, refreshGuide } from '@/lib/liveEpg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The guide slice endpoint.
 *
 * The client sends *what it is showing* (`c` = `[[id, name, tvgId], …]`) and gets back only the
 * windows it renders: now / next / later per channel, plus the full day for the one focused channel
 * (`?day=<id>`). That keeps a 65 MB feed off the wire — the whole response for a 42-channel lineup
 * is a few KB, and the hour-expensive work happens once per hour inside `lib/liveEpg`.
 *
 * Auth: reads are behind the app session (middleware), writes need the service password, because
 * `refresh` re-downloads the feed.
 */

function json(data, status = 200, headers = {}) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

const MAX_CHANNELS = 400;

function parseLineup(raw = '') {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .slice(0, MAX_CHANNELS)
    .map((entry) => {
      if (Array.isArray(entry)) {
        const [id, name, tvgId] = entry;
        return { id: String(id || ''), name: String(name || ''), tvgId: String(tvgId || '') };
      }
      return {
        id: String(entry?.id || entry?.channelId || ''),
        name: String(entry?.name || ''),
        tvgId: String(entry?.tvgId || entry?.epgId || ''),
      };
    })
    .filter((entry) => entry.id || entry.name);
}

/** `now` keeps the description (the card shows it); everything else is title + clock. */
function brief(show) {
  if (!show) return null;
  return { from: show.from, to: show.to, title: show.title, minutes: show.minutes };
}

function trim(row, { withDay }) {
  return {
    id: row.id,
    name: row.name,
    matched: row.matched,
    epgId: row.epgId,
    epgName: row.epgName,
    via: row.via,
    progress: row.progress,
    nowMinutesLeft: row.nowMinutesLeft,
    minutesToNext: row.minutesToNext,
    count: row.count,
    now: row.now ? { ...brief(row.now), category: row.now.category, desc: row.now.desc } : null,
    lastEnded: brief(row.lastEnded),
    next: brief(row.next),
    later: (row.later || []).map(brief),
    ...(withDay ? { day: (row.day || []).map((show) => ({ ...brief(show), state: show.state, title: show.title })) } : {}),
  };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const lineup = parseLineup(url.searchParams.get('c') || '');
    if (lineup === null) return json({ ok: false, error: 'malformed lineup parameter' }, 400);
    // The service panel's binding picker: a name search over the feed's channel list. Served from the
    // same day index the page reads, so this never triggers a download of its own.
    const lookup = url.searchParams.get('lookup');
    if (lookup != null) {
      const result = await lookupEpgChannels(lookup, { limit: Math.min(40, Math.max(1, Number(url.searchParams.get('limit')) || 25)) });
      return json({
        ok: result.ok,
        error: result.error || '',
        results: (result.results || []).map((channel) => ({ id: channel.id, name: channel.name, logo: channel.logo || '' })),
      }, 200, { 'Cache-Control': 'private, max-age=60' });
    }

    const at = Number(url.searchParams.get('at')) || Date.now();
    const dayFor = String(url.searchParams.get('day') || '');

    const guide = await getGuide({ channels: lineup, at });
    const etag = `W/"${guide.status.loadedAt || 0}-${lineupFingerprint(lineup)}-${dayFor}"`;
    if (url.searchParams.get('if-none-match') === etag || request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    return json(
      {
        ok: guide.ok,
        at,
        day: guide.day,
        linked: guide.linked,
        unlinked: guide.unlinked,
        status: guide.status,
        channels: guide.channels.map((row) => trim(row, { withDay: Boolean(dayFor) && row.id === dayFor })),
      },
      200,
      // Short enough that a programme can never look stale by more than half a minute, long
      // enough that navigating back to /live is instant.
      { ETag: etag, 'Cache-Control': 'private, max-age=25, stale-while-revalidate=120' },
    );
  } catch (error) {
    // Never fail the page over a guide: the streams are independent of this feed.
    return json({ ok: false, error: String(error?.message || error), channels: [], linked: 0, unlinked: 0, status: {} }, 200);
  }
}

export async function POST(request) {
  try {
    requireServiceAuth(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '').trim();
    if (action !== 'refresh') return json({ ok: false, error: `unsupported action: ${action || '(none)'}` }, 400);
    const lineup = parseLineup(JSON.stringify(Array.isArray(body?.channels) ? body.channels : [])) || [];
    const result = await refreshGuide({ channels: lineup });
    return json({ ok: result.ok, status: result, error: result.error || '' });
  } catch (error) {
    const status = Number(error?.status) === 401 ? 401 : 500;
    return json({ ok: false, error: String(error?.message || error) }, status);
  }
}
