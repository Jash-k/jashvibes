import { parseLiveSourceChannels } from '@/lib/liveTv';
import { JIO_PLUS_SOURCE } from '@/lib/live/jioPlusSource';
const identity = value => {try {const u=new URL(value);return `${u.hostname.toLowerCase()}${u.pathname}`;}catch{return '';}};
// Refresh from the configured playlist, not an unrelated global token pool.
// URLs/keys/cookies remain in memory and never enter diagnostic reports.
export function createJioPlusAccess({load=()=>parseLiveSourceChannels(JIO_PLUS_SOURCE,{includeAll:true}),now=()=>Date.now()}={}) {
 let rows=[],at=0,pending=null;
 return async function(channel,{force=false}={}){
  if(force || !at || now()-at>120_000){
   if(!pending)pending=Promise.resolve().then(load).then(value=>{if(!Array.isArray(value)||!value.length)throw Error('Empty JioTV+ playlist');rows=value;at=now();}).finally(()=>{pending=null;});
   await pending;
  }
  const key=identity(channel.url);
  // Match the exact rendition; never swap another regional version or SD/HD ID.
  const found=rows.find(r=>key&&identity(r.url)===key);
  if(!found)throw Error('Channel rendition absent from the current JioTV+ playlist');
  return {...channel,...found,id:channel.id,channelId:channel.channelId,sourceId:JIO_PLUS_SOURCE.id};
 };
}
export const refreshJioPlusChannel=createJioPlusAccess();
