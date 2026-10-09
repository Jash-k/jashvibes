'use client';
// Compatibility for the legacy MusicCurtains consumer retained in the fetched repo.
export { useMusic } from './MusicContext';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import SectionLoading from '@/components/SectionLoading';
const Engine = dynamic(() => import('./MusicEngine'), { ssr:false, loading:() => <SectionLoading title="Music Library"/> });
// Pay for the engine only after Music is first opened, then keep it mounted for uninterrupted audio.
export default function MusicProvider({ children }) {
  const pathname = usePathname();
  const [activated, setActivated] = useState(false);
  useEffect(() => { if (pathname === '/music') setActivated(true); }, [pathname]);
  return activated || pathname === '/music' ? <Engine>{children}</Engine> : children;
}
