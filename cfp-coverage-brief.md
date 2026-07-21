# CrossFit Prosperity — Coverage Board: Project Brief

## What we're building

An internal, coaches-only web app for CrossFit Prosperity (Norwood, MA) that replaces the paper calendar + group-text workflow for class coverage. Roughly 12 coaches. Members never see this app.

Core loop: the weekly coaching schedule renders on a board → a coach opens one of their classes for coverage ("I'm on vacation") → all coaches are notified → another coach claims it → both parties get confirmation with a calendar invite, and the covering coach gets a reminder 24 hours before class.

A working interactive mockup exists: **`cfp-coverage-board-mobile.html`** (attached to this project). Treat it as the design spec — reuse its markup patterns, design tokens, and interaction flow rather than redesigning. Desktop shows a 7-day week grid; mobile (<760px) shows one day at a time with a day-tab bar, lime dots marking days with open classes, and alert cards that jump to their day.

## Stack

- **Backend:** Node.js + Express, Prisma, PostgreSQL (deploy target: Railway)
- **Frontend:** Server-rendered or lightweight SPA — keep it simple; vanilla JS or a minimal React setup is fine. This is a small CRUD app, not BoxPulse. Must work as an installable PWA.
- **Email:** Resend (free tier), with `.ics` calendar attachments generated via the `ics` npm package
- **Push:** `web-push` (VAPID) for PWA notifications
- **Jobs:** `node-cron` in-process (hourly reminder scan, weekly instance materialization)

## Design tokens (from the mockup)

```
--lime:#B2E51E  --bg:#0B0C0A  --panel:#141613  --panel-2:#1B1E19
--line:#272B24  --text:#F4F6EF  --muted:#9BA294  --red:#FF5340
Display font: Montserrat 800/900, uppercase, tracked
Body font: Barlow
Accent scrawl font: Permanent Marker (status stamps only)
```

Statuses: scheduled (default card), open (lime border + lime "needs coverage" scrawl, original coach struck through in red), claimed (dim green border + "covered ✓" + covering coach chip). The logged-in coach's own classes get a white border. Buttons: lime background, black uppercase text (matches the gym's site CTAs). Real logo file to be provided; the mockup's SVG kettlebell is a placeholder.

## Data model (Prisma)

```prisma
enum Role { ADMIN COACH }
enum ClassStatus { SCHEDULED OPEN CLAIMED }

model User {
  id               String   @id @default(cuid())
  email            String   @unique
  name             String   // display name, e.g. "Chris N."
  role             Role     @default(COACH)
  active           Boolean  @default(true)
  emailEnabled     Boolean  @default(true)
  pushSubscription Json?    // serialized PushSubscription, null if not enrolled
  loginTokens      LoginToken[]
  templateSlots    TemplateSlot[]
  assigned         ClassInstance[] @relation("assigned")
  covering         ClassInstance[] @relation("covering")
}

model LoginToken {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  usedAt    DateTime?
}

// The recurring weekly template (source of truth for a normal week)
model TemplateSlot {
  id        String @id @default(cuid())
  dayOfWeek Int    // 0=Mon … 6=Sun
  time      String // "05:30", 24h — render as 12h in UI
  className String @default("CrossFit")
  coachId   String
  coach     User   @relation(fields: [coachId], references: [id])
  @@unique([dayOfWeek, time])
}

// A concrete class on a concrete date (materialized from the template)
model ClassInstance {
  id            String      @id @default(cuid())
  date          DateTime    // date only, class day
  time          String
  className     String
  assignedId    String
  assigned      User        @relation("assigned", fields: [assignedId], references: [id])
  status        ClassStatus @default(SCHEDULED)
  coveredById   String?
  coveredBy     User?       @relation("covering", fields: [coveredById], references: [id])
  note          String?     // "vacation!" — free text from the requesting coach
  remindedAt    DateTime?   // set when the 24h reminder fires
  @@unique([date, time])
}
```

Materialization: a weekly cron (and a lazy fallback when a week is first requested) creates `ClassInstance` rows from `TemplateSlot` for the coming N weeks. Template edits only affect not-yet-materialized weeks; admins can also edit individual instances (one-off changes without touching the template).

## Seed data — the real weekly template

