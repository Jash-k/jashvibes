import { NextResponse } from 'next/server';

export const SPORTS_BACKEND = (process.env.MOVIES1_BACKEND || process.env.SPORTS_BACKEND || 'https://movies1-backend.onrender.com').replace(/\/+$/, '');

export function copySearchParams(source, target) {
  for (const [key, value] of source.entries()) target.append(key, value);
  return target;
}

export async function fetchSportsBackend(path, searchParams, { timeoutMs = 25000, fallback = null } = {}) {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, SPORTS_BACKEND);
  if (searchParams) copySearchParams(searchParams, url.searchParams);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'JaSH-ViBeS-Sports/1.0',
      },
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) {
      if (fallback !== null) return fallback;
      const err = new Error(data?.error || data?.message || `Sports backend returned HTTP ${response.status}`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data ?? {};
  } catch (error) {
    if (fallback !== null) return fallback;
    if (error.name === 'AbortError') throw new Error(`Sports backend timed out: ${path}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function sportsJson(data, { status = 200, maxAge = 20 } = {}) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}, s-maxage=${maxAge}` : 'no-store',
    },
  });
}

export function sportsError(error, fallback = null) {
  if (fallback) return sportsJson({ ...fallback, unavailable: true, error: error.message || 'Sports feed unavailable' }, { maxAge: 0 });
  return sportsJson({ ok: false, error: error.message || 'Sports feed unavailable' }, { status: error.status || 502, maxAge: 0 });
}
