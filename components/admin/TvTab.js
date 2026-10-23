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
  const [sources, setSources] = useState([]);
  const [checking, setChecking] = useState(false);
  const [guideChannels, setGuideChannels] = useState([]);
  useEffect(() => { fetch('/api/live-service/channels?mapped=1&limit=1000', { cache: 'no-store' }).then((r) => r.json()).then((d) => setGuideChannels(d.channels || [])).catch(() => {}); }, [panelOpen]);
  const guide = useLiveGuide({ channels: guideChannels });

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
  // Load the source list once so the dots exist before the first Check.
  useEffect(() => { checkSources(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
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

  /**
   * Is each feed still answering? A source can sit in this tab looking
   * perfectly healthy while its host has been gone for months — you only find
   * out when a sync reports zero channels, which reads like a parsing problem
   * rather than a dead URL. One dot per source, no paragraph needed.
   */
  async function checkSources() {
    setChecking(true);
    try {
      const response = await fetch('/api/live-service/sources?health=1', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || 'Check failed');
      const rows = data.sources || [];
      setSources(rows);
      const down = rows.filter((item) => item.health && !item.health.ok);
      setNote({
        kind: down.length ? 'bad' : 'ok',
        text: down.length
          ? `${down.length} of ${rows.length} sources not answering — ${down.map((item) => item.label).join(', ')}`
          : `All ${rows.length} sources answered.`,
      });
    } catch (err) {
      setNote({ kind: 'bad', text: err.message });
    } finally { setChecking(false); }
  }

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
      <div className="jv-ad-card is-tight">
        <div className="jv-ad-toolbar" style={{ marginTop: 0, marginBottom: 0 }}>
          <p className="jv-ad-card-title" style={{ flex: 1, minWidth: 64 }}>Live TV</p>
          {sources.length ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              {sources.map((source) => {
                const health = source.health;
                const title = `${source.label} — ${!health ? 'not checked' : health.ok ? `HTTP ${health.status} in ${health.ms} ms` : (health.error || `HTTP ${health.status}`)}`;
                return (
                  <span
                    key={source.sourceId || source.id}
                    title={title}
                    style={{
                      width: 7, height: 7, borderRadius: 999,
                      background: !health ? '#52525b' : health.ok ? '#4ade80' : '#f43f5e',
                    }}
                  />
                );
              })}
            </span>
          ) : null}
          <button type="button" className="jv-ad-btn is-sm is-primary" onClick={() => setPanelOpen(true)}>Panel</button>
          <button type="button" className="jv-ad-btn is-sm" onClick={checkSources} disabled={checking}>{checking ? '…' : 'Check'}</button>
          <button type="button" className="jv-ad-btn is-sm" onClick={sweep} disabled={sweeping}>{sweeping ? '…' : 'Sweep'}</button>
          <button type="button" className="jv-ad-btn is-sm" onClick={runAutoSync} disabled={autoToggling || autoStatus?.running}>
            {autoStatus?.running ? '…' : 'Sync'}
          </button>
          <button type="button" className={`jv-ad-btn is-sm ${autoEnabled ? 'is-primary' : ''}`} onClick={toggleAuto} disabled={autoToggling}>
            {autoEnabled ? 'Auto ON' : 'Auto OFF'}
          </button>
        </div>

        <p className={`jv-ad-note ${autoStatus?.error ? 'is-bad' : ''}`}>{autoSummary}</p>
        {note ? <p className={`jv-ad-note ${note.kind ? `is-${note.kind}` : ''}`}>{note.text}</p> : null}
        {autoNote ? <p className={`jv-ad-note ${autoNote.kind ? `is-${autoNote.kind}` : ''}`}>{autoNote.text}</p> : null}

        {sources.filter((item) => item.health && !item.health.ok).length ? (
          <div className="jv-ad-table" style={{ marginTop: 8 }}>
            {sources.filter((item) => item.health && !item.health.ok).map((item) => (
              <div key={item.sourceId || item.id} className="jv-ad-row">
                <span className="jv-ad-row-ico">📡</span>
                <div className="jv-ad-row-who"><b>{item.label}</b><span>{item.health.error || `HTTP ${item.health.status}`}</span></div>
              </div>
            ))}
          </div>
        ) : null}

        {dead.length ? (
          <div className="jv-ad-table" style={{ marginTop: 8 }}>
            {dead.map((channel) => (
              <div key={channel.id || channel.name} className="jv-ad-row">
                <span className="jv-ad-row-ico">📡</span>
                <div className="jv-ad-row-who"><b>{channel.name || 'Unnamed channel'}</b><span>{channel.error || 'not answering'}</span></div>
              </div>
            ))}
          </div>
        ) : null}
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
