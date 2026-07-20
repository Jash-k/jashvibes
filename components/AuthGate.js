'use client';

import { useEffect, useState } from 'react';

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
            ? 'Hugging Face is temporarily unavailable (503). Wait a few seconds and try again.'
            : isHtml
              ? 'Server returned an HTML error page instead of JSON. This is usually a Hugging Face proxy/startup issue; try again in a few seconds.'
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

function DayNightToggle() {
  const [mode, setMode] = useState('day');

  useEffect(() => {
    const saved = window.localStorage.getItem('jash_theme_mode') || 'day';
    setMode(saved);
    document.documentElement.classList.toggle('day-mode', saved === 'day');
  }, []);

  function toggleMode() {
    const next = mode === 'day' ? 'night' : 'day';
    setMode(next);
    window.localStorage.setItem('jash_theme_mode', next);
    document.documentElement.classList.toggle('day-mode', next === 'day');
  }

  return (
    <button
      type="button"
      onClick={toggleMode}
      className="fixed right-4 top-[calc(0.75rem+env(safe-area-inset-top))] z-[80] rounded-full border border-white/10 bg-black/70 px-3 py-2 text-xs font-black text-zinc-200 shadow-xl shadow-black/30 backdrop-blur transition hover:border-yellow-400/50 day-night-toggle"
      title="Switch day/night mode"
    >
      {mode === 'day' ? '☀ Day' : '☾ Night'}
    </button>
  );
}

export default function AuthGate({ children }) {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    const savedToken = window.localStorage.getItem(STORAGE_KEY);

    if (!savedToken) {
      setStatus('locked');
      return;
    }

    async function verifySavedAccess() {
      try {
        const { response, data } = await fetchJsonWithRetry('/api/auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: savedToken }),
        }, 1);

        if (!response.ok || !data.success) {
          throw new Error('Saved access expired');
        }

        window.localStorage.setItem(STORAGE_KEY, data.token);
        setStatus('unlocked');
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
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
    setPassword('');
    setStatus('locked');
  }

  if (status === 'checking') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-black text-zinc-100">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
      </main>
    );
  }

  if (status === 'unlocked') {
    return (
      <>
        {children}
        <DayNightToggle />
      </>
    );
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#050505] px-4 py-6 text-zinc-100 sm:px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(220,38,38,0.32),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(234,179,8,0.12),_transparent_35%)]" />

      <form
        onSubmit={unlock}
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black backdrop-blur sm:p-8"
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
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-red-500 focus:ring-2 focus:ring-red-500/30"
            placeholder="Enter password"
          />
        </label>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={status === 'verifying' || !password}
          className="mt-6 w-full rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'verifying' ? 'Checking...' : 'Enter Theatre'}
        </button>
      </form>
    </main>
  );
}
