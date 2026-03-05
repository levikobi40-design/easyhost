/**
 * apiClient.js — single source of truth for the backend URL.
 *
 * Resolution order (first match wins):
 *   1. Running on *.onrender.com            → https://easyhost.onrender.com  (hard-pinned)
 *   2. REACT_APP_API_URL env var is set      → use that value
 *   3. Running on localhost / 127.0.0.1      → http://localhost:1000
 *   4. Any other host                        → https://easyhost.onrender.com  (safe fallback)
 *
 * Local dev:  npm start  →  http://localhost:3000  →  API goes to http://localhost:1000
 * Production: Render      →  https://easyhost.onrender.com (frontend + backend same domain)
 */

const PRODUCTION_URL = 'https://easyhost.onrender.com';
const LOCAL_URL      = 'http://localhost:1000';

const _hostname    = typeof window !== 'undefined' ? window.location.hostname : '';
const _isLocalhost = _hostname === 'localhost' || _hostname === '127.0.0.1';
const _isRender    = _hostname.endsWith('.onrender.com');

// REACT_APP_API_URL is baked in at build time by Create React App from .env
const _envUrl = (() => {
  try {
    const raw = process.env?.REACT_APP_API_URL;
    if (!raw || !raw.trim() || raw.trim() === '""') return null;
    return raw.trim().replace(/\/$/, '');
  } catch { return null; }
})();

export const API_URL = (() => {
  if (_isRender)    return PRODUCTION_URL;   // always prod when on Render
  if (_envUrl)      return _envUrl;          // .env override (local dev)
  if (_isLocalhost) return LOCAL_URL;        // localhost safety net
  return PRODUCTION_URL;                     // unknown host → prod
})();

// Log exactly which URL is being used — check browser console to verify
if (typeof window !== 'undefined') {
  const env = _isRender ? 'production (Render)' : _isLocalhost ? 'local dev' : 'unknown';
  console.log(`%c[EasyHost] API → ${API_URL}  (${env})`, 'color:#6366f1;font-weight:bold');
}

// ── Auth helpers ────────────────────────────────────────────────────────────
const getAuthHeaders = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const token    = parsed?.state?.authToken;
    const tenantId = parsed?.state?.activeTenantId;
    const headers  = {};
    if (token)    headers.Authorization = `Bearer ${token}`;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
    return headers;
  } catch { return {}; }
};

// ── Core fetch wrapper ───────────────────────────────────────────────────────
export const apiRequest = async (path, options = {}) => {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const { method = 'GET', body, headers = {}, ...rest } = options;

  const finalHeaders = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...headers,
  };

  // Don't set Content-Type for FormData — browser sets it with boundary
  if (body instanceof FormData) {
    delete finalHeaders['Content-Type'];
    rest.body = body;
  } else if (body && typeof body === 'object') {
    rest.body = JSON.stringify(body);
  } else if (body) {
    rest.body = body;
  }

  try {
    const response = await fetch(url, { method, headers: finalHeaders, ...rest });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || data.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.data   = data;
      throw err;
    }
    return data;
  } catch (error) {
    if (error.status) throw error; // already a structured API error
    // Network error — give a clear message
    const netErr = new Error(
      `Cannot reach server at ${API_URL}. ` +
      (_isLocalhost
        ? 'Make sure the Python backend is running: python app.py'
        : 'The Render service may be starting up — try again in 30 seconds.')
    );
    netErr.isNetworkError = true;
    console.error('[EasyHost] Network error:', url, error.message);
    throw netErr;
  }
};

// ── Shorthand helpers ────────────────────────────────────────────────────────
export const apiGet    = (path)        => apiRequest(path, { method: 'GET' });
export const apiPost   = (path, body)  => apiRequest(path, { method: 'POST',  body });
export const apiPut    = (path, body)  => apiRequest(path, { method: 'PUT',   body });
export const apiPatch  = (path, body)  => apiRequest(path, { method: 'PATCH', body });
export const apiDelete = (path)        => apiRequest(path, { method: 'DELETE' });

export const getAPIUrl    = () => API_URL;
export const API_BASE_URL = API_URL;
export default apiRequest;
