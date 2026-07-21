import crypto from 'node:crypto';

// Stateless signed session cookie. Payload is just the user id; integrity is
// guaranteed by an HMAC over "userId.expiresAt". No session table needed for a
// 12-person tool. Cookie is HTTP-only and long-lived (90 days) per the brief.

const COOKIE_NAME = 'cfp_session';
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

/** Build the signed cookie value for a user id. */
export function makeSessionValue(userId, now = Date.now()) {
  const expiresAt = now + MAX_AGE_MS;
  const body = `${userId}.${expiresAt}`;
  return `${body}.${sign(body)}`;
}

/** Verify a cookie value; return the userId if valid and unexpired, else null. */
export function readSessionValue(value) {
  if (!value || typeof value !== 'string') return null;
  const idx = value.lastIndexOf('.');
  if (idx === -1) return null;
  const body = value.slice(0, idx);
  const mac = value.slice(idx + 1);

  const expected = sign(body);
  // Constant-time compare; guard against length mismatch which timingSafeEqual throws on.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const dot = body.indexOf('.');
  if (dot === -1) return null;
  const userId = body.slice(0, dot);
  const expiresAt = Number(body.slice(dot + 1));
  if (!userId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return userId;
}

/** Set the session cookie on a response for the given user. */
export function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, makeSessionValue(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

/** Clear the session cookie (sign-out). */
export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export { COOKIE_NAME };
