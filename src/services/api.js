import i18n from '../i18n';
import { API_BASE_URL } from '../config.js';
import { API_URL, getAPIUrl, apiRequest } from '../utils/apiClient';
import { getWorkerPayloadForMaya } from '../utils/workerMemory';
import { fetchWithTimeout } from '../utils/automationHandler';
import {
  enqueueTaskUpdate,
  removeQueuedTaskUpdate,
  getQueuedTaskUpdates,
} from '../utils/taskUpdateQueue';
import hotelRealtime from './hotelRealtime';

/** Maya brain (Flask → Claude/Gemini): hard cap so the client never hangs for minutes. */
const MAYA_CHAT_TIMEOUT_MS = 55_000;
/** After this many ms the UI shows “Working on it” while the request continues (see MayaChat). */
export const MAYA_CHAT_SLOW_HINT_MS = 2000;

/** When POST /ai/maya-command is unreachable — keeps Maya UI alive (no canned occupancy %). */
export const MAYA_OFFLINE_FALLBACK_HE =
  'קובי, אני כאן אבל אין חיבור לשרת כרגע. נסה שוב בעוד רגע או ודא שה-backend רץ על פורט 1000.';

const getBase = () => (typeof window !== 'undefined' ? getAPIUrl() : API_URL);

console.log('[EasyHost AI API] Using backend URL:', API_URL);

// Debug helper - logs all API requests
const logRequest = (method, url, payload) => {
  console.log(`[API] ${method} ${url}`);
  if (payload) console.log('[API] Payload:', payload);
};

const logResponse = (url, status, data) => {
  console.log(`[API] Response from ${url}:`, status, data);
};

const getAuthContext = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      token: parsed?.state?.authToken,
      tenantId: parsed?.state?.activeTenantId,
    };
  } catch (error) {
    return {};
  }
};

const getAuthHeaders = () => {
  const { token, tenantId } = getAuthContext();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;
  return headers;
};

/** GET /local-ip - machine's LAN IP for QR code (mobile access) */
export const getLocalAppUrl = async () => {
  try {
    const response = await fetch(`${getBase()}/local-ip`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.appUrl || `http://${data.ip || '127.0.0.1'}:3000`;
  } catch {
    return null;
  }
};

/**
 * Health check - get server status
 * @returns {Promise<object>} { ok, status, openai_configured, sse_clients }
 */
export const getHealth = async () => {
  const url = `${API_URL}/health`;
  logRequest('GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) {
      console.error(`[API] Health check failed: HTTP ${response.status}`);
      throw new Error('Health check failed');
    }

    const data = await response.json();
    logResponse(url, response.status, data);
    return data;
  } catch (error) {
    console.error('[API] Error checking health:', error);
    throw error;
  }
};

const _healthFetchOnce = async (url, ms) => {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const id = ctrl ? window.setTimeout(() => ctrl.abort(), ms) : null;
  try {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    });
    return res;
  } finally {
    if (id) window.clearTimeout(id);
  }
};

/** GET /api/health — minimal Python/Flask liveness (startup banner + Maya wake).
 *  Uses 2 attempts with generous per-attempt timeouts so a slow cold-start
 *  doesn't trigger a false "Python Offline" banner. */
export async function checkPythonApiHealth() {
  const timeouts = [6000, 10000];   // attempt 1: 6 s, attempt 2: 10 s
  const baseDelay = 1200;           // wait 1.2 s between retries (cold-start grace)
  for (let i = 0; i < timeouts.length; i += 1) {
    try {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, baseDelay));
      }
      const timeoutMs = timeouts[i];
      let res = await _healthFetchOnce(`${API_URL}/health`, timeoutMs);
      let data = await res.json().catch(() => ({}));
      if (res.ok && (data.status === 'ok' || data.ok === true)) {
        return { ok: true, data };
      }
      // /heartbeat as fallback (some deployments only expose that)
      res = await _healthFetchOnce(`${API_URL}/heartbeat`, timeoutMs);
      data = await res.json().catch(() => ({}));
      if (res.ok && (data.ok === true || typeof data.server_time === 'string')) {
        return { ok: true, data };
      }
    } catch {
      /* network error — retry */
    }
  }
  return { ok: false, data: {} };
}

export const loginAuth = async (email, password) => {
  const url = `${API_URL}/auth/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  console.log('[loginAuth] Server response:', response.status, response.statusText, data);
  if (!response.ok) {
    throw new Error(data.error || `Login failed (${response.status})`);
  }
  return data;
};

export const registerAuth = async (email, password) => {
  const url = `${API_URL}/auth/register`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Registration failed');
  }
  return data;
};

export const getDemoAuthToken = async (tenantId) => {
  const url = `${API_URL}/auth/demo`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tenant_id: tenantId }),
  });
  if (!response.ok) {
    throw new Error('Failed to get demo token');
  }
  return await response.json();
};

export const getPilotAccessToken = async (tenantName) => {
  const url = `${API_URL}/auth/pilot`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tenant_name: tenantName }),
  });
  if (!response.ok) {
    throw new Error('Failed to get pilot token');
  }
  return await response.json();
};

/** POST /integrations/ical-prep-tasks — Airbnb/Booking iCal → check-in prep tasks on mission board */
export const syncIcalPrepTasks = async (icalUrl, propertyId = '') => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/integrations/ical-prep-tasks`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({
      ical_url: String(icalUrl || '').trim(),
      property_id: propertyId ? String(propertyId).trim() : undefined,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || 'iCal sync failed');
  }
  return data;
};

