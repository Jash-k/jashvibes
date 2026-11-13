// Optional Playwright fixture test. Start a LOCAL built server with PASS=local-validation-only.
// Does not test real Jio playback or contact production.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const ctx=await browser.newContext({viewport});
  const r=await ctx.request.post('http://localhost:7860/api/auth',{data:{password:'local-validation-only'}});const auth=await r.json();
  assert.ok(auth.token,'Local authentication must succeed');
  await ctx.addCookies([{name:'jash_access',value:auth.token,domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax',secure:false}]);
  await ctx.addInitScript(token => localStorage.setItem('jash_theatre_access_token', token), auth.token);
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const sources=[{id:'a',label:'My Jio Source'},{id:'b',label:'My FTA Source'},{id:'empty',label:'New Empty Source'}];
  const groups=['BBC','Sony Vizha','Sun TV','Star Vijay'].map((displayName,i)=>({logicalId:`g${i}`,displayName,sourceIds:['a','b'],variants:['a','b'].map(sourceId=>({channelId:`${i}-${sourceId}`,sourceId,name:displayName,language:i===0?'en':'ta',url:'https://example.org/test.mpd',catalogIds:['main']}))}));
  await page.route('**/api/live/channels*',route=>route.fulfill({json:{ok:true,sources,logical:groups,catalogs:[{id:'main',name:'Main'}]}}));
  const resolved=[];
  await page.route('**/api/live/resolve?*',route=>{resolved.push(new URL(route.request().url()).searchParams.get('channelId'));return route.fulfill({status:404,json:{error:'Fixture: media playback intentionally not tested'}})});
  await page.goto('http://localhost:7860/live');
  const select=page.getByRole('combobox',{name:'Live TV source'});await select.waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('[data-ch-card]').length===8);
  assert.equal(await select.locator('option').count(),4);
  assert.equal(await page.locator('[data-ch-card] p').first().textContent(),'Star Vijay');
  await select.selectOption('b');
  await page.waitForFunction(()=>document.querySelectorAll('[data-ch-card]').length===4);
  assert.equal(await page.locator('[data-ch-card] p').nth(1).textContent(),'My FTA Source');
  await page.waitForFunction(()=>document.body.innerText.includes('Fixture: media playback intentionally not tested'));
  assert.ok(resolved.at(-1).endsWith('-b'));
  if (process.env.LIVE_TEST_ARTIFACTS) {
    require('node:fs').mkdirSync(process.env.LIVE_TEST_ARTIFACTS, {recursive:true});
    await page.screenshot({path:require('node:path').join(process.env.LIVE_TEST_ARTIFACTS, `live-source-${viewport.width}.png`),fullPage:true});
  }
  await select.selectOption('empty');
  await page.getByText('No channels match this view.').waitFor();
  assert.equal(await page.locator('[data-ch-card]').count(),0);
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No horizontal overflow');
  console.log('PASS browser fixture',viewport.width,'source options, Tamil order, source-isolated resolve, empty source, no runtime errors/overflow');await ctx.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
