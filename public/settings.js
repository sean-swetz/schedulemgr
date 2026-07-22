async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const pushBtn = document.getElementById('pushBtn');
const pushOff = document.getElementById('pushOff');
const pushState = document.getElementById('pushState');

function setState(msg, cls = '') { pushState.className = 'state ' + cls; pushState.textContent = msg; }

// base64url VAPID key → Uint8Array for PushManager.subscribe
function urlB64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

let config = { enabled: false, publicKey: null };

async function refresh() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setState('This browser doesn’t support push notifications.', 'err');
    pushBtn.disabled = true;
    return;
  }
  config = await api('/api/push/config');
  if (!config.enabled) {
    setState('Push isn’t configured on the server yet.', 'err');
    pushBtn.disabled = true;
    return;
  }
  const { subscribed } = await api('/api/push/status');
  toggleUI(subscribed);
}

function toggleUI(on) {
  pushBtn.style.display = on ? 'none' : '';
  pushOff.style.display = on ? '' : 'none';
  setState(on ? 'Push notifications are on for this device.' : 'Push notifications are off.', on ? 'on' : '');
}

pushBtn.addEventListener('click', async () => {
  try {
    setState('Requesting permission…');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { setState('Permission denied. Enable notifications for this site in your browser settings.', 'err'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(config.publicKey),
    });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
    toggleUI(true);
  } catch (err) {
    setState(err.message || 'Could not enable push.', 'err');
  }
});

pushOff.addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    await api('/api/push/unsubscribe', { method: 'POST' });
    toggleUI(false);
  } catch (err) {
    setState(err.message || 'Could not turn off push.', 'err');
  }
});

// Install prompt (Chromium). iOS/Safari has no event → the manual hint stays visible.
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  const hint = document.getElementById('installHint');
  btn.style.display = '';
  hint.style.display = 'none';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.style.display = 'none';
    hint.style.display = '';
  });
});

refresh().catch((err) => { if (err.message !== 'unauthorized') setState(err.message, 'err'); });
