'use client';

import Link from 'next/link';
import { watchHref } from '@/lib/watch/policy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EmbedSiteLinks from '@/components/EmbedSiteLinks';
import RailNav from '@/components/rail/RailNav';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import { POSTER_SIZES_ATTR, tmdbImageSrcSet } from '@/lib/tmdbPoster';
import { revealStyle, useReveal } from '@/lib/useReveal';
import {
  FILTER_FIELDS,
  SELECTED_KEY,
  SHELF_KEY,
  SHELF_MAX_PAGES,
  activeFilterCount,
  buildRuler,
  buildShelfQuery,
  catalogKey,
  catalogLabel,
  defaultFilters,
  emptyShelfEntry,
  fetchCatalogPage,
  filterOptions,
  getDefaultPins,
  markShelfError,
  markShelfLoading,
  optionLabel,
  readCatalogOptions,
  rowKey,
  safeFilters,
  shelfLine,
  supportsExtra,
} from '@/lib/stremioShelf';

/**
 * Stremio — the Catalog Shelf, built from the picked mock (`docs/concepts/stremio-redesign.html`, idea 1).
 *
 * One tab per pinned catalog, one catalog of posters at a time. Everything the old page had around that —
 * the addon hero card, the `<select>` + Add picker, the five-field filter form with Apply/Clear, the chip
 * row whose click focused nothing, the horizontal rails with ‹ › arrows and a `More` button, the embed
 * provider tabs — is gone, because the shelf replaces all of it. Counts on the tabs are what this device
 * has loaded and `· more` means the addon answered `hasMore`; no number on this page is invented, because
 * `/api/stremio/catalog` returns `{ items, count, hasMore }` and never a total.
 *
 * A filter is offered only when the focused catalog's `extraSupported` declares it, and a value carried
 * over from another catalog is announced as `genre ignored here` instead of being sent and silently dropped.
 * Switching tabs, filtering, clearing or `load more` costs exactly one request; a pinned catalog that you
 * never opened costs zero.
 *
 * Dark in both themes, like the ReTro wall: this surface is posters, not chrome, and `html.day-mode main`
 * repaints anything leaning on a Tailwind text/background utility. Every colour here is declared on its own
 * class, and the rail and dock still follow the theme.
 */

const SCREEN_KEY = 'jash:stremio:screen:v1';
const CACHE_TTL = 30 * 60 * 1000;

async function readJsonResponse(response, fallbackMessage = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    const isHtml = /^\s*</.test(text) || contentType.includes('text/html');
    throw new Error(isHtml
      ? 'Stremio API route returned an HTML page instead of JSON. Deploy the latest Stremio API files and set STREMIO env.'
      : `${fallbackMessage}: server returned ${contentType || 'non-JSON response'}`);
  }
  return response.json();
}

function tabId(key) {
  return `jv-st-tab-${String(key).replace(/[^a-z0-9]/gi, '-')}`;
}

function Ruler({ tabs, value, pinnedCount, onChange, onOpenCatalogs }) {
  return (
    <div className="jv-st-ruler" role="tablist" aria-label="Catalog">
      {tabs.map((tab, index) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={tabId(tab.key)}
            aria-selected={active}
            aria-controls="jv-st-shelf"
            tabIndex={active ? 0 : -1}
            className={`jv-st-tab${active ? ' jv-st-tab-on' : ''}`}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => {
              const keys = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
              const step = keys[event.key];
              if (step === undefined) return;
              event.preventDefault();
              const next = tabs[Math.min(tabs.length - 1, Math.max(0, index + step))];
              if (!next) return;
              onChange(next.key);
              requestAnimationFrame(() => document.getElementById(tabId(next.key))?.focus());
            }}
          >
            <span className="jv-st-tab-label">{tab.label}</span>
            <span className="jv-st-tab-count">{tab.count}{tab.more ? ' · more' : ''}</span>
          </button>
        );
      })}
      <button type="button" className="jv-st-tab jv-st-tab-add" onClick={onOpenCatalogs}>
        <span className="jv-st-tab-label">{pinnedCount ? '+ catalogs' : 'pin a catalog'}</span>
      </button>
    </div>
  );
}

