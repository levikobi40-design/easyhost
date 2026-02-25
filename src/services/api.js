import i18n from '../i18n';
import { API_URL, getAPIUrl, apiRequest } from '../utils/apiClient';

const getBase = () => (typeof window !== 'undefined' ? getAPIUrl() : API_URL);

console.log('[Easy Host AI API] Using backend URL:', API_URL);

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

/** GET /api/local-ip - machine's LAN IP for QR code (mobile access) */
export const getLocalAppUrl = async () => {
  try {
    const response = await fetch(`${getBase()}/api/local-ip`);
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

export const loginAuth = async (email, password) => {
  const url = `${API_URL}/api/auth/login`;
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
  const url = `${API_URL}/api/auth/register`;
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
  const url = `${API_URL}/api/auth/demo`;
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
  const url = `${API_URL}/api/auth/pilot`;
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

export const connectCalendar = async (icalUrl, nightlyRate) => {
  const url = `${API_URL}/api/onboarding/ical`;
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
  const url = `${API_URL}/api/onboarding/status`;
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
  const url = `${API_URL}/api/onboarding/ical/refresh`;
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
  const url = `${API_URL}/api/onboarding/manual-checkout`;
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
  const url = `${API_URL}/api/rooms/manual`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch manual rooms');
  }
  return await response.json();
};

/** POST /api/ai/maya-command - send command to Gemini. Uses minimal headers to avoid 401. */
export const sendMayaCommand = async (command, tasksForAnalysis = null, history = null) => {
  const auth = getAuthHeaders();
  const headers = { 'Content-Type': 'application/json' };
  if (auth.Authorization) headers.Authorization = auth.Authorization;
  else if (auth['X-Tenant-Id']) headers['X-Tenant-Id'] = auth['X-Tenant-Id'];
  const payload = { command };
  if (tasksForAnalysis && Array.isArray(tasksForAnalysis)) payload.tasksForAnalysis = tasksForAnalysis;
  if (history && Array.isArray(history)) payload.history = history.slice(-6);
  const response = await fetch(`${API_URL}/api/ai/maya-command`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = data.displayMessage || data.error || data.message || `Request failed (${response.status})`;
    const err = new Error(errMsg);
    err.data = data;
    err.status = response.status;
    throw err;
  }
  return data;
};

/** GET /api/ai/property-context - properties + staff for AI Assistant (Maya) */
export const getAIPropertyContext = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/ai/property-context`, { method: 'GET', headers });
  if (!response.ok) return { properties: [], staff_by_property: {}, summary_for_ai: '' };
  return await response.json();
};

/** GET /api/property-tasks - list all Maya-created tasks */
export const getPropertyTasks = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/property-tasks`, { method: 'GET', headers });
  if (!response.ok) return [];
  try {
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

/** POST /api/tasks - create task (AI or User). Links to property_id and staff. */
export const createTask = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/tasks`, {
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

/** POST /api/property-tasks - create task (Maya notification) */
export const createPropertyTask = async (payload) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/property-tasks`, {
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

/** POST /api/notify/send-message - push custom message to phone via Twilio (no window.open) */
export const sendMessageToPhone = async (toPhone, message) => {
  const response = await fetch(`${API_URL}/api/notify/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ to_phone: toPhone, message }),
  });
  const data = await response.json().catch(() => ({}));
  return { success: data.success, error: data.error };
};

/** POST /api/notify/send-task - push message to phone via Twilio (no window.open) */
export const sendTaskNotification = async (task, toPhone = null) => {
  const response = await fetch(`${API_URL}/api/notify/send-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ task, to_phone: toPhone }),
  });
  const data = await response.json().catch(() => ({}));
  return { success: data.success, message: data.message };
};

/** PATCH /api/property-tasks/<id> - update task status */
export const updatePropertyTaskStatus = async (taskId, status) => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/property-tasks/${taskId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update task');
  }
  return await response.json();
};

/** Fetch all properties from GET /api/properties (manual_rooms table) */
export const getProperties = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/properties`, { method: 'GET', headers });
  if (!response.ok) throw new Error('Failed to fetch properties');
  return await response.json();
};

/** PUT /api/properties/<id> - update a property. Pass id exactly as in DB (UUID). */
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
  const response = await fetch(`${API_URL}/api/properties/${idStr}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update property');
  }
  return await response.json();
};

