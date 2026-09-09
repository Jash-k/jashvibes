'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import {
  DECADE_MAX_PAGES,
  DECADE_PAGE_LIMIT,
  FALLBACK_FACETS,
  buildDecades,
  decadeLabel,
  loadAllPages,
  readFacets,
  rowKey,
  shelfStatus,
} from '@/lib/classicsDecade';

/**
 * ReTro — the Decade Room, built from the picked mock (`docs/concepts/classics-redesign.html`, idea 3).
 *
 * The ruler of decades is the whole page: big numerals, an amber underline on the one you are in, the
 * decade written again behind the rows as a ghost, and each row carrying its own year and source in the
 * right gutter. Nothing else is a filter — no search box, no source select, no rating slab — because
 * the decade is the question you actually ask an archive.
 *
 * Two rules keep it honest and quick:
 *   1. it opens on the newest decade that has titles (two or three requests), not on "Everything"
 *      (thirteen), and it paints each page as it lands instead of waiting for the walk to finish;
 *   2. the chip that says `all 136 loaded` only appears when the rows on screen equal the `total` the
 *      same query reported — otherwise it counts down what is left and offers `Keep loading`.
 *
 * This surface is dark in both themes, like the homepage banner: day mode's blankets repaint anything
 * carrying a Tailwind background or text utility, and a light wash under a cinema wall is how "the art
 * is invisible and the title looks blurred" happened before. So every colour here is set on its own
 * class, and the rail and dock still follow the theme.
 */

const CACHE_KEY = 'jash:classics:v3';

