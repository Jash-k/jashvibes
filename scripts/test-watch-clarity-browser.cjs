// Fixture-only: Stremio card → unified watch. Synthetic silent WAV, no provider/DB writes.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const wav = Buffer.alloc(44 + 8000 * 2 * 60);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const auth = await context.request.post(base + '/api/auth', { data: { password: 'local-guide-test' } });
      assert.equal(auth.status(), 200); const { token } = await auth.json();
      await context.addInitScript(token => {
        localStorage.setItem('jash_theatre_access_token', token);
        localStorage.setItem('jash:player:v1', JSON.stringify({ ambient: true, volume: 1 }));
      }, token);
      const page = await context.newPage(), errors = []; let embed = false;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/fixture-watch.mp4', route => route.fulfill({ contentType: 'audio/wav', body: wav }));
      await page.route('**/fixture-embed', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Fixture embed</body></html>' }));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/auth') return route.continue();
        let data = { ok: true, items: [], movies: [], series: [], channels: [] };
        if (url.pathname === '/api/stremio/manifest') data = { ok: true, manifestUrl: 'https://fixture.example/manifest.json', manifest: { name: 'Fixture addon', catalogs: [{ type: 'movie', id: 'tamil', name: 'Tamil' }] } };
        if (url.pathname === '/api/stremio/pins') data = { ok: true, configured: true, pins: ['movie:tamil'] };
        if (url.pathname === '/api/stremio/catalog') data = { items: [{ id: 'tt1234567', title: 'Watch clarity fixture', type: 'movie' }], hasMore: false };
        if (url.pathname === '/api/stremio/meta') data = { item: { title: 'Watch clarity fixture' } };
        if (url.pathname === '/api/vault/match') data = { hit: null };
        if (url.pathname === '/api/watch/source') data = { candidates: [{ url: base + (embed ? '/fixture-embed' : '/fixture-watch.mp4'), kind: embed ? 'embed' : 'video', quality: 'Fixture', provider: 'stremio' }] };
        await route.fulfill({ json: data });
      });
      for (embed of [false, true]) {
        await page.goto(base + '/stremio');
        await page.locator('.jv-st-card').first().click();
        await page.waitForURL('**/watch/stremio-movie/**');
        await page.getByRole('heading', { name: 'Watch clarity fixture', exact: true }).waitFor();
        if (!embed) {
          await page.waitForFunction(() => { const video = document.querySelector('video'); return video && !video.paused && video.currentTime > 0.1; });
          // Allow the playing event to activate any saved ambient preference.
          await page.waitForTimeout(250);
        } else await page.locator('iframe').waitFor();
        const state = await page.evaluate(() => ({
          ambient: document.querySelector('[data-dvp="ambient"]')?.className || '',
          theater: document.documentElement.classList.contains('jv-theater'),
          mainFilter: getComputedStyle(document.querySelector('main')).filter,
          savedAmbient: JSON.parse(localStorage.getItem('jash:player:v1')).ambient,
        }));
        console.log(`${width}px ${embed ? 'embed' : 'native'} clarity`, state);
        assert.equal(state.ambient, '', 'watch page must not acquire a viewport-wide blur scrim');
        assert.equal(state.theater, false);
        assert.equal(state.mainFilter, 'none');
        assert.equal(state.savedAmbient, true, 'do not erase the user preference for other surfaces');
        await page.getByRole('link', { name: 'Back to catalogue' }).click();
        await page.waitForURL('**/stremio');
        assert.equal(await page.locator('[data-dvp="ambient"]').count(), 0);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: Stremio card navigation, native/embed clarity, saved ambient preserved, back cleanup.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
