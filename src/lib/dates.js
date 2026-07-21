// Date helpers. Class dates are stored as UTC-midnight "date only" values so the
// same calendar day is returned regardless of server timezone.

/** Parse a "YYYY-MM-DD" string to a Date at UTC midnight. Throws on bad input. */
export function parseIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${iso}`);
  return date;
}

/** Format a Date as "YYYY-MM-DD" using its UTC parts. */
export function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * dayOfWeek in our domain is 0=Mon … 6=Sun (per the brief), not JS's 0=Sun.
 * Convert a Date to that convention using UTC.
 */
export function mondayIndex(date) {
  return (date.getUTCDay() + 6) % 7; // Sun(0)->6, Mon(1)->0, ... Sat(6)->5
}

/** The UTC-midnight Monday on or before the given date. */
export function weekStart(date) {
  const start = new Date(date.getTime());
  start.setUTCDate(start.getUTCDate() - mondayIndex(start));
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** Add whole days to a UTC-midnight date, returning a new Date. */
export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** The 7 UTC-midnight dates (Mon..Sun) of the week containing `date`. */
export function weekDates(date) {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
