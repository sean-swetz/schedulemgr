import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAdmin } from '../lib/authMiddleware.js';
import { DEFAULT_TEMPLATES } from '../lib/notificationDefaults.js';
import { sendBroadcast } from '../lib/broadcast.js';
import { weekStart, weekDates, addDays, toIsoDate } from '../lib/dates.js';

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

// ── Coach CRUD + activation ──────────────────────────────────────────────────
function serializeCoach(c) {
  return {
    id: c.id, name: c.name, email: c.email, role: c.role, active: c.active,
    emailEnabled: c.emailEnabled, pushEnrolled: Boolean(c.pushSubscription),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/admin/coaches  { name, email, role? } → create a coach.
adminRouter.post('/api/admin/coaches', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const role = b.role === 'ADMIN' ? 'ADMIN' : 'COACH';

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'A coach with that email already exists' });

  const created = await prisma.user.create({ data: { name, email, role } });
  res.status(201).json({ coach: serializeCoach(created) });
});

// PATCH /api/admin/coaches/:id  { name?, email?, role? } → edit a coach.
adminRouter.patch('/api/admin/coaches/:id', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Coach not found' });

  const data = {};
  if (typeof b.name === 'string') {
    const name = b.name.trim().slice(0, 120);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    data.name = name;
  }
  if (typeof b.email === 'string') {
    const email = b.email.trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (email !== user.email) {
      const clash = await prisma.user.findUnique({ where: { email } });
      if (clash) return res.status(409).json({ error: 'Another coach already uses that email' });
    }
    data.email = email;
  }
  if (b.role === 'ADMIN' || b.role === 'COACH') {
    // Guardrail: an admin can't demote themselves (avoid locking out admin access).
    if (b.role === 'COACH' && id === req.user.id) {
      return res.status(400).json({ error: "You can't remove your own admin role" });
    }
    data.role = b.role;
  }

  const updated = await prisma.user.update({ where: { id }, data });
  res.json({ coach: serializeCoach(updated) });
});

// PATCH /api/admin/coaches/:id/active  { active } → (de)activate a coach.
// Deactivating auto-reverts their still-open coverage requests back to SCHEDULED
// and reports how many classes they were covering (so the admin can reassign).
adminRouter.patch('/api/admin/coaches/:id/active', async (req, res) => {
  const { id } = req.params;
  const active = Boolean(req.body?.active);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Coach not found' });

  if (!active && id === req.user.id) {
    return res.status(400).json({ error: "You can't deactivate yourself" });
  }

  let revertedOpen = 0;
  let stillCovering = 0;
  if (!active) {
    // Revert their own open requests (nobody's committed yet).
    const reverted = await prisma.classInstance.updateMany({
      where: { assignedId: id, status: 'OPEN' },
      data: { status: 'SCHEDULED', note: null, coveredById: null },
    });
    revertedOpen = reverted.count;
    // Count classes they've agreed to cover — leave them, but warn the admin.
    stillCovering = await prisma.classInstance.count({
      where: { coveredById: id, status: 'CLAIMED' },
    });
  }

  const updated = await prisma.user.update({ where: { id }, data: { active } });
  res.json({ coach: serializeCoach(updated), revertedOpen, stillCovering });
});

// DELETE /api/admin/coaches/:id → hard-delete a coach.
// Only allowed when the coach has no history to protect (no template slots, no
// class instances assigned/covered, no login tokens) — otherwise deleting would
// either orphan real schedule data or silently erase it. This is meant for
// cleaning up accidental/duplicate coaches, not removing coaches who've coached.
adminRouter.delete('/api/admin/coaches/:id', async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'Coach not found' });
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });

  const [slots, assigned, covering, tokens] = await Promise.all([
    prisma.templateSlot.count({ where: { coachId: id } }),
    prisma.classInstance.count({ where: { assignedId: id } }),
    prisma.classInstance.count({ where: { coveredById: id } }),
    prisma.loginToken.count({ where: { userId: id } }),
  ]);
  const blockers = [];
  if (slots) blockers.push(`${slots} weekly template slot${slots > 1 ? 's' : ''}`);
  if (assigned) blockers.push(`${assigned} assigned class${assigned > 1 ? 'es' : ''}`);
  if (covering) blockers.push(`${covering} class${covering > 1 ? 'es' : ''} they're covering`);
  if (tokens) blockers.push('sign-in history');
  if (blockers.length) {
    return res.status(409).json({
      error: `Can't delete — this coach has ${blockers.join(', ')}. Deactivate them instead, or reassign those first.`,
    });
  }

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

