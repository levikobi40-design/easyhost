/**
 * apiClient.js — fetch helpers; base URL from config.js (live same-origin in production).
 */
import {
  API_BASE_URL,
  API_URL,
  SOCKET_IO_URL,
  BASE_URL,
  getAPIUrl,
  getAPIBaseUrl,
  getSocketUrl,
} from '../config.js';

export {
  API_BASE_URL,
  API_URL,
  SOCKET_IO_URL,
  BASE_URL,
  getAPIUrl,
  getAPIBaseUrl,
  getSocketUrl,
};

const _isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

if (typeof window !== 'undefined') {
  window.__EASYHOST_API_URL__ = getAPIUrl();
  window.__EASYHOST_BASE_URL__ = getAPIBaseUrl() || window.location.origin;
  console.log(
    `%c[EasyHost] API → ${getAPIUrl()}  (${_isLocalhost ? 'local' : 'same-origin'})`,
    'color:#6366f1;font-weight:bold',
  );
}

// ── Auth helpers ────────────────────────────────────────────────────────────

/** Decode JWT payload without verifying signature (client-side exp check only). */
const _parseJwtPayload = (token) => {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return JSON.parse(atob(normalized + pad));
  } catch {
    return null;
  }
};

/** True when JWT is structurally valid and not past exp (60s clock skew). */
const _isUnexpiredJwt = (t) => {
  if (!_isRealJwtShape(t)) return false;
  const payload = _parseJwtPayload(t);
  if (!payload) return false;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) return true; // no exp claim → treat as usable
  return Date.now() / 1000 < exp - 60;
};

/** Returns true only for real 3-part JWTs (not demo-offline-* placeholders). */
const _isRealJwtShape = (t) =>
  t && typeof t === 'string' && !t.startsWith('demo-offline-') && t.split('.').length === 3;

const _isRealJwt = (t) => _isUnexpiredJwt(t);

/** Clear expired / invalid tokens from all known stores so we stop sending 401 bait. */
export const clearStaleAuthTokens = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    if (raw) {
      const parsed = JSON.parse(raw);
      const tok = parsed?.state?.authToken;
      if (tok && !_isUnexpiredJwt(tok)) {
        if (parsed.state) {
          parsed.state.authToken = null;
          localStorage.setItem('hotel-enterprise-storage', JSON.stringify(parsed));
        }
      }
    }
  } catch { /* ignore */ }
  try {
    const loginRaw = localStorage.getItem('hotel-login-state');
    if (loginRaw) {
      const ls = JSON.parse(loginRaw);
      if (ls?.token && !_isUnexpiredJwt(ls.token)) {
        delete ls.token;
        localStorage.setItem('hotel-login-state', JSON.stringify(ls));
      }
    }
  } catch { /* ignore */ }
  try {
    const direct = localStorage.getItem('easyhost_auth_token');
    if (direct && !_isUnexpiredJwt(direct)) {
      localStorage.removeItem('easyhost_auth_token');
    }
  } catch { /* ignore */ }
};

/** Staging / AUTH_DISABLED: backend soft-auth — do not force login on 401. */
export const isAuthBypassedClient = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.__EASYHOST_AUTH_DISABLED__ ||
    window.__EASYHOST_AUTH_RELAXED__ ||
    localStorage.getItem('easyhost_auth_bypass') === '1'
  );
};

export const applyAuthModeFromHealth = (data = {}) => {
  if (typeof window === 'undefined') return;
  const disabled = data.auth_disabled === true;
  const relaxed = data.auth_relaxed === true;
  window.__EASYHOST_AUTH_DISABLED__ = disabled;
  window.__EASYHOST_AUTH_RELAXED__ = relaxed;
  try {
    if (disabled || relaxed) {
      localStorage.setItem('easyhost_auth_bypass', '1');
    } else {
      localStorage.removeItem('easyhost_auth_bypass');
    }
  } catch { /* ignore */ }
};

/**
 * Returns true only when the stored token looks like a real JWT (3 base64url
 * parts separated by dots), is not a demo-offline placeholder, and is unexpired.
 */
export const hasValidAuthToken = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const t1  = raw ? JSON.parse(raw)?.state?.authToken : null;
    if (_isRealJwt(t1)) return true;

    const loginRaw = localStorage.getItem('hotel-login-state');
    const t2 = loginRaw ? JSON.parse(loginRaw)?.token : null;
    if (_isRealJwt(t2)) return true;

    const t3 = localStorage.getItem('easyhost_auth_token');
    return _isRealJwt(t3);
  } catch { return false; }
};

