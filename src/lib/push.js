import webpush from 'web-push';
import { prisma } from './prisma.js';

let configured = false;
export function pushEnabled() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send a push to one user's stored subscription.
 * @returns {'sent'|'skipped'|'gone'|'failed'} outcome
 * Dead subscriptions (404/410) are pruned and reported as 'gone'.
 */
export async function sendPushToUser(user, payload) {
  if (!pushEnabled()) return 'skipped';
  if (!user.pushSubscription) return 'skipped';

  try {
    await webpush.sendNotification(user.pushSubscription, JSON.stringify(payload));
    return 'sent';
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Subscription expired/unsubscribed — clear it so we stop trying.
      await prisma.user.update({ where: { id: user.id }, data: { pushSubscription: null } }).catch(() => {});
      return 'gone';
    }
    console.error(`push to ${user.email} failed:`, err.statusCode || err.message);
    return 'failed';
  }
}