// ── Broadcast (compose-and-send announcements) ───────────────────────────────
// POST /api/admin/broadcast { subject, body, audience?|userIds? } → send now.
adminRouter.post('/api/admin/broadcast', async (req, res) => {
  const b = req.body || {};
  const subject = String(b.subject || '').trim().slice(0, 300);
  const body = String(b.body || '').trim().slice(0, 5000);
  if (!subject) return res.status(400).json({ error: 'Subject is required' });
  if (!body) return res.status(400).json({ error: 'Message body is required' });

  const spec = {};
  if (Array.isArray(b.userIds) && b.userIds.length) spec.userIds = b.userIds.map(String);
  else spec.audience = ['all', 'admins', 'coaches'].includes(b.audience) ? b.audience : 'all';

  const summary = await sendBroadcast({ subject, body, spec });
  if (summary.recipients === 0) {
    return res.status(400).json({ error: 'No active recipients matched' });
  }
  res.json({ summary });
});

// Saved broadcast templates (reusable announcements).
adminRouter.get('/api/admin/broadcast-templates', async (_req, res) => {
  const templates = await prisma.broadcastTemplate.findMany({ orderBy: { name: 'asc' } });
  res.json({ templates });
});

adminRouter.post('/api/admin/broadcast-templates', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  const subject = String(b.subject || '').trim().slice(0, 300);
  const body = String(b.body || '').trim().slice(0, 5000);
  if (!name) return res.status(400).json({ error: 'Template name is required' });
  const t = await prisma.broadcastTemplate.create({ data: { name, subject, body } });
  res.status(201).json({ template: t });
});

adminRouter.patch('/api/admin/broadcast-templates/:id', async (req, res) => {
  const b = req.body || {};
  const data = {};
  if (typeof b.name === 'string' && b.name.trim()) data.name = b.name.trim().slice(0, 120);
  if (typeof b.subject === 'string') data.subject = b.subject.trim().slice(0, 300);
  if (typeof b.body === 'string') data.body = b.body.trim().slice(0, 5000);
  const t = await prisma.broadcastTemplate.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: t });
});

adminRouter.delete('/api/admin/broadcast-templates/:id', async (req, res) => {
  await prisma.broadcastTemplate.delete({ where: { id: req.params.id } }).catch(() => {});
  res.json({ ok: true });
});

// ── Schedule: weekly template editor ─────────────────────────────────────────
const DOW_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h "HH:MM"

// The first day we're allowed to change: tomorrow's week start (never touch the
// current in-progress week or the past).
function futureCutoff() {
  const nextWeek = addDays(weekStart(new Date()), 7);
  return nextWeek; // UTC-midnight Monday of next week
}

// Propagate a template change to already-materialized FUTURE weeks, but only for
// instances still SCHEDULED (never clobber OPEN/CLAIMED or one-off edits).
async function propagateSlot({ oldTime, dayOfWeek, newTime, coachId, className }) {
  const cutoff = futureCutoff();
  // Instances on this day-of-week, at the old time, in future weeks, still scheduled.
  const candidates = await prisma.classInstance.findMany({
    where: { time: oldTime, status: 'SCHEDULED', date: { gte: cutoff } },
  });
  let updated = 0;
  for (const ci of candidates) {
    if (((ci.date.getUTCDay() + 6) % 7) !== dayOfWeek) continue; // wrong weekday
    // If moving to a new time, ensure that (date,newTime) isn't already taken.
    if (newTime !== oldTime) {
      const clash = await prisma.classInstance.findUnique({
        where: { date_time: { date: ci.date, time: newTime } },
      });
      if (clash) continue; // leave it; admin can resolve one-offs manually
    }
    await prisma.classInstance.update({
      where: { id: ci.id },
      data: { time: newTime, assignedId: coachId, className },
    });
    updated++;
  }
  return updated;
}

