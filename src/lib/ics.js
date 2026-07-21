import { createEvent } from 'ics';
import { fmtTime, classLabel } from './format.js';

// Build a calendar invite (.ics) for a covering coach.
//
// The class date is stored at UTC midnight and `time` is the gym's local wall
// clock ("05:30"). We emit the event with local input type so it lands at the
// right wall-clock time in the coach's calendar regardless of their timezone.
//
// Returns { filename, content } ready to attach, or throws on error.
export function buildCoverageIcs({ instance, settings }) {
  const date = instance.date; // Date at UTC midnight
  const [h, m] = String(instance.time).split(':').map(Number);

  const title = `Coaching: ${instance.className} ${fmtTime(instance.time)} — covering for ${
    instance.assigned?.name ?? 'a coach'
  }`;

  const { error, value } = createEvent({
    title,
    description: `You're covering ${classLabel(instance)} at ${settings.gymName}.` +
      (instance.note ? `\nNote: ${instance.note}` : ''),
    location: `${settings.gymName}, ${settings.gymAddress}`,
    // [year, month(1-12), day, hour, minute]
    start: [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, m],
    startInputType: 'local',
    startOutputType: 'local',
    duration: { minutes: settings.classMinutes },
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    productId: 'cfp-coverage/ics',
  });

  if (error) throw error;
  return { filename: 'coverage.ics', content: value };
}
