'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { clearSessionCaches } from '@/lib/clientCache';
import MobileDock from '@/components/MobileDock';
import RailNav from '@/components/rail/RailNav';
import BootSplash from '@/components/BootSplash';
import LoadVeil from '@/components/LoadVeil';
import useLoadVeil from '@/components/useLoadVeil';
import { splashPhase } from '@/lib/bootPhase';
import { installFetchTracker } from '@/lib/loadProgress';

// The palette lives in the shell so search works from every section, not only Home.
const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false });

/* Routes that draw their own chrome. Music is a fixed canvas with its own rail and
   dock; Admin owns its whole screen; Watch, Live and the embed browser are full-bleed.
   /live is a locked 100dvh shell with its own header, rail and channel list — the shell
   MobileDock/day-night toggle would overlap it, especially on phones. */
const RAIL_SECTIONS = ['/', '/vault', '/extras', '/stremio', '/classics'];
const ownsOwnChrome = (pathname = '') => pathname.startsWith('/music') || pathname.startsWith('/admin')
  || pathname.startsWith('/watch') || pathname.startsWith('/live') || pathname.startsWith('/embed-browser');
const wantsRail = (pathname = '') => RAIL_SECTIONS.includes(pathname) || RAIL_SECTIONS.includes(`/${pathname.split('/')[1] || ''}`);

// Installed at module scope, not in an effect: a page's own effects run before the shell's,
// so the first section's requests would otherwise be invisible to the ring. `installFetchTracker`
// is idempotent and no-ops on the server.
installFetchTracker();

const STORAGE_KEY = 'jash_theatre_access_token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, options = {}, retries = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await response.text().catch(() => '');
        const isHtml = contentType.includes('text/html') || /^\s*</.test(text);
        const error = new Error(
          response.status === 503
            ? 'The server is temporarily unavailable (503). Wait a few seconds and try again.'
            : isHtml
              ? 'Server returned an HTML error page instead of JSON. This is usually a proxy/startup issue; try again in a few seconds.'
              : `Server returned ${contentType || 'a non-JSON response'} instead of JSON.`,
        );
        error.status = response.status;
        error.retryable = response.status >= 500 || response.status === 0 || isHtml;
        throw error;
      }

      const data = await response.json();
      return { response, data };
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable || error?.status >= 500 || error?.name === 'TypeError';
      if (!retryable || attempt === retries) throw error;
      await wait(700 * (attempt + 1));
    }
  }

  throw lastError || new Error('Request failed');
}

function syncThemeColor(mode) {
  try {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'day' ? '#faf7f2' : '#050012');
  } catch {}
}

function DayNightToggle() {
  // Night is the designed theme — day is the secondary option. First run
  // honors the OS preference so light-mode users still land in day mode.
  const [mode, setMode] = useState('night');
  const pathname = usePathname();
  const compactMobile = pathname !== '/';

  useEffect(() => {
    let initial = 'night';
    try {
      const saved = window.localStorage.getItem('jash_theme_mode');
      const sealed = window.localStorage.getItem('jash_theme_sealed');
      if (!sealed) {
        /* One-time migration: builds before K3 auto-saved the OS scheme, so a stored 'day' was
           never a human choice — TV browsers reported light and woke up white. Seal night; an
           explicit tap on the toggle re-seals whatever the human picks. */
        window.localStorage.setItem('jash_theme_mode', 'night');
        window.localStorage.setItem('jash_theme_sealed', '1');
        initial = 'night';
      } else {
        initial = saved === 'day' ? 'day' : 'night';
      }
    } catch {}
    setMode(initial);
    document.documentElement.classList.toggle('day-mode', initial === 'day');
    syncThemeColor(initial);
  }, []);

  function toggleMode() {
    const next = mode === 'day' ? 'night' : 'day';
    setMode(next);
    try { window.localStorage.setItem('jash_theme_mode', next); window.localStorage.setItem('jash_theme_sealed', '1'); } catch {}
    document.documentElement.classList.toggle('day-mode', next === 'day');
    syncThemeColor(next);
  }

  return (
    <button
      type="button"
      onClick={toggleMode}
      className={`fixed z-[90] grid place-items-center rounded-full border border-white/10 bg-black/70 text-zinc-200 shadow-xl shadow-black/30 backdrop-blur transition hover:border-yellow-400/50 day-night-toggle ${compactMobile ? 'right-2 top-[calc(0.45rem+env(safe-area-inset-top))] h-8 w-8 text-sm sm:right-4 sm:top-[calc(0.75rem+env(safe-area-inset-top))] sm:h-9 sm:w-9' : 'right-4 top-[calc(0.75rem+env(safe-area-inset-top))] h-9 w-9 text-base'}`}
      title="Switch day/night mode"
      aria-label="Switch day/night mode"
    >
      <span aria-hidden="true" style={{ lineHeight: 1 }}>{mode === 'day' ? '☀' : '☾'}</span>
    </button>
  );
}

