'use client';

import { useParams } from 'next/navigation';
import SportsMatchCenter from '@/components/SportsMatchCenter';

export default function MatchSlugPage() {
  const params = useParams();
  const rawSlug = Array.isArray(params?.slug) ? params.slug.join('/') : (params?.slug || 'live');
  return <SportsMatchCenter slug={rawSlug || 'live'} />;
}
