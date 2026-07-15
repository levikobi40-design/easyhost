// API URL — live resolver from config.js (same-origin in production; :1000 local only).
import { API_URL, API_BASE_URL, BASE_URL, getAPIUrl, getAPIBaseUrl } from './apiClient';
export { API_URL, API_BASE_URL, BASE_URL, getAPIUrl, getAPIBaseUrl };

export const FORCED_BACKEND_URL = API_URL;

// SSE Stream URLs — resolved at access time via live API_URL proxy
export const SSE_STREAM_URL = {
  toString() { return `${getAPIUrl()}/stream/bookings`; },
  valueOf() { return `${getAPIUrl()}/stream/bookings`; },
  [Symbol.toPrimitive]() { return `${getAPIUrl()}/stream/bookings`; },
};
export const SSE_LEADS_URL = {
  toString() { return `${getAPIUrl()}/stream/leads`; },
  valueOf() { return `${getAPIUrl()}/stream/leads`; },
  [Symbol.toPrimitive]() { return `${getAPIUrl()}/stream/leads`; },
};

// Frontend URLs
// AI Assistant External URL - Opens in new tab
export const AI_ASSISTANT_URL = 'https://voluble-beignet-896a35.netlify.app/';

// Legacy: native ws:// URLs are unused — real-time uses Socket.IO (see services/socket.js).
export const WS_URL = process.env.REACT_APP_WS_URL || '';

// Feature flags
export const FEATURES = {
  REAL_TIME_NOTIFICATIONS: true,
  MAYA_CHAT: true,
  MULTI_AGENT: true,
  CRM: true,
  WHATSAPP_INTEGRATION: true,
};

export const ROLES = {
  OWNER: 'owner',
  STAFF: 'staff',
  GUEST: 'guest',
};

export const LANGUAGES = {
  HEBREW: 'he',
  ENGLISH: 'en',
  GREEK: 'el',
};

// Service modules
export const SERVICES = {
  ROOM_SERVICE: 'room_service',
  HOUSEKEEPING: 'housekeeping',
  CHECKOUT: 'checkout',
  CONCIERGE: 'concierge',
};

// Polling fallback interval (ms)
export const POLL_INTERVAL = 5000;

// SSE reconnect delay (ms)
export const SSE_RECONNECT_DELAY = 3000;

const CONSTANTS = {
  get API_URL() { return getAPIUrl(); },
  get API_BASE_URL() { return getAPIBaseUrl(); },
  get SSE_STREAM_URL() { return `${getAPIUrl()}/stream/bookings`; },
  get SSE_LEADS_URL() { return `${getAPIUrl()}/stream/leads`; },
  AI_ASSISTANT_URL,
  ROLES,
  LANGUAGES,
  SERVICES,
  FEATURES,
  POLL_INTERVAL,
  SSE_RECONNECT_DELAY,
};

export default CONSTANTS;
