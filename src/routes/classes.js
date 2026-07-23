import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { toIsoDate } from '../lib/dates.js';
import { notify, getSettings } from '../lib/notify.js';
import { buildCoverageIcs } from '../lib/ics.js';
import { classLabel } from '../lib/format.js';

export const classesRouter = Router();

// Fire-and-forget: a slow or failed email must never break a coach's action.
function fireAndForget(promise) {
  Promise.resolve(promise).catch((err) => console.error('notification error:', err));
}

// All active coaches except the given id (used for the "class opened" fan-out).
async function otherActiveCoachIds(exceptId) {
  const users = await prisma.user.findMany({
    where: { active: true, id: { not: exceptId } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function adminIds() {
  const admins = await prisma.user.findMany({
    where: { active: true, role: 'ADMIN' },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

// Shape a ClassInstance (with assigned/coveredBy) the same way the week endpoint does.
function serializeInstance(ci) {
  return {
    id: ci.id,
    date: toIsoDate(ci.date),
    time: ci.time,
    className: ci.className,
    status: ci.status,
    note: ci.note,
    assigned: { id: ci.assigned.id, name: ci.assigned.name },
    coveredBy: ci.coveredBy ? { id: ci.coveredBy.id, name: ci.coveredBy.name } : null,
  };
}

async function loadWithRelations(id) {
  return prisma.classInstance.findUnique({
    where: { id },
    include: { assigned: true, coveredBy: true },
  });
}

// POST /api/classes/:id/open { note? }  — own class, SCHEDULED → OPEN
classesRouter.post('/api/classes/:id/open', async (req, res) => {
  const { id } = req.params;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : null;

  const ci = await prisma.classInstance.findUnique({ where: { id } });
  if (!ci) return res.status(404).json({ error: 'Class not found' });
  if (ci.assignedId !== req.user.id) {
    return res.status(403).json({ error: 'You can only open your own classes' });
  }

  // Guarded transition: only flips if still SCHEDULED.
  const result = await prisma.classInstance.updateMany({
    where: { id, status: 'SCHEDULED' },
    data: { status: 'OPEN', note: note || null },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'That class is no longer available to open' });
  }

  const instance = await loadWithRelations(id);
  res.json({ class: serializeInstance(instance) });

  // Notify all other active coaches that this class needs coverage.
  fireAndForget(
    (async () => {
      const recipients = await otherActiveCoachIds(req.user.id);
      await notify(recipients, { type: 'CLASS_OPENED', instance });
    })()
  );
});

// POST /api/classes/bulk-open  { ids:[], note? } — open several of your own
// SCHEDULED classes at once (e.g. a week off), with ONE combined notification.
classesRouter.post('/api/classes/bulk-open', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : null;
  if (ids.length === 0) return res.status(400).json({ error: 'No classes selected' });

  // Only the requester's own, still-SCHEDULED classes flip. Others are ignored.
  const result = await prisma.classInstance.updateMany({
    where: { id: { in: ids }, assignedId: req.user.id, status: 'SCHEDULED' },
    data: { status: 'OPEN', note: note || null },
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'None of those classes could be opened' });
  }

  const opened = await prisma.classInstance.findMany({
    where: { id: { in: ids }, assignedId: req.user.id, status: 'OPEN' },
    include: { assigned: true, coveredBy: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });

  res.json({ opened: opened.map(serializeInstance), count: opened.length });

  // One combined notification to all other coaches.
  fireAndForget(
    (async () => {
      const recipients = await otherActiveCoachIds(req.user.id);
      const list = opened.map((ci) => `• ${classLabel(ci)}`).join('\n');
      await notify(recipients, {
        type: 'COVERAGE_REQUESTED_BULK',
        instance: opened[0], // provides {coach}, {note}, etc.
        extra: { vars: { list, count: String(opened.length) } },
      });
    })()
  );
});

// POST /api/classes/:id/cancel  — own class, OPEN → SCHEDULED
classesRouter.post('/api/classes/:id/cancel', async (req, res) => {
  const { id } = req.params;

  const ci = await prisma.classInstance.findUnique({ where: { id } });
  if (!ci) return res.status(404).json({ error: 'Class not found' });
  if (ci.assignedId !== req.user.id) {
    return res.status(403).json({ error: 'You can only cancel your own coverage requests' });
  }

  const result = await prisma.classInstance.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'SCHEDULED', note: null, coveredById: null },
  });
  if (result.count !== 1) {
    // Already claimed or already scheduled — can't cancel.
    return res.status(409).json({ error: 'That request can no longer be canceled' });
  }

  res.json({ class: serializeInstance(await loadWithRelations(id)) });
});

// POST /api/classes/:id/claim  — not own class, OPEN → CLAIMED
classesRouter.post('/api/classes/:id/claim', async (req, res) => {
  const { id } = req.params;

  const ci = await prisma.classInstance.findUnique({ where: { id } });
  if (!ci) return res.status(404).json({ error: 'Class not found' });
  if (ci.assignedId === req.user.id) {
    return res.status(400).json({ error: "You can't cover your own class" });
  }

  // Guarded transition: only the first claimer wins the OPEN→CLAIMED flip.
  const result = await prisma.classInstance.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'CLAIMED', coveredById: req.user.id },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'Someone just claimed this class' });
  }

  const instance = await loadWithRelations(id);
  res.json({ class: serializeInstance(instance) });

  // Notify: requester + admins get the informational "X is covering" message;
  // the covering coach gets a confirmation with a calendar invite (.ics) attached.
  fireAndForget(
    (async () => {
      const admins = await adminIds();
      const informed = [instance.assignedId, ...admins].filter((uid) => uid !== req.user.id);
      await notify(informed, { type: 'CLASS_CLAIMED', instance });

      let attachments;
      try {
        const settings = await getSettings();
        attachments = [buildCoverageIcs({ instance, settings })];
      } catch (err) {
        console.error('Failed to build .ics:', err);
      }
      await notify([req.user.id], { type: 'CLASS_CLAIMED', instance, extra: { attachments } });
    })()
  );
});

// POST /api/classes/:id/unclaim — coverer (or an admin) backs out, CLAIMED → OPEN.
// Puts it back up for grabs rather than reverting to SCHEDULED, since the
// original coach still needs coverage.
classesRouter.post('/api/classes/:id/unclaim', async (req, res) => {
  const { id } = req.params;

  const ci = await prisma.classInstance.findUnique({ where: { id } });
  if (!ci) return res.status(404).json({ error: 'Class not found' });
  if (ci.coveredById !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only the covering coach (or an admin) can release this class' });
  }

  const result = await prisma.classInstance.updateMany({
    where: { id, status: 'CLAIMED' },
    data: { status: 'OPEN', coveredById: null },
  });
  if (result.count !== 1) {
    return res.status(409).json({ error: 'That class is no longer claimed' });
  }

  const instance = await loadWithRelations(id);
  res.json({ class: serializeInstance(instance) });

  // Let the original coach (and other coaches) know it's open again.
  fireAndForget(
    (async () => {
      const recipients = await otherActiveCoachIds(req.user.id);
      await notify(recipients, { type: 'CLASS_OPENED', instance });
    })()
  );
});
