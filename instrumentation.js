/**
 * Free-tier keep-alive (Render/Koyeb spin down idle instances).
 *
 * Render free services sleep after ~15 minutes without inbound traffic, and
 * the next visitor then waits through a cold start. This registers on server
 * boot and pings our own public /api/health endpoint every KEEPALIVE_MINUTES
 * (default 10) — one tiny request, no DB, no upstream calls, ~150 requests
 * a day, so unlike user-facing polling it cannot move the usage needle.
 *
 * Env:
 *   KEEPALIVE=0            disable entirely
 *   KEEPALIVE_MINUTES=5    custom interval (min 1)
 *
 * Base URL prefers RENDER_EXTERNAL_URL (Render sets it automatically) and
 * falls back to 127.0.0.1:PORT, so the ping works on any host.
 */

let keepaliveStarted = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (keepaliveStarted) return;
  keepaliveStarted = true;

  if (String(process.env.KEEPALIVE || '1') === '0') {
    console.info('[keepalive] disabled via KEEPALIVE=0');
    return;
  }

  const intervalMinutes = Math.max(0.1, Number(process.env.KEEPALIVE_MINUTES || 10));
  const base = String(
    process.env.RENDER_EXTERNAL_URL ||
    process.env.SITE_URL ||
    `http://127.0.0.1:${process.env.PORT || 3000}`,
  ).replace(/\/+$/, '');
  const url = `${base}/api/health`;

  const ping = async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'x-jash-keepalive': '1' },
      });
      clearTimeout(timeout);
      console.info(`[keepalive] ping ${url} -> ${response.status}`);
    } catch (error) {
      console.warn(`[keepalive] ping failed: ${error?.name === 'AbortError' ? 'timeout' : error?.message || 'unknown'}`);
    }
  };

  const firstDelay = Math.min(60 * 1000, intervalMinutes * 60 * 1000);
  const firstTimer = setTimeout(ping, firstDelay);
  const timer = setInterval(ping, intervalMinutes * 60 * 1000);
  for (const t of [firstTimer, timer]) { try { t.unref?.(); } catch {} }

  console.info(`[keepalive] started: ${url} every ${intervalMinutes} min`);
}
