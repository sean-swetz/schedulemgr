import { prisma } from './prisma.js';
import { notify, getSettings } from './notify.js';
import { materializeWeek } from './materialize.js';
import { weekStart, weekDates, addDays, toIsoDate } from './dates.js';
import { classLabel } from './format.js';

// Combine a class instance's date (UTC midnight) + "HH:MM" local time into an
// absolute Date. Class times are gym-local wall clock; the server runs in that
// timezone (or close enough for a 12-person tool), so we build a local Date.
function instanceStart(ci) {
  const [h, m] = String(ci.time).split(':').map(Number);
  const d = ci.date; // UTC midnight
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0, 0);
}

/**
 * 24h reminder (brief milestone-3 event #3): find CLAIMED instances starting
 * 23–25h from now with remindedAt=null, notify the covering coach, set remindedAt.
 * Idempotent — remindedAt guarantees a reminder fires at most once.
 */
export async function runReminders(now = new Date()) {
  const from = new Date(now.getTime() + 23 * 3600 * 1000);
  const to = new Date(now.getTime() + 25 * 3600 * 1000);

  const claimed = await prisma.classInstance.findMany({
    where: { status: 'CLAIMED', remindedAt: null, coveredById: { not: null } },
    include: { assigned: true, coveredBy: true },
  });

  let fired = 0;
  for (const ci of claimed) {
    const start = instanceStart(ci);
    if (start < from || start > to) continue;
    // Claim remindedAt first (guards against a double-run firing twice).
    const claimedRow = await prisma.classInstance.updateMany({
      where: { id: ci.id, remindedAt: null },
      data: { remindedAt: new Date(now) },
    });
    if (claimedRow.count !== 1) continue;
    await notify([ci.coveredById], { type: 'REMINDER_24H', instance: ci });
    fired++;
  }
  return fired;
}

/**
 * Uncovered-class escalation: classes still OPEN and starting within the
 * configured window (settings.escalationHours) → notify admins. Uses remindedAt
 * on the OPEN instance as a "already escalated" marker so it fires once.
 */
export async function runEscalation(now = new Date()) {
  const settings = await getSettings();
  const windowEnd = new Date(now.getTime() + settings.escalationHours * 3600 * 1000);

  const open = await prisma.classInstance.findMany({
    where: { status: 'OPEN', remindedAt: null },
    include: { assigned: true },
  });
  const admins = await prisma.user.findMany({ where: { active: true, role: 'ADMIN' }, select: { id: true } });
  const adminIds = admins.map((a) => a.id);

  let fired = 0;
  for (const ci of open) {
    const start = instanceStart(ci);
    if (start < now || start > windowEnd) continue; // only upcoming, within window
    const claimedRow = await prisma.classInstance.updateMany({
      where: { id: ci.id, status: 'OPEN', remindedAt: null },
      data: { remindedAt: new Date(now) },
    });
    if (claimedRow.count !== 1) continue;
    await notify(adminIds, { type: 'UNCOVERED_ESCALATION', instance: ci });
    fired++;
  }
  return fired;
}

/**
 * Weekly digest: on the configured day/hour, email all active coaches the list
 * of classes still OPEN in the coming week. Returns the number of open classes
 * included (0 → nothing sent).
 */
export async function runWeeklyDigest(now = new Date()) {
  // The coming week = next week's Mon..Sun.
  const start = addDays(weekStart(now), 7);
  const dates = weekDates(start);

  const open = await prisma.classInstance.findMany({
    where: { status: 'OPEN', date: { in: dates } },
    include: { assigned: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });
  if (open.length === 0) return 0;

  const list = open.map((ci) => `• ${classLabel(ci)} (usually ${ci.assigned.name})`).join('\n');
  const coaches = await prisma.user.findMany({ where: { active: true }, select: { id: true } });

  await notify(coaches.map((c) => c.id), {
    type: 'WEEKLY_DIGEST',
    instance: null,
    extra: { vars: { list } },
  });
  return open.length;
}

/**
 * Weekly materialization: ensure ClassInstance rows exist for the next N weeks.
 */
export async function runMaterialization(now = new Date(), weeksAhead = Number(process.env.MATERIALIZE_WEEKS_AHEAD) || 6) {
  let total = 0;
  for (let w = 0; w <= weeksAhead; w++) {
    total += await materializeWeek(addDays(now, w * 7));
  }
  return total;
}

/** Should the weekly digest run at this local hour? (day + hour match settings) */
export async function digestDue(now = new Date()) {
  const s = await getSettings();
  const dow = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
  return dow === s.digestDayOfWeek && now.getHours() === s.digestHour;
}

export { toIsoDate };
