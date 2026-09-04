'use strict';

/**
 * Mongo-backed cache of WhatsApp data.
 *
 * WhatsApp itself is always the source of truth - this layer only exists so the
 * UI can paint instantly on reload and so history survives a restart. Every
 * method is a no-op when the database is unreachable, so the app keeps working
 * on live data alone.
 */

const { isConnected } = require('../config/db');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const Contact = require('../models/Contact');

const off = () => !isConnected();

function messageDoc(m, sessionId) {
  return {
    sessionId,
    msgId: m.id,
    chatId: m.chatId,
    from: m.from,
    to: m.to,
    author: m.author,
    fromMe: m.fromMe,
    body: m.body,
    type: m.type,
    timestamp: m.timestamp,
    ack: m.ack,
    hasMedia: m.hasMedia,
    mediaMime: m.mediaMime,
    mediaFilename: m.mediaFilename,
    isForwarded: m.isForwarded,
    isStarred: m.isStarred,
    location: m.location,
    vcards: m.vcards || undefined,
    quotedMsgId: m.quotedMsgId,
    quotedPreview: m.quotedPreview,
    mentionedIds: m.mentionedIds && m.mentionedIds.length ? m.mentionedIds : undefined,
    notifyName: m.notifyName,
  };
}

async function saveMessage(m, sessionId = 'default') {
  if (off() || !m || !m.id) return;
  try {
    await Message.updateOne(
      { msgId: m.id },
      { $set: messageDoc(m, sessionId) },
      { upsert: true }
    );
  } catch (e) {
    if (e.code !== 11000) console.warn('[store] saveMessage:', e.message);
  }
}

async function saveMessages(list, sessionId = 'default') {
  if (off() || !Array.isArray(list) || !list.length) return;
  const ops = list
    .filter((m) => m && m.id)
    .map((m) => ({
      updateOne: { filter: { msgId: m.id }, update: { $set: messageDoc(m, sessionId) }, upsert: true },
    }));
  if (!ops.length) return;
  try {
    await Message.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.warn('[store] saveMessages:', e.message);
  }
}

