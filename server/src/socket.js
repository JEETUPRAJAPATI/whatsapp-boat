'use strict';

const { Server } = require('socket.io');
const wa = require('./services/whatsapp');

/**
 * Fans WhatsApp service events out to every connected browser.
 * The service is a singleton, so listeners are attached once at startup and the
 * io instance broadcasts - no per-socket subscription bookkeeping needed.
 */
function attachSocket(httpServer, origin) {
  const io = new Server(httpServer, {
    cors: { origin, methods: ['GET', 'POST'], credentials: true },
    maxHttpBufferSize: 1e7,
  });

  io.on('connection', (socket) => {
    console.log('[io] client connected', socket.id);
    // Immediately hand the new tab the current state so it can render.
    socket.emit('wa:state', wa.status());

    socket.on('wa:typing', async ({ chatId, mode }) => {
      try {
        await wa.setTyping(chatId, mode);
      } catch {
        /* typing state is best-effort */
      }
    });

    socket.on('wa:seen', async ({ chatId }) => {
      try {
        await wa.sendSeen(chatId);
      } catch {}
    });

    socket.on('disconnect', () => console.log('[io] client disconnected', socket.id));
  });

  const forward = (waEvent, ioEvent) =>
    wa.on(waEvent, (payload) => io.emit(ioEvent, payload));

  forward('state', 'wa:state');
  forward('qr', 'wa:qr');
  forward('ready', 'wa:ready');
  forward('loading', 'wa:loading');
  forward('disconnected', 'wa:disconnected');
  forward('message', 'wa:message');
  forward('ack', 'wa:ack');
  forward('revoke', 'wa:revoke');
  forward('reaction', 'wa:reaction');
  forward('edit', 'wa:edit');
  forward('chat_update', 'wa:chat_update');
  forward('chat_removed', 'wa:chat_removed');
  forward('group_event', 'wa:group_event');
  forward('synced', 'wa:synced');
  forward('connection_state', 'wa:connection_state');

  return io;
}

module.exports = { attachSocket };
