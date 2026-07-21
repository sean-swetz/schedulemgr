import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/authMiddleware.js';
import { DEFAULT_TEMPLATES } from '../lib/notificationDefaults.js';

export const adminRouter = Router();

// Everything here is admins-only.
adminRouter.use('/api/admin', requireAdmin);

const SINGLETON = { id: 'singleton' };

async function ensureSettings() {
  return prisma.settings.upsert({ where: SINGLETON, update: {}, create: { id: 'singleton' } });
}

// Mask a secret for display: keep the last 4 chars, never return the rest.
function maskKey(key) {
  if (!key) return null;
  const tail = key.slice(-4);
  return `${key.slice(0, 3)}••••${tail}`;
}

// Shape settings for the client — the raw Resend key is never sent back.
function serializeSettings(s) {
  return {
    fromName: s.fromName,
    fromEmail: s.fromEmail,
    replyTo: s.replyTo,
    gymName: s.gymName,
    gymAddress: s.gymAddress,
    classMinutes: s.classMinutes,
    ccAdminsOnClaim: s.ccAdminsOnClaim,
    resendKeySet: Boolean(s.resendApiKey),
    resendKeyHint: maskKey(s.resendApiKey),
  };
}

// ── Settings ───────────────────────────────────────────────────────────────
adminRouter.get('/api/admin/settings', async (_req, res) => {
  res.json({ settings: serializeSettings(await ensureSettings()) });
});

adminRouter.patch('/api/admin/settings', async (req, res) => {
  await ensureSettings();
  const b = req.body || {};
  const data = {};
  if (typeof b.fromName === 'string') data.fromName = b.fromName.trim().slice(0, 120);
  if (typeof b.fromEmail === 'string') data.fromEmail = b.fromEmail.trim().slice(0, 200);
  if ('replyTo' in b) data.replyTo = b.replyTo ? String(b.replyTo).trim().slice(0, 200) : null;
  if (typeof b.gymName === 'string') data.gymName = b.gymName.trim().slice(0, 160);
  if (typeof b.gymAddress === 'string') data.gymAddress = b.gymAddress.trim().slice(0, 300);
  if (b.classMinutes != null) {
    const n = Number(b.classMinutes);
    if (Number.isFinite(n) && n > 0 && n <= 300) data.classMinutes = Math.round(n);
  }
  if (typeof b.ccAdminsOnClaim === 'boolean') data.ccAdminsOnClaim = b.ccAdminsOnClaim;

  // Resend key: only touched when explicitly provided. Empty string clears it.
  if ('resendApiKey' in b) {
    const v = b.resendApiKey;
    if (v === '' || v === null) data.resendApiKey = null;
    else if (typeof v === 'string' && v.trim()) data.resendApiKey = v.trim();
  }

  const s = await prisma.settings.update({ where: SINGLETON, data });
  res.json({ settings: serializeSettings(s) });
});

// ── Notification templates ───────────────────────────────────────────────────
adminRouter.get('/api/admin/templates', async (_req, res) => {
  const rows = await prisma.notificationTemplate.findMany();
  const byEvent = Object.fromEntries(rows.map((r) => [r.event, r]));
  // Return all three known events, filling from defaults if a row is missing.
  const templates = Object.keys(DEFAULT_TEMPLATES).map((event) => {
    const r = byEvent[event] || { event, ...DEFAULT_TEMPLATES[event] };
    return {
      event,
      subject: r.subject,
      body: r.body,
      enabled: r.enabled,
      default: DEFAULT_TEMPLATES[event],
    };
  });
  res.json({ templates });
});

adminRouter.patch('/api/admin/templates/:event', async (req, res) => {
  const { event } = req.params;
  if (!(event in DEFAULT_TEMPLATES)) return res.status(404).json({ error: 'Unknown event' });

  const b = req.body || {};
  const data = {};
  if (typeof b.subject === 'string') data.subject = b.subject.slice(0, 300);
  if (typeof b.body === 'string') data.body = b.body.slice(0, 2000);
  if (typeof b.enabled === 'boolean') data.enabled = b.enabled;
  // Reset-to-default convenience.
  if (b.reset === true) {
    data.subject = DEFAULT_TEMPLATES[event].subject;
    data.body = DEFAULT_TEMPLATES[event].body;
  }

  const row = await prisma.notificationTemplate.upsert({
    where: { event },
    update: data,
    create: {
      event,
      subject: data.subject ?? DEFAULT_TEMPLATES[event].subject,
      body: data.body ?? DEFAULT_TEMPLATES[event].body,
      enabled: data.enabled ?? DEFAULT_TEMPLATES[event].enabled,
    },
  });
  res.json({ template: { event: row.event, subject: row.subject, body: row.body, enabled: row.enabled } });
});

// ── Per-coach notification toggles ───────────────────────────────────────────
adminRouter.get('/api/admin/coaches', async (_req, res) => {
  const coaches = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, email: true, role: true, active: true,
      emailEnabled: true, pushSubscription: true,
    },
  });
  res.json({
    coaches: coaches.map((c) => ({
      id: c.id, name: c.name, email: c.email, role: c.role, active: c.active,
      emailEnabled: c.emailEnabled, pushEnrolled: Boolean(c.pushSubscription),
    })),
  });
});

adminRouter.patch('/api/admin/coaches/:id/notifications', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const data = {};
  if (typeof b.emailEnabled === 'boolean') data.emailEnabled = b.emailEnabled;
  // Turning push off = clearing the subscription. (Can't enable push from here.)
  if (b.pushEnabled === false) data.pushSubscription = null;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Coach not found' });

  const updated = await prisma.user.update({ where: { id }, data });
  res.json({
    coach: {
      id: updated.id, name: updated.name, emailEnabled: updated.emailEnabled,
      pushEnrolled: Boolean(updated.pushSubscription),
    },
  });
});

// ── Notification log ─────────────────────────────────────────────────────────
adminRouter.get('/api/admin/notifications/log', async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await prisma.notificationLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
  });
  res.json({ log: rows });
});
