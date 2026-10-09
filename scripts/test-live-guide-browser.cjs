/* Optional browser regression test: all guide and stream traffic is intercepted.
 * Run a local build with PASS=local-guide-test, LIVE_SYNC_MINUTES=0, KEEPALIVE=0.
 * PLAYWRIGHT_PATH may point to an isolated playwright installation. No production DB.
 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
(async () => {
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  for (const width of [1440,390]) {
   const ctx=await browser.newContext({viewport:{width,height:900}});
   const auth=await ctx.request.post(base+'/api/auth',{data:{password:'local-guide-test'}});
   assert.equal(auth.status(),200);const {token}=await auth.json();
   await ctx.addInitScript(token=>{
    localStorage.setItem('jash_theatre_access_token',token);
    const rawFetch=window.fetch;window.guideCalls=[];
    window.fetch=(url,options={})=>{
     if(String(url).startsWith('/api/live-epg/guide')){
      const u=new URL(url,location.origin), entry={ids:JSON.parse(u.searchParams.get('c')||'[]').map(r=>r[0]),day:u.searchParams.get('day'),method:options.method||'GET',aborted:false};
      window.guideCalls.push(entry);options.signal?.addEventListener('abort',()=>{entry.aborted=true;});
     }
     return rawFetch(url,options);
    };
    const start=window.setInterval.bind(window),stop=window.clearInterval.bind(window);window.guideTimers=new Map();
    window.setInterval=(fn,ms,...args)=>{const id=start(fn,ms,...args);if(ms===60000)window.guideTimers.set(id,fn);return id;};
    window.clearInterval=id=>{window.guideTimers.delete(id);return stop(id);};
   },token);
   const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   const channels=['a','b','c','d'].map(id=>({id,name:`Channel ${id.toUpperCase()}`,source:'Fixture',url:`https://guide-fixture.example/${id}.mp4`,playable:true,format:'mp4',catalogs:[]}));
   let releaseLineup,releaseB,delayB=true,failD=false;
   await p.route('**/api/live-tv?*',async r=>{await new Promise(resolve=>{releaseLineup=resolve});await r.fulfill({json:{channels}});});
   await p.route('**/api/tamilmv*',r=>r.fulfill({json:{movies:[],series:[]}}));
   await p.route('https://guide-fixture.example/**',r=>r.fulfill({status:200,contentType:'video/mp4',body:Buffer.alloc(0)}));
   await p.route('**/api/live-epg/guide*',async r=>{
    const u=new URL(r.request().url());const rows=JSON.parse(u.searchParams.get('c')||'[]');
    if(rows[0]?.[0]==='b'&&delayB)await new Promise(resolve=>{releaseB=resolve});
    if(rows[0]?.[0]==='d'&&failD)return r.fulfill({status:503,json:{ok:false,error:'Fixture guide unavailable'}});
    const at=Date.now();const data=rows.map(([id,name])=>({id,name,matched:true,now:{title:`Programme ${id.toUpperCase()}`,from:at-60000,to:at+60000},day:[]}));
    // A rogue extra response row must not re-introduce inactive guide titles.
    data.push({id:'unsolicited',matched:true,now:{title:'Unrequested show',from:at,to:at+60000}});
    await r.fulfill({json:{ok:true,at,status:{ageMs:0,feedChannels:1190},channels:data}}).catch(()=>{});
   });
   await p.goto(base+'/live');await p.waitForFunction(()=>Array.isArray(window.guideCalls));
   assert.equal(await p.evaluate(()=>guideCalls.length),0,'no requests without selection');
   while(!releaseLineup)await new Promise(r=>setTimeout(r,20));releaseLineup();
   await p.waitForFunction(()=>document.body.innerText.includes('Programme A'));
   let calls=await p.evaluate(()=>guideCalls);assert.deepEqual(calls.map(x=>x.ids),[['a']]);assert.equal(calls[0].day,'a');
   assert.equal(await p.locator('.jv-lv-tile:not(.is-active) .jv-lv-tile-epg').count(),0);
   assert(!((await p.locator('body').innerText()).includes('1190 channels')));
   const search=p.getByPlaceholder('Search mapped channels');await search.fill('Channel B');await p.waitForTimeout(150);assert.equal((await p.evaluate(()=>guideCalls)).length,1,'search must not load other guides');await search.fill('');
   await p.getByRole('button',{name:'Watch Channel B',exact:true}).click();await p.waitForFunction(()=>guideCalls.some(c=>c.ids[0]==='b'));
   assert(!((await p.locator('body').innerText()).includes('Programme A')),'old guide cleared immediately');
   await p.getByRole('button',{name:'Watch Channel C',exact:true}).click();await p.waitForFunction(()=>document.body.innerText.includes('Programme C'));
   await p.waitForFunction(()=>guideCalls.find(c=>c.ids[0]==='b')?.aborted);
   delayB=false;releaseB?.();await p.waitForTimeout(150);assert(!((await p.locator('body').innerText()).includes('Programme B')),'late response ignored');
   let n=(await p.evaluate(()=>guideCalls)).length;
   await p.getByRole('button',{name:'Refresh guide',exact:true}).click();await p.waitForFunction(n=>guideCalls.length>n,n);
   calls=await p.evaluate(()=>guideCalls);assert.equal(calls.at(-1).method,'GET');assert.deepEqual(calls.at(-1).ids,['c']);
   n=calls.length;await p.evaluate(()=>{for(const cb of guideTimers.values())cb();});await p.waitForFunction(n=>guideCalls.length>n,n);assert.deepEqual((await p.evaluate(()=>guideCalls)).at(-1).ids,['c']);
   await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
   assert.equal(await p.evaluate(()=>guideTimers.size),0,'hidden tab stops polling');n=(await p.evaluate(()=>guideCalls)).length;
   await p.evaluate(()=>{for(const cb of guideTimers.values())cb();});assert.equal((await p.evaluate(()=>guideCalls)).length,n);
   await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});await p.waitForFunction(n=>guideCalls.length>n,n);
   failD=true;await p.getByRole('button',{name:'Watch Channel D',exact:true}).click();await p.waitForFunction(()=>document.body.innerText.includes('Fixture guide unavailable'));assert(!((await p.locator('body').innerText()).includes('Guide loading…')));
   await p.getByRole('button',{name:'Watch Channel A',exact:true}).click();await p.waitForFunction(()=>document.body.innerText.includes('Programme A'));
   // Return and prev/next also change the active guide, not the full lineup.
   if(width<600)await p.getByRole('button',{name:/Actions · return/}).click();
   await p.getByRole('button',{name:'Nxt ›',exact:true}).click();await p.waitForFunction(()=>document.body.innerText.includes('Programme B'));
   await p.getByRole('button',{name:'↩ Return',exact:true}).click();await p.waitForFunction(()=>document.body.innerText.includes('Programme A'));
   calls=await p.evaluate(()=>guideCalls);assert(calls.every(c=>c.ids.length===1&&c.day===c.ids[0]&&c.method==='GET'));
   assert.equal(await p.locator('.jv-lv-tile:not(.is-active) .jv-lv-tile-epg').count(),0);
   // No active channel after navigating away: timer and request cleanup.
   await p.locator('a[href="/"]:visible').first().click();await p.waitForURL(base+'/');assert.equal(await p.evaluate(()=>guideTimers.size),0);
   assert.deepEqual(errors,[]);console.log(`PASS ${width}px: one active channel only, no idle/card fetch, search, cancellation, stale response, refresh, polling/visibility, failure, prev/next/return and unmount.`);
   await ctx.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