function ShelfCard({ item, index = 0 }) {
  const href = watchHref(item, 'stremio');
  const year = String(item.releaseInfo || item.year || '').slice(0, 4);
  const score = Number(item.rating) ? Number(item.rating).toFixed(1) : '';

  return (
    <Link href={href} className="jv-st-card" data-reveal style={revealStyle(index)} title={item.synopsis || item.title}>
      {item.posterUrl ? (
        <img
          className="jv-st-art"
          src={item.posterUrl}
          srcSet={tmdbImageSrcSet(item.posterUrl) || undefined}
          sizes={tmdbImageSrcSet(item.posterUrl) ? POSTER_SIZES_ATTR : undefined}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="jv-st-art jv-st-art-none" aria-hidden="true">{String(item.title || '??').trim().slice(0, 2).toUpperCase()}</span>
      )}
      {score ? <span className="jv-st-score">{score}</span> : null}
      <span className="jv-st-lab">
        <span className="jv-st-name">{item.title}</span>
        <span className="jv-st-sub">{year || '—'} · {item.type === 'series' ? 'series' : 'movie'}</span>
      </span>
    </Link>
  );
}

function FilterStrip({ catalog, filters, ignored, onOpenSheet }) {
  const missing = FILTER_FIELDS
    .filter((field) => !supportsExtra(catalog, field.id).supported && supportsExtra(catalog, field.id).declared)
    .map((field) => `no ${field.id === 'language' ? 'language' : field.id === 'sort' ? 'sorting' : field.id} here`);
  const canSearch = supportsExtra(catalog, 'search').supported;
  const unknown = !supportsExtra(catalog, 'search').declared;
  const used = activeFilterCount(filters);

  return (
    <div className="jv-st-filters">
      {FILTER_FIELDS.filter((field) => supportsExtra(catalog, field.id).supported).map((field) => (
        <button key={field.id} type="button" className="jv-st-fchip" onClick={() => onOpenSheet(field.id)}>
          <span className="jv-st-fchip-key">{field.label}</span>
          <span className="jv-st-fchip-val">{optionLabel(catalog, field.id, filters[field.id], field.options) || field.none}</span>
        </button>
      ))}
      {canSearch ? (
        <button type="button" className="jv-st-fchip" onClick={() => onOpenSheet('search')}>
          <span className="jv-st-fchip-key">Search</span>
          <span className="jv-st-fchip-val">{filters.search || '—'}</span>
        </button>
      ) : null}
      {ignored.length ? <span className="jv-st-fnote" aria-live="polite">{ignored.join(' + ')} ignored here</span> : null}
      {!ignored.length && missing.length ? <span className="jv-st-fnote">{missing.join(' · ')}</span> : null}
      {unknown ? <span className="jv-st-fnote">this catalog declares no extras, so it is read in the order your addon returns</span> : null}
      {used ? <span className="jv-st-fnote jv-st-fnote-on">{used} filter{used === 1 ? '' : 's'} on this catalog</span> : null}
    </div>
  );
}

