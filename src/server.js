import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weekRouter } from './routes/week.js';
import { authRouter } from './routes/auth.js';
import { classesRouter } from './routes/classes.js';
import { adminRouter } from './routes/admin.js';
import { pushRouter } from './routes/push.js';
import { loadUser, requireAuth } from './lib/authMiddleware.js';
import { prisma } from './lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(loadUser); // populates req.user (or null) from the session cookie

// Static frontend — public assets. All *data* lives behind /api guards below,
// so serving the HTML/JS shell openly is fine; it redirects to login client-side.
app.use(express.static(publicDir));

// Health check (public).
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Auth (public endpoints).
app.use(authRouter);

// Who am I — returns the signed-in coach, or 401 if not signed in.
app.get('/api/me', requireAuth, (req, res) => {
  const { id, email, name, role } = req.user;
  res.json({ id, email, name, role });
});

// Everything else under /api requires a signed-in coach.
app.use('/api', requireAuth);
app.use(weekRouter);
app.use(classesRouter);
app.use(pushRouter);
app.use(adminRouter); // requireAdmin is applied inside for /api/admin/*

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`CFP Coverage Board API listening on http://localhost:${port}`);
});

// In-process scheduled jobs (reminders, escalation, digest, materialization).
// Skip under `node --watch` reloads' duplicate spawns and in test runs.
if (process.env.DISABLE_CRON !== '1') {
  const { startScheduler } = await import('./lib/scheduler.js');
  startScheduler();
}

// Graceful shutdown so `node --watch` restarts and Ctrl-C don't leak connections.
async function shutdown() {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
