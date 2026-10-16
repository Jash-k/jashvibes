'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * HealthTab — is anything wrong, and what would a sync actually do?
 *
 * Two halves, and the second is the one that earns its place:
 *
 *   · **Now**: one card per subsystem, with the number that matters and its age. A section that
 *     failed says so in place rather than blanking the page.
 *   · **Before you sync**: a dry run of the catalogue scrape and of every live source. Both fetch
 *     for real and write nothing, and both report the part nobody can see otherwise — which of your
 *     own overrides / catalog placements / EPG choices a sync would silently drop.
 *
 * The dry run costs a scrape, so it is a button, not something that runs on load.
 */
export default function HealthTab() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [catalogRun, setCatalogRun] = useState(null);
  const [liveRun, setLiveRun] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const response = await fetch('/api/admin/health', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Health read failed');
      setData(payload);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Health read failed');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function dryRunCatalog() {
    setBusy('catalog');
    setCatalogRun(null);
    try {
      const response = await fetch('/api/admin/catalog/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'dry' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Dry run failed');
      setCatalogRun(payload);
    } catch (err) {
      setCatalogRun({ ok: false, error: err.message });
    } finally {
      setBusy('');
    }
  }

  async function dryRunLive() {
    setBusy('live');
    setLiveRun(null);
    try {
      const response = await fetch('/api/admin/tv/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Dry run failed');
      setLiveRun(payload);
    } catch (err) {
      setLiveRun({ ok: false, error: err.message });
    } finally {
      setBusy('');
    }
  }

  if (status === 'loading' && !data) return <p className="jv-ad-empty">Reading the system…</p>;
  if (status === 'error') return <p className="jv-ad-note is-bad">{error}</p>;

  const sections = data.sections || {};
  return (
    <div>
      <div className="jv-ad-toolbar">
        <span className="jv-ad-title" style={{ flex: 1 }}>
          Health and operations
          <span className="jv-ad-metatitle"> read {new Date(data.at).toLocaleTimeString()} · every number comes from the thing itself</span>
        </span>
        <button type="button" className="jv-ad-btn" onClick={load} disabled={status === 'loading'}>Refresh</button>
      </div>

      {data.problems?.length ? (
        <div className="jv-ad-card">
          <p className="jv-ad-card-title">Attention</p>
          {data.problems.map((problem, index) => (
            <p key={index} className={`jv-ad-note is-${problem.level === 'bad' ? 'bad' : problem.level === 'warn' ? 'warn' : 'ok'}`}>{problem.text}</p>
          ))}
        </div>
      ) : (
        <p className="jv-ad-note is-ok">Nothing needs attention.</p>
      )}

      <div className="jv-ad-grid">
        <Card title="Database" section={sections.database}>
          <Row label="State" value={sections.database?.state} />
          <Row label="Latency" value={sections.database?.latencyMs === null || sections.database?.latencyMs === undefined ? '—' : `${sections.database.latencyMs} ms`} />
          <Row label="Database" value={sections.database?.database || '—'} />
        </Card>

        <Card title="Catalogue cache" section={sections.catalog}>
          <Row label="Titles" value={`${sections.catalog?.titles ?? '—'} (${sections.catalog?.movies ?? 0} movies · ${sections.catalog?.series ?? 0} series)`} />
          <Row label="Age" value={sections.catalog?.ageLabel || 'unknown'} />
          <Row label="Sync due" value={sections.catalog?.syncDue ? 'yes' : 'no'} />
          <Row label="Refreshed" value={when(sections.catalog?.refreshedAt)} />
        </Card>

        <Card title="Overrides" section={sections.overrides}>
          <Row label="Catalogue rows" value={sections.overrides?.catalogueRows ?? '—'} />
          <Row label="Overrides" value={`${sections.overrides?.total ?? '—'} (hidden ${sections.overrides?.hidden ?? 0} · pinned ${sections.overrides?.pinned ?? 0} · corrected ${sections.overrides?.corrected ?? 0})`} />
          <Row label="Orphaned" value={sections.overrides?.orphans ?? '—'} />
          <Row label="Duplicates" value={`${sections.overrides?.duplicateGroups ?? 0} group(s), ${sections.overrides?.duplicateRows ?? 0} rows`} />
        </Card>

        <Card title="Vault" section={sections.vault}>
          <Row label="Overrides" value={`${sections.vault?.overrides ?? '—'} (hidden ${sections.vault?.hidden ?? 0})`} />
          <Row label="Last edit" value={when(sections.vault?.lastEdit)} />
        </Card>

        <Card title="Lyrics" section={sections.lyrics}>
          <Row label="Overrides" value={`${sections.lyrics?.overrides ?? '—'} (from this panel: ${sections.lyrics?.fromAdmin ?? 0})`} />
          <Row label="Last edit" value={when(sections.lyrics?.lastEdit)} />
        </Card>

        <Card title="Live TV" section={sections.live}>
          <Row label="Sources" value={`${sections.live?.sourcesEnabled ?? '—'} enabled of ${sections.live?.sources ?? 0}`} />
          <Row label="Channels" value={`${sections.live?.channels ?? '—'} (mapped ${sections.live?.mapped ?? 0} · hidden ${sections.live?.hidden ?? 0} · favourites ${sections.live?.favorite ?? 0})`} />
          <Row label="Dead" value={sections.live?.dead ?? 0} />
          <Row label="Auto-sync" value={sections.live?.autoSync?.enabled === undefined ? '—' : sections.live.autoSync.enabled ? `on · last run ${when(sections.live.autoSync.lastRunAt)}` : 'off'} />
          <Row label="Last sweep" value={when(sections.history?.lastSweepAt)} />
        </Card>

        <Card title="Music" section={sections.music}>
          <Row label="Playlists" value={sections.music?.playlists ?? '—'} />
          <Row label="Tracks" value={`${sections.music?.tracks ?? 0} (matched ${sections.music?.matched ?? 0}${sections.music?.matchRate === null || sections.music?.matchRate === undefined ? '' : ` · ${sections.music.matchRate}%`})`} />
        </Card>

        <Card title="Stremio" section={sections.stremio}>
          <Row label="Addons" value={`${sections.stremio?.enabled ?? '—'} enabled of ${sections.stremio?.addons ?? 0}`} />
          <Row label="Kinds" value={`${sections.stremio?.catalog ?? 0} catalogue · ${sections.stremio?.watch ?? 0} watch`} />
        </Card>

        <Card title="Extras" section={sections.extras}>
          <Row label="Websites" value={sections.extras?.sites ?? '—'} />
          <Row label="Registry" value={`v${sections.extras?.version ?? '—'} · ${sections.extras?.source || '—'}`} />
        </Card>

        <Card title="History" section={sections.history}>
          <Row label="Recorded" value={`${sections.history?.total ?? '—'} total · ${sections.history?.last24h ?? 0} in 24 h`} />
          <Row label="Last change" value={when(sections.history?.latestAt)} />
          <Row label="Last sync" value={when(sections.history?.lastSyncAt)} />
        </Card>

        <Card title="Release" section={sections.release}>
          <Row label="Manifest" value={sections.release?.present ? forRelease(sections.release) : 'not generated'} />
        </Card>
      </div>

      <div className="jv-ad-card" style={{ marginTop: 12 }}>
        <p className="jv-ad-card-title">Dry runs — nothing is written</p>
        <p className="jv-ad-card-sub">
          Both fetch the real thing and compare it with what is stored. Run these before a sync: they are the
          only place that shows what a sync would take away, including your own overrides and mappings.
        </p>
        <div className="jv-ad-toolbar">
          <button type="button" className="jv-ad-btn is-primary" disabled={busy === 'catalog'} onClick={dryRunCatalog}>
            {busy === 'catalog' ? 'Scraping (writes nothing)…' : 'Dry-run the catalogue sync'}
          </button>
          <button type="button" className="jv-ad-btn is-primary" disabled={busy === 'live'} onClick={dryRunLive}>
            {busy === 'live' ? 'Fetching every live source…' : 'Dry-run the live sync'}
          </button>
        </div>

        {catalogRun ? (
          catalogRun.ok === false ? <p className="jv-ad-note is-bad">{catalogRun.error}</p> : (
            <div className="jv-ad-dryrun">
              <p className="jv-ad-note is-ok">{catalogRun.message}</p>
              <p className="jv-ad-metatitle">Cache has {catalogRun.counts.before} titles · a sync leaves {catalogRun.counts.after}</p>
              <DiffList title="Would appear" rows={catalogRun.added} />
              <DiffList title="Would disappear" rows={catalogRun.removed} tone="bad" />
              <DiffList title="Would change" rows={catalogRun.changed} tone="warn" render={(row) => `${row.title} — ${(row.fields || []).join(', ')}`} />
              {catalogRun.wouldOrphanOverrides?.length ? (
                <div className="jv-ad-note is-warn">
                  A sync would orphan {catalogRun.wouldOrphanOverrides.length} override(s) — these keys would disappear:
                  <ul>{catalogRun.wouldOrphanOverrides.map((key) => <li key={key}><code>{key}</code></li>)}</ul>
                  Hiding, pinning or correcting them again after the sync is the fix; the Orphans report on the Home tab is where to re-bind them.
                </div>
              ) : <p className="jv-ad-metatitle">No override would be orphaned by this sync.</p>}
            </div>
          )
        ) : null}

        {liveRun ? (
          liveRun.ok === false ? <p className="jv-ad-note is-bad">{liveRun.error}</p> : (
            <div className="jv-ad-dryrun">
              <p className="jv-ad-note is-ok">{liveRun.message}</p>
              <div className="jv-ad-table">
                {liveRun.sources.map((source) => (
                  <div key={source.sourceId} className="jv-ad-tr">
                    <div className="jv-ad-trmain" style={{ cursor: 'default' }}>
                      <span className="jv-ad-title" style={{ flex: 1 }}>{source.label}</span>
                      <span className="jv-ad-metatitle">
                        {source.error ? `fetch failed: ${source.error}` : `${source.parsed} parsed · ${source.stored} stored · +${source.added} / −${source.removed}${source.atRisk ? ` · ${source.atRisk} mapping(s) at risk` : ''}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {liveRun.wouldLoseMappings?.length ? (
                <div className="jv-ad-note is-warn">
                  These channels carry your own placement, EPG or favourite and would not come back from the source:
                  <ul>{liveRun.wouldLoseMappings.map((row) => (
                    <li key={`${row.sourceId}:${row.name}`}>
                      {row.name}{row.catalogs?.length ? ` — in ${row.catalogs.join(', ')}` : ''}{row.epg ? ' · EPG override' : ''}{row.favorite ? ' · favourite' : ''}
                    </li>
                  ))}</ul>
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function Card({ title, section, children }) {
  const failed = section && section.ok === false;
  return (
    <div className="jv-ad-card is-tight">
      <p className="jv-ad-card-title">{title}</p>
      {failed ? <p className="jv-ad-note is-bad">{section.error}</p> : <div className="jv-ad-rows">{children}</div>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="jv-ad-kv">
      <span>{label}</span>
      <b>{value === null || value === undefined || value === '' ? '—' : String(value)}</b>
    </div>
  );
}

function DiffList({ title, rows = [], tone = 'ok', render }) {
  if (!rows.length) return null;
  return (
    <div className="jv-ad-diff">
      <p className={`jv-ad-note is-${tone}`}>{title} ({rows.length})</p>
      <ul>
        {rows.map((row) => <li key={row.key}>{render ? render(row) : `${row.title}${row.year ? ` (${row.year})` : ''}`}</li>)}
      </ul>
    </div>
  );
}

function when(value) {
  if (!value) return '—';
  const at = new Date(value);
  const seconds = Math.round((Date.now() - at.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return at.toLocaleString();
}

function forRelease(release) {
  const bits = [];
  if (release.release) bits.push(release.release);
  if (release.files) bits.push(`${release.files} files`);
  if (release.modules) bits.push(`${release.modules} modules`);
  return bits.join(' · ') || 'present';
}
