'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const wa = require('../services/whatsapp');
const store = require('../services/store');

const router = express.Router();

const upload = multer({
  dest: wa.UPLOAD_DIR,
  limits: { fileSize: 64 * 1024 * 1024 }, // WhatsApp caps most media around 64MB
});

/** Wraps an async handler so rejections reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* -------------------------------------------------------------------- */
/* session                                                               */
/* -------------------------------------------------------------------- */

router.get('/status', (_req, res) => res.json(wa.status()));

router.post('/session/start', ah(async (_req, res) => {
  const status = await wa.initialize();
  res.json(status);
}));

router.post('/session/restart', ah(async (_req, res) => res.json(await wa.restart())));

router.post('/session/logout', ah(async (_req, res) => {
  await wa.logout();
  res.json({ ok: true, status: wa.status() });
}));

router.post('/session/sync', ah(async (_req, res) => res.json(await wa.syncAll())));

/* -------------------------------------------------------------------- */
/* chats                                                                 */
/* -------------------------------------------------------------------- */

router.get('/chats', ah(async (req, res) => {
  try {
    const chats = await wa.getChats();
    res.json({ chats, source: 'live' });
  } catch (err) {
    // Not connected yet - fall back to the cached copy so the UI has something.
    if (err.status === 409 && req.query.allowCache !== 'false') {
      const chats = await store.getChats();
      if (chats.length) return res.json({ chats, source: 'cache' });
    }
    throw err;
  }
}));

router.get('/chats/:chatId', ah(async (req, res) => {
  res.json(await wa.getChatById(req.params.chatId));
}));

router.get('/chats/:chatId/messages', ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  try {
    const result = await wa.getMessages(req.params.chatId, { limit, offset });
    res.json({ ...result, source: 'live' });
  } catch (err) {
    if (err.status === 409) {
      const messages = await store.getMessages(req.params.chatId, { limit, offset });
      if (messages.length) {
        return res.json({ messages, hasMore: messages.length === limit, source: 'cache' });
      }
    }
    throw err;
  }
}));

router.post('/chats/:chatId/seen', ah(async (req, res) => {
  res.json(await wa.sendSeen(req.params.chatId));
}));

router.post('/chats/:chatId/typing', ah(async (req, res) => {
  res.json(await wa.setTyping(req.params.chatId, req.body.mode || 'typing'));
}));

router.post('/chats/:chatId/action', ah(async (req, res) => {
  const { action, value } = req.body || {};
  res.json(await wa.chatAction(req.params.chatId, action, value));
}));

/* -------------------------------------------------------------------- */
/* contacts                                                              */
/* -------------------------------------------------------------------- */

router.get('/contacts', ah(async (req, res) => {
  try {
    const contacts = await wa.getContacts();
    res.json({ contacts, source: 'live' });
  } catch (err) {
    if (err.status === 409 && req.query.allowCache !== 'false') {
      const contacts = await store.getContacts();
      if (contacts.length) return res.json({ contacts, source: 'cache' });
    }
    throw err;
  }
}));

router.get('/contacts/:contactId', ah(async (req, res) => {
  res.json(await wa.getContactInfo(req.params.contactId));
}));

router.post('/numbers/resolve', ah(async (req, res) => {
  const id = await wa.resolveNumber(req.body.number);
  res.json({ id, registered: !!id });
}));

/* -------------------------------------------------------------------- */
/* avatars + media                                                       */
/* -------------------------------------------------------------------- */

const avatarMemo = new Map(); // id -> { buf, type, at }

router.get('/avatar/:contactId', ah(async (req, res) => {
  const id = req.params.contactId;
  const hit = avatarMemo.get(id);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) {
    if (!hit.buf) return res.status(204).end();
    res.set('Content-Type', hit.type);
    res.set('Cache-Control', 'private, max-age=1800');
    return res.send(hit.buf);
  }

  const url = await wa.getProfilePicUrl(id).catch(() => null);
  if (!url) {
    avatarMemo.set(id, { buf: null, at: Date.now() });
    return res.status(204).end(); // no photo - the UI draws initials instead
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    avatarMemo.set(id, { buf, type, at: Date.now() });
    res.set('Content-Type', type);
    res.set('Cache-Control', 'private, max-age=1800');
    res.send(buf);
  } catch {
    avatarMemo.set(id, { buf: null, at: Date.now() });
    res.status(204).end();
  }
}));

