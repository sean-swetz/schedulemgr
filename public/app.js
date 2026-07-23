// CFP Coverage Board — client. Ports the mockup against the real API.

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const initials = (n) =>
  n.split(/[\s.]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// "17:00" (24h) -> "5:00 PM". The API stores 24h; the brief renders 12h.
function fmtTime(t24) {
  const [h, m] = t24.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ---- Date helpers (local calendar; matches how coaches think about "this week") ----
function parseIso(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d);
}
function toIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}
function mondayOf(date) {
  const d = new Date(date);
  const idx = (d.getDay() + 6) % 7; // Sun(0)->6, Mon(1)->0
  d.setDate(d.getDate() - idx);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ---- State ----
let me = null;
let weekStart = mondayOf(new Date()); // Date at local midnight, Monday
let week = null; // API response { weekStart, days:[{date, classes, openCount}] }
let selectedDay = 0;
let selectMode = false;          // "request time off" multi-select mode
const selected = new Set();      // class ids selected in that mode
const todayIso = toIso(new Date());

// ---- API ----
async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function loadWeek() {
  week = await api(`/api/week/${toIso(weekStart)}`);
  // Default the mobile-selected day to today if it's in this week, else Monday.
  const todayIdx = week.days.findIndex((d) => d.date === todayIso);
  selectedDay = todayIdx >= 0 ? todayIdx : 0;
  render();
  refreshOpenClasses(); // keep the bell badge in sync (fire-and-forget)
}

// ---- Rendering ----
function coachChip(name, extra = '') {
  return `<span class="coach ${extra}"><span class="avatar">${initials(name)}</span>${name}</span>`;
}

function slotHTML(c) {
  const mine = c.assigned.id === me.id;
  const status = c.status; // SCHEDULED | OPEN | CLAIMED
  let cls =
    'slot' +
    (mine ? ' mine' : '') +
    (status === 'OPEN' ? ' open' : '') +
    (status === 'CLAIMED' ? ' claimed' : '');
  let inner = `<div class="time">${fmtTime(c.time)}</div><div class="cname">${c.className}</div>`;

  // Admin-only: tiny reassign (pencil) button, top-right of the card.
  const adminEdit = me.role === 'ADMIN'
    ? `<button class="slot-edit" data-edit="${c.id}" data-coach="${c.assigned.id}" aria-label="Reassign this class" title="Reassign coach">✎</button>`
    : '';
  inner = adminEdit + inner;

  if (status === 'SCHEDULED') {
    inner += coachChip(c.assigned.name);
    if (mine && selectMode) {
      const checked = selected.has(c.id);
      cls += checked ? ' picked' : '';
      inner += `<button class="act ${checked ? 'cover' : 'request'}" data-pick="${c.id}">${checked ? '✓ Selected' : 'Select'}</button>`;
    } else if (mine) {
      inner += `<button class="act request" data-act="open" data-id="${c.id}">Request coverage</button>`;
    }
  } else if (status === 'OPEN') {
    inner += coachChip(c.assigned.name, 'strike');
    inner += `<div class="stamp open">needs coverage${c.note ? ' — ' + c.note : ''}</div>`;
    inner += mine
      ? `<button class="act cancel" data-act="cancel" data-id="${c.id}">Cancel request</button>`
      : `<button class="act cover" data-act="claim" data-id="${c.id}">I’ll cover it</button>`;
  } else if (status === 'CLAIMED') {
    const iAmCovering = c.coveredBy && c.coveredBy.id === me.id;
    inner += coachChip(c.assigned.name, 'strike');
    inner += `<div class="stamp covered">covered ✓</div>`;
    const by = c.coveredBy ? c.coveredBy.name : '—';
    inner += `<div class="covered-by"><span class="avatar">${initials(by)}</span>${by} is covering</div>`;
    if (iAmCovering) {
      inner += `<button class="act cancel" data-act="unclaim" data-id="${c.id}">Cancel coverage</button>`;
    }
  }
  return `<div class="${cls}">${inner}</div>`;
}

function render() {
  // Header: me + week label
  document.getElementById('meName').textContent = me.name;
  document.getElementById('meAvatar').textContent = initials(me.name);
  if (me.role === 'ADMIN') document.getElementById('adminLink').style.display = 'inline-flex';

  const start = parseIso(week.days[0].date);
  const end = parseIso(week.days[6].date);
  const label =
    `${MONTHS[start.getMonth()]} ${start.getDate()} – ` +
    (start.getMonth() === end.getMonth() ? `${end.getDate()}` : `${MONTHS[end.getMonth()]} ${end.getDate()}`);
  document.getElementById('weekLabel').textContent = label;

  // Day tabs (mobile) — lime dot marks days with open classes
  document.getElementById('daytabs').innerHTML = week.days
    .map((d, i) => {
      const date = parseIso(d.date);
      const hasOpen = d.openCount > 0;
      return `<button class="daytab${i === selectedDay ? ' sel' : ''}" data-day="${i}"
        aria-pressed="${i === selectedDay}" aria-label="${DOW[i]} ${MONTHS[date.getMonth()]} ${date.getDate()}${hasOpen ? ' — needs coverage' : ''}">
        ${hasOpen ? '<span class="dot"></span>' : ''}
        <span class="dw">${DOW[i].slice(0, 1)}</span><span class="dt">${date.getDate()}</span>
      </button>`;
    })
    .join('');

  // Needs-coverage strip
  const open = [];
  week.days.forEach((d, i) => d.classes.forEach((c) => { if (c.status === 'OPEN') open.push({ c, dayIdx: i }); }));
  const wrap = document.getElementById('alertsInner');
  if (open.length) {
    wrap.innerHTML =
      `<h2><span>Needs coverage</span></h2><span class="count">${open.length} class${open.length > 1 ? 'es' : ''} this week</span>
      <div class="alert-row">` +
      open
        .map(({ c, dayIdx }) => {
          const mine = c.assigned.id === me.id;
          return `<div class="alert-card" data-goto="${dayIdx}">
            <div>
              <div class="when">${DOW[dayIdx]} ${fmtTime(c.time)}</div>
              <div class="who">${c.className} · usually ${c.assigned.name}</div>
              ${c.note ? `<div class="note">“${c.note}”</div>` : ''}
            </div>
            ${
              !mine
                ? `<button class="cta" data-act="claim" data-id="${c.id}">I’ll cover it</button>`
                : `<button class="cta ghost" data-act="cancel" data-id="${c.id}">Cancel</button>`
            }
          </div>`;
        })
        .join('') +
      `</div>`;
  } else {
    wrap.innerHTML = `<span class="all-clear">All classes covered — nice work, team ✓</span>`;
  }

  // Board — all days on desktop; selected day on mobile via CSS
  document.getElementById('board').innerHTML = week.days
    .map((d, i) => {
      const date = parseIso(d.date);
      const isToday = d.date === todayIso;
      return `
      <div class="day${isToday ? ' today' : ''}${i === selectedDay ? ' sel' : ''}">
        <div class="day-head"><div class="dow">${DOW[i]}</div><div class="date">${MONTHS[date.getMonth()]} ${date.getDate()}</div></div>
        <div class="slots">${d.classes.map(slotHTML).join('') || '<div style="color:var(--muted);font-size:13px;padding:6px">No classes</div>'}</div>
      </div>`;
    })
    .join('');

  renderSelectUI();
}

// "Request time off" toggle + selection confirm bar.
function renderSelectUI() {
  const iHaveClasses = week.days.some((d) => d.classes.some((c) => c.assigned.id === me.id && c.status === 'SCHEDULED'));
  const toggle = document.getElementById('timeOffBtn');
  toggle.hidden = !iHaveClasses && !selectMode;
  toggle.textContent = selectMode ? 'Cancel' : 'Request time off';
  toggle.classList.toggle('active', selectMode);

  const bar = document.getElementById('selectBar');
  if (selectMode && selected.size > 0) {
    bar.hidden = false;
    document.getElementById('selectCount').textContent =
      `${selected.size} class${selected.size > 1 ? 'es' : ''} selected`;
  } else {
    bar.hidden = true;
  }
}

// ---- Toast ----
let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  t.classList.toggle('err', isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

// Find a class in the current week by id (returns {c, dayIdx} or null).
function findClass(id) {
  for (let i = 0; i < week.days.length; i++) {
    const c = week.days[i].classes.find((x) => x.id === id);
    if (c) return { c, dayIdx: i };
  }
  return null;
}

// Replace a class object in place with the server's authoritative version.
function reconcile(updated) {
  const found = findClass(updated.id);
  if (found) Object.assign(found.c, updated);
}

const ACTIONS = {
  open: {
    endpoint: (id) => `/api/classes/${id}/open`,
    optimistic: (c) => { c.status = 'OPEN'; },
    msg: (c, d) => `Coverage requested for <b>${DOW[d]} ${fmtTime(c.time)}</b> — all coaches notified`,
  },
  cancel: {
    endpoint: (id) => `/api/classes/${id}/cancel`,
    optimistic: (c) => { c.status = 'SCHEDULED'; c.note = null; c.coveredBy = null; },
    msg: (c, d) => `Coverage request canceled for <b>${DOW[d]} ${fmtTime(c.time)}</b>`,
  },
  claim: {
    endpoint: (id) => `/api/classes/${id}/claim`,
    optimistic: (c) => { c.status = 'CLAIMED'; c.coveredBy = { id: me.id, name: me.name }; },
    msg: (c, d) => `You’re covering <b>${DOW[d]} ${fmtTime(c.time)}</b> — calendar invite sent, reminder set for 24h before`,
  },
  unclaim: {
    endpoint: (id) => `/api/classes/${id}/unclaim`,
    optimistic: (c) => { c.status = 'OPEN'; c.coveredBy = null; },
    msg: (c, d) => `You released <b>${DOW[d]} ${fmtTime(c.time)}</b> — it’s open for someone else to cover`,
  },
};

async function doAction(act, id) {
  const action = ACTIONS[act];
  const found = findClass(id);
  if (!action || !found) return;
  const { c, dayIdx } = found;

  // Snapshot for rollback, apply optimistic update, re-render immediately.
  const snapshot = JSON.parse(JSON.stringify(c));
  action.optimistic(c);
  render();

  try {
    const data = await api(action.endpoint(id), { method: 'POST', body: JSON.stringify({ note: c.note || undefined }) });
    reconcile(data.class);
    render();
    toast(action.msg(c, dayIdx));
  } catch (err) {
    if (err.message === 'unauthorized') return;
    // Roll back the optimistic change and show the server's message.
    Object.assign(c, snapshot);
    // Refresh the whole week so we reflect whatever really happened (e.g. someone
    // else claimed it) rather than just our stale snapshot.
    try { await loadWeek(); } catch { render(); }
    toast(err.message, true);
  }
}

// ---- Events ----
// Admin: coach list for the reassign dropdown (fetched once, lazily).
let coachList = null;
async function ensureCoachList() {
  if (coachList) return coachList;
  const data = await api('/api/admin/coaches');
  coachList = data.coaches.filter((c) => c.active);
  return coachList;
}

document.body.addEventListener('click', async (e) => {
  const tab = e.target.closest('.daytab');
  if (tab) { selectedDay = +tab.dataset.day; render(); return; }

  // Time-off select mode: toggle a class into/out of the selection.
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const id = pick.dataset.pick;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render();
    return;
  }

  // Admin reassign pencil → inline coach picker inside the slot.
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const slot = edit.closest('.slot');
    if (slot.querySelector('.slot-reassign')) return; // already open
    const coaches = await ensureCoachList();
    const cur = edit.dataset.coach;
    const div = document.createElement('div');
    div.className = 'slot-reassign';
    div.innerHTML =
      `<select>${coaches.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${c.name}</option>`).join('')}</select>` +
      `<button data-reassign="${edit.dataset.edit}">Save</button>`;
    slot.appendChild(div);
    return;
  }
  const reassign = e.target.closest('[data-reassign]');
  if (reassign) {
    const sel = reassign.closest('.slot-reassign').querySelector('select');
    try {
      await api(`/api/admin/classes/${reassign.dataset.reassign}`, {
        method: 'PATCH', body: JSON.stringify({ coachId: sel.value }),
      });
      toast('Class reassigned');
      await loadWeek();
    } catch (err) { toast(err.message, true); }
    return;
  }

  const btn = e.target.closest('[data-act]');
  if (btn) { doAction(btn.dataset.act, btn.dataset.id); return; }

  const card = e.target.closest('.alert-card');
  if (card) {
    selectedDay = +card.dataset.goto;
    render();
    document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

// Time-off mode toggle + hint.
document.getElementById('timeOffBtn').addEventListener('click', () => {
  selectMode = !selectMode;
  selected.clear();
  document.getElementById('timeOffHint').hidden = !selectMode;
  render();
});

// Confirm the selection → one bulk-open request.
document.getElementById('selectConfirm').addEventListener('click', async () => {
  if (selected.size === 0) return;
  const note = prompt('Add a note (optional), e.g. "vacation":', '') ?? '';
  const ids = [...selected];
  try {
    const { count } = await api('/api/classes/bulk-open', {
      method: 'POST', body: JSON.stringify({ ids, note: note.trim() || undefined }),
    });
    toast(`Requested coverage for <b>${count} class${count > 1 ? 'es' : ''}</b> — coaches notified`);
    selectMode = false; selected.clear();
    document.getElementById('timeOffHint').hidden = true;
    await loadWeek();
  } catch (err) { toast(err.message, true); }
});

document.getElementById('prevWeek').addEventListener('click', async () => {
  weekStart = addDays(weekStart, -7);
  await loadWeek();
});
document.getElementById('nextWeek').addEventListener('click', async () => {
  weekStart = addDays(weekStart, 7);
  await loadWeek();
});

// ---- Calendar picker (click the week label to jump to any week) ----
const calEl = document.getElementById('cal');
const labelBtn = document.getElementById('weekLabel');
let calMonth = null; // Date on the 1st of the month currently shown in the popover

function openCal() {
  calMonth = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  renderCal();
  calEl.hidden = false;
  labelBtn.setAttribute('aria-expanded', 'true');
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onCalKey);
}
function closeCal() {
  calEl.hidden = true;
  labelBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onDocClick, true);
  document.removeEventListener('keydown', onCalKey);
}
function onDocClick(e) {
  if (!calEl.contains(e.target) && e.target !== labelBtn && !labelBtn.contains(e.target)) closeCal();
}
function onCalKey(e) {
  if (e.key === 'Escape') { closeCal(); labelBtn.focus(); }
}

function renderCal() {
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const selMonday = mondayOf(weekStart);
  const selSunday = addDays(selMonday, 6);

  // Grid starts on the Monday on/before the 1st.
  const gridStart = mondayOf(new Date(y, m, 1));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const inMonth = d.getMonth() === m;
    const iso = toIso(d);
    const inSelWeek = d >= selMonday && d <= selSunday;
    cells.push(
      `<button data-iso="${iso}" class="${inMonth ? '' : 'other'}${inSelWeek ? ' selweek' : ''}${
        iso === todayIso ? ' today' : ''
      }">${d.getDate()}</button>`
    );
    if (i >= 34 && d >= new Date(y, m + 1, 0)) break; // stop after the month ends
  }

  calEl.innerHTML = `
    <div class="cal-head">
      <button data-mo="-1" aria-label="Previous month">‹</button>
      <div class="m">${MONTHS[m]} ${y}</div>
      <button data-mo="1" aria-label="Next month">›</button>
    </div>
    <div class="cal-dow">${['M','T','W','T','F','S','S'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div class="cal-foot"><button data-today>Jump to today</button></div>`;
}

labelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (calEl.hidden) openCal(); else closeCal();
});

calEl.addEventListener('click', async (e) => {
  const mo = e.target.closest('[data-mo]');
  if (mo) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(mo.dataset.mo), 1); renderCal(); return; }
  if (e.target.closest('[data-today]')) {
    weekStart = mondayOf(new Date());
    closeCal(); await loadWeek(); return;
  }
  const day = e.target.closest('[data-iso]');
  if (day) {
    weekStart = mondayOf(parseIso(day.dataset.iso));
    closeCal(); await loadWeek();
  }
});

// ---- Open-classes panel (bell) ----
const bellBtn = document.getElementById('bellBtn');
const bellBadge = document.getElementById('bellBadge');
const openSheet = document.getElementById('openSheet');
const openBackdrop = document.getElementById('openBackdrop');
const openList = document.getElementById('openList');
let openClasses = [];

async function refreshOpenClasses() {
  try {
    const data = await api('/api/open-classes');
    openClasses = data.classes;
  } catch { openClasses = []; }
  const n = openClasses.length;
  bellBadge.textContent = n;
  bellBadge.hidden = n === 0;
  if (!openSheet.hidden) renderOpenList();
}

function renderOpenList() {
  if (openClasses.length === 0) {
    openList.innerHTML = `<div class="sheet-empty">All covered — nice work! ✓</div>`;
    return;
  }
  openList.innerHTML = openClasses.map((c) => {
    const d = parseIso(c.date);
    const mine = c.assigned.id === me.id;
    return `<div class="open-item" data-id="${c.id}" data-date="${c.date}">
      <div class="when">${DOW[(d.getDay()+6)%7]} ${MONTHS[d.getMonth()]} ${d.getDate()} · ${fmtTime(c.time)}</div>
      <div class="who">${c.className} · usually ${c.assigned.name}</div>
      ${c.note ? `<div class="onote">“${c.note}”</div>` : ''}
      <div class="row2">
        ${mine
          ? `<button class="cover" disabled>Your class</button>`
          : `<button class="cover" data-cover="${c.id}">I’ll cover it</button>`}
        <button class="goto" data-goto="${c.date}">View</button>
      </div>
    </div>`;
  }).join('');
}

