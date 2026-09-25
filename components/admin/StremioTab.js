'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Stremio tab — the addon registry (add / edit / enable / delete + manifest
 * health check) and the global shelf pins (one shelf order on every device).
 */
export default function StremioTab() {
  const [addons, setAddons] = useState([]);
  const [pins, setPins] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState(null);
  const [form, setForm] = useState({ label: '', manifestUrl: '', kind: 'catalog' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [addonsResponse, pinsResponse] = await Promise.all([
        fetch('/api/admin/stremio/addons', { cache: 'no-store' }),
        fetch('/api/stremio/pins', { cache: 'no-store' }),
      ]);
      const addonsData = await addonsResponse.json().catch(() => ({}));
      const pinsData = await pinsResponse.json().catch(() => ({}));
      if (!addonsResponse.ok || !addonsData.ok) throw new Error(addonsData.error || 'Read failed');
      setAddons(addonsData.addons || []);
      setPins(pinsData.pins || []);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Read failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addAddon(event) {
    event.preventDefault();
    setBusy('add');
    try {
      const response = await fetch('/api/admin/stremio/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Save failed');
      setForm({ label: '', manifestUrl: '', kind: 'catalog' });
      setNote({ kind: 'ok', text: 'Addon registered. Run a health check to confirm its manifest.' });
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function patchAddon(addon, body, message) {
    setBusy(addon._id);
    try {
      const response = await fetch('/api/admin/stremio/addons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: addon._id, ...body }),
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

  async function deleteAddon(addon) {
    if (!window.confirm(`Remove addon "${addon.label}" from the registry?`)) return;
    setBusy(addon._id);
    try {
      await fetch(`/api/admin/stremio/addons?id=${addon._id}`, { method: 'DELETE' });
      setNote({ kind: 'ok', text: 'Addon removed.' });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function checkAll() {
    setBusy('check');
    setNote({ kind: null, text: 'Fetching manifests…' });
    try {
      const response = await fetch('/api/admin/stremio/addons/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Check failed');
      const bad = (data.results || []).filter((row) => row.lastStatus !== 'ok').length;
      setNote({ kind: bad ? 'bad' : 'ok', text: `${data.message}${bad ? ` ${bad} failed — see the status chips.` : ''}` });
      await load();
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function resetPins() {
    if (!window.confirm('Reset the global shelf order? Every device falls back to defaults.')) return;
    await fetch('/api/stremio/pins', { method: 'DELETE' });
    setPins([]);
    setNote({ kind: 'ok', text: 'Global pins reset.' });
  }

  return (
    <div>
      <form className="jv-ad-card" onSubmit={addAddon}>
        <p className="jv-ad-card-title">Register an addon</p>
        <p className="jv-ad-card-sub">A Stremio addon manifest URL. The catalog addon feeds /stremio; the watch addon resolves streams. Env values were seeded in on first run.</p>
        <div className="jv-ad-toolbar">
          <input className="jv-ad-input" style={{ flex: '0 1 170px' }} value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="Label" />
          <select className="jv-ad-select" value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}>
            <option value="catalog">catalog</option>
            <option value="watch">watch</option>
          </select>
          <div className="jv-ad-search">
            <input className="jv-ad-input" value={form.manifestUrl} onChange={(event) => setForm((current) => ({ ...current, manifestUrl: event.target.value }))} placeholder="https://…/manifest.json" />
          </div>
          <button type="submit" className="jv-ad-btn is-primary" disabled={!form.label.trim() || !form.manifestUrl.trim() || busy === 'add'}>Add</button>
        </div>
      </form>

      <div className="jv-ad-toolbar">
        <button type="button" className="jv-ad-btn is-amber" onClick={checkAll} disabled={busy === 'check'}>{busy === 'check' ? 'Checking…' : 'Health check all'}</button>
        <button type="button" className="jv-ad-btn is-danger" onClick={resetPins}>Reset global pins ({pins.length})</button>
      </div>

      {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
      {error ? <p className="jv-ad-note is-bad">{error}</p> : null}
      {status === 'loading' ? <p className="jv-ad-empty">Loading addons…</p> : null}

      {addons.length ? (
        <div className="jv-ad-table">
          {addons.map((addon) => (
            <div key={addon._id} className="jv-ad-row" style={addon.enabled ? undefined : { opacity: 0.55 }}>
              <span className="jv-ad-row-ico">{addon.kind === 'watch' ? '📥' : '🧩'}</span>
              <div className="jv-ad-row-who">
                <b>{addon.label}</b>
                <span>{addon.kind} · {addon.manifestUrl}
                  {addon.lastStatus === 'ok' ? ` · ✓ ${addon.addonName || 'healthy'}${addon.catalogCount ? ` · ${addon.catalogCount} catalogs` : ''}` : ''}
                  {addon.lastStatus === 'error' ? ` · ✗ ${addon.lastError || 'unreachable'}` : ''}
                  {addon.lastStatus === 'unknown' ? ' · not checked yet' : ''}</span>
              </div>
              <div className="jv-ad-actions">
                <button type="button" className="jv-ad-btn is-sm is-amber" disabled={busy === addon._id} onClick={() => patchAddon(addon, { enabled: !addon.enabled }, addon.enabled ? 'Addon disabled — env/built-in chain applies again.' : 'Addon enabled.')}>
                  {addon.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="jv-ad-btn is-sm is-danger" onClick={() => deleteAddon(addon)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {pins.length ? (
        <div className="jv-ad-card">
          <p className="jv-ad-card-title">Global shelf order</p>
          <p className="jv-ad-card-sub">These catalog keys play in this order on every device.</p>
          <div className="jv-ad-chiprow" style={{ marginTop: 10 }}>
            {pins.map((key, index) => <span key={key} className="jv-ad-tag">{index + 1}. {key}</span>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
