import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Media from '@/models/Media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SCREENSCAPE_BASE_URL = 'https://screenscapeapi.dev';

function requireSeedToken(request) {
  const seedToken = process.env.SEED || process.env.SEED_TOKEN;

  // If SEED_TOKEN is configured, require it. This prevents public users from
  // repeatedly inserting demo data into your database.
  if (!seedToken) return true;

  const { searchParams } = new URL(request.url);
  return searchParams.get('token') === seedToken;
}

function normalizeScreenScapeItems(payload) {
  // ZinkMovies home returns { slider: Movie[], trending: Movie[] }
  const combined = [
    ...(Array.isArray(payload?.slider) ? payload.slider : []),
    ...(Array.isArray(payload?.trending) ? payload.trending : []),
    ...(Array.isArray(payload?.data?.items) ? payload.data.items : []),
    ...(Array.isArray(payload) ? payload : []),
  ];

  const seen = new Set();

  return combined
    .filter((item) => item && typeof item === 'object')
    .filter((item) => {
      const key = item.url || item.id || item.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isTamilItem(item) {
  const text = [item.language, item.title, item.category, item.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return text.includes('tamil');
}

function toMediaDocument(item) {
  const title = item.title || 'Untitled Tamil Title';
  const sourceUrl = item.url || item.postUrl || item.id || '';

  return {
    title,
    category: 'Tamil',
    synopsis: [item.year, item.quality, item.rating, item.type]
      .filter(Boolean)
      .join(' • '),
    posterUrl: item.imageUrl || item.image || item.thumbnail || '',
    // ZinkMovies details endpoint expects the movie URL path/full URL.
    // The /api/stream route will later call this externalId server-side.
    externalId: `/api/zinkmovies/details?url=${encodeURIComponent(sourceUrl)}`,
  };
}

const FALLBACK_TAMIL_ITEMS = [
  {
    title: 'Tamil Demo Title 1',
    category: 'Tamil',
    synopsis:
      'Demo Tamil catalog item. Replace externalId with a valid ScreenScape details/stream endpoint before playing.',
    posterUrl: '',
    externalId: '/api/zinkmovies/details?url=replace-with-valid-screenscape-url-1',
  },
  {
    title: 'Tamil Demo Title 2',
    category: 'Tamil',
    synopsis:
      'Demo Tamil catalog item for testing the JaSH THEATRE homepage grid.',
    posterUrl: '',
    externalId: '/api/zinkmovies/details?url=replace-with-valid-screenscape-url-2',
  },
  {
    title: 'Tamil Demo Title 3',
    category: 'Tamil',
    synopsis:
      'Demo Tamil catalog item. Use /api/seed?source=screenscape to import real metadata from ScreenScape.',
    posterUrl: '',
    externalId: '/api/zinkmovies/details?url=replace-with-valid-screenscape-url-3',
  },
];

export async function GET(request) {
  try {
    if (!requireSeedToken(request)) {
      return NextResponse.json({ error: 'Invalid seed token' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'fallback';

    await dbConnect();

    let docs = FALLBACK_TAMIL_ITEMS;
    let importedFrom = 'fallback-demo-items';

    if (source === 'screenscape') {
      const screenScapeKey = process.env.SCREENSCAPE || process.env.SCREENSCAPE_API_KEY;
      if (!screenScapeKey) {
        return NextResponse.json(
          { error: 'SCREENSCAPE or SCREENSCAPE_API_KEY is required for ScreenScape seeding' },
          { status: 500 }
        );
      }

      const screenScapeUrl = new URL('/api/zinkmovies?page=1', SCREENSCAPE_BASE_URL);
      screenScapeUrl.searchParams.set('key', screenScapeKey);

      const response = await fetch(screenScapeUrl, {
        method: 'GET',
        headers: {
          'x-api-key': screenScapeKey,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Failed to fetch ScreenScape catalog for seeding' },
          { status: response.status }
        );
      }

      const payload = await response.json();
      const tamilItems = normalizeScreenScapeItems(payload).filter(isTamilItem);
      docs = tamilItems.map(toMediaDocument);
      importedFrom = 'screenscape-zinkmovies';

      if (docs.length === 0) {
        return NextResponse.json(
          {
            error:
              'No Tamil items found from ScreenScape on this page. Try fallback seed or manually insert Tamil records.',
          },
          { status: 404 }
        );
      }
    }

    const operations = docs.map((doc) => ({
      updateOne: {
        filter: { externalId: doc.externalId },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    }));

    const result = await Media.bulkWrite(operations, { ordered: false });
    const tamilCount = await Media.countDocuments({ category: 'Tamil' });

    return NextResponse.json({
      success: true,
      importedFrom,
      attempted: docs.length,
      inserted: result.upsertedCount || 0,
      existingSkipped: docs.length - (result.upsertedCount || 0),
      tamilCount,
      nextStep: 'Open / to view Tamil items on the JaSH THEATRE homepage.',
    });
  } catch (error) {
    console.error('[api/seed] Error:', error);
    return NextResponse.json(
      { error: 'Unable to seed Tamil media catalog' },
      { status: 500 }
    );
  }
}
