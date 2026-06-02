/**
 * Facade over hotelRealtime (in-window events only; no Socket.IO transport).
 */
import hotelRealtime from './hotelRealtime';

class WebSocketService {
  constructor() {
    this.isConnected = false;
  }

  connect(url) {
    hotelRealtime.connect(url);
    this.isConnected = hotelRealtime.connected;
    return Promise.resolve(true);
  }

  disconnect() {
    hotelRealtime.disconnect();
    this.isConnected = false;
  }

  on(eventType, callback) {
    return hotelRealtime.subscribe(eventType, callback);
  }

  off() {}

  emit(eventType, data) {
    hotelRealtime.send(eventType, data);
  }

  trigger(eventType, data) {
    hotelRealtime.publishLocal(eventType, data);
  }
}

export const wsService = new WebSocketService();
export default wsService;
