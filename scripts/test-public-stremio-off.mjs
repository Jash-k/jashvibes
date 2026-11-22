import assert from 'node:assert/strict';
process.env.STREMIO_ENABLED = 'false';
const { isStremioEnabled } = await import('../lib/stremioAccess.js');
const { getStremioManifest, getStremioCatalog, getStremioMeta, getStremioStreams } = await import('../lib/stremioAddon.js');
const { warmStremioRegistry } = await import('../lib/stremioRegistry.js');
let calls = 0;
globalThis.fetch = async () => { calls++; throw new Error('Unexpected upstream fetch'); };
assert.equal(await isStremioEnabled(), false);
for (const fn of [getStremioManifest, getStremioCatalog, getStremioMeta, getStremioStreams]) {
  await assert.rejects(fn({ id: 'tt1234567' }), /disabled by the owner/);
}
assert.deepEqual(await warmStremioRegistry(), {});
assert.equal(calls, 0);
const { readFile } = await import('node:fs/promises');
const { pathToFileURL } = await import('node:url');
const nextServer = pathToFileURL(new URL('../node_modules/next/server.js', import.meta.url).pathname).href;
const proxySource = (await readFile(new URL('../proxy.js', import.meta.url), 'utf8')).replace("'next/server'", JSON.stringify(nextServer));
const { proxy } = await import('data:text/javascript;base64,' + Buffer.from(proxySource).toString('base64'));
function req(path, method = 'GET') {
  const url = 'https://example.test' + path;
  return { url, method, nextUrl: new URL(url), headers: new Headers(), cookies: { get: () => undefined } };
}
assert.equal((await proxy(req('/api/providers'))).status, 200);
assert.equal((await proxy(req('/api/watch/source?provider=mp4'))).status, 200);
assert.notEqual((await proxy(req('/api/resolve', 'POST'))).status, 200);
const { adminDeny } = await import('../lib/adminAuth.js');
assert.ok(await adminDeny(req('/api/admin/stremio/access')));
console.log('PASS: public GET, protected mutation/admin, Stremio off with zero upstream fetches');
