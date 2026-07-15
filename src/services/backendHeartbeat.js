import { API_URL, applyAuthModeFromHealth, getAPIUrl } from '../utils/apiClient';

const _fetchHealth = async (path, timeoutMs) => {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const id = ctrl ? window.setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const root = getAPIUrl();
  try {
    return await fetch(`${root}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    });
  } finally {
    if (id) window.clearTimeout(id);
  }
};

/**
 * Polls Flask /api/health (and /api/heartbeat shape) so the UI stays in sync with Python.
 */
export function startBackendHeartbeat(intervalMs = 30000) {
  const timeoutMs = 10000;
  const tick = async () => {
    try {
      let res = await _fetchHealth('/health', timeoutMs);
      let data = await res.json().catch(() => ({}));
      let alive = res.ok && (data.status === 'ok' || data.ok === true);
      if (alive) {
        applyAuthModeFromHealth(data);
      }
      if (!alive) {
        res = await _fetchHealth('/heartbeat', timeoutMs);
        data = await res.json().catch(() => ({}));
        alive = res.ok && (data.ok === true || typeof data.server_time === 'string');
        if (alive) applyAuthModeFromHealth(data);
      }
      if (alive) {
        window.__EASYHOST_HEARTBEAT_OK__ = true;
        window.dispatchEvent(new CustomEvent('easyhost-heartbeat', { detail: data }));
      } else {
        window.__EASYHOST_HEARTBEAT_OK__ = false;
      }
    } catch {
      window.__EASYHOST_HEARTBEAT_OK__ = false;
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}