Coaches (all COACH unless noted): Hayley, Craig (**ADMIN**), Chris N., Chris D., Carey, Sean (**ADMIN**), Stew, Tracy, Verena, Sam, Jenn, Chris. Seed emails as placeholders; Sean/Craig will fill in real ones via the admin screen.

```
Mon: 05:30 Hayley · 06:45 Hayley · 08:00 Hayley · 09:15 Craig · 12:00 Craig · 17:00 Chris N. · 18:15 Chris N.
Tue: 05:30 Chris D. · 06:45 Chris D. · 08:00 Chris D. · 12:00 Chris D. · 17:00 Carey · 18:15 Carey
Wed: 05:30 Sean · 06:45 Sean · 08:00 Sean · 09:15 Craig · 12:00 Craig · 17:00 Stew · 18:15 Stew
Thu: 05:30 Tracy · 06:45 Tracy · 08:00 Tracy · 12:00 Verena · 17:00 Sam
Fri: 05:30 Jenn · 06:45 Jenn · 08:00 Craig · 09:15 Verena · 12:00 Verena · 17:00 Jenn
Sat: 09:00 Craig
Sun: 09:00 Chris · 10:00 Chris
```

## Auth

Magic-link only — no passwords for a 12-person internal tool. Admin creates a user with name + email; the coach receives a sign-in link; sessions are long-lived HTTP-only cookies (90 days) so coaches rarely re-authenticate on their phones. Only ADMINs can create/deactivate users, edit the template, and edit any instance. Coaches can only open/cancel coverage on their own classes and claim open classes that aren't theirs.

## API

```
POST /auth/request-link        { email } → sends magic link
GET  /auth/verify?token=…      → sets session cookie, redirects to board
GET  /api/week/:isoDate        → materialized instances for that week + open count per day
POST /api/classes/:id/open     { note? }   (own class, SCHEDULED→OPEN)
POST /api/classes/:id/cancel   (own class, OPEN→SCHEDULED)
POST /api/classes/:id/claim    (not own class, OPEN→CLAIMED)
POST /api/push/subscribe       { subscription }
Admin:
GET/POST/PATCH /api/coaches    · PATCH /api/template · PATCH /api/classes/:id
```

Guard every state transition server-side (e.g. claiming an already-claimed class returns 409 with a friendly message — two coaches will race for popular slots).

## Notifications

One channel-agnostic entry point: `notify(userIds, event)` fans out to email and/or push per each user's settings. Events:

1. **Class opened** → all active coaches except the requester: "Thu 5:30 AM needs coverage — Tracy (vacation!)" with a deep link to that day.
2. **Class claimed** → requester + admins: "Carey is covering Fri 5:00 PM." The covering coach gets a confirmation **email with an `.ics` attachment** (event titled "Coaching: CrossFit 5:00 PM — covering for Jenn", 75-minute duration, gym address as location).
3. **24h reminder** → hourly cron finds CLAIMED instances starting 23–25h out with `remindedAt = null`, notifies the covering coach, sets `remindedAt`.

## Build order

1. **Scaffold + schema + seed.** Repo, Express app, Prisma migrate, seed script from the template above. Acceptance: `GET /api/week/2026-07-13` returns the real schedule.
2. **Auth.** Magic links via Resend, sessions, role middleware. Acceptance: admin creates a coach, coach signs in from email on a phone.
3. **The board.** Port the mockup against the real API — week nav, open/claim/cancel flow, optimistic UI with server reconciliation, mobile day tabs. Acceptance: full coverage loop works end-to-end between two logged-in users.
4. **Email + ICS.** The three notification events, calendar attachment on claim. Acceptance: claiming a class lands an invite in Apple/Google Calendar.
5. **PWA + push + reminders.** Manifest, service worker, install flow, push subscribe toggle in a small settings screen, reminder cron. Acceptance: phone gets a push when a class opens; reminder fires 24h out exactly once.
6. **Admin screens.** Coach management, template editor, one-off instance edits.

## Non-goals (v1)

No WodHopper integration, no member-facing anything, no shift-swap negotiation (first claim wins), no payroll/hours tracking, no SMS (revisit Twilio + A2P 10DLC later only if coaches ask for real texts).
