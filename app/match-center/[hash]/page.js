'use client';

import { useParams } from 'next/navigation';
import SportsMatchCenter from '@/components/SportsMatchCenter';

export default function MatchCenterHashPage() {
  const params = useParams();
  return <SportsMatchCenter hash={params?.hash || ''} />;
}