// GET /api/admin/template → all slots grouped by day, with coach info.
adminRouter.get('/api/admin/template', async (_req, res) => {
  const slots = await prisma.templateSlot.findMany({
    include: { coach: { select: { id: true, name: true } } },
    orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
  });
  const days = DOW_NAMES.map((name, i) => ({
    dayOfWeek: i,
    name,
    slots: slots
      .filter((s) => s.dayOfWeek === i)
      .map((s) => ({ id: s.id, time: s.time, className: s.className, coach: s.coach })),
  }));
  res.json({ days });
});

// POST /api/admin/template  { dayOfWeek, time, coachId, className? } → add a slot.
adminRouter.post('/api/admin/template', async (req, res) => {
  const b = req.body || {};
  const dayOfWeek = Number(b.dayOfWeek);
  const time = String(b.time || '').trim();
  const className = String(b.className || 'CrossFit').trim().slice(0, 60) || 'CrossFit';
  if (!(dayOfWeek >= 0 && dayOfWeek <= 6)) return res.status(400).json({ error: 'Invalid day' });
  if (!TIME_RE.test(time)) return res.status(400).json({ error: 'Time must be HH:MM (24h)' });

  const coach = await prisma.user.findUnique({ where: { id: String(b.coachId || '') } });
  if (!coach || !coach.active) return res.status(400).json({ error: 'Pick an active coach' });

  const clash = await prisma.templateSlot.findUnique({ where: { dayOfWeek_time: { dayOfWeek, time } } });
  if (clash) return res.status(409).json({ error: 'A class already exists at that day and time' });

  const slot = await prisma.templateSlot.create({ data: { dayOfWeek, time, className, coachId: coach.id } });
  // Materialize into future weeks (skips ones already having that date+time).
  const cutoff = futureCutoff();
  const created = [];
  for (let w = 0; w < 8; w++) {
    const date = addDays(cutoff, w * 7 + dayOfWeek);
    created.push(
      prisma.classInstance.upsert({
        where: { date_time: { date, time } },
        update: {},
        create: { date, time, className, assignedId: coach.id, status: 'SCHEDULED' },
      })
    );
  }
  await Promise.all(created);
  res.status(201).json({ slot: { id: slot.id, dayOfWeek, time, className, coachId: coach.id } });
});

// PATCH /api/admin/template/:id  { coachId?, time?, className? } → edit a slot.
adminRouter.patch('/api/admin/template/:id', async (req, res) => {
  const b = req.body || {};
  const slot = await prisma.templateSlot.findUnique({ where: { id: req.params.id } });
  if (!slot) return res.status(404).json({ error: 'Slot not found' });

  const newTime = b.time != null ? String(b.time).trim() : slot.time;
  if (!TIME_RE.test(newTime)) return res.status(400).json({ error: 'Time must be HH:MM (24h)' });
  const className = b.className != null ? String(b.className).trim().slice(0, 60) || 'CrossFit' : slot.className;

  let coachId = slot.coachId;
  if (b.coachId != null) {
    const coach = await prisma.user.findUnique({ where: { id: String(b.coachId) } });
    if (!coach || !coach.active) return res.status(400).json({ error: 'Pick an active coach' });
    coachId = coach.id;
  }

  // Moving time? ensure no other template slot occupies that day+time.
  if (newTime !== slot.time) {
    const clash = await prisma.templateSlot.findUnique({
      where: { dayOfWeek_time: { dayOfWeek: slot.dayOfWeek, time: newTime } },
    });
    if (clash) return res.status(409).json({ error: 'Another class already uses that time' });
  }

  await prisma.templateSlot.update({ where: { id: slot.id }, data: { time: newTime, className, coachId } });
  const propagated = await propagateSlot({
    oldTime: slot.time, dayOfWeek: slot.dayOfWeek, newTime, coachId, className,
  });
  res.json({ ok: true, futureWeeksUpdated: propagated });
});

