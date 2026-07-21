import crypto from 'node:crypto';
import { prisma } from './prisma.js';

// Magic-link tokens: single-use, short-lived rows in LoginToken.
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Create a fresh magic-link token for a user. Returns the raw token string. */
export async function createLoginToken(userId, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.loginToken.create({
    data: {
      token,
      userId,
      expiresAt: new Date(now + TOKEN_TTL_MS),
    },
  });
  return token;
}

/**
 * Consume a magic-link token. Returns the associated User if the token is valid,
 * unexpired, and unused; otherwise null. Marks the token used on success so it
 * can't be replayed.
 */
export async function consumeLoginToken(token, now = Date.now()) {
  if (!token) return null;
  const row = await prisma.loginToken.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < now) return null;
  if (!row.user.active) return null;

  // Mark used atomically-ish: only claim it if still unused.
  const claimed = await prisma.loginToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date(now) },
  });
  if (claimed.count !== 1) return null; // lost a race

  return row.user;
}