export const getAuthHeaders = () => {
  try {
    // Drop expired tokens first so we never send "Token expired" bait to the API.
    clearStaleAuthTokens();

    // ── Primary: Zustand persisted store (hotel-enterprise-storage) ──────────
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const parsed = raw ? JSON.parse(raw) : null;
    const token    = parsed?.state?.authToken;
    const tenantId = parsed?.state?.activeTenantId;
    if (_isRealJwt(token)) {
      const h = { Authorization: `Bearer ${token}` };
      if (tenantId) h['X-Tenant-Id'] = tenantId;
      return h;
    }

    // ── Fallback 1: LoginPage stored state (hotel-login-state) ───────────────
    const loginRaw = localStorage.getItem('hotel-login-state');
    if (loginRaw) {
      const ls = JSON.parse(loginRaw);
      if (_isRealJwt(ls?.token)) {
        const h = { Authorization: `Bearer ${ls.token}` };
        if (ls.tenantId) h['X-Tenant-Id'] = ls.tenantId;
        return h;
      }
    }

    // ── Fallback 2: direct token key written by applyAuth() ──────────────────
    const direct = localStorage.getItem('easyhost_auth_token');
    if (_isRealJwt(direct)) {
      return { Authorization: `Bearer ${direct}` };
    }

    // Staging / AUTH_DISABLED: still send X-Tenant-Id when known (soft auth).
    if (tenantId) return { 'X-Tenant-Id': tenantId };
    return {};
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

const _emitAuthRequired = (url, status) => {
  if (typeof window === 'undefined') return;
  // Pilot/staging soft-auth: clear bad tokens but do not force LoginPage.
  if (isAuthBypassedClient()) {
    clearStaleAuthTokens();
    return;
  }
  clearStaleAuthTokens();
  window.dispatchEvent(new CustomEvent('easyhost-auth-required', { detail: { url, status } }));
};

// ── Core fetch wrapper ───────────────────────────────────────────────────────
export const apiRequest = async (path, options = {}) => {
  const apiRoot = typeof window !== 'undefined' ? getAPIUrl() : API_URL;
  const url = path.startsWith('http') ? path : `${apiRoot}${path.startsWith('/') ? path : `/${path}`}`;
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
    let response = await fetch(url, { method, headers: finalHeaders, credentials: 'include', ...rest });
    // Expired JWT / redeploy secret mismatch: retry once without Authorization.
    if (response.status === 401 && finalHeaders.Authorization) {
      clearStaleAuthTokens();
      const retryHeaders = { ...finalHeaders };
      delete retryHeaders.Authorization;
      response = await fetch(url, { method, headers: retryHeaders, credentials: 'include', ...rest });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return data;
      }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) _emitAuthRequired(url, 401);
      const err = new Error(data.message || data.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.data   = data;
      throw err;
    }
    return data;
  } catch (error) {
    if (error.status) throw error; // already a structured API error
    // Network error — give a clear message
    const netErr = new Error(
      `Cannot reach server at ${apiRoot}. ` +
      (_isLocalhost
        ? 'Make sure the Python backend is running: python app.py'
        : 'The service may be starting up — try again in 30 seconds.')
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
 * Auth headers are injected automatically (same as apiRequest).
 */
export const fetchWithRetry = async (url, options = {}, opts = {}) => {
  const apiRoot = typeof window !== 'undefined' ? getAPIUrl() : API_URL;
  const fullUrl = url.startsWith('http') ? url : `${apiRoot}${url.startsWith('/') ? url : `/${url}`}`;
  const { maxRetries = 3, baseDelayMs = 1000 } = opts;

  // Inject auth headers unless the caller already provides Authorization
  const authHeaders = getAuthHeaders();
  const callerHeaders = options.headers instanceof Headers
    ? Object.fromEntries(options.headers.entries())
    : (options.headers || {});
  const mergedHeaders = { ...authHeaders, ...callerHeaders };

  const mergedOptions = { ...options, headers: mergedHeaders };

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(fullUrl, mergedOptions);
      if (res.status === 401 && typeof window !== 'undefined') {
        _emitAuthRequired(fullUrl, 401);
      }
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
