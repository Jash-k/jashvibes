// Fixture-only: no production DB or provider requests. Run a local production build
// with PASS=local-guide-test, LIVE_SYNC_MINUTES=0, KEEPALIVE=0, PORT=3000.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const auth = await context.request.post(base + '/api/auth', { data: { password: 'local-guide-test' } });
      assert.equal(auth.status(), 200);
      const { token } = await auth.json();
      await context.addInitScript(t => localStorage.setItem('jash_theatre_access_token', t), token);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let failExtras = false, changedSource = false, failManifest = false, pinWrites = 0;
      const calls = [];
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/auth') return route.continue();
        calls.push({ path: url.pathname, method: route.request().method(), query: url.search });
        if (route.request().method() === 'PUT') {
          pinWrites++;
          return route.fulfill({ json: { ok: true } });
        }
        let data = { ok: true, movies: [], series: [], channels: [], sections: [], releases: { albums: [], tracks: [] } };
        if (url.pathname === '/api/vault') {
          assert.equal(url.searchParams.get('view'), 'summary');
          data = {
            movies: [{ id: 'v', title: 'Fixture movie', year: 2025, language: 'ta', category: 'tamil-movie', qualities: ['720p'], quality: '720p', embedCount: 1, rating: 7, letter: 'F' }],
            facets: { languages: [] },
          };
        }
        if (url.pathname === '/api/embed-sites') {
          if (failExtras) { await pause(700); return route.fulfill({ status: 503, json: { ok: false } }); }
          data = { ok: true, sites: [{ id: 'x', label: 'Fixture site', url: 'https://example.com', description: '' }] };
        }
        if (url.pathname === '/api/stremio/manifest') {
          if (failManifest) { await pause(700); return route.fulfill({ status: 503, json: { ok: false } }); }
          data = {
            ok: true, manifestUrl: changedSource ? 'https://new.example/manifest.json' : 'https://old.example/manifest.json',
            manifest: { name: 'Fixture addon', catalogs: [{ type: 'movie', id: 'tamil', name: 'Tamil' }] },
          };
        }
        if (url.pathname === '/api/stremio/pins') data = { ok: true, configured: true, pins: ['movie:tamil'] };
        if (url.pathname === '/api/stremio/catalog') data = { items: [{ id: changedSource ? 'new' : 'old', title: changedSource ? 'New source title' : 'Old source title', type: 'movie' }], hasMore: false };
        if (url.pathname.startsWith('/api/music/')) await pause(700);
        await route.fulfill({ json: data });
      });
      await page.goto(base + '/vault');
      // Set AFTER navigation: a full document reload must lose this marker.
      const documentMarker = await page.evaluate(() => (window.documentMarker = crypto.randomUUID()));
      const nav = () => page.locator(width > 1000 ? '.jv-rail' : '.mobile-dock');
      const navTo = name => nav().getByRole('link', { name, exact: true }).click();
      await page.getByPlaceholder(/Search/).first().fill('Fixture');
      await navTo('ExTRaS');
      await page.getByRole('button', { name: 'Open Fixture site' }).waitFor();
      await page.getByPlaceholder('Find a website…').fill('Fixture');
      await navTo('Vault');
      await page.waitForURL('**/vault');
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'Fixture'));
      failExtras = true;
      await navTo('ExTRaS');
      await page.getByRole('button', { name: 'Open Fixture site' }).waitFor();
      assert.equal(await page.getByPlaceholder('Find a website…').inputValue(), 'Fixture');
      await page.getByText('The website collection could not be refreshed. Please retry.').waitFor();
      assert(await page.getByRole('button', { name: 'Open Fixture site' }).isVisible());
      await navTo('Stremio');
      await page.waitForURL('**/stremio?home=1');
      await page.getByText('Old source title', { exact: true }).first().waitFor();
      assert.equal(await page.evaluate(() => window.documentMarker), documentMarker);
      assert.equal(pinWrites, 0, 'reading must never write pins');
      changedSource = true;
      await page.getByRole('button', { name: 'Refresh addon manifest' }).click();
      await page.getByText('New source title', { exact: true }).first().waitFor();
      assert.equal(await page.getByText('Old source title', { exact: true }).count(), 0);
      assert(calls.some(call => call.path.endsWith('/manifest') && call.query.includes('fresh=1')));
      await navTo('Vault');
      failManifest = true;
      await navTo('Stremio');
      await page.getByText('New source title', { exact: true }).first().waitFor();
      await page.getByText('Could not refresh the addon. Showing your last loaded shelf.').waitFor();
      assert(await page.getByText('New source title', { exact: true }).first().isVisible());
      await navTo('Music');
      await page.locator('.mc-library').waitFor();
      assert.equal(await page.evaluate(() => window.documentMarker), documentMarker);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: cached preferences, retained content on refresh failure, soft Stremio navigation, source invalidation, no pin writes on entry, lazy Music shell.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