function Ruler({ decades, undated, everything, value, onChange }) {
  const tabs = [
    ...decades,
    ...(undated ? [{ decade: 'undated', label: 'No year', count: undated, empty: false }] : []),
    { decade: 'all', label: 'All', count: everything, empty: false },
  ];

  return (
    <div className="jv-dec-ruler" role="tablist" aria-label="Decade">
      {tabs.map((tab, index) => {
        const active = String(tab.decade) === String(value);
        return (
          <button
            key={String(tab.decade)}
            type="button"
            role="tab"
            id={`jv-dec-tab-${tab.decade}`}
            aria-selected={active}
            aria-controls="jv-dec-shelf"
            tabIndex={active ? 0 : -1}
            disabled={Boolean(tab.empty)}
            className={`jv-dec-tab${active ? ' jv-dec-tab-on' : ''}${tab.empty ? ' jv-dec-tab-empty' : ''}`}
            onClick={() => onChange(tab.decade)}
            onKeyDown={(event) => {
              const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
              const step = keys[event.key];
              if (step === undefined) return;
              event.preventDefault();
              const next = tabs[Math.min(tabs.length - 1, Math.max(0, index + step))];
              if (!next || next.empty) return;
              onChange(next.decade);
              requestAnimationFrame(() => document.getElementById(`jv-dec-tab-${next.decade}`)?.focus());
            }}
          >
            <span className="jv-dec-tab-label">{tab.label}</span>
            <span className="jv-dec-tab-count">{tab.empty ? 'empty' : tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function TitleRow({ item }) {
  const score = Number(item.rating) || 0;
  const genres = item.genres?.slice(0, 3).join(', ');
  const sources = item.sources?.length ? item.sources.join(' + ') : 'source unlabelled';

  return (
    <Link href={`/classics/${item.id}`} className="jv-dec-row">
      {item.posterUrl ? (
        <img className="jv-dec-art" src={item.posterUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" />
      ) : (
        <span className="jv-dec-art jv-dec-art-none" aria-hidden="true">{String(item.title || '??').slice(0, 2).toUpperCase()}</span>
      )}
      <span className="jv-dec-info">
        <span className="jv-dec-name">{item.title}</span>
        <span className="jv-dec-meta">
          {genres ? `${genres} · ` : ''}{score ? `${score.toFixed(1)} · ` : 'unmatched · '}{sources}
          {item.streamsCount ? ` · ${item.streamsCount} stream${item.streamsCount === 1 ? '' : 's'}` : ' · no stream yet'}
        </span>
      </span>
      <span className="jv-dec-score">{score ? score.toFixed(1) : 'NR'}</span>
      <span className="jv-dec-gutter">
        <span className="jv-dec-gutter-year">{item.year || '—'}</span>
        <span className="jv-dec-gutter-src">{(item.sources?.[0] || 'retro').replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase()}</span>
      </span>
    </Link>
  );
}

function Note({ tone = 'muted', title, children, action }) {
  return (
    <div className={`jv-dec-note jv-dec-note-${tone}`}>
      <p className="jv-dec-note-title">{title}</p>
      {children ? <p className="jv-dec-note-body">{children}</p> : null}
      {action || null}
    </div>
  );
}

export default function TamilClassicsPage() {
  const [decade, setDecade] = useState(null);
  const [sort, setSort] = useState('year.asc');
  const [items, setItems] = useState([]);
  const [facets, setFacets] = useState(FALLBACK_FACETS);
  const [total, setTotal] = useState(0);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [complete, setComplete] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [budget, setBudget] = useState(DECADE_MAX_PAGES);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncSummary, setSyncSummary] = useState(null);

  const requestRef = useRef(0);
  const skipRef = useRef(false);
  const mountedRef = useRef(false);
  const autoSyncRef = useRef(false);

  const filters = useMemo(() => ({ sort }), [sort]);
  const shelf = decade === null ? 'all' : decade;
  const ruler = useMemo(
    () => buildDecades(facets, { filteredTotal: shelf === 'all' ? total : null, archiveTotal }),
    [facets, total, archiveTotal, shelf],
  );
  const line = shelfStatus({ loaded, total, complete, truncated, loading: reading });

  const requestShelf = useCallback(async (target, { budget: pages = DECADE_MAX_PAGES } = {}) => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    const isCurrent = () => mountedRef.current && requestRef.current === id;
    let first = true;

    setReading(true);
    setError('');
    let needsSync = false;
    try {
      const result = await loadAllPages({
        decade: target,
        filters,
        limit: DECADE_PAGE_LIMIT,
        maxPages: pages,
        isCurrent,
        fetchPage: async (query) => {
          const response = await fetch(`/api/vod?${query}`, { cache: 'no-store' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || 'Unable to read the archive');
          if (data?.needsSync) needsSync = true;
          // The ruler is only as good as the facets in this response — they arrive with page 1, and
          // storing them here is what puts the decades on the page at all.
          if (first && isCurrent()) {
            first = false;
            if (data?.facets) setFacets(data.facets);
            if (Number.isFinite(Number(data?.archiveTotal))) setArchiveTotal(Number(data.archiveTotal));
          }
          return data;
        },
        // Paint each page as it lands: the decade is readable after one request, not after the last.
        onProgress: ({ loaded: count, total: countTotal, items: rows }) => {
          if (!isCurrent()) return;
          setItems(rows);
          setLoaded(count);
          setTotal(countTotal || 0);
        },
      });
      if (result.stale) return;

      if (needsSync && !result.items.length && !autoSyncRef.current) {
        autoSyncRef.current = true;
        setReading(false);
        setStatus('sync-needed');
        return;
      }
      if (isCurrent()) {
        setItems(result.items);
        setTotal(result.total || 0);
        setLoaded(result.items.length);
        setComplete(result.complete);
        setTruncated(result.truncated);
        setStatus('ready');
      }
    } catch (err) {
      if (isCurrent()) {
        setError(err?.message || 'Unable to read the archive');
        setStatus('error');
      }
    } finally {
      if (isCurrent()) setReading(false);
    }
  }, [filters]);

  // One small request (`limit=1`) buys the ruler: counts per decade, the year span, and which decade
  // to open on. Doing it here rather than assuming "Everything" is what keeps the first paint fast.
  const probe = useCallback(async ({ pickDecade = true } = {}) => {
    try {
      const found = await readFacets({ fetchPage: async (query) => {
        const response = await fetch(`/api/vod?${query}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Unable to read the archive');
        return data;
      } });
      if (!found) return;
      setFacets(found.facets);
      setTotal(found.total);
      setArchiveTotal(found.archiveTotal);
      if (found.needsSync) {
        if (!autoSyncRef.current) {
          autoSyncRef.current = true;
          setStatus('sync-needed');
        }
        return;
      }
      if (pickDecade) setDecade((current) => (current === null ? found.ruler.landing : current));
    } catch (err) {
      setError(err?.message || 'Unable to read the archive');
      setStatus('error');
    }
  }, []);

  const syncNow = useCallback(async () => {
    try {
      setSyncStatus('syncing');
      setError('');
      const response = await fetch('/api/vod/sync', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Sync failed');
      setSyncSummary(data);
      setSyncStatus('done');
      setStatus('loading');
      await probe({ pickDecade: true });
      await requestShelf(decade ?? 'all', { budget });
    } catch (err) {
      setSyncStatus('error');
      setError(err?.message || 'Sync failed');
      setStatus('error');
    }
  }, [budget, decade, probe, requestShelf]);

  useEffect(() => {
    const cached = readSessionCache(CACHE_KEY);
    if (cached?.items?.length) {
      setDecade(cached.decade ?? 'all');
      setSort(cached.sort || 'year.asc');
      setItems(cached.items);
      setLoaded(cached.items.length);
      setTotal(cached.total || 0);
      setComplete(Boolean(cached.complete));
      setFacets((current) => cached.facets || current);
      setArchiveTotal(cached.archiveTotal || 0);
      setSyncSummary(cached.syncSummary || null);
      setStatus('ready');
      restoreScroll(CACHE_KEY);
      skipRef.current = true;
    }
    mountedRef.current = true;
    if (!cached?.items?.length) probe();
  }, [probe]);

  useEffect(() => {
    if (!mountedRef.current || decade === null) return;
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    requestShelf(decade, { budget });
  }, [budget, decade, requestShelf]);

  useEffect(() => {
    if (status === 'sync-needed' && syncStatus === 'idle') syncNow();
  }, [status, syncStatus, syncNow]);

  useEffect(() => {
    if (decade === null) return;
    writeSessionCache(CACHE_KEY, { decade, sort, items, total, complete, facets, archiveTotal, syncSummary });
  }, [archiveTotal, complete, decade, facets, items, sort, syncSummary, total]);

  useEffect(() => {
    const onScroll = () => saveScroll(CACHE_KEY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      saveScroll(CACHE_KEY);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const heading = decade === null
    ? 'Reading the shelf'
    : decade === 'all'
      ? 'The whole shelf'
      : decade === 'undated'
        ? 'No year on record'
        : `The ${decadeLabel(decade)}`;
  const span = ruler.minYear && ruler.maxYear ? `${ruler.minYear} — ${ruler.maxYear}` : 'no years yet';

  return (
    <>
      <RailNav />
      <main className="jv-dec-page jv-rail-shift">
        <div className="jv-dec">
          <header className="jv-dec-top">
            <h1 className="jv-dec-heading">
              Choose a decade
              <span className="jv-dec-span">· {span}</span>
            </h1>
            <div className="jv-dec-chips">
              <button
                type="button"
                className={`jv-dec-chip${sort === 'rating.desc' ? ' jv-dec-chip-on' : ''}`}
                onClick={() => setSort('rating.desc')}
                aria-pressed={sort === 'rating.desc'}
              >
                Rating ↓
              </button>
              <button
                type="button"
                className={`jv-dec-chip${sort === 'year.asc' ? ' jv-dec-chip-on' : ''}`}
                onClick={() => setSort('year.asc')}
                aria-pressed={sort === 'year.asc'}
              >
                Year ↑
              </button>
              <span className={`jv-dec-chip jv-dec-chip-static jv-dec-chip-${line.tone}`} aria-live="polite">{line.text}</span>
              {line.resumable ? (
                <button
                  type="button"
                  className="jv-dec-chip jv-dec-chip-go"
                  disabled={reading}
                  onClick={() => setBudget((current) => current + DECADE_MAX_PAGES)}
                >
                  Keep loading
                </button>
              ) : null}
              <button
                type="button"
                className="jv-dec-chip jv-dec-chip-sync"
                onClick={syncNow}
                disabled={syncStatus === 'syncing'}
                title="Re-read the sources, match each title with TMDB, and store it once"
              >
                {syncStatus === 'syncing' ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </header>

          <Ruler
            decades={ruler.decades}
            undated={ruler.undated}
            everything={ruler.accounted || ruler.archiveTotal || total}
            value={decade}
            onChange={(next) => {
              setBudget(DECADE_MAX_PAGES);
              setDecade(next);
            }}
          />

          <div className="jv-dec-body">
            <div className="jv-dec-ghost" aria-hidden="true">{decade === 'all' || decade === null ? span : decadeLabel(decade)}</div>

            {syncSummary && status === 'ready' ? (
              <p className="jv-dec-sync">
                Last sync · {syncSummary.stored} stored · {syncSummary.matched} matched · {syncSummary.unmatched} unmatched
              </p>
            ) : null}

            {(status === 'loading' || (reading && !items.length)) ? (
              <div className="jv-dec-skel" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, index) => <span key={index} className="jv-dec-skel-row" />)}
              </div>
            ) : null}

            {status === 'error' || syncStatus === 'error' ? (
              <Note
                tone="error"
                title="The archive did not answer"
                action={<button type="button" className="jv-dec-chip jv-dec-chip-go" onClick={() => requestShelf(shelf, { budget })}>Try again</button>}
              >
                {error}
              </Note>
            ) : null}

            {status === 'sync-needed' || syncStatus === 'syncing' ? (
              <Note tone="warn" title={syncStatus === 'syncing' ? 'First sync is running' : 'Nothing is in the archive yet'}>
                {syncStatus === 'syncing'
                  ? 'Titles are being read from the sources and matched against TMDB for year, poster and rating. This runs once — nothing here polls it.'
                  : 'The collection is empty. A sync pulls both sources, matches each title with TMDB, and stores it once in MongoDB.'}
              </Note>
            ) : null}

            {status === 'ready' && !total ? (
              <Note
                tone="empty"
                title={decade === 'all' ? 'Nothing here yet' : `Nothing from the ${decadeLabel(decade)} in this slice`}
                action={<button type="button" className="jv-dec-chip jv-dec-chip-go" onClick={() => setDecade('all')}>Show the whole shelf</button>}
              >
                The decade is real and this one is empty — that is the archive talking, not a page that stopped early.
                {ruler.unaccounted ? ` ${ruler.unaccounted} title(s) the ruler cannot place; check the sync.` : ''}
              </Note>
            ) : null}

            {items.length ? (
              <section className="jv-dec-shelf" id="jv-dec-shelf" aria-label={`${heading} — ${total || items.length} titles`}>
                {items.map((item) => <TitleRow key={rowKey(item)} item={item} />)}
              </section>
            ) : null}

            {status === 'ready' && items.length && !complete ? (
              <p className="jv-dec-end">{line.text}</p>
            ) : null}
            {status === 'ready' && items.length && complete ? (
              <p className="jv-dec-end">End of the decade · {total} of {ruler.archiveTotal || total} in the archive</p>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
