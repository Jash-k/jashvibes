'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import {
  DECADE_MAX_PAGES,
  DECADE_PAGE_LIMIT,
  buildDecades,
  decadeLabel,
  groupRowsByYear,
  loadAllPages,
  rowKey,
  shelfStatus,
} from '@/lib/classicsDecade';

/**
 * ReTro — the Decade Room.
 *
 * The year is the navigation: you choose a decade on the ruler and the page reads that decade to the
 * end. It is deliberately not a paged grid any more, because a grid that shows 24 of 118 titles is how
 * "the filter doesn't show all my movies" gets reported. Two rules carry that promise:
 *
 *   1. every fetch walks pages until the API stops promising more (`loadAllPages`), and
 *   2. the header states `All 118 loaded` only when the rows on screen match the count the same query
 *      reported — otherwise it says how many are missing and offers the button to keep going.
 *
 * Titles with no year (unmatched TMDB, mostly) are a tab of their own, so a year window cannot silently
 * lose them. Sources default to *all*: the old page opened on `Aha`, which hid every ErosNow title.
 */

const CACHE_KEY = 'jash:classics:v2';
const DEFAULT_FILTERS = { q: '', sort: 'year.asc', source: 'all', genre: 'all', minRating: '' };
const RATING_FLOORS = ['', '7', '8', '8.5'];
const SORTS = [
  ['year.asc', 'Oldest first'],
  ['year.desc', 'Newest first'],
  ['rating.desc', 'Rating high → low'],
  ['title.asc', 'Title A–Z'],
];

const initialsFor = (title = '') => title.replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || '??';

function Ruler({ decades, undated, total, value, onChange }) {
  const tabs = [
    { decade: 'all', label: 'Everything', count: total, empty: false },
    ...decades,
    ...(undated ? [{ decade: 'undated', label: 'No year', count: undated, empty: false }] : []),
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
  const meta = [
    item.genres?.slice(0, 2).join(' · '),
    item.sources?.length ? item.sources.join(' + ') : 'source unlabelled',
    item.streamsCount ? `${item.streamsCount} stream${item.streamsCount === 1 ? '' : 's'}` : 'no stream yet',
    item.tmdbMatched ? '' : 'not matched on TMDB',
  ].filter(Boolean).join('  ·  ');

  return (
    <Link href={`/classics/${item.id}`} className="jv-dec-row">
      <span className="jv-dec-year">{item.year || '—'}</span>
      {item.posterUrl ? (
        <img className="jv-dec-thumb" src={item.posterUrl} alt="" aria-hidden="true" loading="lazy" decoding="async" />
      ) : (
        <span className="jv-dec-thumb jv-dec-thumb-none" aria-hidden="true">{initialsFor(item.title)}</span>
      )}
      <span className="jv-dec-info">
        <span className="jv-dec-title">{item.title}</span>
        <span className="jv-dec-meta">{meta}</span>
      </span>
      <span className="jv-dec-score">
        <span className="jv-dec-score-num">{score ? score.toFixed(1) : 'NR'}</span>
        <span className="jv-dec-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.min(100, score * 10))}%` }} /></span>
        <span className="jv-dec-votes">{item.voteCount ? `${(item.voteCount / 1000).toFixed(1)}k votes` : 'unrated'}</span>
      </span>
    </Link>
  );
}

function Note({ tone = 'muted', title, children, action }) {
  return (
    <div className={`jv-dec-note jv-dec-note-${tone}`}>
      <div>
        <p className="jv-dec-note-title">{title}</p>
        {children ? <p className="jv-dec-note-body">{children}</p> : null}
      </div>
      {action || null}
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <div className="jv-dec-skel" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} className="jv-dec-skel-row" />
      ))}
    </div>
  );
}

