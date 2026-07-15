/**
 * App config — API / Socket origin resolution.
 *
 * Production (easyhost-ai.up.railway.app, etc.):
 *   ALWAYS same-origin — window.location.origin + '/api'
 *   Never localhost, never :1000 / :8080 on the public hostname.
 *
 * Local development:
 *   - Vite (:5173) / CRA (:3000) → relative '/api' (dev proxy → Flask :1000)
 *   - Explicit REACT_APP_API_URL=http://localhost:1000 → allowed on localhost only
 *   - Fallback when local and no proxy port → http://127.0.0.1:1000/api
 */

const LOCAL_FLASK_ORIGIN = 'http://127.0.0.1:1000';
const DEV_PROXY_PORTS = new Set(['5173', '3000', '3001', '4173', '4280']);

function _envApiUrl() {
  if (typeof process === 'undefined' || !process.env) return '';
  return String(process.env.REACT_APP_API_URL ?? '').trim();
}

function _isLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

function _isLocalhostUrl(url) {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(String(url || '').trim());
}

function _normalizeOrigin(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
}

/** Drop internal Flask ports from public URLs (Railway terminates TLS on 443). */
function _stripInternalPorts(origin) {
  try {
    const u = new URL(origin);
    if (!_isLocalHostname(u.hostname) && (u.port === '1000' || u.port === '8080')) {
      u.port = '';
    }
    return u.origin.replace(/\/+$/, '');
  } catch {
    return String(origin || '')
      .replace(/:(1000|8080)(?=\/|$)/g, '')
      .replace(/\/+$/, '');
  }
}

function _pageIsProductionHost() {
  if (typeof window === 'undefined') {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  }
  return !_isLocalHostname(window.location.hostname);
}

/**
 * Live API root (…/api). Safe to call on every request.
 */
export function getAPIUrl() {
  if (typeof window !== 'undefined') {
    const { hostname, origin, port } = window.location;
    const pageLocal = _isLocalHostname(hostname);

    // ── Production / Railway ──────────────────────────────────────────────
    if (!pageLocal) {
      return `${_stripInternalPorts(origin)}/api`;
    }

    // ── Local browser ─────────────────────────────────────────────────────
    const fromEnv = _normalizeOrigin(_envApiUrl());
    if (fromEnv) {
      return `${fromEnv}/api`;
    }

    // Vite / CRA proxy ports → relative /api
    if (DEV_PROXY_PORTS.has(String(port || ''))) {
      return '/api';
    }

    // SPA already served by Flask (local :1000 or :8080) → same-origin
    if (String(port) === '1000' || String(port) === '8080' || !port) {
      return '/api';
    }

    // Last resort local absolute Flask
    return `${LOCAL_FLASK_ORIGIN}/api`;
  }

  // Build / SSR (no window)
  const fromEnv = _normalizeOrigin(_envApiUrl());
  if (_pageIsProductionHost() || (fromEnv && _isLocalhostUrl(fromEnv) && process.env?.NODE_ENV === 'production')) {
    return '/api';
  }
  if (fromEnv) return `${fromEnv}/api`;
  return '/api';
}

/**
 * Live API origin without /api (empty string means same-origin / relative).
 */
export function getAPIBaseUrl() {
  const api = getAPIUrl();
  if (!api || api === '/api' || api.startsWith('/')) return '';
  return api.replace(/\/api\/?$/i, '');
}

export function getSocketUrl() {
  if (typeof window === 'undefined') {
    const base = getAPIBaseUrl();
    return base || '';
  }
  const base = getAPIBaseUrl();
  if (base) return _stripInternalPorts(base);
  return _stripInternalPorts(window.location.origin);
}

/**
 * Proxy so existing `${API_URL}/tasks` call sites always use the live host.
 * String methods (startsWith, replace, …) are forwarded to the resolved URL.
 */
function createLiveString(resolver) {
  const handler = {
    get(_target, prop) {
      const live = String(resolver());
      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
        return () => live;
      }
      if (prop === Symbol.toStringTag) return 'String';
      if (prop === 'constructor') return String;
      const value = live[prop];
      return typeof value === 'function' ? value.bind(live) : value;
    },
    has(_target, prop) {
      return prop in String(resolver());
    },
  };
  return new Proxy({}, handler);
}

/** @type {string} Live — prefer getAPIUrl() for new code. */
export const API_URL = createLiveString(getAPIUrl);

/** @type {string} Live origin without /api ('' when same-origin). */
export const API_BASE_URL = createLiveString(getAPIBaseUrl);

/** @type {string} Live Socket.IO origin. */
export const SOCKET_IO_URL = createLiveString(getSocketUrl);

export const BASE_URL = API_BASE_URL;

// Debug globals (production must never show :1000)
if (typeof window !== 'undefined') {
  const resolved = getAPIUrl();
  window.__EASYHOST_API_URL__ = resolved;
  window.__EASYHOST_BASE_URL__ = getAPIBaseUrl() || window.location.origin;
  if (/:(1000)\b/.test(resolved) && _pageIsProductionHost()) {
    console.error('[EasyHost] Refusing :1000 API URL on production host — forcing same-origin /api');
    window.__EASYHOST_API_URL__ = `${window.location.origin}/api`;
  }
  console.log(
    `%c[EasyHost] API → ${window.__EASYHOST_API_URL__}`,
    'color:#6366f1;font-weight:bold',
  );
}
