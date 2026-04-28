/**
 * App config — API origin + `/api` path (no double slashes in fetch URLs).
 * REACT_APP_API_URL: origin only (e.g. https://app.example.com or http://127.0.0.1:1000), not …/api.
 *
 * When REACT_APP_API_URL is unset:
 * - localhost / 127.0.0.1 → http://127.0.0.1:1000 (CRA dev + local Flask).
 * - Hostname + typical React dev port (3000, 5173, …) → same host, port 1000 (LAN phone dev).
 * - Otherwise → window.location.origin (production / same-origin Flask or reverse proxy).
 */
const _DEV_API_DEFAULT = 'http://127.0.0.1:1000';
const _REACT_DEV_PORTS = new Set(['3000', '3001', '3002', '5173', '5174', '4173', '4280']);
const _raw = (typeof process !== 'undefined' && process.env && String(process.env.REACT_APP_API_URL || '').trim()) || '';
let _origin = _raw.replace(/\/+$/, '').replace(/\/api$/i, '');
if (!_origin && typeof window !== 'undefined') {
  const h = window.location.hostname;
  const portStr = String(window.location.port || '');
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  if (h === 'localhost' || h === '127.0.0.1') {
    _origin = _DEV_API_DEFAULT;
  } else if (h && _REACT_DEV_PORTS.has(portStr)) {
    _origin = `${proto}//${h}:1000`;
  } else if (h) {
    _origin = window.location.origin;
  }
}
if (!_origin) {
  _origin = _DEV_API_DEFAULT;
}
export const API_BASE_URL = _origin;
/** Strict API root: http://localhost:1000/api — use `${API_URL}/properties`, `${API_URL}/property-tasks` */
export const API_URL = `${_origin}/api`;
/** Socket.IO connects to Flask origin (port 1000), not the /api path. */
export const SOCKET_IO_URL = API_BASE_URL;
export const BASE_URL = API_BASE_URL;
export const getAPIUrl = () => API_URL;
