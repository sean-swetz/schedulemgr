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
};
