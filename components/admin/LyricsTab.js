'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
// `lyricsSongKey` lives in lib/lyricsStore.js, which is server-side (mongoose).
// This tab is a client component, so it asks the pure matcher for the same key —
// the store's helper is literally a one-line wrapper around it.
import { lyricCacheKey } from '@/lib/lyricsMatch';

/**
 * Admin → Lyrics. Two jobs, both in service of "the lyrics section never fails":
 * fill in songs the provider does not carry, and see what is saved.
 *
 * Saving writes to the database and is served before any provider is asked, so
 * one paste here fixes a song permanently — for every viewer, on every deploy.
 * A paste with [mm:ss.xx] timestamps keeps the karaoke highlight; plain text
 * drops the stage to a static read.
 */
const empty = { title: '', artist: '', album: '', plainLyrics: '', syncedLyrics: '', note: '' };

async function api(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Request failed.');
  return data;
}

export default function LyricsTab() {
  const [view, setView] = useState('missing');
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1), [tick, setTick] = useState(0);
  const [state, setState] = useState({ items: [], total: 0, pages: 1 });
  const [status, setStatus] = useState('loading'), [error, setError] = useState(''), [note, setNote] = useState('');
  const [editing, setEditing] = useState(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading'); setError('');
    const query = view === 'missing' ? 'view=missing' : `view=overrides&q=${encodeURIComponent(search)}&page=${page}`;
    api(`/api/admin/lyrics?${query}`, { signal: controller.signal })
      .then((data) => { if (mounted.current) { setState({ items: data.items || [], total: data.total ?? (data.items || []).length, pages: data.pages || 1 }); setStatus('ready'); } })
      .catch((e) => { if (mounted.current && e.name !== 'AbortError') { setError(e.message); setStatus('error'); } });
    return () => controller.abort();
  }, [view, search, page, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  async function save(form) {
    setError('');
    try {
      await api('/api/admin/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', ...form }) });
      setEditing(null); setNote(`Saved “${form.title || form.artist}”. It now opens before any provider is asked.`); reload();
    } catch (e) { setError(e.message); }
  }
  async function remove(item) {
    if (!window.confirm(`Delete the saved lyrics for “${item.title || item.key}”? A provider lookup will be used again for this song.`)) return;
    try { await api('/api/admin/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: item.key }) }); setNote('Deleted.'); reload(); }
    catch (e) { setError(e.message); }
  }

  return (
    <section className="va-panel">
      <div className="va-heading">
        <div>
          <span className="va-eyebrow">LYRICS / OWNER WORKSPACE</span>
          <h2>Saved lyrics</h2>
          <p>LRCLIB is the only provider. Songs it does not have are filled in here once and then served from the database.</p>
        </div>
        <button onClick={() => setEditing({ ...empty })}>＋ Add lyrics</button>
      </div>

      <div className="va-toolbar">
        <label>Catalogue view
          <select value={view} onChange={(e) => { setView(e.target.value); setPage(1); }}>
            <option value="missing">Songs with no lyrics</option>
            <option value="overrides">Saved lyrics</option>
          </select>
        </label>
        {view === 'overrides' ? (
          <form onSubmit={(e) => { e.preventDefault(); setSearch(q); setPage(1); }} style={{ display: 'flex', gap: 12, flex: 3, alignItems: 'end' }}>
            <label>Search title, artist or key<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find saved lyrics…" /></label>
            <button>Search</button>
          </form>
        ) : null}
        <button type="button" onClick={reload}>Reload</button>
      </div>

      {error ? <p role="alert" className="va-error">{error}</p> : null}
      {note ? <p role="status">{note}</p> : null}
      {status === 'loading' ? <p role="status">Loading lyrics data…</p> : null}
      {status === 'ready' && !state.items.length ? (
        <p>{view === 'missing' ? 'Nothing recorded as missing yet — the list fills as songs are played.' : 'No saved lyrics yet.'}</p>
      ) : null}

      <div className="va-list">
        {state.items.map((item) => view === 'missing' ? (
          <article key={item.key}>
            <div className="va-row-main">
              <strong>{item.song?.title || '(untitled)'} <small>{item.song?.artist || ''}</small></strong>
              <p>{item.song?.album || 'album unknown'} · {item.reason || 'no match'}</p>
              <small>{item.key}</small>
            </div>
            <div className="va-row-actions">
              <button onClick={() => setEditing({ title: item.song?.title || '', artist: item.song?.artist || '', album: item.song?.album || '', plainLyrics: '', syncedLyrics: '', note: '' })}>Paste lyrics</button>
            </div>
          </article>
        ) : (
          <article key={item.key}>
            <div className="va-row-main">
              <strong>{item.title || '(untitled)'} <small>{item.artist || ''}</small></strong>
              <p>{item.album || 'album unknown'} · {item.syncedLyrics ? 'timed' : 'plain text'}{(item.plainLyrics || '').length ? ` · ${(item.plainLyrics || '').length} chars` : ''}</p>
              {item.note ? <p>{item.note}</p> : null}
              <small>{item.key}</small>
            </div>
            <div className="va-row-actions">
              <button onClick={() => setEditing({ ...empty, ...item })}>Edit</button>
              <button onClick={() => remove(item)}>Delete</button>
            </div>
          </article>
        ))}
      </div>

      {view === 'overrides' && state.pages > 1 ? (
        <div className="va-pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span>{state.total} saved · page {page} / {state.pages}</span>
          <button disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      ) : null}

      {editing ? <LyricsDialog form={editing} onClose={() => setEditing(null)} onSave={save} /> : null}
    </section>
  );
}

function LyricsDialog({ form: initial, onClose, onSave }) {
  const ref = useRef(null), previous = useRef(null);
  const [form, setForm] = useState({ ...initial });
  const [busy, setBusy] = useState(false);
  useEffect(() => { previous.current = document.activeElement; ref.current.showModal(); return () => previous.current?.focus?.(); }, []);
  const field = (name, value) => setForm((f) => ({ ...f, [name]: value }));
  const withTiming = Boolean(form.syncedLyrics.trim());
  return (
    <dialog ref={ref} className="va-dialog" aria-labelledby="va-lyrics-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}>
      <header>
        <div>
          <h2 id="va-lyrics-title">Saved lyrics</h2>
          <p>The key is derived from title, artist, album and duration — the same key the player looks up with.</p>
        </div>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close">✕</button>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); setBusy(true); Promise.resolve(onSave(form)).finally(() => setBusy(false)); }}>
        <div className="va-editor-body">
          <div className="va-fields">
            <label>Title<input value={form.title} onChange={(e) => field('title', e.target.value)} required maxLength={300} /></label>
            <label>Artist<input value={form.artist} onChange={(e) => field('artist', e.target.value)} maxLength={300} /></label>
            <label>Album / film<input value={form.album} onChange={(e) => field('album', e.target.value)} maxLength={300} /></label>
            <label>Private note<input value={form.note} onChange={(e) => field('note', e.target.value)} maxLength={2000} /></label>
          </div>
          <div className="va-fields">
            <label>Plain lyrics<textarea value={form.plainLyrics} onChange={(e) => field('plainLyrics', e.target.value)} spellCheck={false} /></label>
            <label>Timed lyrics (LRC, optional)<textarea value={form.syncedLyrics} onChange={(e) => field('syncedLyrics', e.target.value)} spellCheck={false} placeholder="[00:12.40] first line" /></label>
          </div>
          <p className="va-muted">
            {withTiming ? 'Timed lyrics are used first and keep the karaoke highlight.' : 'Without timing the stage drops to a static read — still never empty.'}
            {' '}Key: <code>{lyricCacheKey({ title: form.title, artist: form.artist, album: form.album })}</code>
          </p>
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save lyrics'}</button>
        </footer>
      </form>
    </dialog>
  );
}