/** DELETE /api/properties/<id> - remove a property by UUID */
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
  const response = await fetch(`${API_URL}/api/properties/${idStr}`, { method: 'DELETE', headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete property');
  }
  return await response.json();
};

/** GET /api/properties/<id>/staff - list employees for property */
export const getPropertyStaff = async (propertyId) => {
  const idStr = propertyId != null ? String(propertyId).trim() : '';
  if (!idStr) return [];
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  const response = await fetch(`${API_URL}/api/properties/${idStr}/staff`, { method: 'GET', headers });
  if (!response.ok) return [];
  return await response.json();
};

/** POST /api/properties/<id>/staff - add employee (name, role, phone_number) linked to property_id */
export const addPropertyStaff = async (propertyId, { name, role = 'Staff', phone_number } = {}) => {
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
  const response = await fetch(`${API_URL}/api/properties/${idStr}/staff`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to add employee');
  }
  return await response.json();
};

/** PATCH /api/properties/<id>/staff/<staff_id> - update staff (name, role, phone_number) */
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
  const response = await fetch(`${API_URL}/api/properties/${pid}/staff/${sid}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update staff');
  }
  return await response.json();
};

/** DELETE /api/properties/<id>/staff/<staff_id> - remove employee from property */
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
  const response = await fetch(`${API_URL}/api/properties/${pid}/staff/${sid}`, { method: 'DELETE', headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to remove employee');
  }
  return await response.json();
};

export const createManualRoom = async (name) => {
  const url = `${API_URL}/api/rooms/manual`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error('Failed to create manual room');
  }
  return await response.json();
};

export const createManualRoomWithDescription = async (name, description, photoUrl) => {
  const url = `${API_URL}/api/rooms/manual`;
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
 * Create property - uses central apiClient (http://127.0.0.1:5000)
 * All fields have safe defaults to prevent undefined errors.
 */
export const createProperty = async (payload = {}) => {
  const propertyData = {
    name: String(payload.name ?? '').trim() || 'Unnamed Property',
    description: String(payload.description ?? ''),
    price: Number(payload.price) || 0,
    photo_url: String(payload.photo_url ?? ''),
    images: payload.images || [],
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
    const result = await apiRequest('/api/properties', {
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

/**
 * Generic image upload - accepts multiple files, returns array of URLs
 * @param {File|File[]} files - Single file or array of files
 * @returns {Promise<{urls: string[]}>}
 */
export const uploadImages = async (files) => {
  const fileList = Array.isArray(files) ? files : [files];
  const formData = new FormData();
  fileList.forEach((f) => formData.append('files', f));
  const response = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      // FormData triggers browser to set Content-Type: multipart/form-data; boundary=...
    },
    body: formData,
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
  const response = await fetch(`${API_URL}/api/rooms/manual/photo/upload`, {
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
  const url = `${API_URL}/api/rooms/manual/${roomId}/checkout`;
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
  const url = `${API_URL}/api/rooms/manual/${roomId}/checkin`;
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
  const url = `${API_URL}/api/rooms/manual/${roomId}/history`;
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
  const url = `${API_URL}/api/rooms/manual/${roomId}/assign`;
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
  const url = `${API_URL}/api/rooms/manual/${roomId}/resolve`;
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
  const url = `${API_URL}/api/issues/report`;
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
  const url = `${API_URL}/api/properties/search?q=${encodeURIComponent(query)}`;
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
  const endpoint = `${API_URL}/api/rooms/manual/import`;
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
  const response = await fetch(`${API_URL}/api/v1/properties/import`, {
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
  const url = `${API_URL}/api/worker/language`;
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
  const url = `${API_URL}/api/messages?limit=${limit}`;
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

export const clockInStaff = async (payload) => {
  const url = `${API_URL}/api/staff/clock-in`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error('Failed to clock in staff');
  }
  return await response.json();
};

export const clockOutStaff = async (staffId) => {
  const url = `${API_URL}/api/staff/clock-out`;
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
  const url = `${API_URL}/api/staff`;
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
  const url = `${API_URL}/api/staff/${staffId}/active`;
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
  const url = `${API_URL}/api/staff/leaderboard`;
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
    ? `${API_URL}/api/staff/tasks?staff_id=${encodeURIComponent(staffId)}`
    : `${API_URL}/api/staff/tasks`;
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
  const url = `${API_URL}/api/staff/tasks/${taskId}/status`;
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
  const url = `${API_URL}/api/staff/${staffId}/end-shift`;
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
  const url = `${API_URL}/api/staff/${staffId}/photo`;
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
  const url = `${API_URL}/api/staff/${staffId}/photo/upload`;
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
  const url = `${API_URL}/api/staff/${staffId}/location`;
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
  const url = `${API_URL}/api/stream/staff?${qs.toString()}`;
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
  const url = `${API_URL}/api/dispatch/status`;
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
  const url = `${API_URL}/api/dispatch/status`;
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
 * @param {object} bookingData - Booking data { room_name, customer_name }
 * @returns {Promise<object>}
 */
export const createBooking = async (bookingData) => {
  const url = `${API_URL}/api/book`;
  logRequest('POST', url, bookingData);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bookingData),
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
    const response = await fetch(`${API_URL}/api/bookings`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
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
    const response = await fetch(`${API_URL}/api/ai-insights`, {
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
    const response = await fetch(`${API_URL}/api/bookings/latest`, {
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
    const response = await fetch(`${API_URL}/api/v1/dashboard/summary`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to fetch dashboard summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return { revenue: '0₪', active_tasks_count: 0, upcoming: [], status: 'Unavailable' };
  }
};

/**
 * Get stats summary (properties, tasks by status, staff workload, capacity, top staff)
 * @returns {Promise<{total_properties: number, tasks_by_status: object, staff_workload: object, total_capacity: number, top_staff: array}>}
 */
export const getStatsSummary = async () => {
  let headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  if (!headers.Authorization) {
    try {
      const auth = await getDemoAuthToken('default');
      if (auth?.token) headers = { ...headers, Authorization: `Bearer ${auth.token}` };
    } catch (_) {}
  }
  try {
    const response = await fetch(`${API_URL}/api/stats/summary`, { method: 'GET', headers });
    if (!response.ok) throw new Error('Failed to fetch stats summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching stats summary:', error);
    return {
      total_properties: 0,
      tasks_by_status: { Pending: 0, Done: 0 },
      staff_workload: {},
      total_capacity: 0,
      top_staff: [],
    };
  }
};

/**
 * Get financial summary (LTV, conversion rate, projected revenue)
 * @returns {Promise<{avg_ltv: string, conversion_rate: string, projected_revenue: string}>}
 */
export const getFinancialSummary = async () => {
  try {
    const response = await fetch(`${API_URL}/api/v1/financials/summary`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to fetch financial summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    return { avg_ltv: '₪0', conversion_rate: '0%', projected_revenue: '₪0' };
  }
};

/**
 * Get daily ROI report
 * @returns {Promise<object>}
 */
export const getDailyReport = async () => {
  try {
    const response = await fetch(`${API_URL}/api/reports/daily`, {
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
    const response = await fetch(`${API_URL}/api/stats`, {
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
    const response = await fetch(`${API_URL}/api/whatsapp/welcome`, {
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
  const url = `${API_URL}/api/leads`;
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
    ? `${API_URL}/api/leads?status=${status}`
    : `${API_URL}/api/leads`;
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
    const response = await fetch(`${API_URL}/api/leads/${leadId}`, {
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
    const response = await fetch(`${API_URL}/api/leads/stats`, {
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
    const response = await fetch(`${API_URL}/api/leads/${leadId}`, {
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
    const response = await fetch(`${API_URL}/api/rooms/${roomId}`, {
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
  const url = `${API_URL}/api/stream/leads?${query.toString()}`;
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
  const url = `${API_URL}/api/agent/profile`;
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
  const url = `${API_URL}/api/agent/generate-post`;
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
  const url = `${API_URL}/api/agent/search-leads`;
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
  const url = `${API_URL}/api/agent/draft-email`;
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
  const url = `${API_URL}/api/agent/acquisition-strategy`;
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
  const url = `${API_URL}/api/agent/publish`;
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
  const url = `${API_URL}/api/agent/send-email`;
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
  connectCalendar,
  getCalendarStatus,
  createManualCheckout,
  getManualRooms,
  getProperties,
  updateProperty,
  deleteProperty,
  getPropertyStaff,
  addPropertyStaff,
  updatePropertyStaff,
  removePropertyStaff,
  getPropertyTasks,
  createTask,
  createPropertyTask,
  updatePropertyTaskStatus,
  createManualRoom,
  createManualRoomWithDescription,
  createProperty,
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
