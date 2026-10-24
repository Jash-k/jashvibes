'use client';
/**
 * LiveSourceManager — Admin → TV → Sources & Sync (v13).
 *
 * Full CRUD over every LiveSource field the API accepts: label, feed URL,
 * type, priority (with drag-to-reorder), enabled, trustTamil, autoPurge,
 * titleFilter, autoMapCatalog and custom request headers. Plus per-source
 * health probe, sync, clone and delete. All writes carry the admin cookie
 * same-origin and are audited server-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';

const EMPTY_FORM = { label: '', url: '', type: 'm3u', priority: 50, enabled: true, trustTamil: false, autoPurge: false, titleFilter: '', autoMapCatalog: '', headersText: '' };

function HealthDot({ health }) {
  if (!health) return <span title="Not checked" className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-600" />;
  const ok = Boolean(health.ok);
  return <span title={ok ? `HTTP ${health.status} in ${health.ms}ms` : (health.error || `HTTP ${health.status}`)} className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.7)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,.7)]'}`} />;
}

export default function LiveSourceManager() {
  const [sources, setSources] = useState([]);
  const [healthMap, setHealthMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | source doc
  const [form, setForm] = useState(EMPTY_FORM);
  const [syncResult, setSyncResult] = useState(null);
  const dragId = useRef('');

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(path, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/live-service/sources');
      setSources(data.sources || []);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const checkHealth = useCallback(async () => {
    setBusy('health');
    setMsg('Probing feeds…');
    try {
      const data = await api('/api/live-service/sources?health=1');
      const map = {};
      for (const s of data.sources || []) map[s.sourceId] = s.health;
      setHealthMap(map);
      setSources(data.sources || []);
      const down = (data.sources || []).filter((s) => s.health && !s.health.ok);
      setMsg(down.length ? `${down.length} feed(s) unreachable: ${down.map((s) => s.label).join(', ')}` : `All ${data.sources?.length || 0} feeds answered`);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  }, [api]);

  const syncAll = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setMsg('Syncing all sources — HJH can take ~30s…');
    try {
      const data = await api('/api/live-service/sync', { method: 'POST', body: JSON.stringify({}) });
      setSyncResult(data.results || []);
      setMsg(`Synced ${data.results?.length || 0} source(s)`);
      await load();
    } catch (error) {
      setMsg(`Sync failed: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  }, [api, load]);

  const syncOne = useCallback(async (sourceId) => {
    setBusy(sourceId);
    try {
      const data = await api('/api/live-service/sync', { method: 'POST', body: JSON.stringify({ sourceId }) });
      const r = data.results?.[0];
      setMsg(r?.ok ? `Synced ${sourceId}: ${r.added ?? r.stored ?? 0} channel(s)` : `Sync failed: ${r?.error || 'unknown'}`);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  const openEdit = (source) => {
    if (!source) { setEditing('new'); setForm(EMPTY_FORM); return; }
    let headersText = '';
    try { headersText = source.headers && Object.keys(source.headers).length ? JSON.stringify(source.headers, null, 2) : ''; } catch { headersText = ''; }
    setEditing(source.sourceId);
    setForm({
      label: source.label || '', url: source.url || '', type: source.type || 'm3u',
      priority: source.priority ?? 50, enabled: source.enabled !== false,
      trustTamil: Boolean(source.trustTamil), autoPurge: Boolean(source.autoPurge),
      titleFilter: source.titleFilter || '', autoMapCatalog: source.autoMapCatalog || '', headersText,
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    let headers = {};
    if (form.headersText.trim()) {
      try { headers = JSON.parse(form.headersText); } catch { setMsg('Headers must be valid JSON'); return; }
    }
    const payload = { ...form, headers };
    delete payload.headersText;
    setBusy('form');
    try {
      await api('/api/live-service/sources', { method: 'POST', body: JSON.stringify(payload) });
      setMsg(editing === 'new' ? `Source “${form.label}” saved` : `Source “${form.label}” updated`);
      setEditing(null);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const patchSource = useCallback(async (sourceId, fields) => {
    setBusy(sourceId);
    try {
      await api('/api/live-service/sources', { method: 'PATCH', body: JSON.stringify({ sourceId, ...fields }) });
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  const removeSource = async (source) => {
    if (!confirm(`Delete source “${source.label}” and its unmapped channels? Mapped/manual channels are kept.`)) return;
    setBusy(source.sourceId);
    try {
      await api(`/api/live-service/sources?sourceId=${encodeURIComponent(source.sourceId)}&channels=1`, { method: 'DELETE' });
      setMsg(`Deleted ${source.label}`);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  // Drag rows to reprioritize: rewrite every priority on the 10-step grid.
  const onDrop = async (targetSourceId) => {
    const from = dragId.current;
    dragId.current = '';
    if (!from || from === targetSourceId) return;
    const ordered = [...sources];
    const fromIndex = ordered.findIndex((s) => s.sourceId === from);
    const toIndex = ordered.findIndex((s) => s.sourceId === targetSourceId);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    const next = ordered.map((s, i) => ({ ...s, priority: (i + 1) * 10 }));
    setSources(next); // optimistic
    try {
      await Promise.all(next.map((s) => api('/api/live-service/sources', { method: 'PATCH', body: JSON.stringify({ sourceId: s.sourceId, priority: s.priority }) })));
      setMsg('Source priority (and the viewer fallback ladder) updated');
    } catch (error) {
      setMsg(error.message);
      await load();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-zinc-950 p-3">
        <button type="button" onClick={syncAll} disabled={syncing} className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-black text-white disabled:opacity-50">{syncing ? 'Syncing…' : '↻ Sync all Tamil'}</button>
        <button type="button" onClick={checkHealth} disabled={busy === 'health'} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold disabled:opacity-50">🩺 Check health</button>
        <button type="button" onClick={() => openEdit(null)} className="rounded-full border border-white/10 px-4 py-1.5 text-xs font-bold">＋ Add source</button>
        <span className="ml-auto text-[11px] text-zinc-500">Drag ⠿ to reorder — priority drives sync order and the viewer auto-fallback ladder</span>
      </div>

      {msg ? <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">{msg}</p> : null}
      {syncResult?.length ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {syncResult.map((r) => (
            <span key={r.sourceId} className={`rounded-full px-2.5 py-1 ${r.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/15 text-red-200'}`}>{r.sourceId}: {r.ok ? `${r.added ?? r.stored ?? 0}+` : r.error}</span>
          ))}
        </div>
      ) : null}
      {loading ? <p className="p-4 text-xs text-zinc-400">Loading sources…</p> : null}

      {editing ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-red-500/30 bg-zinc-950 p-4">
          <h3 className="text-sm font-black">{editing === 'new' ? 'New live source' : `Edit “${form.label}”`}</h3>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            <label className="text-[11px] font-bold text-zinc-400">Label<input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px] outline-none focus:border-red-500" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]">
                <option value="m3u">m3u</option><option value="json">json</option>
              </select>
            </label>
            <label className="text-[11px] font-bold text-zinc-400 md:col-span-2">Feed URL<input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…/.m3u or .json" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px] outline-none focus:border-red-500" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Priority<input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Auto-map new channels to
              <select value={form.autoMapCatalog} onChange={(e) => setForm({ ...form, autoMapCatalog: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]">
                <option value="">— none, map manually —</option>
                {LIVE_CATALOGS.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-bold text-zinc-400 md:col-span-2">Title filter (import only lines containing…)<input value={form.titleFilter} onChange={(e) => setForm({ ...form, titleFilter: e.target.value })} placeholder="e.g. Tamil | HD" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400 md:col-span-2">Custom request headers (JSON)<textarea rows={2} value={form.headersText} onChange={(e) => setForm({ ...form, headersText: e.target.value })} placeholder='{ "Authorization": "Bearer …" }' className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 font-mono text-[12px] outline-none focus:border-red-500" /></label>
          </div>
          <div className="flex flex-wrap gap-4 text-[12px] font-bold text-zinc-300">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="accent-red-600" /> Enabled</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.trustTamil} onChange={(e) => setForm({ ...form, trustTamil: e.target.checked })} className="accent-red-600" /> Trust feed&apos;s Tamil flag</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.autoPurge} onChange={(e) => setForm({ ...form, autoPurge: e.target.checked })} className="accent-red-600" /> Auto-purge channels missing on next sync</label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'form'} className="rounded-full bg-red-600 px-5 py-2 text-xs font-black text-white disabled:opacity-50">{editing === 'new' ? 'Create source' : 'Save changes'}</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-full border border-white/10 px-4 py-2 text-xs">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sources.map((source) => {
          const health = healthMap[source.sourceId] || source.health;
          return (
            <div key={source.sourceId}
              draggable
              onDragStart={() => { dragId.current = source.sourceId; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(source.sourceId)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-start gap-2.5">
                <span title="Drag to reorder" className="cursor-grab select-none text-zinc-500">⠿</span>
                <HealthDot health={health} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm">{source.label}</b>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-400">{source.type} · p{source.priority}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${source.enabled !== false ? 'bg-emerald-500/15 text-emerald-200' : 'bg-zinc-700 text-zinc-300'}`}>{source.enabled !== false ? 'ENABLED' : 'DISABLED'}</span>
                  </div>
                  <p className="mt-1 break-all text-[11.5px] text-zinc-400">{source.url}</p>
                  <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-zinc-500">
                    <span className="rounded bg-white/10 px-1.5 py-0.5">{source.channelCount || 0} ch</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5">{source.mappedCount || 0} mapped</span>
                    {source.trustTamil ? <span className="rounded bg-white/10 px-1.5 py-0.5">trust-Tamil</span> : null}
                    {source.autoPurge ? <span className="rounded bg-white/10 px-1.5 py-0.5">auto-purge</span> : null}
                    {source.autoMapCatalog ? <span className="rounded bg-white/10 px-1.5 py-0.5">→ {source.autoMapCatalog}</span> : null}
                    {source.lastSyncedAt ? <span className="rounded bg-white/10 px-1.5 py-0.5">synced {new Date(source.lastSyncedAt).toLocaleDateString()}</span> : null}
                  </p>
                  {source.lastError ? <p className="mt-1 text-[11px] text-red-300">{source.lastError}</p> : null}
                  {health && !health.ok ? <p className="mt-1 text-[11px] text-red-300">{health.error || `HTTP ${health.status}`}</p> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => syncOne(source.sourceId)} disabled={syncing || busy === source.sourceId} className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black disabled:opacity-40">Sync</button>
                <button type="button" onClick={() => patchSource(source.sourceId, { enabled: source.enabled === false })} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">{source.enabled === false ? 'Enable' : 'Disable'}</button>
                <button type="button" onClick={() => openEdit(source)} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">Edit</button>
                <button type="button" onClick={() => { openEdit(null); setForm({ ...EMPTY_FORM, label: `${source.label} copy`, url: source.url, type: source.type, priority: (source.priority ?? 50) + 10, trustTamil: Boolean(source.trustTamil), autoPurge: Boolean(source.autoPurge), titleFilter: source.titleFilter || '', autoMapCatalog: source.autoMapCatalog || '', headersText: source.headers ? JSON.stringify(source.headers, null, 2) : '' }); }} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">Clone</button>
                <button type="button" onClick={() => removeSource(source)} className="rounded-full border border-red-500/40 px-3 py-1 text-[11px] text-red-200">Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
