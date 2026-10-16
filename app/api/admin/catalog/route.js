import { adminDeny } from '@/lib/adminAuth';
import { listAdminCatalog } from '@/lib/catalogAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/catalog?q=&filter=&page=&sort=&section= — the Home tab listing (raw titles included).
 *  `sort=home` (the default) mirrors the order viewers get, including pinned rows. */
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
      sort: searchParams.get('sort') || 'home',
      section: searchParams.get('section') || 'all',
    });
    return Response.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || 'Catalog read failed' }, { status: 500 });
  }
}
