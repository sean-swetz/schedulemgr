import { prisma } from './prisma.js';
import { readSessionValue, COOKIE_NAME } from './session.js';

/**
 * Populate req.user from the session cookie if present and valid. Never rejects —
 * downstream guards decide what requires auth. Attaches null if not signed in.
 */
export async function loadUser(req, _res, next) {
  req.user = null;
  try {
    const userId = readSessionValue(req.cookies?.[COOKIE_NAME]);
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user && user.active) req.user = user;
    }
  } catch {
    // ignore — treated as signed out
  }
  next();
}

/** Require any signed-in, active user. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}

/** Require an ADMIN. */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admins only' });
  next();
}
