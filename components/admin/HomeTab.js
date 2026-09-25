'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FILTERS = [
  ['all', 'All'],
  ['matched', 'Matched'],
  ['unmatched', 'Unmatched'],
  ['hidden', 'Hidden'],
  ['pinned', 'Pinned'],
];

const QUALITY_OPTIONS = ['', '4k', '1080p', '720p', 'hdrip', 'dvdscr', 'cam', 'tv'];

function Chip({ children, cls = '' }) {
  return <span className={`jv-ad-tag ${cls}`}>{children}</span>;
}

function MatchDialog({ row, onClose, onMatched }) {
  const [query, setQuery] = useState(row.rawTitle || row.title || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [binding, setBinding] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const timerRef = useRef(null);

  const search = useCallback(async (value) => {
    const q = String(value || '').trim();
    if (!q) return;
    setSearching(true);
    setError('');
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      const items = (data.results || data.items || []).filter((item) => item.tmdbId);
      setResults(items.slice(0, 18));
      if (!items.length) setNote('TMDB answered with nothing. Edit the words above — the raw title often carries quality noise.');
    } catch {
      setError('TMDB search failed. You can still paste a link below.');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    timerRef.current = setTimeout(() => search(query), 450);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bind(candidate) {
    setBinding(candidate.tmdbId);
    setError('');
    try {
      const response = await fetch('/api/title-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: row.title,
          year: String(row.year || ''),
          type: row.type,
          query: String(candidate.tmdbId),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Match failed');
      onMatched?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Match failed');
      setBinding('');
    }
  }

  async function bindPasted(event) {
    event.preventDefault();
    const value = String(query || '').trim();
    if (!value) return;
    // A pasted query that is not an id/link is treated as a fresh search first.
    if (!/^\d+$/.test(value) && !/themoviedb|imdb/i.test(value)) return search(value);
    setBinding('manual');
    setError('');
    try {
      const response = await fetch('/api/title-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: row.title, year: String(row.year || ''), type: row.type, query: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Match failed');
      onMatched?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Match failed');
      setBinding('');
    }
  }

  return (
    <div className="jv-ad-scrim" role="dialog" aria-modal="true" aria-label="Match to TMDB" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="jv-ad-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <p className="jv-ad-kicker">Match → TMDB</p>
        <h3>{row.title}{row.year ? ` (${row.year})` : ''}</h3>
        <p className="jv-ad-card-sub">Pre-filled with the raw scraped title — trim the quality noise and search. Click a poster to bind.</p>

        <form onSubmit={bindPasted} className="jv-ad-toolbar" style={{ marginTop: 12 }}>
          <div className="jv-ad-search">
            <input className="jv-ad-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="raw title, or a TMDB/IMDb link or id" />
          </div>
          <button type="button" className="jv-ad-btn" onClick={() => search(query)} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
          <button type="submit" className="jv-ad-btn is-primary" disabled={!query.trim()}>Bind pasted link/id</button>
        </form>

        {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
        {note && !results.length ? <p className="jv-ad-note">{note}</p> : null}

        <div className="jv-ad-pick-grid">
          {results.map((item) => (
            <button key={`${item.type}-${item.tmdbId}`} type="button" className="jv-ad-pick" onClick={() => bind(item)} disabled={Boolean(binding)}>
              <span className="ph">{item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" /> : '🎬'}</span>
              <span className="pt">{item.title}</span>
              <span className="py">{item.type === 'series' ? 'Series' : 'Movie'}{item.year ? ` · ${item.year}` : ''}</span>
            </button>
          ))}
        </div>
        {binding ? <p className="jv-ad-note">Binding…</p> : null}

        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button type="button" className="jv-ad-btn is-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function OverrideDialog({ row, onClose, onSaved }) {
  const [title, setTitle] = useState(row.title || '');
  const [year, setYear] = useState(String(row.year || ''));
  const [quality, setQuality] = useState(row.qualityTier || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: row.key,
          type: row.type,
          rawTitle: row.rawTitle,
          titleOverride: title,
          yearOverride: year,
          qualityOverride: quality,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Save failed');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Save failed');
      setBusy(false);
    }
  }

  return (
    <div className="jv-ad-scrim" role="dialog" aria-modal="true" aria-label="Override details" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="jv-ad-dialog" style={{ maxWidth: 460 }} onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
        <p className="jv-ad-kicker">Manual override</p>
        <h3>Correct this row permanently</h3>
        <p className="jv-ad-card-sub">Stored server-side — every re-sync applies it back to the scraped row.</p>
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 900, color: 'var(--ad-faint)' }}>TITLE
            <input className="jv-ad-input" style={{ marginTop: 4 }} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 900, color: 'var(--ad-faint)' }}>YEAR
            <input className="jv-ad-input" style={{ marginTop: 4 }} value={year} onChange={(event) => setYear(event.target.value)} placeholder="e.g. 2008" />
          </label>
          <label style={{ fontSize: 11, fontWeight: 900, color: 'var(--ad-faint)' }}>QUALITY CHIP
            <select className="jv-ad-select" style={{ marginTop: 4, width: '100%' }} value={quality} onChange={(event) => setQuality(event.target.value)}>
              {QUALITY_OPTIONS.map((option) => <option key={option || 'none'} value={option}>{option || 'scraped default'}</option>)}
            </select>
          </label>
        </div>
        {error ? <p className="jv-ad-note is-bad" style={{ marginTop: 10 }}>{error}</p> : null}
        <div className="jv-ad-toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="jv-ad-btn is-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="jv-ad-btn is-primary" disabled={busy}>{busy ? 'Saving…' : 'Save override'}</button>
        </div>
      </form>
    </div>
  );
}

export default function HomeTab() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState('');
  const [matchRow, setMatchRow] = useState(null);
  const [overrideRow, setOverrideRow] = useState(null);
  const [note, setNote] = useState(null);
  const [busyAction, setBusyAction] = useState('');

  const load = useCallback(async (search, activeFilter, activePage) => {
    setStatus('loading');
    setError('');
    try {
      const params = new URLSearchParams({ q: search || '', filter: activeFilter || 'all', page: String(activePage || 1) });
      const response = await fetch(`/api/admin/catalog?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Catalog read failed');
      setData(payload);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Catalog read failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(query, filter, page), 300);
    return () => clearTimeout(timer);
  }, [query, filter, page, load]);

  async function patchOverride(row, patch, message) {
    setBusyAction(row.key);
    try {
      const response = await fetch('/api/admin/catalog/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: row.key, type: row.type, rawTitle: row.rawTitle, ...patch }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Action failed');
      setNote({ kind: 'ok', text: message });
      await load(query, filter, page);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusyAction('');
    }
  }

  async function forgetOverride(row) {
    setBusyAction(row.key);
    try {
      await fetch(`/api/admin/catalog/overrides?key=${encodeURIComponent(row.key)}`, { method: 'DELETE' });
      setNote({ kind: 'ok', text: `Override cleared — "${row.title}" is back to its scraped state.` });
      await load(query, filter, page);
    } catch {
      setNote({ kind: 'bad', text: 'Could not clear the override.' });
    } finally {
      setBusyAction('');
    }
  }

  async function systemAction(mode) {
    setBusyAction(`system:${mode}`);
    setNote(mode === 'sync'
      ? { kind: null, text: 'Full re-scrape running — TamilMV + TMDB. This takes up to a minute; the panel stays usable.' }
      : { kind: null, text: 'Purging the catalog cache…' });
    try {
      const response = await fetch('/api/admin/catalog/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed');
      setNote({ kind: 'ok', text: payload.message || 'Done.' });
      await load(query, filter, page);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusyAction('');
    }
  }

  async function killAllSessions() {
    if (!window.confirm('Kill every admin session (including this one)? You will need the admin password again.')) return;
    setBusyAction('system:kill');
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kill-all' }),
      });
      if (response.ok) window.location.assign('/admin');
      else setNote({ kind: 'bad', text: 'Kill-all failed.' });
    } finally {
      setBusyAction('');
    }
  }

  async function copyRaw(text) {
    try { await navigator.clipboard.writeText(text); setNote({ kind: 'ok', text: 'Raw title copied.' }); } catch {}
  }

  const rows = data?.rows || [];
  const counts = data?.counts || {};

  return (
    <div>
      <div className="jv-ad-stats">
        <div className="jv-ad-stat"><span>Total titles</span><b>{counts.total ?? '—'}</b></div>
        <div className="jv-ad-stat is-green"><span>Matched</span><b>{counts.matched ?? '—'}</b></div>
        <div className="jv-ad-stat is-red"><span>Hidden</span><b>{counts.hidden ?? '—'}</b></div>
        <div className="jv-ad-stat is-amber"><span>Pinned</span><b>{counts.pinned ?? '—'}</b></div>
      </div>

      <div className="jv-ad-card">
        <div className="jv-ad-toolbar" style={{ marginTop: 0 }}>
          <div className="jv-ad-search">
            <input className="jv-ad-input" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search parsed or raw titles…" />
          </div>
          <button type="button" className="jv-ad-btn is-green" onClick={() => systemAction('sync')} disabled={Boolean(busyAction)}>Sync now</button>
          <button type="button" className="jv-ad-btn is-danger" onClick={() => systemAction('purge')} disabled={Boolean(busyAction)}>Purge cache</button>
          <button type="button" className="jv-ad-btn" onClick={killAllSessions} disabled={Boolean(busyAction)} title="Revoke every admin session instantly">Kill admin sessions</button>
        </div>
        <div className="jv-ad-chiprow">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={`jv-ad-chip ${filter === id ? 'is-active' : ''}`} onClick={() => { setFilter(id); setPage(1); }}>{label}</button>
          ))}
        </div>
        {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
      </div>

      {status === 'loading' && !rows.length ? <p className="jv-ad-empty">Loading the catalog…</p> : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {status === 'ready' && !rows.length ? <p className="jv-ad-empty">Nothing here for this filter. {filter === 'hidden' ? 'Hidden rows appear here after you remove one.' : ''}</p> : null}

      {rows.length ? (
        <div className="jv-ad-table">
          {rows.map((row) => (
            <div key={row.key} className={`jv-ad-tr ${row.hidden ? 'is-hidden' : ''} ${row.pinned ? 'is-pinned' : ''}`}>
              <button type="button" className="jv-ad-trmain" onClick={() => setExpanded(expanded === row.key ? '' : row.key)} title="Tap to reveal the raw scraped title">
                <span className="jv-ad-thumb">{row.posterUrl ? <img src={row.posterUrl} alt="" loading="lazy" /> : '🎬'}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="jv-ad-title">{row.title}{row.year ? ` (${row.year})` : ''}</span>
                  <span className="jv-ad-metatitle">{row.overridden ? '✎ overridden · ' : ''}raw: {row.rawTitle || '(no raw title stored)'}</span>
                </span>
                <span className="jv-ad-tags">
                  <Chip>{row.type === 'series' ? 'Series' : 'Movie'}</Chip>
                  {row.qualityTier ? <Chip>{row.qualityTier}</Chip> : null}
                  {row.tmdbId ? <Chip cls="is-ok">● Matched</Chip> : <Chip cls="is-warn">● Unmatched</Chip>}
                  {row.hidden ? <Chip cls="is-bad">Hidden</Chip> : null}
                  {row.pinned ? <Chip cls="is-warn">Pinned</Chip> : null}
                </span>
              </button>

              {expanded === row.key ? (
                <div className="jv-ad-drawer">
                  <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', color: 'var(--ad-faint)', margin: '0 0 5px' }}>COMPLETE SCRAPED TITLE (BEFORE PARSING)</p>
                  <div className="jv-ad-rawbox">{row.rawTitle || '— the scraper did not store a raw title for this row —'}</div>
                  <div className="jv-ad-drawer-actions">
                    <button type="button" className="jv-ad-btn is-sm" onClick={() => copyRaw(row.rawTitle)}>Copy raw</button>
                    <button type="button" className="jv-ad-btn is-sm is-primary" onClick={() => setMatchRow(row)}>{row.tmdbId ? 'Re-match' : 'Match to TMDB'}</button>
                    <button type="button" className="jv-ad-btn is-sm" onClick={() => setOverrideRow(row)}>Edit title / year / quality</button>
                    <button type="button" className="jv-ad-btn is-sm is-danger" onClick={() => patchOverride(row, { hidden: !row.hidden }, row.hidden ? `"${row.title}" restored to the home page.` : `"${row.title}" removed from the home page (restorable).`)}>
                      {row.hidden ? 'Restore to home' : 'Remove from home'}
                    </button>
                    <button type="button" className="jv-ad-btn is-sm is-amber" onClick={() => patchOverride(row, { pinned: !row.pinned }, row.pinned ? `"${row.title}" unpinned.` : `"${row.title}" pinned to the top of home.`)}>
                      {row.pinned ? 'Unpin' : 'Pin to top'}
                    </button>
                    {row.overridden || row.hidden || row.pinned ? (
                      <button type="button" className="jv-ad-btn is-sm is-ghost" onClick={() => forgetOverride(row)}>Forget all overrides</button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {data?.pages > 1 ? (
        <div className="jv-ad-pager">
          <button type="button" className="jv-ad-btn is-sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹ Prev</button>
          <span>page {data.page} / {data.pages} · {data.total} rows</span>
          <button type="button" className="jv-ad-btn is-sm" disabled={page >= data.pages} onClick={() => setPage((current) => current + 1)}>Next ›</button>
        </div>
      ) : null}

      {matchRow ? <MatchDialog row={matchRow} onClose={() => setMatchRow(null)} onMatched={() => { setNote({ kind: 'ok', text: 'Matched. The poster and streams bind within a moment.' }); load(query, filter, page); }} /> : null}
      {overrideRow ? <OverrideDialog row={overrideRow} onClose={() => setOverrideRow(null)} onSaved={() => { setNote({ kind: 'ok', text: 'Override saved.' }); load(query, filter, page); }} /> : null}
    </div>
  );
}
