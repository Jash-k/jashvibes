'use client';
import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';

function Pending({ label }) {
  const { pending } = useLinkStatus();
  return pending ? <span className="jv-navigation-feedback" role="status" aria-live="polite">Opening {label}…</span> : null;
}
// Next owns the transition lifetime, including cancelled/back/rapid navigation.
// Warm route code on intent, not every section's API or player on page load.
export default function SectionLink({ children, label = 'section', href, onPointerEnter, onFocus, onTouchStart, ...props }) {
  const router = useRouter();
  const warm = () => {
    if (navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) return;
    router.prefetch(href);
  };
  return <Link {...props} href={href} prefetch={false}
    onPointerEnter={event => { onPointerEnter?.(event); warm(); }}
    onFocus={event => { onFocus?.(event); warm(); }}
    onTouchStart={event => { onTouchStart?.(event); warm(); }}>
    {children}<Pending label={label}/>
  </Link>;
}
