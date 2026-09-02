'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * BrandLogo — tappable JaSH ViBeS emblem (→ Home).
 * Resilient: if /brand/logo.png is missing on a deploy (file-wise uploads
 * often skip /public), falls back to logo-source.webp, then to a monogram
 * badge so a visible brand mark always shows.
 */
export default function BrandLogo({ href = '/', size = 'hero', className = '' }) {
  const sizes = {
    hero: 'h-12 w-12 sm:h-[7.25rem] sm:w-[7.25rem] lg:h-[7.25rem] lg:w-[7.25rem]',
    compact: 'h-10 w-10 sm:h-16 sm:w-16 lg:h-20 lg:w-20',
    mini: 'h-8 w-8 sm:h-9 sm:w-9',
  };
  const sizeClass = sizes[size] || sizes.hero;
  const [stage, setStage] = useState(0);

  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center justify-center rounded-full outline-none transition hover:scale-[1.02] focus:ring-2 focus:ring-fuchsia-300/50 ${className}`}
      aria-label="JaSH ViBeS home"
      title="JaSH ViBeS"
    >
      {stage < 2 ? (
        <img
          src={stage === 0 ? '/brand/logo.png' : '/brand/logo-source.webp'}
          alt="JaSH ViBeS logo"
          className={`${sizeClass} rounded-full object-contain drop-shadow-[0_0_28px_rgba(217,70,239,0.42)]`}
          loading="eager"
          decoding="async"
          onError={() => setStage((s) => s + 1)}
        />
      ) : (
        <span
          className={`${sizeClass} inline-flex items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-400 text-[60%] font-black text-white shadow-[0_0_22px_rgba(217,70,239,0.55)]`}
          aria-hidden="true"
        >
          JV
        </span>
      )}
    </Link>
  );
}
