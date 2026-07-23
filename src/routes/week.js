import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { parseIsoDate, toIsoDate, weekDates, weekStart } from '../lib/dates.js';
import { materializeWeek } from '../lib/materialize.js';

export const weekRouter = Router();

// GET /api/open-classes — every class still needing coverage (OPEN), from the
// current week forward, soonest first. Lets coaches see all open classes in one
// place instead of paging through weeks.
weekRouter.get('/api/open-classes', async (_req, res) => {
  const from = weekStart(new Date()); // start of the current week (don't show past)
  const instances = await prisma.classInstance.findMany({
    where: { status: 'OPEN', date: { gte: from } },
    include: { assigned: true, coveredBy: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });
  res.json({ classes: instances.map(serializeInstance) });
});

// Shape a ClassInstance (with assigned/coveredBy included) for the API.
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

// GET /api/week/:isoDate — materialized instances for that week + open count per day.
weekRouter.get('/api/week/:isoDate', async (req, res) => {
  let anchor;
  try {
    anchor = parseIsoDate(req.params.isoDate);
  } catch {
    return res.status(400).json({ error: 'isoDate must be YYYY-MM-DD' });
  }

  const dates = weekDates(anchor); // Mon..Sun, UTC midnight
  const weekStartIso = toIsoDate(dates[0]);

  // Lazy materialization: fill in any missing instances for this week.
  const created = await materializeWeek(anchor);

  const instances = await prisma.classInstance.findMany({
    where: { date: { in: dates } },
    include: { assigned: true, coveredBy: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });

  // Group by day (0=Mon..6=Sun) and tally open classes per day.
  const days = dates.map((d) => ({
    date: toIsoDate(d),
    classes: [],
    openCount: 0,
  }));
  const indexByIso = new Map(days.map((d, i) => [d.date, i]));

  for (const ci of instances) {
    const iso = toIsoDate(ci.date);
    const idx = indexByIso.get(iso);
    if (idx === undefined) continue;
    days[idx].classes.push(serializeInstance(ci));
    if (ci.status === 'OPEN') days[idx].openCount++;
  }

  res.json({
    weekStart: weekStartIso,
    materialized: created,
    days,
  });
});
