'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * DuplicatePanel — the same film uploaded more than once, with a suggested keep and merge.
 *
 * The forum re-uploads constantly (a second quality, fixed audio, a typo fix), and each upload is
 * its own topic and therefore its own row on the home page. This finds those groups and says which
 * row it would keep and why. It never merges on its own: you can change the "keep" choice in each
 * group, and merging hides the others (one history entry each) rather than deleting anything —
 * corrections from a losing row are carried onto the winner so a merge cannot lose your title fix.
 */
export default function DuplicatePanel({ onChanged }) {
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  // Per group: which row the owner wants to keep (defaults to the server's suggestion).
  const [keep, setKeep] = useState({});

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/duplicates', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Scan failed');
      setReport(payload);
      setStatus('ready');
      if (payload.count) setOpen(true);
    } catch (err) {
      setError(err.message || 'Scan failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function merge(group) {
    const winner = keep[group.key] || group.suggestedWinner?.key;
    const losers = group.rows.filter((row) => row.key !== winner).map((row) => row.key);
    if (!winner || !losers.length) return;
    setBusy(group.key);
    setNote(null);
    try {
      const response = await fetch('/api/admin/catalog/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep: winner, merge: losers }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Merge failed');
      setNote({ kind: 'ok', text: payload.message });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  const count = report?.count || 0;
  return (
    <div className="jv-ad-card" style={{ marginTop: 12 }}>
      <div className="jv-ad-toolbar" style={{ marginTop: 0 }}>
        <span className="jv-ad-title" style={{ flex: 1 }}>
          {status === 'ready'
            ? count
              ? `${count} duplicate group${count === 1 ? '' : 's'} — ${report.duplicates} row${report.duplicates === 1 ? '' : 's'} could be merged away`
              : 'No duplicate rows found'
            : 'Scanning for duplicates…'}
        </span>
        {count ? (
          <button type="button" className="jv-ad-btn is-sm" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide' : `Review ${count}`}
          </button>
        ) : null}
        <button type="button" className="jv-ad-btn is-sm" onClick={load} disabled={status === 'loading'}>Rescan</button>
      </div>

      {status === 'ready' && !count ? (
        <p className="jv-ad-hint" style={{ marginTop: 6 }}>
          Grouped by parsed title and type, allowing a year either way for a re-release. Nothing to merge.
        </p>
      ) : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {note ? <p className={`jv-ad-note is-${note.kind}`}>{note.text}</p> : null}

      {open && count ? (
        <>
          <p className="jv-ad-hint">
            Merging hides the other copies (each separately undoable in History) and copies any title, year or
            quality correction from a losing row onto the one you keep. Nothing is deleted.
          </p>
          {report.groups.map((group) => {
            const winner = keep[group.key] || group.suggestedWinner?.key;
            return (
              <div key={group.key} className="jv-ad-orphan">
                <div className="jv-ad-tr">
                  <div className="jv-ad-trmain" style={{ cursor: 'default' }}>
                    <span className="jv-ad-title" style={{ flex: 1 }}>
                      {group.title}{group.year ? ` (${group.year})` : ''}
                    </span>
                    <span className="jv-ad-tag is-dim">{group.type}</span>
                    <span className="jv-ad-metatitle">{group.rows.length} copies</span>
                  </div>
                </div>
                <div style={{ padding: '4px 12px' }}>
                  {group.rows.map((row) => (
                    <label key={row.key} className="jv-ad-pick">
                      <input
                        type="radio"
                        name={`keep-${group.key}`}
                        checked={winner === row.key}
                        onChange={() => setKeep((current) => ({ ...current, [group.key]: row.key }))}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="jv-ad-title">{row.rawTitle || row.title}</span>
                        <span className="jv-ad-metatitle">
                          {row.tmdbId ? `TMDB ${row.tmdbId}` : 'no TMDB match'}
                          {row.hidden ? ' · hidden' : ''}{row.pinned ? ' · pinned' : ''}
                          {row.qualityTier ? ` · tier ${row.qualityTier}` : ''}
                        </span>
                      </span>
                      <span className="jv-ad-tag is-dim">{winner === row.key ? 'keep' : 'merge away'}</span>
                    </label>
                  ))}
                </div>
                <div className="jv-ad-drawer-actions" style={{ padding: '0 12px 12px' }}>
                  <button type="button" className="jv-ad-btn is-sm is-amber" disabled={busy === group.key} onClick={() => merge(group)}>
                    {busy === group.key ? 'Merging…' : `Merge ${group.rows.length - 1} into the chosen row`}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
