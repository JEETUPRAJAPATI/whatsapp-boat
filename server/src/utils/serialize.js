'use strict';

/** Normalises anything WhatsApp hands us that might be an id object or a string. */
function idOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;
  if (value._serialized) return value._serialized;

  // Newer WhatsApp builds hand back message keys without _serialized. Rebuild it
  // from the parts, otherwise the id is just a bare hex string and every action
  // that looks a message up by id (delete, react, star, forward, media) fails.
  if (value.id && value.remote !== undefined && value.remote !== null) {
    const remote = idOf(value.remote);
    if (remote) {
      const parts = [value.fromMe ? 'true' : 'false', remote, value.id];
      const participant = idOf(value.participant);
      if (participant) parts.push(participant);
      return parts.join('_');
    }
  }
  return value.id || null;
}

/** "919876543210@c.us" -> "919876543210" */
function numberOf(jid) {
  const id = idOf(jid);
  return id ? id.split('@')[0] : null;
}

function idList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(idOf).filter(Boolean);
}

function serializeMessage(msg) {
  if (!msg) return null;
  const raw = msg._data || {};
  const quoted = raw.quotedMsg || null;

  return {
    id: idOf(msg.id),
    chatId: idOf(msg.fromMe ? msg.to : msg.from),
    from: idOf(msg.from),
    to: idOf(msg.to),
    author: idOf(msg.author),
    fromMe: !!msg.fromMe,
    body: msg.body || '',
    type: msg.type || 'chat',
    timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
    ack: typeof msg.ack === 'number' ? msg.ack : 0,
    hasMedia: !!msg.hasMedia,
    mediaMime: raw.mimetype || null,
    mediaFilename: raw.filename || null,
    // Size/duration let the UI render a sensible placeholder before download.
    mediaSize: raw.size || null,
    duration: raw.duration || null,
    isForwarded: !!msg.isForwarded,
    isStarred: !!msg.isStarred,
    isStatus: !!msg.isStatus,
    isGif: !!msg.isGif,
    broadcast: !!msg.broadcast,
    location: msg.location
      ? {
          latitude: msg.location.latitude,
          longitude: msg.location.longitude,
          description: msg.location.description || null,
        }
      : null,
    vcards: Array.isArray(msg.vCards) && msg.vCards.length ? msg.vCards : null,
    links: Array.isArray(msg.links) ? msg.links.map((l) => l.link || l) : [],
    mentionedIds: idList(msg.mentionedIds),
    hasQuotedMsg: !!msg.hasQuotedMsg,
    quotedMsgId: idOf(raw.quotedStanzaID) || (quoted ? idOf(quoted.id) : null),
    quotedPreview: quoted
      ? {
          id: idOf(quoted.id),
          body: quoted.body || quoted.caption || '',
          type: quoted.type || 'chat',
          fromMe: !!(quoted.id && quoted.id.fromMe),
          author: idOf(quoted.author) || idOf(quoted.from),
        }
      : null,
    notifyName: raw.notifyName || null,
    // Group system messages ("X added Y") carry their subject here.
    subject: raw.subject || null,
    recipientIds: idList(raw.recipients),
  };
}

function serializeChat(chat) {
  if (!chat) return null;
  return {
    id: idOf(chat.id),
    name: chat.name || numberOf(chat.id),
    isGroup: !!chat.isGroup,
    isReadOnly: !!chat.isReadOnly,
    isMuted: !!chat.isMuted,
    muteExpiration: chat.muteExpiration || 0,
    isArchived: !!chat.archived,
    isPinned: !!chat.pinned,
    unreadCount: chat.unreadCount || 0,
    timestamp: chat.timestamp || 0,
    lastMessage: chat.lastMessage ? serializeMessage(chat.lastMessage) : null,
    participantCount: chat.isGroup && chat.participants ? chat.participants.length : 0,
    participants:
      chat.isGroup && Array.isArray(chat.participants)
        ? chat.participants.map((p) => ({
            id: idOf(p.id),
            isAdmin: !!p.isAdmin,
            isSuperAdmin: !!p.isSuperAdmin,
          }))
        : [],
    groupMetadata: chat.isGroup
      ? {
          owner: idOf(chat.owner),
          description: (chat.groupMetadata && chat.groupMetadata.desc) || '',
          createdAt: (chat.groupMetadata && chat.groupMetadata.creation) || null,
        }
      : null,
  };
}

function serializeContact(contact) {
  if (!contact) return null;
  const id = idOf(contact.id);
  return {
    id,
    number: contact.number || numberOf(id),
    name: contact.name || null,
    pushname: contact.pushname || null,
    shortName: contact.shortName || null,
    // What the UI should actually print, in WhatsApp's own order of preference.
    displayName:
      contact.name || contact.pushname || contact.shortName || contact.number || numberOf(id),
    isMe: !!contact.isMe,
    isUser: !!contact.isUser,
    isGroup: !!contact.isGroup,
    isWAContact: !!contact.isWAContact,
    isMyContact: !!contact.isMyContact,
    isBusiness: !!contact.isBusiness,
    isEnterprise: !!contact.isEnterprise,
    isBlocked: !!contact.isBlocked,
  };
}

module.exports = { idOf, numberOf, idList, serializeMessage, serializeChat, serializeContact };
