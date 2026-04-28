/**
 * Central bus for Maya / AI — all server + local maya_event payloads go here.
 */
import hotelRealtime from './hotelRealtime';

export const MayaEventType = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_DELAYED: 'TASK_DELAYED',
  GUEST_CREATED: 'GUEST_CREATED',
};

export function subscribeMaya(handler) {
  return hotelRealtime.subscribe('maya_event', (data) => {
    try {
      handler(data);
    } catch (_) {}
  });
}

export function publishMayaLocal(type, payload) {
  hotelRealtime.publishLocal('maya_event', { type, payload: payload || {} });
}
