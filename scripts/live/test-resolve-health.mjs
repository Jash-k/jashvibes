import assert from 'node:assert/strict';
import { resolutionHealth, canAdvanceVariant } from '../../lib/live/playback/resolveHealth.js';
import { resolveHjhWorkerUrl } from '../../lib/liveTv.js';
const now = Date.now();
const token = exp => `__hdnea__=st=1700000000~exp=${Math.floor(exp/1000)}~acl=/*~hmac=abcdef0123456789`;
const url='https://jiotvmblive.cdn.jio.com/bpk-tv/test/index.mpd';
assert.equal(resolutionHealth({url},now).code,'AUTH_UNAVAILABLE');
assert.equal(resolutionHealth({url,cookie:token(now-1000)},now).code,'AUTH_EXPIRED');
assert.equal(resolutionHealth({url,cookie:token(now+10000)},now).ok,false);
assert.equal(resolutionHealth({url,cookie:token(now+300000)},now).ok,true);
assert.equal(resolutionHealth({url:url+'?'+token(now+300000)},now).ok,true);
assert.equal(resolutionHealth({url:'https://example.org/live.m3u8',sourceId:'jio-public'},now).ok,true);
assert.equal(canAdvanceVariant(0,2),true);assert.equal(canAdvanceVariant(1,2),false);
const original=globalThis.fetch;
try {
 for(const status of [404,410,500]) {
  globalThis.fetch=async()=>new Response('',{status});
  await assert.rejects(resolveHjhWorkerUrl('https://hjh-545.pages.dev/stream?id=test'),/HTTP/);
 }
 globalThis.fetch=async()=>new Response('<html>Unavailable</html>',{status:200,headers:{'content-type':'text/html'}});
 await assert.rejects(resolveHjhWorkerUrl('https://hjh-545.pages.dev/stream?id=test'),/HTML/);
 globalThis.fetch=async()=>new Response(null,{status:302});
 await assert.rejects(resolveHjhWorkerUrl('https://hjh-545.pages.dev/stream?id=test'),/location/);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://hjh-545.pages.dev/loop'}});
 await assert.rejects(resolveHjhWorkerUrl('https://hjh-545.pages.dev/stream?id=test'),/limit/);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:url+'?'+token(now+300000)}});
 assert.match(await resolveHjhWorkerUrl('https://hjh-545.pages.dev/stream?id=test'),/^https:\/\/jiotvmblive/);
} finally {globalThis.fetch=original;}
console.log('PASS resolver readiness: missing/expired authorization, public streams, Worker failures, signed redirects and finite fallback');
// Guard the wrapper integration, not just the pure authorization predicate.
const fs = await import('node:fs');
const player = fs.readFileSync(new URL('../../components/live/Player.jsx', import.meta.url),'utf8');
assert.match(player,/!res.ok \|\| data\?\.ok !== true/);
assert.match(player,/onFatal:/);
assert.match(player,/canAdvanceVariant\(variantIdx/);
const route = fs.readFileSync(new URL('../../app/api/live/resolve/route.js', import.meta.url),'utf8');
assert.match(route,/status:503/);
assert.match(route,/appendJioCookieToUrl\(channel.url, channel.cookie\)/);
assert.doesNotMatch(route,/fall through with the worker URL/);
