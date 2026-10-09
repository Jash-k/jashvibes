const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const source = fs.readFileSync('lib/extrasCovers.js', 'utf8');
  const { bundledExtraCover, extraCoverSources } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const arivumani = { id:'keep', label:'Arivumani', url:'https://arivumani.net/', coverUrl:'https://images.example/old.jpg' };
  const snapshot = JSON.stringify(arivumani);
  assert.equal(bundledExtraCover(arivumani), '/tamil-serials-card.jpg');
  assert.equal(bundledExtraCover({url:'https://www.arivumani.net/video/example/'}), '/tamil-serials-card.jpg');
  assert.equal(bundledExtraCover({url:'https://piratexplay.cc/language/tamil/'}), '/anime-card.jpg');
  assert.equal(bundledExtraCover({url:'https://www.piratexplay.cc/language/tamil'}), '/anime-card.jpg');
  for (const url of ['https://piratexplay.cc/language/hindi/', 'https://piratexplay.cc/', 'https://fake-arivumani.net/', 'https://arivumani.net.attacker.example/', 'https://other.example/', 'invalid']) assert.equal(bundledExtraCover({url}), '');
  assert.deepEqual(extraCoverSources(arivumani), ['/tamil-serials-card.jpg', 'https://images.example/old.jpg']);
  assert.deepEqual(extraCoverSources({url:'https://other.example/',coverUrl:'https://images.example/custom.jpg'}), ['https://images.example/custom.jpg']);
  assert.deepEqual(extraCoverSources({}), []);
  assert.deepEqual(extraCoverSources({url:'https://arivumani.net/',coverUrl:'/tamil-serials-card.jpg'}), ['/tamil-serials-card.jpg']);
  assert.equal(JSON.stringify(arivumani), snapshot);
  for (const path of ['public/anime-card.jpg', 'public/tamil-serials-card.jpg']) {
    const bytes=fs.readFileSync(path);assert(bytes.length>10000);assert.equal(bytes[0],255);assert.equal(bytes[1],216);
  }
  console.log('Extras cover mapping, exact-host protection, deduplication, custom fallback, no mutation, and local JPEG tests passed.');
})().catch(e => {console.error(e); process.exitCode=1;});
