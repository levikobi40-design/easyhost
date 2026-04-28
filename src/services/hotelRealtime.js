/**
 * Real-time hooks: Socket.IO to Flask (same origin as API_URL) + in-window pub/sub fallback.
 * Connects to Flask origin :1000 with path /socket.io (not raw ws:// — Engine.IO handles upgrade).
 */
import { io } from 'socket.io-client';
import { SOCKET_IO_URL } from '../utils/apiClient';

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

function _startClientPulse() {
  if (typeof window === 'undefined' || _heartbeatTimer) return;
  _heartbeatTimer = setInterval(() => {
    _emitLocal('heartbeat', { t: Date.now(), source: 'client' });
    try {
      if (_socket?.connected) _socket.emit('ping', { t: Date.now() });
    } catch (_) {}
  }, 20000);
}

function getSocket() {
  if (typeof window === 'undefined') return null;
  if (_socket?.connected) return _socket;
  if (_socket) return _socket;
  try {
    _socket = io(SOCKET_IO_URL, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 8,
      reconnectionDelay: 1500,
      timeout: 20000,
    });
    _socket.on('connect', () => {
      console.log('[EasyHost] Socket.IO connected', _socket.id);
    });
    _socket.on('disconnect', (reason) => {
      console.log('[EasyHost] Socket.IO disconnect', reason);
    });
    _socket.on('connect_error', (err) => {
      console.warn('[EasyHost] Socket.IO connect_error', err?.message || err);
    });
    // Forward server broadcasts to local subscribers (Mission Board, etc.)
    const forward = (ev) => (payload) => {
      _emitLocal(ev, payload);
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
      _socket.on(ev, forward(ev));
    });
  } catch (e) {
    console.warn('[EasyHost] Socket.IO client init failed', e);
    _socket = null;
  }
  return _socket;
}

const hotelRealtime = {
  connect: () => {
    getSocket();
  },

  disconnect: () => {
    try {
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;
  },

  on: (event, cb) => {
    _addLocal(event, cb);
  },

  off: (event) => {
    _local.delete(event);
  },

  subscribe(event, cb) {
    _addLocal(event, cb);
    _startClientPulse();
    getSocket();
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
};

export default hotelRealtime;
