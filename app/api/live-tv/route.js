import { NextResponse } from 'next/server';
import { getFreshJioCookie, getLiveTVChannels, injectJioCookie } from '@/lib/liveTv';
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

function decorateInitialJioFallback(payload = {}) {
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
        if (state.configured) {
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
        // Never guess that the service is unconfigured when storage is unavailable:
        // doing so could leak the raw Jio list after an administrator has mapped it.
        console.error('[api/live-tv] Manual catalog lookup failed:', dbError.message);
        return NextResponse.json({
          error: 'Live TV catalog storage is temporarily unavailable',
          channels: [],
          count: 0,
          catalogs: LIVE_CATALOGS,
          catalogConfigured: null,
          initialFallback: false,
        }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } });
      }

      // First-use bootstrap only: load Jio so the TV page remains useful before
      // the administrator has synced and manually mapped the first channel.
      const fallback = await getLiveTVChannels({ source: 'jio-tamil', playableOnly, workingOnly: false });
      return NextResponse.json(decorateInitialJioFallback(fallback), {
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
