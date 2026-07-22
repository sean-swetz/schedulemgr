import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { vapidPublicKey, pushEnabled } from '../lib/push.js';

export const pushRouter = Router();

// GET /api/push/config → { enabled, publicKey } for the client to subscribe.
pushRouter.get('/api/push/config', (_req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: vapidPublicKey() });
});

// POST /api/push/subscribe { subscription } → store it on the current user.
pushRouter.post('/api/push/subscribe', async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  await prisma.user.update({ where: { id: req.user.id }, data: { pushSubscription: sub } });
  res.json({ ok: true });
});

// POST /api/push/unsubscribe → clear it.
pushRouter.post('/api/push/unsubscribe', async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { pushSubscription: null } });
  res.json({ ok: true });
});

// GET /api/push/status → whether the current user has a subscription stored.
pushRouter.get('/api/push/status', async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { pushSubscription: true } });
  res.json({ subscribed: Boolean(u?.pushSubscription) });
});
