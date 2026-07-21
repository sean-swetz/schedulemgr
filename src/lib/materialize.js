import { prisma } from './prisma.js';
import { mondayIndex, weekDates } from './dates.js';

/**
 * Ensure ClassInstance rows exist for every TemplateSlot in the week containing
 * `anyDateInWeek`. Idempotent: existing instances are left untouched (so an OPEN
 * or CLAIMED class survives re-materialization), only missing ones are created.
 *
 * Template edits only affect not-yet-materialized weeks — matching the brief:
 * because we skip dates that already have a (date,time) row, editing a template
 * slot won't rewrite an already-materialized week.
 *
 * Returns the number of instances created.
 */
export async function materializeWeek(anyDateInWeek) {
  const slots = await prisma.templateSlot.findMany();
  if (slots.length === 0) return 0;

  const dates = weekDates(anyDateInWeek); // Mon..Sun, UTC midnight, indexed 0..6

  // Existing (date,time) pairs in this week, so we don't attempt duplicate creates.
  const existing = await prisma.classInstance.findMany({
    where: { date: { in: dates } },
    select: { date: true, time: true },
  });
  const seen = new Set(existing.map((e) => `${e.date.toISOString()}|${e.time}`));

  const toCreate = [];
  for (const slot of slots) {
    const date = dates[slot.dayOfWeek]; // dayOfWeek: 0=Mon..6=Sun matches dates[]
    const key = `${date.toISOString()}|${slot.time}`;
    if (seen.has(key)) continue;
    toCreate.push({
      date,
      time: slot.time,
      className: slot.className,
      assignedId: slot.coachId,
      status: 'SCHEDULED',
    });
  }

  if (toCreate.length === 0) return 0;

  // createMany with skipDuplicates guards against a concurrent materialization
  // racing us on the @@unique([date, time]) constraint.
  const result = await prisma.classInstance.createMany({
    data: toCreate,
    skipDuplicates: true,
  });
  return result.count;
}

// Re-exported for callers that want the day-index convention.
export { mondayIndex };