/** GET /reports/daily-property-tasks — completed vs pending (24h), Hebrew text */
export const fetchDailyPropertyTasksReport = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/reports/daily-property-tasks`, {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load report');
  return data;
};

export const connectCalendar = async (icalUrl, nightlyRate) => {
  const url = `${API_URL}/onboarding/ical`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ ical_url: icalUrl, nightly_rate: nightlyRate }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to sync calendar');
  }
  return await response.json();
};

export const getCalendarStatus = async () => {
  const url = `${API_URL}/onboarding/status`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch calendar status');
  }
  return await response.json();
};

export const refreshCalendar = async () => {
  const url = `${API_URL}/onboarding/ical/refresh`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to refresh calendar');
  }
  return await response.json();
};

export const createManualCheckout = async (checkoutDate, room) => {
  const url = `${API_URL}/onboarding/manual-checkout`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ checkout_date: checkoutDate, room }),
  });
  if (!response.ok) {
    throw new Error('Failed to create manual checkout');
  }
  return await response.json();
};

export const getManualRooms = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const url = `${API_URL}/rooms/manual`;
  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch manual rooms');
  }
  return await response.json();
};

/**
 * POST /ai/maya-command — Maya chat (tasks + Gemini). Same handler as POST /chat.
 * Raw AI tools may use POST /ai-response (God Mode / tools).
 */
export const sendMayaCommand = async (command, tasksForAnalysis = null, history = null, language = null, { onDelta } = {}) => {
  const auth = getAuthHeaders();
  const { tenantId: ctxTenant } = getAuthContext();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  };
  if (auth.Authorization) headers.Authorization = auth.Authorization;
  if (auth['X-Tenant-Id']) headers['X-Tenant-Id'] = auth['X-Tenant-Id'];
  const payload = { command, sse: true };
  if (ctxTenant) payload.tenantId = ctxTenant;
  if (tasksForAnalysis && Array.isArray(tasksForAnalysis)) payload.tasksForAnalysis = tasksForAnalysis;
  if (history && Array.isArray(history)) payload.history = history.slice(-6);
  if (language) payload.language = language;  /* en | he | th — Maya responds in guest language */
  payload.stream = true; /* Gemini streaming collect on server; MAYA_GEMINI_USE_STREAM default-on */
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const ur = raw ? JSON.parse(raw)?.state?.role : null;
    if (ur) payload.userRole = ur;
  } catch (_) {}

  try {
    const wm = getWorkerPayloadForMaya();
    if (wm.workerDisplayName) payload.workerDisplayName = wm.workerDisplayName;
    if (wm.workerProfile) payload.workerProfile = wm.workerProfile;
    if (wm.workerMemoryLines?.length) payload.workerMemoryLines = wm.workerMemoryLines;
  } catch (_) {}

  const parseMayaSseResponse = async (response, onDelta) => {
    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      throw new Error('Maya SSE: streaming not supported in this browser');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    const processLine = (line) => {
      const trimmed = line.trimEnd();
      if (!trimmed.startsWith('data:')) return;
      const raw = trimmed.slice(5).trim();
      if (!raw) return;
      try {
        const obj = JSON.parse(raw);
        if (obj && obj.type === 'delta' && typeof obj.text === 'string' && obj.text) {
          if (typeof onDelta === 'function') onDelta(obj.text);
        }
        if (obj && obj.type === 'done' && obj.result != null) {
          finalResult = obj.result;
        }
      } catch (_) {
        /* ignore partial / malformed JSON lines */
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) processLine(line);
    }
    if (!finalResult) {
      throw new Error('Maya SSE: no result from server');
    }
    return finalResult;
  };

  const doPost = async () => {
    const response = await fetchWithTimeout(
      `${API_URL}/ai/maya-command`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'include',
      },
      MAYA_CHAT_TIMEOUT_MS,
    );
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/event-stream')) {
      if (!response.ok) {
        const err = new Error(`Request failed (${response.status})`);
        err.status = response.status;
        throw err;
      }
      return parseMayaSseResponse(response, onDelta);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg =
        data.displayMessage || data.error || data.message || data.response || `Request failed (${response.status})`;
      const err = new Error(errMsg);
      err.data = data;
      err.status = response.status;
      if (response.status === 401) err.code = 'unauthorized';
      if (response.status === 429) err.code = 'rate_limit';
      throw err;
    }
    return data;
  };

  const postMayaAndBumpTasks = async () => {
    const data = await doPost();
    if (typeof window !== 'undefined' && data && (data.taskCreated || data.taskCompleted)) {
      window.dispatchEvent(new Event('maya-refresh-tasks'));
      if (data.taskCompleted) {
        window.dispatchEvent(new CustomEvent('mission-full-tasks-refresh'));
      }
      hotelRealtime.publishLocal('task_updated', {
        task: data.task,
        tasks: data.tasks,
        taskCompleted: Boolean(data.taskCompleted),
        ts: Date.now(),
      });
    }
    return data;
  };

  const unreachableError = () => {
    const err = new Error(
      'Cannot reach the Maya backend. Start Flask on port 1000 and set the same URL as REACT_APP_API_URL / config.js.'
    );
    err.code = 'maya_unreachable';
    return err;
  };

  try {
    return await postMayaAndBumpTasks();
  } catch (error) {
    const status = error?.status;
    const msg = String(error?.message || '');
    const looksNetwork =
      !status &&
      (msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('Cannot reach') ||
        msg.includes('NETWORK_ERROR'));
    const retryable = looksNetwork || (typeof status === 'number' && status >= 500 && status < 600);
    if (retryable) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        return await postMayaAndBumpTasks();
      } catch (e2) {
        console.warn('[Maya] maya-command unreachable after retry');
        throw unreachableError();
      }
    }
    if (looksNetwork || (!status && /fetch|network|aborted/i.test(msg))) {
      throw unreachableError();
    }
    throw error;
  }
};

/** GET /api/maya/chat-history — server-backed turns for Maya (cross-browser). */
export const fetchMayaChatHistory = async () => {
  const paths = ['/maya/chat-history', '/maya/chat_history'];
  let lastStatus = 0;
  for (const p of paths) {
    const response = await fetch(`${API_URL}${p}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
    });
    lastStatus = response.status;
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      return Array.isArray(data.messages) ? data.messages : [];
    }
    if (response.status !== 404) {
      break;
    }
  }
  const err = new Error(`chat-history failed (${lastStatus})`);
  err.status = lastStatus;
  throw err;
};

/** GET /ai/property-context - properties + staff for AI Assistant (Maya) */
export const getAIPropertyContext = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/ai/property-context`, { method: 'GET', headers });
  if (!response.ok) {
    try {
      const { list } = await getProperties();
      if (Array.isArray(list) && list.length) {
        return {
          properties: list,
          staff_by_property: {},
          summary_for_ai: `Portfolio: ${list.length} properties (synced from GET /properties).`,
        };
      }
    } catch (_) {
      /* ignore */
    }
    return { properties: [], staff_by_property: {}, summary_for_ai: '' };
  }
  return await response.json();
};

/**
 * POST /staff/acknowledge — stops escalation timer for a task.
 * @param {string} taskId
 * @param {string} staffName
 */
export const acknowledgeTask = async (taskId, staffName = 'staff') => {
  try {
    const res = await fetch(`${API_URL}/staff/acknowledge`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ task_id: taskId, staff_name: staffName }),
    });
    return await res.json();
  } catch {
    return { error: 'Network error' };
  }
};

/**
 * GET /staff/reliability-scores — per-staff reliability metrics.
 * Returns { scores: [...], top_performer: {...} }
 */
export const getReliabilityScores = async () => {
  try {
    const res = await fetch(`${API_URL}/staff/reliability-scores`);
    if (!res.ok) return { scores: [], top_performer: null };
    return await res.json();
  } catch {
    return { scores: [], top_performer: null };
  }
};

/**
 * GET /tasks/version — optional compatibility (no DB query on backend).
 * Real-time updates use Socket.IO `task_updated`; avoid polling this in a tight loop.
 * Returns `{ unavailable: true }` on 404 so callers can stop retrying.
 */
export const getTasksVersion = async () => {
  try {
    const res = await fetch(`${API_URL}/tasks/version`);
    if (res.status === 404) return { unavailable: true };
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/** Direct Flask origin (no proxy) — default matches config API_BASE_URL (localhost:1000 in dev). */
const LIVE_TASKS_ORIGIN =
  typeof process !== 'undefined' && process.env && process.env.REACT_APP_LIVE_TASKS_ORIGIN
    ? String(process.env.REACT_APP_LIVE_TASKS_ORIGIN).replace(/\/$/, '')
    : API_BASE_URL;

/** GET /api/tasks — bypasses any proxy/CDN cache; direct origin + t=timestamp */
export const getPropertyTasks = async (options = {}) => {
  const unlimited = options.limit === 0 || options.unlimited === true;
  const limit = unlimited ? 0 : options.limit != null ? Number(options.limit) : undefined;
  const offset = options.offset != null ? Number(options.offset) : 0;
  const paged = !unlimited && limit != null && Number.isFinite(limit) && limit > 0;
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    // No valid token — skip the request entirely so the backend doesn't return 401.
    return paged ? { tasks: [], total: 0, hasMore: false } : [];
  }
  const bust = Date.now();
  const fetchOpts = {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    fetchOpts.signal = AbortSignal.timeout(30000);
  }
  const qs = new URLSearchParams();
  qs.set('t', String(bust));
  if (unlimited) {
    qs.set('limit', '0');
  } else if (paged) {
    qs.set('limit', String(Math.max(1, Math.min(500, Math.floor(limit)))));
    qs.set('offset', String(Math.max(0, Math.floor(offset) || 0)));
  }
  const url = `${LIVE_TASKS_ORIGIN}/api/tasks?${qs.toString()}`;
  const response = await fetch(url, fetchOpts);
  if (response.status === 204) return paged ? { tasks: [], total: 0, hasMore: false } : [];
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('easyhost-auth-required', { detail: { url, status: 401 } }));
    }
    return paged ? { tasks: [], total: 0, hasMore: false } : [];
  }
  try {
    const data = await response.json();
    let tasks = Array.isArray(data) ? data : [];
    if (!tasks.length && data && typeof data === 'object' && Array.isArray(data.tasks)) {
      tasks = data.tasks;
    }
    if (!paged) return tasks;
    const total = parseInt(response.headers.get('X-Tasks-Total') || String(tasks.length), 10) || tasks.length;
    const hasMore = response.headers.get('X-Tasks-Has-More') === '1';
    return { tasks, total, hasMore };
  } catch {
    return paged ? { tasks: [], total: 0, hasMore: false } : [];
  }
};

/** GET /api/tasks/status-counts — DB-backed totals (aligns header counts with SQL, vs filtered GET payloads). */
export const fetchTaskStatusCounts = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    return { total: 0, pending: 0, in_progress: 0, done: 0 };
  }
  const url = `${LIVE_TASKS_ORIGIN}/api/tasks/status-counts?t=${Date.now()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    return { total: 0, pending: 0, in_progress: 0, done: 0 };
  }
  const data = await response.json().catch(() => ({}));
  return {
    total: Number(data.total) || 0,
    pending: Number(data.pending) || 0,
    in_progress: Number(data.in_progress) || 0,
    done: Number(data.done) || 0,
  };
};

