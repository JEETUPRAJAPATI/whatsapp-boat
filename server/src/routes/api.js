'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const sessions = require('../services/sessions');
const store = require('../services/store');

const router = express.Router();

const upload = multer({
  dest: sessions.UPLOAD_DIR,
  limits: { fileSize: 64 * 1024 * 1024 }, // WhatsApp caps most media around 64MB
});

/** Wraps an async handler so rejections reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* -------------------------------------------------------------------- */
/* accounts                                                              */
/* -------------------------------------------------------------------- */

router.get('/accounts', (_req, res) => res.json({ accounts: sessions.list() }));

router.post('/accounts', ah(async (req, res) => {
  const label = String((req.body && req.body.label) || '').trim().slice(0, 60);
  const account = await sessions.create({ label });
  res.status(201).json({ account });
}));

/* -------------------------------------------------------------------- */
/* everything below is scoped to one linked account                      */
/* -------------------------------------------------------------------- */

const account = express.Router({ mergeParams: true });

// Resolving the service once here is what keeps every handler account-aware:
// there is no ambient "current account" anywhere in the server.
account.use((req, _res, next) => {
  req.sessionId = req.params.sessionId;
  req.wa = sessions.get(req.sessionId); // throws 404 when unknown
  next();
});

account.get('/', (req, res) => res.json(sessions.describe(req.wa)));

account.patch('/', ah(async (req, res) => {
  const label = String((req.body && req.body.label) || '').trim().slice(0, 60);
  res.json(await sessions.rename(req.sessionId, label));
}));

account.delete('/', ah(async (req, res) => {
  const purge = req.query.keepHistory !== 'true';
  res.json(await sessions.remove(req.sessionId, { purge }));
}));

account.get('/status', (req, res) => res.json(sessions.describe(req.wa)));

account.post('/start', ah(async (req, res) => res.json(await sessions.start(req.sessionId))));

account.post('/restart', ah(async (req, res) => res.json(await sessions.restart(req.sessionId))));

account.post('/logout', ah(async (req, res) => {
  res.json({ ok: true, status: await sessions.logout(req.sessionId) });
}));

account.post('/sync', ah(async (req, res) => res.json(await req.wa.syncAll())));

/* -------------------------------------------------------------------- */
/* chats                                                                 */
/* -------------------------------------------------------------------- */

account.get('/chats', ah(async (req, res) => {
  if (req.query.preferCache === 'true') {
    const cached = await store.getChats(req.sessionId);
    if (cached.length) return res.json({ chats: cached, source: 'cache' });
  }
  try {
    const chats = await req.wa.getChats();
    res.json({ chats, source: 'live' });
  } catch (err) {
    // Any live failure - not connected, a lost injection, a timeout under load -
    // is better answered with the cached copy than with an error.
    if (req.query.allowCache !== 'false') {
      const chats = await store.getChats(req.sessionId);
      if (chats.length) return res.json({ chats, source: 'cache', liveError: err.message });
    }
    throw err;
  }
}));

account.get('/chats/:chatId', ah(async (req, res) => {
  res.json(await req.wa.getChatById(req.params.chatId));
}));

account.get('/chats/:chatId/messages', ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  try {
    const result = await req.wa.getMessages(req.params.chatId, { limit, offset });
    res.json({ ...result, source: 'live' });
  } catch (err) {
    if (err.status === 409) {
      const messages = await store.getMessages(req.sessionId, req.params.chatId, { limit, offset });
      if (messages.length) {
        return res.json({ messages, hasMore: messages.length === limit, source: 'cache' });
      }
    }
    throw err;
  }
}));

account.post('/chats/:chatId/seen', ah(async (req, res) => {
  res.json(await req.wa.sendSeen(req.params.chatId));
}));

account.post('/chats/:chatId/typing', ah(async (req, res) => {
  res.json(await req.wa.setTyping(req.params.chatId, req.body.mode || 'typing'));
}));

account.post('/chats/:chatId/action', ah(async (req, res) => {
  const { action, value } = req.body || {};
  res.json(await req.wa.chatAction(req.params.chatId, action, value));
}));

/* -------------------------------------------------------------------- */
/* contacts                                                              */
/* -------------------------------------------------------------------- */

account.get('/contacts', ah(async (req, res) => {
  if (req.query.preferCache === 'true') {
    const cached = await store.getContacts(req.sessionId);
    if (cached.length) return res.json({ contacts: cached, source: 'cache' });
  }
  try {
    const contacts = await req.wa.getContacts();
    res.json({ contacts, source: 'live' });
  } catch (err) {
    if (req.query.allowCache !== 'false') {
      const contacts = await store.getContacts(req.sessionId);
      if (contacts.length) return res.json({ contacts, source: 'cache', liveError: err.message });
    }
    throw err;
  }
}));

account.get('/contacts/:contactId', ah(async (req, res) => {
  res.json(await req.wa.getContactInfo(req.params.contactId));
}));

account.post('/numbers/resolve', ah(async (req, res) => {
  const id = await req.wa.resolveNumber(req.body.number);
  res.json({ id, registered: !!id });
}));

/* -------------------------------------------------------------------- */
/* avatars + media                                                       */
/* -------------------------------------------------------------------- */

// Keyed by account too: the same contact id can resolve to different photos
// depending on which account is asking (privacy settings are per-viewer).
const avatarMemo = new Map(); // `${sessionId}|${contactId}` -> { buf, type, at }

