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

/* -------------------------------------------------------------------- */
/* accounts                                                              */
/* -------------------------------------------------------------------- */

export const accountsApi = {
  list: () => request('/accounts'),
  /** Creates a new account and starts linking it; the QR arrives by socket. */
  create: (label) => request('/accounts', { method: 'POST', body: { label } }),
  rename: (sessionId, label) =>
    request(`/accounts/${encodeURIComponent(sessionId)}`, { method: 'PATCH', body: { label } }),
  remove: (sessionId, { keepHistory = false } = {}) =>
    request(`/accounts/${encodeURIComponent(sessionId)}?keepHistory=${keepHistory}`, {
      method: 'DELETE',
    }),
  status: (sessionId) => request(`/accounts/${encodeURIComponent(sessionId)}/status`),
  start: (sessionId) => request(`/accounts/${encodeURIComponent(sessionId)}/start`, { method: 'POST' }),
  restart: (sessionId) =>
    request(`/accounts/${encodeURIComponent(sessionId)}/restart`, { method: 'POST' }),
  logout: (sessionId) =>
    request(`/accounts/${encodeURIComponent(sessionId)}/logout`, { method: 'POST' }),
  sync: (sessionId) => request(`/accounts/${encodeURIComponent(sessionId)}/sync`, { method: 'POST' }),
};

/* -------------------------------------------------------------------- */
/* one account's data                                                    */
/* -------------------------------------------------------------------- */

export const accountBase = (sessionId) => `/accounts/${encodeURIComponent(sessionId)}`;

const cache = new Map();

/**
 * Everything the chat UI calls, bound to one linked account. Instances are
 * memoised so passing the result straight into a hook dependency list is safe.
 */
export function accountApi(sessionId) {
  if (!sessionId) return null;
  if (cache.has(sessionId)) return cache.get(sessionId);
  const root = accountBase(sessionId);

  const api = {
    sessionId,

    status: () => request(`${root}/status`),
    restartSession: () => accountsApi.restart(sessionId),
    logout: () => accountsApi.logout(sessionId),
    sync: () => accountsApi.sync(sessionId),

    chats: ({ preferCache = false } = {}) =>
      request(`${root}/chats${preferCache ? '?preferCache=true' : ''}`),
    chat: (id) => request(`${root}/chats/${encodeURIComponent(id)}`),
    messages: (id, { limit = 50, offset = 0 } = {}) =>
      request(`${root}/chats/${encodeURIComponent(id)}/messages?limit=${limit}&offset=${offset}`),
    markSeen: (id) => request(`${root}/chats/${encodeURIComponent(id)}/seen`, { method: 'POST' }),
    typing: (id, mode) =>
      request(`${root}/chats/${encodeURIComponent(id)}/typing`, { method: 'POST', body: { mode } }),
    chatAction: (id, action, value) =>
      request(`${root}/chats/${encodeURIComponent(id)}/action`, {
        method: 'POST',
        body: { action, value },
      }),

    contacts: ({ preferCache = false } = {}) =>
      request(`${root}/contacts${preferCache ? '?preferCache=true' : ''}`),
    contact: (id) => request(`${root}/contacts/${encodeURIComponent(id)}`),
    resolveNumber: (number) => request(`${root}/numbers/resolve`, { method: 'POST', body: { number } }),

    sendText: (chatId, text, extra = {}) =>
      request(`${root}/messages/send`, { method: 'POST', body: { chatId, text, ...extra } }),
    sendLocation: (chatId, coords) =>
      request(`${root}/messages/location`, { method: 'POST', body: { chatId, ...coords } }),
    react: (messageId, emoji) =>
      request(`${root}/messages/${encodeURIComponent(messageId)}/react`, {
        method: 'POST',
        body: { emoji },
      }),
    star: (messageId, star) =>
      request(`${root}/messages/${encodeURIComponent(messageId)}/star`, {
        method: 'POST',
        body: { star },
      }),
    forward: (messageId, toChatId) =>
      request(`${root}/messages/${encodeURIComponent(messageId)}/forward`, {
        method: 'POST',
        body: { toChatId },
      }),
    edit: (messageId, body) =>
      request(`${root}/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: { body },
      }),
    remove: (messageId, everyone) =>
      request(`${root}/messages/${encodeURIComponent(messageId)}?everyone=${everyone ? 'true' : 'false'}`, {
        method: 'DELETE',
      }),

    search: (q, chatId) =>
      request(
        `${root}/search?q=${encodeURIComponent(q)}${
          chatId ? `&chatId=${encodeURIComponent(chatId)}` : ''
        }`
      ),

    createGroup: (name, participants) =>
      request(`${root}/groups`, { method: 'POST', body: { name, participants } }),

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
        xhr.open('POST', `${BASE}${root}/messages/send-media`);
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

  cache.set(sessionId, api);
  return api;
}

export const mediaUrl = (sessionId, messageId, download = false) =>
  `${BASE}${accountBase(sessionId)}/media/${encodeURIComponent(messageId)}${
    download ? '?download=1' : ''
  }`;

export const avatarUrl = (sessionId, contactId) =>
  `${BASE}${accountBase(sessionId)}/avatar/${encodeURIComponent(contactId)}`;
