'use client';
/**
 * LiveChannelManager — Admin → TV → Channels (v13).
 *
 * Full CRUD over LiveChannel rows against /api/live-service/channels:
 *   • create manual channels (name/URL/logo/format/DRM/headers + catalogs)
 *   • edit every playable field, hide/unhide, delete (server keeps undo audit)
 *   • seven fixed catalogs as clickable chips, per-catalog reorder (↑/↓ on
 *     every device + drag-and-drop on desktop), persisted as positions
 *   • bulk select bar: hide / map catalogs / delete in one pass
 *   • per-channel source ladder override (variant play order)
 *   • religious console: auto-tagged devotional channels stay hidden from
 *     /live until an owner manually maps one — manual mapping always wins
 *
 * Authentication is the jash_admin cookie set at admin login; same-origin
 * fetch carries it, so no token plumbing is needed here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import { SOURCE_REGISTRY } from '@/lib/live/registry';

const EMPTY_FORM = {
  name: '', url: '', logo: '', category: 'Live', format: 'hls', language: 'Tamil',
  keyId: '', key: '', licenseKey: '', licenseType: '', cookie: '', userAgent: '',
  referer: '', headersText: '', catalogIds: ['main'],
};

function Logo({ channel }) {
  const src = channel.customLogo || channel.logo;
  return (
    <div className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-black">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" />
      ) : <span className="text-xs">📺</span>}
    </div>
  );
}

const isLiveCatalog = (value) => LIVE_CATALOGS.some((item) => item.id === value);

export default function LiveChannelManager() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [sourceId, setSourceId] = useState('all');
  const [catalog, setCatalog] = useState('all'); // all | fixed id | unmapped | religious
  const [mapped, setMapped] = useState('all');
  const [hidden, setHidden] = useState('0');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selected, setSelected] = useState(() => new Set());
  const [ladderFor, setLadderFor] = useState(null); // channel doc being edited
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
      if (isLiveCatalog(catalog)) params.set('catalog', catalog);
      if (mapped !== 'all') params.set('mapped', mapped);
      if (catalog === 'unmapped') params.set('mapped', '0');
      if (catalog === 'religious') params.set('religious', '1');
      params.set('hidden', hidden);
      if (q.trim()) params.set('q', q.trim());
      const [channelData, sourceData] = await Promise.all([
        api(`/api/live-service/channels?${params.toString()}`),
        api('/api/live-service/sources').catch(() => ({ sources: [] })),
      ]);
      setRows(channelData.channels || []);
      setTotal(channelData.total || 0);
      setSources(sourceData.sources || []);
      setSelected(new Set());
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
      await api('/api/live-service/channels', { method: 'PATCH', body: JSON.stringify({ channelId: channel.channelId, action, ...extra }) });
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  const bulkPatch = useCallback(async (action, extra = {}) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBusy('bulk');
    try {
      await api('/api/live-service/channels', { method: 'PATCH', body: JSON.stringify({ ids, action, ...extra }) });
      setMsg(`${ids.length} channel(s) updated`);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  }, [api, load, selected]);

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length || !confirm(`Delete ${ids.length} channel(s)? Audit snapshots stay available for undo.`)) return;
    setBusy('bulk');
    try {
      await Promise.all(ids.map((channelId) => api(`/api/live-service/channels?channelId=${encodeURIComponent(channelId)}`, { method: 'DELETE' })));
      setMsg(`${ids.length} channel(s) deleted`);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

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
      await api('/api/live-service/channels', { method: 'PATCH', body: JSON.stringify({ action: 'reorderCatalog', catalogId: catalog, orderedIds }) });
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const removeChannel = async (channel) => {
    if (!confirm(`Delete “${channel.name}”? Its audit snapshot stays available for undo in Admin → History.`)) return;
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
    setForm({ ...EMPTY_FORM, catalogIds: isLiveCatalog(catalog) ? [catalog] : ['main'] });
    setShowForm(true);
  };

  const openEdit = (channel) => {
    let headersText = '';
    try { headersText = channel.headers && Object.keys(channel.headers).length ? JSON.stringify(channel.headers, null, 2) : ''; } catch { headersText = ''; }
    setEditing(channel);
    setForm({
      name: channel.customName || channel.name || '', url: channel.url || '', logo: channel.customLogo || channel.logo || '',
      category: channel.category || 'Live', format: channel.format || 'unknown', language: channel.language || 'Tamil',
      keyId: channel.keyId || '', key: channel.key || '', licenseKey: channel.licenseKey || '', licenseType: channel.licenseType || '',
      cookie: channel.cookie || '', userAgent: channel.userAgent || '', referer: channel.referer || '', headersText,
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
    const payload = { name: form.name.trim(), url: form.url.trim(), logo: form.logo.trim(), category: form.category.trim() || 'Live', format: form.format, language: form.language.trim(), keyId: form.keyId.trim(), key: form.key.trim(), licenseKey: form.licenseKey.trim(), licenseType: form.licenseType.trim(), cookie: form.cookie.trim(), userAgent: form.userAgent.trim(), referer: form.referer.trim(), headers };
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

  const saveLadder = async (channel, ladderOrder) => {
    setBusy(channel.channelId);
    try {
      await api('/api/live-service/channels', { method: 'PATCH', body: JSON.stringify({ channelId: channel.channelId, ladderOrder }) });
      setMsg(`Source ladder saved for “${channel.name}”`);
      setLadderFor(null);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const sourceOptions = useMemo(() => [{ sourceId: 'all', label: 'All sources' }, ...sources.map((item) => ({ sourceId: item.sourceId, label: item.label }))], [sources]);
  const reorderEnabled = isLiveCatalog(catalog);
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.channelId));
  const knownSourceIds = useMemo(() => [...new Set([...Object.keys(SOURCE_REGISTRY), ...sources.map((s) => s.sourceId), 'manual'])], [sources]);

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border border-white/10 bg-zinc-950 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Sun TV, Vijay…" className="min-w-[170px] flex-1 rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs outline-none focus:border-red-500" />
          <select value={catalog} onChange={(e) => setCatalog(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">All catalogs</option>
            {LIVE_CATALOGS.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}
            <option value="unmapped">Unmapped</option>
            <option value="religious">🛡️ Religious (excluded)</option>
          </select>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            {sourceOptions.map((item) => <option key={item.sourceId} value={item.sourceId}>{item.label}</option>)}
          </select>
          <select value={mapped} onChange={(e) => setMapped(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">Mapped + unmapped</option><option value="1">Mapped only</option><option value="0">Unmapped only</option>
          </select>
          <select value={hidden} onChange={(e) => setHidden(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="0">Visible</option><option value="1">Hidden</option><option value="all">Visible + hidden</option>
          </select>
          <button type="button" onClick={rebuild} disabled={busy === 'rebuild'} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold disabled:opacity-50">↻ Rebuild grouping</button>
          <button type="button" onClick={openCreate} className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-black text-white">+ Add channel</button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>{loading ? 'Loading…' : `${rows.length} of ${total} rows`}{reorderEnabled ? ' · drag rows or use ↑/↓ to reorder this catalog' : ''}</span>
          {msg ? <span className="font-bold text-amber-200">{msg}</span> : null}
        </div>
      </div>

      {catalog === 'religious' ? (
        <div className="rounded-2xl border border-amber-400/35 bg-amber-400/[0.07] p-3.5 text-[12px] leading-relaxed text-zinc-300">
          <b className="text-amber-300">🛡️ Religious / devotional channels are excluded from /live and every catalog by default.</b>
          Nothing is deleted — rows stay here. Use “Add to catalog” on a row to make an exception; that manual mapping is never undone by a sync.
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-[12px] font-bold">
          <span>{selected.size} selected</span>
          <button type="button" onClick={() => bulkPatch('hide')} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">Hide</button>
          <button type="button" onClick={() => bulkPatch('unhide')} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">Unhide</button>
          {LIVE_CATALOGS.map((c) => (
            <button key={c.id} type="button" onClick={() => bulkPatch('setCatalog', { catalogId: c.id, enabled: true })} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">+ {c.icon} {c.name}</button>
          ))}
          <button type="button" onClick={bulkDelete} className="rounded-full border border-red-500/50 px-3 py-1 text-[11px] text-red-200">Delete</button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-full border border-white/10 px-3 py-1 text-[11px]">Clear</button>
        </div>
      ) : null}

      {showForm ? (
        <form onSubmit={submitForm} className="space-y-3 rounded-2xl border border-red-500/30 bg-zinc-950 p-4">
          <h3 className="text-sm font-black">{editing ? `Edit “${editing.name}”` : 'New manual channel'}</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="text-[11px] font-bold text-zinc-400">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400 md:col-span-2">Stream URL (m3u8 / mpd / mp4 / ts worker)<input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Logo URL<input value={form.logo} onChange={(e) => setForm({ ...form, logo: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Format
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]">
                {['hls', 'dash', 'video', 'unknown'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="text-[11px] font-bold text-zinc-400">ClearKey KID<input value={form.keyId} onChange={(e) => setForm({ ...form, keyId: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">ClearKey / license_key<input value={form.licenseKey} onChange={(e) => setForm({ ...form, licenseKey: e.target.value })} placeholder="kid:key or license URL" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Legacy key<input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">License type<input value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })} placeholder="clearkey / widevine" className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Cookie<input value={form.cookie} onChange={(e) => setForm({ ...form, cookie: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">Referer<input value={form.referer} onChange={(e) => setForm({ ...form, referer: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400">User-Agent<input value={form.userAgent} onChange={(e) => setForm({ ...form, userAgent: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[13px]" /></label>
            <label className="text-[11px] font-bold text-zinc-400 md:col-span-2">Headers JSON<textarea rows={2} value={form.headersText} onChange={(e) => setForm({ ...form, headersText: e.target.value })} placeholder='{ "X-Key": "value" }' className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 font-mono text-[12px]" /></label>
          </div>
          {!editing ? (
            <div>
              <p className="mb-1 text-[11px] font-bold text-zinc-400">Catalogs</p>
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

      <div className="max-h-[65vh] space-y-2 overflow-auto pr-1">
        {!loading && !rows.length ? <p className="rounded-2xl border border-white/10 bg-zinc-950 p-6 text-center text-sm text-zinc-400">No channels match these filters.</p> : null}
        {rows.map((channel) => {
          const ids = channelCatalogIds(channel);
          const checked = selected.has(channel.channelId);
          return (
            <div key={channel.channelId} draggable={reorderEnabled}
              onDragStart={() => { dragId.current = channel.channelId; }}
              onDragOver={(e) => { if (reorderEnabled) e.preventDefault(); }}
              onDrop={() => onDropReorder(channel.channelId)}
              className={`rounded-2xl border p-2.5 ${checked ? 'border-red-500/60 bg-red-950/15' : 'border-white/10 bg-zinc-900/70'}`}>
              <div className="flex items-center gap-2.5">
                <input type="checkbox" checked={checked} onChange={() => setSelected((prev) => { const next = new Set(prev); next.has(channel.channelId) ? next.delete(channel.channelId) : next.add(channel.channelId); return next; })} className="h-4 w-4 shrink-0 accent-red-600" aria-label="Select channel" />
                {reorderEnabled ? <span title="Drag to reorder" className="cursor-grab select-none text-zinc-500">⠿</span> : null}
                <Logo channel={channel} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">
                    {channel.customName || channel.name}
                    {channel.hidden ? <span className="ml-2 rounded-full bg-zinc-700 px-2 py-0.5 text-[9px]">hidden</span> : null}
                    {channel.religious ? <span className="ml-2 rounded-full border border-amber-400/40 px-2 py-0.5 text-[9px] font-black text-amber-300">religious · hidden from /live</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-zinc-400">{channel.source} · {String(channel.format || 'unknown').toUpperCase()} · {channel.category}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {reorderEnabled ? (
                    <>
                      <button type="button" onClick={() => move(channel, -1)} title="Move up" className="rounded-full border border-white/10 px-2 py-1 text-xs">↑</button>
                      <button type="button" onClick={() => move(channel, 1)} title="Move down" className="rounded-full border border-white/10 px-2 py-1 text-xs">↓</button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => setLadderFor(ladderFor?.channelId === channel.channelId ? null : channel)} title="Source ladder" className="rounded-full border border-white/10 px-2.5 py-1 text-xs">🪜</button>
                  <button type="button" onClick={() => openEdit(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-xs">Edit</button>
                  <button type="button" onClick={() => patch(channel, channel.hidden ? 'unhide' : 'hide')} disabled={busy === channel.channelId} className="rounded-full border border-white/10 px-2.5 py-1 text-xs disabled:opacity-40">{channel.hidden ? 'Unhide' : 'Hide'}</button>
                  <button type="button" onClick={() => removeChannel(channel)} className="rounded-full border border-red-500/40 px-2.5 py-1 text-xs text-red-200">Delete</button>
                </div>
              </div>

              {ladderFor?.channelId === channel.channelId ? (
                <LadderEditor channel={channel} knownSourceIds={knownSourceIds} onSave={(ladder) => saveLadder(channel, ladder)} onCancel={() => setLadderFor(null)} />
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {LIVE_CATALOGS.map((item) => {
                  const active = ids.has(item.id);
                  return (
                    <button key={item.id} type="button" onClick={() => toggleCatalog(channel, item.id)} disabled={busy === channel.channelId}
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

function LadderEditor({ channel, knownSourceIds, onSave, onCancel }) {
  const [ladder, setLadder] = useState(Array.isArray(channel.ladderOrder) ? channel.ladderOrder : []);
  const move = (index, dir) => {
    const next = [...ladder];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLadder(next);
  };
  const addSource = (sourceId) => {
    if (!sourceId || ladder.includes(sourceId)) return;
    setLadder([...ladder, sourceId]);
  };
  const labelOf = (id) => SOURCE_REGISTRY[id]?.label || (id === 'manual' ? 'Manual' : id);
  const available = knownSourceIds.filter((id) => !ladder.includes(id));

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-2.5">
      <p className="mb-1.5 text-[11px] font-black text-zinc-300">Source ladder for “{channel.name}” — listed sources play first in this order; the rest keep their default priority</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {ladder.map((id, index) => (
          <span key={id} className="flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold">
            {index + 1}. {labelOf(id)}
            <button type="button" onClick={() => move(index, -1)} className="text-zinc-400">↑</button>
            <button type="button" onClick={() => move(index, 1)} className="text-zinc-400">↓</button>
            <button type="button" onClick={() => setLadder(ladder.filter((x) => x !== id))} className="text-red-300">✕</button>
          </span>
        ))}
        {!ladder.length ? <span className="text-[11px] text-zinc-500">Default order (source priority) — add sources to pin this channel&apos;s ladder</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value="" onChange={(e) => addSource(e.target.value)} className="rounded-full border border-white/10 bg-black px-2.5 py-1 text-[11px]">
          <option value="">Add source…</option>
          {available.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
        </select>
        <button type="button" onClick={() => onSave(ladder)} className="rounded-full bg-red-600 px-3 py-1 text-[11px] font-black text-white">Save ladder</button>
        <button type="button" onClick={onCancel} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">Cancel</button>
      </div>
    </div>
  );
}
