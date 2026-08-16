import { NextResponse } from 'next/server';
import pkg from '../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      app: 'JaSH ViBeS',
      version: pkg.version,
      status: 'healthy',
      time: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
