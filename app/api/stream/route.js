import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import Media from '@/models/Media';
import { tryScreenScapeSource } from '@/lib/streamResolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('mediaId');

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Missing required query parameter: mediaId' },
        { status: 400 }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return NextResponse.json({ error: 'Invalid mediaId' }, { status: 400 });
    }

    await dbConnect();

    const media = await Media.findById(mediaId).lean();

    if (!media) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    const source = media.sources?.find((item) => item.isActive !== false) || {
      externalId: media.externalId,
      provider: 'ScreenScape',
      label: 'Legacy Source',
    };

    if (!source?.externalId) {
      return NextResponse.json(
        { error: 'No stream source configured for this media item' },
        { status: 404 }
      );
    }

    const streamUrl = await tryScreenScapeSource(source);

    return NextResponse.json(
      { streamUrl },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('[api/stream] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error while resolving stream' },
      { status: 500 }
    );
  }
}
