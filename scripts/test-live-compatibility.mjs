import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLiveSourceChannels, normalizeLivePlaylistUrl } from '../lib/liveTv.js';
import { normalizeLiveHeaders, parseLiveHeaderOptions } from '../lib/player/liveHeaders.js';
import { createLiveTvPolicy, buildClearKeys, buildLiveProxyUrl, buildLiveDrm, customLiveError } from '../lib/player/policy/liveTv.js';
import { RUNGS } from '../lib/player/recovery.js';
import { detectKind } from '../lib/player/kind.js';
let checks = 0;
const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
const ok = (v) => { assert(v); checks++; };
const kid = '00112233445566778899aabbccddeeff';
const key = 'ffeeddccbbaa99887766554433221100';
const second = '10112233445566778899aabbccddeeff';
const fixture = `#EXTM3U
#EXTINF:-1 tvg-id="custom-1" group-title="Tamil",Test Tamil
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=${kid}:${key}
#KODIPROP:inputstream.adaptive.manifest_headers=User-Agent=Fixture%2F1&Referer=https%3A%2F%2Fportal.example%2F&X-Test=a%26b%3Dc
#EXTHTTP:{"headers":{"Origin":"https://portal.example","Authorization":"Bearer fixture"}}
https://media.example/manifest?id=2|Cookie=session%3Dfixture&X-Encoded=a%26b
#EXTINF:-1 group-title="Tamil",Multi-key
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key={"keys":[{"kid":"${kid}","k":"${key}"},{"kid":"${second}","k":"${key}"}]}
https://media.example/multi
`;
const realFetch = globalThis.fetch;
let fetched = '';
globalThis.fetch = async (url) => { fetched = String(url); return new Response(fixture); };
const rows = await parseLiveSourceChannels({ id:'custom', type:'m3u', url:'https://github.com/owner/list/blob/main/tv.m3u' });
globalThis.fetch = realFetch;
eq(fetched, 'https://raw.githubusercontent.com/owner/list/main/tv.m3u');
eq(rows.length,2);
eq(rows[0].format,'dash'); eq(rows[0].userAgent,'Fixture/1');
eq(rows[0].cookie,'session=fixture'); eq(rows[0].headers['x-test'],'a&b=c');
eq(rows[0].headers['x-encoded'],'a&b'); eq(rows[0].headers.authorization,'Bearer fixture');
eq(buildClearKeys(rows[0]),{[kid]:key}); eq(Object.keys(buildClearKeys(rows[1])).length,2);
eq(normalizeLivePlaylistUrl('https://media.example/tv.m3u'),'https://media.example/tv.m3u');
eq(parseLiveHeaderOptions('Cookie=a%3Db%26c&Referer=https%3A%2F%2Fsite.example%2F'),{cookie:'a=b&c',referer:'https://site.example/'});
eq(normalizeLiveHeaders({Host:'evil','userAgent':'agent',Connection:'close',Bad:'\r\nx', nested:{}, 'X-Test':'value'}),{'user-agent':'agent','x-test':'value'});
eq(buildClearKeys({licenseKey:'{"clearKeys":{"'+kid+'":"'+key+'"}}'}),{[kid]:key});
eq(buildClearKeys({keyId:'bad',key:'bad'}),{});
eq(buildClearKeys({keyId:kid,key}),{[kid]:key});
for (const [type,system] of [['clearkey','org.w3.clearkey'],['widevine','com.widevine.alpha'],['playready','com.microsoft.playready'],['fairplay','com.apple.fps']]) eq(buildLiveDrm({licenseType:type,licenseKey:'https://license.example/'}),{servers:{[system]:'https://license.example/'}});
const origin = 'https://app.example';
const policy = createLiveTvPolicy(rows[0],{origin});
const source = await policy.resolve();
eq(source.kind,'dash'); eq(source.mimeType,'application/dash+xml'); eq(source.allowNativeHls,false);
ok(source.url.startsWith('/api/live-proxy?')); ok(!policy.ladder.includes(RUNGS.DROP_DRM));
eq(policy.playerConfig.streaming.bufferingGoal,20);
const types = { MANIFEST:0,SEGMENT:1,LICENSE:2,TIMING:7 };
const ctx = {shaka:{net:{NetworkingEngine:{RequestType:types}}}};
const wrapped = (type,uris,headers={}) => { const req={uris:[...uris],headers:{...headers}}; source.http.requestFilter(type,req,ctx); return req; };
const upstream = rows[0].url;
let req = wrapped(0,[source.url]); eq(req.uris,[source.url]);
req = wrapped(0,[upstream]); ok(req.uris[0].startsWith('/api/live-proxy?')); // MPD refresh
const tokenUrl = 'https://media.example/path/v.m4s?sig=a%26b&n=7';
req=wrapped(1,[tokenUrl,'https://cdn.example/path/v.m4s'],{'user-agent':'bad',REFERER:'bad',Authorization:'bad',Range:'bytes=0-99'});
eq(req.headers,{Range:'bytes=0-99'}); eq(new URL(req.uris[0],origin).searchParams.get('u'),tokenUrl);
let params=new URL(req.uris[0],origin).searchParams;
eq(params.get('ck'),'session=fixture'); eq(JSON.parse(params.get('hd')).authorization,'Bearer fixture');
params=new URL(req.uris[1],origin).searchParams; eq(params.get('ck'),null); ok(!JSON.parse(params.get('hd')).authorization);
for (const type of [types.LICENSE,types.TIMING]) {
 const p = new URL(wrapped(type,['https://license.example/timing']).uris[0],origin).searchParams;
 eq(p.get('ref'),null); eq(p.get('ck'),null); eq(p.get('hd'),null);
}
const response={uri:source.url,headers:{'x-jash-upstream-url':'https://final.example/channel/manifest.mpd'}};
source.http.responseFilter(0,response); eq(response.uri,'https://final.example/channel/manifest.mpd');
eq(new URL('video/$Number$.m4s',response.uri).href,'https://final.example/channel/video/$Number$.m4s');
req=wrapped(0,[response.uri]); ok(req.uris[0].startsWith('/api/live-proxy?'));
eq(wrapped(0,req.uris).uris,req.uris);
const generic = createLiveTvPolicy({url:'https://media.example/manifest.mpd',format:'dash'},{origin});
eq((await generic.resolve()).url,'https://media.example/manifest.mpd');
const headersOnly=createLiveTvPolicy({url:'https://media.example/manifest.mpd',headers:{'X-Token':'fixture'}},{origin}); ok((await headersOnly.resolve()).url.startsWith('/api/live-proxy'));
const plainHttp=createLiveTvPolicy({url:'http://media.example/manifest.mpd'},{origin}); ok((await plainHttp.resolve()).url.startsWith('/api/live-proxy'));
const remote=createLiveTvPolicy({...rows[0],streamProxy:'https://relay.example'},{origin});
await remote.recover(); ok((await remote.resolve()).url.startsWith('https://relay.example/'));
eq(customLiveError({code:6001},rows[0]).retriable,false); eq(customLiveError({code:1001},rows[0]),null);
// Preserve actual Jio policy outputs vs pre-patch fixture policy, not just intended values.
const jioCookie='__hdnea__=st=1600000000~exp=4000000000~acl=/bpk-tv/*~hmac=fixture';
const jio={sourceId:'jio-tamil',name:'Jio fixture',url:'https://jiotvpllive.cdn.jio.com/bpk-tv/test/manifest.mpd',cookie:jioCookie};
const jioPolicy=createLiveTvPolicy(jio,{origin,fetchImpl:async()=>new Response('{}')});
const jioSource=await jioPolicy.resolve();
eq(jioSource.kind,'auto'); eq(jioPolicy.playerConfig.streaming.bufferingGoal,10); eq(jioPolicy.playerConfig.streaming.rebufferingGoal,2);
eq(jioPolicy.playerConfig.streaming.lowLatencyMode,true); eq(jioPolicy.ladder,undefined); eq(jioPolicy.mapError,undefined);
const jioReq={uris:['https://jiotvpllive.cdn.jio.com/bpk-tv/test/s.m4s'],headers:{}};
jioSource.http.requestFilter(1,jioReq,ctx); ok(!jioReq.uris[0].includes('/api/live-proxy'));
if (process.env.LIVE_BASE_POLICY) {
 const old = await import(process.env.LIVE_BASE_POLICY);
 const oldPolicy=old.createLiveTvPolicy(jio,{origin,fetchImpl:async()=>new Response('{}')});
 const oldSource=await oldPolicy.resolve(); eq(jioPolicy.playerConfig,oldPolicy.playerConfig); eq(jioSource.url,oldSource.url);
 const oldReq={uris:['https://jiotvpllive.cdn.jio.com/bpk-tv/test/s.m4s'],headers:{}}; oldSource.http.requestFilter(1,oldReq,ctx); eq(jioReq,oldReq);
}
// Optional owner playlist inventory: keys stay private; never print rows.
for (const file of process.argv.slice(2)) {
 globalThis.fetch=async()=>new Response(fs.readFileSync(file,'utf8'));
 const channels=await parseLiveSourceChannels({id:'audit',url:'https://fixture.example/list.m3u',type:'m3u'});
 globalThis.fetch=realFetch;
 ok(channels.length>0); ok(channels.every(c=>c.format==='dash'&&c.userAgent&&c.referer&&Object.keys(buildClearKeys(c)).length));
 console.log(`PASS: ${channels.length} owner entries parsed; sensitive values not logged`);
}
console.log(`PASS: ${checks} custom Live mapping, headers, proxy, DRM, refresh and Jio regression checks`);
