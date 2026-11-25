// Exact-identity iframe adapter. URL construction is not availability verification.
export function buildVidukiEmbed({tmdbId,imdbId,type,season=1,episode=1,mode=1}) {
  const id = /^[1-9]\d*$/.test(String(tmdbId||'')) ? String(tmdbId) : /^tt\d{5,12}$/i.test(String(imdbId||'')) ? String(imdbId).toLowerCase() : '';
  if(!id)return null;
  const tv=type==='series'||type==='tv';
  if(tv&&(!Number.isSafeInteger(Number(season))||Number(season)<1||!Number.isSafeInteger(Number(episode))||Number(episode)<1))return null;
  const api=[1,2,3,4].includes(Number(mode))?Number(mode):1;
  const url=`https://www.viduki.net/${api}/${tv?'tv':'movie'}/${id}${tv?`/${season}/${episode}`:''}?color=e01621`;
  return {id:'viduki',providerId:'viduki',provider:'Viduki',label:`Viduki${tv?` S${season} E${episode}`:''}`,streamUrl:url,streamType:'embed',externalId:`viduki:${tv?'tv':'movie'}:${id}:s${season}:e${episode}`};
}
export function trustedVidukiFailure(event, frameWindow, {id,type,season,episode}) {
  if(event.origin!=='https://www.viduki.net'||event.source!==frameWindow)return false;
  const d=event.data,m=d?.media;
  if(d?.type!=='viduki:all-servers-failed'||d.source!=='viduki-api-1'||d.status!==404||!['initial','manual-switch','playback-error'].includes(d.stage)||!m)return false;
  const tv=type==='series'||type==='tv';
  return String(m.tmdbid)===String(id)&&m.type===(tv?'tv':'movie')&&(!tv||(String(m.season)===String(season)&&String(m.episode)===String(episode)));
}
