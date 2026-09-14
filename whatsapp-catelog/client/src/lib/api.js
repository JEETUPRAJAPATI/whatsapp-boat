/**
 * The one place the browser talks to the server.
 *
 * Note what is absent: there is no Meta Graph URL anywhere in the frontend and
 * no access token in localStorage beyond our own admin JWT. Every Meta call is
 * made by the server on our behalf.
 */

const BASE = '/api';
const TOKEN_KEY = 'wa-catalog-token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  set: (token) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private browsing - the session simply will not persist */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Error carrying the server's human-readable message and machine code. */
export class ApiError extends Error {
  constructor(message, { status, code, data } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Called when any request comes back 401, so the app can sign the user out. */
let onUnauthorized = null;
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request(path, { method = 'GET', body, auth = true, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check that it is running.', {
      code: 'NETWORK',
    });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(data?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: data?.code,
      data,
    });
  }
  return data;
}

/** Multipart upload with progress, so uploads can show a real bar. */
function upload(path, file, fields = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + path);

    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }

    xhr.onload = () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = { message: xhr.responseText };
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401 && onUnauthorized) onUnauthorized();
      reject(
        new ApiError(data?.message || `Upload failed (${xhr.status})`, {
          status: xhr.status,
          code: data?.code,
          data,
        }),
      );
    };
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', { code: 'NETWORK' }));
    xhr.send(form);
  });
}

