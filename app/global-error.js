'use client';

/*
 * app/global-error.js — the boundary of last resort, for crashes that take out
 * the root layout itself (AuthGate, the theme bootstrapping). Next renders
 * nothing but this component then, so it must carry its own <html>/<body>.
 * Deliberately plain: if the root layout crashed, the fonts, the gradient
 * wordmark styles and the dock may be the thing that failed, so this page
 * relies on inline-safe Tailwind utilities only.
 */

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#050505', color: '#f4f4f5', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: '26rem', width: '100%', textAlign: 'center' }}>
            <p style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '0.01em', background: 'linear-gradient(100deg,#f6c453,#e0342f 45%,#a855f7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
              JaSH ViBeS
            </p>
            <h1 style={{ marginTop: '1rem', fontSize: '1.15rem', fontWeight: 800 }}>The app failed to start</h1>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', lineHeight: 1.6, color: '#a1a1aa' }}>
              A startup error stopped the shell from loading. Reloading usually fixes it. Your
              library on this device is not affected.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: '1.5rem', borderRadius: '0.75rem', background: '#dc2626', color: '#fff', border: 'none', padding: '0.65rem 1.25rem', fontSize: '0.875rem', fontWeight: 800, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
