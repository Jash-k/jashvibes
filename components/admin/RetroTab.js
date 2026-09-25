'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * ReTro tab — CRUD over the classics VOD sources (first run seeds from the
 * old hardcoded/env list) plus the sync trigger and an items browser.
 */
export default function RetroTab() {
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [form, setForm] = useState({ name: '', url: '' });
  const [busy, setBusy] = useState('');
  const [browser, setBrowser] = useState({ items: [], total: 0, q: '' });
  const [browserLoading, setBrowserLoading] = useState(false);

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

  useEffect(() => { load(); }, [load]);

  const loadBrowser = useCallback(async (q = '') => {
    setBrowserLoading(true);
    try {
      const params = new URLSearchParams({ limit: '24' });
      if (q) params.set('q', q);
      const response = await fetch(`/api/vod?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      setBrowser({ items: data.items || [], total: data.total || 0, q });
    } catch {
      setBrowser((current) => ({ ...current, items: [] }));
    } finally {
      setBrowserLoading(false);
    }
  }, []);

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

  async function syncAll() {
    setBusy('sync');
    setNote({ kind: null, text: 'Syncing every enabled source through the classics importer — this fetches M3Us and matches TMDB, so give it a minute…' });
    try {
      const response = await fetch('/api/admin/vod/sources/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Sync failed');
      setNote({ kind: 'ok', text: `${data.message || 'Synced.'} (${data.stored ?? '?'} titles stored)` });
      await Promise.all([load(), loadBrowser(browser.q)]);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Remove "${item.title}" from ReTro?`)) return;
    setBusy(item._id || item.id);
    try {
      await fetch(`/api/admin/vod/items?id=${encodeURIComponent(item._id || item.id)}`, { method: 'DELETE' });
      await loadBrowser(browser.q);
    } finally {
      setBusy('');
    }
  }

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
        <button type="button" className="jv-ad-btn is-green" onClick={syncAll} disabled={busy === 'sync'}>{busy === 'sync' ? 'Syncing…' : 'Sync all sources'}</button>
        <button type="button" className="jv-ad-btn" onClick={() => loadBrowser(browser.q)} disabled={browserLoading}>{browserLoading ? 'Loading…' : 'Reload items'}</button>
      </div>

      {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
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
        <p className="jv-ad-card-title">Items browser {browser.total ? `· ${browser.total} titles` : ''}</p>
        <div className="jv-ad-toolbar">
          <div className="jv-ad-search">
            <input
              className="jv-ad-input"
              placeholder="Search synced classics…"
              onKeyDown={(event) => { if (event.key === 'Enter') loadBrowser(event.currentTarget.value); }}
            />
          </div>
        </div>
        {browser.items.length ? (
          <div className="jv-ad-table">
            {browser.items.map((item) => (
              <div key={item._id || item.key} className="jv-ad-row">
                {item.posterUrl ? <img className="jv-ad-row-img" style={{ width: 34, height: 48 }} src={item.posterUrl} alt="" loading="lazy" /> : <span className="jv-ad-row-ico">🎬</span>}
                <div className="jv-ad-row-who"><b>{item.title}</b><span>{item.year || '—'} · {item.sources?.join(', ') || item.source || ''}</span></div>
                <div className="jv-ad-actions">
                  <button type="button" className="jv-ad-btn is-sm is-danger" onClick={() => deleteItem(item)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="jv-ad-empty" style={{ padding: 18 }}>Run a sync (or press Enter in the search) to see titles here.</p>
        )}
      </div>
    </div>
  );
}