export const api = {
  // ---------------------------------------------------------------- auth
  authConfig: () => request('/auth/config', { auth: false }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/auth/me'),

  // ------------------------------------------------------------ whatsapp
  status: () => request('/whatsapp/status'),
  accounts: () => request('/whatsapp/accounts'),
  account: (id) => request(`/whatsapp/accounts/${id}`),
  accountCredential: (id) => request(`/whatsapp/accounts/${id}/credential`),
  refreshAccount: (id) => request(`/whatsapp/accounts/${id}/refresh`, { method: 'POST' }),
  disconnectAccount: (id) => request(`/whatsapp/accounts/${id}`, { method: 'DELETE' }),

  embeddedSignupConfig: () => request('/whatsapp/embedded-signup/config'),
  embeddedSignup: (payload) =>
    request('/whatsapp/embedded-signup', { method: 'POST', body: payload }),

  discoverBusinesses: () => request('/whatsapp/discover/businesses'),
  discoverAccounts: (businessId) => request(`/whatsapp/discover/accounts${query({ businessId })}`),
  discoverPhoneNumbers: (wabaId) => request(`/whatsapp/discover/phone-numbers${query({ wabaId })}`),
  connectAccount: (payload) => request('/whatsapp/connect', { method: 'POST', body: payload }),

  requestCode: (accountId, payload) =>
    request(`/whatsapp/accounts/${accountId}/request-code`, { method: 'POST', body: payload }),
  verifyCode: (accountId, payload) =>
    request(`/whatsapp/accounts/${accountId}/verify-code`, { method: 'POST', body: payload }),
  registerNumber: (accountId, payload) =>
    request(`/whatsapp/accounts/${accountId}/register-number`, { method: 'POST', body: payload }),
  commerceSettings: (accountId, payload) =>
    request(`/whatsapp/accounts/${accountId}/commerce-settings`, { method: 'POST', body: payload }),

  // --------------------------------------------------------------- inbox
  conversations: (params) => request(`/whatsapp/conversations${query(params)}`),
  conversation: (id) => request(`/whatsapp/conversations/${id}`),
  messages: (id, params) => request(`/whatsapp/conversations/${id}/messages${query(params)}`),
  markRead: (id) => request(`/whatsapp/conversations/${id}/read`, { method: 'POST' }),
  updateConversation: (id, patch) =>
    request(`/whatsapp/conversations/${id}`, { method: 'PATCH', body: patch }),
  customers: (search) => request(`/whatsapp/customers${query({ search })}`),

  sendMessage: (payload) => request('/whatsapp/send-message', { method: 'POST', body: payload }),
  sendTemplate: (payload) => request('/whatsapp/send-template', { method: 'POST', body: payload }),
  sendProduct: (payload) => request('/whatsapp/send-product', { method: 'POST', body: payload }),
  sendProductList: (payload) =>
    request('/whatsapp/send-product-list', { method: 'POST', body: payload }),
  sendCatalog: (payload) => request('/whatsapp/send-catalog', { method: 'POST', body: payload }),
  sendMedia: (to, file, { caption, onProgress } = {}) =>
    upload('/whatsapp/send-media', file, { to, caption }, onProgress),
  mediaUrl: (messageId) => `${BASE}/whatsapp/messages/${messageId}/media`,

  // ------------------------------------------------------------- catalog
  catalogOverview: (catalogId) => request(`/catalog${query({ catalogId })}`),
  catalogs: () => request('/catalog/catalogs'),
  discoverCatalogs: (accountId) => request(`/catalog/catalogs/discover${query({ accountId })}`),
  connectCatalog: (payload) => request('/catalog/catalogs/connect', { method: 'POST', body: payload }),
  createCatalog: (payload) => request('/catalog/catalogs', { method: 'POST', body: payload }),
  setDefaultCatalog: (id) => request(`/catalog/catalogs/${id}/default`, { method: 'POST' }),

  // -------------------------------------------------------------- products
  products: (params) => request(`/catalog/products${query(params)}`),
  product: (id) => request(`/catalog/products/${id}`),
  createProduct: (payload) => request('/catalog/products', { method: 'POST', body: payload }),
  updateProduct: (id, payload) =>
    request(`/catalog/products/${id}`, { method: 'PUT', body: payload }),
  publishProduct: (id) => request(`/catalog/products/${id}/publish`, { method: 'POST' }),
  deleteProduct: (id) => request(`/catalog/products/${id}`, { method: 'DELETE' }),
  bulkProducts: (productIds, action) =>
    request('/catalog/products/bulk', { method: 'POST', body: { productIds, action } }),

  uploadProductImage: (id, file, onProgress) =>
    upload(`/catalog/products/${id}/images`, file, {}, onProgress),
  uploadProductVideo: (id, file, onProgress) =>
    upload(`/catalog/products/${id}/videos`, file, {}, onProgress),
  setPrimaryImage: (id, mediaId) =>
    request(`/catalog/products/${id}/images/primary`, { method: 'POST', body: { mediaId } }),
  deleteProductMedia: (id, mediaId) =>
    request(`/catalog/products/${id}/media/${mediaId}`, { method: 'DELETE' }),

  // ------------------------------------------------------------ categories
  categories: (params) => request(`/catalog/categories${query(params)}`),
  createCategory: (payload) => request('/catalog/categories', { method: 'POST', body: payload }),
  updateCategory: (id, payload) =>
    request(`/catalog/categories/${id}`, { method: 'PUT', body: payload }),
  deleteCategory: (id) => request(`/catalog/categories/${id}`, { method: 'DELETE' }),
  assignToCategory: (id, productIds) =>
    request(`/catalog/categories/${id}/products`, { method: 'POST', body: { productIds } }),
  removeFromCategory: (id, productIds) =>
    request(`/catalog/categories/${id}/products/remove`, { method: 'POST', body: { productIds } }),

  // ----------------------------------------------------------- collections
  collections: (catalogId) => request(`/catalog/collections${query({ catalogId })}`),
  collection: (id) => request(`/catalog/collections/${id}`),
  createCollection: (payload) => request('/catalog/collections', { method: 'POST', body: payload }),
  updateCollection: (id, payload) =>
    request(`/catalog/collections/${id}`, { method: 'PUT', body: payload }),
  deleteCollection: (id) => request(`/catalog/collections/${id}`, { method: 'DELETE' }),
  publishCollection: (id) => request(`/catalog/collections/${id}/publish`, { method: 'POST' }),
  addToCollection: (id, productIds) =>
    request(`/catalog/collections/${id}/products`, { method: 'POST', body: { productIds } }),
  removeFromCollection: (id, productIds) =>
    request(`/catalog/collections/${id}/products/remove`, { method: 'POST', body: { productIds } }),

  // ------------------------------------------------------------------ sync
  runSync: (payload) => request('/catalog/sync', { method: 'POST', body: payload }),
  syncHistory: (params) => request(`/catalog/sync/history${query(params)}`),
  syncConflicts: (catalogId) => request(`/catalog/sync/conflicts${query({ catalogId })}`),
  resolveConflict: (productId, resolution) =>
    request(`/catalog/sync/conflicts/${productId}/resolve`, {
      method: 'POST',
      body: { resolution },
    }),

  // ------------------------------------------------------------ automation
  automationStatus: () => request('/automation/status'),
  runAutomationSync: () => request('/automation/sync/run', { method: 'POST' }),
  autoReplyRules: () => request('/automation/auto-reply-rules'),
  createAutoReplyRule: (payload) =>
    request('/automation/auto-reply-rules', { method: 'POST', body: payload }),
  updateAutoReplyRule: (id, payload) =>
    request(`/automation/auto-reply-rules/${id}`, { method: 'PUT', body: payload }),
  deleteAutoReplyRule: (id) =>
    request(`/automation/auto-reply-rules/${id}`, { method: 'DELETE' }),
  resetAutoReplyCooldowns: (id) =>
    request(`/automation/auto-reply-rules/${id}/reset-cooldowns`, { method: 'POST' }),
  previewAutoReply: (text) =>
    request('/automation/auto-reply-rules/preview', { method: 'POST', body: { text } }),

  // ----------------------------------------------------------------- audit
  auditLogs: (params) => request(`/audit-logs${query(params)}`),
};