/** GET /api/health/bookings-tasks-sync — Maya brain / ops validation (bookings vs prep tasks). */
export const fetchBookingTasksSyncHealth = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const url = `${LIVE_TASKS_ORIGIN}/api/health/bookings-tasks-sync?t=${Date.now()}`;
  const response = await fetch(url, { method: 'GET', headers, credentials: 'include', cache: 'no-store' });
  if (!response.ok) {
    return { ok: false, aligned: false, upcoming_bookings: 0, open_tasks_non_terminal: 0 };
  }
  return response.json().catch(() => ({ ok: false, aligned: false }));
};

/** POST /tasks - create task (AI or User). Links to property_id and staff. */
export const createTask = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create task');
  }
  return await response.json();
};

/** POST /property-tasks - create task (Maya notification) */
export const createPropertyTask = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/property-tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create task');
  }
  const out = await response.json();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('maya-refresh-tasks'));
    window.dispatchEvent(new Event('properties-refresh'));
    hotelRealtime.publishLocal('task_updated', { task: out?.task || out, ts: Date.now() });
  }
  return out;
};

/** POST /complaints - submit guest complaint → creates task, assigns staff, Maya log, WhatsApp */
export const createComplaint = async (payload = {}) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const body = {
    text: (payload.text || payload.description || '').trim(),
    property_id: (payload.property_id || '').trim() || undefined,
    property_name: (payload.property_name || '').trim() || undefined,
    assigned_staff: (payload.assigned_staff || payload.worker || '').trim() || undefined,
    phone: (payload.phone || payload.staff_phone || '').trim() || undefined,
  };
  const response = await fetch(`${API_URL}/complaints`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to submit complaint');
  }
  return await response.json();
};

/** GET /complaints - list complaints (tasks with task_type=Complaint) */
export const getComplaints = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/complaints`, { method: 'GET', headers, credentials: 'include' });
  if (!response.ok) return { complaints: [] };
  const data = await response.json().catch(() => ({}));
  return { complaints: data.complaints || [] };
};

/** POST /notify/send-message - push custom message to phone via Twilio (no window.open) */
export const sendMessageToPhone = async (toPhone, message) => {
  const response = await fetch(`${API_URL}/notify/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ to_phone: toPhone, message }),
  });
  const data = await response.json().catch(() => ({}));
  return { success: data.success, error: data.error };
};

/** POST /notify/send-task - push message to phone via Twilio (no window.open) */
export const sendTaskNotification = async (task, toPhone = null) => {
  const response = await fetch(`${API_URL}/notify/send-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ task, to_phone: toPhone }),
  });
  const data = await response.json().catch(() => ({}));
  return { success: data.success, message: data.message };
};

/** POST /property-tasks-batch — one transaction for many status updates (Maya / bulk actions). */
export const updatePropertyTasksBatch = async (updates, opts = {}) => {
  const skipOptimistic = opts.skipOptimistic === true;
  const norm = (Array.isArray(updates) ? updates : [])
    .map((u) => ({
      id: String(u.taskId ?? u.id ?? '').trim(),
      status: u.status,
    }))
    .filter((u) => u.id);
  if (!norm.length) return { ok: true, updated: 0, results: [] };
  if (typeof window !== 'undefined' && !skipOptimistic) {
    const { notifyMissionTasksBatchLocalUpdate } = await import('../utils/taskSyncBridge');
    notifyMissionTasksBatchLocalUpdate(norm.map((r) => ({ taskId: r.id, status: r.status })));
  }
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/property-tasks-batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ updates: norm }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('maya-refresh-tasks'));
    }
    throw new Error(data.error || 'Batch task update failed');
  }
  (data.results || []).forEach((r) => {
    if (r?.ok && r.id) removeQueuedTaskUpdate(r.id);
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('maya-refresh-tasks'));
    window.dispatchEvent(new CustomEvent('mission-full-tasks-refresh'));
  }
  return data;
};

/** Many statuses: batch API when >1, else single PATCH (parallel fallback = Promise.all of singles). */
export const updatePropertyTaskStatusesBulk = async (updates) => {
  const list = (Array.isArray(updates) ? updates : []).filter((u) => u && (u.taskId || u.id));
  if (list.length === 0) return { ok: true, updated: 0 };
  if (list.length === 1) {
    const u = list[0];
    return updatePropertyTaskStatus(u.taskId ?? u.id, u.status);
  }
  return updatePropertyTasksBatch(list);
};

/** Flush offline-queued task PATCHes (call on `online` and after app load). */
export const flushTaskUpdateQueue = async () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { flushed: 0 };
  }
  const items = getQueuedTaskUpdates();
  if (!items.length) return { flushed: 0 };
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  if (items.length >= 2) {
    try {
      const { notifyMissionTasksBatchLocalUpdate } = await import('../utils/taskSyncBridge');
      notifyMissionTasksBatchLocalUpdate(items.map((i) => ({ taskId: i.taskId, status: i.status })));
      const response = await fetch(`${API_URL}/property-tasks-batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          updates: items.map((i) => ({ id: String(i.taskId), status: i.status })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.results)) {
        let flushed = 0;
        data.results.forEach((r) => {
          if (r?.ok && r.id) {
            removeQueuedTaskUpdate(r.id);
            flushed += 1;
          }
        });
        if (flushed && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('maya-refresh-tasks'));
        }
        return { flushed };
      }
    } catch {
      /* fall through to per-item */
    }
  }
  let flushed = 0;
  for (const item of items) {
    try {
      const response = await fetch(`${API_URL}/property-tasks/${item.taskId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: item.status }),
      });
      if (response.ok) {
        removeQueuedTaskUpdate(item.taskId);
        flushed += 1;
      }
    } catch {
      break;
    }
  }
  if (flushed && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('maya-refresh-tasks'));
  }
  return { flushed };
};

/** PATCH /property-tasks/<id> - update task status (queues to localStorage when offline). */
export const updatePropertyTaskStatus = async (taskId, status, opts = {}) => {
  const skipRefresh = opts.skipRefresh === true;
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const url = `${API_URL}/property-tasks/${taskId}`;
  const body = JSON.stringify({ status });
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update task');
    }
    const out = await response.json();
    removeQueuedTaskUpdate(taskId);
    if (typeof window !== 'undefined' && !skipRefresh) {
      window.dispatchEvent(new Event('maya-refresh-tasks'));
    }
    return { ...out, queued: false };
  } catch (e) {
    const off = typeof navigator !== 'undefined' && navigator.onLine === false;
    const net =
      off ||
      /failed to fetch|network|load failed|fetch/i.test(String(e?.message || e || ''));
    if (net) {
      enqueueTaskUpdate(taskId, status);
      if (typeof window !== 'undefined' && !skipRefresh) {
        window.dispatchEvent(new Event('maya-refresh-tasks'));
      }
      return { ok: true, queued: true, task: { id: taskId, status } };
    }
    throw e;
  }
};

/** GET /settings/automated-welcome */
export const getAutomatedWelcomeSetting = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/settings/automated-welcome`, { method: 'GET', headers });
  if (!response.ok) throw new Error('Failed to fetch setting');
  return response.json();
};

/** POST /guest-bookings - manual guest booking */
export const createGuestBooking = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/guest-bookings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...payload,
      room_number: payload.room_number,
      notify_guest: payload.notify_guest !== false,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to create guest booking');
  }
  return response.json();
};

