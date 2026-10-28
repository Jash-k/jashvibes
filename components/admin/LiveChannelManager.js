'use client';
/**
 * LiveChannelManager — Admin → TV → Channels.
 *
 * Full CRUD over LiveChannel rows against /api/live/admin/channels:
 *   • create manual channels (name/URL/logo/format/DRM/headers + catalogs)
 *   • edit every playable field, hide/unhide, delete (server keeps undo audit)
 *   • seven fixed catalogs as clickable chips, per-catalog reorder (↑/↓ on
 *     every device + drag-and-drop on desktop), persisted as positions
 *   • bulk select bar: hide / map catalogs / delete in one pass
 *   • per-channel source ladder override (variant play order)
 *   • religious console: auto-tagged devotional channels stay hidden from
 *     /live until an owner manually maps one — manual mapping always wins
 *
 * Performance model (owner feedback: "admin TV service very laggy"):
 * the whole visible collection is fetched ONCE on mount (projected lean
 * docs). Search and every dropdown filter are pure in-memory useMemo work,
 * so typing and tab switching make ZERO network calls and update instantly.
 * Rows are React.memo components and the DOM is capped with a Show-more
 * pager, so even a 3k-row catalogue stays smooth. Only deliberate writes
 * (and the manual Refresh button) trigger a refetch.
 *
 * Authentication is the jash_admin cookie set at admin login; same-origin
 * fetch carries it, so no token plumbing is needed here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIVE_CATALOGS, getChannelCatalogIds, sortChannelsForCatalog } from '@/lib/liveCatalogs';
import { SOURCE_REGISTRY } from '@/lib/live/registry';
import { summarizeLiveCatalogue, summarizeSourceGroups } from '@/lib/live/adminBrowse';
import AdminLivePreview from './AdminLivePreview';
import ChannelRow, { EMPTY_SET, isLiveCatalog } from './live/bits/ChannelRow';

const EMPTY_FORM = {
  name: '', url: '', logo: '', category: 'Live', format: 'hls', language: 'Tamil',
  keyId: '', key: '', licenseKey: '', licenseType: '', cookie: '', userAgent: '',
  referer: '', headersText: '', catalogIds: ['main'], forceProxy: false,
};
const FETCH_LIMIT = 3000;
const RENDER_PAGE = 120;

export default function LiveChannelManager() {
  const [allRows, setAllRows] = useState([]);
  const [totalOnServer, setTotalOnServer] = useState(0);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(null);
  const [q, setQ] = useState('');
  const [sourceId, setSourceId] = useState('all');
  const [sourceGroup, setSourceGroup] = useState('all'); // source-native group-title, read-only browse
  const [catalog, setCatalog] = useState('all'); // all | fixed id | unmapped | religious
  const [mapped, setMapped] = useState('all');
  const [hidden, setHidden] = useState('0');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selected, setSelected] = useState(() => new Set());
  const [ladderFor, setLadderFor] = useState(null); // channel doc being edited
  const [previewChannel, setPreviewChannel] = useState(null); // real-player modal
  const [renderCap, setRenderCap] = useState(RENDER_PAGE);
  const dragId = useRef('');

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(path, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, []);

  // One fetch for the whole (projected) collection + one fetch for sources.
  // Deliberately sends NO filter parameters: the lean sorted Mongo branch is
  // cheap and every filter afterwards is client-side.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [channelData, sourceData] = await Promise.all([
        api(`/api/live/admin/channels?limit=${FETCH_LIMIT}&hidden=all`),
        api('/api/live/admin/sources').catch(() => ({ sources: [] })),
      ]);
      setAllRows(channelData.channels || []);
      setTotalOnServer(channelData.total || 0);
      setSources(sourceData.sources || []);
      setSelected(new Set());
    } catch (error) {
      setMsg(error.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Keep the open preview in step with hide/catalog writes made inside it.
  useEffect(() => {
    if (!previewChannel) return;
    const fresh = allRows.find((row) => row.channelId === previewChannel.channelId);
    if (fresh) setPreviewChannel(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows]);

  // channelId -> Set<catalogId>, built once per data load instead of per row.
  const catalogSets = useMemo(() => {
    const map = new Map();
    for (const channel of allRows) map.set(channel.channelId, new Set(getChannelCatalogIds(channel)));
    return map;
  }, [allRows]);

  // Pure in-memory filtering — zero network on keystroke or tab change.
  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = allRows.filter((channel) => {
      if (sourceId !== 'all' && channel.sourceId !== sourceId) return false;
      if (sourceGroup !== 'all' && (channel.category || 'Live') !== sourceGroup) return false;
      if (hidden === '0' && channel.hidden) return false;
      if (hidden === '1' && !channel.hidden) return false;
      if (mapped === '1' && !(catalogSets.get(channel.channelId)?.size)) return false;
      if (mapped === '0' && catalogSets.get(channel.channelId)?.size) return false;
      if (catalog === 'unmapped' && catalogSets.get(channel.channelId)?.size) return false;
      if (catalog === 'religious' && !channel.religious) return false;
      if (isLiveCatalog(catalog) && !catalogSets.get(channel.channelId)?.has(catalog)) return false;
      if (needle) {
        const hay = `${channel.customName || ''} ${channel.name || ''} ${channel.channelId || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (isLiveCatalog(catalog)) rows = sortChannelsForCatalog(rows, catalog);
    return rows;
  }, [allRows, q, sourceId, catalog, mapped, hidden, catalogSets]);

  // Reset the pager whenever the visible slice changes identity.
  useEffect(() => { setRenderCap(RENDER_PAGE); }, [q, sourceId, sourceGroup, catalog, mapped, hidden]);
  const visibleRows = useMemo(() => filteredRows.slice(0, renderCap), [filteredRows, renderCap]);

  // Source → catalog browse: the catalog dropdown is scoped to the chosen
  // source, with live counts (incl. the virtual Unmapped / Religious buckets)
  // computed the same way /live counts cards. Pure in-memory work — switching
  // source or catalog makes no network calls.
  const sourceScopedRows = useMemo(
    () => (sourceId === 'all' ? allRows : allRows.filter((row) => row.sourceId === sourceId)),
    [allRows, sourceId],
  );
  const browseSummary = useMemo(
    () => summarizeLiveCatalogue(sourceScopedRows),
    [sourceScopedRows],
  );
  const catalogOptions = useMemo(() => ([
    { id: 'all', label: `All catalogs (${browseSummary.total})` },
    ...LIVE_CATALOGS.map((item) => ({ id: item.id, label: `${item.icon} ${item.name} (${browseSummary.catalogs[item.id] || 0})` })),
    { id: 'unmapped', label: `⚪ Unmapped (${browseSummary.unmapped})` },
    { id: 'religious', label: `🛡️ Religious (${browseSummary.religious})` },
  ]), [browseSummary]);
  // The selected source's OWN feed groups (Pocket Tamil → Local Channels,
  // Tamil FM Radio, Overseas…). Read-only: sync owns these labels; they are a
  // browse dimension, our fixed catalogs remain the publish target.
  const sourceGroupOptions = useMemo(() => summarizeSourceGroups(sourceScopedRows), [sourceScopedRows]);

  const patch = useCallback(async (channel, action, extra = {}) => {
    setBusy(channel.channelId);
    try {
      await api('/api/live/admin/channels', { method: 'PATCH', body: JSON.stringify({ channelId: channel.channelId, action, ...extra }) });
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
      await api('/api/live/admin/channels', { method: 'PATCH', body: JSON.stringify({ ids, action, ...extra }) });
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
      await Promise.all(ids.map((channelId) => api(`/api/live/admin/channels?channelId=${encodeURIComponent(channelId)}`, { method: 'DELETE' })));
      setMsg(`${ids.length} channel(s) deleted`);
      await load();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleCatalog = useCallback((channel, catalogId) => {
    const enabled = !catalogSets.get(channel.channelId)?.has(catalogId);
    return patch(channel, 'setCatalog', { catalogId, enabled });
  }, [patch, catalogSets]);

  const move = (channel, direction) => {
    if (!isLiveCatalog(catalog)) return;
    const index = filteredRows.findIndex((item) => item.channelId === channel.channelId);
    const neighbor = filteredRows[index + direction];
    if (!neighbor) return;
    return patch(channel, 'swapCatalogPosition', { catalogId: catalog, otherChannelId: neighbor.channelId, direction });
  };

  const onDropReorder = async (targetId) => {
    const from = dragId.current;
    dragId.current = '';
    if (!from || from === targetId || !isLiveCatalog(catalog)) return;
    const orderedIds = filteredRows.map((item) => item.channelId);
    const fromIndex = orderedIds.indexOf(from);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    orderedIds.splice(toIndex, 0, orderedIds.splice(fromIndex, 1)[0]);
    setBusy(targetId);
    try {
      await api('/api/live/admin/channels', { method: 'PATCH', body: JSON.stringify({ action: 'reorderCatalog', catalogId: catalog, orderedIds }) });
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
      await api(`/api/live/admin/channels?channelId=${encodeURIComponent(channel.channelId)}`, { method: 'DELETE' });
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
      catalogIds: getChannelCatalogIds(channel), forceProxy: Boolean(channel.forceProxy),
    });
    setShowForm(true);
  };

  const submitForm = async (event) => {
    event.preventDefault();
    let headers = {};
    if (form.headersText.trim()) {
      try { headers = JSON.parse(form.headersText); } catch { setMsg('Headers must be valid JSON, e.g. { "X-Key": "value" }'); return; }
    }
    const payload = { name: form.name.trim(), url: form.url.trim(), logo: form.logo.trim(), category: form.category.trim() || 'Live', format: form.format, language: form.language.trim(), keyId: form.keyId.trim(), key: form.key.trim(), licenseKey: form.licenseKey.trim(), licenseType: form.licenseType.trim(), cookie: form.cookie.trim(), userAgent: form.userAgent.trim(), referer: form.referer.trim(), headers, forceProxy: form.forceProxy === true };
    setBusy('form');
    try {
      if (editing) {
        await api('/api/live/admin/channels', { method: 'PATCH', body: JSON.stringify({ channelId: editing.channelId, ...payload }) });
      } else {
        await api('/api/live/admin/channels', { method: 'POST', body: JSON.stringify({ ...payload, catalogIds: form.catalogIds }) });
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
      const data = await api('/api/live/admin/rebuild', { method: 'POST', body: '{}' });
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
      await api('/api/live/admin/channels', { method: 'PATCH', body: JSON.stringify({ channelId: channel.channelId, ladderOrder }) });
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
  const knownSourceIds = useMemo(() => [...new Set([...Object.keys(SOURCE_REGISTRY), ...sources.map((s) => s.sourceId), 'manual'])], [sources]);

  // Stable row callbacks (same references across renders) so memo holds.
  const onToggleSelect = useCallback((channel) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(channel.channelId) ? next.delete(channel.channelId) : next.add(channel.channelId);
    return next;
  }), []);
  const rowDragStart = useCallback((channel) => { dragId.current = channel.channelId; }, []);
  const rowDragOver = useCallback((event) => { if (reorderEnabled) event.preventDefault(); }, [reorderEnabled]);

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border border-white/10 bg-zinc-950 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Sun TV, Vijay… (instant)" className="min-w-[170px] flex-1 rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs outline-none focus:border-red-500" />
          <select value={sourceId} onChange={(e) => { setSourceId(e.target.value); setSourceGroup('all'); }} title="Source" className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            {sourceOptions.map((item) => <option key={item.sourceId} value={item.sourceId}>{item.label}</option>)}
          </select>
          {/* The selected source's OWN feed groups (its native group-title
              taxonomy). Read-only browse filter — sync owns these labels. */}
          <select value={sourceGroup} onChange={(e) => setSourceGroup(e.target.value)} title="Source's own groups (read-only)" className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            {sourceGroupOptions.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}
          </select>
          {/* Catalogs of the selected source — counts are /live cards
              (duplicates merged, hidden/religious excluded). */}
          <select value={catalog} onChange={(e) => setCatalog(e.target.value)} title="Catalogs of the selected source" className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            {catalogOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select value={mapped} onChange={(e) => setMapped(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">Mapped + unmapped</option><option value="1">Mapped only</option><option value="0">Unmapped only</option>
          </select>
          <select value={hidden} onChange={(e) => setHidden(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="0">Visible</option><option value="1">Hidden</option><option value="all">Visible + hidden</option>
          </select>
          <button type="button" onClick={rebuild} disabled={busy === 'rebuild'} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold disabled:opacity-50">↻ Rebuild grouping</button>
          <button type="button" onClick={load} disabled={loading} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold disabled:opacity-50">⟳ Refresh</button>
          <button type="button" onClick={openCreate} className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-black text-white">+ Add channel</button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>
            {loading ? 'Loading…' : `${filteredRows.length} shown · ${allRows.length} loaded${totalOnServer > allRows.length ? ` · ${totalOnServer} in database` : ''}`}
            {reorderEnabled ? ' · drag rows or use ↑/↓ to reorder this catalog' : ' · source groups are the feed’s own labels (read-only); catalog counts are /live cards'}
          </span>
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
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11.5px] font-bold text-zinc-300">
            <input type="checkbox" checked={form.forceProxy === true} onChange={(e) => setForm({ ...form, forceProxy: e.target.checked })} className="mt-0.5 h-4 w-4 accent-red-600" />
            <span>
              Route all traffic through the server proxy (/api/live-proxy)
              <span className="block font-normal text-zinc-500">Enable when the CDN is open to the server but ISP-blocked on Indian home networks. Playlists and segments both relay via Render.</span>
            </span>
          </label>
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
        {!loading && !visibleRows.length ? <p className="rounded-2xl border border-white/10 bg-zinc-950 p-6 text-center text-sm text-zinc-400">No channels match these filters.</p> : null}
        {visibleRows.map((channel) => (
          <ChannelRow
            key={channel.channelId}
            channel={channel}
            checked={selected.has(channel.channelId)}
            reorderEnabled={reorderEnabled}
            busy={busy === channel.channelId}
            ladderOpen={ladderFor?.channelId === channel.channelId}
            previewOpen={previewChannel?.channelId === channel.channelId}
            catalogIdSet={catalogSets.get(channel.channelId) || EMPTY_SET}
            onToggleSelect={() => onToggleSelect(channel)}
            onDragStart={() => rowDragStart(channel)}
            onDragOver={rowDragOver}
            onDrop={() => onDropReorder(channel.channelId)}
            onMove={(dir) => move(channel, dir)}
            onPreview={() => setPreviewChannel(channel)}
            onLadder={() => setLadderFor(ladderFor?.channelId === channel.channelId ? null : channel)}
            onEdit={() => openEdit(channel)}
            onHideToggle={() => patch(channel, channel.hidden ? 'unhide' : 'hide')}
            onDelete={() => removeChannel(channel)}
            onToggleCatalog={(catalogId) => toggleCatalog(channel, catalogId)}
            knownSourceIds={knownSourceIds}
            onSaveLadder={(ladder) => saveLadder(channel, ladder)}
            onCancelLadder={() => setLadderFor(null)}
          />
        ))}
        {filteredRows.length > visibleRows.length ? (
          <button type="button" onClick={() => setRenderCap((n) => n + RENDER_PAGE)}
            className="w-full rounded-2xl border border-white/10 bg-zinc-950 py-2.5 text-xs font-bold text-zinc-300 hover:border-red-500/60">
            Show more — {filteredRows.length - visibleRows.length} remaining
          </button>
        ) : null}
      </div>

      {previewChannel ? (
        <AdminLivePreview
          channels={filteredRows}
          channel={previewChannel}
          onNavigate={setPreviewChannel}
          onClose={() => setPreviewChannel(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}
