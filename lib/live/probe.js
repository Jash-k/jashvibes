import { safeFetch, readLimitedText } from '@/lib/server/safeFetch';
import { resolutionHealth } from '@/lib/live/playback/resolveHealth';

// Bounded, SSRF-safe HTTPS HLS check. DASH/encrypted/custom-header streams
// require an owner browser test instead of a fabricated server success.
export async function probeLiveVariant(channel, { fetchImpl = safeFetch, now = Date.now() } = {}) {
  const started = Date.now();
  const result = (ok,code,extra={}) => ({ok,code,latencyMs:Date.now()-started,...extra});
  const ready = resolutionHealth(channel,now);
  if (!ready.ok) return result(false,ready.code);
  if (!String(channel.url || '').startsWith('https://')) return result(false,'HTTPS_REQUIRED');
  if (channel.cookie || channel.referer || Object.keys(channel.headers||{}).length || channel.forceProxy) return result(false,'BROWSER_REQUIRED');
  const signal = AbortSignal.timeout(9000);
  const get = url => fetchImpl(url,{signal,validateUrl:u=>u.protocol==='https:',headers:{Accept:'*/*'}});
  try {
    let url=channel.url, response, text;
    for (let hop=0;hop<3;hop++) {
      response=await get(url);
      if (!response.ok) { await response.body?.cancel(); return result(false,`HTTP_${response.status}`); }
      text=await readLimitedText(response,256*1024);
      if (!text.trimStart().startsWith('#EXTM3U')) return result(false,/<MPD[\s>]/i.test(text)?'BROWSER_REQUIRED':'NOT_HLS');
      if (/#EXT-X-KEY:(?!METHOD=NONE)/i.test(text)) return result(false,'BROWSER_REQUIRED');
      const lines=text.split(/\r?\n/).map(x=>x.trim());
      if (/#EXT-X-STREAM-INF/.test(text)) {
        const index=lines.findIndex(x=>x.startsWith('#EXT-X-STREAM-INF'));
        const child=lines.slice(index+1).find(x=>x&&!x.startsWith('#'));
        if(!child)return result(false,'EMPTY_MASTER');
        url=new URL(child,response.url||url).href;continue;
      }
      if(!/#EXTINF:/.test(text))return result(false,'EMPTY_MEDIA_PLAYLIST');
      const media=lines.filter(x=>x&&!x.startsWith('#')).at(-1);
      if(!media)return result(false,'NO_SEGMENT');
      const segment=await get(new URL(media,response.url||url).href);
      if(!segment.ok){await segment.body?.cancel();return result(false,`SEGMENT_HTTP_${segment.status}`);}
      const reader=segment.body?.getReader();if(!reader)return result(false,'EMPTY_SEGMENT');
      let sample=new Uint8Array();
      try { while(sample.length<1024){const r=await reader.read();if(r.done)break; const n=new Uint8Array(sample.length+r.value.length);n.set(sample);n.set(r.value,sample.length);sample=n;if(sample.length>65536)break;} }
      finally {await reader.cancel().catch(()=>{});}
      const head=new TextDecoder().decode(sample.slice(0,128));
      if(/<html|<!doctype|access denied/i.test(head))return result(false,'SEGMENT_NOT_MEDIA');
      const ts=sample[0]===0x47&&sample[188]===0x47;
      const box=new TextDecoder().decode(sample.slice(4,8));
      const mp4=['ftyp','styp','moof','sidx'].includes(box);
      if(!ts&&!mp4)return result(false,'UNRECOGNIZED_MEDIA');
      return result(true,'MEDIA_SAMPLE_OK',{manifest:true,mediaSample:true});
    }
    return result(false,'MANIFEST_DEPTH_LIMIT');
  } catch { return result(false,'PROBE_UNAVAILABLE'); }
}
