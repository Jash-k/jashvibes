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
  const [activeLogical,setActiveLogical]=useState(null);
  const [variantIdx,setVariantIdx]=useState(0);
  const [query,setQuery]=useState('');
  const [favs,setFavs]=useState([]);
  const FAV_KEY='jash_live_v12_favs';

  useEffect(()=>{ try{ setFavs(JSON.parse(localStorage.getItem(FAV_KEY)||'[]')); }catch{}},[]);
  const toggleFav=(id)=>{ setFavs(prev=>{ const n=prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]; try{localStorage.setItem(FAV_KEY, JSON.stringify(n));}catch{}; return n;})};

  const load=useCallback(async(source='all')=>{
    setStatus('loading'); setError('');
    try{
      const url = source==='all' ? '/api/live/channels?tamilOnly=0' : `/api/live/channels?source=${encodeURIComponent(source)}`;
      const res = await fetch(url,{cache:'no-store'});
      const data = await res.json();
      if(!res.ok) throw new Error(data?.error||'Failed to load');
      const groups = data.logical||[];
      setLogical(groups);
      // counts per source
      const c = { all: groups.length };
      for(const g of groups){ for(const sid of (g.sourceIds||[])){ c[sid]=(c[sid]||0)+1; } }
      setCounts(c);
      if(groups.length && !activeLogical) setActiveLogical(groups[0]);
      setStatus('ready');
    }catch(e){ setError(e.message); setStatus('error'); }
  },[]);

  useEffect(()=>{ load(activeSource); },[activeSource]);

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
                <h1 className="text-lg font-black">{activeLogical.displayName}</h1>
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
          <SourceTabs active={activeSource} counts={counts} onChange={setActiveSource} />
          <div className="mt-3 flex gap-2">
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Tamil channels..." className="flex-1 rounded-full border border-white/10 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-red-500" />
            <button onClick={()=>{ setFavs([]); try{localStorage.removeItem(FAV_KEY);}catch{} }} className="rounded-full border border-white/10 px-3 text-xs">Clear favs</button>
          </div>
          {status==='loading' ? <p className="p-6 text-zinc-400">Loading Tamil live…</p> : null}
          {error ? <p className="p-4 rounded-xl bg-red-950/30 border border-red-500/30 text-red-200 text-sm">{error} <button onClick={()=>load(activeSource)} className="underline ml-2">Retry</button></p> : null}
          {status==='ready' ? <div className="mt-3"><ChannelGrid logical={filtered} activeLogicalId={activeLogical?.logicalId} onPick={onPick} /></div> : null}
          <p className="text-[11px] text-zinc-600 mt-3">Deduplicated: {logical.length} logical channels from {counts.all||0} total. Sources: Jio JSON + HJH + Jash (triplet grouped) + Pocket + Tamil IPTV. Build v12 — direct for Jio/HJH (geo), proxy only for Hotstar/Yupp.</p>
        </aside>
      </div>
    </main>
  );
}
