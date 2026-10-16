'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * OrphanPanel — the Home tab's "overrides that stopped applying" report.
 *
 * It is collapsed to one line when there is nothing to fix, because a healthy state should cost no
 * attention. When there *is* something, each orphan shows what it was doing (hidden / pinned /
 * corrected / note) and the closest live rows to re-bind to, with the reason the row was suggested.
 * Nothing is applied automatically — a wrong auto-re-bind writes the owner's correction onto the
 * wrong film, which is worse than the original problem.
 *
 * A second action per orphan: "Forget it", for an override whose title simply left the catalogue.
 */
export default function OrphanPanel({ onChanged }) {
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/orphans', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Report failed');
      setReport(payload);
      setStatus('ready');
      if (payload.count) setOpen(true);
    } catch (err) {
      setError(err.message || 'Report failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function rebind(orphan, suggestion) {
    setBusy(orphan.key);
    setNote(null);
    try {
      const response = await fetch('/api/admin/catalog/orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: orphan.key, to: suggestion.key }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Re-bind failed');
      setNote({ kind: 'ok', text: `Re-bound “${orphan.title}” onto “${suggestion.title}”.` });
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function forget(orphan) {
    setBusy(orphan.key);
    setNote(null);
    try {
      const response = await fetch(`/api/admin/catalog/overrides?key=${encodeURIComponent(orphan.key)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Delete failed');
      setNote({ kind: 'ok', text: `Forgot the stale override for “${orphan.title}”. Undo is in the History tab.` });
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
              ? `${count} override${count === 1 ? '' : 's'} no longer apply to any row`
              : 'Every override still points at a live row'
            : 'Checking overrides…'}
        </span>
        {count ? (
          <button type="button" className="jv-ad-btn is-sm" onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide' : `Review ${count}`}
          </button>
        ) : null}
        <button type="button" className="jv-ad-btn is-sm" onClick={load} disabled={status === 'loading'}>Re-check</button>
      </div>

      {status === 'ready' && !count ? (
        <p className="jv-ad-hint" style={{ marginTop: 6 }}>
          {report.applied} override{report.applied === 1 ? '' : 's'} in use. Nothing is stuck.
        </p>
      ) : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}

      {open && count ? (
        <>
          <p className="jv-ad-hint">
            An override is keyed by the <em>raw</em> scraped title. When the forum renames a release, the key
            changes and the override quietly stops applying — the row looks untouched, which is why this needs a report.
          </p>
          {report.orphans.map((orphan) => (
            <div key={orphan.key} className="jv-ad-orphan">
              <div className="jv-ad-tr">
                <div className="jv-ad-trmain" style={{ cursor: 'default' }}>
                  <span className="jv-ad-title">
                    {orphan.title}
                    {orphan.year ? <span className="jv-ad-metatitle"> · {orphan.year}</span> : null}
                  </span>
                  <span className="jv-ad-tags">
                    {orphan.hidden ? <span className="jv-ad-tag">hidden</span> : null}
                    {orphan.pinned ? <span className="jv-ad-tag">pinned</span> : null}
                    {orphan.overridden ? <span className="jv-ad-tag is-amber">corrected</span> : null}
                    <span className="jv-ad-tag is-dim">{orphan.type}</span>
                  </span>
                  <span className="jv-ad-metatitle" style={{ flexBasis: '100%' }}>
                    stored key: <code>{orphan.key}</code>
                    {orphan.updatedAt ? ` · last touched ${new Date(orphan.updatedAt).toLocaleDateString()}` : ''}
                  </span>
                </div>
              </div>
              <div className="jv-ad-drawer-actions" style={{ padding: '2px 12px 12px' }}>
                {orphan.suggestions.length ? orphan.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.key}
                    type="button"
                    className="jv-ad-btn is-sm is-amber"
                    disabled={busy === orphan.key}
                    onClick={() => rebind(orphan, suggestion)}
                    title={`${suggestion.why} — ${suggestion.key}`}
                  >
                    → {suggestion.title}{suggestion.year ? ` (${suggestion.year})` : ''}
                  </button>
                )) : (
                  <span className="jv-ad-nowhy">No similar row in the catalogue — the title has probably left it.</span>
                )}
                <button type="button" className="jv-ad-btn is-sm" disabled={busy === orphan.key} onClick={() => forget(orphan)}>
                  Forget it
                </button>
              </div>
              {orphan.suggestions.length ? (
                <p className="jv-ad-nowhy" style={{ padding: '0 12px 10px' }}>
                  Suggestions say why: {orphan.suggestions.map((suggestion) => suggestion.why).join(' · ')}
                </p>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
