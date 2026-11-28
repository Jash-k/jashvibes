import assert from 'node:assert/strict';import fs from 'node:fs';
import {sourceOrderFirst} from '../lib/vaultBrowse.js';import {summarizeVault} from '../lib/vaultSummary.js';
const r=(id,year,position)=>({id,sourceOrder:year?{year,position}:null,embeds:[]});
const rows=[r('unranked'),r('older',2026,0),r('new-b',2027,1),r('new-a',2027,0)];assert.deepEqual([...rows].sort(sourceOrderFirst).map(r=>r.id),['new-a','new-b','older','unranked']);
assert.equal(summarizeVault({movies:rows}).movies[1].sourceOrder.year,2026);
assert.equal(sourceOrderFirst({...r('a',2026,0),updatedAt:'2099-01-01'},{...r('b',2026,1),rating:10}),-1);
const page=fs.readFileSync(new URL('../app/vault/page.js',import.meta.url),'utf8');assert.match(page,/useState\('source'\)/);assert.match(page,/list.sort\(sourceOrderFirst\)/);assert.match(page,/summary:v5/);
console.log('PASS source-year priority, exact positions, summary transport and default browse integration');
