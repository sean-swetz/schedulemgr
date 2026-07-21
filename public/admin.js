// Admin panel — notifications management. Admins only (server enforces; we also
// redirect non-admins client-side for a clean UX).

const EVENT_LABELS = {
  CLASS_OPENED: 'Class opened → all coaches',
  CLASS_CLAIMED: 'Class claimed → requester, admins & coverer',
  REMINDER_24H: '24-hour reminder → covering coach',
};

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
  if (res.status === 403) { window.location.href = '/'; throw new Error('forbidden'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Tabs ──────────────────────────────────────────────────────────────────
document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('sel', t === tab));
  const name = tab.dataset.tab;
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('show', p.id === `panel-${name}`));
  LOADERS[name]?.();
});

// ── Templates panel ─────────────────────────────────────────────────────────
async function loadTemplates() {
  const el = document.getElementById('panel-templates');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const { templates } = await api('/api/admin/templates');
  el.innerHTML =
    `<div class="card"><h3>Placeholders</h3><div class="hint">Drop these into any subject or body — they’re filled in when the message is sent.</div>
      <div class="placeholders"><code>{coach}</code> <code>{coverer}</code> <code>{class}</code> <code>{note}</code> <code>{gym}</code></div></div>` +
    templates
      .map(
        (t) => `
      <div class="card" data-event="${t.event}">
        <h3>${esc(EVENT_LABELS[t.event] || t.event)}</h3>
        <div class="btnrow" style="margin-top:2px">
          <label class="sw"><input type="checkbox" data-enabled ${t.enabled ? 'checked' : ''}><span class="slider"></span></label>
          <span class="muted">${t.enabled ? 'Sending' : 'Paused'}</span>
        </div>
        <label>Subject</label>
        <input type="text" data-subject value="${esc(t.subject)}">
        <label>Body</label>
        <textarea data-body>${esc(t.body)}</textarea>
        <div class="btnrow">
          <button class="btn" data-save>Save</button>
          <button class="btn ghost" data-reset>Reset to default</button>
        </div>
      </div>`
      )
      .join('');

  el.querySelectorAll('.card[data-event]').forEach((card) => {
    const event = card.dataset.event;
    const enabledEl = card.querySelector('[data-enabled]');
    enabledEl.addEventListener('change', async () => {
      try {
        await api(`/api/admin/templates/${event}`, { method: 'PATCH', body: JSON.stringify({ enabled: enabledEl.checked }) });
        card.querySelector('.muted').textContent = enabledEl.checked ? 'Sending' : 'Paused';
        toast(enabledEl.checked ? 'Event enabled' : 'Event paused');
      } catch (err) { enabledEl.checked = !enabledEl.checked; toast(err.message, true); }
    });
    card.querySelector('[data-save]').addEventListener('click', async () => {
      const subject = card.querySelector('[data-subject]').value;
      const body = card.querySelector('[data-body]').value;
      try {
        await api(`/api/admin/templates/${event}`, { method: 'PATCH', body: JSON.stringify({ subject, body }) });
        toast('Template saved');
      } catch (err) { toast(err.message, true); }
    });
    card.querySelector('[data-reset]').addEventListener('click', async () => {
      try {
        const { template } = await api(`/api/admin/templates/${event}`, { method: 'PATCH', body: JSON.stringify({ reset: true }) });
        card.querySelector('[data-subject]').value = template.subject;
        card.querySelector('[data-body]').value = template.body;
        toast('Reset to default');
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ── Coach notifications panel ────────────────────────────────────────────────
async function loadCoaches() {
  const el = document.getElementById('panel-coaches');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const { coaches } = await api('/api/admin/coaches');
  el.innerHTML = `<div class="card">
    <h3>Coach notifications</h3>
    <div class="hint">Turn a coach’s email on or off, or clear their push subscription. Inactive coaches never receive anything.</div>
    <table>
      <thead><tr><th>Coach</th><th>Email</th><th>Email on</th><th>Push</th></tr></thead>
      <tbody>
      ${coaches
        .map(
          (c) => `<tr data-id="${c.id}">
            <td>${esc(c.name)} ${c.role === 'ADMIN' ? '<span class="pill admin">admin</span>' : ''} ${c.active ? '' : '<span class="pill skipped">inactive</span>'}</td>
            <td class="muted">${esc(c.email)}</td>
            <td><label class="sw"><input type="checkbox" data-email ${c.emailEnabled ? 'checked' : ''}><span class="slider"></span></label></td>
            <td>${c.pushEnrolled ? '<button class="btn ghost" data-clearpush>Clear</button>' : '<span class="muted">—</span>'}</td>
          </tr>`
        )
        .join('')}
      </tbody>
    </table>
  </div>`;

  el.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const emailEl = tr.querySelector('[data-email]');
    emailEl.addEventListener('change', async () => {
      try {
        await api(`/api/admin/coaches/${id}/notifications`, { method: 'PATCH', body: JSON.stringify({ emailEnabled: emailEl.checked }) });
        toast('Saved');
      } catch (err) { emailEl.checked = !emailEl.checked; toast(err.message, true); }
    });
    tr.querySelector('[data-clearpush]')?.addEventListener('click', async (ev) => {
      try {
        await api(`/api/admin/coaches/${id}/notifications`, { method: 'PATCH', body: JSON.stringify({ pushEnabled: false }) });
        ev.target.outerHTML = '<span class="muted">—</span>';
        toast('Push cleared');
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ── Sender & gym panel ───────────────────────────────────────────────────────
async function loadSender() {
  const el = document.getElementById('panel-sender');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const { settings: s } = await api('/api/admin/settings');
  el.innerHTML = `
    <div class="card">
      <h3>Sender</h3>
      <div class="hint">The “from” address on every notification email.</div>
      <div class="row">
        <div><label>From name</label><input type="text" id="fromName" value="${esc(s.fromName)}"></div>
        <div><label>From email</label><input type="email" id="fromEmail" value="${esc(s.fromEmail)}"></div>
      </div>
      <label>Reply-to (optional)</label><input type="email" id="replyTo" value="${esc(s.replyTo || '')}">
    </div>
    <div class="card">
      <h3>Gym &amp; calendar</h3>
      <div class="hint">Used on the calendar invite (.ics) sent when a class is claimed.</div>
      <div class="row">
        <div><label>Gym name</label><input type="text" id="gymName" value="${esc(s.gymName)}"></div>
        <div><label>Class length (minutes)</label><input type="number" id="classMinutes" value="${esc(s.classMinutes)}" min="1" max="300"></div>
      </div>
      <label>Gym address (calendar location)</label><input type="text" id="gymAddress" value="${esc(s.gymAddress)}">
    </div>
    <div class="card">
      <h3>Resend API key</h3>
      <div class="hint">Paste a Resend key to turn on real email delivery. Until one is set, emails print to the server console. ${s.resendKeySet ? `Currently set: <code>${esc(s.resendKeyHint)}</code>` : '<b>Not set — console mode.</b>'}</div>
      <input type="password" id="resendApiKey" placeholder="${s.resendKeySet ? 'Leave blank to keep current key' : 're_...'}" autocomplete="off">
      ${s.resendKeySet ? '<div class="btnrow"><button class="btn ghost" id="clearKey">Remove key (back to console mode)</button></div>' : ''}
    </div>
    <div class="btnrow"><button class="btn" id="saveSender">Save all</button></div>`;

  document.getElementById('saveSender').addEventListener('click', async () => {
    const body = {
      fromName: val('fromName'), fromEmail: val('fromEmail'), replyTo: val('replyTo'),
      gymName: val('gymName'), gymAddress: val('gymAddress'), classMinutes: Number(val('classMinutes')),
    };
    const key = val('resendApiKey');
    if (key) body.resendApiKey = key; // only send when the admin typed something
    try { await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) }); toast('Settings saved'); loadSender(); }
    catch (err) { toast(err.message, true); }
  });
  document.getElementById('clearKey')?.addEventListener('click', async () => {
    try { await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify({ resendApiKey: '' }) }); toast('Key removed'); loadSender(); }
    catch (err) { toast(err.message, true); }
  });
}
const val = (id) => document.getElementById(id).value.trim();

// ── Log panel ────────────────────────────────────────────────────────────────
async function loadLog() {
  const el = document.getElementById('panel-log');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const { log } = await api('/api/admin/notifications/log?limit=200');
  el.innerHTML = `<div class="card">
    <h3>Send log <button class="btn ghost" id="refreshLog" style="float:right">Refresh</button></h3>
    <div class="hint">Most recent 200 delivery attempts.</div>
    ${
      log.length === 0
        ? '<span class="muted">Nothing sent yet.</span>'
        : `<table><thead><tr><th>When</th><th>Event</th><th>To</th><th>Status</th><th>Detail</th></tr></thead><tbody>
      ${log
        .map(
          (r) => `<tr>
            <td class="muted">${new Date(r.createdAt).toLocaleString()}</td>
            <td>${esc(r.event)}</td>
            <td class="muted">${esc(r.toAddress || '')}</td>
            <td><span class="pill ${r.status.toLowerCase()}">${esc(r.status)}</span></td>
            <td class="muted">${esc(r.detail || '')}</td>
          </tr>`
        )
        .join('')}
      </tbody></table>`
    }
  </div>`;
  document.getElementById('refreshLog')?.addEventListener('click', loadLog);
}

const LOADERS = { templates: loadTemplates, coaches: loadCoaches, sender: loadSender, log: loadLog };

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function boot() {
  try {
    const me = await api('/api/me');
    if (me.role !== 'ADMIN') { window.location.href = '/'; return; }
  } catch (err) {
    if (err.message === 'unauthorized' || err.message === 'forbidden') return;
  }
  loadTemplates();
})();
