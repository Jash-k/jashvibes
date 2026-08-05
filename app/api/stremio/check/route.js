import { NextResponse } from 'next/server';
import { getStremioCatalog, getStremioStreams } from '@/lib/stremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeType(type = '') {
  return type === 'series' || type === 'tv' ? 'series' : 'movie';
}

function normalizeTitle(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(tamil|telugu|hindi|malayalam|kannada|english|multi audio|dual audio|movie|movies|series|web dl|hdrip|bluray|1080p|720p|480p)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemYear(item = {}) {
  return String(item.releaseInfo || item.year || item.releaseDate || '').match(/\b(19\d{2}|20\d{2})\b/)?.[1] || '';
}

function scoreCatalogMatch(item = {}, title = '', year = '') {
  const wanted = normalizeTitle(title);
  const candidate = normalizeTitle(item.title || item.name || '');
  if (!wanted || !candidate) return 0;
  let score = 0;
  if (candidate === wanted) score += 120;
  else if (candidate.includes(wanted) || wanted.includes(candidate)) score += 70;
  else {
    const wantedTokens = new Set(wanted.split(' ').filter((part) => part.length > 2));
    const candidateTokens = new Set(candidate.split(' ').filter((part) => part.length > 2));
    const overlap = [...wantedTokens].filter((token) => candidateTokens.has(token)).length;
    score += overlap * 15;
  }

  const wantedYear = String(year || '').match(/\b(19\d{2}|20\d{2})\b/)?.[1] || '';
  const foundYear = itemYear(item);
  if (wantedYear && foundYear && wantedYear === foundYear) score += 35;
  if (item.posterUrl) score += 3;
  return score;
}

function streamHref({ type, id, source, season = 1, episode = 1 }) {
  const params = new URLSearchParams({ source });
  if (type === 'series') {
    params.set('season', String(season || 1));
    params.set('episode', String(episode || 1));
  }
  return `/stremio-watch/${type}/${encodeURIComponent(id)}?${params.toString()}`;
}

async function checkById({ type, id, source, season, episode, tmdbId = 0 }) {
  const result = await getStremioStreams({ type, id, source, season, episode });
  return {
    ok: true,
    available: result.count > 0,
    count: result.count,
    blockedCount: result.blockedCount || 0,
    tmdbId: tmdbId || null,
    stremioId: id,
    resolvedId: result.resolvedId,
    attemptedIds: result.attemptedIds || [],
    href: result.count > 0 ? streamHref({ type, id, source, season, episode }) : '',
    source,
    streams: (result.streams || []).slice(0, 5),
  };
}

async function checkByTitleSearch({ type, title, year, preferredSource, season, episode }) {
  const sources = [...new Set([preferredSource || 'watch', 'catalog'].filter(Boolean))];
  const errors = [];

  for (const source of sources) {
    let catalog;
    try {
      catalog = await getStremioCatalog({ type, search: title, source, skip: 0 });
    } catch (error) {
      errors.push(`${source} search: ${error.message}`);
      continue;
    }

    const candidates = (catalog.items || [])
      .map((item) => ({ item, score: scoreCatalogMatch(item, title, year) }))
      .filter((entry) => entry.item?.id && entry.score >= 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    for (const { item, score } of candidates) {
      const itemType = normalizeType(item.type || type);
      try {
        const result = await getStremioStreams({ type: itemType, id: item.id, source, season, episode });
        if (result.count > 0) {
          return {
            ok: true,
            available: true,
            count: result.count,
            blockedCount: result.blockedCount || 0,
            stremioId: item.id,
            resolvedId: result.resolvedId,
            attemptedIds: result.attemptedIds || [],
            href: streamHref({ type: itemType, id: item.id, source, season, episode }),
            source,
            match: { title: item.title, id: item.id, score, year: itemYear(item) },
            streams: (result.streams || []).slice(0, 5),
          };
        }
      } catch (error) {
        errors.push(`${source} stream ${item.id}: ${error.message}`);
      }
    }
  }

  return {
    ok: true,
    available: false,
    count: 0,
    blockedCount: 0,
    href: '',
    reason: errors[0] || 'No Stremio search match with streams',
    errors: errors.slice(0, 5),
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = normalizeType(searchParams.get('type'));
    const tmdbId = Number(searchParams.get('tmdbId') || searchParams.get('tmdb') || 0);
    const id = String(searchParams.get('id') || '').trim();
    const title = String(searchParams.get('title') || '').trim();
    const year = String(searchParams.get('year') || '').trim();
    const source = searchParams.get('source') || 'watch';
    const season = Math.max(1, Number(searchParams.get('season') || searchParams.get('s') || 1));
    const episode = Math.max(1, Number(searchParams.get('episode') || searchParams.get('e') || 1));

    if (id) {
      const payload = await checkById({ type, id, source, season, episode });
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (tmdbId && !Number.isNaN(tmdbId)) {
      // Fast path: Telegram-Stremio supports tmdb ids directly. getStremioStreams
      // tries tmdb first and only falls back to IMDb if needed, so the Stremio
      // button can appear independently from embed-provider resolving.
      const stremioId = `tmdb:${tmdbId}`;
      const payload = await checkById({ type, id: stremioId, source, season, episode, tmdbId });
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (title) {
      const payload = await checkByTitleSearch({ type, title, year, preferredSource: source, season, episode });
      return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ ok: false, available: false, error: 'tmdbId, id, or title is required' }, { status: 400 });
  } catch (error) {
    console.error('[api/stremio/check] Error:', error);
    return NextResponse.json({ ok: false, available: false, error: error.message || 'Stremio check failed' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
