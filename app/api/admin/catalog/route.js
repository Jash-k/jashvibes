import { adminDeny } from '@/lib/adminAuth';
import { listAdminCatalog } from '@/lib/catalogAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/catalog?q=&filter=&page= — the Home tab listing (raw titles included). */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const { searchParams } = new URL(request.url);
    const data = await listAdminCatalog({
      q: searchParams.get('q') || '',
      filter: searchParams.get('filter') || 'all',
      page: Number(searchParams.get('page') || 1),
      pageSize: Math.min(Number(searchParams.get('pageSize') || 25), 100),
    });
    return Response.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Catalog read failed' }, { status: 500 });
  }
}
