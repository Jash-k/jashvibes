'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * HistoryTab — every change the panel made, newest first, each one undoable when it can be.
 *
 * This is the answer to "why is this title like this?": open the row in Home, ask for its
 * history, and see the action, when it happened, and what it looked like before. Undo writes the
 * snapshot back, so a mistake costs one click instead of a re-scrape.
 *
 * Actions that cannot be undone say so with a reason instead of hiding the button — a sync, a
 * purge or an import has already changed the world upstream, and pretending otherwise would be
 * the kind of lie this panel exists to avoid.
 */

const AREA_LABELS = {
  catalog: 'Home catalogue',
  vault: 'Vault',
  live: 'Live TV',
  retro: 'ReTro',
  stremio: 'Stremio',
  extras: 'Extras',
  lyrics: 'Lyrics',
  system: 'System',
};

export default function HistoryTab({ initialKey = '' }) {
  const [actions, setActions] = useState([]);
  const [areas, setAreas] = useState([]);
  const [area, setArea] = useState('');
  const [key, setKey] = useState(initialKey);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async (activeArea, activeKey, requestedLimit = 60) => {
    setStatus('loading');
    setError('');
    try {
      const params = new URLSearchParams({ area: activeArea || '', key: activeKey || '', limit: String(requestedLimit) });
      const response = await fetch(`/api/admin/history?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'History read failed');
      setActions(payload.actions || []);
      setAreas(payload.areas || []);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'History read failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(area, key); }, [area, key, load]);

  async function undo(row) {
    setBusy(row.id);
    setNote(null);
    try {
      const response = await fetch('/api/admin/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Undo failed');
      setNote({ kind: 'ok', text: `Undone — ${row.summary || row.action}` });
      await load(area, key);
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <div className="jv-ad-card">
        <div className="jv-ad-toolbar" style={{ marginTop: 0 }}>
          <div className="jv-ad-search">
            <input
              className="jv-ad-input"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="Filter by a row key (from a Home row's History button)…"
            />
          </div>
          <button type="button" className="jv-ad-btn" onClick={() => load(area, key)} disabled={status === 'loading'}>Reload</button>
        </div>
        <div className="jv-ad-chiprow" role="group" aria-label="Area">
          <span className="jv-ad-chiplabel">Area</span>
          <button type="button" className={`jv-ad-chip ${area === '' ? 'is-active' : ''}`} onClick={() => setArea('')}>All</button>
          {areas.map((id) => (
            <button key={id} type="button" className={`jv-ad-chip ${area === id ? 'is-active' : ''}`} onClick={() => setArea(id)}>{AREA_LABELS[id] || id}</button>
          ))}
        </div>
        {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
        <p className="jv-ad-hint">
          Every change made from this panel is recorded with what it replaced, so a mistake is one click to
          reverse. Re-scrapes, cache purges and imports are recorded too, but they say why they cannot be undone.
        </p>
      </div>

      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {status === 'ready' && !actions.length ? (
        <p className="jv-ad-empty">
          Nothing recorded yet{key ? ` for “${key}”` : ''}. Changes made from this panel appear here as you make them.
        </p>
      ) : null}

      <div className="jv-ad-table">
        {actions.map((row) => (
          <div key={row.id} className={`jv-ad-tr ${row.revertedAt ? 'is-hidden' : ''}`}>
            <div className="jv-ad-trmain" style={{ cursor: 'default' }}>
              <span className={`jv-ad-hbadge ${row.revertedAt ? 'is-undone' : row.reversible ? 'is-ok' : 'is-norev'}`}>
                {row.revertedAt ? 'Undone' : row.reversible ? 'Undoable' : 'No undo'}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="jv-ad-title">{row.summary || row.action}</span>
                <span className="jv-ad-metatitle">
                  {AREA_LABELS[row.area] || row.area} · {row.action}
                  {row.target?.label ? ` · ${row.target.label}` : ''}
                  {row.target?.key ? ` · key: ${row.target.key}` : ''}
                </span>
              </span>
              <span className="jv-ad-tags">
                <span className="jv-ad-hwhen">{when(row.at)}</span>
              </span>
            </div>
            <div className="jv-ad-drawer-actions" style={{ padding: '0 12px 10px' }}>
              {row.reversible ? (
                <button type="button" className="jv-ad-btn is-sm is-amber" disabled={busy === row.id} onClick={() => undo(row)}>
                  {busy === row.id ? 'Undoing…' : 'Undo this change'}
                </button>
              ) : (
                <span className="jv-ad-nowhy">
                  {row.revertedAt
                    ? 'This change has already been undone.'
                    : 'Cannot be undone — the change it describes is outside this panel (a sync, purge or import).'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function when(value) {
  if (!value) return '';
  const at = new Date(value);
  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return at.toLocaleString();
}
