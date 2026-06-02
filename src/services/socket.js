/**
 * Stub — Socket.IO client removed. Nothing here opens /socket.io (avoids Engine.IO 400s).
 */
const noop = () => {};
const socket = {
  connected: false,
  connect: noop,
  disconnect: noop,
  on: noop,
  emit: noop,
};
export default socket;
