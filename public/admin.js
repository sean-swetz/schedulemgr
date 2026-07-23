// Admin panel — notifications management. Admins only (server enforces; we also
// redirect non-admins client-side for a clean UX).

const EVENT_LABELS = {
  CLASS_OPENED: 'Class opened → all coaches',
  CLASS_CLAIMED: 'Class claimed → requester, admins & coverer',
  REMINDER_24H: '24-hour reminder → covering coach',
  WEEKLY_DIGEST: 'Weekly digest → all coaches (open classes next week)',
  UNCOVERED_ESCALATION: 'Uncovered escalation → admins (class still open, starting soon)',
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
      <div class="placeholders"><code>{coach}</code> <code>{coverer}</code> <code>{class}</code> <code>{date}</code> <code>{time}</code> <code>{note}</code> <code>{gym}</code> &nbsp; <span class="muted">(weekly digest also supports</span> <code>{list}</code><span class="muted">)</span></div></div>` +
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

// ── Coaches management panel ─────────────────────────────────────────────────
async function loadCoaches() {
  const el = document.getElementById('panel-coaches');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const { coaches } = await api('/api/admin/coaches');

  el.innerHTML = `
    <div class="card">
      <h3>Add a coach</h3>
      <div class="hint">They’ll be able to sign in with the email you enter here.</div>
      <div class="row">
        <div><label>Name</label><input type="text" id="newName" placeholder="e.g. Chris N."></div>
        <div><label>Email</label><input type="email" id="newEmail" placeholder="coach@example.com"></div>
        <div style="max-width:140px"><label>Role</label>
          <select id="newRole"><option value="COACH">Coach</option><option value="ADMIN">Admin</option></select>
        </div>
      </div>
      <div class="btnrow"><button class="btn" id="addCoach">Add coach</button></div>
    </div>
    <div class="card">
      <h3>Coaches</h3>
      <div class="hint">Click a field to edit. Changes to name, email, and role save on Enter or when you click away.</div>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>
      ${coaches.map(coachRow).join('')}
      </tbody></table>
    </div>`;

  document.getElementById('addCoach').addEventListener('click', async () => {
    const name = val('newName'), email = val('newEmail'), role = document.getElementById('newRole').value;
    if (!name || !email) { toast('Name and email are required', true); return; }
    try {
      await api('/api/admin/coaches', { method: 'POST', body: JSON.stringify({ name, email, role }) });
      toast('Coach added'); loadCoaches();
    } catch (err) { toast(err.message, true); }
  });

  el.querySelectorAll('tr[data-id]').forEach(wireCoachRow);
}

function coachRow(c) {
  const isMe = ME && c.id === ME.id;
  return `<tr data-id="${c.id}" data-me="${isMe}" ${c.active ? '' : 'style="opacity:.55"'}>
    <td><input type="text" data-field="name" value="${esc(c.name)}" style="min-width:110px"></td>
    <td><input type="email" data-field="email" value="${esc(c.email)}" style="min-width:170px"></td>
    <td>
      <select data-field="role" ${isMe ? 'disabled title="You can’t change your own role"' : ''}>
        <option value="COACH" ${c.role === 'COACH' ? 'selected' : ''}>Coach</option>
        <option value="ADMIN" ${c.role === 'ADMIN' ? 'selected' : ''}>Admin</option>
      </select>
    </td>
    <td>${c.active ? '<span class="pill sent">active</span>' : '<span class="pill skipped">inactive</span>'}</td>
    <td style="white-space:nowrap">${
      isMe
        ? '<span class="muted" style="font-size:11px">you</span>'
        : (c.active
            ? '<button class="btn ghost" data-deactivate>Deactivate</button>'
            : '<button class="btn ghost" data-reactivate>Reactivate</button>') +
          ' <button class="btn ghost" data-delete title="Only works if this coach has no schedule history">Delete</button>'
    }</td>
  </tr>`;
}

function wireCoachRow(tr) {
  const id = tr.dataset.id;
  const save = async (field, value) => {
    try {
      await api(`/api/admin/coaches/${id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      toast('Saved');
    } catch (err) { toast(err.message, true); loadCoaches(); }
  };
  tr.querySelectorAll('input[data-field]').forEach((inp) => {
    inp.addEventListener('change', () => save(inp.dataset.field, inp.value.trim()));
  });
  const roleSel = tr.querySelector('select[data-field=role]');
  if (roleSel) roleSel.addEventListener('change', () => save('role', roleSel.value));

  tr.querySelector('[data-deactivate]')?.addEventListener('click', async () => {
    const name = tr.querySelector('[data-field=name]').value;
    if (!confirm(`Deactivate ${name}? Their open coverage requests will be reverted and they won’t be able to sign in.`)) return;
    try {
      const { revertedOpen, stillCovering } = await api(`/api/admin/coaches/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
      let msg = `${name} deactivated`;
      if (revertedOpen) msg += ` — ${revertedOpen} open request${revertedOpen > 1 ? 's' : ''} reverted`;
      if (stillCovering) msg += `. ⚠ still covering ${stillCovering} class${stillCovering > 1 ? 'es' : ''} — reassign them`;
      toast(msg); loadCoaches();
    } catch (err) { toast(err.message, true); }
  });
  tr.querySelector('[data-reactivate]')?.addEventListener('click', async () => {
    try {
      await api(`/api/admin/coaches/${id}/active`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      toast('Reactivated'); loadCoaches();
    } catch (err) { toast(err.message, true); }
  });
  tr.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const name = tr.querySelector('[data-field=name]').value;
    if (!confirm(`Permanently delete ${name}? This only works if they have no schedule history — otherwise it'll tell you why not.`)) return;
    try {
      await api(`/api/admin/coaches/${id}`, { method: 'DELETE' });
      toast(`${name} deleted`); loadCoaches();
    } catch (err) { toast(err.message, true); }
  });
}

// ── Schedule / template editor panel ─────────────────────────────────────────
// "17:00" → "5:00 PM"
function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ap}`;
}

async function loadSchedule() {
  const el = document.getElementById('panel-schedule');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const [{ days }, { coaches }] = await Promise.all([
    api('/api/admin/template'),
    api('/api/admin/coaches'),
  ]);
  const active = coaches.filter((c) => c.active);
  const coachOpts = (sel) =>
    active.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  el.innerHTML = `
    <div class="card">
      <h3>Weekly schedule</h3>
      <div class="hint">The recurring template. Edits apply to <b>future weeks only</b> — the current week and any
        already-opened or claimed classes are left as-is. Times are 24-hour (e.g. 17:00 = 5:00 PM).</div>
    </div>
    ${days.map((day) => `
      <div class="card" data-day="${day.dayOfWeek}">
        <h3>${day.name}</h3>
        <table><tbody>
          ${day.slots.map((s) => `<tr data-slot="${s.id}">
            <td class="c-time"><input type="text" data-time value="${esc(s.time)}"><span class="muted t12">${fmt12(s.time)}</span></td>
            <td class="c-coach"><select data-coach>${coachOpts(s.coach.id)}</select></td>
            <td class="c-name"><input type="text" data-cname value="${esc(s.className)}"></td>
            <td class="c-act"><div class="btngroup"><button class="btn ghost" data-saveslot>Save</button><button class="btn ghost" data-delslot>Remove</button></div></td>
          </tr>`).join('') || '<tr><td class="muted">No classes</td></tr>'}
          <tr data-add>
            <td class="c-time"><input type="text" data-newtime placeholder="HH:MM"></td>
            <td class="c-coach"><select data-newcoach><option value="">Coach…</option>${coachOpts(null)}</select></td>
            <td class="c-name"><input type="text" data-newcname placeholder="CrossFit" value="CrossFit"></td>
            <td class="c-act"><div class="btngroup"><button class="btn" data-addslot>Add class</button></div></td>
          </tr>
        </tbody></table>
      </div>`).join('')}`;

  el.querySelectorAll('tr[data-slot]').forEach((tr) => {
    const id = tr.dataset.slot;
    tr.querySelector('[data-saveslot]').addEventListener('click', async () => {
      const time = tr.querySelector('[data-time]').value.trim();
      const coachId = tr.querySelector('[data-coach]').value;
      const className = tr.querySelector('[data-cname]').value.trim();
      try {
        const { futureWeeksUpdated } = await api(`/api/admin/template/${id}`, {
          method: 'PATCH', body: JSON.stringify({ time, coachId, className }),
        });
        toast(`Saved — ${futureWeeksUpdated} future week${futureWeeksUpdated === 1 ? '' : 's'} updated`);
        loadSchedule();
      } catch (err) { toast(err.message, true); }
    });
    tr.querySelector('[data-delslot]').addEventListener('click', async () => {
      if (!confirm('Remove this class from the weekly schedule? Future scheduled instances will be deleted (open/claimed ones are kept).')) return;
      try {
        const { futureInstancesRemoved } = await api(`/api/admin/template/${id}`, { method: 'DELETE' });
        toast(`Removed — ${futureInstancesRemoved} future instance${futureInstancesRemoved === 1 ? '' : 's'} deleted`);
        loadSchedule();
      } catch (err) { toast(err.message, true); }
    });
  });

  el.querySelectorAll('.card[data-day]').forEach((card) => {
    const dayOfWeek = Number(card.dataset.day);
    card.querySelector('[data-addslot]')?.addEventListener('click', async () => {
      const time = card.querySelector('[data-newtime]').value.trim();
      const coachId = card.querySelector('[data-newcoach]').value;
      const className = card.querySelector('[data-newcname]').value.trim() || 'CrossFit';
      if (!time || !coachId) { toast('Time and coach are required', true); return; }
      try {
        await api('/api/admin/template', { method: 'POST', body: JSON.stringify({ dayOfWeek, time, coachId, className }) });
        toast('Class added'); loadSchedule();
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ── Compose / broadcast panel ────────────────────────────────────────────────
async function loadCompose() {
  const el = document.getElementById('panel-compose');
  el.innerHTML = '<div class="card"><span class="muted">Loading…</span></div>';
  const [{ coaches }, { templates }] = await Promise.all([
    api('/api/admin/coaches'),
    api('/api/admin/broadcast-templates'),
  ]);
  const active = coaches.filter((c) => c.active);

  el.innerHTML = `
    <div class="card">
      <h3>Compose an announcement</h3>
      <div class="hint">Send a one-off email to coaches. Disabled-email coaches are skipped automatically.</div>
      ${templates.length ? `
        <label>Start from a saved template</label>
        <select id="tplPick"><option value="">— none —</option>${templates
          .map((t) => `<option value="${t.id}" data-subject="${esc(t.subject)}" data-body="${esc(t.body)}">${esc(t.name)}</option>`)
          .join('')}</select>` : ''}
      <label>Recipients</label>
      <select id="audience">
        <option value="all">All active coaches</option>
        <option value="admins">Admins only</option>
        <option value="coaches">Coaches only (non-admin)</option>
        <option value="specific">Specific coaches…</option>
      </select>
      <div id="specificWrap" style="display:none;margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:180px;overflow:auto">
        ${active.map((c) => `<label style="display:flex;align-items:center;gap:8px;margin:4px 0;text-transform:none;letter-spacing:0;color:var(--text);font-weight:500">
          <input type="checkbox" class="rcpt" value="${c.id}" style="width:auto;height:auto">${esc(c.name)} <span class="muted" style="font-size:12px">${esc(c.email)}</span>
        </label>`).join('')}
      </div>
      <label>Subject</label>
      <input type="text" id="bSubject" placeholder="e.g. Gym closed July 4">
      <label>Message</label>
      <textarea id="bBody" placeholder="Write your announcement…"></textarea>
      <div class="btnrow">
        <button class="btn" id="sendBroadcast">Send now</button>
        <button class="btn ghost" id="saveTpl">Save as template</button>
      </div>
    </div>
    <div class="card">
      <h3>Saved templates <button class="btn" id="newTpl" style="float:right">Create new template</button></h3>
      <div class="hint">Reusable announcements you can load into the composer.</div>
      ${templates.length ? `<table><tbody>${templates.map((t) => `<tr data-tpl="${t.id}">
        <td>${esc(t.name)}</td><td class="muted">${esc(t.subject)}</td>
        <td style="text-align:right"><button class="btn ghost" data-edittpl>Edit</button> <button class="btn ghost" data-deltpl>Delete</button></td>
      </tr>`).join('')}</tbody></table>` : '<span class="muted">No saved templates yet.</span>'}
    </div>`;

  const audience = document.getElementById('audience');
  audience.addEventListener('change', () => {
    document.getElementById('specificWrap').style.display = audience.value === 'specific' ? 'block' : 'none';
  });
  document.getElementById('tplPick')?.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt.value) return;
    document.getElementById('bSubject').value = opt.dataset.subject || '';
    document.getElementById('bBody').value = opt.dataset.body || '';
  });

  document.getElementById('sendBroadcast').addEventListener('click', async () => {
    const subject = val('bSubject'), body = document.getElementById('bBody').value.trim();
    if (!subject || !body) { toast('Subject and message are required', true); return; }
    const payload = { subject, body };
    if (audience.value === 'specific') {
      const ids = [...el.querySelectorAll('.rcpt:checked')].map((c) => c.value);
      if (!ids.length) { toast('Pick at least one coach', true); return; }
      payload.userIds = ids;
    } else {
      payload.audience = audience.value;
    }
    if (!confirm(`Send this announcement to ${audience.value === 'specific' ? payload.userIds.length + ' coach(es)' : audience.options[audience.selectedIndex].text.toLowerCase()}?`)) return;
    try {
      const { summary } = await api('/api/admin/broadcast', { method: 'POST', body: JSON.stringify(payload) });
      toast(`Sent to ${summary.sent}${summary.skipped ? ` (${summary.skipped} skipped)` : ''}${summary.failed ? ` — ${summary.failed} failed` : ''}`);
    } catch (err) { toast(err.message, true); }
  });

  // Single save handler — creates a new template, or updates the one being edited.
  const saveBtn = document.getElementById('saveTpl');
  saveBtn.addEventListener('click', async () => {
    const subject = val('bSubject'), body = document.getElementById('bBody').value.trim();
    const editId = saveBtn.dataset.editId;
    try {
      if (editId) {
        await api(`/api/admin/broadcast-templates/${editId}`, {
          method: 'PATCH', body: JSON.stringify({ name: saveBtn.dataset.editName, subject, body }),
        });
        toast('Template updated');
      } else {
        const name = prompt('Name this template:');
        if (!name) return;
        await api('/api/admin/broadcast-templates', { method: 'POST', body: JSON.stringify({ name, subject, body }) });
        toast('Template saved');
      }
      loadCompose();
    } catch (err) { toast(err.message, true); }
  });

  // Create from scratch: clear the composer and bring the person up to it.
  document.getElementById('newTpl').addEventListener('click', () => {
    document.getElementById('bSubject').value = '';
    document.getElementById('bBody').value = '';
    const tplPick = document.getElementById('tplPick');
    if (tplPick) tplPick.value = '';
    document.getElementById('bSubject').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('bSubject').focus();
    toast('Write your announcement, then “Save as template”');
  });

  // Edit: load a template into the composer and switch Save into update mode.
  el.querySelectorAll('[data-edittpl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = templates.find((x) => x.id === btn.closest('[data-tpl]').dataset.tpl);
      if (!t) return;
      document.getElementById('bSubject').value = t.subject;
      document.getElementById('bBody').value = t.body;
      saveBtn.textContent = `Update “${t.name}”`;
      saveBtn.dataset.editId = t.id;
      saveBtn.dataset.editName = t.name;
      document.getElementById('bSubject').scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`Editing “${t.name}” — change it and Update`);
    });
  });

  el.querySelectorAll('[data-deltpl]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('[data-tpl]').dataset.tpl;
      if (!confirm('Delete this template?')) return;
      try { await api(`/api/admin/broadcast-templates/${id}`, { method: 'DELETE' }); toast('Deleted'); loadCompose(); }
      catch (err) { toast(err.message, true); }
    });
  });
}

// ── Coach notifications panel ────────────────────────────────────────────────
async function loadNotify() {
  const el = document.getElementById('panel-notify');
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

const LOADERS = { coaches: loadCoaches, schedule: loadSchedule, compose: loadCompose, templates: loadTemplates, notify: loadNotify, sender: loadSender, log: loadLog };

// ── Boot ─────────────────────────────────────────────────────────────────────
let ME = null;
(async function boot() {
  try {
    ME = await api('/api/me');
    if (ME.role !== 'ADMIN') { window.location.href = '/'; return; }
  } catch (err) {
    if (err.message === 'unauthorized' || err.message === 'forbidden') return;
  }
  loadCoaches();
})();
