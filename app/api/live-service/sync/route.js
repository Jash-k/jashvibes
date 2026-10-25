// Compatibility shim — the canonical handler now lives at
// /api/live/admin/sync. Kept for one release so in-flight clients and old
// tabs keep working; delete once deploy traffic has settled (phase 5).
// Route config is declared literally: Next.js does not follow re-exports for
// segment config, only for the handler functions below.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { POST } from '../../live/admin/sync/route.js';
