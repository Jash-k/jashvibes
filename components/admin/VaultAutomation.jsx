'use client';
import {useEffect,useRef,useState} from 'react';
import {clearSessionCaches} from '@/lib/clientCache';
async function api(options){const r=await fetch('/api/admin/vault/automation',{cache:'no-store',...options});const d=await r.json();if(!r.ok)throw Error(d.error||'Automation request failed.');return d;}
export default function VaultAutomation({onReload}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(''),[budgets,setBudgets]=useState({}),[cooldown,setCooldown]=useState(0);
 const mounted=useRef(false),seen=useRef(null),locked=useRef(false),loading=useRef(false),reloadCallback=useRef(onReload);reloadCallback.current=onReload;
 const mutate=body=>api({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const reload=async()=>{const r=await mutate({action:'reload'});clearSessionCaches();reloadCallback.current?.();if(mounted.current)setMessage(`Feed reloaded: ${r.count.toLocaleString()} records. Other server instances expire their normal cache.`);};
 const load=async()=>{
  if(loading.current)return;loading.current=true;
  try{const next=await api();if(!mounted.current)return;setData(next);setError('');
   const completed=(next.runs||[]).filter(r=>r.conclusion==='success');
   const fresh=seen.current&&completed.some(r=>!seen.current.has(r.id));if(!(fresh&&locked.current))seen.current=new Set(completed.map(r=>r.id));
   if(fresh&&!next.bundled&&!locked.current){locked.current=true;try{await reload();}catch(e){if(mounted.current)setError(`Run succeeded; automatic feed reload failed: ${e.message}`);}finally{locked.current=false;}}
  }catch(e){if(mounted.current)setError(e.message);}finally{loading.current=false;}
 };
 useEffect(()=>{mounted.current=true;void load();const t=setInterval(()=>{if(document.visibilityState==='visible')void load();},20000);return()=>{mounted.current=false;clearInterval(t);};},[]);
 useEffect(()=>{if(!cooldown)return;const t=setInterval(()=>setCooldown(n=>Math.max(0,n-1)),1000);return()=>clearInterval(t);},[cooldown>0]);
 const trigger=async workflow=>{
  if(locked.current)return;
  const minutes=Number(budgets[workflow.id]??workflow.minutes);
  if(!window.confirm(`${workflow.label}: request a GitHub run with a ${minutes}-minute crawl/metadata budget?${workflow.advanced?' Historical recovery also has a separate 10-minute metadata budget.':''} The workflow can commit/push catalogue data.`))return;
  locked.current=true;setBusy(workflow.id);setError('');setMessage('');
  try{const r=await mutate({action:'dispatch',workflow:workflow.id,minutes,confirm:workflow.advanced===true});setCooldown(120);setMessage(r.message);await load();}
  catch(e){setError(e.message);setCooldown(120);}finally{locked.current=false;setBusy('');}
 };
 const active=(data?.runs||[]).some(r=>r.active);
 const button=w=><div key={w.id} className="rounded-xl border border-white/10 p-3"><button type="button" disabled={!data?.configured||!!busy||active||cooldown>0} onClick={()=>trigger(w)} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold disabled:opacity-40">{busy===w.id?'Requesting…':w.label}</button><label className="ml-2 text-xs">Budget (min) <input aria-label={`${w.label} budget minutes`} type="number" min="1" max={w.max} value={budgets[w.id]??w.minutes} onChange={e=>setBudgets(b=>({...b,[w.id]:e.target.value}))} className="w-16 rounded border border-white/20 bg-black p-1"/></label></div>;
 return <section className="mb-5 space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4" aria-labelledby="vault-automation-heading">
  <h3 id="vault-automation-heading" className="text-lg font-bold">Vault Automation</h3>
  <p className="text-xs text-zinc-400">{data?`${data.repository} · ${data.branch}`:'Loading configuration…'} · Requests start GitHub Actions, not a scrape inside JaSH. Shared writer queues can delay execution.</p>
  {data?.warning?<p role="status" className="text-amber-300">{data.warning}</p>:null}
  {data?.bundled?<p role="alert" className="text-amber-300">Bundled snapshot mode: published workflow updates will NOT update this deployment. Set VAULT_USE_BUNDLED_SNAPSHOT=false and redeploy.</p>:null}
  <div className="grid gap-2 md:grid-cols-2">{data?.workflows?.filter(w=>!w.advanced).map(button)}</div>
  <details><summary>Advanced recovery</summary><div className="mt-2">{data?.workflows?.filter(w=>w.advanced).map(button)}</div></details>
  <div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy} onClick={()=>void load()} className="rounded border border-white/20 px-3 py-2 text-sm">Refresh run status</button><button type="button" disabled={!!busy||data?.bundled||!data} onClick={async()=>{if(locked.current)return;locked.current=true;setBusy('reload');setError('');try{await reload();}catch(e){setError(e.message);}finally{locked.current=false;setBusy('');}}} className="rounded border border-white/20 px-3 py-2 text-sm">Reload Vault Feed</button></div>
  {cooldown>0?<p className="text-xs text-zinc-400">Trigger cooldown: {cooldown}s</p>:null}
  {active?<p role="status">A Vault writer is queued/running. Wait before requesting another.</p>:null}
  {message?<p role="status" className="text-green-300">{message}</p>:null}{error?<p role="alert" className="text-red-300">{error}</p>:null}
  <p className="text-xs text-zinc-400">Recent runs include scheduled and other manual runs; GitHub’s dispatch acknowledgement is not a completion or an exact run-ID match. Status polls every 20 seconds while visible. Newly observed successful runs reload the feed on this serving process when live-feed mode is enabled.</p>
  <ul className="space-y-1 text-sm">{data?.runs?.slice(0,10).map(r=><li key={r.id} className="flex flex-wrap gap-2"><strong>{r.name}</strong><span>{r.status==='completed'?`Completed · ${r.conclusion||'unknown'}`:r.status.replaceAll('_',' ')}</span><span className="text-zinc-400">{r.event} · {new Date(r.createdAt).toLocaleString()}</span>{r.url?<a className="underline" href={r.url} target="_blank" rel="noopener noreferrer">View GitHub run ↗</a>:null}</li>)}</ul>
 </section>;
}
