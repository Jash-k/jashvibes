'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ReTro tab — sources CRUD + background sync with live status, and the
 * titles manager (search, edit title/year, re-match to TMDB, remove).
 */
export default function RetroTab() {
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [form, setForm] = useState({ name: '', url: '' });
  const [busy, setBusy] = useState('');
  const [sync, setSync] = useState(null); // live sync status from the poll

  // titles manager state
  const [items, setItems] = useState([]);
  const [itemsMeta, setItemsMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [itemsQuery, setItemsQuery] = useState('');
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsLoading, setItemsLoading] = useState(false);

  const syncTimerRef = useRef(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/admin/vod/sources', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Read failed');
      setSources(data.sources || []);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Read failed');
      setStatus('error');
    }
  }, []);

  const loadItems = useCallback(async (q = itemsQuery, page = itemsPage) => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (q) params.set('q', q);
      const response = await fetch(`/api/admin/vod/items?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Read failed');
      setItems(data.items || []);
      setItemsMeta({ total: data.total || 0, page: data.page || 1, pages: data.pages || 1 });
    } catch {
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [itemsQuery, itemsPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadItems(itemsQuery, 1); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    const timer = setTimeout(() => loadItems(itemsQuery, 1), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsQuery]);

  // ── background sync + status poll ────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/vod/sources/sync', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) return;
      setSync(data.status);
      if (data.status.running) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = setTimeout(pollStatus, 5000);
      } else if (data.status.finishedAt && data.status.result) {
        setNote({ kind: data.status.result.ok ? 'ok' : 'bad', text: data.status.result.message + (data.status.error ? ` (error: ${data.status.error})` : '') });
        await Promise.all([load(), loadItems(itemsQuery, 1)]);
      }
    } catch { /* transient */ }
  }, [load, loadItems, itemsQuery]);

  useEffect(() => () => clearTimeout(syncTimerRef.current), []);

  async function addSource(event) {
    event.preventDefault();
    setBusy('add');
    setNote(null);
    try {
      const response = await fetch('/api/admin/vod/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Save failed');
      setForm({ name: '', url: '' });
      setNote({ kind: 'ok', text: 'Source added. Run a sync to pull its titles in.' });
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function patchSource(source, body, message) {
    setBusy(source._id);
    try {
      const response = await fetch('/api/admin/vod/sources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source._id, ...body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Update failed');
      if (message) setNote({ kind: 'ok', text: message });
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function deleteSource(source) {
    if (!window.confirm(`Delete source "${source.name}"? Its synced titles stay until the next sync.`)) return;
    setBusy(source._id);
    try {
      const response = await fetch(`/api/admin/vod/sources?id=${source._id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      setNote({ kind: 'ok', text: 'Source deleted.' });
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function rename(source) {
    const name = window.prompt('Rename source', source.name || '');
    if (!name || name === source.name) return;
    await patchSource(source, { name }, 'Renamed.');
  }

  async function startSync() {
    setBusy('sync');
    setNote(null);
    try {
      const response = await fetch('/api/admin/vod/sources/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not start');
      setSync({ running: data.status?.running ?? true, startedAt: data.status?.startedAt || Date.now(), result: null, error: '' });
      setNote({ kind: null, text: data.message });
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(pollStatus, 4000);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  // ── titles CRUD ──────────────────────────────────────────────────────────
  async function editItem(item) {
    const title = window.prompt('Title', item.title || '');
    if (title == null) return;
    const year = window.prompt('Year', item.year ? String(item.year) : '');
    if (year == null) return;
    setBusy(item._id);
    try {
      const response = await fetch('/api/admin/vod/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item._id, title: title.trim() || item.title, year: year.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Update failed');
      setNote({ kind: 'ok', text: 'Title updated.' });
      await loadItems(itemsQuery, itemsMeta.page);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function rematchItem(item) {
    setBusy(item._id);
    setNote({ kind: null, text: `Re-matching "${item.title}" against TMDB…` });
    try {
      const response = await fetch('/api/admin/vod/items/rematch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item._id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Re-match failed');
      setNote({ kind: data.matched ? 'ok' : null, text: data.message });
      await loadItems(itemsQuery, itemsMeta.page);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Remove "${item.title}" from ReTro? It returns on the next sync if its source still lists it.`)) return;
    setBusy(item._id);
    try {
      await fetch(`/api/admin/vod/items?id=${item._id}`, { method: 'DELETE' });
      setNote({ kind: 'ok', text: 'Title removed.' });
      await loadItems(itemsQuery, itemsMeta.page);
    } finally {
      setBusy('');
    }
  }

  const syncRunning = Boolean(sync?.running);
  const syncElapsed = sync?.startedAt && syncRunning ? Math.round((Date.now() - new Date(sync.startedAt).getTime()) / 1000) : null;

  return (
    <div>
      <form className="jv-ad-card" onSubmit={addSource}>
        <p className="jv-ad-card-title">Add a VOD source</p>
        <p className="jv-ad-card-sub">An M3U playlist URL. The original sources were seeded in on first run — manage them all here from now on.</p>
        <div className="jv-ad-toolbar">
          <input className="jv-ad-input" style={{ flex: '0 1 200px' }} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name (e.g. Aha)" />
          <div className="jv-ad-search">
            <input className="jv-ad-input" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://…/list.m3u" />
          </div>
          <button type="submit" className="jv-ad-btn is-primary" disabled={!form.name.trim() || !form.url.trim() || busy === 'add'}>Add</button>
        </div>
      </form>

      <div className="jv-ad-toolbar">
        <button type="button" className="jv-ad-btn is-green" onClick={startSync} disabled={busy === 'sync' || syncRunning}>
          {syncRunning ? `Syncing… ${syncElapsed !== null ? `${syncElapsed}s` : ''}` : 'Sync all sources'}
        </button>
        <button type="button" className="jv-ad-btn" onClick={() => loadItems(itemsQuery, itemsMeta.page)} disabled={itemsLoading}>Reload titles</button>
        {syncRunning ? <span style={{ color: 'var(--ad-faint)', fontSize: 12 }}>running in the background — this panel polls every 5 s</span> : null}
      </div>

      {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {sync?.error ? <p className="jv-ad-note is-bad">Last sync error: {sync.error}</p> : null}
      {status === 'loading' ? <p className="jv-ad-empty">Loading sources…</p> : null}

      {sources.length ? (
        <div className="jv-ad-table">
          {sources.map((source) => (
            <div key={source._id} className="jv-ad-row" style={source.enabled ? undefined : { opacity: 0.55 }}>
              <span className="jv-ad-row-ico">🎞️</span>
              <div className="jv-ad-row-who">
                <b>{source.name}</b>
                <span>{source.url}
                  {source.lastSyncAt ? ` · synced ${new Date(source.lastSyncAt).toLocaleString()}` : ' · never synced'}
                  {source.lastError ? ` · ⚠ ${source.lastError}` : ''}</span>
              </div>
              <div className="jv-ad-actions">
                <button type="button" className="jv-ad-btn is-sm" onClick={() => rename(source)}>Rename</button>
                <button type="button" className="jv-ad-btn is-sm is-amber" disabled={busy === source._id} onClick={() => patchSource(source, { enabled: !source.enabled }, source.enabled ? 'Source disabled — syncs skip it.' : 'Source enabled.')}>
                  {source.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="jv-ad-btn is-sm is-danger" onClick={() => deleteSource(source)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="jv-ad-card">
        <p className="jv-ad-card-title">Titles manager {itemsMeta.total ? `· ${itemsMeta.total} titles` : ''}</p>
        <p className="jv-ad-card-sub">Edit the stored title/year, force a re-match against TMDB, or remove a title entirely.</p>
        <div className="jv-ad-toolbar">
          <div className="jv-ad-search">
            <input className="jv-ad-input" value={itemsQuery} onChange={(event) => setItemsQuery(event.target.value)} placeholder="Search synced classics…" />
          </div>
        </div>

        {itemsLoading && !items.length ? <p className="jv-ad-empty" style={{ padding: 18 }}>Loading…</p> : null}
        {!itemsLoading && !items.length ? <p className="jv-ad-empty" style={{ padding: 18 }}>No titles yet — run a sync, or nothing matches this search.</p> : null}

        {items.length ? (
          <>
            <div className="jv-ad-table" style={{ marginTop: 8 }}>
              {items.map((item) => (
                <div key={item._id} className="jv-ad-row">
                  {item.posterUrl ? <img className="jv-ad-row-img" style={{ width: 34, height: 48 }} src={item.posterUrl} alt="" loading="lazy" /> : <span className="jv-ad-row-ico">🎬</span>}
                  <div className="jv-ad-row-who">
                    <b>{item.title}{item.year ? ` (${item.year})` : ''}</b>
                    <span>{item.tmdbMatched ? `✓ TMDB ${item.tmdbId}` : '○ unmatched'}{item.sources?.length ? ` · ${item.sources.join(', ')}` : ''}{item.rating ? ` · ★${item.rating.toFixed(1)}` : ''}</span>
                  </div>
                  <div className="jv-ad-actions">
                    <button type="button" className="jv-ad-btn is-sm" disabled={busy === item._id} onClick={() => editItem(item)}>Edit</button>
                    <button type="button" className="jv-ad-btn is-sm is-amber" disabled={busy === item._id} onClick={() => rematchItem(item)}>Re-match</button>
                    <button type="button" className="jv-ad-btn is-sm is-danger" disabled={busy === item._id} onClick={() => deleteItem(item)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            {itemsMeta.pages > 1 ? (
              <div className="jv-ad-pager">
                <button type="button" className="jv-ad-btn is-sm" disabled={itemsMeta.page <= 1} onClick={() => { const p = itemsMeta.page - 1; setItemsPage(p); loadItems(itemsQuery, p); }}>‹ Prev</button>
                <span>page {itemsMeta.page} / {itemsMeta.pages}</span>
                <button type="button" className="jv-ad-btn is-sm" disabled={itemsMeta.page >= itemsMeta.pages} onClick={() => { const p = itemsMeta.page + 1; setItemsPage(p); loadItems(itemsQuery, p); }}>Next ›</button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