export default function AuthGate({ children }) {
  const pathname = usePathname();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [splashElapsed, setSplashElapsed] = useState(0);
  const bootedAt = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());

  // One clock for the splash: it ticks only while the first paint is still on screen
  // and stops as soon as the gate has settled past the minimum, so it costs nothing.
  useEffect(() => {
    if (status !== 'checking' && splashPhase({ status, elapsedMs: splashElapsed }).visible === false) return undefined;
    const timer = setInterval(() => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      setSplashElapsed(now - bootedAt.current);
    }, 120);
    return () => clearInterval(timer);
  }, [status, splashElapsed]);

  // Search intent from the rail (and anywhere else that wants it later).

  useEffect(() => {
    const savedToken = window.localStorage.getItem(STORAGE_KEY);

    if (!savedToken) {
      setStatus('locked');
      return;
    }

    async function verifySavedAccess() {
      try {
        // The HttpOnly cookie is the real session, so ask about it first: one unlimited GET instead of a
        // POST against the endpoint the brute-force limiter guards.
        let response = await fetch('/api/auth', { method: 'GET', cache: 'no-store' });
        let data = response.ok ? { success: true } : {};
        if (!response.ok) {
          ({ response, data } = await fetchJsonWithRetry('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: savedToken }),
          }, 1));
        }

        if (!response.ok || !data.success) {
          throw new Error('Saved access expired');
        }

        if (data.token) window.localStorage.setItem(STORAGE_KEY, data.token);
        setStatus('unlocked');
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        clearSessionCaches();
        setStatus('locked');
      }
    }

    verifySavedAccess();
  }, []);

  async function unlock(event) {
    event.preventDefault();

    try {
      setStatus('verifying');
      setError('');

      const { response, data } = await fetchJsonWithRetry('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      }, 2);

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'Invalid password');
      }

      window.localStorage.setItem(STORAGE_KEY, data.token);
      setStatus('unlocked');
    } catch (err) {
      setError(err.message || 'Unable to unlock');
      setStatus('locked');
    }
  }

  function resetAccess() {
    window.localStorage.removeItem(STORAGE_KEY);
        clearSessionCaches();
    // Clear the HttpOnly session cookie server-side so API access is revoked too.
    fetch('/api/auth', { method: 'DELETE', cache: 'no-store' }).catch(() => {});
    setPassword('');
    setStatus('locked');
  }

  // Section switches: the ring lives in the shell, outside the keyed route wrapper, so it is
  // continuous across the commit while the content under it changes. See lib/loadProgress.js.
  // Called before any early return — Admin skips the shell, but hooks must still run in the
  // same order on every route or React unwinds the whole tree on the way in and out.
  const veil = useLoadVeil(pathname);

  if (pathname.startsWith('/admin')) {
    // Admin skips the shell (no rail, no dock, no keyed route wrapper), but it is a destination
    // like any other, so the ring is rendered here too — otherwise "every route" would quietly
    // mean "every route except the one at the bottom of the rail".
    return (
      <>
        {children}
        {veil.visible ? <LoadVeil revealing={veil.revealing} label={veil.label || 'Admin'} /> : null}
      </>
    );
  }

  const splash = splashPhase({ status, elapsedMs: splashElapsed });

  /* Unlocked: the shell. Rail and dock persist across every section, so a switch
     only ever repaints the content — which is what removes the flicker. */
  if (status === 'unlocked' && !splash.visible) {
    const showRail = wantsRail(pathname) && !ownsOwnChrome(pathname);
    return (
      <>
        {showRail ? <RailNav onOpenSearch={() => setPaletteOpen(true)} /> : null}
        {/* One keyed wrapper: every pathname change re-runs the content fade-in. While a
            switch is in flight it also carries the blur — applied at mount if the load is
            still running, so a freshly committed page never flashes sharp before it blurs. */}
        <div key={pathname} className={`jv-route-content${veil.blurring ? ' is-loading' : ''}`} aria-busy={veil.blurring || undefined}>
          {children}
        </div>
        {veil.visible ? <LoadVeil revealing={veil.revealing} label={veil.label} /> : null}
        {!ownsOwnChrome(pathname) ? <><DayNightToggle /><MobileDock /></> : null}
        <CommandPalette open={paletteOpen} onClose={setPaletteOpen} />
      </>
    );
  }

  /* First paint: one branded stage shared by the splash and the unlock card, so the
     gate resolving never flashes black or moves the card. */
  if (splash.visible) {
    return (
      <BootSplash
        phase={splash.phase}
        status={status}
        elapsedMs={splashElapsed}
        hint="Still checking your access — you can enter your password instead."
      />
    );
  }

  return (
    <div className="jv-boot jv-boot-card-stage">

      <div className="relative w-full max-w-md rounded-[1.75rem] bg-[linear-gradient(115deg,#f59e0b,#dc2626_50%,#a855f7)] p-[1.5px] shadow-2xl shadow-red-950/40">
      <form
        onSubmit={unlock}
        className="w-full rounded-[calc(1.75rem-1.5px)] bg-zinc-950/[0.97] p-5 backdrop-blur sm:p-8"
      >
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500">
          Private Space
        </p>
        <h1 className="jash-vibes-logo mt-3 text-3xl sm:text-4xl">JaSH ViBeS</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Enter your private access password. Once unlocked, this TV/mobile/browser remembers access using local storage.
        </p>

        <label className="mt-6 block text-sm font-semibold text-zinc-300">
          Password
          <div className="relative mt-2">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              ref={(node) => {
                // Autofocus only where a real keyboard exists — popping the
                // virtual keyboard on every phone/TV unlock is hostile.
                if (node && !node.dataset.autofocused && window.matchMedia?.('(pointer:fine)')?.matches) {
                  node.dataset.autofocused = '1';
                  node.focus({ preventScroll: true });
                }
              }}
              className="jv-input !mt-0 pr-16 transition focus:ring-2 focus:ring-brand-soft"
              placeholder="Enter password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2.5 py-1.5 text-xs font-black uppercase tracking-wider text-zinc-500 transition hover:text-white"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        {error ? (
          <div className="jv-shake mt-4 rounded-2xl border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={status === 'verifying' || !password}
          className="jv-btn-solid mt-6 w-full justify-center !rounded-2xl disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'verifying' ? 'Checking...' : 'Enter Theatre'}
        </button>
      </form>
      </div>
    </div>
  );
}
