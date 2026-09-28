import { io } from 'socket.io-client';

let socket = null;

/**
 * One shared Socket.IO connection for the inbox.
 *
 * Kept as a module singleton rather than per-component: React 18 StrictMode
 * mounts effects twice in development, and a per-component socket would
 * connect, disconnect and reconnect on every mount.
 */
export function getSocket() {
  if (socket) return socket;

  socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

export function closeSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