export default function TamilClassicsPage() {
  const [decade, setDecade] = useState('all');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [items, setItems] = useState([]);
  const [facets, setFacets] = useState({ sources: [], genres: [], years: [], minYear: null, maxYear: null });
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

  const shelf = useMemo(() => groupRowsByYear(items, { sort: filters.sort }), [items, filters.sort]);
  const ruler = useMemo(
    () => buildDecades(facets, { filteredTotal: decade === 'all' ? total : null, archiveTotal }),
    [facets, total, archiveTotal, decade],
  );
  const shelfLine = shelfStatus({ loaded, total, complete, truncated, loading: reading });
  const filtersDirty = useMemo(
    () => Object.keys(DEFAULT_FILTERS).some((key) => String(filters[key] ?? '') !== DEFAULT_FILTERS[key]),
    [filters],
  );

  const readShelf = useCallback(async () => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    const isCurrent = () => mountedRef.current && requestRef.current === id;

    setReading(true);
    setError('');
    let needsSync = false;
    try {
      const result = await loadAllPages({
        decade,
        filters,
        limit: DECADE_PAGE_LIMIT,
        maxPages: budget,
        isCurrent,
        fetchPage: async (query) => {
          const response = await fetch(`/api/vod?${query}`, { cache: 'no-store' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || 'Unable to read the archive');
          if (data?.needsSync) needsSync = true;
          return data;
        },
        onProgress: ({ loaded: count, total: countTotal }) => {
          if (isCurrent()) {
            setLoaded(count);
            setTotal(countTotal || 0);
          }
        },
      });
      if (result.stale) return;

      if (needsSync && !result.items.length && !autoSyncRef.current) {
        autoSyncRef.current = true;
        setStatus('sync-needed');
        setReading(false);
        return;
      }

      if (isCurrent()) {
        // loadAllPages deduped the rows and checked them against `total`; render what it verified.
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
  }, [budget, decade, filters]);

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
      await readShelf();
    } catch (err) {
      setSyncStatus('error');
      setError(err?.message || 'Sync failed');
      setStatus('error');
    }
  }, [readShelf]);

  // A return to ReTro should land on the same decade, filters and scroll position, and it should not
  // re-walk the shelf just to find the rows it already has — so the restore sets `skipRef` and the
  // fetch effect below skips exactly one run. Without this, mounting fetched twice: the old page did.
  useEffect(() => {
    const cached = readSessionCache(CACHE_KEY);
    if (cached?.items?.length) {
      setDecade(cached.decade ?? 'all');
      setFilters(cached.filters || DEFAULT_FILTERS);
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
  }, []);

  useEffect(() => {
    if (!mountedRef.current) return;
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    readShelf();
  }, [readShelf]);

  useEffect(() => {
    if (status === 'sync-needed' && syncStatus === 'idle') syncNow();
  }, [status, syncStatus, syncNow]);

  useEffect(() => {
    writeSessionCache(CACHE_KEY, { decade, filters, items, total, complete, facets, archiveTotal, syncSummary });
  }, [decade, filters, items, total, complete, facets, archiveTotal, syncSummary]);

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

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const heading = decade === 'all' ? 'The whole shelf' : decade === 'undated' ? 'No year on record' : `The ${decadeLabel(decade)}`;

  return (
    <main className="jv-dec-page jv-rail-shift">
      <div className="jv-dec">
        <header className="jv-dec-top">
          <div className="jv-dec-head">
            <p className="jv-dec-eyebrow">ReTro · the decade room</p>
            <h1 className="jv-dec-h1">
              {heading}
              <span className="jv-dec-h1-count">{total} title{total === 1 ? '' : 's'}</span>
            </h1>
            <p className="jv-dec-sub">
              {shelfLine.text}
              {' · '}
              {filters.source === 'all' ? 'all sources' : filters.source}
              {' · '}
              {SORTS.find(([value]) => value === filters.sort)?.[1] || 'year'}
              {ruler.undated && decade !== 'undated' ? ` · ${ruler.undated} with no year are kept in their own tab` : ''}
            </p>
            {syncSummary ? (
              <p className="jv-dec-sync">
                Last sync: {syncSummary.stored} stored · {syncSummary.matched} matched · {syncSummary.unmatched} unmatched
              </p>
            ) : null}
          </div>

          <div className="jv-dec-actions">
            <label className="jv-dec-search">
              <span className="jv-dec-sr">Search the archive</span>
              <input
                value={filters.q}
                onChange={(event) => updateFilter('q', event.target.value)}
                placeholder={archiveTotal ? `Search ${archiveTotal} titles…` : 'Search the archive…'}
                inputMode="search"
              />
            </label>
            <button
              type="button"
              className="jv-dec-sync-btn"
              onClick={syncNow}
              disabled={syncStatus === 'syncing'}
              title="Re-read the M3U sources and re-match against TMDB"
            >
              {syncStatus === 'syncing' ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </header>

        <Ruler
          decades={ruler.decades}
          undated={ruler.undated}
          total={ruler.accounted || ruler.archiveTotal || total}
          value={decade}
          onChange={(next) => {
            setBudget(DECADE_MAX_PAGES);
            setDecade(next);
          }}
        />

        <div className="jv-dec-tools">
          <label className="jv-dec-tool">
            <span>Source</span>
            <select value={filters.source} onChange={(event) => updateFilter('source', event.target.value)}>
              <option value="all">All sources</option>
              {(facets.sources || []).map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
          </label>
          {(facets.genres || []).length ? (
            <label className="jv-dec-tool">
              <span>Genre</span>
              <select value={filters.genre} onChange={(event) => updateFilter('genre', event.target.value)}>
                <option value="all">Every genre</option>
                {facets.genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
              </select>
            </label>
          ) : null}
          <label className="jv-dec-tool">
            <span>Sort</span>
            <select value={filters.sort} onChange={(event) => updateFilter('sort', event.target.value)}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="jv-dec-tool">
            <span>Rating</span>
            <select value={filters.minRating} onChange={(event) => updateFilter('minRating', event.target.value)}>
              {RATING_FLOORS.map((floor) => <option key={floor || 'any'} value={floor}>{floor ? `${floor}+` : 'Any'}</option>)}
            </select>
          </label>
          {filtersDirty ? (
            <button type="button" className="jv-dec-clear" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>
          ) : null}
          <span className="jv-dec-loaded">{loaded} / {total || '—'}</span>
        </div>

        {ruler.decades.length ? (
          <div className="jv-dec-ghost" aria-hidden="true">{decade === 'all' ? `${ruler.decades[0].decade}s → ${ruler.decades[ruler.decades.length - 1].decade}s` : decadeLabel(decade)}</div>
        ) : null}

        {status === 'loading' || reading ? (
          <ShelfSkeleton />
        ) : null}

        {status === 'error' || syncStatus === 'error' ? (
          <Note
            tone="error"
            title="The archive did not answer"
            action={<button type="button" className="jv-dec-btn" onClick={readShelf}>Try again</button>}
          >
            {error}
          </Note>
        ) : null}

        {status === 'sync-needed' || syncStatus === 'syncing' ? (
          <Note tone="warn" title={syncStatus === 'syncing' ? 'First sync is running' : 'Nothing is in the archive yet'}>
            {syncStatus === 'syncing'
              ? 'Titles are being read from the M3U sources and matched against TMDB. This is the slow part, and it runs once — nothing here polls it.'
              : 'The collection is empty. A sync pulls both sources, matches each title with TMDB for year, poster and rating, and stores it once.'}
          </Note>
        ) : null}

        {status === 'ready' && !total ? (
          <Note
            tone="empty"
            title={decade === 'all' ? 'Nothing matches those filters' : `Nothing from the ${decadeLabel(decade)} matches those filters`}
            action={
              <button
                type="button"
                className="jv-dec-btn"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setDecade('all');
                }}
              >
                Show everything
              </button>
            }
          >
            The decade is real, but this slice of the archive is empty. Clear the source or rating filter before you trust the blank.
          </Note>
        ) : null}

        {status === 'ready' && total ? (
          <section className="jv-dec-shelf" id="jv-dec-shelf" aria-label={`${heading} — ${total} titles`}>
            {shelf.map((group) => (
              <div className="jv-dec-group" key={`${group.year}-${group.label}`}>
                <p className="jv-dec-group-head">
                  <b>{group.label}</b>
                  <em>{group.count} title{group.count === 1 ? '' : 's'}</em>
                </p>
                {group.items.map((item) => <TitleRow key={rowKey(item)} item={item} />)}
              </div>
            ))}
          </section>
        ) : null}

        {status === 'ready' && total && !complete ? (
          <div className="jv-dec-more">
            <button type="button" className="jv-dec-btn" onClick={() => setBudget((current) => current + DECADE_MAX_PAGES)} disabled={reading}>
              {reading ? 'Reading…' : `Keep loading — ${Math.max(0, total - loaded)} still to fetch`}
            </button>
          </div>
        ) : null}

        {status === 'ready' && total && complete ? (
          <p className="jv-dec-end">End of the decade · {total} of {ruler.archiveTotal || total} titles in the archive</p>
        ) : null}
      </div>
    </main>
  );
}
