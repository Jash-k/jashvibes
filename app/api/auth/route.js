import { NextResponse } from 'next/server';
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

function createAccessToken(password) {
  return crypto
    .createHash('sha256')
    .update(`jash-theatre:${password}`)
    .digest('hex');
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
      if (!safeEqual(token, expectedToken)) {
        return NextResponse.json(
          { success: false, error: 'Saved access expired or invalid' },
          { status: 401 }
        );
      }

      return NextResponse.json({ success: true, token: expectedToken });
    }

    if (!password || !safeEqual(password, configuredPassword)) {
      return NextResponse.json(
        { success: false, error: 'Invalid password' },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, token: expectedToken });
  } catch (error) {
    console.error('[api/auth] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to verify password' },
      { status: 500 }
    );
  }
}
