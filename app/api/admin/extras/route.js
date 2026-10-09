import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { readExtras, writeExtras } from '@/lib/extrasStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error) {
  // Do not expose connection strings, Mongo errors, signed URLs or internals.
  const status = [400, 404, 409, 413].includes(error?.status) ? error.status : 503;
  return json({ ok: false, error: status === 503 ? 'Website settings are unavailable. Check the database connection and retry.' : error.message }, status);
}
async function handle(request, command) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const origin = new URL(request.url).origin;
    if (!command) {
      const { registry, source } = await readExtras(origin);
      return json({ ok: true, ...registry, source });
    }
    const raw = await request.text();
    if (raw.length > 32_768) throw Object.assign(new Error('Website request is too large.'), { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid website request.'), { status: 400 });
    const action = command === 'patch' ? body.action : command;
    if (command === 'patch' && !['edit', 'reorder'].includes(action)) throw Object.assign(new Error('Unknown website action.'), { status: 400 });
    const registry = await writeExtras(action, body, origin);
    return json({ ok: true, ...registry, source: 'database' });
  } catch (error) { return failure(error); }
}
export const GET = request => handle(request);
export const POST = request => handle(request, 'add');
export const PATCH = request => handle(request, 'patch');
export const DELETE = request => handle(request, 'remove');