/** POST /add-manual-guest - manual guest form; returns {success: true} for auto-close */
export const addManualGuest = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const body = {
    guest_name: payload.guest_name,
    phone: payload.guest_phone || payload.phone,
    email: payload.email || payload.guest_email,
    check_in: payload.check_in,
    check_out: payload.check_out,
    composition: payload.room_composition || payload.composition,
    property_id: payload.property_id,
    property_name: payload.property_name,
    room_number: payload.room_number,
    notify_guest: payload.notify_guest !== false,
  };
  const url = `${API_URL}/add-manual-guest`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = data.error || data.message || `שגיאת שרת (${response.status})`;
    console.error('[API] add-manual-guest failed:', response.status, response.statusText, data);
    const err = new Error(errMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
};

/** PUT /settings/automated-welcome */
export const setAutomatedWelcomeSetting = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/settings/automated-welcome`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Failed to update setting');
  return response.json();
};

/** Unwrap common API shapes: raw array or { properties | rooms | data | list | items | manual_rooms: [...] } */
function normalizePropertiesListPayload(data) {
  if (Array.isArray(data)) return data;
  if (data != null && typeof data === 'object') {
    const keys = ['properties', 'rooms', 'manual_rooms', 'data', 'list', 'items'];
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}

/** GET /properties (manual_rooms). Optional `{ limit, offset }` for server pagination. */
export const getProperties = async (opts = {}) => {
  const { initialProperties, ensurePropertyPortfolioImages } = await import('../data/initialProperties');
  console.log('[properties] API_URL', API_URL);
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    // No valid token — return the hardcoded initial portfolio so the UI is still usable,
    // but don't hit the backend and generate a 401.
    const list = ensurePropertyPortfolioImages(initialProperties.map((x) => ({ ...x })));
    return {
      list,
      dbStatus: 'unauthenticated',
      portfolioFallback: true,
      networkError: false,
      propertiesTotal: list.length,
      propertiesHasMore: false,
    };
  }
  const plimit = opts.limit != null ? Number(opts.limit) : undefined;
  const poffset = opts.offset != null ? Number(opts.offset) : 0;
  const paged = plimit != null && Number.isFinite(plimit) && plimit > 0;
  const pq = new URLSearchParams();
  pq.set('t', String(Date.now()));
  if (paged) {
    pq.set('limit', String(Math.max(1, Math.min(500, Math.floor(plimit)))));
    pq.set('offset', String(Math.max(0, Math.floor(poffset) || 0)));
  }
  let response;
  try {
    const fetchOpts = {
      method: 'GET',
      headers,
      credentials: 'include',
      cache: 'no-store',
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      fetchOpts.signal = AbortSignal.timeout(45000);
    }
    response = await fetch(`${API_URL}/properties?${pq.toString()}`, fetchOpts);
  } catch (e) {
    const slow = e?.name === 'TimeoutError' || String(e?.message || '').toLowerCase().includes('abort');
    console.warn('[properties] network error — UI may use session cache', e);
    return {
      list: [],
      dbStatus: slow ? 'cache' : 'cache',
      portfolioFallback: true,
      networkError: true,
      cacheLoading: true,
      propertiesTotal: 0,
      propertiesHasMore: false,
    };
  }
  const dbStatus = response.headers.get('X-DB-Status') || 'unknown';
  let portfolioFallback = response.headers.get('X-Portfolio-Fallback') === '1';
  if (response.status === 204) {
    console.warn('[properties] GET /properties returned 204 — emergency initialProperties');
    portfolioFallback = true;
    const list = initialProperties.map((x) => ({ ...x }));
    return {
      list,
      dbStatus,
      portfolioFallback,
      emergencyClient: true,
      propertiesTotal: list.length,
      propertiesHasMore: false,
    };
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('easyhost-auth-required', { detail: { url: `${API_URL}/properties`, status: 401 } }));
    }
    console.warn('[properties] GET /properties HTTP', response.status, '— using initialProperties (avoid 404 empty UI)');
    const list = ensurePropertyPortfolioImages(initialProperties.map((x) => ({ ...x })));
    return {
      list,
      dbStatus: response.status >= 500 ? 'error' : `http_${response.status}`,
      portfolioFallback: true,
      networkError: response.status >= 500,
      propertiesTotal: list.length,
      propertiesHasMore: false,
    };
  }
  let data;
  try {
    data = await response.json();
  } catch (_) {
    data = [];
  }
  let list = normalizePropertiesListPayload(data);
  if (!list.length) {
    console.warn('[properties] /properties empty array — emergency initialProperties');
    list = initialProperties.map((x) => ({ ...x }));
    portfolioFallback = true;
  } else {
    list = ensurePropertyPortfolioImages(list);
  }
  console.log(
    '[properties] /properties raw type:',
    Array.isArray(data) ? 'array' : typeof data,
    'normalized length:',
    list.length,
    'X-DB-Status:',
    dbStatus,
  );
  const propertiesTotal = parseInt(response.headers.get('X-Properties-Total') || String(list.length), 10) || list.length;
  const propertiesHasMore = response.headers.get('X-Properties-Has-More') === '1';
  return {
    list,
    dbStatus,
    portfolioFallback,
    networkError: false,
    propertiesTotal,
    propertiesHasMore,
  };
};

/** GET /properties/<id> — UUID or numeric room slug; 404 with { code: 'not_found' } if missing */
export const getPropertyById = async (id) => {
  const idStr = id != null && id !== '' ? String(id).trim() : '';
  if (!idStr) throw new Error('Property id required');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/properties/${encodeURIComponent(idStr)}`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || 'Property not found');
    err.status = response.status;
    err.code = data.code;
    throw err;
  }
  return data;
};

/** PUT /properties/<id> - update a property. Pass id exactly as in DB (UUID). */
export const updateProperty = async (id, payload = {}) => {
  const idStr = id != null && id !== '' ? String(id).trim() : '';
  if (!idStr) throw new Error('Property id required');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/properties/${idStr}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update property');
  }
  return await response.json();
};

