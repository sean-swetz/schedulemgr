import { prisma } from './prisma.js';
import { sendEmail } from './mailer.js';
import { getSettings } from './notify.js';

// Resolve a recipient spec to a list of active users.
//   { audience: 'all' | 'admins' | 'coaches' }  or  { userIds: [...] }
async function resolveRecipients(spec) {
  if (Array.isArray(spec.userIds) && spec.userIds.length) {
    return prisma.user.findMany({ where: { id: { in: spec.userIds }, active: true } });
  }
  const where = { active: true };
  if (spec.audience === 'admins') where.role = 'ADMIN';
  else if (spec.audience === 'coaches') where.role = 'COACH';
  // 'all' → no extra filter
  return prisma.user.findMany({ where });
}

async function log(entry) {
  try {
    await prisma.notificationLog.create({ data: { event: 'BROADCAST', channel: 'EMAIL', ...entry } });
  } catch (err) {
    console.error('Failed to write broadcast log:', err);
  }
}

/**
 * Send an admin-composed announcement. Respects each coach's emailEnabled flag.
 * Returns a summary { sent, skipped, failed, recipients }.
 */
export async function sendBroadcast({ subject, body, spec }) {
  const settings = await getSettings();
  const from = `${settings.fromName} <${settings.fromEmail}>`;
  const users = await resolveRecipients(spec);

  let sent = 0, skipped = 0, failed = 0;
  for (const user of users) {
    if (!user.emailEnabled) {
      skipped++;
      await log({ status: 'SKIPPED', userId: user.id, toAddress: user.email, subject, detail: 'email disabled for user' });
      continue;
    }
    try {
      await sendEmail({
        to: user.email,
        subject,
        text: body,
        from,
        replyTo: settings.replyTo || undefined,
        apiKey: settings.resendApiKey || undefined,
      });
      sent++;
      await log({ status: 'SENT', userId: user.id, toAddress: user.email, subject });
    } catch (err) {
      failed++;
      await log({ status: 'FAILED', userId: user.id, toAddress: user.email, subject, detail: String(err.message || err) });
      console.error(`broadcast: email to ${user.email} failed:`, err);
    }
  }
  return { sent, skipped, failed, recipients: users.length };
}
