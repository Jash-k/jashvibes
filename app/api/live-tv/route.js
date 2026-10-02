import { NextResponse } from 'next/server';
import { getFreshJioCookie, getLiveTVChannels, getDefaultLiveSources, injectJioCookie } from '@/lib/liveTv';
import { getLiveCatalogState } from '@/lib/liveService';
import { isJioChannel } from '@/lib/jioPlayback';
import { buildCatalogSummary, LIVE_CATALOGS } from '@/lib/liveCatalogs';
import LiveSource from '@/models/LiveSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sourceList(sources = []) {
  return sources.map((item) => ({
    id: item.sourceId || item.id,
    label: item.label,
    url: item.url,
    type: item.type,
    priority: item.priority ?? 99,
  }));
}

/** v10.8.0: the sources strip must never be empty — Mongo docs when the DB
    has them (fresh sync includes them), code defaults otherwise. */
async function sourcesForArea() {
  try {
    const LiveSource = (await import('@/models/LiveSource')).default;
    const docs = await LiveSource.find({}).sort({ priority: 1 }).lean();
    if (docs.length) return sourceList(docs);
  } catch { /* DB down — fall through to defaults */ }
  return getDefaultLiveSources().map((item) => ({
    id: item.id, label: item.label, url: item.url, type: item.type, priority: item.priority ?? 99,
  }));
}

async function decorateInitialJioFallback(payload = {}) {
  const channels = (payload.channels || []).map((channel, index) => ({
    ...channel,
    catalogs: [{ catalogId: 'main', position: (index + 1) * 100 }],
    catalogIds: ['main'],
    mapped: false,
    initialFallback: true,
  }));
  return {
    ...payload,
    source: 'jio-initial-fallback',
    channels,
    count: channels.length,
    catalogs: buildCatalogSummary(channels),
    sources: payload.sources?.length ? payload.sources : await sourcesForArea(),
    catalogConfigured: false,
    initialFallback: true,
    fromDb: false,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'all';
    const playableOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('playable') || '').toLowerCase());
    const workingOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('working') || searchParams.get('ok') || '').toLowerCase());
    const profileId = searchParams.get('profile') || 'default';

    if (source === 'all' && !workingOnly) {
      try {
        const state = await getLiveCatalogState({ profileId, playableOnly });
        const sources = await LiveSource.find({}).sort({ priority: 1 }).lean().catch(() => []);

        // Once any manual catalog mapping exists, the database catalog is the
        // only source for the main panel—even if the active profile currently
        // has zero visible channels. Raw source channels must never leak back in.
        if (state.configured || state.channels) {
          let hydratedChannels = state.channels;
          if (hydratedChannels.some((channel) => isJioChannel(channel))) {
            const jioCookie = await getFreshJioCookie();
            hydratedChannels = injectJioCookie(hydratedChannels, jioCookie);
          }
          const channels = playableOnly
            ? hydratedChannels.filter((channel) => channel.playable)
            : hydratedChannels;
          return NextResponse.json({
            updatedAt: new Date().toISOString(),
            source: 'manual-catalogs',
            profile: profileId,
            count: channels.length,
            configuredCount: state.configuredCount,
            channels,
            catalogs: buildCatalogSummary(channels),
            sources: sourceList(sources),
            catalogConfigured: true,
            initialFallback: false,
            fromDb: true,
          }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
        }
      } catch (dbError) {
        return NextResponse.json({ error: 'Saved Live catalogue is temporarily unavailable. Your mappings have not been reset.', channels: [], fromDb: false, initialFallback: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }

      // First-use bootstrap only: load Jio so the TV page remains useful before
      // the administrator has synced and manually mapped the first channel.
      const fallback = await getLiveTVChannels({ source: 'jio-tamil', playableOnly, workingOnly: false });
      return NextResponse.json(await decorateInitialJioFallback(fallback), {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    // Explicit source reads remain available for diagnostics/legacy clients,
    // but the main TV page never uses them after manual catalogs are configured.
    const payload = await getLiveTVChannels({ source, playableOnly, workingOnly });
    return NextResponse.json({ ...payload, catalogs: LIVE_CATALOGS, catalogConfigured: false }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/live-tv] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unable to load Live TV channels', channels: [], count: 0, catalogs: LIVE_CATALOGS },
      { status: 500 },
    );
  }
}