/** DELETE /properties/<id> - remove a property by UUID */
export const deleteProperty = async (id) => {
  const idStr = id != null && id !== '' ? String(id).trim() : '';
  if (!idStr) throw new Error('Property id required');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/properties/${idStr}`, { method: 'DELETE', headers, credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete property');
  }
  return await response.json();
};

/** GET /properties/<id>/staff — optional role filter (e.g. cleaning) for WhatsApp targets */
export const getPropertyStaff = async (propertyId, opts = {}) => {
  const idStr = propertyId != null ? String(propertyId).trim() : '';
  if (!idStr) return [];
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const role = (opts.role || '').trim();
  const qs = role ? `?role=${encodeURIComponent(role)}` : '';
  const response = await fetch(`${API_URL}/properties/${idStr}/staff${qs}`, { method: 'GET', headers, credentials: 'include' });
  if (!response.ok) return [];
  return await response.json();
};

/** GET /guest-bookings?from=&to= — weekly planner (No-Sync manual list) */
export const listGuestBookings = async ({ from, to } = {}) => {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/guest-bookings?${qs}`, { method: 'GET', headers, credentials: 'include' });
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.bookings) ? data.bookings : [];
};

/** POST /staff - add staff (name, role, phone_number, property_id). property_id optional if only one property. */
export const addStaff = async (payload = {}) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const body = {
    name: (payload.name || '').trim(),
    role: (payload.role || 'Staff').trim(),
    phone_number: (payload.phone_number || payload.phone || '').trim() || undefined,
    property_id: (payload.property_id || '').trim() || undefined,
  };
  const response = await fetch(`${API_URL}/staff`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to add staff');
  }
  return await response.json();
};

/** POST /properties/<id>/staff - add employee (name, role, phone_number) linked to property_id */
export const addPropertyStaff = async (propertyId, { name, role = 'Staff', phone_number, department, branch_slug } = {}) => {
  const idStr = propertyId != null ? String(propertyId).trim() : '';
  if (!idStr) throw new Error('Property id required');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const body = { name: (name || '').trim(), role: (role || 'Staff').trim() };
  if (phone_number != null && String(phone_number).trim()) body.phone_number = String(phone_number).trim();
  if (department != null && String(department).trim()) body.department = String(department).trim();
  if (branch_slug != null && String(branch_slug).trim()) body.branch_slug = String(branch_slug).trim();
  const response = await fetch(`${API_URL}/properties/${idStr}/staff`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to add employee');
  }
  return await response.json();
};

/** PATCH /properties/<id>/staff/<staff_id> - update staff (name, role, phone_number) */
export const updatePropertyStaff = async (propertyId, staffId, { name, role, phone_number } = {}) => {
  const pid = propertyId != null ? String(propertyId).trim() : '';
  const sid = staffId != null ? String(staffId).trim() : '';
  if (!pid || !sid) throw new Error('Property and staff id required');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const body = {};
  if (name != null) body.name = String(name).trim();
  if (role != null) body.role = String(role).trim();
  if (phone_number != null) body.phone_number = String(phone_number).trim();
  const response = await fetch(`${API_URL}/properties/${pid}/staff/${sid}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update staff');
  }
  return await response.json();
};

/** DELETE /properties/<id>/staff/<staff_id> - remove employee from property */
/** POST /properties/<id>/staff/bulk — bulk import staff rows */
export const bulkImportPropertyStaff = async (propertyId, rows) => {
  const pid = propertyId != null ? String(propertyId).trim() : '';
  if (!pid) throw new Error('Property id required');
  if (!Array.isArray(rows) || !rows.length) throw new Error('No rows to import');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/properties/${pid}/staff/bulk`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rows }),
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Bulk import failed');
  }
  return data;
};

export const removePropertyStaff = async (propertyId, staffId) => {
  const pid = propertyId != null ? String(propertyId).trim() : '';
  const sid = staffId != null ? String(staffId).trim() : '';
  if (!pid || !sid) throw new Error('Property and staff id required');
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/properties/${pid}/staff/${sid}`, { method: 'DELETE', headers, credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to remove employee');
  }
  return await response.json();
};

export const createManualRoom = async (name) => {
  const url = `${API_URL}/rooms/manual`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ name }),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to create manual room');
  }
  return await response.json();
};

export const createManualRoomWithDescription = async (name, description, photoUrl) => {
  const url = `${API_URL}/rooms/manual`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ name, description, photo_url: photoUrl }),
  });
  if (!response.ok) {
    throw new Error('Failed to create manual room');
  }
  return await response.json();
};

/**
 * Create property - uses central apiClient (http://localhost:1000)
 * All fields have safe defaults to prevent undefined errors.
 */
export const createProperty = async (payload = {}) => {
  const images = payload.pictures || payload.images || [];
  const propertyData = {
    name: String(payload.name ?? '').trim() || 'Unnamed Property',
    description: String(payload.description ?? ''),
    price: Number(payload.price) || 0,
    photo_url: String(payload.photo_url ?? ''),
    images,
    pictures: images,
    amenities: payload.amenities || [],
    max_guests: Math.max(1, parseInt(payload.max_guests, 10) || 2),
    bedrooms: Math.max(1, parseInt(payload.bedrooms, 10) || 1),
    beds: Math.max(1, parseInt(payload.beds, 10) || 1),
    bathrooms: Math.max(1, parseInt(payload.bathrooms, 10) || 1),
  };
  console.log('[createProperty] Sending:', propertyData);
  try {
    let headers = {};
    if (!getAuthHeaders().Authorization) {
      try {
        const auth = await getDemoAuthToken('default');
        if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
      } catch (e) {
        console.warn('[createProperty] Demo auth failed:', e);
      }
    }
    const result = await apiRequest(`${API_URL}/properties`, {
      method: 'POST',
      body: propertyData,
      headers: { ...getAuthHeaders(), ...headers },
    });
    return result;
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    const data = error?.data ?? error?.response?.data;
    const serverMsg = data?.error ?? data?.message ?? (typeof data === 'string' ? data : JSON.stringify(data || {}));
    const msg = `Create Property failed: ${error?.message || 'Unknown error'}` +
      (status ? ` [HTTP ${status}]` : '') +
      (serverMsg ? ` | Server: ${serverMsg}` : '');
    console.error('[createProperty] Full error:', error);
    window.alert(msg);
    throw error;
  }
};

/** Same as createProperty but no modal alert — for mass / batch import. */
export const createPropertyQuiet = async (payload = {}) => {
  const images = payload.pictures || payload.images || [];
  const propertyData = {
    name: String(payload.name ?? '').trim() || 'Unnamed Property',
    description: String(payload.description ?? ''),
    price: Number(payload.price) || 0,
    photo_url: String(payload.photo_url ?? ''),
    images,
    pictures: images,
    amenities: payload.amenities || [],
    max_guests: Math.max(1, parseInt(payload.max_guests, 10) || 2),
    bedrooms: Math.max(1, parseInt(payload.bedrooms, 10) || 1),
    beds: Math.max(1, parseInt(payload.beds, 10) || 1),
    bathrooms: Math.max(1, parseInt(payload.bathrooms, 10) || 1),
  };
  let headers = {};
  if (!getAuthHeaders().Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
    } catch (e) {
      console.warn('[createPropertyQuiet] Demo auth failed:', e);
    }
  }
  return await apiRequest(`${API_URL}/properties`, {
    method: 'POST',
    body: propertyData,
    headers: { ...getAuthHeaders(), ...headers },
  });
};

/**
 * Generic image upload - accepts multiple files, returns array of URLs
 * @param {File|File[]} files - Single file or array of files
 * @returns {Promise<{urls: string[]}>}
 */
export const uploadImages = async (files, propertyId = null) => {
  const fileList = Array.isArray(files) ? files : [files];
  const formData = new FormData();
  fileList.forEach((f) => formData.append('files', f));
  if (propertyId) formData.append('property_id', propertyId);
  const response = await fetch(`${API_URL}/upload`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      // FormData triggers browser to set Content-Type: multipart/form-data; boundary=...
    },
    body: formData,
    credentials: 'include',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to upload images');
  }
  return await response.json();
};

export const uploadPropertyPhoto = async (file) => {
  const formData = new FormData();
  formData.append('photo', file);
  const response = await fetch(`${API_URL}/rooms/manual/photo/upload`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to upload photo');
  }
  const data = await response.json();
  return data.photo_url;
};

export const checkoutManualRoom = async (roomId) => {
  const url = `${API_URL}/rooms/manual/${roomId}/checkout`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to checkout room');
  }
  return await response.json();
};

export const checkinManualRoom = async (roomId) => {
  const url = `${API_URL}/rooms/manual/${roomId}/checkin`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to check-in room');
  }
  return await response.json();
};

export const getManualRoomHistory = async (roomId) => {
  const url = `${API_URL}/rooms/manual/${roomId}/history`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch room history');
  }
  return await response.json();
};

export const assignManualRoom = async (roomId, staffId) => {
  const url = `${API_URL}/rooms/manual/${roomId}/assign`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ staff_id: staffId }),
  });
  if (!response.ok) {
    throw new Error('Failed to assign room');
  }
  return await response.json();
};

export const resolveManualRoom = async (roomId) => {
  const url = `${API_URL}/rooms/manual/${roomId}/resolve`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to resolve room');
  }
  return await response.json();
};

export const reportIssue = async ({ roomId, roomName, taskId, note, photo }) => {
  const url = `${API_URL}/issues/report`;
  const formData = new FormData();
  formData.append('room_id', roomId);
  formData.append('room_name', roomName || '');
  if (taskId) formData.append('task_id', taskId);
  if (note) formData.append('note', note);
  formData.append('photo', photo);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
    },
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Failed to report issue');
  }
  return await response.json();
};

export const searchProperties = async (query) => {
  const url = `${API_URL}/properties/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to search properties');
  }
  return await response.json();
};

