'use client';

/**
 * LiveServicePanel — the full Live TV service panel (sources, manual mapping,
 * main preview, catalog order, tools, duplicates, EPG), extracted from
 * app/live/page.js for the admin panel's TV tab.
 *
 * Auth note: this component used to carry its own password gate (LIVE_TV_PASS
 * → /api/auth). That path is retired — the panel now rides the owner's main
 * session cookie (jash_access), which every /api/live-service/* route already
 * verifies. It therefore lives behind the app's AuthGate and the admin gate.
 */

import { startTransition, useEffect, useMemo, useState } from 'react';
import JashPlayer from '@/components/player/JashPlayerLazy';
import PlayerIncidents from '@/components/player/PlayerIncidents';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import {
  LIVE_CATALOGS,
  catalogLabel,
  getCatalogPosition,
  getChannelCatalogIds,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';
import {
  JIO_COOKIE_OVERRIDE_KEY,
  getJioCookieExpiry,
  isJioCookieValid,
  normalizeJioCookie,
} from '@/lib/jioPlayback';

/**
 * How many channel rows the service panel puts on screen at once.
 *
 * A fresh source can carry 5,000 channels and every row is ~12 buttons, so mounting the whole list
 * blocked the main thread for seconds — "the panel froze" was never the network, it was React. The
 * manual-mapping list is therefore paged by the API (limit/page/q, which the route already supported),
 * and the remaining lists grow in these steps on demand.
 */
const PANEL_PAGE_SIZE = 200;

function normalize(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const ROW_STEP = 400;

/**
 * Guide (EPG) tab of the live service panel: the feed's health, how much of the published lineup
 * resolves to it, and the manual binding picker for the rest.
 *
 * Two rules, both learned from this app being a single-tenant free-tier box:
 *  • the only write here is `tvgId` on the channel document — the guide index is never persisted, so
 *    a mapping costs one PATCH and nothing else;
 *  • the lookup is served from the already-parsed day index (in memory, one hour TTL), so opening
 *    this tab does not download a 65 MB feed. "Refresh feed now" is the one button that does, and it
 *    goes through the same single-flight cache the page polls, so it cannot stack up.
 */
function LiveEpgPanel({ channels = [], onAction, epg = null }) {
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const status = epg?.status || null;

  const rows = useMemo(() => {
    const needle = normalize(query);
    return channels
      .filter((channel) => channel.channelId || channel.id)
      .map((channel) => ({ channel, row: epg?.rows?.get?.(channel.channelId || channel.id) || null }))
      .filter(({ channel, row }) => {
        if (scope === 'unlinked' && row?.matched) return false;
        if (scope === 'linked' && !row?.matched) return false;
        if (!needle) return true;
        return normalize(`${channel.name} ${channel.tvgId || ''} ${row?.epgName || ''}`).includes(needle);
      });
  }, [channels, epg?.rows, scope, query]);

  useEffect(() => {
    const value = term.trim();
    if (value.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/live-epg/guide?lookup=${encodeURIComponent(value)}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        setResults(data.results || []);
        if (!response.ok || data.ok === false) setNote(data.error || 'Guide lookup failed');
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setNote(`Guide lookup failed: ${error.message || 'unknown error'}`);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250); // the feed carries 1,190 names; one request per keystroke would be pointless work
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  async function bind(channel, epgId, epgName) {
    try {
      await onAction?.(channel, 'setEpg', { epgId, epgName });
      setEditing('');
      setTerm('');
      setResults([]);
      setNote(epgId ? `${channel.name} → ${epgName || epgId}. The next guide poll picks it up.` : `${channel.name} unlinked from the guide.`);
    } catch (error) {
      setNote(error.message || 'Could not save the guide binding');
    }
  }

  const linked = epg?.linked ?? 0;
  const unlinked = epg?.unlinked ?? 0;
  const ageMinutes = status?.ageMs != null ? Math.round(status.ageMs / 60000) : null;

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-white">Live TV guide (XMLTV)</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Pocket-EPG is fetched once per hour and parsed once per day; <code className="rounded bg-black/50 px-1">LIVE_EPG_URL</code> overrides the feed and <code className="rounded bg-black/50 px-1">LIVE_EPG_TTL_MS</code> the interval.
              Nothing lands in MongoDB — a listing is derived data, so a refresh can always redo it.
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-zinc-300">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">{linked} linked</span>
              <span className={`rounded-full px-2 py-0.5 ${unlinked ? 'bg-orange-500/15 text-orange-200' : 'bg-white/[0.06] text-zinc-400'}`}>{unlinked} to map</span>
              <span className="text-zinc-500">
                {ageMinutes == null ? 'index loading' : `index ${ageMinutes} min old`}
                {status?.feedChannels ? ` • ${status.feedChannels} feed channels` : ''}
                {status?.feedBytes ? ` • ${(status.feedBytes / 1e6).toFixed(1)} MB` : ''}
              </span>
            </p>
            {status?.url ? <p className="mt-1 truncate text-[10px] font-semibold text-zinc-500">{status.url}</p> : null}
            {status?.error ? <p className="mt-1 text-[11px] font-bold text-orange-300">last fetch failed: {status.error} (serving the previous listing)</p> : null}
          </div>
          <button
            onClick={epg?.refresh}
            disabled={!epg?.refresh || epg?.refreshing}
            className="rounded-2xl border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs font-black text-red-100 transition hover:border-red-300/70 disabled:opacity-50"
            title="Re-download the feed now. Shares the page's single-flight cache, so it cannot stack up."
          >
            {epg?.refreshing ? 'Refreshing…' : 'Refresh feed now'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[['all', `All · ${channels.length}`], ['unlinked', `Needs mapping · ${unlinked}`], ['linked', `Linked · ${linked}`]].map(([id, label]) => (
          <button key={id} onClick={() => setScope(id)} className={`rounded-2xl border px-3 py-1.5 text-xs font-black transition ${scope === id ? 'border-red-400 bg-red-500/20 text-red-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}>{label}</button>
        ))}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by channel" className="min-w-[10rem] flex-1 rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-red-400" />
      </div>

      {note ? <p className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5 text-zinc-300">{note}</p> : null}
      {!channels.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No published channels for this profile yet — map channels first, then bind them to the guide.</p> : null}

      <div className="space-y-2">
        {rows.map(({ channel, row }) => (
          <div key={channel.channelId || channel.id} className="rounded-3xl border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{channel.name}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-zinc-500">
                  {channel.source || 'source'}
                  {channel.tvgId ? ` • bound to ${channel.tvgId}` : ' • no explicit binding'}
                  {row?.matched && row.via !== 'tvgId' ? ` • matched by ${row.via} → ${row.epgName || row.epgId}` : ''}
                </p>
                {row?.now ? <p className="mt-0.5 truncate text-[11px] font-bold text-zinc-300">now: {row.now.title}</p> : null}
              </div>
              <button
                onClick={() => { setEditing(editing === (channel.channelId || channel.id) ? '' : (channel.channelId || channel.id)); setTerm(''); setResults([]); setNote(''); }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-red-300/60"
              >
                {row?.matched ? 'Change binding' : 'Map guide'}
              </button>
              {channel.tvgId ? (
                <button onClick={() => bind(channel, '', '')} className="rounded-2xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-400 transition hover:border-orange-300/60 hover:text-orange-200" title="Drop the explicit binding and fall back to name matching">
                  Unlink
                </button>
              ) : null}
            </div>

            {editing === (channel.channelId || channel.id) ? (
              <div className="mt-3 rounded-2xl border border-red-300/20 bg-red-500/[0.06] p-3">
                <input
                  autoFocus
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search the guide feed by name (2+ characters)"
                  className="w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-red-400"
                />
                <p className="mt-2 text-[11px] font-semibold text-zinc-400">
                  {searching ? 'Searching the parsed feed…' : term.trim().length < 2 ? 'Type at least two characters. Results come from the same day index the page uses.' : results.length ? `${results.length} match${results.length > 1 ? 'es' : ''}` : 'Nothing in the feed matches that name.'}
                </p>
                {results.length ? (
                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {results.map((item) => (
                      <button key={item.id} onClick={() => bind(channel, item.id, item.name)} className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-red-300/60">
                        {item.logo ? <img src={item.logo} alt="" className="h-6 w-6 shrink-0 rounded bg-black object-contain" loading="lazy" /> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-white">{item.name}</span>
                          <span className="block truncate text-[10px] font-semibold text-zinc-500">id {item.id}</span>
                        </span>
                        {item.id === channel.tvgId ? <span className="shrink-0 rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-black text-red-100">current</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ServicePreviewPlayer({ channel }) {
  // Same policy as the main panel, so a preview that works is a channel that
  // will play (and a preview that fails says why in the same words).
  const policy = useMemo(() => (channel?.url ? createLiveTvPolicy(channel) : null), [channel]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
      {/* `relative` + an explicit aspect box: the compact player fills this rather than sizing itself,
          and without a positioned parent the absolute video/controls had nothing to sit in. */}
      <div className="relative aspect-video bg-black">
        {channel?.url && policy ? (
          <JashPlayer
            source={{ url: channel.url, kind: 'auto', label: channel.name }}
            playbackPolicy={policy}
            poster={channel.logo || ''}
            live
            compact
            gesturesEnabled={false}
            display={{ title: channel.name || 'Preview', aspect: 'fill', bufferAheadSeconds: 6 }}
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-xs font-semibold leading-5 text-zinc-500">
            {channel ? `${channel.name || 'This channel'} has no stream URL to preview` : 'Pick Preview on any channel row'}
          </div>
        )}
      </div>
      <div className="border-t border-white/10 px-3 py-2 text-[11px] text-zinc-400">
        {channel?.name || 'No preview'}
        {channel?.format ? ` • ${(channel.format || '').toUpperCase()}` : ''}
      </div>
    </div>
  );
}

function LiveServicePanel({ open, onClose, onPreview, onMainRefresh, epg = null }) {
  const [tab, setTab] = useState('sources');
  const [sources, setSources] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [mainPanelChannels, setMainPanelChannels] = useState([]);
  const [mainPanelQuery, setMainPanelQuery] = useState('');
  const [mainPanelCategory, setMainPanelCategory] = useState('all');
  const [mainPanelSource, setMainPanelSource] = useState('all');
  const [categories, setCategories] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [channelQuery, setChannelQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mappingFilter, setMappingFilter] = useState('all');
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsPage, setChannelsPage] = useState(1);
  const [channelsPageInfo, setChannelsPageInfo] = useState({ total: 0, hasMore: false });
  // The search box and both selects are applied by the API, not in the browser: a channel on row
  // 4,300 of a 5,000-row source is otherwise unreachable, and re-filtering thousands of rows on every
  // keystroke is what made the panel feel stuck while typing. This token records exactly which filters
  // the mounted page answers to, so `channelRowsFiltered` never filters twice with different rules.
  const [serverFilter, setServerFilter] = useState(null);
  const [rowLimit, setRowLimit] = useState(ROW_STEP);
  const [channelStats, setChannelStats] = useState({ total: 0, mapped: 0, unmapped: 0 });
  const [orderCatalog, setOrderCatalog] = useState('main');
  const [activeProfile, setActiveProfile] = useState('default');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [previewChannel, setPreviewChannel] = useState(null);
  const [sourceForm, setSourceForm] = useState({ label: '', url: '', type: 'm3u', priority: 50 });
  const [importText, setImportText] = useState('');
  const [jioCookieText, setJioCookieText] = useState('');
  const [jioTokenStatus, setJioTokenStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    try {
      const savedCookie = normalizeJioCookie(window.localStorage.getItem(JIO_COOKIE_OVERRIDE_KEY) || '');
      setJioCookieText(savedCookie);
      const expiresAt = getJioCookieExpiry(savedCookie);
      setJioTokenStatus(savedCookie
        ? isJioCookieValid(savedCookie)
          ? `Browser override active${expiresAt ? ` until ${new Date(expiresAt).toLocaleString()}` : ''}.`
          : 'Saved browser override is expired.'
        : 'Automatic public token mode is active.');
    } catch {}
  }, [open]);

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  };


  async function loadSources() {
    const data = await api('/api/live-service/sources');
    setSources(data.sources || []);
  }

  async function loadProfiles() {
    const data = await api('/api/live-service/profiles');
    setProfiles(data.profiles || []);
  }

  async function loadChannels({ mapped = false, sourceId = sourceFilter, page = 1, q = '', map = '', category = '' } = {}) {
    const needle = String(q || '').trim();
    const params = new URLSearchParams({ limit: mapped ? '1000' : String(PANEL_PAGE_SIZE) });
    if (mapped) {
      params.set('mapped', '1');
      params.set('profile', activeProfile);
    } else {
      if (!sourceId) {
        setChannels([]);
        setCategories([]);
        setChannelsLoaded(false);
        setChannelStats({ total: 0, mapped: 0, unmapped: 0 });
        setChannelsPageInfo({ total: 0, hasMore: false });
        setServerFilter(null);
        return;
      }
      params.set('sourceId', sourceId);
      params.set('page', String(Math.max(1, Number(page) || 1)));
      if (needle) params.set('q', needle);
      if (map === 'mapped') params.set('mapped', '1');
      if (map === 'unmapped') params.set('mapped', '0');
      if (category) params.set('category', category);
    }

    const data = await api(`/api/live-service/channels?${params.toString()}`);
    if (mapped) {
      setSelectedChannels(data.channels || []);
    } else {
      setChannelsPage(Number(data.page) || Math.max(1, Number(page) || 1));
      setChannelsPageInfo({ total: Number(data.sourceTotal ?? data.total) || 0, hasMore: Boolean(data.hasMore) });
      setServerFilter({ q: needle, map, category, page: Number(data.page) || Math.max(1, Number(page) || 1) });
      // The stats line is the server's count for the source, not the page in front of us.
      setChannelStats((current) => ({ ...current, total: Number(data.sourceTotal ?? data.total) || current.total }));
      setChannels(data.channels || []);
      setCategories(data.categories || []);
      setChannelsLoaded(true);
      setChannelStats({
        total: data.sourceTotal || data.total || 0,
        mapped: data.mappedTotal || 0,
        unmapped: data.unmappedTotal || 0,
      });
    }
  }

  async function loadSourceChannels() {
    if (!sourceFilter) {
      setMessage('Choose one source, then click Load source channels.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      await loadChannels({ sourceId: sourceFilter, page: 1, q: channelQuery, map: mappingFilter, category: categoryFilter });
      setMessage(`First ${PANEL_PAGE_SIZE} channels loaded. Search or page through the rest — the whole catalog is never mounted at once.`);
    } catch (err) {
      setMessage(err.message || 'Unable to load source channels');
    } finally {
      setLoading(false);
    }
  }

  // The search box goes to the API instead of filtering a loaded page: a name that lives on row
  // 4,300 of a 5,000-channel source is otherwise unreachable, and re-filtering 5,000 objects on
  // every keystroke is what made the panel feel stuck while typing.
  useEffect(() => {
    if (!open || tab !== 'channels' || !channelsLoaded || !sourceFilter) return undefined;
    const q = channelQuery.trim();
    if (serverFilter && serverFilter.q === q && serverFilter.map === mappingFilter && serverFilter.category === categoryFilter && serverFilter.page === 1) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadChannels({ sourceId: sourceFilter, page: 1, q, map: mappingFilter, category: categoryFilter }).catch(() => {});
    }, 320);
    return () => window.clearTimeout(timer);
    // loadChannels is recreated per render on purpose; the deps above are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelQuery, mappingFilter, categoryFilter, open, tab, channelsLoaded, sourceFilter]);

  // A new tab or a new filter should never inherit a half-scrolled 800-row list.
  useEffect(() => {
    setRowLimit(ROW_STEP);
  }, [tab, orderCatalog, mainPanelCategory, mainPanelSource, channelQuery, mappingFilter, categoryFilter]);

  async function loadMainPanelPreview() {
    const response = await fetch(`/api/live-tv?playable=1&profile=${encodeURIComponent(activeProfile)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Main panel preview failed');
    setMainPanelChannels(data.channels || []);
  }

  async function refreshAll() {
    setLoading(true);
    setMessage('');
    try {
      await Promise.all([loadSources(), loadProfiles(), loadChannels({ mapped: true }), loadMainPanelPreview()]);
    } catch (err) {
      setMessage(err.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  // Runs when the panel opens, not when the loaders below are re-created —
  // that is the point, so keep the dependency list short.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) refreshAll(); }, [open]);
  useEffect(() => {
    // Selecting a source must not automatically load its full catalog. The
    // explicit Load button keeps service-panel startup and source switching fast.
    setChannels([]);
    setCategories([]);
    setChannelsLoaded(false);
    setChannelStats({ total: 0, mapped: 0, unmapped: 0 });
    setCategoryFilter('');
    setChannelQuery('');
    setMappingFilter('all');
    setChannelsPage(1);
    setChannelsPageInfo({ total: 0, hasMore: false });
    setServerFilter(null);
  }, [sourceFilter]);
  // Same reason as above: a profile switch reloads the table once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { loadChannels({ mapped: true }); loadMainPanelPreview(); } }, [activeProfile]);

  async function syncSource(sourceId = '') {
    setLoading(true);
    try {
      const data = await api('/api/live-service/sync', { method: 'POST', body: JSON.stringify({ sourceId, includeAll: true }) });
      setMessage(`Synced ${data.results?.length || 0} source(s). New channels remain unmapped until you publish them manually.`);
      setChannelsLoaded(false);
      setChannels([]);
      await refreshAll();
      onMainRefresh?.();
    } catch (err) { setMessage(err.message || 'Sync failed'); } finally { setLoading(false); }
  }

  async function saveSource(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await api('/api/live-service/sources', { method: 'POST', body: JSON.stringify(sourceForm) });
      setSourceForm({ label: '', url: '', type: 'm3u', priority: 50 });
      setMessage('Source saved.');
      await loadSources();
    } catch (err) { setMessage(err.message || 'Save source failed'); } finally { setLoading(false); }
  }

  async function patchSource(source, patch) {
    await api('/api/live-service/sources', { method: 'PATCH', body: JSON.stringify({ sourceId: source.sourceId || source.id, ...patch }) });
    await loadSources();
  }

  async function deleteSource(source, channels = false) {
    if (!window.confirm(`Delete source ${source.label}?`)) return;
    await api(`/api/live-service/sources?sourceId=${encodeURIComponent(source.sourceId || source.id)}&channels=${channels ? '1' : '0'}`, { method: 'DELETE' });
    await refreshAll();
  }

  async function channelAction(channel, action, patch = {}) {
    try {
      const wasMapped = Boolean(channel.mapped || getChannelCatalogIds(channel).length);
      const data = await api('/api/live-service/channels', {
        method: 'PATCH',
        body: JSON.stringify({ channelId: channel.channelId || channel.id, action, ...patch }),
      });
      const updates = data.channels || [];
      if (!updates.length) return;
      const requestedId = channel.channelId || channel.id;
      const updated = updates.find((item) => (item.channelId || item.id) === requestedId) || updates[0];
      const isMapped = Boolean(updated.mapped || getChannelCatalogIds(updated).length);
      const updateMap = new Map(updates.map((item) => [item.channelId || item.id, item]));
      const replace = (items) => items.map((item) => updateMap.get(item.channelId || item.id) || item);
      const profileCompatible = (item) => (item.profiles || ['default']).includes(activeProfile);

      setChannels((items) => replace(items));
      setSelectedChannels((items) => {
        let next = replace(items);
        for (const item of updates) {
          const id = item.channelId || item.id;
          next = next.filter((current) => (current.channelId || current.id) !== id);
          if ((item.mapped || getChannelCatalogIds(item).length) && profileCompatible(item)) next.push(item);
        }
        return next;
      });
      setMainPanelChannels((items) => {
        let next = replace(items);
        for (const item of updates) {
          const id = item.channelId || item.id;
          next = next.filter((current) => (current.channelId || current.id) !== id);
          if ((item.mapped || getChannelCatalogIds(item).length) && item.selected && !item.hidden && item.playable && profileCompatible(item)) next.push(item);
        }
        return next;
      });
      if (channelsLoaded && wasMapped !== isMapped) {
        setChannelStats((current) => ({
          ...current,
          mapped: Math.max(0, current.mapped + (isMapped ? 1 : -1)),
          unmapped: Math.max(0, current.unmapped + (isMapped ? -1 : 1)),
        }));
      }
      setMessage(action === 'setEpg'
        ? `${updated.name} guide binding saved. Listings refresh with the next guide poll.`
        : action === 'swapCatalogPosition'
        ? `${catalogLabel(patch.catalogId)} order updated.`
        : isMapped
          ? `${updated.name} mapped to ${getChannelCatalogIds(updated).map(catalogLabel).join(' + ')}.`
          : `${updated.name} is unmapped and removed from the main panel.`);
      loadSources().catch(() => {});
    } catch (err) {
      setMessage(err.message || 'Channel update failed');
    }
  }

  async function toggleCatalog(channel, catalogId) {
    await channelAction(channel, 'toggleCatalog', { catalogId });
  }

  async function setCatalogPosition(channel, catalogId) {
    const current = getCatalogPosition(channel, catalogId);
    const raw = window.prompt(`Position in ${catalogLabel(catalogId)}`, current < 999999 ? String(current) : '100');
    if (raw == null) return;
    const position = Number(raw);
    if (!Number.isFinite(position) || position < 0) {
      setMessage('Position must be a number greater than or equal to zero.');
      return;
    }
    await channelAction(channel, 'catalogPosition', { catalogId, position });
  }

  async function reorder(channel, direction) {
    const index = orderedCatalogChannels.findIndex((item) => (item.channelId || item.id) === (channel.channelId || channel.id));
    if (index < 0) return;
    const nextIndex = index + (direction < 0 ? -1 : 1);
    const adjacent = orderedCatalogChannels[nextIndex];
    if (!adjacent) return;
    await channelAction(channel, 'swapCatalogPosition', {
      catalogId: orderCatalog,
      otherChannelId: adjacent.channelId || adjacent.id,
      direction: direction < 0 ? -1 : 1,
    });
  }

  async function purge(mode = 'unused') {
    if (!window.confirm(`Purge ${mode} channels${sourceFilter ? ' for selected source' : ''}?`)) return;
    setLoading(true);
    try {
      const data = await api('/api/live-service/purge', { method: 'POST', body: JSON.stringify({ sourceId: sourceFilter, mode }) });
      setMessage(`Purged ${data.removed || 0} channel(s).`);
      await refreshAll();
      onMainRefresh?.();
    } catch (err) { setMessage(err.message || 'Purge failed'); } finally { setLoading(false); }
  }

  async function checkBroken() {
    setLoading(true);
    try {
      const data = await api('/api/live-service/check', { method: 'POST', body: JSON.stringify({ sourceId: sourceFilter, limit: 60 }) });
      setMessage(`Checked ${data.checked || 0} channel(s).`);
      await loadChannels();
    } catch (err) { setMessage(err.message || 'Check failed'); } finally { setLoading(false); }
  }

  async function loadDuplicates() {
    const params = new URLSearchParams();
    if (sourceFilter) params.set('sourceId', sourceFilter);
    const data = await api(`/api/live-service/duplicates?${params.toString()}`);
    setDuplicates(data.groups || []);
    setTab('duplicates');
  }

  function saveJioCookieOverride() {
    const cookie = normalizeJioCookie(jioCookieText);
    if (!cookie || !isJioCookieValid(cookie)) {
      setJioTokenStatus('Invalid or expired token. Paste the complete __hdnea__=st=…~exp=…~acl=…~hmac=… value.');
      return;
    }
    window.localStorage.setItem(JIO_COOKIE_OVERRIDE_KEY, cookie);
    setJioCookieText(cookie);
    const expiresAt = getJioCookieExpiry(cookie);
    setJioTokenStatus(`Browser override saved${expiresAt ? `; valid until ${new Date(expiresAt).toLocaleString()}` : ''}.`);
    setMessage('Jio browser token saved. Close the service panel or reselect the channel to retry playback.');
  }

  function clearJioCookieOverride() {
    window.localStorage.removeItem(JIO_COOKIE_OVERRIDE_KEY);
    setJioCookieText('');
    setJioTokenStatus('Browser override cleared. Automatic public token mode is active.');
    setMessage('Jio override cleared.');
  }

  async function checkAutomaticJioToken() {
    try {
      setJioTokenStatus('Refreshing automatic Jio token…');
      const response = await fetch('/api/live-jio?force=1', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.available) throw new Error(data.error || 'No token available');
      const expiresAt = Number(data.expiresAtMs || 0);
      setJioTokenStatus(`Automatic token available${expiresAt ? ` until ${new Date(expiresAt).toLocaleString()}` : ''}.`);
    } catch (err) {
      setJioTokenStatus(`Automatic token check failed: ${err.message || 'unknown error'}`);
    }
  }

  async function exportBackup() {
    const data = await api('/api/live-service/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jash-live-tv-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup() {
    try {
      const parsed = JSON.parse(importText);
      const data = await api('/api/live-service/import', { method: 'POST', body: JSON.stringify(parsed) });
      setMessage(`Imported ${data.sources || 0} sources and ${data.channels || 0} channels.`);
      setImportText('');
      await refreshAll();
      onMainRefresh?.();
    } catch (err) { setMessage(err.message || 'Import failed'); }
  }

  async function addProfile() {
    const name = window.prompt('Profile name', 'Kids');
    if (!name) return;
    await api('/api/live-service/profiles', { method: 'POST', body: JSON.stringify({ name }) });
    await loadProfiles();
  }

  const mainPanelSources = useMemo(() => {
    const map = new Map();
    sources.forEach((source) => map.set(source.sourceId || source.id, { id: source.sourceId || source.id, label: source.label }));
    mainPanelChannels.forEach((channel) => {
      const id = channel.sourceId || channel.source;
      if (id && !map.has(id)) map.set(id, { id, label: channel.source || id });
    });
    return [...map.values()];
  }, [sources, mainPanelChannels]);
  const mainPanelFiltered = useMemo(() => {
    const q = normalize(mainPanelQuery);
    const filtered = mainPanelChannels.filter((channel) => {
      if (!channel.playable) return false;
      if (mainPanelCategory !== 'all' && !getChannelCatalogIds(channel).includes(mainPanelCategory)) return false;
      if (mainPanelSource !== 'all' && channel.sourceId !== mainPanelSource && channel.source !== mainPanelSource) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.region} ${channel.source} ${getChannelCatalogIds(channel).join(' ')}`).includes(q);
    });
    return sortChannelsForCatalog(filtered, mainPanelCategory);
  }, [mainPanelChannels, mainPanelQuery, mainPanelCategory, mainPanelSource]);
  const channelRowsFiltered = useMemo(() => {
    const applied = Boolean(serverFilter)
      && serverFilter.q === channelQuery.trim()
      && serverFilter.map === mappingFilter
      && serverFilter.category === categoryFilter;
    if (applied) return channels; // the page in hand is already the answer
    const q = normalize(channelQuery);
    return channels.filter((channel) => {
      const mapped = Boolean(channel.mapped || getChannelCatalogIds(channel).length);
      if (mappingFilter === 'mapped' && !mapped) return false;
      if (mappingFilter === 'unmapped' && mapped) return false;
      if (categoryFilter && channel.category !== categoryFilter) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.source}`).includes(q);
    });
  }, [channels, channelQuery, mappingFilter, categoryFilter, serverFilter]);
  const orderedCatalogChannels = useMemo(() => {
    return sortChannelsForCatalog(
      selectedChannels.filter((channel) => getChannelCatalogIds(channel).includes(orderCatalog)),
      orderCatalog,
    );
  }, [selectedChannels, orderCatalog]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 p-2 backdrop-blur-xl sm:p-4">
      <section className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-[1.6rem] border border-red-300/20 bg-zinc-950 text-white shadow-2xl sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div><h2 className="text-lg font-black sm:text-2xl">Live TV Service Panel</h2><p className="text-[11px] text-zinc-500">Manual catalogs • source-on-demand loading • per-catalog order</p></div>
          <button type="button" onClick={onClose} aria-label="Close service panel" title="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-2xl font-black leading-none text-white transition hover:border-red-400 hover:bg-red-500/80">✕</button>
        </div>

          <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
            <aside className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/25 p-3">
              <div className="grid gap-2">
                {[
                  ['sources', 'Sources'],
                  ['channels', 'Manual mapping'],
                  ['main', 'Main preview'],
                  ['selected', 'Catalog order'],
                  ['tools', 'Tools'],
                  ['duplicates', 'Duplicates'],
                  ['epg', 'Guide (EPG)'],
                ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-2xl px-4 py-3 text-left text-sm font-black ${tab === id ? 'bg-red-500 text-white' : 'bg-white/[0.04] text-zinc-300'}`}>{label}</button>)}
              </div>
              <div className="mt-4 space-y-2">
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="">Choose source…</option>{sources.map((s) => <option key={s.sourceId || s.id} value={s.sourceId || s.id}>{s.label}</option>)}</select>
                <select value={activeProfile} onChange={(e) => setActiveProfile(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white">{(profiles.length ? profiles : [{ profileId: 'default', name: 'Main' }]).map((p) => <option key={p.profileId} value={p.profileId}>{p.name}</option>)}</select>
                <button onClick={refreshAll} disabled={loading} className="w-full rounded-2xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-200">{loading ? 'Working…' : 'Refresh'}</button>
                {message ? <p className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5 text-zinc-300">{message}</p> : null}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/20 p-3">
              {tab === 'sources' ? <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-3">
                  <div><p className="text-sm font-black text-white">Sources</p><p className="text-xs text-zinc-500">Sync stores channels as unmapped. Nothing is published until you map it manually.</p></div>
                  <button onClick={() => syncSource('')} disabled={loading} className="rounded-full bg-green-500 px-4 py-2 text-xs font-black text-black disabled:opacity-60">Sync all enabled</button>
                </div>
                <form onSubmit={saveSource} className="grid gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2">
                  <input value={sourceForm.label} onChange={(e) => setSourceForm((f) => ({ ...f, label: e.target.value }))} placeholder="Source name" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white" />
                  <input value={sourceForm.url} onChange={(e) => setSourceForm((f) => ({ ...f, url: e.target.value }))} placeholder="M3U/JSON URL" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white" />
                  <select value={sourceForm.type} onChange={(e) => setSourceForm((f) => ({ ...f, type: e.target.value }))} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="m3u">M3U</option><option value="json">JSON</option></select>
                  <button className="rounded-2xl bg-red-500 px-3 py-2 text-sm font-black text-white">Add / Save Source</button>
                </form>
                {sources.map((source) => <div key={source.sourceId || source.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{source.label}</p><p className="break-all text-xs text-zinc-500">{source.url}</p><p className="mt-1 text-xs text-zinc-500">{source.channelCount || 0} channels • {source.mappedCount ?? source.selectedCount ?? 0} mapped • priority {source.priority}</p>{source.lastError ? <p className="mt-2 rounded-xl border border-red-400/25 bg-red-500/10 p-2 text-xs text-red-200">{source.lastError}</p> : null}</div><span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold uppercase">{source.type}</span></div>
                  <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => syncSource(source.sourceId || source.id)} className="rounded-full bg-green-500 px-3 py-1.5 text-xs font-black text-black">Sync</button><button onClick={() => patchSource(source, { enabled: !source.enabled })} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black">{source.enabled ? 'Disable' : 'Enable'}</button><button onClick={() => patchSource(source, { autoPurge: !source.autoPurge })} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black">Auto purge {source.autoPurge ? 'On' : 'Off'}</button><button onClick={() => deleteSource(source, false)} className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs font-black text-red-200">Delete</button></div>
                </div>)}
              </div> : null}

              {tab === 'channels' ? <div className="space-y-3">
                <div className="rounded-3xl border border-cyan-300/20 bg-cyan-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">Manual catalog mapping</p>
                      <p className="text-xs leading-5 text-zinc-400">Choose one source on the left. Its full catalog loads only when you press Load. Click one or more catalog chips to publish a channel.</p>
                    </div>
                    <button onClick={loadSourceChannels} disabled={loading || !sourceFilter} className="rounded-full bg-cyan-400 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-40">Load source channels</button>
                  </div>
                  {channelsLoaded ? <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-black/25 p-2"><b className="block text-white">{channelStats.total}</b>All</div><div className="rounded-xl bg-green-500/10 p-2 text-green-200"><b className="block">{channelStats.mapped}</b>Mapped</div><div className="rounded-xl bg-zinc-500/10 p-2 text-zinc-300"><b className="block">{channelStats.unmapped}</b>Unmapped</div></div> : null}
                </div>
                {channelsLoaded ? <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input value={channelQuery} onChange={(e) => setChannelQuery(e.target.value)} placeholder="Search loaded source" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white" />
                    <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="">All source categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    <select value={mappingFilter} onChange={(e) => setMappingFilter(e.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="all">Mapped + unmapped</option><option value="mapped">Mapped only</option><option value="unmapped">Unmapped only</option></select>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Page {channelsPage} • {channelRowsFiltered.length} of {channelsPageInfo.total || channelStats.total || '?'} channels on this source
                    {serverFilter?.q ? ` • search: “${serverFilter.q}”` : ''}
                    {serverFilter && serverFilter.map !== 'all' ? ` • ${serverFilter.map}` : ''}
                  </p>
                  {channelRowsFiltered.map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} />)}
                  <PanelPager
                    page={channelsPage}
                    total={channelsPageInfo.total || channelStats.total || 0}
                    pageSize={PANEL_PAGE_SIZE}
                    hasMore={channelsPageInfo.hasMore}
                    loading={loading}
                    onPrev={() => loadChannels({ sourceId: sourceFilter, page: channelsPage - 1, q: channelQuery, map: mappingFilter, category: categoryFilter }).catch(() => {})}
                    onNext={() => loadChannels({ sourceId: sourceFilter, page: channelsPage + 1, q: channelQuery, map: mappingFilter, category: categoryFilter }).catch(() => {})}
                  />
                  {!channelRowsFiltered.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No channels match these filters.</p> : null}
                </> : <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No source catalog loaded. This keeps service-panel startup fast.</p>}
              </div> : null}

              {tab === 'main' ? <div className="space-y-3">
                <div className="rounded-3xl border border-red-300/20 bg-red-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black text-white">Main Panel Preview</p><p className="text-xs text-zinc-400">This list is fetched from /api/live-tv and should exactly match the main Live TV panel.</p></div><button onClick={loadMainPanelPreview} className="rounded-full border border-red-300/30 px-3 py-1.5 text-xs font-black text-red-100">Reload</button></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <select value={mainPanelCategory} onChange={(event) => setMainPanelCategory(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none"><option value="all">All catalogs</option>{LIVE_CATALOGS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select value={mainPanelSource} onChange={(event) => setMainPanelSource(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none"><option value="all">All sources</option>{mainPanelSources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                    <input value={mainPanelQuery} onChange={(event) => setMainPanelQuery(event.target.value)} placeholder="Search main panel" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none" />
                  </div>
                </div>
                {mainPanelFiltered.slice(0, rowLimit).map((channel) => <ChannelManagerRow key={channel.channelId || channel.id} channel={channel} selectedMode positionCatalog={mainPanelCategory === 'all' ? '' : mainPanelCategory} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} />)}
                {mainPanelFiltered.length > rowLimit ? <RowShowMore shown={rowLimit} total={mainPanelFiltered.length} onMore={() => startTransition(() => setRowLimit((current) => current + ROW_STEP))} /> : null}
                {!mainPanelFiltered.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No main panel channels for this filter.</p> : null}
              </div> : null}

              {tab === 'selected' ? <div className="space-y-3">
                <div className="rounded-3xl border border-red-300/20 bg-red-500/10 p-3">
                  <p className="text-sm font-black text-white">Per-catalog channel order</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">A channel can have a different position in every catalog. Use arrows for quick changes or click its position badge to enter an exact number.</p>
                  <select value={orderCatalog} onChange={(event) => setOrderCatalog(event.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white sm:max-w-xs">{LIVE_CATALOGS.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name}</option>)}</select>
                </div>
                {orderedCatalogChannels.slice(0, rowLimit).map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} selectedMode positionCatalog={orderCatalog} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} onUp={(ch) => reorder(ch, -10)} onDown={(ch) => reorder(ch, 10)} />)}
                {orderedCatalogChannels.length > rowLimit ? <RowShowMore shown={rowLimit} total={orderedCatalogChannels.length} onMore={() => startTransition(() => setRowLimit((current) => current + ROW_STEP))} /> : null}
                {!orderedCatalogChannels.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No channels mapped to {catalogLabel(orderCatalog)}.</p> : null}
              </div> : null}

              {tab === 'tools' ? <div className="space-y-4">
                <PlayerIncidents />
                <div className="rounded-3xl border border-yellow-300/20 bg-yellow-500/[0.07] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-sm font-black text-yellow-100">Jio playback token</p><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">Playback automatically refreshes the public Stream4Liv-compatible token. If that feed is down, paste a current <code>__hdnea__</code> token here. The override stays only in this browser.</p></div>
                    <button type="button" onClick={checkAutomaticJioToken} className="rounded-full border border-yellow-300/30 px-3 py-1.5 text-xs font-black text-yellow-100">Check automatic token</button>
                  </div>
                  <textarea value={jioCookieText} onChange={(event) => setJioCookieText(event.target.value)} placeholder="__hdnea__=st=…~exp=…~acl=/*~hmac=…" className="mt-3 h-24 w-full rounded-2xl border border-white/10 bg-black p-3 font-mono text-xs text-white outline-none focus:border-yellow-400" />
                  <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={saveJioCookieOverride} className="rounded-full bg-yellow-400 px-4 py-2 text-xs font-black text-black">Save Jio override</button><button type="button" onClick={clearJioCookieOverride} className="rounded-full border border-white/10 px-4 py-2 text-xs font-black text-zinc-300">Use automatic token</button></div>
                  {jioTokenStatus ? <p className="mt-3 rounded-xl bg-black/25 p-2 text-xs text-zinc-300">{jioTokenStatus}</p> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><button onClick={() => purge('unused')} className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-black text-white">Purge unused</button><button onClick={() => purge('broken')} className="rounded-2xl border border-red-400/30 px-4 py-3 text-sm font-black text-red-200">Purge broken</button><button onClick={checkBroken} className="rounded-2xl border border-green-400/30 px-4 py-3 text-sm font-black text-green-200">Check broken</button><button onClick={loadDuplicates} className="rounded-2xl border border-yellow-400/30 px-4 py-3 text-sm font-black text-yellow-100">Find duplicates</button><button onClick={addProfile} className="rounded-2xl border border-red-400/30 px-4 py-3 text-sm font-black text-red-100">Add profile</button><button onClick={exportBackup} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-black">Export backup</button></div>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste exported JSON backup here" className="h-36 w-full rounded-2xl border border-white/10 bg-black p-3 text-xs text-white" />
                <button onClick={importBackup} className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-black text-white">Import backup</button>
              </div> : null}

              {tab === 'epg' ? <LiveEpgPanel channels={selectedChannels} onAction={channelAction} epg={epg} /> : null}
              {tab === 'duplicates' ? <div className="space-y-3">{duplicates.map((group) => <div key={group.key} className="rounded-3xl border border-white/10 bg-white/[0.03] p-3"><p className="mb-2 text-sm font-black">{group.key} • {group.count}</p><div className="space-y-2">{group.channels.map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} />)}</div></div>)}{!duplicates.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">Click Find duplicates in Tools.</p> : null}</div> : null}
            </main>

            <aside className="min-h-0 space-y-3 overflow-y-auto rounded-3xl border border-white/10 bg-black/25 p-3">
              <ServicePreviewPlayer channel={previewChannel} />
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-zinc-400">
                <p className="font-black text-white">Manual publishing</p>
                <p>Only channels with at least one catalog chip are published. Removing the final chip immediately unmaps the channel. Source sync never changes your mappings or positions.</p>
              </div>
            </aside>
          </div>
      </section>
    </div>
  );
}

/**
 * Page stepper for the server-paged source catalog. Nothing here fetches on its own: the panel keeps
 * one request per page so a 5,000-channel source is browsable without ever mounting the whole thing.
 */
function PanelPager({ page = 1, total = 0, pageSize = 0, hasMore = false, loading = false, onPrev, onNext }) {
  const lastPage = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : page;
  if (total <= pageSize && page <= 1 && !hasMore) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-300">
      <span className="text-zinc-500">
        page {page} / {lastPage} • {total ? `${Math.min(total, (page - 1) * pageSize + 1)}–${Math.min(total, page * pageSize)} of ${total}` : 'counting…'}
      </span>
      <span className="flex items-center gap-1.5">
        <button type="button" onClick={onPrev} disabled={loading || page <= 1} className="rounded-full border border-white/10 px-3 py-1 font-black transition hover:border-red-300/60 disabled:opacity-35">‹ Prev</button>
        <button type="button" onClick={onNext} disabled={loading || !hasMore} className="rounded-full border border-white/10 px-3 py-1 font-black transition hover:border-red-300/60 disabled:opacity-35">Next ›</button>
      </span>
    </div>
  );
}

/** Deliberately not "load everything": the button says how much is waiting so it is a choice, not a trap. */
function RowShowMore({ shown = 0, total = 0, onMore }) {
  const left = Math.max(0, total - shown);
  if (!left) return null;
  return (
    <button type="button" onClick={onMore} className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-red-300/60">
      Show {Math.min(left, ROW_STEP)} more · {left} still hidden
    </button>
  );
}

function ChannelManagerRow({
  channel,
  onPreview,
  onAction,
  onCatalogToggle,
  onPosition,
  selectedMode = false,
  positionCatalog = '',
  onUp,
  onDown,
}) {
  const catalogIds = getChannelCatalogIds(channel);
  const mapped = catalogIds.length > 0;
  const focusedPosition = positionCatalog ? getCatalogPosition(channel, positionCatalog) : null;

  return (
    <div className={`rounded-2xl border p-2.5 ${mapped ? 'border-green-400/20 bg-green-500/[0.045]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/5">{channel.logo ? <img src={channel.logo} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-zinc-500">TV</span>}</div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-black text-white">{channel.name}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${mapped ? 'bg-green-500/15 text-green-200' : 'bg-zinc-500/15 text-zinc-400'}`}>{mapped ? 'Mapped' : 'Unmapped'}</span>
          </div>
          <p className="truncate text-xs text-zinc-500">{channel.category} • {channel.source} • {channel.format?.toUpperCase()} • {channel.workingStatus}</p>
          {mapped ? <div className="mt-1 flex flex-wrap gap-1">{catalogIds.map((id) => <button key={id} type="button" onClick={() => onPosition?.(channel, id)} className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold text-red-100" title="Set exact position">{catalogLabel(id)} · {getCatalogPosition(channel, id)}</button>)}</div> : null}
        </div>
      </div>

      {onCatalogToggle ? <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {LIVE_CATALOGS.map((catalog) => {
          const active = catalogIds.includes(catalog.id);
          return <button key={catalog.id} type="button" onClick={() => onCatalogToggle(channel, catalog.id)} className={`rounded-xl border px-2 py-1.5 text-[10px] font-black transition ${active ? 'border-green-400/45 bg-green-500/20 text-green-100' : 'border-white/10 bg-black/20 text-zinc-400 hover:border-red-400/50 hover:text-white'}`}>{active ? '✓ ' : ''}{catalog.name}</button>;
        })}
      </div> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onPreview?.(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">Preview</button>
        {mapped ? <button type="button" onClick={() => onAction?.(channel, 'unmap')} className="rounded-full border border-orange-400/30 px-2.5 py-1 text-[11px] font-black text-orange-100">Unmap all</button> : null}
        <button type="button" onClick={() => onAction?.(channel, channel.favorite ? 'unfavorite' : 'favorite')} className="rounded-full border border-yellow-400/30 px-2.5 py-1 text-[11px] font-black text-yellow-100">{channel.favorite ? '★' : '☆'}</button>
        <button type="button" onClick={() => onAction?.(channel, channel.hidden ? 'unhide' : 'hide')} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">{channel.hidden ? 'Unhide' : 'Hide'}</button>
        {selectedMode && positionCatalog && focusedPosition < 999999 && (onUp || onDown) ? <>
          <button type="button" onClick={() => onUp?.(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">↑ Move</button>
          <button type="button" onClick={() => onDown?.(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">↓ Move</button>
        </> : null}
      </div>
    </div>
  );
}

