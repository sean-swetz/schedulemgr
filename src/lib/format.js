// Shared formatting helpers used by notifications (and mirrored on the client).

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17:00" (24h) -> "5:00 PM". */
export function fmtTime(t24) {
  const [h, m] = String(t24).split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** dayOfWeek label from a UTC-midnight date, 0=Mon..6=Sun convention. */
export function dowLabel(date) {
  return DOW[(date.getUTCDay() + 6) % 7];
}

/** "Thu 5:30 AM CrossFit" from a ClassInstance-like {date,time,className}. */
export function classLabel(ci) {
  return `${dowLabel(ci.date)} ${fmtTime(ci.time)} ${ci.className}`;
}

/** "Thu, Jul 23" from a UTC-midnight date — for use standalone from the time. */
export function dateLabel(date) {
  return `${dowLabel(date)}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
