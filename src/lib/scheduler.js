import cron from 'node-cron';
import { runReminders, runEscalation, runWeeklyDigest, runMaterialization, digestDue } from './jobs.js';

// In-process scheduler. Kept simple: an hourly tick handles the time-sensitive
// scans; a daily tick handles materialization. All jobs are idempotent.
export function startScheduler() {
  // Hourly, on the hour.
  cron.schedule('0 * * * *', async () => {
    try {
      const reminded = await runReminders();
      const escalated = await runEscalation();
      if (reminded || escalated) {
        console.log(`[cron] reminders=${reminded} escalations=${escalated}`);
      }
      if (await digestDue()) {
        const n = await runWeeklyDigest();
        console.log(`[cron] weekly digest sent (${n} open classes)`);
      }
    } catch (err) {
      console.error('[cron] hourly job error:', err);
    }
  });

  // Daily at 03:00 — materialize upcoming weeks.
  cron.schedule('0 3 * * *', async () => {
    try {
      const created = await runMaterialization();
      if (created) console.log(`[cron] materialized ${created} class instances`);
    } catch (err) {
      console.error('[cron] materialization error:', err);
    }
  });

  console.log('Scheduler started (hourly reminders/escalation/digest, daily materialization).');
}
