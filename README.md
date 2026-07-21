# CrossFit Prosperity — Coverage Board

Internal, coaches-only web app for managing class coverage at CrossFit Prosperity
(Norwood, MA). A coach opens one of their classes for coverage → all coaches are
notified → another coach claims it → both parties get confirmation with a calendar
invite, and the covering coach gets a 24h reminder.

## Stack

- **Backend:** Node.js + Express, Prisma, PostgreSQL
- **Frontend:** vanilla JS SPA (no build step), installable PWA (in progress)
- **Email:** Resend (with `.ics` calendar attachments), console fallback in dev
- **Auth:** magic-link only (long-lived HTTP-only session cookies)

## Local development

Requires Node 18+ and Docker (for local Postgres).

```bash
# 1. Start Postgres
docker compose up -d

# 2. Install deps
npm install

# 3. Set up the database + seed the real schedule
cp .env.example .env          # then set SESSION_SECRET (see .env.example)
npx prisma migrate dev
npm run db:seed

# 4. Run
npm run dev                   # http://localhost:3000
```

### Signing in (dev)

With no `RESEND_API_KEY` set, magic-link emails print to the server console.
The login page also shows a **Dev sign-in** picker — one click per seeded coach.
Admins: Sean, Craig. This picker disappears automatically once real email is
configured.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Run with `--watch` |
| `npm start` | Run |
| `npm run db:seed` | Seed coaches, template, notification defaults |
| `npm run db:reset` | Drop + recreate + reseed |
| `npm run db:studio` | Prisma Studio |

## Status

- ✅ Schema + seed, week API with lazy materialization
- ✅ Magic-link auth, sessions, roles
- ✅ The board (open/claim/cancel, optimistic UI, mobile day tabs, calendar picker)
- ✅ Notifications engine (3 events, `.ics` on claim) + admin panel
- ⏳ Coach + schedule management (admin)
- ⏳ PWA + push + 24h reminder cron

See `cfp-coverage-brief.md` for the full spec and `assets/mockup.html` for the
original design mockup.