// DELETE /api/admin/template/:id → remove a slot (+ future SCHEDULED instances).
adminRouter.delete('/api/admin/template/:id', async (req, res) => {
  const slot = await prisma.templateSlot.findUnique({ where: { id: req.params.id } });
  if (!slot) return res.status(404).json({ error: 'Slot not found' });
  await prisma.templateSlot.delete({ where: { id: slot.id } });

  // Remove matching future instances that are still SCHEDULED (leave OPEN/CLAIMED).
  const cutoff = futureCutoff();
  const future = await prisma.classInstance.findMany({
    where: { time: slot.time, status: 'SCHEDULED', date: { gte: cutoff } },
  });
  const toDelete = future.filter((ci) => ((ci.date.getUTCDay() + 6) % 7) === slot.dayOfWeek).map((ci) => ci.id);
  if (toDelete.length) await prisma.classInstance.deleteMany({ where: { id: { in: toDelete } } });
  res.json({ ok: true, futureInstancesRemoved: toDelete.length });
});

// ── One-off instance edit (single date, doesn't touch the template) ──────────
// PATCH /api/admin/classes/:id  { coachId?, time?, className? }
adminRouter.patch('/api/admin/classes/:id', async (req, res) => {
  const b = req.body || {};
  const ci = await prisma.classInstance.findUnique({ where: { id: req.params.id } });
  if (!ci) return res.status(404).json({ error: 'Class not found' });

  const data = {};
  if (b.time != null) {
    const time = String(b.time).trim();
    if (!TIME_RE.test(time)) return res.status(400).json({ error: 'Time must be HH:MM (24h)' });
    if (time !== ci.time) {
      const clash = await prisma.classInstance.findUnique({
        where: { date_time: { date: ci.date, time } },
      });
      if (clash) return res.status(409).json({ error: 'Another class already occupies that time on this date' });
      data.time = time;
    }
  }
  if (b.className != null) data.className = String(b.className).trim().slice(0, 60) || 'CrossFit';
  if (b.coachId != null) {
    const coach = await prisma.user.findUnique({ where: { id: String(b.coachId) } });
    if (!coach || !coach.active) return res.status(400).json({ error: 'Pick an active coach' });
    data.assignedId = coach.id;
  }

  const updated = await prisma.classInstance.update({
    where: { id: ci.id },
    data,
    include: { assigned: true, coveredBy: true },
  });
  res.json({
    class: {
      id: updated.id, date: toIsoDate(updated.date), time: updated.time, className: updated.className,
      status: updated.status,
      assigned: { id: updated.assigned.id, name: updated.assigned.name },
      coveredBy: updated.coveredBy ? { id: updated.coveredBy.id, name: updated.coveredBy.name } : null,
    },
  });
});

// ── Coverage stats ───────────────────────────────────────────────────────────
// GET /api/admin/stats → per-coach coverage tallies (last 30 days + all-time).
adminRouter.get('/api/admin/stats', async (_req, res) => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const coaches = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  // A CLAIMED class means coveredBy stepped in for assigned.
  const claimed = await prisma.classInstance.findMany({
    where: { status: 'CLAIMED', coveredById: { not: null } },
    select: { assignedId: true, coveredById: true, date: true },
  });

  const stat = {}; // id -> { covered30, covered, needed30, needed }
  for (const c of coaches) stat[c.id] = { covered30: 0, covered: 0, needed30: 0, needed: 0 };

  for (const ci of claimed) {
    const recent = ci.date >= cutoff;
    if (stat[ci.coveredById]) {
      stat[ci.coveredById].covered++;
      if (recent) stat[ci.coveredById].covered30++;
    }
    if (stat[ci.assignedId]) {
      stat[ci.assignedId].needed++;
      if (recent) stat[ci.assignedId].needed30++;
    }
  }

  const stats = coaches.map((c) => ({ id: c.id, name: c.name, ...stat[c.id] }));
  res.json({ stats });
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
