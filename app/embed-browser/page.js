'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

function normalizeHttpUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

export default function CleanEmbedBrowserPage() {
  const [sites, setSites] = useState([]);
  const [inputUrl, setInputUrl] = useState('');
  const [activeUrl, setActiveUrl] = useState('');
  const [activeLabel, setActiveLabel] = useState('Clean Embed');
  const [blockPopups, setBlockPopups] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;

    async function loadSites() {
      try {
        const response = await fetch('/api/embed-sites', { cache: 'no-store' });
        const data = await response.json();
        if (cancelled) return;

        const configured = data.sites || [];
        setSites(configured);

        const params = new URLSearchParams(window.location.search);
        const directUrl = normalizeHttpUrl(params.get('url') || '');
        const siteId = params.get('site') || '';
        const selected = configured.find((site) => site.id === siteId) || configured[0] || null;

        if (directUrl) {
          setActiveUrl(directUrl);
          setInputUrl(directUrl);
          setActiveLabel(params.get('title') || 'Custom URL');
        } else if (selected) {
          setActiveUrl(selected.url);
          setInputUrl(selected.url);
          setActiveLabel(selected.label);
        }

        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('ready');
      }
    }

    loadSites();
    return () => {
      cancelled = true;
    };
  }, []);

  const safeActiveUrl = useMemo(() => normalizeHttpUrl(activeUrl), [activeUrl]);

  function openUrl(event) {
    event.preventDefault();
    const next = normalizeHttpUrl(inputUrl);
    if (!next) {
      alert('Enter a valid http/https URL.');
      return;
    }
    setActiveUrl(next);
    setActiveLabel('Custom URL');
    setFrameKey((key) => key + 1);
  }

  function chooseSite(site) {
    setActiveUrl(site.url);
    setInputUrl(site.url);
    setActiveLabel(site.label);
    setFrameKey((key) => key + 1);
  }

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/';
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#050505] text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white"
            >
              ← Home
            </Link>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-red-500">Clean Embed</p>
          </div>

          <form onSubmit={openUrl} className="flex w-full gap-2 lg:max-w-xl">
            <input
              value={inputUrl}
              onChange={(event) => setInputUrl(event.target.value)}
              placeholder="Paste site URL..."
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black px-3 py-2.5 text-base font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-red-500 sm:px-4 sm:py-3 sm:text-sm"
              autoComplete="off"
              inputMode="url"
            />
            <button
              type="submit"
              className="rounded-2xl bg-red-600 px-3 py-2.5 text-sm font-black text-white transition hover:bg-red-500 sm:px-4 sm:py-3"
            >
              Open
            </button>
          </form>
        </div>
      </header>

      <section className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-6 sm:py-4 lg:px-8">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {sites.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => chooseSite(site)}
              className={`rounded-full border px-4 py-2 text-xs font-black transition ${
                safeActiveUrl === site.url
                  ? 'border-red-500 bg-red-600 text-white'
                  : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-red-500/50 hover:text-white'
              }`}
            >
              {site.label}
            </button>
          ))}

          <label className="flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-bold text-zinc-300 sm:ml-auto">
            <input
              type="checkbox"
              checked={blockPopups}
              onChange={(event) => {
                setBlockPopups(event.target.checked);
                setFrameKey((key) => key + 1);
              }}
              className="h-4 w-4 accent-red-600"
            />
            Block Popups
          </label>

          {safeActiveUrl ? (
            <>
              <button
                type="button"
                onClick={() => setFrameKey((key) => key + 1)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black text-white transition hover:border-red-500/50"
              >
                Reload
              </button>
              <a
                href={safeActiveUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black text-white transition hover:border-red-500/50"
              >
                Open Directly
              </a>
            </>
          ) : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-2 shadow-2xl shadow-black/30 sm:rounded-3xl sm:p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-start gap-2">
              <button
                type="button"
                onClick={goBack}
                aria-label="Go back"
                title="Back"
                className="group relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-red-400/40 bg-gradient-to-br from-red-600/35 via-red-950/30 to-black text-red-50 shadow-lg shadow-red-950/40 ring-1 ring-white/5 transition hover:-translate-x-0.5 hover:border-red-300 hover:from-red-500/45 active:scale-95"
              >
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.32),transparent_34%)] opacity-80" />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="relative h-5 w-5 drop-shadow-[0_0_8px_rgba(248,113,113,0.7)] transition group-hover:-translate-x-0.5"
                  fill="none"
                >
                  <path
                    d="M15.5 5.5 8.8 12l6.7 6.5"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9.5 12h9"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                </svg>
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black text-white">{activeLabel}</h1>
                <p className="mt-1 break-all text-xs text-zinc-500">
                  {safeActiveUrl || (status === 'loading' ? 'Loading configured sites...' : 'Set EMBED or paste a URL.')}
                </p>
              </div>
            </div>
            <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-100">
              {blockPopups ? 'Sandbox ON' : 'Sandbox OFF'}
            </span>
          </div>

          <div className="relative h-[calc(100dvh-18rem)] min-h-[58dvh] overflow-hidden rounded-2xl bg-black sm:aspect-video sm:h-auto sm:min-h-[70dvh]">
            <button
              type="button"
              onClick={goBack}
              aria-label="Go back"
              title="Back"
              className="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-red-300/50 bg-black/75 px-3 py-2 text-xs font-black text-red-50 shadow-xl shadow-red-950/50 backdrop-blur transition hover:-translate-x-0.5 hover:border-red-200 hover:bg-red-600/40 active:scale-95"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 drop-shadow-[0_0_8px_rgba(248,113,113,0.9)]" fill="none">
                <path d="M15.5 5.5 8.8 12l6.7 6.5" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.5 12h9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
              </svg>
              Back
            </button>
            {safeActiveUrl ? (
              <iframe
                key={`${frameKey}-${safeActiveUrl}-${blockPopups ? 'blocked' : 'open'}`}
                src={safeActiveUrl}
                title={activeLabel}
                className="h-full w-full border-0 bg-black"
                sandbox={blockPopups ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : undefined}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="origin-when-cross-origin"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-zinc-500">
                Configure an env URL or paste a site URL above.
              </div>
            )}
          </div>
        </div>

        <p className="px-1 text-xs leading-5 text-zinc-500">
          This blocks many popups/new-tab ads using iframe sandboxing. It cannot remove ads rendered inside the external site's own page. If a site breaks, turn off Block Popups or use Open Directly.
        </p>
      </section>
    </main>
  );
}
