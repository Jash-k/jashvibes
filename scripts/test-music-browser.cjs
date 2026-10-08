// Fixture-only layout and interaction checks. npm install --no-save @playwright/test; npx playwright install chromium
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true});
 const wav=Buffer.alloc(44+8000*2*20); wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 const audio='data:audio/wav;base64,'+wav.toString('base64');
 const album={id:'album1',title:'Ayan',type:'album',artists:'Harris Jayaraj'};
 const song={id:'song1',trackId:'song1',seokey:'song1',title:'Honey Honey',artists:'Devan Ekambaram',duration:20,type:'track',streamUrls:{'320kbps':audio,'160kbps':audio}};
 for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
 const page=await browser.newPage({viewport}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname; let data={};
  if(p==='/api/auth') data={authenticated:true,ok:true,success:true};
  else if(p==='/api/music/home') data={sections:[],artists:[],playlists:[],releases:{albums:[album],tracks:[song]}};
  else if(p==='/api/music/albums') data={items:Array.from({length:30},(_,i)=>({...album,id:'album'+i,title:'Album '+i}))};
  else if(p==='/api/music/new') data={albums:[album],tracks:[song]};
  else if(p==='/api/music/trending') data={items:[song]};
  else if(p==='/api/music/artists') data={items:[{id:'artist1',name:'Harris Jayaraj',type:'artist'}]};
  else if(p==='/api/music/playlists') data={items:[{id:'playlist1',title:'Tamil Mix',type:'playlist'}]};
  else if(p==='/api/music/album') data={item:{...album,songs:[song]}};
  else if(p==='/api/music/search') data={songs:[song],albums:[album],artists:[],playlists:[]};
  else if(p==='/api/music/lyrics') data={syncedLyrics:'[00:00.00]Hey honey honey\n[00:10.00]கண்ணில் honey',plainLyrics:'Hey honey honey\nகண்ணில் honey'};
  else if(p==='/api/music/song') data={item:{...song,streamUrls:{}}};
  await route.fulfill({json:data});
 });
 await page.addInitScript(() => localStorage.setItem('jash_theatre_access_token', 'fixture')); await page.goto('http://localhost:7860/music'); await page.waitForSelector('.mc-app');
 if(viewport.width<=900) await page.getByRole('button',{name:'Open Library',exact:true}).click();
 await page.waitForSelector('.mc-card');
 for(const name of ['New','Tracks','Albums','Artists','Playlists']) {await page.getByRole('tab',{name,exact:true}).click();await page.waitForTimeout(150); assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true');}
 await page.getByRole('tab',{name:'Albums',exact:true}).click();
 await page.getByRole('button',{name:'Open Album 0',exact:true}).click();
 await page.getByRole('button',{name:'Play all',exact:true}).waitFor();
 assert.equal(await page.locator('.mc-mini-info strong').textContent(),'Nothing playing');
 await page.getByRole('button',{name:'Play all',exact:true}).click();await page.waitForTimeout(1000);
 assert.equal(await page.locator('.mc-mini-info strong').textContent(),'Honey Honey');
 await page.getByRole('button',{name:'Back to Albums',exact:false}).click();
 await page.getByRole('tab',{name:'New',exact:true}).click();assert.equal(await page.locator('.mc-mini-info strong').textContent(),'Honey Honey');
 await page.locator('.mc-top-actions .mc-header-button').first().click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('.mc-sheet .mc-tracks li').count(),1);await page.keyboard.press('Escape');
 await page.locator('.mc-top-actions .mc-header-button').last().click(); await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 const geometry=await page.evaluate(()=>({body:document.documentElement.scrollHeight,height:innerHeight,width:document.documentElement.scrollWidth,inner:innerWidth,transport:document.querySelector('.mc-transport').getBoundingClientRect().bottom}));
 assert(geometry.body<=geometry.height+1,JSON.stringify(geometry));assert(geometry.width<=geometry.inner+1);assert(geometry.transport<=geometry.height+1);
 if(viewport.width<=900) await page.getByRole('button',{name:'Return to player',exact:true}).first().click();
 await page.getByRole('button',{name:'Expand lyrics',exact:true}).click(); await page.waitForTimeout(200);assert(await page.locator('.mc-lyric-lines li').count()>0);
 await page.getByRole('button',{name:'Exit lyrics focus',exact:true}).click();
 assert.deepEqual(errors,[]);console.log('PASS',viewport,geometry);if(process.env.MUSIC_SCREENSHOTS) { require('node:fs').mkdirSync(process.env.MUSIC_SCREENSHOTS,{recursive:true}); await page.screenshot({path:`${process.env.MUSIC_SCREENSHOTS}/music-${viewport.width}.png`}); }await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
