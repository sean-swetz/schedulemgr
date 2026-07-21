import { PrismaClient } from '@prisma/client';
import { DEFAULT_TEMPLATES } from '../src/lib/notificationDefaults.js';

const prisma = new PrismaClient();

// Coaches from the brief. Emails are placeholders — Sean/Craig fill in real ones
// via the admin screen later. Keyed by the short name used in the grid below.
const COACHES = [
  { key: 'Hayley', name: 'Hayley', role: 'COACH' },
  { key: 'Craig', name: 'Craig', role: 'ADMIN' },
  { key: 'Chris N.', name: 'Chris N.', role: 'COACH' },
  { key: 'Chris D.', name: 'Chris D.', role: 'COACH' },
  { key: 'Carey', name: 'Carey', role: 'COACH' },
  { key: 'Sean', name: 'Sean', role: 'ADMIN' },
  { key: 'Stew', name: 'Stew', role: 'COACH' },
  { key: 'Tracy', name: 'Tracy', role: 'COACH' },
  { key: 'Verena', name: 'Verena', role: 'COACH' },
  { key: 'Sam', name: 'Sam', role: 'COACH' },
  { key: 'Jenn', name: 'Jenn', role: 'COACH' },
  { key: 'Chris', name: 'Chris', role: 'COACH' },
];

// Placeholder email from a coach key, e.g. "Chris N." -> "chris.n@cfp-coaches.local"
function placeholderEmail(key) {
  const slug = key
    .toLowerCase()
    .replace(/\./g, '')
    .trim()
    .replace(/\s+/g, '.');
  return `${slug}@cfp-coaches.local`;
}

// The real weekly template. dayOfWeek: 0=Mon … 6=Sun. Each entry [time, coachKey].
const TEMPLATE = {
  0: [ // Mon
    ['05:30', 'Hayley'], ['06:45', 'Hayley'], ['08:00', 'Hayley'],
    ['09:15', 'Craig'], ['12:00', 'Craig'],
    ['17:00', 'Chris N.'], ['18:15', 'Chris N.'],
  ],
  1: [ // Tue
    ['05:30', 'Chris D.'], ['06:45', 'Chris D.'], ['08:00', 'Chris D.'], ['12:00', 'Chris D.'],
    ['17:00', 'Carey'], ['18:15', 'Carey'],
  ],
  2: [ // Wed
    ['05:30', 'Sean'], ['06:45', 'Sean'], ['08:00', 'Sean'],
    ['09:15', 'Craig'], ['12:00', 'Craig'],
    ['17:00', 'Stew'], ['18:15', 'Stew'],
  ],
  3: [ // Thu
    ['05:30', 'Tracy'], ['06:45', 'Tracy'], ['08:00', 'Tracy'],
    ['12:00', 'Verena'], ['17:00', 'Sam'],
  ],
  4: [ // Fri
    ['05:30', 'Jenn'], ['06:45', 'Jenn'], ['08:00', 'Craig'],
    ['09:15', 'Verena'], ['12:00', 'Verena'], ['17:00', 'Jenn'],
  ],
  5: [ // Sat
    ['09:00', 'Craig'],
  ],
  6: [ // Sun
    ['09:00', 'Chris'], ['10:00', 'Chris'],
  ],
};

async function main() {
  // Upsert coaches (idempotent by email).
  const idByKey = {};
  for (const c of COACHES) {
    const email = placeholderEmail(c.key);
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: c.name, role: c.role },
      create: { email, name: c.name, role: c.role },
    });
    idByKey[c.key] = user.id;
  }
  console.log(`Seeded ${COACHES.length} coaches.`);

  // Upsert template slots (idempotent by @@unique([dayOfWeek, time])).
  let slotCount = 0;
  for (const [dow, entries] of Object.entries(TEMPLATE)) {
    const dayOfWeek = Number(dow);
    for (const [time, coachKey] of entries) {
      const coachId = idByKey[coachKey];
      if (!coachId) throw new Error(`Unknown coach in template: ${coachKey}`);
      await prisma.templateSlot.upsert({
        where: { dayOfWeek_time: { dayOfWeek, time } },
        update: { coachId, className: 'CrossFit' },
        create: { dayOfWeek, time, coachId, className: 'CrossFit' },
      });
      slotCount++;
    }
  }
  console.log(`Seeded ${slotCount} template slots.`);

  // Notification templates — create if missing, don't clobber admin edits.
  let tplCount = 0;
  for (const [event, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
    await prisma.notificationTemplate.upsert({
      where: { event },
      update: {}, // preserve any admin edits on re-seed
      create: { event, subject: tpl.subject, body: tpl.body, enabled: tpl.enabled },
    });
    tplCount++;
  }
  console.log(`Ensured ${tplCount} notification templates.`);

  // Settings singleton — create if missing.
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  console.log('Ensured settings singleton.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
