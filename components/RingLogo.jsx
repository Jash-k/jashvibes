'use client';

import { useId } from 'react';

/**
 * RingLogo — the brand mark inside a progress ring. One object, used by the boot splash
 * and by every section switch, so the app has a single loading identity.
 *
 * The arc is an SVG circle whose `stroke-dashoffset` is driven by `progress` (0…1):
 * it starts at 12 o'clock, travels clockwise, and a small lit head sits at the tip so
 * the fill reads as light moving along a track rather than a bar filling up. The logo
 * blinks on its own rhythm and brightens slightly as the arc approaches the end, so the
 * two look like one device.
 *
 * Nothing here decides *when* to finish — `lib/loadProgress.js` owns that, and hands over
 * a number. Keeping the maths out of the drawing is why the ring can be trusted.
 */
export default function RingLogo({ progress = 0, size = 132, stroke = 3, logo = '/brand/logo.png', fallback = '/brand/logo-source.webp' }) {
  const gradientId = `jv-ring-${useId().replace(/:/g, '')}`;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = c * (1 - clamped);

  // Head of the arc: 12 o'clock is -90°, progress sweeps clockwise.
  const angle = (-90 + clamped * 360) * (Math.PI / 180);
  const headX = size / 2 + r * Math.cos(angle);
  const headY = size / 2 + r * Math.sin(angle);

  return (
    <span className="jv-ring" style={{ width: size, height: size, '--jv-ring-bright': 0.82 + clamped * 0.35 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d946ef" />
            <stop offset="55%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <circle className="jv-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="jv-ring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke={`url(#${gradientId})`}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
        {clamped > 0.01 && clamped < 0.999 ? (
          <circle className="jv-ring-head" cx={headX} cy={headY} r={stroke * 1.6} fill="#ffffff" />
        ) : null}
      </svg>
      <img
        className="jv-ring-logo"
        src={logo}
        alt=""
        width={size * 0.62}
        height={size * 0.62}
        loading="eager"
        decoding="async"
        onError={(event) => {
          const img = event.currentTarget;
          if (img.dataset.fallback !== '1') { img.dataset.fallback = '1'; img.src = fallback; }
          else img.style.visibility = 'hidden';
        }}
      />
    </span>
  );
}
