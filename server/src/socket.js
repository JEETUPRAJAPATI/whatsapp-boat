'use strict';

const { Server } = require('socket.io');
const sessions = require('./services/sessions');

/**
 * Fans WhatsApp events out to every connected browser.
 *
 * Every payload carries the sessionId it came from, so one tab can watch all
 * linked accounts at once (unread badges for accounts you are not looking at)
 * while still knowing which account each event belongs to.
 */
function attachSocket(httpServer, origin) {
  const io = new Server(httpServer, {
    cors: { origin, methods: ['GET', 'POST'], credentials: true },
    maxHttpBufferSize: 1e7,
  });

  io.on('connection', (socket) => {
    console.log('[io] client connected', socket.id);
    // Immediately hand the new tab the full account list so it can render.
    socket.emit('wa:accounts', sessions.list());

    socket.on('wa:typing', async ({ sessionId, chatId, mode }) => {
      try {
        await sessions.get(sessionId).setTyping(chatId, mode);
      } catch {
        /* typing state is best-effort */
      }
    });

    socket.on('wa:seen', async ({ sessionId, chatId }) => {
      try {
        await sessions.get(sessionId).sendSeen(chatId);
      } catch {}
    });

    socket.on('disconnect', () => console.log('[io] client disconnected', socket.id));
  });

  const forward = (waEvent, ioEvent) =>
    sessions.on(waEvent, (payload) => io.emit(ioEvent, payload));

  forward('accounts', 'wa:accounts');
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
