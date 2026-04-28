/**
 * apiClient.js — fetch helpers; base URL from config.js (localhost:1000).
 */
import {
  API_BASE_URL,
  API_URL,
  SOCKET_IO_URL,
  BASE_URL,
  getAPIUrl,
} from '../config.js';

export { API_BASE_URL, API_URL, SOCKET_IO_URL, BASE_URL, getAPIUrl };

const _isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// Log + global for debugging (“why is the dashboard empty?”)
if (typeof window !== 'undefined') {
  window.__EASYHOST_API_URL__ = API_URL;
  window.__EASYHOST_BASE_URL__ = API_BASE_URL;
  console.log(
    `%c[EasyHost] API → ${API_URL}  (${_isLocalhost ? 'local dev' : 'hardcoded'})`,
    'color:#6366f1;font-weight:bold',
  );
}

// ── Auth helpers ────────────────────────────────────────────────────────────

/**
 * Returns true only when the stored token looks like a real JWT (3 base64url
 * parts separated by dots) and is not a demo-offline placeholder.
 * Demo-offline tokens (`demo-offline-<ts>`) are not valid JWTs and will
 * always be rejected by the backend when AUTH_DISABLED=false.
 */
export const hasValidAuthToken = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    if (!raw) return false;
    const token = JSON.parse(raw)?.state?.authToken;
    if (!token || typeof token !== 'string') return false;
    if (token.startsWith('demo-offline-')) return false;
    return token.split('.').length === 3;
  } catch { return false; }
};

export const getAuthHeaders = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const token    = parsed?.state?.authToken;
    const tenantId = parsed?.state?.activeTenantId;
    const headers  = {};
    // Only attach a proper 3-part JWT. demo-offline-* placeholders are not
    // real JWTs and will always be rejected by the backend with 401.
    if (
      token &&
      typeof token === 'string' &&
      !token.startsWith('demo-offline-') &&
      token.split('.').length === 3
    ) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
    return headers;
  } catch { return {}; }
};

/** Merge Authorization + tenant headers into fetch init (for call sites that cannot use apiRequest). */
export const withAuthFetchInit = (init = {}) => {
  const h = getAuthHeaders();
  const headers = new Headers(init.headers || {});
  if (h.Authorization) headers.set('Authorization', h.Authorization);
  if (h['X-Tenant-Id']) headers.set('X-Tenant-Id', h['X-Tenant-Id']);
  return { ...init, headers };
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
    const response = await fetch(url, { method, headers: finalHeaders, credentials: 'include', ...rest });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        // Signal the app that the stored token is no longer accepted.
        // App.js listens for this event to clear auth state and show the login page.
        window.dispatchEvent(new CustomEvent('easyhost-auth-required', { detail: { url, status: 401 } }));
      }
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

// ── Retry logic for intermittent network (file uploads, etc.) ────────────────
/**
 * Fetch with retry: handles transient network failures.
 * Retries on: network errors, 5xx, 429. Uses exponential backoff (1s, 2s, 4s).
 */
export const fetchWithRetry = async (url, options = {}, opts = {}) => {
  const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;
  const { maxRetries = 3, baseDelayMs = 1000 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(fullUrl, options);
      const shouldRetry = res.status >= 500 || res.status === 429;
      if (!res.ok && !shouldRetry) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.response = res;
        throw err;
      }
      if (shouldRetry && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      const isRetryable = e.message?.includes('fetch') || e.isNetworkError || !e.status || e.status >= 500;
      if (attempt < maxRetries && isRetryable) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
};

// ── Shorthand helpers ────────────────────────────────────────────────────────
export const apiGet    = (path)        => apiRequest(path, { method: 'GET' });
export const apiPost   = (path, body)  => apiRequest(path, { method: 'POST',  body });
export const apiPut    = (path, body)  => apiRequest(path, { method: 'PUT',   body });
export const apiPatch  = (path, body)  => apiRequest(path, { method: 'PATCH', body });
export const apiDelete = (path)        => apiRequest(path, { method: 'DELETE' });

export default apiRequest;
