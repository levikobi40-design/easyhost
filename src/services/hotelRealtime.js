/**
 * Real-time: Socket.IO → Flask via CRA proxy (/socket.io) + in-window pub/sub fallback.
 */
import { io } from 'socket.io-client';
import { SOCKET_IO_URL, API_BASE_URL } from '../config.js';

const _local = new Map();
function _addLocal(event, cb) {
  if (!_local.has(event)) _local.set(event, new Set());
  _local.get(event).add(cb);
}
function _removeLocal(event, cb) {
  _local.get(event)?.delete(cb);
}
function _emitLocal(event, payload) {
  _local.get(event)?.forEach((cb) => {
    try {
      cb(payload);
    } catch (_) {}
  });
}

let _socket = null;
let _heartbeatTimer = null;
let _reconnectExhausted = false;
let _connectStarted = false;

function shouldUseSocket() {
  if (typeof window === 'undefined') return false;
  const port = String(window.location.port || '');
  // Dev HMR belongs on :3000; never open Socket.IO (or /ws probes) against Flask :1000.
  if (process.env.NODE_ENV === 'development' && port === '1000') return false;
  return true;
}

function resolveSocketUrl() {
  if (typeof window === 'undefined') return '';
  if (!shouldUseSocket()) return '';
  if (!API_BASE_URL) return window.location.origin.replace(/\/+$/, '');
  if (SOCKET_IO_URL) return SOCKET_IO_URL.replace(/\/+$/, '');
  return API_BASE_URL.replace(/\/+$/, '');
}

function _startClientPulse() {
  if (typeof window === 'undefined' || _heartbeatTimer) return;
  _heartbeatTimer = setInterval(() => {
    _emitLocal('heartbeat', { t: Date.now(), source: 'client' });
    try {
      if (_socket?.connected) _socket.emit('ping', { t: Date.now() });
    } catch (_) {}
  }, 20000);
}

function _attachSocketHandlers(socket, socketUrl) {
  socket.on('connect', () => {
    _reconnectExhausted = false;
    console.log('[EasyHost] Socket.IO connected →', socketUrl, socket.id);
  });
  socket.on('disconnect', (reason) => {
    console.log('[EasyHost] Socket.IO disconnect', reason);
  });
  socket.on('connect_error', (err) => {
    console.warn('[EasyHost] Socket.IO connect_error', err?.message || err, 'url=', socketUrl);
  });
  socket.io.on('reconnect_failed', () => {
    _reconnectExhausted = true;
    console.warn('[EasyHost] Socket.IO reconnect attempts exhausted — stopping retries');
    try {
      socket.disconnect();
    } catch (_) {}
  });
  const forward = (ev) => (payload) => {
    _emitLocal(ev, payload);
    if (ev === 'task_updated') {
      try {
        window.dispatchEvent(new CustomEvent('maya-refresh-tasks', { detail: payload }));
      } catch (_) {}
    }
  };
  [
    'task_updated',
    'complaint_created',
    'property_updated',
    'new_guest',
    'shift_notice',
    'bikta_matrix_update',
    'bikta_reminder',
  ].forEach((ev) => {
    socket.on(ev, forward(ev));
  });
}

function getSocket() {
  if (typeof window === 'undefined') return null;
  if (!shouldUseSocket()) return null;
  if (_reconnectExhausted) return _socket;
  if (_socket) return _socket;

  const socketUrl = resolveSocketUrl();
  if (!socketUrl) return null;

  try {
    _socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 5000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 20000,
      withCredentials: true,
      autoConnect: true,
    });
    _attachSocketHandlers(_socket, socketUrl);
  } catch (e) {
    console.warn('[EasyHost] Socket.IO client init failed', e);
    _socket = null;
  }
  return _socket;
}

const hotelRealtime = {
  connect: () => {
    if (!shouldUseSocket() || _reconnectExhausted || _connectStarted) return;
    _connectStarted = true;
    getSocket();
  },

  disconnect: () => {
    _connectStarted = false;
    try {
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;
    _reconnectExhausted = false;
  },

  on: (event, cb) => {
    _addLocal(event, cb);
  },

  off: (event, cb) => {
    if (cb) _removeLocal(event, cb);
    else _local.delete(event);
  },

  subscribe(event, cb) {
    _addLocal(event, cb);
    _startClientPulse();
    if (!_reconnectExhausted && shouldUseSocket()) getSocket();
    return () => {
      _removeLocal(event, cb);
    };
  },

  publishLocal(event, payload) {
    _emitLocal(event, payload);
  },

  send() {},

  get connected() {
    return Boolean(_socket?.connected);
  },

  get socketUrl() {
    return resolveSocketUrl();
  },
};

export default hotelRealtime;
