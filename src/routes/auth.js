import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { createLoginToken, consumeLoginToken } from '../lib/tokens.js';
import { sendMagicLink } from '../lib/mailer.js';
import { setSessionCookie, clearSessionCookie } from '../lib/session.js';

export const authRouter = Router();

function baseUrl() {
  return process.env.APP_BASE_URL || 'http://localhost:3000';
}

// POST /auth/request-link { email } → sends (or logs) a magic link.
// Always responds 200 with a generic message so the endpoint can't be used to
// enumerate which emails are registered.
authRouter.post('/auth/request-link', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that email is registered, a sign-in link is on its way.' };

  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) return res.json(generic);

  const token = await createLoginToken(user.id);
  const url = `${baseUrl()}/auth/verify?token=${encodeURIComponent(token)}`;
  try {
    await sendMagicLink({ to: user.email, name: user.name, url });
  } catch (err) {
    console.error('Failed to send magic link:', err);
    return res.status(502).json({ error: 'Could not send sign-in email' });
  }
  return res.json(generic);
});

// GET /auth/verify?token=… → sets session cookie, redirects to the board.
authRouter.get('/auth/verify', async (req, res) => {
  const token = String(req.query.token || '');
  const user = await consumeLoginToken(token);
  if (!user) {
    return res
      .status(400)
      .send('This sign-in link is invalid or has expired. Please request a new one.');
  }
  setSessionCookie(res, user.id);
  res.redirect('/');
});

// POST /auth/logout → clears the session cookie.
authRouter.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Dev sign-in is enabled only when there's no real email configured and we're not
// in production — so it can never be a backdoor once the app is deployed for real.
function devLoginEnabled() {
  return !process.env.RESEND_API_KEY && process.env.NODE_ENV !== 'production';
}

// GET /auth/dev-coaches → { enabled, coaches:[{name,email,role}] } for the login picker.
authRouter.get('/auth/dev-coaches', async (_req, res) => {
  if (!devLoginEnabled()) return res.json({ enabled: false, coaches: [] });
  const coaches = await prisma.user.findMany({
    where: { active: true },
    select: { name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
  res.json({ enabled: true, coaches });
});

// GET /auth/dev?email=… → sign in directly, no magic link. DEV ONLY.
authRouter.get('/auth/dev', async (req, res) => {
  if (!devLoginEnabled()) return res.status(404).send('Not found');
  const email = String(req.query.email || '').trim().toLowerCase();
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (!user || !user.active) {
    return res.status(400).send('Unknown or inactive coach email.');
  }
  setSessionCookie(res, user.id);
  res.redirect('/');
});
