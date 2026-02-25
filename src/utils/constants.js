// API URL - single source of truth (uses host for cross-device access)
import { API_URL, API_BASE_URL } from './apiClient';
export { API_URL, API_BASE_URL };

// SSE Stream URLs
export const SSE_STREAM_URL = `${API_URL}/api/stream/bookings`;
export const SSE_LEADS_URL = `${API_URL}/api/stream/leads`;

// Frontend URLs
// AI Assistant External URL - Opens in new tab
export const AI_ASSISTANT_URL = 'https://voluble-beignet-896a35.netlify.app/';

// WebSocket URL
export const WS_URL = process.env.REACT_APP_WS_URL || 'ws://127.0.0.1:5000/ws';

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

export default {
  API_URL,
  API_BASE_URL,
  SSE_STREAM_URL,
  SSE_LEADS_URL,
  AI_ASSISTANT_URL,
  ROLES,
  LANGUAGES,
  SERVICES,
  POLL_INTERVAL,
  SSE_RECONNECT_DELAY,
};
