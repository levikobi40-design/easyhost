/**
 * API URL resolution:
 *  - Production (Render): REACT_APP_API_URL="" → relative URLs (/api/...)
 *    Flask serves both frontend and backend on the same domain.
 *  - Local dev: falls back to http://127.0.0.1:1000 (Python on port 1000)
 *  - Override: set REACT_APP_API_URL in .env
 */
const _isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const _envUrl =
  typeof process !== 'undefined' && process.env?.REACT_APP_API_URL !== undefined
    ? String(process.env.REACT_APP_API_URL).replace(/\/$/, '')
    : null;

// Empty string = same-origin (Render production). Localhost = explicit port.
export const API_URL =
  _envUrl !== null
    ? _envUrl                        // .env or render.yaml value wins
    : _isLocalhost
    ? 'http://127.0.0.1:1000'        // local dev default
    : '';                            // production: same-origin relative URLs

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
