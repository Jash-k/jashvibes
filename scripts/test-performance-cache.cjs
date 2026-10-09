const fs=require('node:fs'),assert=require('node:assert/strict');
const moduleURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
(async()=>{
 const episodesURL=moduleURL(fs.readFileSync('lib/vaultEpisodes.js','utf8'));
 const vault=await import(moduleURL(fs.readFileSync('lib/vault.js','utf8').replace("'./vaultEpisodes.js'",JSON.stringify(episodesURL))));
 const {summarizeVault,hasVaultQuality}=await import(moduleURL(fs.readFileSync('lib/vaultSummary.js','utf8')));
 const raw=process.env.VAULT_DATA_PATH
   ? JSON.parse(fs.readFileSync(process.env.VAULT_DATA_PATH,'utf8'))
   : [{id:'m',title:'Tamil Movie',year:2025,originalLanguage:'ta',category:'tamil-movie',embeds:[{url:'https://example.test/a',quality:'720p'},{url:'https://example.test/b',quality:'1080p'}]},
      {id:'s',title:'Tamil Series',kind:'series',year:2024,originalLanguage:'ta',category:'tamil-series',embeds:[{url:'https://example.test/ep',quality:'HD',season:2,episode:1}]},
      {id:'empty',title:'Unrated',embeds:[]}];
 const movies=raw.map(vault.normalizeVaultMovie).filter(m=>m.id&&m.title),facets=vault.buildVaultFacets(movies);
 const full={movies,facets,count:movies.length};const summary=summarizeVault(full);
 assert.deepEqual(summary.facets,full.facets);assert.equal(summary.movies.length,movies.length);
 for(let i=0;i<movies.length;i++){
  assert(!('embeds' in summary.movies[i]));assert(!('pageUrl' in summary.movies[i]));
  for(const q of ['1080p','720p','HD','360p'])assert.equal(hasVaultQuality(summary.movies[i],q),hasVaultQuality(movies[i],q));
  assert.equal(summary.movies[i].embedCount,movies[i].embeds.length);
 }
 const fullBytes=Buffer.byteLength(JSON.stringify(full)),leanBytes=Buffer.byteLength(JSON.stringify(summary));
 console.log(`PASS ${movies.length} Vault records: exact quality coverage/counts, no playback URLs in summaries; ${fullBytes} → ${leanBytes} bytes (${Math.round((1-leanBytes/fullBytes)*100)}% smaller uncompressed).`);
 const storage=new Map(),events={};global.window={sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),get length(){return storage.size},key:i=>[...storage.keys()][i],removeItem:k=>storage.delete(k)},addEventListener:(e,fn)=>events[e]=fn};
 const cache=await import(moduleURL(fs.readFileSync('lib/clientCache.js','utf8')));
 cache.writeSessionCache('jash:test',{n:1});assert.deepEqual(cache.readSessionCache('jash:test'),{n:1});assert.equal(storage.size,0);
 cache.writeSessionCache('jash:test',{n:2});events.pagehide();assert.equal(JSON.parse(storage.get('jash:test')).data.n,2);
 storage.set('expired',JSON.stringify({savedAt:Date.now()-10000,data:{n:3}}));assert.equal(cache.readSessionCache('expired',100),null);
 cache.clearSessionCaches();assert.equal(cache.readSessionCache('jash:test'),null);
 console.log('PASS memory-first restoration, coalesced persistence, pagehide flush, TTL and session invalidation.');
})().catch(e=>{console.error(e);process.exitCode=1});
