const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
(async () => {
 const browser = await chromium.launch({args:['--no-sandbox']});
 try {
  for (const width of [1440, 1100, 950, 390, 320]) {
   const context = await browser.newContext({viewport:{width,height:844}});
   await context.addInitScript(() => localStorage.setItem('jash_theatre_access_token','fixture'));
   const page = await context.newPage(), errors=[];
   page.on('pageerror', e => errors.push(e.message));
   await page.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    return route.fulfill({json:p === '/api/auth' ? {success:true} : p === '/api/music/home' ? {sections:[],releases:{albums:[],tracks:[]}} : {items:[],channels:[]}});
   });
   await page.goto(base+'/music');
   await page.locator('.mc-app.is-library-open .mc-search').waitFor();
   const nav = page.locator(width >= 1024 ? '.jv-rail' : '.mobile-dock');
   assert(await nav.isVisible());
   assert.equal(await page.locator('.mc-rail, .mc-mobile-nav').count(),0);
   for (const label of ['Home','Live Tv','Music','ExTRaS','Vault','Stremio']) assert(await nav.getByRole('link',{name:label,exact:true}).isVisible(),label);
   assert.equal(await nav.getByRole('link',{name:'Music',exact:true}).getAttribute('aria-current'),'page');
   if(width>=1024) assert(await nav.getByRole('link',{name:'Admin',exact:true}).isVisible());
   const input = page.getByRole('searchbox');
   await input.fill('Test song');
   let style = await input.evaluate(el => ({bg:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).color}));
   assert.equal(style.bg,'rgba(0, 0, 0, 0)'); assert.equal(style.image,'none'); assert.equal(style.color,'rgb(25, 52, 66)');
   await page.getByRole('button',{name:'Clear search',exact:true}).click(); assert.equal(await input.inputValue(),'');
   const geometry = await page.evaluate(() => {
    const nav=document.querySelector(innerWidth>=1024?'.jv-rail':'.mobile-dock').getBoundingClientRect();
    const canvas=document.querySelector('.mc-canvas').getBoundingClientRect();
    const transport=document.querySelector('.mc-transport').getBoundingClientRect();
    return {navRight:nav.right,navTop:nav.top,canvasLeft:canvas.left,transportBottom:transport.bottom,scroll:document.documentElement.scrollWidth};
   });
   assert(geometry.scroll<=width);
   if(width>=1024) assert(geometry.canvasLeft>=geometry.navRight);
   else assert(geometry.transportBottom<=geometry.navTop,'dock must not cover transport');
   await page.locator('.mc-library').getByRole('button',{name:'Return to player',exact:true}).click();
   await page.locator('.mc-app.is-focus:not(.is-library-open)').waitFor();
   if(width<1024) assert.equal(await page.locator('.mc-lyrics-expand').isVisible(),false);
   await page.goBack(); await page.locator('.mc-app.is-library-open').waitFor();
   await page.locator('.mc-top-actions .mc-header-button').last().click();
   await page.getByRole('dialog').waitFor(); assert.equal(await nav.evaluate(el => Boolean(el.closest('[inert]'))),true);
   await page.keyboard.press('Escape'); assert.equal(await nav.evaluate(el => Boolean(el.closest('[inert]'))),false);
   if(process.env.MUSIC_SCREENSHOTS){ require('node:fs').mkdirSync(process.env.MUSIC_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.MUSIC_SCREENSHOTS+`/native-music-${width}.png`}); }
   assert.deepEqual(errors,[]); console.log(`PASS ${width}px: shared navigation, Library-first, continuous frosted search, safe layout, focus/history, modal inertness.`);
   await context.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