export const importManualRoomFromLink = async (url) => {
  const endpoint = `${API_URL}/rooms/manual/import`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error('Failed to import room');
  }
  return await response.json();
};

/** Import Airbnb/Booking property - creates property + initial cleaning task */
export const importProperty = async (url) => {
  const response = await fetch(`${API_URL}/v1/properties/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to import property');
  }
  return await response.json();
};

export const setWorkerLanguage = async (language) => {
  const url = `${API_URL}/worker/language`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ language }),
  });
  if (!response.ok) {
    throw new Error('Failed to set worker language');
  }
  return await response.json();
};

export const getMessages = async (limit = 50) => {
  const url = `${API_URL}/messages?limit=${limit}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch messages');
  }
  return await response.json();
};

/**
 * Field-worker login — no auth token required.
 * Sends phone (+ optional name / staff_id) to the public /field/login endpoint.
 * Falls back to the authenticated /staff/clock-in when a token is available.
 */
export const clockInStaff = async (payload) => {
  // Single public endpoint: phone/name/staff_id + optional tenant (see app.py /api/field/login).
  const url = `${API_URL}/field/login`;
  const headers = { 'Content-Type': 'application/json' };

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
    });
  } catch (e) {
    const msg = (e && e.message) || '';
    const err = new Error(
      /failed to fetch|networkerror|load failed/i.test(msg)
        ? 'Cannot reach server — is the Python backend running?'
        : (msg || 'Network error'),
    );
    err.status = 0;
    err.cause = e;
    throw err;
  }

  if (!response.ok) {
    let errMsg = `Server returned ${response.status}`;
    try {
      const body = await response.json();
      errMsg = body.error || errMsg;
    } catch (_) { /* ignore */ }
    const err    = new Error(errMsg);
    err.status   = response.status;
    throw err;
  }
  return await response.json();
};

/** Alias for field worker registration / clock-in (POST /api/field/login). */
export const registerStaff = clockInStaff;

/** Seed the "Test Agent" pilot record in the DB (call once). */
export const seedPilotAgent = async () => {
  const res = await fetch(`${API_URL}/seed-pilot-agent`, { method: 'POST' });
  return await res.json();
};

export const clockOutStaff = async (staffId) => {
  const url = `${API_URL}/staff/clock-out`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ staff_id: staffId }),
  });
  if (!response.ok) {
    throw new Error('Failed to clock out staff');
  }
  return await response.json();
};

export const getStaffList = async () => {
  const url = `${API_URL}/staff`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch staff');
  }
  return await response.json();
};

export const toggleStaffActive = async (staffId, active) => {
  const url = `${API_URL}/staff/${staffId}/active`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ active }),
  });
  if (!response.ok) {
    throw new Error('Failed to toggle staff');
  }
  return await response.json();
};

export const getLeaderboard = async () => {
  const url = `${API_URL}/staff/leaderboard`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch leaderboard');
  }
  return await response.json();
};

export const getTasks = async (staffId = null) => {
  const url = staffId
    ? `${API_URL}/staff/tasks?staff_id=${encodeURIComponent(staffId)}`
    : `${API_URL}/staff/tasks`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch tasks');
  }
  return await response.json();
};

export const getStaffTasks = getTasks;

export const updateStaffTaskStatus = async (taskId, status) => {
  const url = `${API_URL}/staff/tasks/${taskId}/status`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new Error('Failed to update task');
  }
  return await response.json();
};

export const endShiftStaff = async (staffId) => {
  const url = `${API_URL}/staff/${staffId}/end-shift`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to end shift');
  }
  return await response.json();
};

export const updateStaffPhoto = async (staffId, photoUrl) => {
  const url = `${API_URL}/staff/${staffId}/photo`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ photo_url: photoUrl }),
  });
  if (!response.ok) {
    throw new Error('Failed to update staff photo');
  }
  return await response.json();
};

export const uploadStaffPhoto = async (staffId, file) => {
  const url = `${API_URL}/staff/${staffId}/photo/upload`;
  const formData = new FormData();
  formData.append('photo', file);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      // FormData sends as multipart/form-data (browser sets Content-Type with boundary)
    },
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Failed to upload staff photo');
  }
  return await response.json();
};

export const updateStaffLocation = async (staffId, lat, lng) => {
  const url = `${API_URL}/staff/${staffId}/location`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ lat, lng }),
  });
  if (!response.ok) {
    throw new Error('Failed to update staff location');
  }
  return await response.json();
};

export const subscribeToStaff = (onUpdate, onError) => {
  const { token, tenant_id } = getAuthContext();
  const qs = new URLSearchParams();
  if (token) qs.set('token', token);
  if (tenant_id) qs.set('tenant_id', tenant_id);
  const url = `${API_URL}/stream/staff?${qs.toString()}`;
  const source = new EventSource(url);
  source.addEventListener('staff_update', (event) => {
    try {
      const data = JSON.parse(event.data);
      onUpdate?.(data);
    } catch (error) {
      // ignore parse errors
    }
  });
  source.onerror = (error) => {
    onError?.(error);
  };
  return source;
};

export const getDispatchStatus = async () => {
  const url = `${API_URL}/dispatch/status`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch dispatch status');
  }
  return await response.json();
};

export const setDispatchStatus = async (enabled, intervalSeconds) => {
  const url = `${API_URL}/dispatch/status`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ enabled, interval_seconds: intervalSeconds }),
  });
  if (!response.ok) {
    throw new Error('Failed to update dispatch status');
  }
  return await response.json();
};

/**
 * Send an AI action request
 * @param {string} type - Action type (e.g., 'checkout', 'towels', 'restaurant')
 * @param {string} room - Room identifier
 * @param {string} role - User role ('owner', 'staff', 'guest')
 * @param {string} lang - Language code
 * @returns {Promise<object>} Response with { success, intent, draft, auto_send, is_safe }
 */
