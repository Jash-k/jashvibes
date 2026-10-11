import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { loadVaultBase } from '@/lib/vault';
import { readVaultOverrides, mutateVault } from '@/lib/vaultAdminStore';
import { mergeVaultRows } from '@/lib/vaultAdminCore';
import { vaultCategory } from '@/lib/vaultBrowse';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(data,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request,mutation=false) {
  try {
    const deny=await adminDeny(request);if(deny)return deny;
    const url=new URL(request.url),base=await loadVaultBase({force:url.searchParams.get('force')==='1'});
    if(mutation){
      if(Number(request.headers.get('content-length'))>1_000_000)return json({error:'Request is too large.'},413);
      const raw=await request.text();if(raw.length>1_000_000)return json({error:'Request is too large.'},413);
      let body;try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
      const id=await mutateVault(base,body.action,body);return json({ok:true,id});
    }
    const overrides=await readVaultOverrides(),rows=mergeVaultRows(base,overrides,{includeHidden:true});
    const id=url.searchParams.get('id');
    if(id){const item=rows.find(m=>m.id===id);return item?json({ok:true,item,base:base.find(m=>m.id===id)||null,revision:item._vaultAdmin?.revision||0}):json({error:'Item not found.'},404);}
    const counts=rows.reduce((a,m)=>{const c=vaultCategory(m);a[c]=(a[c]||0)+1;if(m._vaultAdmin?.hidden)a.hidden++;if(m.metadataVerification?.status==='inferred')a.inferred++;return a;},{hidden:0,inferred:0});
    let filtered=rows;
    const q=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,300),category=url.searchParams.get('category'),state=url.searchParams.get('state')||'all';
    if(q)filtered=filtered.filter(m=>[m.title,m.id,m.originalTitle,m.tmdbTitle,m.imdbId,m.tmdbId,m.year].join(' ').toLowerCase().includes(q));
    if(category)filtered=filtered.filter(m=>vaultCategory(m)===category);
    if(state==='hidden')filtered=filtered.filter(m=>m._vaultAdmin?.hidden);
    if(state==='visible')filtered=filtered.filter(m=>!m._vaultAdmin?.hidden);
    if(state==='inferred')filtered=filtered.filter(m=>m.metadataVerification?.status==='inferred');
    if(state==='overridden')filtered=filtered.filter(m=>m._vaultAdmin);
    const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page')||'1',10)||1)),limit=40;
    const items=filtered.slice((page-1)*limit,page*limit).map(({embeds,seasons,...m})=>({...m,embedCount:embeds?.length||0,browseCategory:vaultCategory(m),revision:m._vaultAdmin?.revision||0}));
    return json({ok:true,items,total:filtered.length,page,pages:Math.ceil(filtered.length/limit),counts,baseCount:base.length,orphanOverrides:overrides.filter(o=>!o.custom&&!base.some(m=>m.id===o.id)).length});
  }catch(e){const status=[400,404,409,413].includes(e.status)?e.status:503;return json({ok:false,error:status===503?'Vault management is unavailable. Check database/upstream connectivity.':e.message},status);}
}
export const GET=request=>handle(request);
export const POST=request=>handle(request,true);
