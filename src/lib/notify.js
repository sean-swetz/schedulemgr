import { prisma } from './prisma.js';
import { sendEmail } from './mailer.js';
import { DEFAULT_TEMPLATES } from './notificationDefaults.js';
import { classLabel } from './format.js';

// Channel-agnostic notification entry point. Fans out an event to a set of users
// over email (push added in the PWA milestone), rendering the admin-editable
// template and logging every attempt.
//
//   await notify(userIds, {
//     type: 'CLASS_OPENED',
//     instance,              // ClassInstance with assigned (+ coveredBy) included
//     extra: { attachments } // optional, e.g. .ics on claim
//   });

const singletonSettings = { id: 'singleton' };

async function getSettings() {
  const s = await prisma.settings.findUnique({ where: singletonSettings });
  // Fall back to schema defaults if the row somehow doesn't exist yet.
  return (
    s || {
      fromName: 'CFP Coverage',
      fromEmail: 'onboarding@resend.dev',
      replyTo: null,
      gymName: 'CrossFit Prosperity',
      gymAddress: 'Norwood, MA',
      classMinutes: 75,
      ccAdminsOnClaim: true,
    }
  );
}

async function getTemplate(event) {
  const row = await prisma.notificationTemplate.findUnique({ where: { event } });
  if (row) return row;
  const d = DEFAULT_TEMPLATES[event];
  return { event, subject: d.subject, body: d.body, enabled: d.enabled };
}

// Fill {placeholders}. Unknown tokens are left as-is intentionally (visible bug > silent).
function fill(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

function buildVars(instance, settings) {
  // instance may be null for events not tied to a single class (e.g. digest).
  const note = instance?.note ? ` (${instance.note})` : '';
  return {
    coach: instance?.assigned?.name ?? '',
    coverer: instance?.coveredBy?.name ?? '',
    class: instance ? classLabel(instance) : '',
    note,
    gym: settings.gymName,
  };
}

async function log(entry) {
  try {
    await prisma.notificationLog.create({ data: entry });
  } catch (err) {
    console.error('Failed to write NotificationLog:', err);
  }
}

/**
 * @param {string[]} userIds  recipients (deduped; missing/inactive skipped)
 * @param {{type:string, instance:object, extra?:{attachments?:any[]}}} event
 */
export async function notify(userIds, event) {
  const { type, instance, extra = {} } = event;
  const settings = await getSettings();
  const template = await getTemplate(type);

  // Gym-wide toggle: event paused → log SKIPPED per recipient, send nothing.
  const paused = !template.enabled;

  const vars = { ...buildVars(instance, settings), ...(extra.vars || {}) };
  const subject = fill(template.subject, vars);
  const body = fill(template.body, vars);
  const from = `${settings.fromName} <${settings.fromEmail}>`;

  const ids = [...new Set(userIds)].filter(Boolean);
  const users = await prisma.user.findMany({ where: { id: { in: ids } } });

  for (const user of users) {
    if (!user.active) continue;

    if (paused) {
      await log({ event: type, channel: 'EMAIL', status: 'SKIPPED', userId: user.id,
        toAddress: user.email, subject, detail: 'event disabled' });
      continue;
    }
    if (!user.emailEnabled) {
      await log({ event: type, channel: 'EMAIL', status: 'SKIPPED', userId: user.id,
        toAddress: user.email, subject, detail: 'email disabled for user' });
      continue;
    }

    try {
      await sendEmail({
        to: user.email,
        subject,
        text: body,
        from,
        replyTo: settings.replyTo || undefined,
        attachments: extra.attachments,
        apiKey: settings.resendApiKey || undefined,
      });
      await log({ event: type, channel: 'EMAIL', status: 'SENT', userId: user.id,
        toAddress: user.email, subject });
    } catch (err) {
      await log({ event: type, channel: 'EMAIL', status: 'FAILED', userId: user.id,
        toAddress: user.email, subject, detail: String(err.message || err) });
      console.error(`notify: email to ${user.email} failed:`, err);
    }
  }
}

export { getSettings };
