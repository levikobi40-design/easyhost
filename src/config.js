/**
 * App config — API origin resolved from the REACT_APP_API_URL build-time env var.
 *
 * Production (Railway / Render / any same-origin deployment):
 *   Do NOT set REACT_APP_API_URL (or set it to '').
 *   All /api/... calls are relative — same domain as the page, no cross-origin, no port.
 *
 * Local dev — two options (pick one):
 *   a) Zero-config proxy (recommended): just run `npm start`.
 *      CRA forwards /api/* to http://localhost:1000 via "proxy" in package.json.
 *   b) Explicit origin: set REACT_APP_API_URL=http://localhost:1000 in .env
 *      (useful for LAN/phone testing or when bypassing the proxy).
 */
const _raw = (
  typeof process !== 'undefined' && process.env
    ? String(process.env.REACT_APP_API_URL ?? '')
    : ''
).trim();

/** Origin only — no trailing slash, no /api suffix. Empty string → same-origin. */
export const API_BASE_URL = _raw.replace(/\/+$/, '').replace(/\/api$/i, '');

/** Full API root. Empty API_BASE_URL → '/api' (relative, same-origin). */
export const API_URL = API_BASE_URL ? `${API_BASE_URL}/api` : '/api';

/** Socket.IO connects to the Flask origin (not the /api path). */
export const SOCKET_IO_URL =
  API_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

export const BASE_URL  = API_BASE_URL;
export const getAPIUrl = () => API_URL;
