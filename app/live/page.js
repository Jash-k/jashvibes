'use client';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import SourceTabs from '@/components/live/v12/SourceTabs';
import ChannelGrid from '@/components/live/v12/ChannelGrid';
import VariantPicker from '@/components/live/v12/VariantPicker';
import LivePlayerV12 from '@/components/live/v12/LivePlayerV12';

export default function LiveV12Page(){
  const [logical, setLogical] = useState([]);
  const [counts, setCounts] = useState({});
  const [status,setStatus]=useState('loading');
  const [error,setError]=useState('');
  const [activeSource,setActiveSource]=useState('all');
  const [activeCatalog,setActiveCatalog]=useState('all');
  const [catalogs,setCatalogs]=useState([]);
  const [activeLogical,setActiveLogical]=useState(null);
  const [variantIdx,setVariantIdx]=useState(0);
  const [query,setQuery]=useState('');
  const [favs,setFavs]=useState([]);
  const FAV_KEY='jash_live_v12_favs';

  useEffect(()=>{ try{ setFavs(JSON.parse(localStorage.getItem(FAV_KEY)||'[]')); }catch{}},[]);
  const toggleFav=(id)=>{ setFavs(prev=>{ const n=prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]; try{localStorage.setItem(FAV_KEY, JSON.stringify(n));}catch{}; return n;})};

  const load=useCallback(async(source='all', catalog='all')=>{
    setStatus('loading'); setError('');
    try{
      // Always tamilOnly=1 for mainstream Tamil (user request) — keeps proxy counts accurate
      const params = new URLSearchParams({ tamilOnly:'1' });
      if(source!=='all') params.set('source', source);
      if(catalog && catalog!=='all') params.set('catalog', catalog);
      const res = await fetch(`/api/live/channels?${params.toString()}`,{cache:'no-store'});
      const data = await res.json();
      if(!res.ok) throw new Error(data?.error||'Failed to load');
      if (data.needSync) throw new Error(data.hint || 'No channels synced yet — open Admin → TV Service → Sync All Tamil');
      setCatalogs(Array.isArray(data.catalogs) ? data.catalogs : []);
      const groups = (data.logical||[]).filter(g=> g.variants?.some(v=> !!v.url));
      setLogical(groups);
      // counts: use totalVariants per source from server if provided, else derive
      // For All view, allLogical already includes every source variant, so per-source count is accurate
      // For filtered view, total groups === filtered count
      if (source === 'all') {
        const c = { all: groups.length };
        for(const g of groups){ for(const sid of (g.sourceIds||[])){ c[sid]=(c[sid]||0)+1; } }
        // Ensure all known sources appear even with 0
        for(const sid of ['jio-tamil','hjh-jio','jash-live','pocket-tamil','iptv-org-tamil']){ if(!(sid in c)) c[sid]=0; }
        setCounts(c);
      } else {
        // Keep existing counts when filtering, don't overwrite with filtered count
        setCounts(prev => ({ ...prev, [source]: groups.length }));
      }
      if(groups.length){
        // keep current active if still exists, else pick first
        setActiveLogical(prev=>{
          if(prev?.logicalId && groups.some(g=>g.logicalId===prev.logicalId)) return prev;
          return groups[0];
        });
      } else {
        setError(source==='all' ? 'No Tamil mainstream channels found — sync sources in Admin → TV Service' : `No channels for ${source} (sync it in Admin → TV Service)`);
      }
      setStatus('ready');
    }catch(e){ setError(e.message); setStatus('error'); }
  },[]);

  useEffect(()=>{ load(activeSource, activeCatalog); },[activeSource, activeCatalog, load]);

  const filtered = useMemo(()=>{
    if(!query) return logical;
    const q=query.toLowerCase();
    return logical.filter(g=> `${g.displayName} ${g.category}`.toLowerCase().includes(q));
  },[logical,query]);

  const favSet = useMemo(()=> new Set(favs),[favs]);
  const onPick=(g)=>{ setActiveLogical(g); setVariantIdx(0); window.scrollTo({top:0, behavior:'smooth'}); };

  const onErrorFallback=(logical, idx)=>{
    const next = idx+1;
    if(next < (logical.variants?.length||0)) setVariantIdx(next);
  };

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-black/80 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-[1600px] flex items-center justify-between gap-2">
          <Link href="/" className="font-black tracking-widest">JASH VIBES <span className="text-red-500">LIVE v12</span></Link>
          <Link href="/admin?tab=tv" className="rounded-full border border-white/10 px-3 py-1 text-xs">Admin ⚙</Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-4 grid grid-cols-12 gap-4">
        {/* Player */}
        <section className="col-span-12 lg:col-span-8">
          {activeLogical ? (
            <>
              <LivePlayerV12 logical={activeLogical} variantIdx={variantIdx} onErrorNeedingFallback={onErrorFallback} />
              <div className="mt-3 flex items-center justify-between">
                <h1 className="text-lg font-black">{activeLogical.displayName || activeLogical.baseName || 'Unknown Title'}</h1>
                <button onClick={()=>toggleFav(activeLogical.logicalId)} className={`rounded-full border px-3 py-1 text-xs ${favSet.has(activeLogical.logicalId)?'bg-yellow-500 text-black border-yellow-500':'border-white/10'}`}>{favSet.has(activeLogical.logicalId)?'★ Fav':'☆ Fav'}</button>
              </div>
              <p className="text-xs text-zinc-400">{activeLogical.category} • {activeLogical.variants.length} sources</p>
              <div className="mt-3">
                <VariantPicker logical={activeLogical} activeVariantIdx={variantIdx} onPickVariant={setVariantIdx} />
                <p className="text-[11px] text-zinc-500 mt-2">Auto ladder: HJH → Jio → Jash → Pocket → Tamil-IPTV. Player tries next on 451/403.</p>
              </div>
            </>
          ) : <div className="rounded-2xl border border-white/10 bg-zinc-950 p-10 text-center text-zinc-400">Pick a channel from the right →</div>}
        </section>

        {/* List */}
        <aside className="col-span-12 lg:col-span-4">
          {/* Catalog tabs — owner-curated order from Admin → TV → Channels */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
            <button type="button" onClick={()=>setActiveCatalog('all')}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${activeCatalog==='all'?'border-red-500 bg-red-600 text-white':'border-white/10 bg-white/[0.04] text-zinc-300'}`}>
              All <span className="rounded-full bg-white/10 px-1.5 text-[10px]">{counts.all||0}</span>
            </button>
            {catalogs.map(c=>(
              <button key={c.id} type="button" onClick={()=>setActiveCatalog(c.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black flex items-center gap-1 ${activeCatalog===c.id?'border-red-500 bg-red-600 text-white':'border-white/10 bg-white/[0.04] text-zinc-300'}`}>
                <span>{c.icon}</span>{c.name}<span className="rounded-full bg-white/10 px-1.5 text-[10px]">{c.count}</span>
              </button>
            ))}
          </div>
          <SourceTabs active={activeSource} counts={counts} onChange={setActiveSource} />
          <div className="mt-3 flex gap-2">
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Tamil channels..." className="flex-1 rounded-full border border-white/10 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-red-500" />
            <button onClick={()=>{ setFavs([]); try{localStorage.removeItem(FAV_KEY);}catch{} }} className="rounded-full border border-white/10 px-3 text-xs">Clear favs</button>
          </div>
          {status==='loading' ? <p className="p-6 text-zinc-400">Loading Tamil live…</p> : null}
          {error ? <p className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-red-200 text-sm">{error} <button onClick={()=>load(activeSource, activeCatalog)} className="underline ml-2">Retry</button></p> : null}
          {status==='ready' ? <div className="mt-3"><ChannelGrid logical={filtered} activeLogicalId={activeLogical?.logicalId} onPick={onPick} /></div> : null}
          <p className="text-[11px] text-zinc-600 mt-3">Deduplicated: {logical.length} logical channels from {counts.all||0} total. Sources: Jio JSON + HJH + Jash (triplet grouped) + Pocket + Tamil FTA. Build v12 — direct for Jio/HJH (geo), proxy only for Hotstar/Yupp.</p>
        </aside>
      </div>
    </main>
  );
}
