'use client';
import { Suspense } from 'react';
import LivePage from '@/components/live/LivePage';

export default function LivePageRoute() {
  // useSearchParams (the /live?channel= deep link used by the live homepage
  // hero) needs a Suspense boundary for the static-render contract.
  return (
    <Suspense fallback={(
      <div className="grid h-[100dvh] place-items-center bg-[#07070a]">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
      </div>
    )}
    >
      <LivePage />
    </Suspense>
  );
}
