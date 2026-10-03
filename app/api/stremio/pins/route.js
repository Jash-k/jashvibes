import { NextResponse } from 'next/server';
import { requireServiceAuth, verifyRequestToken } from '@/lib/serverAuth';
import { isValidAdminToken } from '@/lib/adminAuth';
import { rejectCrossOriginMutation } from '@/lib/signedSession';
import dbConnect from '@/lib/db';
import { getSetting, setSetting } from '@/models/Setting';
import StremioPin from '@/models/StremioPin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Global Stremio shelf pins — one order every device sees.
 *
 * GET            → [{catalogKey, sortOrder}] in shelf order
 * PUT {keys:[]}  → replace the whole shelf order
 * DELETE ?key=   → remove one pin (no key = reset all)
 *
 * WHO MAY WRITE (this is the bug this route was carrying):
 * the doc comment always said "session-gated: the /stremio page reads the shelf
 * order for the signed-in owner and writes pin toggles straight through", but
 * PUT/DELETE only accepted `requireServiceAuth` (the ADMIN realm). Normal use of
 * /stremio happens in a viewer session — you unlock the app, you pin a catalog —
 * so every write came back 401 and the page swallowed it, which is exactly why
 * "pinning does not last". Writes now accept either realm:
 *
 *   • viewer session (jash_access) — the /stremio page, which is the normal path
 *   • owner session  (jash_admin)  — the admin panel's Stremio tab and Reset
 *
 * Cross-origin mutations are refused for both realms (CSRF), and the write is
 * diff-based so a failure can never leave the shelf empty.
 */

/**
 * Resolve which realm (if any) is calling.
 * @returns {Promise<'admin'|'viewer'|''>}
 */
async function resolveActor(request) {
  const adminToken = request?.cookies?.get?.('jash_admin')?.value || request?.headers?.get?.('x-admin-token') || '';
  if (adminToken && (await isValidAdminToken(adminToken).catch(() => false))) return 'admin';
  if (verifyRequestToken(request)) return 'viewer';
  return '';
}

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Shared entry check for mutations. Returns a Response on rejection, else null. */
async function denyMutation(request) {
  if (rejectCrossOriginMutation(request)) {
    return json({ error: 'Cross-origin shelf mutation refused.' }, 403);
  }
  const actor = await resolveActor(request);
  if (!actor) return json({ error: 'Unlock JaSH ViBeS first.' }, 401);
  return null;
}

export async function GET(request) {
  if (!verifyRequestToken(request)) {
    return json({ error: 'Unlock JaSH ViBeS first.' }, 401);
  }
  await dbConnect();
  const pins = await StremioPin.find({}).sort({ sortOrder: 1 }).lean();
  const configured = Boolean(await getSetting('stremio_pins_initialized', false)) || pins.length > 0;
  return json({ ok: true, configured, pins: pins.map((pin) => pin.catalogKey) });
}

export async function PUT(request) {
  const denied = await denyMutation(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const keys = [...new Set(
    (Array.isArray(body?.keys) ? body.keys : [])
      .map((key) => String(key || '').trim())
      .filter(Boolean),
  )].slice(0, 40);

  try {
    await dbConnect();
    // Diff, do not truncate-and-reinsert: `deleteMany({})` followed by a failed
    // `insertMany` used to leave a permanently empty global shelf, and the
    // swallowed error meant nobody could tell.
    if (keys.length) {
      await StremioPin.deleteMany({ catalogKey: { $nin: keys } });
      await StremioPin.bulkWrite(
        keys.map((catalogKey, index) => ({
          updateOne: {
            filter: { catalogKey },
            update: { $set: { sortOrder: (index + 1) * 10 } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } else {
      await StremioPin.deleteMany({});
    }
    // Set the marker LAST: it is the "this shelf is owner-arranged, do not fall
    // back to defaults" flag, so it must not outlive a failed write.
    await setSetting('stremio_pins_initialized', true);
    return json({ ok: true, pins: keys });
  } catch (error) {
    return json({ error: `Could not save the shelf: ${error.message}` }, 500);
  }
}

export async function DELETE(request) {
  const denied = await denyMutation(request);
  if (denied) return denied;

  const key = new URL(request.url).searchParams.get('key') || '';
  try {
    await dbConnect();
    if (key) await StremioPin.deleteOne({ catalogKey: key });
    else await StremioPin.deleteMany({});
    return json({ ok: true });
  } catch (error) {
    return json({ error: `Could not clear the shelf: ${error.message}` }, 500);
  }
}
