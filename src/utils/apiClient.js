/**
 * API URL resolution — two layers so it works in every environment:
 *
 * Layer 1 (build-time): REACT_APP_API_URL baked in by React during `npm build`
 *   - Local   (.env):        REACT_APP_API_URL=http://127.0.0.1:1000
 *   - Render  (render.yaml): REACT_APP_API_URL=https://easyhost-backend.onrender.com
 *
 * Layer 2 (runtime fallback): if the build-time value is missing or empty,
 *   detect the current hostname at runtime:
 *   - *.onrender.com  → https://easyhost-backend.onrender.com
 *   - localhost/127.* → http://127.0.0.1:1000
 */
const _PRODUCTION_API = 'https://easyhost-backend.onrender.com';
const _LOCAL_API      = 'http://127.0.0.1:1000';

const _hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const _isLocalhost  = _hostname === 'localhost' || _hostname === '127.0.0.1';
const _isRender     = _hostname.endsWith('.onrender.com');

const _envUrl =
  typeof process !== 'undefined' && process.env?.REACT_APP_API_URL
    ? String(process.env.REACT_APP_API_URL).replace(/\/$/, '')
    : null;

export const API_URL =
  _envUrl                           // build-time value wins when set and non-empty
    ? _envUrl
    : _isRender                     // runtime: any *.onrender.com page
    ? _PRODUCTION_API
    : _isLocalhost                  // runtime: local machine
    ? _LOCAL_API
    : _PRODUCTION_API;              // unknown host — assume production

const getApiBase = () => API_URL;
const _base = getApiBase();

const getAuthHeaders = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const token = parsed?.state?.authToken;
    const tenantId = parsed?.state?.activeTenantId;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
    return headers;
  } catch {
    return {};
  }
};

/**
 * Central fetch helper - uses API_URL (current host:5000 for cross-device access)
 * On error: logs full error to console and throws with clear message
 */
export const apiRequest = async (path, options = {}) => {
  const base = typeof window !== 'undefined' ? getApiBase() : _base;
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const { method = 'GET', body, headers = {}, ...rest } = options;
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...headers,
  };
  if (body && typeof body === 'object' && !(body instanceof FormData)) {
    try {
      rest.body = JSON.stringify(body);
    } catch (e) {
      rest.body = body;
    }
  } else if (body) {
    rest.body = body;
    delete finalHeaders['Content-Type'];
  }
  try {
    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      ...rest,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || data.message || `HTTP ${response.status}`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (error) {
    console.error('[API Error] Full details:', {
      url,
      method,
      message: error?.message,
      status: error?.status,
      responseData: error?.data,
      stack: error?.stack,
    });
    throw error;
  }
};

export const apiGet = (path) => apiRequest(path, { method: 'GET' });
export const apiPost = (path, body) => apiRequest(path, { method: 'POST', body });
export const apiPut = (path, body) => apiRequest(path, { method: 'PUT', body });
export const apiPatch = (path, body) => apiRequest(path, { method: 'PATCH', body });
export const apiDelete = (path) => apiRequest(path, { method: 'DELETE' });

export const getAPIUrl = () => getApiBase();
export const API_BASE_URL = API_URL;
export default apiRequest;
