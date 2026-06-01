/* ════════════════════════════════════════════════════════════════
   EasyHost AI — Service Worker Registration
   • Registers /sw.js on first load
   • Detects updates and shows a toast-style prompt
   • Handles offline/online state changes
   ════════════════════════════════════════════════════════════════ */

const SW_URL = `${process.env.PUBLIC_URL}/sw.js`;

/* ── Main register function ───────────────────────────────────── */
export function register() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported in this browser.');
    return;
  }

  // Register after window load so it doesn't compete with the initial paint
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL)
      .then(registration => {
        console.log('[PWA] Service worker registered. Scope:', registration.scope);

        // ── Detect new SW waiting to activate (app updated) ────
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // There's a new version waiting — show update prompt
              showUpdateToast(registration);
            }
          });
        });

        // ── Periodic update check (every 60 minutes) ──────────
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);
      })
      .catch(err => {
        console.error('[PWA] Service worker registration failed:', err);
      });

    // Avoid automatic full-page reload on SW controller change (was causing visible "hiccups").
    // Users can refresh manually when the update toast appears.
  });

  // ── Online / Offline events ────────────────────────────────
  window.addEventListener('online',  () => showConnectivityBanner(true));
  window.addEventListener('offline', () => showConnectivityBanner(false));
}

/* ── Unregister (call from dev tools or debug page) ───────────── */
export function unregister() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.unregister())
      .catch(err => console.error('[PWA] Unregister failed:', err));
  }
}

/* ── Update toast ─────────────────────────────────────────────── */
function showUpdateToast(registration) {
  // Remove existing toast if any
  const existing = document.getElementById('pwa-update-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'pwa-update-toast';
  toast.innerHTML = `
    <div style="
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#060a14; color:#ffffff;
      border:1.5px solid rgba(0,200,117,0.45);
      border-radius:16px; padding:14px 20px;
      display:flex; align-items:center; gap:14px;
      box-shadow:0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,200,117,0.1);
      z-index:999999; font-family:'Inter',system-ui,sans-serif;
      animation:pwaTIn .35s cubic-bezier(0.34,1.56,0.64,1) both;
      min-width:280px; max-width:90vw;
    ">
      <span style="font-size:20px">🏨</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:2px">
          EasyHost AI Updated
        </div>
        <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5)">
          New version ready — tap to reload
        </div>
      </div>
      <button id="pwa-update-btn" style="
        background:linear-gradient(135deg,#00c875,#00ff88);
        color:#000; border:none; border-radius:10px;
        padding:8px 16px; font-size:12px; font-weight:900;
        cursor:pointer; white-space:nowrap;
      ">Reload</button>
      <button id="pwa-dismiss-btn" style="
        background:transparent; border:none; color:rgba(255,255,255,0.35);
        font-size:18px; cursor:pointer; padding:0 4px; line-height:1;
      ">×</button>
    </div>
    <style>
      @keyframes pwaTIn {
        from { opacity:0; transform:translateX(-50%) translateY(20px); }
        to   { opacity:1; transform:translateX(-50%) translateY(0); }
      }
    </style>
  `;
  document.body.appendChild(toast);

  document.getElementById('pwa-update-btn').addEventListener('click', () => {
    toast.remove();
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  });
  document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
    toast.remove();
  });

  // Auto-dismiss after 30 s
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 30000);
}

/* ── Connectivity banner ──────────────────────────────────────── */
let _bannerEl = null;
function showConnectivityBanner(online) {
  if (_bannerEl) _bannerEl.remove();

  _bannerEl = document.createElement('div');
  _bannerEl.innerHTML = `
    <div style="
      position:fixed; top:0; left:0; right:0;
      background:${online ? '#15803d' : '#991b1b'};
      color:#fff; text-align:center;
      font-size:12px; font-weight:800; letter-spacing:0.08em;
      padding:7px 16px;
      z-index:999998;
      animation:bannerIn .25s ease both;
    ">
      ${online ? '✅ Back online — syncing data…' : '⚠️ No internet connection — working offline'}
    </div>
    <style>
      @keyframes bannerIn {
        from { transform:translateY(-100%); }
        to   { transform:translateY(0); }
      }
    </style>
  `;
  document.body.appendChild(_bannerEl);

  if (online) {
    setTimeout(() => { if (_bannerEl?.isConnected) _bannerEl.remove(); }, 3000);
  }
}