account.get('/avatar/:contactId', ah(async (req, res) => {
  const id = req.params.contactId;
  const key = `${req.sessionId}|${id}`;
  const hit = avatarMemo.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) {
    if (!hit.buf) return res.status(204).end();
    res.set('Content-Type', hit.type);
    res.set('Cache-Control', 'private, max-age=1800');
    return res.send(hit.buf);
  }

  const url = await req.wa.getProfilePicUrl(id).catch(() => null);
  if (!url) {
    avatarMemo.set(key, { buf: null, at: Date.now() });
    return res.status(204).end(); // no photo - the UI draws initials instead
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    avatarMemo.set(key, { buf, type, at: Date.now() });
    res.set('Content-Type', type);
    res.set('Cache-Control', 'private, max-age=1800');
    res.send(buf);
  } catch {
    avatarMemo.set(key, { buf: null, at: Date.now() });
    res.status(204).end();
  }
}));

account.get('/media/:messageId', ah(async (req, res) => {
  const { filePath, mimetype, filename } = await req.wa.getMedia(req.params.messageId);
  res.set('Content-Type', mimetype || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=86400');
  if (req.query.download === '1') {
    res.set('Content-Disposition', `attachment; filename="${filename || path.basename(filePath)}"`);
  }
  // res.sendFile handles Range requests, which audio/video seeking needs.
  res.sendFile(filePath);
}));

/* -------------------------------------------------------------------- */
/* sending                                                               */
/* -------------------------------------------------------------------- */

account.post('/messages/send', ah(async (req, res) => {
  const { chatId, text, quotedMessageId, mentions, linkPreview } = req.body || {};
  if (!chatId || !text || !String(text).trim()) {
    return res.status(400).json({ error: 'chatId and text are required' });
  }
  const msg = await req.wa.sendText(chatId, String(text), { quotedMessageId, mentions, linkPreview });
  // A null message means WhatsApp accepted the send but did not hand the model
  // back; the socket delivers the real one. Never report that as a failure.
  res.json({ message: msg, sent: true });
}));

account.post('/messages/send-media', upload.single('file'), ah(async (req, res) => {
  const { chatId, caption, quotedMessageId, asDocument, asVoice, asSticker } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'chatId is required' });
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const tmpPath = req.file.path;
  // multer strips the extension; MessageMedia needs it to infer the mime type.
  const named = path.join(path.dirname(tmpPath), `${path.basename(tmpPath)}-${req.file.originalname}`);
  try {
    fs.renameSync(tmpPath, named);
    const msg = await req.wa.sendFile(
      chatId,
      { filePath: named, filename: req.file.originalname },
      {
        caption,
        quotedMessageId,
        sendMediaAsDocument: asDocument === 'true' || asDocument === true,
        sendAudioAsVoice: asVoice === 'true' || asVoice === true,
        sendMediaAsSticker: asSticker === 'true' || asSticker === true,
      }
    );
    res.json({ message: msg, sent: true });
  } finally {
    fs.promises.unlink(named).catch(() => fs.promises.unlink(tmpPath).catch(() => {}));
  }
}));

account.post('/messages/location', ah(async (req, res) => {
  const { chatId, latitude, longitude, description, quotedMessageId } = req.body || {};
  if (!chatId || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'chatId, latitude and longitude are required' });
  }
  const msg = await req.wa.sendLocation(
    chatId,
    { latitude, longitude, description },
    { quotedMessageId }
  );
  res.json({ message: msg, sent: true });
}));

/* -------------------------------------------------------------------- */
/* message actions                                                       */
/* -------------------------------------------------------------------- */

account.post('/messages/:messageId/react', ah(async (req, res) => {
  res.json(await req.wa.reactToMessage(req.params.messageId, (req.body || {}).emoji));
}));

account.post('/messages/:messageId/star', ah(async (req, res) => {
  res.json(await req.wa.starMessage(req.params.messageId, (req.body || {}).star !== false));
}));

account.post('/messages/:messageId/forward', ah(async (req, res) => {
  const { toChatId } = req.body || {};
  if (!toChatId) return res.status(400).json({ error: 'toChatId is required' });
  res.json(await req.wa.forwardMessage(req.params.messageId, toChatId));
}));

account.patch('/messages/:messageId', ah(async (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  res.json({ message: await req.wa.editMessage(req.params.messageId, body) });
}));

account.delete('/messages/:messageId', ah(async (req, res) => {
  const everyone = req.query.everyone === 'true';
  res.json(await req.wa.deleteMessage(req.params.messageId, everyone));
}));

/* -------------------------------------------------------------------- */
/* search, groups, diagnostics                                           */
/* -------------------------------------------------------------------- */

account.get('/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ messages: [] });
  const chatId = req.query.chatId || null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    res.json({ messages: await req.wa.searchMessages(q, { chatId, limit }), source: 'live' });
  } catch (err) {
    if (err.status === 409) {
      return res.json({
        messages: await store.searchMessages(req.sessionId, q, { chatId, limit }),
        source: 'cache',
      });
    }
    throw err;
  }
}));

account.post('/groups', ah(async (req, res) => {
  const { name, participants } = req.body || {};
  if (!name || !Array.isArray(participants) || !participants.length) {
    return res.status(400).json({ error: 'name and participants[] are required' });
  }
  res.json(await req.wa.createGroup(name, participants));
}));

account.get('/db/stats', ah(async (req, res) => res.json(await store.stats(req.sessionId))));

account.get('/debug/page', ah(async (req, res) => res.json(await req.wa.diagnostics())));

router.use('/accounts/:sessionId', account);

/* -------------------------------------------------------------------- */
/* server-wide                                                           */
/* -------------------------------------------------------------------- */

router.get('/db/stats', ah(async (_req, res) => res.json(await store.stats())));

module.exports = router;