function CatalogSheet({ options, pinned, shelf, addonName, onClose, onToggle }) {
  const pinnedKeys = new Set(pinned.map(catalogKey));
  return (
    <div className="jv-st-scrim" role="dialog" aria-modal="true" aria-label="Catalogs in this addon" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="jv-st-sheet">
        <div className="jv-st-sheet-top">
          <h2 className="jv-st-sheet-title">Catalogs</h2>
          <span className="jv-st-sheet-sub">{addonName} · {options.length} in the manifest</span>
          <button type="button" className="jv-st-x" onClick={onClose}>Close</button>
        </div>
        <p className="jv-st-sheet-note">Pinned catalogs get a tab. Pinning fetches nothing — a tab reads its first page the moment you press it.</p>
        <ul className="jv-st-pins">
          {options.map((catalog) => {
            const key = catalogKey(catalog);
            const entry = shelf[key] || emptyShelfEntry();
            const on = pinnedKeys.has(key);
            return (
              <li key={key} className={`jv-st-pin${on ? ' jv-st-pin-on' : ''}`}>
                <button type="button" className="jv-st-pin-main" aria-pressed={on} onClick={() => onToggle(catalog)}>
                  <span className="jv-st-pin-name">{catalogLabel(catalog)}</span>
                  <span className="jv-st-pin-meta">
                    {catalog.type === 'series' ? 'series' : 'movie'} · {catalog.id} · {catalog.extraSupported.length ? `accepts ${catalog.extraSupported.join(', ')}` : 'declares no extras'}
                  </span>
                </button>
                <span className="jv-st-pin-side">
                  <span className="jv-st-pin-count">{entry.items.length} loaded</span>
                  <span className="jv-st-pin-state">{on ? 'pinned' : 'pin'}</span>
                </span>
              </li>
            );
          })}
          {!options.length ? <li className="jv-st-sheet-note">The manifest listed no movie or series catalogs, so there is nothing to pin.</li> : null}
        </ul>
        {/* The one link /embed-browser has anywhere in the app. It is a destination, not chrome, so it
            moved into this sheet rather than being deleted with the hero card the shelf replaced. */}
        <div className="jv-st-embeds">
          <EmbedSiteLinks />
        </div>
      </div>
    </div>
  );
}

