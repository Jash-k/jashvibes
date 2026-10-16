'use client';

import { useState } from 'react';

/**
 * BulkBar — one edit across every selected row, shown before it is applied.
 *
 * The flow is deliberately two-step: pick an action, press **Preview**, read the list of rows that
 * would change (with their before → after) and the rows that would be skipped because they are
 * already in that state, then apply. The preview and the apply are the same planner on the server,
 * so the list you approve is the change that runs.
 *
 * Two rules that keep a 40-row edit reversible:
 *   · every changed row records its own history entry, so undoing one row does not undo forty;
 *   · "Forget overrides" is the only destructive option, and it says so on the button.
 */

const OPS = [
  { id: 'hide', label: 'Remove from home', hint: 'Hidden rows stay in the panel and can be restored.' },
  { id: 'restore', label: 'Restore', hint: 'Un-hides the row.' },
  { id: 'pin', label: 'Pin to top', hint: 'Pinned rows float to the top of their section.' },
  { id: 'unpin', label: 'Unpin', hint: 'Back into the scraped order.' },
  { id: 'set-quality', label: 'Set quality', value: true, hint: 'Overrides the quality tag shown on the row.' },
  { id: 'retag', label: 'Correct title', value: true, hint: 'Overrides the parsed title. One value for every selected row — usually one row at a time.' },
  { id: 'forget', label: 'Forget overrides', danger: true, hint: 'Deletes the overrides entirely: the rows go back to exactly what the scraper says.' },
];

export default function BulkBar({ selected = [], view = {}, onClear, onApplied, onSelectView }) {
  const [op, setOp] = useState('hide');
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);

  const active = OPS.find((entry) => entry.id === op) || OPS[0];
  const needsValue = Boolean(active.value);
  const ready = selected.length > 0 && (!needsValue || value.trim());

  async function run(mode) {
    setBusy(true);
    setError('');
    setNote(null);
    try {
      const response = await fetch('/api/admin/catalog/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          op: { op, value: needsValue ? value.trim() : '' },
          keys: selected,
          q: view.q || '',
          filter: view.filter || 'all',
          section: view.section || 'all',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Bulk edit failed');
      if (mode === 'preview') {
        setPreview(payload);
        setNote(null);
      } else {
        setNote({ kind: 'ok', text: payload.message || 'Applied.' });
        setPreview(null);
        if (onApplied) await onApplied();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectView() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/catalog/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'select', q: view.q || '', filter: view.filter || 'all', section: view.section || 'all' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not select the view');
      if (onSelectView) onSelectView(payload.keys || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jv-ad-bulk">
      <div className="jv-ad-bulk-row">
        <span className="jv-ad-bulk-count">
          {selected.length ? `${selected.length} selected` : 'Nothing selected'}
        </span>
        <select className="jv-ad-select" value={op} onChange={(event) => { setOp(event.target.value); setPreview(null); }}>
          {OPS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select>
        {needsValue ? (
          <input
            className="jv-ad-input is-narrow"
            value={value}
            onChange={(event) => { setValue(event.target.value); setPreview(null); }}
            placeholder={op === 'set-quality' ? '1080p' : 'Correct title'}
          />
        ) : null}
        <button type="button" className="jv-ad-btn is-primary" disabled={!ready || busy} onClick={() => run('preview')}>
          {busy && !preview ? 'Working…' : 'Preview'}
        </button>
        <button type="button" className="jv-ad-btn" disabled={busy} onClick={selectView}>
          Select this view
        </button>
        <button type="button" className="jv-ad-btn" disabled={!selected.length || busy} onClick={onClear}>
          Clear
        </button>
      </div>
      <p className="jv-ad-hint" style={{ marginTop: 4 }}>{active.hint}</p>

      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {note ? <p className={`jv-ad-note is-${note.kind}`}>{note.text}</p> : null}

      {preview ? (
        <div className="jv-ad-bulk-preview">
          <p className="jv-ad-bulk-summary">{preview.summary}</p>
          {preview.changed.length ? (
            <div className="jv-ad-table">
              {preview.changed.slice(0, 60).map((row) => (
                <div key={row.key} className="jv-ad-tr">
                  <div className="jv-ad-trmain" style={{ cursor: 'default' }}>
                    <span className="jv-ad-title" style={{ flex: 1 }}>{row.label}</span>
                    <span className="jv-ad-bulk-diff">
                      {describe(row.before)} <span className="jv-ad-arrow">→</span> {describe(row.after)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="jv-ad-hint">Every selected row is already in that state — nothing would change.</p>}
          {preview.changed.length > 60 ? <p className="jv-ad-hint">…and {preview.changed.length - 60} more (all of them will be applied).</p> : null}
          {preview.skipped.length ? (
            <p className="jv-ad-hint">
              {preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} already in that state and left alone: {preview.skipped.slice(0, 6).map((row) => row.label).join(', ')}{preview.skipped.length > 6 ? '…' : ''}
            </p>
          ) : null}
          {preview.missing ? <p className="jv-ad-note is-bad">{preview.missing} selected row(s) are not in the current catalogue and were left alone.</p> : null}
          <div className="jv-ad-toolbar">
            <button
              type="button"
              className={`jv-ad-btn ${active.danger ? 'is-danger' : 'is-primary'}`}
              disabled={!preview.changed.length || busy}
              onClick={() => run('apply')}
            >
              {busy ? 'Applying…' : `Apply to ${preview.changed.length} row${preview.changed.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="jv-ad-btn" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A one-line reading of an override snapshot, for the preview's before → after. */
function describe(snapshot) {
  if (!snapshot) return 'no override';
  const bits = [];
  if (snapshot.hidden) bits.push('hidden');
  if (snapshot.pinned) bits.push('pinned');
  if (snapshot.titleOverride) bits.push(`title “${snapshot.titleOverride}”`);
  if (snapshot.yearOverride) bits.push(`year ${snapshot.yearOverride}`);
  if (snapshot.qualityOverride) bits.push(`quality ${snapshot.qualityOverride}`);
  if (snapshot.note) bits.push('note');
  return bits.length ? bits.join(', ') : 'no override';
}
