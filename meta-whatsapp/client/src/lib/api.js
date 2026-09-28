const BASE = '/api';

async function request(pathname, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  status: () => request('/whatsapp/status'),

  getMetaSettings: () => request('/settings/meta'),
  updateMetaSettings: (payload) =>
    request('/settings/meta', { method: 'PUT', body: payload }),

  conversations: ({ search, status } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const qs = params.toString();
    return request(`/whatsapp/conversations${qs ? `?${qs}` : ''}`);
  },
  conversation: (id) => request(`/whatsapp/conversations/${id}`),
  messages: (id, { limit = 50, before } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return request(`/whatsapp/conversations/${id}/messages?${params}`);
  },
  markRead: (id) => request(`/whatsapp/conversations/${id}/read`, { method: 'POST' }),
  updateConversation: (id, patch) =>
    request(`/whatsapp/conversations/${id}`, { method: 'PATCH', body: patch }),

  sendMessage: (to, message) =>
    request('/whatsapp/send-message', { method: 'POST', body: { to, type: 'text', message } }),
  sendTemplate: (to, templateName, language, components) =>
    request('/whatsapp/send-template', {
      method: 'POST',
      body: { to, template_name: templateName, language, components },
    }),

  customers: (search) =>
    request(`/whatsapp/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  /** Multipart upload with progress, so the composer can show a bar. */
  sendMedia(to, file, { caption, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      form.append('to', to);
      if (caption) form.append('caption', caption);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/whatsapp/send-media`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const err = new Error((data && data.message) || `Upload failed (${xhr.status})`);
        err.status = xhr.status;
        err.data = data;
        reject(err);
      };
      xhr.onerror = () => reject(new Error('Network error while uploading'));
      xhr.send(form);
    });
  },
};

/**
 * Media is proxied through the server so the Meta token stays there, which
 * means an <img src> cannot fetch it directly - the bytes come back as a
 * blob URL instead. Results are cached per message id.
 */
const mediaCache = new Map();

export function mediaObjectUrl(messageId) {
  if (mediaCache.has(messageId)) return mediaCache.get(messageId);

  const promise = fetch(`${BASE}/whatsapp/messages/${messageId}/media`)
    .then(async (res) => {
      if (!res.ok) {
        let message = `Media unavailable (${res.status})`;
        try {
          const body = await res.json();
          if (body && body.message) message = body.message;
        } catch {
          /* keep the default message */
        }
        throw new Error(message);
      }
      return res.blob();
    })
    .then((blob) => URL.createObjectURL(blob))
    .catch((err) => {
      // Don't cache a failure: the next render should be free to retry.
      mediaCache.delete(messageId);
      throw err;
    });

  mediaCache.set(messageId, promise);
  return promise;
}