router.get('/media/:messageId', ah(async (req, res) => {
  const { filePath, mimetype, filename } = await wa.getMedia(req.params.messageId);
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

router.post('/messages/send', ah(async (req, res) => {
  const { chatId, text, quotedMessageId, mentions, linkPreview } = req.body || {};
  if (!chatId || !text || !String(text).trim()) {
    return res.status(400).json({ error: 'chatId and text are required' });
  }
  const msg = await wa.sendText(chatId, String(text), { quotedMessageId, mentions, linkPreview });
  // A null message means WhatsApp accepted the send but did not hand the model
  // back; the socket delivers the real one. Never report that as a failure.
  res.json({ message: msg, sent: true });
}));

router.post('/messages/send-media', upload.single('file'), ah(async (req, res) => {
  const { chatId, caption, quotedMessageId, asDocument, asVoice, asSticker } = req.body || {};
  if (!chatId) return res.status(400).json({ error: 'chatId is required' });
  if (!req.file) return res.status(400).json({ error: 'file is required' });

  const tmpPath = req.file.path;
  // multer strips the extension; MessageMedia needs it to infer the mime type.
  const named = path.join(path.dirname(tmpPath), `${path.basename(tmpPath)}-${req.file.originalname}`);
  try {
    fs.renameSync(tmpPath, named);
    const msg = await wa.sendFile(
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

router.post('/messages/location', ah(async (req, res) => {
  const { chatId, latitude, longitude, description, quotedMessageId } = req.body || {};
  if (!chatId || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'chatId, latitude and longitude are required' });
  }
  const msg = await wa.sendLocation(chatId, { latitude, longitude, description }, { quotedMessageId });
  res.json({ message: msg, sent: true });
}));

/* -------------------------------------------------------------------- */
/* message actions                                                       */
/* -------------------------------------------------------------------- */

router.post('/messages/:messageId/react', ah(async (req, res) => {
  res.json(await wa.reactToMessage(req.params.messageId, (req.body || {}).emoji));
}));

router.post('/messages/:messageId/star', ah(async (req, res) => {
  res.json(await wa.starMessage(req.params.messageId, (req.body || {}).star !== false));
}));

router.post('/messages/:messageId/forward', ah(async (req, res) => {
  const { toChatId } = req.body || {};
  if (!toChatId) return res.status(400).json({ error: 'toChatId is required' });
  res.json(await wa.forwardMessage(req.params.messageId, toChatId));
}));

router.patch('/messages/:messageId', ah(async (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body is required' });
  res.json({ message: await wa.editMessage(req.params.messageId, body) });
}));

router.delete('/messages/:messageId', ah(async (req, res) => {
  const everyone = req.query.everyone === 'true';
  res.json(await wa.deleteMessage(req.params.messageId, everyone));
}));

/* -------------------------------------------------------------------- */
/* search, groups, diagnostics                                           */
/* -------------------------------------------------------------------- */

router.get('/search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ messages: [] });
  const chatId = req.query.chatId || null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    res.json({ messages: await wa.searchMessages(q, { chatId, limit }), source: 'live' });
  } catch (err) {
    if (err.status === 409) {
      return res.json({ messages: await store.searchMessages(q, { chatId, limit }), source: 'cache' });
    }
    throw err;
  }
}));

router.post('/groups', ah(async (req, res) => {
  const { name, participants } = req.body || {};
  if (!name || !Array.isArray(participants) || !participants.length) {
    return res.status(400).json({ error: 'name and participants[] are required' });
  }
  res.json(await wa.createGroup(name, participants));
}));

router.get('/db/stats', ah(async (_req, res) => res.json(await store.stats())));

router.get('/debug/page', ah(async (_req, res) => res.json(await wa.diagnostics())));

module.exports = router;
