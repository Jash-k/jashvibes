const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const source = fs.readFileSync('components/navItems.js', 'utf8');
  const { NAV_ITEMS, isNavItemActive } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  assert.deepEqual(NAV_ITEMS.map(i => i.label), ['Home', 'Live Tv', 'Music', 'ExTRaS', 'Vault', 'Stremio']);
  assert.deepEqual(NAV_ITEMS.map(i => i.href), ['/', '/live', '/music', '/extras', '/vault', '/stremio?home=1']);
  assert.equal(NAV_ITEMS[1].icon, 'tv');
  assert.equal(NAV_ITEMS[4].icon, 'reel');
  assert.equal(NAV_ITEMS[5].hard, undefined);
  assert.equal(new Set(NAV_ITEMS.map(i => i.href)).size, 6);
  for (const item of NAV_ITEMS) {
    const route = item.href.split('?')[0];
    assert.equal(NAV_ITEMS.filter(i => isNavItemActive(i, route)).length, 1);
    assert(isNavItemActive(item, route));
    if (route !== '/') assert(isNavItemActive(item, route + '/detail'));
  }
  assert.equal(NAV_ITEMS.filter(i => isNavItemActive(i, '/livetv')).length, 0);
  for (const file of ['components/rail/RailNav.jsx', 'components/MobileDock.jsx']) {
    const code = fs.readFileSync(file, 'utf8');
    assert(code.includes("from '@/components/navItems'"));
    assert(code.includes('item.icon'));
    assert(code.includes('SectionLink'));
    assert(!code.includes('window.location.assign(item.href)'));
  }
  const icons = fs.readFileSync('components/Icons.jsx', 'utf8');
  assert(/tv:\s*\[/.test(icons)); assert(/reel:\s*\[/.test(icons));
  assert(fs.readFileSync('components/rail/RailNav.jsx','utf8').includes('href="/admin"'));
  console.log('PASS shared desktop/mobile order, labels, TV/reel icons, active routes, Admin, Music navigation and Stremio soft navigation.');
})().catch(e => {console.error(e); process.exitCode=1;});
