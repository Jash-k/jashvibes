'use client';

import { useCallback, useEffect, useState } from 'react';
import HomeTab from '@/components/admin/HomeTab';
import MusicTab from '@/components/admin/MusicTab';
import TvTab from '@/components/admin/TvTab';
import RetroTab from '@/components/admin/RetroTab';
import StremioTab from '@/components/admin/StremioTab';

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'music', label: 'Music' },
  { id: 'tv', label: 'TV' },
  { id: 'retro', label: 'ReTro' },
  { id: 'stremio', label: 'Stremio' },
];

function Gate({ onUnlocked }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event?.preventDefault?.();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'Unlock failed');
      onUnlocked();
    } catch (err) {
      setError(err.message || 'Unlock failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jv-ad-page">
      <div className="jv-ad-gate">
        <form className="jv-ad-gate-card" onSubmit={submit}>
          <div className="jv-ad-gate-glyph" aria-hidden="true">⚙</div>
          <h1>Admin</h1>
          <p>The JaSH ViBeS control room. This password is yours alone — it is not the theatre password.</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Admin password"
            autoComplete="off"
            autoFocus
            className="jv-ad-input"
            style={{ textAlign: 'center' }}
          />
          {error ? <p className="jv-ad-note is-bad" style={{ marginTop: 12 }}>{error}</p> : null}
          <button type="submit" className="jv-ad-btn is-primary" disabled={!password || busy} style={{ width: '100%', marginTop: 14, padding: '12px' }}>
            {busy ? 'Unlocking…' : 'Enter the control room'}
          </button>
          <p style={{ marginTop: 14, fontSize: 11, color: 'var(--ad-faint)' }}>
            <a href="/" style={{ color: 'var(--ad-dim)' }}>← Back to the theatre</a>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [status, setStatus] = useState('checking'); // checking | gate | ready | unconfigured | error
  const [error, setError] = useState('');
  const [tab, setTab] = useState('home');
  const [panelTick, setPanelTick] = useState(0);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/auth', { cache: 'no-store' });
      if (response.ok) setStatus('ready');
      else if (response.status === 503) setStatus('unconfigured');
      else setStatus('gate');
    } catch {
      setError('Server unreachable.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (wanted && TABS.some((entry) => entry.id === wanted)) setTab(wanted);
    check();
  }, [check]);

  async function logout() {
    await fetch('/api/admin/auth', { method: 'DELETE' }).catch(() => {});
    setStatus('gate');
  }

  if (status === 'checking') {
    return (
      <div className="jv-ad-page">
        <div className="jv-ad-gate"><p style={{ color: 'var(--ad-dim)' }}>Checking the control room…</p></div>
      </div>
    );
  }

  if (status === 'unconfigured') {
    return (
      <div className="jv-ad-page">
        <div className="jv-ad-gate">
          <div className="jv-ad-gate-card">
            <div className="jv-ad-gate-glyph" aria-hidden="true">⚙</div>
            <h1>Admin is off</h1>
            <p>
              Set the <b>ADMIN_PASS</b> environment variable in your Render dashboard
              (Environment → ADMIN_PASS), redeploy, and this panel wakes up.
            </p>
            <a className="jv-ad-btn is-ghost" href="/">← Back to the theatre</a>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'gate') return <Gate onUnlocked={() => { setPanelTick((tick) => tick + 1); setStatus('ready'); }} />;

  if (status === 'error') {
    return (
      <div className="jv-ad-page">
        <div className="jv-ad-gate">
          <div className="jv-ad-gate-card">
            <h1>Offline</h1>
            <p>{error}</p>
            <button type="button" className="jv-ad-btn is-primary" onClick={check}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="jv-ad-page" key={panelTick}>
      <div className="jv-ad-shell">
        <div className="jv-ad-mast">
          <div>
            <p className="jv-ad-kicker">JaSH ViBeS · Control Room</p>
            <h1 className="jv-ad-heading">Admin</h1>
            <p className="jv-ad-sub">Every section, one seat: catalog, playlists, live TV, classics and Stremio.</p>
          </div>
          <div className="jv-ad-mast-actions">
            <a className="jv-ad-btn is-ghost" href="/">Open the theatre ↗</a>
            <button type="button" className="jv-ad-btn" onClick={logout}>Log out</button>
          </div>
        </div>

        <div className="jv-ad-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`jv-ad-tab ${tab === entry.id ? 'is-active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <hr className="jv-ad-rule" />

        {tab === 'home' ? <HomeTab /> : null}
        {tab === 'music' ? <MusicTab /> : null}
        {tab === 'tv' ? <TvTab /> : null}
        {tab === 'retro' ? <RetroTab /> : null}
        {tab === 'stremio' ? <StremioTab /> : null}
      </div>
    </div>
  );
}