export const sendAIAction = async (type, room, role, lang) => {
  try {
    const response = await fetch(`${API_URL}/ai_action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type, room, role, lang }),
    });

    if (!response.ok) {
      throw new Error('Failed to send AI action');
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending AI action:', error);
    throw error;
  }
};

/**
 * Create a new booking
 * @param {object} bookingData - { room, room_name, guest_name, customer_name, property_id, property_name, check_in, check_out, guest_phone }
 * @returns {Promise<object>}
 */
export const createBooking = async (bookingData) => {
  const url = `${API_URL}/bookings`;
  const body = {
    property_id:   bookingData.property_id,
    room:          bookingData.room || bookingData.room_name,
    property_name: bookingData.property_name || bookingData.property_title,
    property_title: bookingData.property_title || bookingData.property_name,
    guest_name:    bookingData.guest_name || bookingData.customer_name,
    guest_phone:   bookingData.guest_phone,
    check_in:      bookingData.check_in,
    check_out:     bookingData.check_out,
  };
  logRequest('POST', url, body);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(body),
      credentials: 'include',
    });

    const responseText = await response.text();
    console.log(`[API] createBooking response: status=${response.status}, body=${responseText}`);

    if (!response.ok) {
      throw new Error(`Failed to create booking: HTTP ${response.status}`);
    }

    return JSON.parse(responseText);
  } catch (error) {
    console.error('[API] Error creating booking:', error);
    throw error;
  }
};

/**
 * Get all bookings
 * @returns {Promise<Array>}
 */
export const getBookings = async () => {
  try {
    const response = await fetch(`${API_URL}/bookings`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch bookings');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching bookings:', error);
    throw error;
  }
};

/**
 * Get AI insights
 * Returns fallback message if OpenAI not configured on backend
 * @returns {Promise<object>} { insight, bookings_count }
 */
export const getAIInsights = async () => {
  try {
    const response = await fetch(`${API_URL}/ai-insights`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch AI insights');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching AI insights:', error);
    // Return fallback insight on error
    return {
      insight: i18n.t('common.readyToHelp'),
      bookings_count: 0
    };
  }
};

/**
 * Get latest booking info (for polling fallback)
 * @returns {Promise<object>} { latest_id, latest_room, latest_customer, latest_time, total_count }
 */
export const getLatestBooking = async () => {
  try {
    const response = await fetch(`${API_URL}/bookings/latest`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch latest booking');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching latest booking:', error);
    throw error;
  }
};

/**
 * Get dashboard summary (revenue, active tasks, upcoming)
 * @returns {Promise<object>}
 */
export const getDashboardSummary = async () => {
  try {
    const response = await fetch(`${API_URL}/v1/dashboard/summary`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to fetch dashboard summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return { revenue: '$0', active_tasks_count: 0, upcoming: [], status: 'Unavailable' };
  }
};

/**
 * Get stats summary (properties, tasks by status, staff workload, capacity, top staff)
 * @returns {Promise<{total_properties: number, tasks_by_status: object, staff_workload: object, total_capacity: number, top_staff: array}>}
 */
/**
 * Get 30-day revenue trend and per-property occupancy.
 * Used by RevenueCharts (AreaChart + BarChart).
 * @returns {Promise<{daily_revenue: Array, occupancy: Array, total_revenue: number}>}
 */
export const getRevenueTrend = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  try {
    const response = await fetch(`${API_URL}/bookings/revenue-trend`, { method: 'GET', headers });
    if (!response.ok) throw new Error('Failed to fetch revenue trend');
    return await response.json();
  } catch (error) {
    console.error('Error fetching revenue trend:', error);
    return { daily_revenue: [], occupancy: [], total_revenue: 0 };
  }
};

export const getStatsSummary = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  try {
    const response = await fetch(`${API_URL}/stats/summary`, { method: 'GET', headers });
    if (!response.ok) throw new Error('Failed to fetch stats summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching stats summary:', error);
    return {
      total_properties: 0,
      tasks_by_status: { Pending: 0, Done: 0 },
      total_tasks: 0,
      total_active_tasks: 0,
      legacy_tasks_table_total: 0,
      staff_workload: {},
      total_capacity: 0,
      top_staff: [],
      occupancy_pct: null,
    };
  }
};

/** GET/POST /api/ops/bootstrap-data — seed pilot + Bazaar/WeWork portfolio + hotel-ops tasks (after DB purge). */
export const bootstrapOperationalData = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const res = await fetch(`${API_URL}/ops/bootstrap-data`, {
    method: 'POST',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
};

/** POST /api/ops/simulation/refresh — random occupancy + dynamic Bazaar tasks + Maya line */
export const refreshHotelOpsSimulation = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const res = await fetch(`${API_URL}/ops/simulation/refresh`, {
    method: 'POST',
    headers,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
};

/**
 * Get financial summary (LTV, conversion rate, projected revenue)
 * @returns {Promise<{avg_ltv: string, conversion_rate: string, projected_revenue: string}>}
 */
export const getFinancialSummary = async () => {
  try {
    const response = await fetch(`${API_URL}/v1/financials/summary`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to fetch financial summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    return { avg_ltv: '$0', conversion_rate: '0%', projected_revenue: '$0' };
  }
};

/**
 * Get daily ROI report
 * @returns {Promise<object>}
 */
export const getDailyReport = async () => {
  try {
    const response = await fetch(`${API_URL}/reports/daily`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch daily report');
    }

    const data = await response.json();
    return data.report || data;
  } catch (error) {
    console.error('Error fetching daily report:', error);
    return {
      date: new Date().toISOString().split('T')[0],
      roi_metrics: {
        hours_saved: 0,
        cleanings_triggered: 0,
        leads_captured: 0
      },
      recommendations: [],
      agent_performance: [],
      savings: { automation_rate: 0 }
    };
  }
};

/**
 * Get automation stats (messages sent, last scan, objection success)
 * @returns {Promise<object>}
 */
export const getAutomationStats = async () => {
  try {
    const response = await fetch(`${API_URL}/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch automation stats');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching automation stats:', error);
    return {
      automation_stats: { automated_messages: 0, last_scan: null, leads_total: 0 },
      objection_success: {},
    };
  }
};

/**
 * Send welcome WhatsApp message for a lead
 * @param {string} leadId
 * @returns {Promise<object>}
 */
export const sendWelcomeMessage = async (leadId) => {
  try {
    const response = await fetch(`${API_URL}/whatsapp/welcome`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lead_id: leadId }),
    });

    if (!response.ok) {
      throw new Error('Failed to send welcome message');
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending welcome message:', error);
    throw error;
  }
};

// ============== Leads API ==============

/**
 * Create a new lead
 * @param {object} leadData - { name, email, phone, guests, checkin, checkout, source }
 * @returns {Promise<object>} { success, id, score }
 */
export const createLead = async (leadData) => {
  const url = `${API_URL}/leads`;
  logRequest('POST', url, leadData);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(leadData),
    });

    const responseText = await response.text();
    console.log(`[API] createLead response: status=${response.status}, body=${responseText}`);

    if (!response.ok) {
      throw new Error(`Failed to create lead: HTTP ${response.status}`);
    }

    return JSON.parse(responseText);
  } catch (error) {
    console.error('[API] Error creating lead:', error);
    throw error;
  }
};

/**
 * Get all leads
 * @param {string} status - Optional status filter ('new', 'contacted', 'qualified', 'booked', 'lost')
 * @returns {Promise<Array>}
 */