function FilterSheet({ catalog, filters, field, onClose, onApply, onClear }) {
  const searchRef = useRef(null);
  const [draft, setDraft] = useState(filters.search || '');
  const [next, setNext] = useState(() => safeFilters(filters));

  useEffect(() => {
    setNext(safeFilters(filters));
    setDraft(filters.search || '');
  }, [filters]);

  useEffect(() => {
    if (field === 'search') requestAnimationFrame(() => searchRef.current?.focus());
  }, [field]);

  const set = (id, value) => setNext((current) => ({
    ...current,
    [id]: current[id] === value && id !== 'sort' ? '' : value,
  }));

  const usable = FILTER_FIELDS
    .filter((entry) => supportsExtra(catalog, entry.id).supported)
    .map((entry) => ({ ...entry, options: filterOptions(catalog, entry.id, entry.options) }));
  const skipped = FILTER_FIELDS.filter((entry) => !supportsExtra(catalog, entry.id).supported && supportsExtra(catalog, entry.id).declared);

  return (
    <div className="jv-st-scrim" role="dialog" aria-modal="true" aria-label="Filters for this catalog" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="jv-st-sheet jv-st-sheet-filters">
        <div className="jv-st-sheet-top">
          <h2 className="jv-st-sheet-title">{catalogLabel(catalog || {})} · filters</h2>
          <button type="button" className="jv-st-x" onClick={onClose}>Close</button>
        </div>
        {usable.map((entry) => (
          <div key={entry.id} className="jv-st-field">
            <p className="jv-st-field-label">{entry.label}</p>
            <div className="jv-st-options">
              {entry.id !== 'sort' ? (
                <button type="button" className={`jv-st-opt${!next[entry.id] ? ' jv-st-opt-on' : ''}`} onClick={() => set(entry.id, '')}>{entry.none}</button>
              ) : null}
              {entry.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={next[entry.id] === option.value}
                  className={`jv-st-opt${next[entry.id] === option.value ? ' jv-st-opt-on' : ''}`}
                  onClick={() => set(entry.id, option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {supportsExtra(catalog, 'search').supported ? (
          <div className="jv-st-field">
            <p className="jv-st-field-label">Search</p>
            <form
              className="jv-st-search"
              onSubmit={(event) => { event.preventDefault(); onApply({ ...next, search: draft.trim() }); }}
            >
              <input
                ref={searchRef}
                className="jv-st-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="title, an actor, anything this catalog indexes"
                aria-label="Search this catalog"
              />
              <button type="submit" className="jv-st-go">Go</button>
            </form>
          </div>
        ) : null}
        {!supportsExtra(catalog, 'search').declared ? (
          <p className="jv-st-unsupported">This catalog declares no extras, so there is nothing here to set — it is read in the order your addon returns.</p>
        ) : null}
        {skipped.length ? (
          <p className="jv-st-unsupported">
            {skipped.map((entry) => entry.label).join(', ')}: this catalog does not declare {skipped.length === 1 ? 'it' : 'them'}, so nothing is offered.
          </p>
        ) : null}
        <div className="jv-st-sheet-foot">
          <button type="button" className="jv-st-go" onClick={() => onApply(next)}>Apply</button>
          <button type="button" className="jv-st-quiet" onClick={onClear}>Clear</button>
        </div>
      </div>
    </div>
  );
}

export default function StremioPage() {
  const [manifest, setManifest] = useState(null);
  const [options, setOptions] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [activeKey, setActiveKey] = useState('');
  const [shelf, setShelf] = useState({});
  const [filtersByCatalog, setFiltersByCatalog] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState('');
  const [sheetField, setSheetField] = useState('');
  const [nonce, setNonce] = useState(0);
  const requestsRef = useRef({});
  const filtersRef = useRef({});
  const shelfRef = useRef({});
  const mountedRef = useRef(true), restoredRef = useRef(false), manifestRef = useRef('');
  const shelfEpoch = useRef(0), catalogControllers = useRef({}), pinsRevision = useRef(0);
  const pinsRef = useRef([]), activeRef = useRef(''), pinsKnown = useRef(false);
  const pinWrites = useRef(Promise.resolve());
  const [reconciling, setReconciling] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState('');

  const activeCatalog = useMemo(
    () => pinned.find((catalog) => catalogKey(catalog) === activeKey) || pinned[0] || null,
    [pinned, activeKey],
  );
  const activeCatalogKey = activeCatalog ? catalogKey(activeCatalog) : '';
  const filters = useMemo(
    () => safeFilters(filtersByCatalog[activeCatalogKey] || defaultFilters()),
    [filtersByCatalog, activeCatalogKey],
  );
  const tabs = useMemo(() => buildRuler({ pinned, shelf }), [pinned, shelf]);
  const activeTab = tabs.find((tab) => tab.key === activeCatalogKey) || null;
  const activeEntry = shelf[activeCatalogKey] || null;
  const ignored = useMemo(() => (activeCatalog
    ? buildShelfQuery({ catalog: activeCatalog, skip: 0, filters }).ignored
    : []), [activeCatalog, filters]);
  const line = useMemo(() => shelfLine({ tab: activeTab, loading: Boolean(activeEntry?.loading), ignored }), [activeTab, activeEntry, ignored]);

  useEffect(() => { filtersRef.current = filtersByCatalog; }, [filtersByCatalog]);
  useEffect(() => { shelfRef.current = shelf; }, [shelf]);
  useEffect(() => { pinsRef.current = pinned; }, [pinned]);
  useEffect(() => { activeRef.current = activeKey; }, [activeKey]);

  const fetchPage = useCallback(async (query, signal) => {
    const response = await fetch(`/api/stremio/catalog?${query}`, { cache: 'no-store', signal });
    const data = await readJsonResponse(response, 'Stremio request failed');
    if (!response.ok || data?.error) throw new Error(data?.error || 'Catalog failed');
    return data;
  }, []);

  // One call in, one catalog page out. `requestsRef` is what makes a stale answer harmless: pressing two
  // tabs quickly means the first reply arrives after the second request exists, and it must not paint.
  const run = useCallback(async (catalog, { append = false, filters: chosen } = {}) => {
    if (!catalog?.id) return;
    const key = catalogKey(catalog);
    const epoch = shelfEpoch.current;
    catalogControllers.current[key]?.abort();
    const controller = new AbortController(); catalogControllers.current[key] = controller;
    const id = (requestsRef.current[key] || 0) + 1;
    requestsRef.current[key] = id;
    setShelf((state) => ({ ...state, [key]: markShelfLoading(state[key] || emptyShelfEntry()) }));
    try {
      const { entry } = await fetchCatalogPage({
        fetchPage: query => fetchPage(query, controller.signal),
        catalog,
        filters: safeFilters(chosen || filtersRef.current[key]),
        append,
        current: shelfRef.current[key] || null,
      });
      if (!mountedRef.current || controller.signal.aborted || shelfEpoch.current !== epoch || requestsRef.current[key] !== id) return;
      setShelf((state) => ({ ...state, [key]: entry }));
    } catch (err) {
      if (err?.name === 'AbortError' || !mountedRef.current || controller.signal.aborted || shelfEpoch.current !== epoch || requestsRef.current[key] !== id) return;
      setShelf((state) => ({ ...state, [key]: markShelfError(state[key], err?.message || 'Catalog failed') }));
    }
  }, [fetchPage]);

  // Restore the last usable screen, then reconcile independent manifest/pin reads.
  // Reads never write global pins; source changes invalidate all old shelf responses.
  useEffect(() => {
    if (restoredRef.current) return;
    const cached = readSessionCache(SCREEN_KEY, CACHE_TTL);
    const prefs = readSessionCache(SHELF_KEY, CACHE_TTL) || {};
    if (cached?.manifest && Array.isArray(cached.options) && Array.isArray(cached.pinned)) {
      manifestRef.current = cached.fingerprint || '';
      setManifest(cached.manifest); setOptions(cached.options); setPinned(cached.pinned);
      pinsRef.current = cached.pinned; pinsKnown.current = true;
      const key = cached.pinned.some(c => catalogKey(c) === prefs.activeKey) ? prefs.activeKey : cached.activeKey;
      setActiveKey(key || ''); activeRef.current = key || '';
      const filters = prefs.filters || cached.filters || {};
      setFiltersByCatalog(filters); filtersRef.current = filters;
      const entries = cached.shelf || {};
      setShelf(entries); shelfRef.current = entries;
      setStatus('ready'); restoreScroll(SCREEN_KEY);
    } else if (prefs.filters) { setFiltersByCatalog(prefs.filters); filtersRef.current = prefs.filters; }
    restoredRef.current = true;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const revision = pinsRevision.current;
    setReconciling(true); setRefreshWarning('');
    async function reconcile() {
      try {
        // Start both requests before awaiting either; pins failure must not delay a usable manifest forever.
        const pinsPromise = fetch('/api/stremio/pins', { cache:'no-store', signal:controller.signal })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        const response = await fetch(`/api/stremio/manifest?source=catalog${nonce ? '&fresh=1' : ''}`, { cache:'no-store', signal:controller.signal });
        const data = await readJsonResponse(response, 'Stremio request failed');
        if (!response.ok || !data.ok) throw new Error(data?.error || 'Stremio manifest failed');
        if (controller.signal.aborted) return;
        const list = readCatalogOptions(data.manifest?.catalogs || []);
        const fingerprint = JSON.stringify([data.manifestUrl || '', data.manifest]);
        const changed = manifestRef.current !== fingerprint;
        if (changed) {
          shelfEpoch.current++;
          Object.values(catalogControllers.current).forEach(c => c.abort());
          catalogControllers.current = {};
          setShelf({}); shelfRef.current = {};
        }
        manifestRef.current = fingerprint;
        setManifest(data.manifest); setOptions(list); setError('');
        const validate = pins => pins.map(c => list.find(item => catalogKey(item) === catalogKey(c))).filter(Boolean);
        // Render existing/device pins immediately; global GET can update them only if no user changed pins.
        let chosen = validate(pinsRef.current);
        if (!pinsKnown.current) {
          let device = null;
          try { device = JSON.parse(window.localStorage.getItem(SELECTED_KEY) || 'null'); } catch {}
          pinsKnown.current = Array.isArray(device);
          chosen = Array.isArray(device) ? device.map(key => list.find(item => catalogKey(item) === key)).filter(Boolean) : getDefaultPins(list, data.tamilCatalogs || {});
        }
        pinsRef.current = chosen; setPinned(chosen);
        if (!chosen.some(c => catalogKey(c) === activeRef.current)) {
          activeRef.current = chosen[0] ? catalogKey(chosen[0]) : ''; setActiveKey(activeRef.current);
        }
        setStatus('ready');
        const pinsData = await pinsPromise;
        if (controller.signal.aborted || revision !== pinsRevision.current) return;
        if (Array.isArray(pinsData?.pins) && pinsData.configured) {
          pinsKnown.current = true;
          chosen = pinsData.pins.map(key => list.find(item => catalogKey(item) === key)).filter(Boolean);
          pinsRef.current = chosen; setPinned(chosen);
          if (!chosen.some(c => catalogKey(c) === activeRef.current)) {
            activeRef.current = chosen[0] ? catalogKey(chosen[0]) : ''; setActiveKey(activeRef.current);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (manifestRef.current) setRefreshWarning('Could not refresh the addon. Showing your last loaded shelf.');
        else { setError(err?.message || 'Stremio is not configured'); setStatus('error'); }
      } finally { if (!controller.signal.aborted) setReconciling(false); }
    }
    reconcile();
    return () => controller.abort();
  }, [nonce]);

  // One page per tab, and only when that tab is what you are looking at.
  useEffect(() => {
    if (status !== 'ready' || !activeCatalog) return;
    const entry = shelf[activeCatalogKey];
    if (entry && (entry.fetched || entry.loading)) return;
    run(activeCatalog);
  }, [status, activeCatalog, activeCatalogKey, shelf, run]);

  useEffect(() => {
    if (status !== 'ready' || !restoredRef.current || !manifestRef.current) return;
    // Bound saved shelf data: active entry first plus up to three other recently loaded tabs.
    const keys = [activeCatalogKey, ...Object.keys(shelf).filter(k => k !== activeCatalogKey)].slice(0, 4);
    const entries = Object.fromEntries(keys.filter(k => shelf[k]?.fetched && !shelf[k]?.error && !shelf[k]?.loading).map(k => [k, { ...shelf[k], loading:false }]));
    writeSessionCache(SCREEN_KEY, { manifest, options, pinned, activeKey:activeCatalogKey, filters:filtersByCatalog, shelf:entries, fingerprint:manifestRef.current });
  }, [status, manifest, options, pinned, activeCatalogKey, filtersByCatalog, shelf]);

  useEffect(() => {
    if (!activeCatalogKey) return;
    writeSessionCache(SHELF_KEY, { activeKey: activeCatalogKey, filters: filtersByCatalog });
  }, [activeCatalogKey, filtersByCatalog]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && sheet) setSheet(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false; shelfEpoch.current++;
      Object.values(catalogControllers.current).forEach(c => c.abort()); saveScroll(SCREEN_KEY);
    };
  }, []);

  function togglePin(catalog) {
    const key = catalogKey(catalog);
    const current = pinsRef.current;
    const removing = current.some(item => catalogKey(item) === key);
    const next = removing ? current.filter(item => catalogKey(item) !== key) : [...current, catalog];
    const revision = ++pinsRevision.current; pinsKnown.current = true;
    pinsRef.current = next; setPinned(next);
    if (!removing || activeRef.current === key) {
      const active = removing ? next[0] ? catalogKey(next[0]) : '' : key;
      activeRef.current = active; setActiveKey(active);
    }
    const keys = next.map(catalogKey);
    try { window.localStorage.setItem(SELECTED_KEY, JSON.stringify(keys)); } catch {}
    pinWrites.current = pinWrites.current.catch(() => {}).then(() => fetch('/api/stremio/pins', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ keys }) }))
      .then(r => { if (!r.ok) throw new Error('Pin save failed'); })
      .catch(() => { if (mountedRef.current && pinsRevision.current === revision) setRefreshWarning('Pins are saved on this device; the global shelf could not be updated.'); });
  }

  function applyFilters(next) {
    if (!activeCatalog) return;
    const clean = safeFilters(next);
    filtersRef.current = { ...filtersRef.current, [activeCatalogKey]:clean };
    setFiltersByCatalog(filtersRef.current);
    setShelf((state) => ({ ...state, [activeCatalogKey]: emptyShelfEntry() }));
    setSheet('');
    // Passed in, not read back from state: this handler and the fetch share one render, so the ref the
    // effect keeps in step is still the previous filters here.
    run(activeCatalog, { filters: clean });
  }

  function reloadActive() {
    if (!activeCatalog) return;
    setShelf((state) => ({ ...state, [activeCatalogKey]: emptyShelfEntry() }));
    run(activeCatalog);
  }

  const addonName = manifest?.name || 'no addon name';
  const loaded = activeEntry?.items?.length || 0;
  const reading = Boolean(activeEntry?.loading);
  const capped = (activeEntry?.pages || 0) >= SHELF_MAX_PAGES;
  const showGrid = Boolean(activeCatalog) && loaded > 0 && !error && status === 'ready';
  // Re-arms on the catalog AND the count: switching catalogs swaps every node,
  // and paging appends to the same one.
  const revealRef = useReveal(`${activeKey}|${(activeEntry?.items || []).length}`);

  return (
    <>
      <RailNav />
      <main className="jv-st-page jv-rail-shift">
        <div className="jv-st">
          <header className="jv-st-top">
            <button type="button" className="jv-st-burger" onClick={() => setSheet('catalogs')} title="Pin or unpin catalogs" aria-label="Catalogs">
              <span className="jv-st-burger-bars" aria-hidden="true" />
            </button>
            <h1 className="jv-st-heading">Stremio</h1>
            <div className="jv-st-top-side">
              <button type="button" className="jv-st-reload" aria-label="Refresh addon manifest" disabled={reconciling} onClick={() => setNonce(n => n + 1)}>{reconciling ? 'Refreshing…' : 'Refresh addon'}</button>
              <span className="jv-st-pinchip">{pinned.length} catalog{pinned.length === 1 ? '' : 's'} pinned</span>
              <button type="button" className="jv-st-mobfilters" onClick={() => { setSheetField(''); setSheet('filters'); }}>
                Filters{activeFilterCount(filters) ? ` · ${activeFilterCount(filters)}` : ''}
              </button>
            </div>
          </header>

          {refreshWarning ? <p role="status" className="jv-st-note-body">{refreshWarning}</p> : null}
          {tabs.length ? (
            <Ruler
              tabs={tabs}
              value={activeCatalogKey}
              pinnedCount={pinned.length}
              onChange={key => { activeRef.current = key; setActiveKey(key); }}
              onOpenCatalogs={() => setSheet('catalogs')}
            />
          ) : null}

          {activeCatalog && status === 'ready' ? (
            <div className="jv-st-strip">
              <FilterStrip
                catalog={activeCatalog}
                filters={filters}
                ignored={ignored}
                onOpenSheet={(fieldId) => { setSheetField(fieldId); setSheet('filters'); }}
              />
              <button type="button" className="jv-st-reload" onClick={reloadActive} title="Read this catalog again from its first page">reload</button>
            </div>
          ) : null}

          <section
            className="jv-st-body"
            id="jv-st-shelf"
            role="tabpanel"
            aria-live="polite"
            aria-labelledby={activeTab ? tabId(activeTab.key) : undefined}
          >
            {status === 'loading' || (reading && !loaded) ? (
              <div className="jv-st-skel" aria-hidden="true">{Array.from({ length: 8 }).map((_, index) => <span key={index} />)}</div>
            ) : null}

            {status === 'error' ? (
              <div className="jv-st-note jv-st-note-error">
                <p className="jv-st-note-title">The addon did not answer</p>
                <p className="jv-st-note-body">{error} Set <code>STREMIO</code> to your addon manifest URL if this is a fresh deploy.</p>
                <div className="jv-st-note-actions"><button type="button" className="jv-st-go" onClick={() => setNonce((value) => value + 1)}>Try again</button></div>
              </div>
            ) : null}

            {status === 'ready' && !pinned.length ? (
              <div className="jv-st-note jv-st-note-muted">
                <p className="jv-st-note-title">Nothing pinned</p>
                <p className="jv-st-note-body">This manifest listed {options.length} movie or series catalog{options.length === 1 ? '' : 's'}. Pin one and it gets a tab.</p>
                <div className="jv-st-note-actions"><button type="button" className="jv-st-go" onClick={() => setSheet('catalogs')}>Open catalogs</button></div>
              </div>
            ) : null}

            {status === 'ready' && activeCatalog && !reading && !loaded && activeEntry?.error ? (
              <div className="jv-st-note jv-st-note-error">
                <p className="jv-st-note-title">{catalogLabel(activeCatalog)}</p>
                <p className="jv-st-note-body">{activeEntry.error}</p>
                <div className="jv-st-note-actions"><button type="button" className="jv-st-go" onClick={reloadActive}>Try again</button></div>
              </div>
            ) : null}

            {status === 'ready' && activeCatalog && !reading && !loaded && !activeEntry?.error ? (
              <div className="jv-st-note jv-st-note-muted">
                <p className="jv-st-note-title">{catalogLabel(activeCatalog)}</p>
                <p className="jv-st-note-body">{line.text}. An empty catalog is the addon answering with nothing — it is not this page failing to look.</p>
                <div className="jv-st-note-actions"><button type="button" className="jv-st-go" onClick={reloadActive}>Read it again</button></div>
              </div>
            ) : null}

            {showGrid ? (
              <>
                <div ref={revealRef} className="jv-st-grid">
                  {(activeEntry?.items || []).map((item, index) => <ShelfCard key={rowKey(item)} item={item} index={index} />)}
                  {activeEntry?.hasMore && !capped ? (
                    <button type="button" className="jv-st-more" disabled={reading} onClick={() => run(activeCatalog, { append: true })}>
                      {reading ? 'reading…' : 'load more'}
                    </button>
                  ) : null}
                  {capped && activeEntry?.hasMore ? (
                    <p className="jv-st-more jv-st-more-stop">{SHELF_MAX_PAGES} pages read · press reload to start again</p>
                  ) : null}
                </div>
                <p className="jv-st-caption">{line.text}</p>
              </>
            ) : null}
          </section>
        </div>
      </main>

      {sheet === 'catalogs' ? (
        <CatalogSheet
          options={options}
          pinned={pinned}
          shelf={shelf}
          addonName={addonName}
          onClose={() => setSheet('')}
          onToggle={togglePin}
        />
      ) : null}
      {sheet === 'filters' ? (
        <FilterSheet
          catalog={activeCatalog}
          filters={filters}
          field={sheetField}
          onClose={() => setSheet('')}
          onApply={applyFilters}
          onClear={() => applyFilters(defaultFilters())}
        />
      ) : null}
    </>
  );
}
