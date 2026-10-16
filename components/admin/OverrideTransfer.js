'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * OverrideTransfer — take a copy of every override out, and put one back.
 *
 * Every other control in this panel writes. This is the way out: a JSON file of the whole override
 * set (hides, pins, corrections, notes) that can be kept, diffed, or restored after a bad import.
 *
 * Import has two modes and the difference matters:
 *   · **Merge** (default) adds and updates, one history entry per row, so it is undoable row by row.
 *   · **Replace** wipes the set first and cannot be undone from the panel — the button says so, and
 *     the export sitting next to it is the way back.
 *
 * The file is parsed client-side first so an obviously wrong file never reaches the server, and the
 * count is shown before anything is written.
 */
export default function OverrideTransfer({ onChanged }) {
  const [count, setCount] = useState(null);
  const [status, setStatus] = useState('loading');
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('merge');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/catalog/overrides/export', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not count the overrides');
      setCount(payload.count ?? 0);
      setStatus('ready');
    } catch (error) {
      setStatus('error');
      setNote({ kind: 'bad', text: error.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onPick(event) {
    const picked = event.target.files?.[0];
    setNote(null);
    if (!picked) { setFile(null); return; }
    try {
      const text = await picked.text();
      const parsed = JSON.parse(text);
      const overrides = Array.isArray(parsed) ? parsed : parsed.overrides;
      if (!Array.isArray(overrides)) throw new Error('That file has no "overrides" list in it.');
      if (!overrides.length) throw new Error('That file has an empty override list.');
      const bad = overrides.findIndex((entry) => !entry || !entry.key);
      if (bad !== -1) throw new Error(`Override ${bad + 1} has no key — the file looks damaged.`);
      setFile({ name: picked.name, overrides });
    } catch (error) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      setNote({ kind: 'bad', text: error.message });
    }
  }

  async function apply() {
    if (!file) return;
    if (mode === 'replace' && !window.confirm(`Replace all ${count ?? 0} stored overrides with the ${file.overrides.length} in this file? This cannot be undone from the panel.`)) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch('/api/admin/catalog/overrides/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, overrides: file.overrides }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Import failed');
      setNote({ kind: 'ok', text: payload.message });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      await load();
      if (onChanged) onChanged();
    } catch (error) {
      setNote({ kind: 'bad', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jv-ad-card" style={{ marginTop: 12 }}>
      <p className="jv-ad-card-title">Override backup</p>
      <p className="jv-ad-card-sub">
        Every hide, pin, correction and note for the home catalogue, as a file you keep.
        {status === 'ready' ? ` ${count} stored override${count === 1 ? '' : 's'} right now.` : ''}
      </p>
      <div className="jv-ad-toolbar">
        <a className="jv-ad-btn is-primary" href="/api/admin/catalog/overrides/export?download=1">Download overrides</a>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="jv-ad-input"
          style={{ maxWidth: 260 }}
          onChange={onPick}
        />
        {file ? (
          <>
            <select className="jv-ad-select" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="merge">Merge into what is stored</option>
              <option value="replace">Replace everything</option>
            </select>
            <button type="button" className={`jv-ad-btn ${mode === 'replace' ? 'is-danger' : 'is-amber'}`} disabled={busy} onClick={apply}>
              {busy ? 'Importing…' : `Import ${file.overrides.length} from ${file.name}`}
            </button>
            <button type="button" className="jv-ad-btn" disabled={busy} onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ''; }}>Cancel</button>
          </>
        ) : null}
      </div>
      <p className="jv-ad-hint">
        Merge is undoable row by row from History. Replace wipes the stored set first and is not undoable
        from the panel — which is exactly why the download button is on the left.
      </p>
      {note ? <p className={`jv-ad-note is-${note.kind}`}>{note.text}</p> : null}
    </div>
  );
}
