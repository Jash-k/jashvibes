'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Music tab — every playlist management verb that used to live in /music,
 * consolidated here. /music itself is play-only now. Reuses the existing
 * /api/music/playlists CRUD, authorized by the owner's session cookie.
 */
export default function MusicTab() {
  const [playlists, setPlaylists] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [importUrl, setImportUrl] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/music/playlists?all=1', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Read failed');
      setPlaylists(data.items || []);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Read failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function importPlaylist(event) {
    event.preventDefault();
    if (!importUrl.trim()) return;
    setBusy('import');
    setNote(null);
    try {
      const response = await fetch('/api/music/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `Imported with ${data.failed || 0} failure(s)`);
      setNote({ kind: 'ok', text: `Imported ${data.count} playlist(s).` });
      setImportUrl('');
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function patch(id, body, message) {
    setBusy(id);
    try {
      const response = await fetch('/api/music/playlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
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

  async function rename(playlist) {
    const title = window.prompt('Rename playlist', playlist.title || '');
    if (!title || title === playlist.title) return;
    await patch(playlist.id, { title }, 'Renamed.');
  }

  async function remove(playlist) {
    if (!window.confirm(`Delete "${playlist.title}" and its ${playlist.songCount} matched songs?`)) return;
    setBusy(playlist.id);
    try {
      const response = await fetch(`/api/music/playlists?id=${encodeURIComponent(playlist.id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Delete failed');
      setNote({ kind: 'ok', text: 'Playlist deleted.' });
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  function move(playlist, direction) {
    const index = playlists.findIndex((item) => item.id === playlist.id);
    const adjacent = playlists[index + (direction < 0 ? -1 : 1)];
    if (!adjacent) return;
    Promise.all([
      patch(playlist.id, { sortOrder: adjacent.sortOrder ?? 100 }),
      patch(adjacent.id, { sortOrder: playlist.sortOrder ?? 100 }),
    ]).then(() => setNote({ kind: 'ok', text: 'Order updated.' }));
  }

  return (
    <div>
      <form className="jv-ad-card" onSubmit={importPlaylist}>
        <p className="jv-ad-card-title">Import a Spotify playlist</p>
        <p className="jv-ad-card-sub">Paste a public playlist URL. Matching to Saavn runs server-side and can take a minute.</p>
        <div className="jv-ad-toolbar">
          <div className="jv-ad-search">
            <input className="jv-ad-input" value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="https://open.spotify.com/playlist/…" />
          </div>
          <button type="submit" className="jv-ad-btn is-primary" disabled={!importUrl.trim() || busy === 'import'}>{busy === 'import' ? 'Importing…' : 'Import'}</button>
        </div>
      </form>

      {note ? <p className={`jv-ad-note is-${note.kind}`}>{note.text}</p> : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {status === 'loading' ? <p className="jv-ad-empty">Loading playlists…</p> : null}
      {status === 'ready' && !playlists.length ? <p className="jv-ad-empty">No imported playlists yet. Paste a Spotify URL above.</p> : null}

      {playlists.length ? (
        <div className="jv-ad-table">
          {playlists.map((playlist, index) => (
            <div key={playlist.id} className={`jv-ad-row ${playlist.isDefault ? '' : ''}`} style={playlist.isDefault ? undefined : { opacity: 0.55 }}>
              {playlist.image ? <img className="jv-ad-row-img" src={playlist.image} alt="" loading="lazy" /> : <span className="jv-ad-row-ico">🎵</span>}
              <div className="jv-ad-row-who">
                <b>{playlist.title}</b>
                <span>{playlist.songCount} matched{playlist.totalCount ? ` / ${playlist.totalCount}` : ''} · {playlist.owner || 'Spotify'}{playlist.isDefault ? '' : ' · hidden from /music'}</span>
              </div>
              <div className="jv-ad-actions">
                <button type="button" className="jv-ad-btn is-sm" disabled={index === 0 || busy === playlist.id} onClick={() => move(playlist, -10)}>↑</button>
                <button type="button" className="jv-ad-btn is-sm" disabled={index === playlists.length - 1 || busy === playlist.id} onClick={() => move(playlist, 10)}>↓</button>
                <button type="button" className="jv-ad-btn is-sm" onClick={() => rename(playlist)}>Rename</button>
                <button type="button" className="jv-ad-btn is-sm is-amber" disabled={busy === playlist.id} onClick={() => patch(playlist.id, { isDefault: !playlist.isDefault }, playlist.isDefault ? 'Hidden from /music.' : 'Visible in /music again.')}>
                  {playlist.isDefault ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="jv-ad-btn is-sm is-danger" onClick={() => remove(playlist)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p className="jv-ad-note">The /music page keeps playing whatever is visible here — importing, renaming, ordering, hiding and deleting all happen in this room only.</p>
    </div>
  );
}
