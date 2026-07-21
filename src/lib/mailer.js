import { Resend } from 'resend';

// Lazily construct (and cache) a Resend client per API key. The key can come from
// the admin panel (DB, passed as `apiKey`) or fall back to the env var.
const clients = new Map();
function client(apiKey) {
  const key = apiKey || process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!clients.has(key)) clients.set(key, new Resend(key));
  return clients.get(key);
}

const FROM = () => process.env.MAIL_FROM || 'CFP Coverage <onboarding@resend.dev>';

/**
 * Generic send. When RESEND_API_KEY is unset, logs to console (dev) and reports
 * delivered:'console'. `attachments` is an array of { filename, content } where
 * content is a string or Buffer (e.g. an .ics file). `from` overrides the default.
 * Returns { delivered } or throws on a real send error.
 */
export async function sendEmail({ to, subject, text, html, from, replyTo, attachments, apiKey }) {
  const c = client(apiKey);
  if (!c) {
    console.log('\n──────── EMAIL (dev, no Resend key) ────────');
    console.log(`  to:      ${to}`);
    console.log(`  subject: ${subject}`);
    if (text) console.log(`  text:    ${text}`);
    if (attachments?.length) console.log(`  attach:  ${attachments.map((a) => a.filename).join(', ')}`);
    console.log('────────────────────────────────────────────────\n');
    return { delivered: 'console' };
  }
  const payload = { from: from || FROM(), to, subject, text, html };
  if (replyTo) payload.replyTo = replyTo;
  if (attachments?.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
    }));
  }
  const { error } = await c.emails.send(payload);
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  return { delivered: 'email' };
}

/**
 * Send a magic sign-in link to a coach. When RESEND_API_KEY is unset (local dev),
 * the link is logged to the console instead so sign-in is still testable.
 */
export async function sendMagicLink({ to, name, url }) {
  const c = client();

  if (!c) {
    console.log('\n──────── MAGIC LINK (dev, no RESEND_API_KEY) ────────');
    console.log(`  to:   ${name ? `${name} <${to}>` : to}`);
    console.log(`  link: ${url}`);
    console.log('─────────────────────────────────────────────────────\n');
    return { delivered: 'console' };
  }

  const { error } = await c.emails.send({
    from: FROM(),
    to,
    subject: 'Your CFP Coverage sign-in link',
    html: magicLinkHtml({ name, url }),
    text: `Hi ${name || 'coach'},\n\nSign in to the CFP Coverage Board:\n${url}\n\nThis link expires in 30 minutes.`,
  });
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  return { delivered: 'email' };
}

function magicLinkHtml({ name, url }) {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#141613">
    <h1 style="font-size:20px;margin:0 0 12px">CFP Coverage Board</h1>
    <p style="margin:0 0 16px">Hi ${name || 'coach'}, tap below to sign in.</p>
    <p style="margin:0 0 20px">
      <a href="${url}" style="display:inline-block;background:#B2E51E;color:#0B0C0A;
         text-decoration:none;font-weight:700;text-transform:uppercase;letter-spacing:.03em;
         padding:12px 20px;border-radius:8px">Sign in</a>
    </p>
    <p style="margin:0;color:#9BA294;font-size:13px">This link expires in 30 minutes.
       If you didn't request it, you can ignore this email.</p>
  </div>`;
}
