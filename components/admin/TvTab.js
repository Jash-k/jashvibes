'use client';

import { useCallback, useEffect, useState } from 'react';
import LiveServicePanel from '@/components/live/LiveServicePanel';
import { useLiveGuide } from '@/components/live/LiveGuide';

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

      {panelOpen ? (
        <LiveServicePanel
          open
          epg={epg}
          onClose={() => setPanelOpen(false)}
          onPreview={() => {}}
          onMainRefresh={() => setNote({ kind: 'ok', text: 'Panel changes saved.' })}
        />
      ) : null}
    </div>
  );
}
