const BASE = '/api';

async function request(pathname, { method = 'GET', body, signal } = {}) {
  const opts = { method, signal, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + pathname, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  status: () => request('/status'),
  startSession: () => request('/session/start', { method: 'POST' }),
  restartSession: () => request('/session/restart', { method: 'POST' }),
  logout: () => request('/session/logout', { method: 'POST' }),
  sync: () => request('/session/sync', { method: 'POST' }),

  chats: () => request('/chats'),
  chat: (id) => request(`/chats/${encodeURIComponent(id)}`),
  messages: (id, { limit = 50, offset = 0 } = {}) =>
    request(`/chats/${encodeURIComponent(id)}/messages?limit=${limit}&offset=${offset}`),
  markSeen: (id) => request(`/chats/${encodeURIComponent(id)}/seen`, { method: 'POST' }),
  typing: (id, mode) =>
    request(`/chats/${encodeURIComponent(id)}/typing`, { method: 'POST', body: { mode } }),
  chatAction: (id, action, value) =>
    request(`/chats/${encodeURIComponent(id)}/action`, { method: 'POST', body: { action, value } }),

  contacts: () => request('/contacts'),
  contact: (id) => request(`/contacts/${encodeURIComponent(id)}`),
  resolveNumber: (number) => request('/numbers/resolve', { method: 'POST', body: { number } }),

  sendText: (chatId, text, extra = {}) =>
    request('/messages/send', { method: 'POST', body: { chatId, text, ...extra } }),
  sendLocation: (chatId, coords) =>
    request('/messages/location', { method: 'POST', body: { chatId, ...coords } }),
  react: (messageId, emoji) =>
    request(`/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', body: { emoji } }),
  star: (messageId, star) =>
    request(`/messages/${encodeURIComponent(messageId)}/star`, { method: 'POST', body: { star } }),
  forward: (messageId, toChatId) =>
    request(`/messages/${encodeURIComponent(messageId)}/forward`, {
      method: 'POST',
      body: { toChatId },
    }),
  edit: (messageId, body) =>
    request(`/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: { body } }),
  remove: (messageId, everyone) =>
    request(`/messages/${encodeURIComponent(messageId)}?everyone=${everyone ? 'true' : 'false'}`, {
      method: 'DELETE',
    }),

  search: (q, chatId) =>
    request(`/search?q=${encodeURIComponent(q)}${chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''}`),

  createGroup: (name, participants) =>
    request('/groups', { method: 'POST', body: { name, participants } }),

  /** Multipart upload with progress, so the composer can show a bar. */
  sendMedia(chatId, file, { caption, quotedMessageId, asDocument, asVoice, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      form.append('chatId', chatId);
      if (caption) form.append('caption', caption);
      if (quotedMessageId) form.append('quotedMessageId', quotedMessageId);
      if (asDocument) form.append('asDocument', 'true');
      if (asVoice) form.append('asVoice', 'true');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/messages/send-media`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error) || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error while uploading'));
      xhr.send(form);
    });
  },
};

export const mediaUrl = (messageId, download = false) =>
  `${BASE}/media/${encodeURIComponent(messageId)}${download ? '?download=1' : ''}`;

export const avatarUrl = (contactId) => `${BASE}/avatar/${encodeURIComponent(contactId)}`;
