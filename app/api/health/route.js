import { NextResponse } from 'next/server';
import pkg from '../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const base = {
    ok: true,
    app: 'JaSH ViBeS',
    version: pkg.version,
    status: 'healthy',
    time: new Date().toISOString(),
  };

  // Base answer stays DB-free and instant: Render health checks and the
  // keep-alive ping hit this path, and a Mongo blip must not fail them.
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  if (!deep) return NextResponse.json(base, { headers: { 'Cache-Control': 'no-store' } });

  const detail = { ...base };
  try {
    const dbConnect = (await import('@/lib/db')).default;
    const mongoose = await dbConnect();
    const db = mongoose.connection.db;
    const count = async (name) => await db.collection(name).countDocuments().catch(() => null);
    const [vodSources, stremioAddons, catalogOverrides, musicPlaylists] = await Promise.all([
      count('vodsources'), count('stremioaddons'), count('catalogoverrides'), count('musicplaylists'),
    ]);
    detail.db = 'connected';
    detail.registries = { vodSources, stremioAddons, catalogOverrides, musicPlaylists };
  } catch (error) {
    detail.db = 'unreachable';
    detail.dbError = String(error?.message || 'unknown').slice(0, 160);
  }
  return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
}
