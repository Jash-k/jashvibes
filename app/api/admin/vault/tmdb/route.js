import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { fetchTMDB } from '@/lib/tmdb';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(d,status=200)=>NextResponse.json(d,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request){
 try{
  const deny=await adminDeny(request);if(deny)return deny;
  const p=new URL(request.url).searchParams,type=p.get('type');
  if(!['movie','tv'].includes(type))return json({error:'Choose movie or TV.'},400);
  const id=p.get('id');
  if(id){
   if(!/^[1-9]\d{0,12}$/.test(id))return json({error:'Invalid TMDB ID.'},400);
   const d=await fetchTMDB(`/${type}/${id}`,{append_to_response:'external_ids,alternative_titles'});
   if(!d?.id)return json({error:'TMDB identity not found.'},404);
   return json({ok:true,metadata:{tmdbId:d.id,tmdbType:type,originalTitle:d.title||d.name,originalYear:Number((d.release_date||d.first_air_date||'').slice(0,4))||0,originalLanguage:d.original_language||'',imdbId:d.external_ids?.imdb_id||'',poster:d.poster_path?`https://image.tmdb.org/t/p/w500${d.poster_path}`:'',rating:Number(d.vote_average)||0},overview:d.overview||'',evidenceUrl:`https://www.themoviedb.org/${type}/${d.id}`});
  }
  const q=(p.get('q')||'').trim();if(!q||q.length>300)return json({error:'Enter a title up to 300 characters.'},400);
  const d=await fetchTMDB(`/search/${type}`,{query:q,include_adult:false,page:1});
  return json({ok:true,results:(d.results||[]).slice(0,20).map(m=>({id:m.id,type,title:m.title||m.name,originalTitle:m.original_title||m.original_name,year:(m.release_date||m.first_air_date||'').slice(0,4),language:m.original_language,overview:m.overview||''}))});
 }catch{return json({error:'TMDB lookup unavailable. Check server-side TMDB credentials and retry.'},503);}
}
