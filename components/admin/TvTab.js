'use client';

import { Component, useCallback, useEffect, useState } from 'react';
import LiveServicePanel from '@/components/live/LiveServicePanel';
import { useLiveGuide } from '@/components/live/LiveGuide';

/**
 * A crash inside the panel should never take the whole admin screen down —
 * this boundary keeps the tab alive and SHOWS the real error, so a problem
 * is one screenshot away from a diagnosis.
 */
class PanelBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="jv-ad-card" style={{ borderColor: 'rgba(244,63,94,0.4)' }}>
          <p className="jv-ad-card-title" style={{ color: 'var(--ad-red)' }}>The service panel hit an error</p>
          <p className="jv-ad-card-sub" style={{ fontFamily: 'ui-monospace, monospace' }}>{String(this.state.error?.message || this.state.error)}</p>
          <button type="button" className="jv-ad-btn is-sm" style={{ marginTop: 10 }} onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * TV tab — the full service panel (extracted from /live) plus the one-button
 * health sweep. The panel keeps its modal shape: "Open" raises it over the tab.
 */
export default function TvTab() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [note, setNote] = useState(null);
  const [dead, setDead] = useState([]);
  const guide = useLiveGuide({});

  const refreshGuideFeed = useCallback(async () => {
    try { await guide.refresh(); } catch { /* the panel shows its own status */ }
  }, [guide]);

  const epg = {
    rows: guide.rows,
    status: guide.status,
    error: guide.error,
    linked: [...(guide.rows?.values?.() || [])].filter((row) => row.matched).length,
    unlinked: [...(guide.rows?.values?.() || [])].filter((row) => !row.matched).length,
    refresh: refreshGuideFeed,
    refreshing: guide.loading,
  };

  useEffect(() => { if (panelOpen) document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, [panelOpen]);

  const [autoConfig, setAutoConfig] = useState(null);
  const [autoStatus, setAutoStatus] = useState(null);
  const [autoToggling, setAutoToggling] = useState(false);
  const [autoNote, setAutoNote] = useState(null);
  const autoEnabled = autoConfig ? autoConfig.enabled !== false : true;

  const loadAutoSync = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/tv/auto-sync', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        setAutoConfig(data.config);
        setAutoStatus(data.status);
      }
    } catch { /* the card keeps its env defaults */ }
  }, []);

  useEffect(() => { loadAutoSync(); }, [loadAutoSync]);
  // While a run is live, poll like the ReTro sync does — the work happens in
  // the server background, this is purely a status light.
  useEffect(() => {
    if (!autoStatus?.running) return undefined;
    const timer = setTimeout(loadAutoSync, 5000);
    return () => clearTimeout(timer);
  }, [autoStatus, loadAutoSync]);

  async function runAutoSync() {
    setAutoToggling(true);
    try {
      const response = await fetch('/api/admin/tv/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runNow: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not start auto-sync');
      setAutoStatus(data.status);
      setAutoNote({ kind: null, text: data.started ? 'Sync started in the background — status updates here every few seconds.' : 'A sync is already running.' });
    } catch (err) {
      setAutoNote({ kind: 'bad', text: err.message });
    } finally {
      setAutoToggling(false);
    }
  }

  async function toggleAuto() {
    setAutoToggling(true);
    try {
      const response = await fetch('/api/admin/tv/auto-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autoEnabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not update auto-sync');
      setAutoConfig(data.config);
      setAutoStatus(data.status);
      setAutoNote({ kind: 'ok', text: data.config.enabled ? 'Auto-sync resumed.' : 'Auto-sync paused — the timer keeps ticking but skips runs until you resume it.' });
    } catch (err) {
      setAutoNote({ kind: 'bad', text: err.message });
    } finally {
      setAutoToggling(false);
    }
  }

  const autoSummary = (() => {
    if (autoStatus?.running) return 'Running now — this card live-updates…';
    const finished = autoStatus?.finishedAt;
    if (!finished) return 'No run yet on this instance. The first scheduled pass starts ~2 min after boot.';
    const sync = autoStatus?.result?.sync;
    const okCount = Array.isArray(sync) ? sync.filter((row) => row.ok).length : 0;
    const total = Array.isArray(sync) ? sync.length : 0;
    const sweepRes = autoStatus?.result?.sweep;
    const sweepText = sweepRes && Number.isFinite(sweepRes.checked) ? ` · sweep ${sweepRes.checked} ch, ${sweepRes.dead} dead` : '';
    const errText = autoStatus?.error ? ` · ${autoStatus.error}` : '';
    return `Last pass ${new Date(finished).toLocaleTimeString()} — ${okCount}/${total} sources synced${sweepText}${errText}`;
  })();

  async function sweep() {
    setSweeping(true);
    setNote({ kind: null, text: 'Sweeping channels — probing streams, this can take up to a minute…' });
    try {
      const response = await fetch('/api/admin/tv/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 120 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Sweep failed');
      setDead(data.dead || []);
      setNote({ kind: data.deadCount ? 'bad' : 'ok', text: data.message });
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally {
      setSweeping(false);
    }
  }

  return (
    <div>
      <div className="jv-ad-card">
        <div className="jv-ad-toolbar" style={{ marginTop: 0 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="jv-ad-card-title">Live TV service panel</p>
            <p className="jv-ad-card-sub">Sources, manual mapping, catalog order, duplicates, backups and the EPG binding picker — everything that used to live behind /live, in one overlay.</p>
          </div>
          <button type="button" className="jv-ad-btn is-primary" onClick={() => setPanelOpen(true)}>Open service panel</button>
        </div>
      </div>

      <div className="jv-ad-card">
        <div className="jv-ad-toolbar" style={{ marginTop: 0 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="jv-ad-card-title">Health sweep</p>
            <p className="jv-ad-card-sub">Probe a batch of channels and flag the ones that no longer answer. Dead channels are marked in the panel, where you can purge them.</p>
          </div>
          <button type="button" className="jv-ad-btn is-amber" onClick={sweep} disabled={sweeping}>{sweeping ? 'Sweeping…' : 'Run sweep'}</button>
        </div>
        {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
        {dead.length ? (
          <div className="jv-ad-table" style={{ marginTop: 10 }}>
            {dead.map((channel) => (
              <div key={channel.id || channel.name} className="jv-ad-row">
                <span className="jv-ad-row-ico">📡</span>
                <div className="jv-ad-row-who"><b>{channel.name || 'Unnamed channel'}</b><span>{channel.error || 'not answering'}</span></div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="jv-ad-card">
        <div className="jv-ad-toolbar" style={{ marginTop: 0 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="jv-ad-card-title">Auto-sync sources</p>
            <p className="jv-ad-card-sub">Re-syncs every live source on a timer (default hourly) and then health-probes the sports source — checks now follow the HLS chain down to a real video segment, so manifest-only streams (the v10.2.0 lesson) are flagged dead automatically. v10.2.1 onboarded Romaxa55's nightly-verified sports playlist.</p>
          </div>
          <button type="button" className="jv-ad-btn is-amber" onClick={runAutoSync} disabled={autoToggling || autoStatus?.running}>
            {autoStatus?.running ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" className={`jv-ad-btn ${autoEnabled ? 'is-primary' : ''}`} onClick={toggleAuto} disabled={autoToggling}>
            {autoEnabled ? 'Auto: ON' : 'Auto: OFF'}
          </button>
        </div>
        <p className={`jv-ad-note ${autoStatus?.error ? 'is-bad' : ''}`}>{autoSummary}</p>
        {autoNote ? <p className={`jv-ad-note ${autoNote.kind ? `is-${autoNote.kind}` : ''}`}>{autoNote.text}</p> : null}
      </div>

      {panelOpen ? (
        <PanelBoundary>
          <LiveServicePanel
            open
            epg={epg}
            onClose={() => setPanelOpen(false)}
            onPreview={() => {}}
            onMainRefresh={() => setNote({ kind: 'ok', text: 'Panel changes saved.' })}
          />
        </PanelBoundary>
      ) : null}
    </div>
  );
}
