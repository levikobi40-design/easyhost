import { API_URL } from '../utils/apiClient';

const _fetchHealth = async (path, timeoutMs) => {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const id = ctrl ? window.setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(`${API_URL}${path}`, {
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
      if (!alive) {
        res = await _fetchHealth('/heartbeat', timeoutMs);
        data = await res.json().catch(() => ({}));
        alive = res.ok && (data.ok === true || typeof data.server_time === 'string');
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
