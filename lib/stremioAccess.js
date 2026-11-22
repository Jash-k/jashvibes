import dbConnect from '@/lib/db';
import { getSetting } from '@/models/Setting';

// Off for new and existing deployments until the owner explicitly enables it.
// Explicit STREMIO_ENABLED=false is an emergency hard stop over the DB switch.
export async function isStremioEnabled() {
  if (String(process.env.STREMIO_ENABLED || '').toLowerCase() === 'false') return false;
  try {
    await dbConnect();
    return (await getSetting('stremio_source_enabled', false)) === true;
  } catch { return false; }
}
export async function assertStremioEnabled() {
  if (!await isStremioEnabled()) throw Object.assign(new Error('Stremio is disabled by the owner.'), { status: 503 });
}