export const getLeads = async (status = null) => {
  const url = status
    ? `${API_URL}/leads?status=${status}`
    : `${API_URL}/leads`;
  logRequest('GET', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[API] getLeads failed: HTTP ${response.status}`);
      throw new Error('Failed to fetch leads');
    }

    const data = await response.json();

    // IMPORTANT: Ensure we always return an array
    if (Array.isArray(data)) {
      console.log(`[API] getLeads: received ${data.length} leads`);
      return data;
    } else if (data && typeof data === 'object') {
      // If backend returns a single object, wrap it in an array
      console.warn('[API] getLeads: received object instead of array, wrapping');
      return [data];
    } else {
      console.warn('[API] getLeads: unexpected response format, returning empty array');
      return [];
    }
  } catch (error) {
    console.error('[API] Error fetching leads:', error);
    // Return empty array on error instead of throwing
    return [];
  }
};

/**
 * Get a single lead by ID
 * @param {number} leadId - Lead ID
 * @returns {Promise<object>}
 */
export const getLead = async (leadId) => {
  try {
    const response = await fetch(`${API_URL}/leads/${leadId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch lead');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching lead:', error);
    throw error;
  }
};

/**
 * Get leads statistics
 * @returns {Promise<object>} { total, new, contacted, qualified, won, lost, avg_score }
 */
export const getLeadsStats = async () => {
  try {
    const response = await fetch(`${API_URL}/leads/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch leads stats');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching leads stats:', error);
    // Return default stats on error
    return {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      won: 0,
      lost: 0,
      avg_score: 0
    };
  }
};

/**
 * Update lead status, score, or notes
 * @param {number} leadId - Lead ID
 * @param {object} data - { status, score, notes }
 * @returns {Promise<object>}
 */
export const updateLead = async (leadId, data) => {
  try {
    const response = await fetch(`${API_URL}/leads/${leadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to update lead');
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating lead:', error);
    throw error;
  }
};

/**
 * Update room status or details
 * @param {number} roomId
 * @param {object} data
 * @returns {Promise<object>}
 */
export const updateRoomStatus = async (roomId, data) => {
  try {
    const response = await fetch(`${API_URL}/rooms/${roomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to update room');
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating room:', error);
    throw error;
  }
};

/**
 * Subscribe to leads SSE stream
 * @param {function} onNewLead - Callback for new lead events
 * @param {function} onLeadUpdated - Callback for lead updated events
 * @param {function} onError - Callback for errors
 * @returns {EventSource} - The event source (call .close() to disconnect)
 */
export const subscribeToLeads = (onNewLead, onLeadUpdated, onError, onAutomationStats) => {
  const { token, tenantId } = getAuthContext();
  const query = new URLSearchParams();
  if (token) query.set('token', token);
  if (tenantId) query.set('tenant_id', tenantId);
  const url = `${API_URL}/stream/leads?${query.toString()}`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener('new_lead', (event) => {
    try {
      const lead = JSON.parse(event.data);
      onNewLead(lead);
    } catch (e) {
      console.error('Error parsing lead event:', e);
    }
  });

  eventSource.addEventListener('lead_updated', (event) => {
    try {
      const lead = JSON.parse(event.data);
      if (onLeadUpdated) onLeadUpdated(lead);
    } catch (e) {
      console.error('Error parsing lead_updated event:', e);
    }
  });

  eventSource.addEventListener('automation_stats', (event) => {
    try {
      const stats = JSON.parse(event.data);
      if (onAutomationStats) onAutomationStats(stats);
    } catch (e) {
      console.error('Error parsing automation_stats event:', e);
    }
  });

  eventSource.addEventListener('connected', (event) => {
    console.log('Connected to leads stream:', event.data);
  });

  eventSource.onerror = (error) => {
    console.error('Leads SSE error:', error);
    if (onError) onError(error);
  };

  return eventSource;
};

// ============== AI Marketing Agent API ==============

/**
 * Get AI Agent profile and capabilities
 */
export const getAgentProfile = async () => {
  const url = `${API_URL}/agent/profile`;
  logRequest('GET', url);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch agent profile');
    return await response.json();
  } catch (error) {
    console.error('[API] Error fetching agent profile:', error);
    return {
      success: true,
      agent: {
        name: "Maya",
        title: "AI Marketing & Sales Agent",
        avatar: "https://api.dicebear.com/7.x/personas/svg?seed=Maya&backgroundColor=667eea"
      },
      capabilities: ["Marketing", "Lead Generation", "Sales"]
    };
  }
};

/**
 * Generate a marketing post
 */
export const generateMarketingPost = async (params) => {
  const url = `${API_URL}/agent/generate-post`;
  logRequest('POST', url, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error('Failed to generate post');
  return await response.json();
};

/**
 * Search for property owner leads
 */
export const searchPropertyLeads = async (params) => {
  const url = `${API_URL}/agent/search-leads`;
  logRequest('POST', url, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error('Failed to search leads');
  return await response.json();
};

/**
 * Draft outreach email to property owner
 */
export const draftOutreachEmail = async (params) => {
  const url = `${API_URL}/agent/draft-email`;
  logRequest('POST', url, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error('Failed to draft email');
  return await response.json();
};

/**
 * Generate client acquisition strategy
 */
export const generateAcquisitionStrategy = async (params) => {
  const url = `${API_URL}/agent/acquisition-strategy`;
  logRequest('POST', url, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error('Failed to generate strategy');
  return await response.json();
};

/**
 * Simulate publishing a post
 */
export const publishPost = async (params) => {
  const url = `${API_URL}/agent/publish`;
  logRequest('POST', url, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error('Failed to publish');
  return await response.json();
};

/**
 * Simulate sending an email
 */
export const sendOutreachEmail = async (params) => {
  const url = `${API_URL}/agent/send-email`;
  logRequest('POST', url, params);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!response.ok) throw new Error('Failed to send email');
  return await response.json();
};

const api = {
  getHealth,
  getDemoAuthToken,
  getPilotAccessToken,
  getDashboardSummary,
  getStatsSummary,
  connectCalendar,
  getCalendarStatus,
  createManualCheckout,
  getManualRooms,
  getProperties,
  getPropertyById,
  updateProperty,
  deleteProperty,
  getPropertyStaff,
  addStaff,
  addPropertyStaff,
  bulkImportPropertyStaff,
  updatePropertyStaff,
  removePropertyStaff,
  getPropertyTasks,
  fetchTaskStatusCounts,
  createTask,
  createPropertyTask,
  updatePropertyTaskStatus,
  updatePropertyTasksBatch,
  updatePropertyTaskStatusesBulk,
  flushTaskUpdateQueue,
  syncIcalPrepTasks,
  fetchDailyPropertyTasksReport,
  createComplaint,
  getComplaints,
  createManualRoom,
  createManualRoomWithDescription,
  createProperty,
  createPropertyQuiet,
  checkoutManualRoom,
  checkinManualRoom,
  getManualRoomHistory,
  assignManualRoom,
  searchProperties,
  resolveManualRoom,
  reportIssue,
  importManualRoomFromLink,
  importProperty,
  setWorkerLanguage,
  getMessages,
  clockInStaff,
  registerStaff,
  seedPilotAgent,
  clockOutStaff,
  getStaffList,
  toggleStaffActive,
  getLeaderboard,
  getStaffTasks,
  updateStaffTaskStatus,
  endShiftStaff,
  updateStaffPhoto,
  uploadStaffPhoto,
  updateStaffLocation,
  subscribeToStaff,
  getDispatchStatus,
  setDispatchStatus,
  sendAIAction,
  createBooking,
  getBookings,
  getAIInsights,
  getLatestBooking,
  getDailyReport,
  getAutomationStats,
  createLead,
  getLeads,
  getLead,
  getLeadsStats,
  updateLead,
  updateRoomStatus,
  subscribeToLeads,
  getAgentProfile,
  generateMarketingPost,
  searchPropertyLeads,
  draftOutreachEmail,
  generateAcquisitionStrategy,
  publishPost,
  sendOutreachEmail,
};

export default api;
