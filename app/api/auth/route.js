import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createAccessToken,
  isValidAccessToken,
} from '@/lib/serverAuth';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getConfiguredPassword() {
  return process.env.PASS || process.env.SPACE_PASSWORD || process.env.APP_PASSWORD || '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Secondary unlock password for the Live TV service panel. Curation/demo
 * deployments use a friendlier password than the owner PASS. Overridable via
 * LIVE_TV_PASS (or TV_PASS); defaults to 'tv2010'. A successful login issues
 * the same session token as the main password, so middleware is unaffected.
 */
function getTvPanelPassword() {
  return process.env.LIVE_TV_PASS || process.env.TV_PASS || 'tv2010';
}

/**
 * Sets the HttpOnly session cookie.
 * - sameSite 'none' + secure in production so the cookie also works when the
 *   app is embedded (e.g. inside a Hugging Face Spaces iframe).
 * - sameSite 'lax' in local dev where https is unavailable (browsers reject
 *   SameSite=None without Secure there).
 */
function withSessionCookie(response, token) {
  const isProd = process.env.NODE_ENV === 'production';
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

function clearSessionCookie(response) {
  const isProd = process.env.NODE_ENV === 'production';
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function POST(request) {
  try {
    const configuredPassword = getConfiguredPassword();

    if (!configuredPassword) {
      return NextResponse.json(
        {
          success: false,
          error: 'Password protection is not configured. Add PASS or SPACE_PASSWORD as a Hugging Face Secret.',
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const password = body?.password || '';
    const token = body?.token || '';
    const expectedToken = createAccessToken(configuredPassword);

    if (token) {
      if (!isValidAccessToken(token)) {
        return clearSessionCookie(
          NextResponse.json(
            { success: false, error: 'Saved access expired or invalid' },
            { status: 401 }
          )
        );
      }

      return withSessionCookie(NextResponse.json({ success: true, token: expectedToken }), expectedToken);
    }

    const tvPanelPassword = getTvPanelPassword();
    const passwordOk = Boolean(password) &&
      (safeEqual(password, configuredPassword) || safeEqual(password, tvPanelPassword));

    if (!passwordOk) {
      return NextResponse.json(
        { success: false, error: 'Invalid password' },
        { status: 401 }
      );
    }

    return withSessionCookie(NextResponse.json({ success: true, token: expectedToken }), expectedToken);
  } catch (error) {
    console.error('[api/auth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to verify password' },
      { status: 500 }
    );
  }
}

/** Logout: clears the HttpOnly session cookie (AuthGate Lock button). */
export async function DELETE() {
  return clearSessionCookie(NextResponse.json({ success: true }));
}
