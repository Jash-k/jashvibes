'use client';
import Link, { useLinkStatus } from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function PendingMusic() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span role="status" aria-live="polite" style={{position:'fixed',inset:0,zIndex:200,background:'#0b1519',color:'#edf3f3',display:'flex',flexDirection:'column',padding:'max(32px, env(safe-area-inset-top)) 24px',gap:20,fontFamily:'system-ui',fontSize:14,textAlign:'left',pointerEvents:'none'}}>
    <strong style={{fontSize:25}}>Music Library</strong><span>Opening your library…</span><span>New · Tracks · Albums · Artists · Playlists</span>
  </span>;
}
export default function MusicRouteLink({ children, ...props }) {
  const router = useRouter();
  useEffect(() => {
    if (navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) return;
    const timer = setTimeout(() => router.prefetch('/music'), 800);
    return () => clearTimeout(timer);
  }, [router]);
  return <Link {...props} prefetch={true} onPointerEnter={() => router.prefetch('/music')} onFocus={() => router.prefetch('/music')} onTouchStart={() => router.prefetch('/music')}>{children}<PendingMusic/></Link>;
}
