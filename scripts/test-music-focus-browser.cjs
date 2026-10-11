// Fixture-only layout/navigation tests against a local production build.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      await context.addInitScript(() => localStorage.setItem('jash_theatre_access_token', 'fixture'));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const album = { id: 'album1', title: 'Fixture album', type: 'album' };
      await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        const data = path === '/api/auth' ? { success: true } : path === '/api/music/home' ? { sections: [], releases: { albums: [album], tracks: [] } } : path === '/api/music/albums' ? { items: [album] } : { items: [], channels: [] };
        return route.fulfill({ json: data });
      });
      await page.goto(base + '/music');
      await page.locator('.mc-app.is-library-open .mc-library').waitFor();
      await page.locator('.mc-library').getByRole('button', {name:'Return to player', exact:true}).click();
      await page.locator('.mc-app.is-focus:not(.is-library-open) .mc-lyrics').waitFor();
      assert.equal(await page.locator('.mc-library').isVisible(), false);
      assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, 'in-app focus, not a browser fullscreen request');
      assert(await page.getByRole('button', { name: 'Open Library', exact: true }).isVisible());
      if (width <= 900) {
        assert.equal(await page.locator('.mc-lyrics-expand').isVisible(), false);
        const exit = page.getByRole('button', { name: 'Exit focus', exact: true });
        await exit.click();
        await page.locator('.mc-app:not(.is-focus)').waitFor();
        assert.equal(await page.getByRole('button', { name: 'Expand lyrics', exact: true }).isVisible(), false);
        await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Exit lyrics focus', exact: true }).click();
        await page.locator('.mc-app:not(.is-focus)').waitFor();
        await page.getByRole('button', { name: 'Expand lyrics', exact: true }).click();
      }
      await page.locator('.mc-app.is-focus').waitFor();
      await page.getByRole('button', { name: 'Open Library', exact: true }).click();
      await page.getByRole('button', { name: 'Open Fixture album', exact: true }).waitFor();
      await page.locator('.mc-library').getByRole('button', { name: 'Return to player', exact: true }).click();
      await page.locator('.mc-app.is-focus:not(.is-library-open)').waitFor();
      await page.goBack();
      await page.locator('.mc-app.is-library-open').waitFor();
      await page.goForward();
      await page.locator('.mc-app.is-focus:not(.is-library-open)').waitFor();
      await page.getByRole('button', { name: 'Artwork', exact: true }).click();
      await page.locator('.mc-player.is-artwork-mode').waitFor();
      await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
      await page.locator('.mc-app.is-focus .mc-lyrics').waitFor();
      const bounds = await page.locator('.mc-lyrics > header').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, scroll: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      assert(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= width, 'mobile tools stay inside viewport');
      if (process.env.LAYOUT_SCREENSHOTS) {
        require('node:fs').mkdirSync(process.env.LAYOUT_SCREENSHOTS, { recursive:true });
        await page.screenshot({ path: `${process.env.LAYOUT_SCREENSHOTS}/lyrics-focus-${width}.png` });
      }
      // Explicit library links still work; resizing retains URL-selected browsing state.
      await page.goto(base + '/music?tab=albums&library=1');
      await page.getByRole('button', { name: 'Open Fixture album', exact: true }).waitFor();
      await page.setViewportSize({ width: width > 900 ? 390 : 1440, height: 800 });
      await page.waitForFunction(expected => document.querySelector('.mc-player').inert === expected, width > 900);
      await page.getByRole('button', { name: 'Open Fixture album', exact: true }).waitFor();
      await page.locator('.mc-library').getByRole('button', { name: 'Return to player', exact: true }).click();
      await page.locator('.mc-app.is-focus:not(.is-library-open)').waitFor();
      assert.equal(await page.locator('.mc-player').evaluate(el => el.inert), false);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: Library-first, mobile text exit/no expand icon, desktop expand, Library, artwork, history, responsive sizing.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
