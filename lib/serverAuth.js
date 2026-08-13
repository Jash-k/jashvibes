import crypto from 'crypto';

function getConfiguredPassword() {
  return process.env.PASS || process.env.SPACE_PASSWORD || process.env.APP_PASSWORD || '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createAccessToken(password = getConfiguredPassword()) {
  return crypto.createHash('sha256').update(`jash-theatre:${password}`).digest('hex');
}

export function verifyRequestToken(request) {
  const configuredPassword = getConfiguredPassword();
  if (!configuredPassword) return false;
  const token = request.headers.get('x-jash-token') || request.headers.get('x-service-token') || new URL(request.url).searchParams.get('token') || '';
  return Boolean(token && safeEqual(token, createAccessToken(configuredPassword)));
}

export function requireServiceAuth(request) {
  if (!verifyRequestToken(request)) {
    const error = new Error('Service panel password required');
    error.status = 401;
    throw error;
  }
}
