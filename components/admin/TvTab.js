'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';

function HealthDot({ health }){
  const title = !health ? 'Not checked' : health.ok ? `HTTP ${health.status} in ${health.ms}ms` : (health.error||`HTTP ${health.status}`);
  const color = !health ? 'bg-zinc-600' : health.ok ? 'bg-green-400' : 'bg-red-500';
  return <span title={title} className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

export default function TvTabV12(){
  const [sources,setSources]=useState([]);
  const [healthMap,setHealthMap]=useState({});
  const [checking,setChecking]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [syncResult,setSyncResult]=useState(null);
  const [channels,setChannels]=useState([]);
  const [q,setQ]=useState('');
  const [sourceFilter,setSourceFilter]=useState('all');
  const [catFilter,setCatFilter]=useState('all');
  const [loadingCh,setLoadingCh]=useState(false);
  const [msg,setMsg]=useState('');
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({label:'', url:'', type:'m3u', priority:50});
  const [jioStatus,setJioStatus]=useState('');

  const api = useCallback(async(path, opts={})=>{
    const res = await fetch(path, { cache:'no-store', ...opts, headers:{'Content-Type':'application/json', ...(opts.headers||{})} });
    const data = await res.json().catch(()=>({}));
    if(!res.ok || data.ok===false) throw new Error(data.error||`HTTP ${res.status}`);
    return data;
  },[]);

  const loadSources = useCallback(async()=>{
    const data = await api('/api/live-service/sources');
    setSources(data.sources||[]);
  },[api]);
  const loadChannels = useCallback(async()=>{
    setLoadingCh(true);
    try{
      // Use new v12 deduplicated endpoint with tamilOnly=1 for admin preview too
      const p = new URLSearchParams();
      if(sourceFilter!=='all') p.set('source', sourceFilter);
      p.set('tamilOnly','1');
      const data = await api(`/api/live/channels?${p.toString()}`);
      setChannels(data.logical||[]);
    }catch(e){ setMsg(e.message); }
    finally{ setLoadingCh(false); }
  },[api, sourceFilter]);

  useEffect(()=>{ loadSources(); },[loadSources]);
  useEffect(()=>{ loadChannels(); },[loadChannels]);

  const checkHealth = async()=>{
    setChecking(true);
    try{
      const data = await api('/api/live-service/sources?health=1');
      const m={}; for(const s of data.sources||[]) m[s.sourceId]=s.health;
      setHealthMap(m);
      setSources(data.sources||[]);
      const down=(data.sources||[]).filter(s=> s.health && !s.health.ok);
      setMsg(down.length? `${down.length} source(s) down: ${down.map(s=>s.label).join(', ')}` : `All ${data.sources.length} sources answered`);
    }catch(e){ setMsg(e.message); } finally{ setChecking(false); }
  };

  const syncAll = async()=>{
    setSyncing(true); setSyncResult(null); setMsg('Syncing all sources — this can take 30s (HJH 520KB)...');
    try{
      const data = await api('/api/live-service/sync', { method:'POST', body: JSON.stringify({}) });
      setSyncResult(data.results||[]);
      setMsg(`Synced ${data.results?.length||0} source(s)`);
      await loadSources(); await loadChannels();
    }catch(e){ setMsg('Sync failed: '+e.message); }
    finally{ setSyncing(false); }
  };
  const syncOne = async(id)=>{
    setSyncing(true);
    try{
      const data = await api('/api/live-service/sync', { method:'POST', body: JSON.stringify({ sourceId:id }) });
      setMsg(`Synced ${id}: ${(data.results?.[0]?.added??0)} added`);
      await loadSources(); await loadChannels();
    }catch(e){ setMsg(e.message); }
    finally{ setSyncing(false); }
  };
  const addSource = async(e)=>{
    e.preventDefault();
    try{
      await api('/api/live-service/sources', { method:'POST', body: JSON.stringify(form) });
      setMsg(`Added ${form.label}`);
      setShowAdd(false); setForm({label:'',url:'',type:'m3u',priority:50});
      await loadSources();
    }catch(err){ setMsg(err.message); }
  };
  const deleteSource = async(s)=>{
    if(!confirm(`Delete source ${s.label} and its channels?`)) return;
    try{
      await api(`/api/live-service/sources?sourceId=${encodeURIComponent(s.sourceId)}&channels=1`, { method:'DELETE' });
      setMsg(`Deleted ${s.label}`);
      await loadSources(); await loadChannels();
    }catch(e){ setMsg(e.message); }
  };
  const checkJio = async()=>{
    try{
      setJioStatus('Checking Jio token...');
      const r = await fetch('/api/live-jio?force=1',{cache:'no-store'});
      const d=await r.json();
      if(!r.ok||!d.available) throw new Error(d.error||'No token');
      setJioStatus(`Jio token OK — expires ${d.expiresAtMs? new Date(d.expiresAtMs).toLocaleString(): 'unknown'}`);
    }catch(e){ setJioStatus('Jio token check failed: '+e.message); }
  };

  const filtered = useMemo(()=>{
    let list = channels;
    if(q){ const n=q.toLowerCase(); list=list.filter(g=> `${g.displayName} ${g.category}`.toLowerCase().includes(n)); }
    if(catFilter!=='all') list=list.filter(g=> String(g.category).toLowerCase()===catFilter);
    return list;
  },[channels, q, catFilter]);

  const categories = useMemo(()=> [...new Set(channels.map(c=> c.category).filter(Boolean))].sort(),[channels]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Live TV v12 — Tamil Mainstream</h2>
            <p className="text-xs text-zinc-400">5 sources (Jio · HJH Auto · Jash Live · Pocket · Tamil IPTV) · deduplicated → one card per channel · auto fallback HJH→Jio→Pocket</p>
          </div>
          <div className="flex gap-2">
            <button onClick={checkHealth} disabled={checking} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold">{checking?'Checking…':'Check health'}</button>
            <button onClick={syncAll} disabled={syncing} className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-black text-white disabled:opacity-50">{syncing?'Syncing…':'Sync All Tamil'}</button>
            <button onClick={()=>setShowAdd(v=>!v)} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold">+ Add source</button>
          </div>
        </div>
        {msg && <p className="mt-2 text-xs font-bold text-amber-200">{msg}</p>}
        {syncResult && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {syncResult.map(r=> (
              <span key={r.sourceId} className={`rounded-full px-2 py-1 ${r.ok?'bg-green-500/20 text-green-200':'bg-red-500/20 text-red-200'}`}>{r.sourceId}: {r.ok? `${r.added||0}+ ${r.removed||0}-` : r.error}</span>
            ))}
          </div>
        )}
      </div>

      {/* Add source modal */}
      {showAdd && (
        <form onSubmit={addSource} className="rounded-2xl border border-white/10 bg-zinc-950 p-4 space-y-3">
          <h3 className="font-bold text-sm">Add Live Source</h3>
          <input required value={form.label} onChange={e=>setForm({...form,label:e.target.value})} placeholder="Label e.g. My Tamil M3U" className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm" />
          <input required value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="https://... .m3u or .json" className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} className="rounded-xl border border-white/10 bg-black px-3 py-2 text-sm"><option value="m3u">m3u</option><option value="json">json</option></select>
            <input type="number" value={form.priority} onChange={e=>setForm({...form,priority:Number(e.target.value)})} className="w-24 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm" />
            <button type="submit" className="rounded-full bg-red-600 px-4 py-2 text-xs font-black text-white">Save source</button>
            <button type="button" onClick={()=>setShowAdd(false)} className="rounded-full border border-white/10 px-4 py-2 text-xs">Cancel</button>
          </div>
          <p className="text-xs text-zinc-500">Hint for HJH: Label HJH Tamil (Auto IPTV) URL https://hjh-545.pages.dev/ Type m3u Priority 1</p>
        </form>
      )}

      {/* Sources cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sources.map(s=>{
          const h = healthMap[s.sourceId] || s.health;
          return (
            <div key={s.sourceId} className="rounded-2xl border border-white/10 bg-zinc-900 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2"><HealthDot health={h} /><b className="text-sm">{s.label}</b><span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">{s.type}</span></div>
                  <p className="text-xs text-zinc-400 truncate max-w-[240px]">{s.url}</p>
                  <p className="text-xs text-zinc-500">p{s.priority} · {s.channelCount||0} ch{ s.mappedCount ? ` · ${s.mappedCount} mapped`:''}{ s.lastSyncedAt? ` · synced ${new Date(s.lastSyncedAt).toLocaleDateString()}`:''}</p>
                  {s.lastError && <p className="text-xs text-red-300">{s.lastError}</p>}
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${s.enabled!==false?'bg-green-500/20 text-green-200':'bg-zinc-700 text-zinc-300'}`}>{s.enabled!==false?'Enabled':'Disabled'}</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button onClick={()=>syncOne(s.sourceId)} disabled={syncing} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black disabled:opacity-40">Sync</button>
                <button onClick={async()=>{ try{ await fetch('/api/live-service/sources',{method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({sourceId:s.sourceId, enabled: s.enabled===false})}); loadSources(); }catch{}}} className="rounded-full border border-white/10 px-3 py-1 text-xs">{s.enabled!==false?'Disable':'Enable'}</button>
                <button onClick={()=>deleteSource(s)} className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-200">Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Jio token */}
      <div className="rounded-2xl border border-white/10 bg-zinc-950 p-3 flex flex-wrap items-center gap-3">
        <b className="text-sm">Jio Token</b>
        <button onClick={checkJio} className="rounded-full border border-white/10 px-3 py-1.5 text-xs">Check Jio token</button>
        {jioStatus && <span className="text-xs text-zinc-400">{jioStatus}</span>}
        <span className="text-xs text-zinc-500">Automatic via server JIO_COOKIE + /api/live-jio. Override via localStorage {typeof window!=='undefined' ? '' : ''}</span>
      </div>

      {/* Channels */}
      <div className="rounded-2xl border border-white/10 bg-zinc-950 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-black text-sm">Tamil Mainstream Channels — Deduplicated</h3>
          <span className="rounded-full bg-white/10 px-2 py-1 text-xs">{filtered.length} / {channels.length}</span>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search Sun TV, Vijay..." className="ml-auto min-w-[200px] rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs" />
          <select value={catFilter} onChange={e=>setCatFilter(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">All categories</option>
            {categories.map(c=> <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1.5 text-xs">
            <option value="all">All sources</option>
            <option value="jio-tamil">Jio Tamil</option>
            <option value="hjh-jio">HJH</option>
            <option value="jash-live">Jash Live</option>
            <option value="pocket-tamil">Pocket</option>
            <option value="tamil-iptv">Tamil IPTV</option>
          </select>
        </div>
        {loadingCh ? <p className="p-4 text-sm text-zinc-400">Loading Tamil channels…</p> : null}
        {!loadingCh && !filtered.length ? <p className="p-4 text-sm text-zinc-400">No Tamil channels found. Sync sources above, or check if all sources filtered out non-Tamil.</p> : null}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-[60vh] overflow-auto pr-1">
          {filtered.slice(0,200).map(g=>(
            <div key={g.logicalId} className="rounded-xl border border-white/10 bg-zinc-900 p-2">
              <div className="aspect-[16/9] bg-black rounded-lg flex items-center justify-center overflow-hidden">{g.logo ? <img src={g.logo} alt="" className="w-full h-full object-contain" loading="lazy"/> : '📺'}</div>
              <p className="text-xs font-bold truncate mt-1">{g.displayName}</p>
              <p className="text-[10px] text-zinc-500 truncate">{g.category} · {g.variantCount} src {g.variants?.map(v=>v.sourceId.slice(0,3)).join(',')}</p>
              <div className="mt-1 flex gap-1 flex-wrap">{g.variants?.slice(0,3).map(v=> <span key={v.channelId} className={`rounded-full px-1.5 py-0.5 text-[10px] ${!v.url?'bg-red-500/30 text-red-200':'bg-white/10 text-zinc-300'}`}>{v.sourceId.replace('jio-','').slice(0,6)} {v.format}{!v.url?' !URL':''}</span>)}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-2">Showing max 200. Use search to narrow. Each card = 1 logical channel (deduped from HJH/Jio/Jash triplets). Player will try variants in order HJH→Jio→Pocket.</p>
      </div>

      <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-3">
        <p className="text-xs font-bold text-green-200">How to make /live play everything (easy):</p>
        <ol className="list-decimal ml-4 text-xs text-zinc-300 space-y-1 mt-1">
          <li>Add HJH source if missing: <code className="bg-black/40 px-1">https://hjh-545.pages.dev/ — m3u — p1</code></li>
          <li>Click <b>Sync All Tamil</b> — wait 30s until 5 sources green</li>
          <li>Open <b>/live</b> — pick Tamil channel — player auto-fallbacks on 451 (no manual variant pick needed)</li>
          <li>If “No playable URL” persists for a title → Report dead (coming) — means all variants for that title have empty URL or expired token → re-sync that source</li>
        </ol>
      </div>
    </div>
  );
}