async function getMessages(chatId, { limit = 50, offset = 0 } = {}) {
  if (off()) return [];
  try {
    const docs = await Message.find({ chatId, isDeleted: { $ne: true } })
      .sort({ timestamp: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean();
    return docs.reverse().map(fromDoc);
  } catch (e) {
    console.warn('[store] getMessages:', e.message);
    return [];
  }
}

function fromDoc(d) {
  return {
    id: d.msgId,
    chatId: d.chatId,
    from: d.from,
    to: d.to,
    author: d.author,
    fromMe: d.fromMe,
    body: d.body,
    type: d.type,
    timestamp: d.timestamp,
    ack: d.ack,
    hasMedia: d.hasMedia,
    mediaMime: d.mediaMime,
    mediaFilename: d.mediaFilename,
    isForwarded: d.isForwarded,
    isStarred: d.isStarred,
    location: d.location || null,
    vcards: d.vcards || null,
    quotedMsgId: d.quotedMsgId || null,
    quotedPreview: d.quotedPreview || null,
    mentionedIds: d.mentionedIds || [],
    hasQuotedMsg: !!d.quotedMsgId,
    notifyName: d.notifyName || null,
    links: [],
    cached: true,
  };
}

async function updateAck(msgId, ack) {
  if (off() || !msgId) return;
  try {
    await Message.updateOne({ msgId }, { $set: { ack } });
  } catch {}
}

async function updateBody(msgId, body) {
  if (off() || !msgId) return;
  try {
    await Message.updateOne({ msgId }, { $set: { body } });
  } catch {}
}

async function updateMedia(msgId, fields) {
  if (off() || !msgId) return;
  try {
    await Message.updateOne({ msgId }, { $set: fields });
  } catch {}
}

async function markDeleted(msgId) {
  if (off() || !msgId) return;
  try {
    await Message.updateOne({ msgId }, { $set: { isDeleted: true, body: '' } });
  } catch {}
}

async function saveChat(chat, sessionId = 'default') {
  if (off() || !chat || !chat.id) return;
  try {
    await Chat.updateOne(
      { chatId: chat.id },
      {
        $set: {
          sessionId,
          chatId: chat.id,
          name: chat.name,
          isGroup: chat.isGroup,
          isMuted: chat.isMuted,
          isArchived: chat.isArchived,
          isPinned: chat.isPinned,
          isReadOnly: chat.isReadOnly,
          unreadCount: chat.unreadCount,
          timestamp: chat.timestamp,
          lastMessage: chat.lastMessage || null,
          participants: chat.participants && chat.participants.length ? chat.participants : undefined,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    if (e.code !== 11000) console.warn('[store] saveChat:', e.message);
  }
}

async function saveChats(list, sessionId = 'default') {
  if (off() || !Array.isArray(list) || !list.length) return;
  for (const chat of list) await saveChat(chat, sessionId);
}

async function setUnread(chatId, unreadCount) {
  if (off() || !chatId) return;
  try {
    await Chat.updateOne({ chatId }, { $set: { unreadCount } });
  } catch {}
}

async function getChats() {
  if (off()) return [];
  try {
    const docs = await Chat.find({}).sort({ timestamp: -1 }).limit(500).lean();
    return docs.map((d) => ({
      id: d.chatId,
      name: d.name,
      isGroup: d.isGroup,
      isMuted: d.isMuted,
      isArchived: d.isArchived,
      isPinned: d.isPinned,
      isReadOnly: d.isReadOnly,
      unreadCount: d.unreadCount,
      timestamp: d.timestamp,
      lastMessage: d.lastMessage || null,
      participants: d.participants || [],
      participantCount: (d.participants || []).length,
      cached: true,
    }));
  } catch (e) {
    console.warn('[store] getChats:', e.message);
    return [];
  }
}

async function saveContacts(list, sessionId = 'default') {
  if (off() || !Array.isArray(list) || !list.length) return;
  const ops = list
    .filter((c) => c && c.id)
    .map((c) => ({
      updateOne: {
        filter: { contactId: c.id },
        update: {
          $set: {
            sessionId,
            contactId: c.id,
            number: c.number,
            name: c.name,
            pushname: c.pushname,
            shortName: c.shortName,
            isMe: c.isMe,
            isUser: c.isUser,
            isGroup: c.isGroup,
            isMyContact: c.isMyContact,
            isBusiness: c.isBusiness,
            isBlocked: c.isBlocked,
          },
        },
        upsert: true,
      },
    }));
  try {
    await Contact.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.warn('[store] saveContacts:', e.message);
  }
}

async function getContacts() {
  if (off()) return [];
  try {
    const docs = await Contact.find({ isMe: { $ne: true } })
      .sort({ isMyContact: -1, name: 1 })
      .limit(5000)
      .lean();
    return docs.map((d) => ({
      id: d.contactId,
      number: d.number,
      name: d.name,
      pushname: d.pushname,
      shortName: d.shortName,
      displayName: d.name || d.pushname || d.shortName || d.number,
      isMyContact: d.isMyContact,
      isGroup: d.isGroup,
      isBusiness: d.isBusiness,
      isBlocked: d.isBlocked,
      cached: true,
    }));
  } catch (e) {
    console.warn('[store] getContacts:', e.message);
    return [];
  }
}

async function searchMessages(query, { chatId = null, limit = 50 } = {}) {
  if (off() || !query) return [];
  try {
    const filter = { body: { $regex: query, $options: 'i' }, isDeleted: { $ne: true } };
    if (chatId) filter.chatId = chatId;
    const docs = await Message.find(filter).sort({ timestamp: -1 }).limit(Number(limit)).lean();
    return docs.map(fromDoc);
  } catch (e) {
    console.warn('[store] searchMessages:', e.message);
    return [];
  }
}

async function stats() {
  if (off()) return { connected: false };
  try {
    const [messages, chats, contacts] = await Promise.all([
      Message.estimatedDocumentCount(),
      Chat.estimatedDocumentCount(),
      Contact.estimatedDocumentCount(),
    ]);
    return { connected: true, messages, chats, contacts };
  } catch {
    return { connected: false };
  }
}

module.exports = {
  saveMessage,
  saveMessages,
  getMessages,
  updateAck,
  updateBody,
  updateMedia,
  markDeleted,
  saveChat,
  saveChats,
  setUnread,
  getChats,
  saveContacts,
  getContacts,
  searchMessages,
  stats,
};
