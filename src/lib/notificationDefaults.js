// Default copy for the three notification events. Admins can edit these later;
// these seed the NotificationTemplate rows and act as the fallback if a row is
// missing. Placeholders in {braces} are filled by the notify engine.
//
// Available placeholders:
//   {coach}    — the assigned coach's name
//   {coverer}  — the covering coach's name (claim/reminder)
//   {class}    — e.g. "Thu 5:30 AM CrossFit"
//   {note}     — the requesting coach's free-text note (may be empty)
//   {gym}      — gym name
export const DEFAULT_TEMPLATES = {
  CLASS_OPENED: {
    subject: '{class} needs coverage',
    body: '{class} needs coverage — {coach}{note}. Open the board to claim it.',
    enabled: true,
  },
  CLASS_CLAIMED: {
    subject: '{coverer} is covering {class}',
    body: '{coverer} is covering {class} (originally {coach}).',
    enabled: true,
  },
  REMINDER_24H: {
    subject: 'Reminder: you’re coaching {class} tomorrow',
    body: 'Heads up — you’re covering {class} at {gym} in about 24 hours. Thanks for stepping in!',
    enabled: true,
  },
  WEEKLY_DIGEST: {
    subject: 'Open classes this week at {gym}',
    body: 'Here are the classes still needing coverage this week:\n{list}\n\nOpen the board to claim one.',
    enabled: true,
  },
  UNCOVERED_ESCALATION: {
    subject: 'Still uncovered: {class}',
    body: '{class} is starting soon and still needs a coach (originally {coach}). Can anyone cover?',
    enabled: true,
  },
  COVERAGE_REQUESTED_BULK: {
    subject: '{coach} needs coverage for {count} classes',
    body: '{coach} needs coverage for these classes{note}:\n{list}\n\nOpen the board to claim any of them.',
    enabled: true,
  },
};
