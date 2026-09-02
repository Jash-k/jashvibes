'use client';

import { useParams } from 'next/navigation';
import SportsMatchCenter from '@/components/SportsMatchCenter';

export default function MatchCenterHashPage() {
  const params = useParams();
  const rawHash = Array.isArray(params?.hash) ? params.hash.join('/') : (params?.hash || '');
  return <SportsMatchCenter hash={rawHash} />;
}
