'use client';
/**
 * LiveChannelManager — Admin → TV → Channels.
 *
 * Full CRUD over LiveChannel rows against /api/live-service/channels:
 *   • create manual channels (name/URL/logo/format/DRM/headers + catalogs)
 *   • edit every playable field, hide/unhide, delete (server keeps undo audit)
 *   • toggle the seven fixed catalogs, reorder with up/down (every device)
 *     and drag-and-drop (desktop), both persisted as catalog positions
 *   • trigger the background grouping/auto-mapping rebuild
 *
 * Authentication is the jash_admin cookie set at admin login; same-origin
 * fetch carries it, so no token plumbing is needed here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';

const EMPTY_FORM = {
  name: '', url: '', logo: '', category: 'Live', format: 'hls', language: 'Tamil',
  keyId: '', key: '', licenseKey: '', licenseType: '', cookie: '', userAgent: '',
  referer: '', headersText: '', catalogIds: ['main'],
};

function Logo({ channel }) {
  const src = channel.customLogo || channel.logo;
  return (
    <div className="h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-black grid place-items-center border border-white/10">
      {src ? <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" /> : <span className="text-sm">📺</span>}
    </div>
  );
}

export default function LiveChannelManager() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [sourceId, setSourceId] = useState('all');
  const [catalog, setCatalog] = useState('all');
  const [mapped, setMapped] = useState('all');
  const [hidden, setHidden] = useState('0');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
      const params = new URLSearchParams({ limit: '500' });
      if (sourceId !== 'all') params.set('sourceId', sourceId);
      if (catalog !== 'all' && catalog !== 'unmapped') params.set('catalog', catalog);
      if (mapped !== 'all') params.set('mapped', mapped);
      if (catalog === 'unmapped') params.set('mapped', '0');
      params.set('hidden', hidden);
      if (q.trim()) params.set('q', q.trim());
      const [channelData, sourceData] = await Promise.all([
        api(`/api/live-service/channels?${params.toString()}`),
        api('/api/live-service/sources').catch(() => ({ sources: [] })),
      ]);
      setRows(channelData.channels || []);
      setTotal(channelData.total || 0);
      setSources(sourceData.sources || []);
    } catch (error) {
      setMsg(error.message);
    } finally {
      setLoading(false);
    }
  }, [api, q, sourceId, catalog, mapped, hidden]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const channelCatalogIds = useCallback((channel) => new Set((channel.catalogs || []).map((item) => item.catalogId)), []);

  const patch = useCallback(async (channel, action, extra = {}) => {
    setBusy(channel.channelId);
    try {
      await api('/api/live-service/channels', {
        method: 'PATCH',
        body: JSON.stringify({ channelId: channel.channelId, action, ...extra }),
      });
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  const toggleCatalog = (channel, catalogId) => {
    const enabled = !channelCatalogIds(channel).has(catalogId);
    return patch(channel, 'setCatalog', { catalogId, enabled });
  };

  const move = (channel, direction) => {
    if (!isLiveCatalog(catalog)) return;
    const index = rows.findIndex((item) => item.channelId === channel.channelId);
    const neighbor = rows[index + direction];
    if (!neighbor) return;
    return patch(channel, 'swapCatalogPosition', { catalogId: catalog, otherChannelId: neighbor.channelId, direction });
  };

  const onDropReorder = async (targetId) => {
    const from = dragId.current;
    dragId.current = '';
    if (!from || from === targetId || !isLiveCatalog(catalog)) return;
    const orderedIds = rows.map((item) => item.channelId);
    const fromIndex = orderedIds.indexOf(from);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    orderedIds.splice(toIndex, 0, orderedIds.splice(fromIndex, 1)[0]);
    setBusy(targetId);
    try {
      await api('/api/live-service/channels', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reorderCatalog', catalogId: catalog, orderedIds }),
      });
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const removeChannel = async (channel) => {
    if (!confirm(`Delete "${channel.name}"? Its audit snapshot stays available for undo in Admin → History.`)) return;
    setBusy(channel.channelId);
    try {
      await api(`/api/live-service/channels?channelId=${encodeURIComponent(channel.channelId)}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, catalogIds: catalog !== 'all' && catalog !== 'unmapped' && isLiveCatalog(catalog) ? [catalog] : ['main'] });
    setShowForm(true);
  };

  const openEdit = (channel) => {
    let headersText = '';
    try { headersText = channel.headers && Object.keys(channel.headers).length ? JSON.stringify(channel.headers, null, 2) : ''; } catch { headersText = ''; }
    setEditing(channel);
    setForm({
      name: channel.customName || channel.name || '',
      url: channel.url || '',
      logo: channel.customLogo || channel.logo || '',
      category: channel.category || 'Live',
      format: channel.format || 'unknown',
      language: channel.language || 'Tamil',
      keyId: channel.keyId || '',
      key: channel.key || '',
      licenseKey: channel.licenseKey || '',
      licenseType: channel.licenseType || '',
      cookie: channel.cookie || '',
      userAgent: channel.userAgent || '',
      referer: channel.referer || '',
      headersText,
      catalogIds: (channel.catalogs || []).map((item) => item.catalogId),
    });
    setShowForm(true);
  };

  const submitForm = async (event) => {
    event.preventDefault();
    let headers = {};
    if (form.headersText.trim()) {
      try { headers = JSON.parse(form.headersText); } catch { setMsg('Headers must be valid JSON, e.g. { "X-Key": "value" }'); return; }
    }
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      logo: form.logo.trim(),
      category: form.category.trim() || 'Live',
      format: form.format,
      language: form.language.trim(),
      keyId: form.keyId.trim(),
      key: form.key.trim(),
      licenseKey: form.licenseKey.trim(),
      licenseType: form.licenseType.trim(),
      cookie: form.cookie.trim(),
      userAgent: form.userAgent.trim(),
      referer: form.referer.trim(),
      headers,
    };
    setBusy('form');
    try {
      if (editing) {
        await api('/api/live-service/channels', { method: 'PATCH', body: JSON.stringify({ channelId: editing.channelId, ...payload }) });
      } else {
        await api('/api/live-service/channels', { method: 'POST', body: JSON.stringify({ ...payload, catalogIds: form.catalogIds }) });
      }
      setShowForm(false);
      setMsg(editing ? 'Channel updated' : 'Channel created');
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    setBusy('rebuild');
    setMsg('Rebuilding groups and auto-mapping unmapped channels…');
    try {
      const data = await api('/api/live-service/rebuild', { method: 'POST', body: '{}' });
      setMsg(`Rebuild done — ${data.grouped} groups refreshed, ${data.mapped} channels auto-mapped. Manual mappings untouched.`);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const sourceOptions = useMemo(() => [{ sourceId: 'all', label: 'All sources' }, ...sources.map((item) => ({ sourceId: item.sourceId, label: item.label }))], [sources]);
  const reorderEnabled = isLiveCatalog(catalog);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="rounded-2xl border border-white/10 bg-zinc-950 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search Sun TV, Vijay…" className="min-w-[180px] flex-1 rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs outline-none focus:border-red-500" />
          <select value={catalog} onChange={(event) => setCatalog(event.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">All catalogs</option>
            {LIVE_CATALOGS.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}
            <option value="unmapped">Unmapped (auto-map targets)</option>
          </select>
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            {sourceOptions.map((item) => <option key={item.sourceId} value={item.sourceId}>{item.label}</option>)}
          </select>
          <select value={mapped} onChange={(event) => setMapped(event.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">Mapped + unmapped</option>
            <option value="1">Mapped only</option>
            <option value="0">Unmapped only</option>
          </select>
          <select value={hidden} onChange={(event) => setHidden(event.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="0">Visible</option>
            <option value="1">Hidden</option>
            <option value="all">Visible + hidden</option>
          </select>
          <button onClick={rebuild} disabled={busy === 'rebuild'} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold disabled:opacity-50">↻ Rebuild grouping</button>
          <button onClick={openCreate} className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-black text-white">+ Add channel</button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>{loading ? 'Loading…' : `${rows.length} of ${total} rows`}{reorderEnabled ? ' · drag rows or use ↑/↓ to reorder this catalog' : ''}</span>
          {msg ? <span className="font-bold text-amber-200">{msg}</span> : null}
        </div>
      </div>

      {/* Create / edit modal */}
      {showForm ? (
        <form onSubmit={submitForm} className="rounded-2xl border border-red-500/30 bg-zinc-950 p-4 space-y-3">
          <h3 className="text-sm font-black">{editing ? `Edit “${editing.name}”` : 'New manual channel'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-[11px] text-zinc-400">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400 md:col-span-2">Stream URL (m3u8 / mpd / mp4 / ts worker)<input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">Logo URL<input value={form.logo} onChange={(e) => setForm({ ...form, logo: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">Format
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white">
                {['hls', 'dash', 'video', 'unknown'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400">ClearKey KID<input value={form.keyId} onChange={(e) => setForm({ ...form, keyId: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">ClearKey / license_key<input value={form.licenseKey} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} placeholder="kid:key or comma pairs or license URL" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">Legacy key<input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">License type<input value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })} placeholder="clearkey / widevine" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">Cookie<input value={form.cookie} onChange={(e) => setForm({ ...form, cookie: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">Referer<input value={form.referer} onChange={(e) => setForm({ ...form, referer: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400">User-Agent<input value={form.userAgent} onChange={(e) => setForm({ ...form, userAgent: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white" /></label>
            <label className="text-[11px] text-zinc-400 md:col-span-2">Headers JSON<textarea rows={2} value={form.headersText} onChange={(e) => setForm({ ...form, headersText: e.target.value })} placeholder='{ "X-Key": "value" }' className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white font-mono" /></label>
          </div>
          {!editing ? (
            <div>
              <p className="text-[11px] font-bold text-zinc-400 mb-1">Catalogs</p>
              <div className="flex flex-wrap gap-2">
                {LIVE_CATALOGS.map((item) => (
                  <button type="button" key={item.id} onClick={() => setForm((prev) => ({ ...prev, catalogIds: prev.catalogIds.includes(item.id) ? prev.catalogIds.filter((id) => id !== item.id) : [...prev.catalogIds, item.id] }))}
                    className={`rounded-full border px-3 py-1 text-xs font-bold ${form.catalogIds.includes(item.id) ? 'border-red-500 bg-red-600 text-white' : 'border-white/10 bg-zinc-900'}`}>{item.icon} {item.name}</button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'form'} className="rounded-full bg-red-600 px-5 py-2 text-xs font-black text-white disabled:opacity-50">{editing ? 'Save changes' : 'Create channel'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-full border border-white/10 px-4 py-2 text-xs">Cancel</button>
          </div>
        </form>
      ) : null}

      {/* Rows */}
      <div className="space-y-2 max-h-[65vh] overflow-auto pr-1">
        {!loading && !rows.length ? <p className="rounded-2xl border border-white/10 bg-zinc-950 p-6 text-center text-sm text-zinc-400">No channels match these filters.</p> : null}
        {rows.map((channel) => {
          const ids = channelCatalogIds(channel);
          return (
            <div key={channel.channelId}
              draggable={reorderEnabled}
              onDragStart={() => { dragId.current = channel.channelId; }}
              onDragOver={(event) => { if (reorderEnabled) event.preventDefault(); }}
              onDrop={() => onDropReorder(channel.channelId)}
              className="rounded-2xl border border-white/10 bg-zinc-900/70 p-2.5">
              <div className="flex items-center gap-3">
                {reorderEnabled ? <span title="Drag to reorder" className="cursor-grab text-zinc-500 select-none">⠿</span> : null}
                <Logo channel={channel} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{channel.customName || channel.name}{channel.hidden ? <span className="ml-2 rounded-full bg-zinc-700 px-2 py-0.5 text-[10px]">hidden</span> : null}</p>
                  <p className="truncate text-[11px] text-zinc-400">{channel.source} · {String(channel.format || 'unknown').toUpperCase()} · {channel.category}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {reorderEnabled ? (
                    <>
                      <button onClick={() => move(channel, -1)} title="Move up" className="rounded-full border border-white/10 px-2 py-1 text-xs">↑</button>
                      <button onClick={() => move(channel, 1)} title="Move down" className="rounded-full border border-white/10 px-2 py-1 text-xs">↓</button>
                    </>
                  ) : null}
                  <button onClick={() => openEdit(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-xs">Edit</button>
                  <button onClick={() => patch(channel, channel.hidden ? 'unhide' : 'hide')} disabled={busy === channel.channelId} className="rounded-full border border-white/10 px-2.5 py-1 text-xs disabled:opacity-40">{channel.hidden ? 'Unhide' : 'Hide'}</button>
                  <button onClick={() => removeChannel(channel)} className="rounded-full border border-red-500/40 px-2.5 py-1 text-xs text-red-200">Delete</button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LIVE_CATALOGS.map((item) => {
                  const active = ids.has(item.id);
                  return (
                    <button key={item.id} onClick={() => toggleCatalog(channel, item.id)} disabled={busy === channel.channelId}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${active ? 'border-red-500 bg-red-600/20 text-red-100' : 'border-white/10 bg-black/40 text-zinc-400'}`}>
                      {item.icon} {item.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isLiveCatalog(value) {
  return LIVE_CATALOGS.some((item) => item.id === value);
}
