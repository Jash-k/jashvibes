import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import VodItem from '@/models/VodItem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid VOD id' }, { status: 400 });
    }

    await dbConnect();
    const item = await VodItem.findById(id).lean();
    if (!item) return NextResponse.json({ error: 'VOD item not found' }, { status: 404 });

    // If older syncs stored the same stream URL without DRM keys and a newer sync
    // stored it with keys, prefer the keyed copy so Aha ClearKey streams work.
    const byUrl = new Map();
    for (const stream of item.streams || []) {
      const existing = byUrl.get(stream.url);
      const streamHasKey = Boolean((stream.keyId && stream.key) || stream.licenseKey);
      const existingHasKey = Boolean((existing?.keyId && existing?.key) || existing?.licenseKey);
      if (!existing || (streamHasKey && !existingHasKey)) byUrl.set(stream.url, stream);
    }

    const streams = [...byUrl.values()].sort((a, b) => {
      const aKey = Number(Boolean((a.keyId && a.key) || a.licenseKey));
      const bKey = Number(Boolean((b.keyId && b.key) || b.licenseKey));
      if (aKey !== bKey) return bKey - aKey;
      return String(a.source || '').localeCompare(String(b.source || ''));
    });

    return NextResponse.json({
      item: {
        ...item,
        streams,
        id: String(item._id),
        _id: undefined,
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[api/vod/:id] Error:', error);
    return NextResponse.json({ error: error.message || 'Unable to load VOD item' }, { status: 500 });
  }
}
