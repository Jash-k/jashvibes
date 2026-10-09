// Fixture-only continuity check; the audio is an in-memory silent WAV, not provider media.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const wav = Buffer.alloc(44 + 8000 * 2 * 60);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const audio = base + '/fixture-tone.wav';
  const song = { id:'song1', trackId:'song1', seokey:'song1', title:'Pookara', artists:'Fixture artist', duration:60, type:'track', streamUrls:{ '320kbps':audio } };
  const album = { id:'album1', title:'Fixture album', type:'album', artists:'Fixture artist' };
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport:{ width, height:900 } });
      await context.addInitScript(() => localStorage.setItem('jash_theatre_access_token', 'fixture'));
      const page = await context.newPage(), errors = []; let lyricCalls = 0;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/fixture-tone.wav', route => route.fulfill({ contentType:'audio/wav', body:wav }));
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data = { ok:true, movies:[], series:[], channels:[] };
        if (path === '/api/auth') data = { ok:true, success:true };
        if (path === '/api/music/home') data = { sections:[], releases:{ albums:[album], tracks:[song] } };
        if (path === '/api/music/albums') data = { items:[album] };
        if (path === '/api/music/album') data = { item:{ ...album, songs:[{ ...song, streamUrls:undefined, spotify:{ title:"Pookara", album:"Citizen", artists:["Fixture artist"] } }] } };
        if (path === '/api/music/song') { await new Promise(r => setTimeout(r, 800)); data = { item:{ ...song, album:'Citizen' } }; }
        if (path === '/api/music/lyrics') { lyricCalls++; await new Promise(r => setTimeout(r, 500)); if (lyricCalls === 1) return route.fulfill({status:503,json:{source:'error',retryable:true,retryAfter:1}}); data = { matchVersion:3, syncedLyrics:'[00:00.00]Fixture line', plainLyrics:'Fixture line' }; }
        await route.fulfill({ json:data });
      });
      await page.goto(base + '/music');
      await page.getByRole('button', { name:'Open Fixture album', exact:true }).click();
      await page.getByRole('button', { name:'Play all', exact:true }).click();
      await page.locator('.mc-lyrics').getByText('Finding lyrics…').waitFor();
      assert.equal(lyricCalls, 0);
      await page.evaluate(() => { window.badLyricsStates = []; const el = document.querySelector('.mc-lyrics'); new MutationObserver(() => { if (/No lyrics found|Lyrics temporarily unavailable/.test(el.textContent)) window.badLyricsStates.push(el.textContent); }).observe(el, {subtree:true, childList:true, characterData:true}); });
      await page.locator('.mc-lyrics').getByRole('button', {name:'Seek to Fixture line'}).waitFor();
      assert.equal(lyricCalls, 2); assert.deepEqual(await page.evaluate(() => window.badLyricsStates), []);
      await page.waitForFunction(() => {
        const audio = document.querySelector('audio');
        return audio && !audio.paused && audio.currentTime > 0.1;
      });
      await page.evaluate(() => { window.originalAudio = document.querySelector('audio'); window.audioAt = originalAudio.currentTime; });
      const nav = page.locator(width > 900 ? '.mc-rail nav' : '.mc-mobile-nav');
      await nav.getByRole('link', { name:'Home', exact:true }).click();
      await page.waitForURL(base + '/');
      await page.waitForFunction(() => document.querySelector('audio') === window.originalAudio && !originalAudio.paused && originalAudio.currentTime > window.audioAt);
      const main = page.locator(width > 1000 ? '.jv-rail' : '.mobile-dock');
      await main.getByRole('link', { name:'Music', exact:true }).click();
      await page.locator('.mc-library').waitFor();
      assert(await page.evaluate(() => document.querySelector('audio') === window.originalAudio && !originalAudio.paused));
      assert.deepEqual(errors, []); assert.equal(lyricCalls, 2, "panel remount must not fetch again");
      console.log(`PASS ${width}px: delayed detail + transient recovery without false unavailable, one automatic owner, no remount refetch, continuous audio.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