function openBell() {
  renderOpenList();
  openBackdrop.hidden = false; openSheet.hidden = false;
  requestAnimationFrame(() => { openBackdrop.classList.add('show'); openSheet.classList.add('show'); });
}
function closeBell() {
  openBackdrop.classList.remove('show'); openSheet.classList.remove('show');
  setTimeout(() => { openBackdrop.hidden = true; openSheet.hidden = true; }, 220);
}

bellBtn.addEventListener('click', openBell);
document.getElementById('openClose').addEventListener('click', closeBell);
openBackdrop.addEventListener('click', closeBell);

openList.addEventListener('click', async (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    weekStart = mondayOf(parseIso(goto.dataset.goto));
    closeBell();
    await loadWeek();
    // select the right day on mobile
    const idx = week.days.findIndex((d) => d.date === goto.dataset.goto);
    if (idx >= 0) { selectedDay = idx; render(); }
    document.getElementById('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const cover = e.target.closest('[data-cover]');
  if (cover) {
    cover.disabled = true;
    try {
      await api(`/api/classes/${cover.dataset.cover}/claim`, { method: 'POST', body: JSON.stringify({}) });
      toast(`You’re covering it — calendar invite sent, reminder set for 24h before`);
      await refreshOpenClasses();
      // if the covered class is in the current week, refresh the board too
      await loadWeek();
    } catch (err) {
      toast(err.message, true);
      await refreshOpenClasses();
    }
  }
});

// ---- Boot ----
(async function boot() {
  try {
    me = await api('/api/me');
  } catch (err) {
    if (err.message === 'unauthorized') return; // redirected to login
    document.getElementById('board').innerHTML = `<div class="board-msg">Couldn’t load your account. ${err.message}</div>`;
    return;
  }
  try {
    await loadWeek();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    document.getElementById('board').innerHTML = `<div class="board-msg">Couldn’t load the schedule. ${err.message}</div>`;
  }
})();

// Register the service worker (enables install + push).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed:', err));
}
