/**
 * App config — API origin resolution.
 *
 * Local Vite (:5173): leave REACT_APP_API_URL empty → relative `/api` (proxy → Flask :1000).
 * Production (Railway): ALWAYS same-origin `/api` unless REACT_APP_API_URL is a real
 * non-localhost URL. Never keep a baked-in http://localhost:1000 on a deployed host —
 * that causes "Python Offline" + CORS failures in the browser.
 */
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

/**
 * Resolve API origin at module load (and re-check against window when available).
 * Empty string → relative `/api` (same origin as the page).
 */
function resolveApiBaseUrl() {
  const fromEnv = _normalizeOrigin(_envApiUrl());

  if (typeof window !== 'undefined') {
    const pageIsLocal = _isLocalHostname(window.location.hostname);
    // Deployed page must never call the developer's localhost Flask.
    if (!pageIsLocal && (!fromEnv || _isLocalhostUrl(fromEnv))) {
      return '';
    }
  } else if (fromEnv && _isLocalhostUrl(fromEnv)) {
    // SSR / build-time: drop localhost so production bundles stay same-origin.
    const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : '';
    if (nodeEnv === 'production') return '';
  }

  return fromEnv;
}

/** Origin only — no trailing slash, no /api suffix. Empty → same-origin + dev proxy. */
export const API_BASE_URL = resolveApiBaseUrl();

/** Full API root. Empty API_BASE_URL → '/api' (relative). */
export const API_URL = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

/** Socket.IO — same origin when API is relative; otherwise the API host. */
export const SOCKET_IO_URL =
  API_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

export const BASE_URL = API_BASE_URL;

/** Prefer live window host over any stale module constant (hot reload / mis-baked env). */
export const getAPIUrl = () => {
  if (typeof window !== 'undefined') {
    const pageIsLocal = _isLocalHostname(window.location.hostname);
    const fromEnv = _normalizeOrigin(_envApiUrl());
    if (!pageIsLocal && (!fromEnv || _isLocalhostUrl(fromEnv))) {
      return `${window.location.origin.replace(/\/+$/, '')}/api`;
    }
    if (fromEnv && !( !pageIsLocal && _isLocalhostUrl(fromEnv) )) {
      return `${fromEnv}/api`;
    }
  }
  return API_URL;
};

export const getSocketUrl = () => {
  if (typeof window === 'undefined') return SOCKET_IO_URL || '';
  const api = getAPIUrl();
  if (api.startsWith('http')) {
    return api.replace(/\/api\/?$/i, '');
  }
  return window.location.origin.replace(/\/+$/, '');
};
