# Live-stream unlock proxy — one free Cloudflare Worker

FanCode and SonyLiv serve their video from CDNs that **(a)** have no CORS and
**(b)** only answer Indian region IPs. No browser can play them directly, and a
server hosted outside India cannot follow the geo fence. The unlock is a tiny
proxy that runs on Cloudflare's edge — for a viewer in India it egresses from an
Indian colo, and it adds CORS + rewrites playlists so every segment rides it.

This is the same mechanism every working web player for these streams uses —
except this one is **yours**: your account, your subdomain, no third party.

## Deploy it (2 minutes, free)

1. Open <https://dash.cloudflare.com> → **Workers & Pages** → **Create Worker**
2. Name it anything (e.g. `jv-streams`) → **Deploy** → **Edit code**
3. Delete the sample code, paste the worker below, **Deploy**
4. Copy your URL (`https://jv-streams.<your-subdomain>.workers.dev`)
5. On Render, add one environment variable to your web service:

```
SPORTS_STREAM_PROXY = https://jv-streams.<your-subdomain>.workers.dev
```

Redeploy. That's it — playback now chains **direct → your worker → the app's
own proxy → the match's other feeds** automatically.

## The worker

```javascript
/**
 * jv-streams — HLS unlock proxy for one's own player.
 *   GET /?url=<encoded stream url>&ua=<optional>&ref=<optional>&cookie=<optional>
 * Fetches upstream with any headers a browser cannot send, answers with CORS
 * open, and rewrites playlists so every child rides this proxy too.
 */
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

function rewritePlaylist(text, baseUrl, proxyBase, extras) {
  const parentQuery = baseUrl.search;
  const wrap = (absUrl) => proxyBase + '?url=' + encodeURIComponent(absUrl) + extras;
  const toAbs = (ref) => {
    const u = new URL(ref, baseUrl);
    if (!u.search && parentQuery) u.search = parentQuery;
    return u.toString();
  };
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (whole, uri) => {
        try { return 'URI="' + wrap(toAbs(uri)) + '"'; } catch { return whole; }
      });
    }
    try { return wrap(toAbs(t)); } catch { return line; }
  }).join('\n');
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('jv-streams proxy: pass ?url=', { status: 400, headers: cors() });
    let targetUrl;
    try { targetUrl = new URL(target); } catch { return new Response('bad url', { status: 400, headers: cors() }); }
    if (!/^https?:$/.test(targetUrl.protocol)) return new Response('bad scheme', { status: 400, headers: cors() });

    const ua = reqUrl.searchParams.get('ua') || '';
    const ref = reqUrl.searchParams.get('ref') || '';
    const cookie = reqUrl.searchParams.get('cookie') || '';

    const headers = {
      'User-Agent': ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': '*/*',
    };
    if (ref) { headers['Referer'] = ref; try { headers['Origin'] = new URL(ref).origin; } catch {} }
    if (cookie) headers['Cookie'] = cookie;

    let upstream;
    try { upstream = await fetch(targetUrl.toString(), { headers, redirect: 'follow', cf: { cacheTtl: 0 } }); }
    catch (error) { return new Response('upstream failed: ' + error.message, { status: 502, headers: cors() }); }

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist = /\.m3u8(\?|#|$)/i.test(targetUrl.pathname) || /mpegurl/i.test(contentType);

    // A refusal is not a playlist: hand the failure back as it came.
    if (!upstream.ok) {
      return new Response(upstream.body, { status: upstream.status, headers: { ...cors(), 'Content-Type': 'text/plain', 'X-Proxy-Upstream': String(upstream.status) } });
    }

    if (isPlaylist && request.method !== 'HEAD') {
      const text = await upstream.text();
      const extras =
        (cookie ? '&cookie=' + encodeURIComponent(cookie) : '') +
        (ref ? '&ref=' + encodeURIComponent(ref) : '') +
        (ua ? '&ua=' + encodeURIComponent(ua) : '');
      const proxyBase = reqUrl.origin + reqUrl.pathname;
      const rewritten = rewritePlaylist(text, targetUrl, proxyBase, extras);
      return new Response(rewritten, { status: 200, headers: { ...cors(), 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' } });
    }

    const out = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors())) out.set(k, v);
    out.delete('content-security-policy');
    out.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
```

## Notes

- Nothing is stored, logged, or rate-limited by the app; the worker is stateless.
- If you ever remove it, delete `SPORTS_STREAM_PROXY` — playback falls back to
  direct and the app's own proxy, no code change needed.
- The worker only proxies `http(s)` URLs handed to it by your own player. It is
  not a general browsing proxy.
