'use client';

import { useParams } from 'next/navigation';
import SportsMatchCenter from '@/components/SportsMatchCenter';

export default function MatchSlugPage() {
  const params = useParams();
  return <SportsMatchCenter slug={params?.slug || ''} />;
}
