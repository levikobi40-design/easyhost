/**
 * App config — API origin from REACT_APP_API_URL.
 *
 * Local dev (Vite on :5173 — see vite.config.js):
 *   Leave REACT_APP_API_URL empty → relative `/api` via Vite proxy → Flask :1000.
 *
 * Production: leave unset → same-origin `/api`.
 */
const _envRaw =
  typeof process !== 'undefined' && process.env
    ? String(process.env.REACT_APP_API_URL ?? '').trim()
    : '';

/** Dev default: empty string = use CRA proxy (see src/setupProxy.js). */
const _devDefault =
  typeof process !== 'undefined' &&
  process.env &&
  process.env.NODE_ENV === 'development'
    ? ''
    : '';

const _raw = (_envRaw || _devDefault).trim();

/** Origin only — no trailing slash, no /api suffix. Empty → same-origin + dev proxy. */
export const API_BASE_URL = _raw.replace(/\/+$/, '').replace(/\/api$/i, '');

/** Full API root. Empty API_BASE_URL → '/api' (relative). */
export const API_URL = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

/** Socket.IO — same origin in dev (proxied) or explicit API origin. */
export const SOCKET_IO_URL =
  API_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

export const BASE_URL = API_BASE_URL;
export const getAPIUrl = () => API_URL;
