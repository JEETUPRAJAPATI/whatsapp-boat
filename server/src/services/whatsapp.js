'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const qrcode = require('qrcode');
const mime = require('mime-types');
const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');

const { serializeMessage, serializeChat, serializeContact, idOf } = require('../utils/serialize');
const store = require('./store');

const STATES = {
  DISCONNECTED: 'DISCONNECTED',
  INITIALIZING: 'INITIALIZING',
  QR: 'QR',
  AUTHENTICATED: 'AUTHENTICATED',
  READY: 'READY',
  AUTH_FAILURE: 'AUTH_FAILURE',
};

const ROOT = path.join(__dirname, '..', '..');
const STORAGE = path.join(ROOT, 'storage');
const MEDIA_DIR = path.join(STORAGE, 'media');
const AVATAR_DIR = path.join(STORAGE, 'avatars');
const UPLOAD_DIR = path.join(STORAGE, 'uploads');

for (const dir of [STORAGE, MEDIA_DIR, AVATAR_DIR, UPLOAD_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Session ids reach the filesystem, so keep them to characters a path allows. */
const safeSegment = (value) => String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * WhatsApp now returns each contact twice on many accounts - once keyed by the
 * phone number and once by its LID alias - and both serialize to the same id.
 * Left in, that doubles the payload and hands React duplicate list keys. Keep
 * the copy whose number actually matches its id; otherwise keep the first.
 */
/**
 * WhatsApp materialises a chat record for plenty of contacts you have never
 * actually written to. They arrive with no last message, no timestamp and
 * nothing unread, and listing them makes the sidebar look like an address book
 * rather than a chat list - WhatsApp's own UI hides them too.
 *
 * All three conditions are required: a real chat that is still mid-sync also
 * has no last message yet, but it carries a timestamp or an unread count.
 */
function isEmptyStub(chat) {
  return !chat.lastMessage && !chat.timestamp && !chat.unreadCount;
}

/** Chat-list projection: everything a sidebar row needs, and nothing else. */
function listShape(chat) {
  const { participants, ...rest } = chat;
  return { ...rest, participantCount: (participants || []).length };
}

function dedupeById(list) {
  const byId = new Map();
  for (const item of list) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const idNumber = item.id.split('@')[0];
    if (existing.number !== idNumber && item.number === idNumber) byId.set(item.id, item);
  }
  return [...byId.values()];
}

class WhatsAppService extends EventEmitter {
  /**
   * One instance drives one linked WhatsApp account. Everything that used to be
   * process-wide (auth profile, media cache, Chrome process) is keyed by
   * sessionId now, so several accounts can run side by side.
   */
  constructor(sessionId, { label = '' } = {}) {
    super();
    this.sessionId = sessionId || 'default';
    this.label = label;
    this.createdAt = Date.now();
    this.mediaDir = path.join(MEDIA_DIR, safeSegment(this.sessionId));
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.client = null;
    this.state = STATES.DISCONNECTED;
    this.qr = null;
    this.qrDataUrl = null;
    this.qrGeneratedAt = null;
    this.me = null;
    this.lastError = null;
    this.loading = { percent: 0, message: '' };
    this.starting = false;
    this.avatarCache = new Map();
    this.mediaIndex = new Map(); // safe message id -> cached file on disk
    this.mediaIndexBuilt = false;
    this.recovering = null;
    this.injectionBroken = false;
    this.lastInjectionCheck = 0;
    this.healthTimer = null;
  }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  puppeteerOptions() {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--window-size=1280,900',
    ];
    const opts = { headless: process.env.WA_HEADLESS !== 'false', args };
    const chrome = (process.env.CHROME_PATH || '').trim();
    // A real Chrome install is more reliable than bundled Chromium on Windows.
    if (chrome && fs.existsSync(chrome)) opts.executablePath = chrome;
    return opts;
  }

  /**
   * whatsapp-web.js drives the real WhatsApp Web app, so a WhatsApp release can
   * break it. Pinning WA_WEB_VERSION serves a known build from the version
   * archive instead of whatever WhatsApp ships today.
   */
  webVersionOptions() {
    const pinned = (process.env.WA_WEB_VERSION || '').trim();
    if (!pinned) return {};
    console.log(`[wa:${this.sessionId}] pinning WhatsApp Web version`, pinned);
    return {
      webVersion: pinned,
      webVersionCache: {
        type: 'remote',
        remotePath:
          process.env.WA_WEB_VERSION_PATH ||
          'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      },
    };
  }

  async initialize() {
    if (this.starting) return this.status();
    if (this.client && this.state === STATES.READY) return this.status();
    this.starting = true;
    this.lastError = null;
    try {
      await this.launchWithRetry();
    } finally {
      this.starting = false;
    }
    return this.status();
  }

  /**
   * WhatsApp Web navigates itself while loading, which can destroy the
   * execution context out from under the library's startup evaluate. That is a
   * race, not a permanent failure, so retry it - but only after the browser is
   * fully gone, because a surviving Chrome keeps the session profile locked and
   * would make every later attempt fail too.
   */
  async launchWithRetry(maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.setState(STATES.INITIALIZING);

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.sessionId,
          dataPath: path.join(ROOT, '.wwebjs_auth'),
        }),
        puppeteer: this.puppeteerOptions(),
        ...this.webVersionOptions(),
        takeoverOnConflict: true,
        takeoverTimeoutMs: 10000,
      });
      this.bindEvents();

      try {
        await this.client.initialize();
        return;
      } catch (err) {
        const message = (err && err.message) || String(err);
        await this.hardDestroy();

        const transient =
          /Execution context was destroyed|Target closed|Session closed|Protocol error|Navigating frame|detached Frame/i.test(
            message
          );
        if (!transient || attempt === maxAttempts) {
          this.lastError = message;
          this.setState(STATES.DISCONNECTED);
          console.error(`[wa:${this.sessionId}] initialize failed:`, message);
          return;
        }
        console.warn(
          `[wa:${this.sessionId}] startup attempt ${attempt}/${maxAttempts} hit a page navigation race - retrying...`
        );
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  /** Closes the client and guarantees the Chrome process is really gone. */
  async hardDestroy() {
    const client = this.client;
    this.client = null;
    if (!client) return;
    const browser = client.pupBrowser;
    try {
      await client.destroy();
    } catch {
      /* destroy itself can fail mid-navigation - fall through to the kill */
    }
    try {
      const proc = browser && browser.process();
      if (proc && proc.exitCode === null) proc.kill('SIGKILL');
    } catch {}
  }

  bindEvents() {
    const c = this.client;

    c.on('qr', async (qr) => {
      this.qr = qr;
      this.qrGeneratedAt = Date.now();
      try {
        this.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
      } catch {
        this.qrDataUrl = null;
      }
      this.setState(STATES.QR);
      this.emit('qr', { dataUrl: this.qrDataUrl, at: this.qrGeneratedAt });
      console.log(`[wa:${this.sessionId}] QR ready - scan from WhatsApp > Linked devices`);
    });

    c.on('loading_screen', (percent, message) => {
      this.loading = { percent: Number(percent) || 0, message: message || '' };
      this.emit('loading', this.loading);
    });

    c.on('authenticated', () => {
      this.qr = null;
      this.qrDataUrl = null;
      this.setState(STATES.AUTHENTICATED);
      console.log(`[wa:${this.sessionId}] authenticated`);
    });

    c.on('auth_failure', (msg) => {
      this.lastError = msg;
      this.setState(STATES.AUTH_FAILURE);
      console.error(`[wa:${this.sessionId}] auth failure:`, msg);
    });

    c.on('ready', async () => {
      this.qr = null;
      this.qrDataUrl = null;
      const info = c.info || {};
      const wid = idOf(info.wid);
      this.me = {
        id: wid,
        number: wid ? wid.split('@')[0] : null,
        pushname: info.pushname || '',
        platform: info.platform || '',
      };
      this.injectionBroken = false;
      await this.applyCompatibilityPatches();
      this.setState(STATES.READY);
      this.emit('ready', this.me);
      console.log(`[wa:${this.sessionId}] ready as`, this.me.pushname, this.me.number);
      this.startHealthCheck();
      // Warm the cache in the background so the first UI paint is instant.
      this.syncAll().catch((e) => console.warn(`[wa:${this.sessionId}] initial sync failed:`, e.message));
    });

    c.on('disconnected', async (reason) => {
      console.warn(`[wa:${this.sessionId}] disconnected:`, reason);
      this.me = null;
      this.setState(STATES.DISCONNECTED);
      this.emit('disconnected', { reason });
      try {
        await c.destroy();
      } catch {}
      this.client = null;
    });

    c.on('change_state', (state) => this.emit('connection_state', { state }));

    // message_create covers incoming AND everything we send (including from the
    // phone), so listening to it alone avoids duplicate events.
    c.on('message_create', async (msg) => {
      try {
        const data = serializeMessage(msg);
        if (!data || !data.chatId) return;
        await store.saveMessage(this.sessionId, data);
        const chat = await this.safeChat(msg);
        if (chat) await store.saveChat(this.sessionId, chat);
        this.emit('message', { message: data, chat: chat ? listShape(chat) : null });
      } catch (err) {
        console.error(`[wa:${this.sessionId}] message_create handler:`, err.message);
      }
    });

    c.on('message_ack', async (msg, ack) => {
      const id = idOf(msg.id);
      if (!id) return;
      await store.updateAck(this.sessionId, id, ack);
      this.emit('ack', { id, chatId: idOf(msg.fromMe ? msg.to : msg.from), ack });
    });

    c.on('message_revoke_everyone', async (_after, before) => {
      const id = before ? idOf(before.id) : null;
      if (!id) return;
      await store.markDeleted(this.sessionId, id);
      this.emit('revoke', { id, chatId: before ? idOf(before.from) : null });
    });

    c.on('message_reaction', (reaction) => {
      const msgId = reaction.msgId || {};
      this.emit('reaction', {
        msgId: idOf(msgId),
        chatId: idOf(msgId.remote) || null,
        senderId: idOf(reaction.senderId),
        reaction: reaction.reaction || '',
        timestamp: reaction.timestamp,
      });
    });

    c.on('message_edit', async (msg, newBody) => {
      const id = idOf(msg.id);
      await store.updateBody(this.sessionId, id, newBody);
      this.emit('edit', { id, body: newBody, chatId: idOf(msg.fromMe ? msg.to : msg.from) });
    });

    c.on('chat_archived', (chat, archived) =>
      this.emit('chat_update', { chat: listShape(serializeChat(chat)), archived })
    );
    c.on('chat_removed', (chat) => this.emit('chat_removed', { id: idOf(chat.id) }));

    for (const evt of ['group_join', 'group_leave', 'group_update']) {
      c.on(evt, () => this.emit('group_event', { event: evt }));
    }

    c.on('contact_changed', () => this.emit('contacts_stale', {}));
  }

  async safeChat(msg) {
    try {
      return serializeChat(await msg.getChat());
    } catch {
      return null;
    }
  }

  setState(state) {
    this.state = state;
    this.emit('state', this.status());
  }

  status() {
    return {
      sessionId: this.sessionId,
      label: this.label,
      state: this.state,
      // A page whose injection could not be repaired is linked but unusable,
      // so it must not report itself as connected.
      connected: this.state === STATES.READY && !this.injectionBroken,
      injectionBroken: this.injectionBroken,
      qr: this.qrDataUrl,
      qrAt: this.qrGeneratedAt,
      me: this.me,
      loading: this.loading,
      error: this.lastError,
    };
  }

  ensureReady() {
    if (!this.client || this.state !== STATES.READY) {
      throw Object.assign(new Error('WhatsApp is not connected. Scan the QR code first.'), {
        status: 409,
      });
    }
    return this.client;
  }

  /**
   * True when the page still carries the helper bundle whatsapp-web.js injects.
   * WhatsApp Web reloads itself periodically; the library re-injects on
   * navigation, but if that re-injection throws, the page is left without
   * window.WWebJS while the client still reports READY. Every call then fails
   * with "Cannot read properties of undefined", so we check and repair.
   */
  async isInjected() {
    const page = this.client && this.client.pupPage;
    if (!page || page.isClosed()) return false;
    // Only WWebJS matters - this library version never defines window.Store,
    // so requiring it here would report a healthy page as broken and trigger
    // endless re-injection.
    return page
      .evaluate(() => typeof window.WWebJS !== 'undefined' && !!window.WWebJS.getChat)
      .catch(() => false);
  }

  static isInjectionError(err) {
    const msg = String((err && err.message) || err || '');
    return (
      msg.includes('Cannot read properties of undefined') ||
      msg.includes('WWebJS is not defined') ||
      msg.includes('Execution context was destroyed') ||
      msg.includes('Target closed') ||
      msg.includes('Session closed')
    );
  }

  /**
   * Replaces whatsapp-web.js's getChatModel with a defensive version.
   *
   * The shipped one feeds chat.lastReceivedKey._serialized straight into an
   * IndexedDB lookup. On WhatsApp Web builds newer than the library targets
   * that value can be undefined, and IndexedDB answers with
   * "DataError: No key or key range specified" - which aborts getChats and
   * getChatById entirely, so no chats and no messages ever load.
   *
   * Same logic, but the parts that depend on WhatsApp internals can no longer
   * take the whole chat list down with them.
   */
  async applyCompatibilityPatches() {
    const page = this.client && this.client.pupPage;
    if (!page || page.isClosed()) return false;

    const applied = await page
      .evaluate(() => {
        if (!window.WWebJS || typeof window.WWebJS.getChatModel !== 'function') return 'unavailable';
        if (window.WWebJS.__boatPatched) return 'already';

        const getMessageModel = window.WWebJS.getMessageModel;

        window.WWebJS.getChatModel = async (chat, { isChannel = false } = {}) => {
          if (!chat) return null;

          const model = chat.serialize();
          model.isGroup = false;
          model.isMuted = chat.mute?.expiration !== 0;

          if (isChannel) {
            try {
              model.isChannel = window.require('WAWebChatGetters').getIsNewsletter(chat);
            } catch {
              model.isChannel = false;
            }
          } else {
            model.formattedTitle = chat.formattedTitle;
          }

          if (chat.groupMetadata) {
            model.isGroup = true;
            try {
              const chatWid = window.require('WAWebWidFactory').createWid(chat.id._serialized);
              const collections = window.require('WAWebCollections');
              const groupMetadata =
                collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
              await groupMetadata.update(chatWid);
            } catch {
              /* stale metadata is fine; the chat still lists */
            }
            try {
              const serialized = chat.groupMetadata.serialize();
              let toPn = null;
              try {
                toPn = window.require('WAWebLidMigrationUtils').toPn;
              } catch {
                toPn = null;
              }
              if (toPn) {
                for (const p of serialized.participants || []) {
                  try {
                    p.id = toPn(p.id) ?? p.id;
                  } catch {
                    /* keep the original id */
                  }
                }
              }
              model.groupMetadata = serialized;
            } catch {
              /* participants stay unresolved rather than failing the chat */
            }
            model.isReadOnly = chat.groupMetadata.announce;
          }

          model.lastMessage = null;
          try {
            const key = chat.lastReceivedKey && chat.lastReceivedKey._serialized;
            if (model.msgs && model.msgs.length && typeof key === 'string' && key) {
              const Msg = window.require('WAWebCollections').Msg;
              let last = Msg.get(key);
              if (!last) {
                const found = await Msg.getMessagesById([key]);
                last = found && found.messages && found.messages[0];
              }
              if (last) model.lastMessage = getMessageModel(last);
            }
            // Fall back to the newest message already loaded in the chat.
            if (!model.lastMessage && chat.msgs && chat.msgs.getModelsArray) {
              const loaded = chat.msgs.getModelsArray();
              const last = loaded && loaded[loaded.length - 1];
              if (last) model.lastMessage = getMessageModel(last);
            }
          } catch {
            /* preview is optional - never let it kill the chat */
          }

          delete model.msgs;
          delete model.msgUnsyncedButtonReplyMsgs;
          delete model.unsyncedButtonReplies;
          return model;
        };

        window.WWebJS.__boatPatched = true;
        return 'applied';
      })
      .catch((e) => {
        console.warn(`[wa:${this.sessionId}] could not apply compatibility patch:`, e.message);
        return 'failed';
      });

    if (applied === 'applied') console.log(`[wa:${this.sessionId}] compatibility patch applied (getChatModel)`);
    return applied === 'applied' || applied === 'already';
  }

  /** Re-runs the library's injection. Concurrent callers share one attempt. */
  async recoverInjection() {
    if (this.recovering) return this.recovering;
    this.recovering = (async () => {
      console.warn(`[wa:${this.sessionId}] page injection lost - re-injecting...`);
      await this.client.inject();
      // A fresh injection replaces WWebJS, so the patch has to go back on.
      await this.applyCompatibilityPatches();
      console.log(`[wa:${this.sessionId}] re-injection succeeded`);
      this.injectionBroken = false;
      this.emit('recovered', {});
    })();
    try {
      await this.recovering;
    } catch (err) {
      this.injectionBroken = true;
      this.lastError = `Re-injection failed: ${err.message || err}`;
      console.error(`[wa:${this.sessionId}]`, this.lastError);
      this.emit('state', this.status());
      throw Object.assign(
        new Error(
          'WhatsApp Web reloaded and this whatsapp-web.js build could not re-attach. ' +
            'Restart the session, or pin WA_WEB_VERSION in server/.env.'
        ),
        { status: 503 }
      );
    } finally {
      this.recovering = null;
    }
  }

  /** ensureReady plus a live-injection guarantee. */
  async ready() {
    const c = this.ensureReady();
    if (Date.now() - this.lastInjectionCheck > 3000) {
      this.lastInjectionCheck = Date.now();
      if (!(await this.isInjected())) await this.recoverInjection();
    }
    return c;
  }

  /** Runs fn, repairing the page once if it fails because injection was lost. */
  async guard(fn) {
    const c = await this.ready();
    try {
      return await fn(c);
    } catch (err) {
      if (!WhatsAppService.isInjectionError(err)) throw err;
      await this.recoverInjection();
      return fn(this.client);
    }
  }

  /** Background watchdog so a broken page is noticed before the user hits it. */
  startHealthCheck() {
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(async () => {
      if (!this.client || this.state !== STATES.READY) return;
      try {
        if (!(await this.isInjected())) await this.recoverInjection();
      } catch {
        /* recoverInjection already recorded the failure */
      }
    }, 30000);
    this.healthTimer.unref?.();
  }

  async logout() {
    clearInterval(this.healthTimer);
    this.healthTimer = null;
    if (!this.client) return { ok: true };
    try {
      await this.client.logout();
    } catch (e) {
      console.warn(`[wa:${this.sessionId}] logout:`, e.message);
    }
    try {
      await this.client.destroy();
    } catch {}
    this.client = null;
    this.me = null;
    this.qr = null;
    this.qrDataUrl = null;
    this.avatarCache.clear();
    this.setState(STATES.DISCONNECTED);
    return { ok: true };
  }

  async restart() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {}
      this.client = null;
    }
    this.setState(STATES.DISCONNECTED);
    return this.initialize();
  }

  /* ---------------------------------------------------------------- */
  /* reads                                                             */
  /* ---------------------------------------------------------------- */

  async getChats() {
    return this.guard(async (c) => {
      const chats = await c.getChats();
      const data = chats.map(serializeChat).filter(Boolean).filter((x) => !isEmptyStub(x));
      store.saveChats(this.sessionId, data).catch(() => {});
      return data.map(listShape);
    });
  }

  async getChatById(chatId) {
    const c = await this.ready();
    return serializeChat(await c.getChatById(chatId));
  }

  async getContacts() {
    return this.guard(async (c) => {
      const contacts = await c.getContacts();
      const data = dedupeById(
        contacts
          .map(serializeContact)
          .filter((x) => x && x.id && !x.isMe)
          // Keep real people and groups; drop broadcast/status pseudo-entries.
          .filter((x) => x.id.endsWith('@c.us') || x.id.endsWith('@g.us') || x.id.endsWith('@lid'))
      ).sort((a, b) => {
        if (a.isMyContact !== b.isMyContact) return a.isMyContact ? -1 : 1;
        return (a.displayName || '').localeCompare(b.displayName || '');
      });
      store.saveContacts(this.sessionId, data).catch(() => {});
      return data;
    });
  }

  /**
   * whatsapp-web.js has no cursor pagination, so "load older" re-fetches a
   * bigger window and returns the slice the client has not seen yet.
   */
  async getMessages(chatId, { limit = 50, offset = 0 } = {}) {
    return this.guard(async (c) => {
      // getChatById resolves to undefined for a contact you have never messaged -
      // an empty thread, not an error. Real failures must still propagate, or the
      // UI silently shows "No messages yet" when something is actually broken.
      const chat = await c.getChatById(chatId);
      if (!chat) return { messages: [], hasMore: false, total: 0, isNew: true };
      const window = Math.min(Number(limit) + Number(offset), 2000);
      const msgs = await chat.fetchMessages({ limit: window });
      const all = msgs.map(serializeMessage).filter(Boolean);
      store.saveMessages(this.sessionId, all).catch(() => {});
      const end = all.length - Number(offset);
      const start = Math.max(0, end - Number(limit));
      return {
        messages: end > 0 ? all.slice(start, end) : [],
        hasMore: start > 0,
        total: all.length,
      };
    });
  }

  async searchMessages(query, { chatId = null, limit = 50 } = {}) {
    const c = await this.ready();
    const opts = { limit: Number(limit) };
    if (chatId) opts.chatId = chatId;
    const msgs = await c.searchMessages(query, opts);
    return msgs.map(serializeMessage).filter(Boolean);
  }

  async getProfilePicUrl(contactId) {
    const c = await this.ready();
    const cached = this.avatarCache.get(contactId);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.url;
    let url = null;
    try {
      url = (await c.getProfilePicUrl(contactId)) || null;
    } catch {
      url = null; // privacy settings, or no photo set
    }
    this.avatarCache.set(contactId, { url, at: Date.now() });
    return url;
  }

  async getContactInfo(contactId) {
    const c = await this.ready();
    const contact = await c.getContactById(contactId);
    const data = serializeContact(contact);
    try {
      data.about = await contact.getAbout();
    } catch {
      data.about = null;
    }
    data.profilePicUrl = await this.getProfilePicUrl(contactId);
    try {
      const groups = await contact.getCommonGroups();
      data.commonGroups = groups.map((g) => idOf(g)).filter(Boolean);
    } catch {
      data.commonGroups = [];
    }
    return data;
  }

  /** Downloads media once and caches it on disk keyed by message id. */
  async getMedia(messageId) {
    const c = await this.ready();
    const safeId = messageId.replace(/[^a-zA-Z0-9_.-]/g, '_');

    const cachedPath = this.mediaIndex.get(safeId);
    if (cachedPath && fs.existsSync(cachedPath)) {
      return { filePath: cachedPath, mimetype: mime.lookup(cachedPath) || 'application/octet-stream' };
    }
    // Index misses only cost one directory scan per server start.
    if (!this.mediaIndexBuilt) {
      for (const file of fs.readdirSync(this.mediaDir)) {
        const dot = file.lastIndexOf('.');
        if (dot > 0) this.mediaIndex.set(file.slice(0, dot), path.join(this.mediaDir, file));
      }
      this.mediaIndexBuilt = true;
      const found = this.mediaIndex.get(safeId);
      if (found) {
        return { filePath: found, mimetype: mime.lookup(found) || 'application/octet-stream' };
      }
    }

    const msg = await c.getMessageById(messageId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    if (!msg.hasMedia) throw Object.assign(new Error('Message has no media'), { status: 400 });

    const media = await msg.downloadMedia();
    if (!media || !media.data) {
      throw Object.assign(new Error('Media is no longer available'), { status: 410 });
    }
    const ext = mime.extension(media.mimetype) || 'bin';
    const filePath = path.join(this.mediaDir, `${safeId}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
    this.mediaIndex.set(safeId, filePath);
    store
      .updateMedia(this.sessionId, messageId, {
        mediaMime: media.mimetype,
        mediaFilename: media.filename || path.basename(filePath),
        mediaPath: filePath,
      })
      .catch(() => {});
    return { filePath, mimetype: media.mimetype, filename: media.filename };
  }

  /* ---------------------------------------------------------------- */
  /* writes                                                            */
  /* ---------------------------------------------------------------- */

  buildSendOptions(o = {}) {
    const options = {};
    if (o.quotedMessageId) options.quotedMessageId = o.quotedMessageId;
    if (Array.isArray(o.mentions) && o.mentions.length) options.mentions = o.mentions;
    if (o.caption) options.caption = o.caption;
    if (o.sendAudioAsVoice) options.sendAudioAsVoice = true;
    if (o.sendMediaAsDocument) options.sendMediaAsDocument = true;
    if (o.sendMediaAsSticker) options.sendMediaAsSticker = true;
    if (o.linkPreview === false) options.linkPreview = false;
    return options;
  }

  /**
   * The library sends the message, then looks the model back up by key. On
   * WhatsApp Web builds newer than it targets that lookup can miss even though
   * the message really went out - so a missing model means "sent, unconfirmed",
   * never "failed". message_create delivers the real message moments later.
   */
  async sendText(chatId, text, opts = {}) {
    return this.guard(async (c) => {
      const msg = await c.sendMessage(chatId, text, this.buildSendOptions(opts));
      return serializeMessage(msg);
    });
  }

  async sendFile(chatId, { filePath, base64, mimetype, filename }, opts = {}) {
    const c = await this.ready();
    const media = filePath
      ? MessageMedia.fromFilePath(filePath)
      : new MessageMedia(mimetype, base64, filename);
    if (filename) media.filename = filename;
    const msg = await c.sendMessage(chatId, media, this.buildSendOptions(opts));
    return serializeMessage(msg);
  }

  async sendLocation(chatId, { latitude, longitude, description }, opts = {}) {
    const c = await this.ready();
    const loc = new Location(Number(latitude), Number(longitude), description || undefined);
    const msg = await c.sendMessage(chatId, loc, this.buildSendOptions(opts));
    return serializeMessage(msg);
  }

  async forwardMessage(messageId, toChatId) {
    const c = await this.ready();
    const msg = await c.getMessageById(messageId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    await msg.forward(await c.getChatById(toChatId));
    return { ok: true };
  }

  async deleteMessage(messageId, everyone = false) {
    const c = await this.ready();
    const msg = await c.getMessageById(messageId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    await msg.delete(!!everyone);
    await store.markDeleted(this.sessionId, messageId);
    return { ok: true };
  }

  async starMessage(messageId, star = true) {
    const c = await this.ready();
    const msg = await c.getMessageById(messageId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    if (star) await msg.star();
    else await msg.unstar();
    return { ok: true };
  }

  async reactToMessage(messageId, emoji) {
    const c = await this.ready();
    const msg = await c.getMessageById(messageId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    await msg.react(emoji || '');
    return { ok: true };
  }

  async editMessage(messageId, newBody) {
    const c = await this.ready();
    const msg = await c.getMessageById(messageId);
    if (!msg) throw Object.assign(new Error('Message not found'), { status: 404 });
    const updated = await msg.edit(newBody);
    return serializeMessage(updated || msg);
  }

  async sendSeen(chatId) {
    return this.guard(async (c) => {
      const chat = await c.getChatById(chatId);
      if (!chat) return { ok: true, skipped: 'no chat yet' };
      await chat.sendSeen();
      store.setUnread(this.sessionId, chatId, 0).catch(() => {});
      return { ok: true };
    });
  }

  async setTyping(chatId, mode = 'typing') {
    const c = await this.ready();
    const chat = await c.getChatById(chatId);
    if (mode === 'typing') await chat.sendStateTyping();
    else if (mode === 'recording') await chat.sendStateRecording();
    else await chat.clearState();
    return { ok: true };
  }

  async chatAction(chatId, action, value) {
    const c = await this.ready();
    const chat = await c.getChatById(chatId);
    switch (action) {
      case 'archive':
        if (value) await chat.archive();
        else await chat.unarchive();
        break;
      case 'pin':
        if (value) await chat.pin();
        else await chat.unpin();
        break;
      case 'mute':
        // value = unix seconds to mute until; falsy unmutes.
        if (value) await chat.mute(new Date(Number(value) * 1000));
        else await chat.unmute();
        break;
      case 'markUnread':
        await chat.markUnread();
        break;
      case 'clear':
        await chat.clearMessages();
        break;
      case 'delete':
        await chat.delete();
        return { ok: true, deleted: true };
      default:
        throw Object.assign(new Error(`Unknown chat action: ${action}`), { status: 400 });
    }
    const fresh = await c.getChatById(chatId).catch(() => null);
    return { ok: true, chat: fresh ? serializeChat(fresh) : null };
  }

  /** Resolves a raw phone number to a WhatsApp id, or null if not registered. */
  async resolveNumber(number) {
    const c = await this.ready();
    const clean = String(number).replace(/[^0-9]/g, '');
    if (!clean) return null;
    const wid = await c.getNumberId(clean);
    return wid ? idOf(wid) : null;
  }

  async createGroup(name, participantIds) {
    const c = await this.ready();
    const result = await c.createGroup(name, participantIds);
    return typeof result === 'string' ? { gid: result } : { gid: idOf(result.gid) };
  }

  /**
   * Reports what the WhatsApp Web page actually exposes. When the library and
   * WhatsApp disagree, this names the missing piece instead of leaving a
   * minified one-letter error.
   */
  async diagnostics() {
    const out = {
      state: this.state,
      injectionBroken: this.injectionBroken,
      lastError: this.lastError,
      pinnedWebVersion: (process.env.WA_WEB_VERSION || '').trim() || null,
      libraryVersion: require('whatsapp-web.js/package.json').version,
      libraryTargetsWebVersion: require('whatsapp-web.js/src/util/Constants').DefaultOptions
        .webVersion,
    };
    const page = this.client && this.client.pupPage;
    if (!page || page.isClosed()) return { ...out, page: 'closed' };

    out.liveWebVersion = await page.evaluate(() => window.Debug?.VERSION).catch(() => null);
    out.hasWWebJS = await page.evaluate(() => typeof window.WWebJS !== 'undefined').catch(() => false);
    out.hasStore = await page.evaluate(() => typeof window.Store !== 'undefined').catch(() => false);

    // These are the internal modules the chat/contact code paths depend on.
    const modules = [
      'WAWebCollections',
      'WAWebWidFactory',
      'WAWebFindChatAction',
      'WAWebLidMigrationUtils',
      'WAWebChatGetters',
      'WAWebSocketModel',
    ];
    out.modules = await page
      .evaluate((names) => {
        const result = {};
        for (const name of names) {
          try {
            result[name] = window.require(name) ? 'ok' : 'undefined';
          } catch (err) {
            result[name] = `throws: ${err && err.message ? err.message : String(err)}`;
          }
        }
        return result;
      }, modules)
      .catch((e) => ({ error: e.message }));

    // Probe the exact call that fails, and report the real reason.
    out.getChatsProbe = await page
      .evaluate(async () => {
        try {
          const chats = window.require('WAWebCollections').Chat.getModelsArray();
          const sample = chats[0];
          if (!sample) return { count: 0, note: 'no chats in collection' };
          await window.WWebJS.getChatModel(sample);
          return { count: chats.length, modelOk: true };
        } catch (err) {
          return {
            failedWith: (err && err.message) || String(err),
            stack: (err && err.stack ? String(err.stack) : '').split('\n').slice(0, 4).join(' | '),
          };
        }
      })
      .catch((e) => ({ error: e.message }));

    return out;
  }

  async syncAll() {
    const [chats, contacts] = await Promise.all([
      this.getChats().catch(() => []),
      this.getContacts().catch(() => []),
    ]);
    this.emit('synced', { chats: chats.length, contacts: contacts.length });
    return { chats: chats.length, contacts: contacts.length };
  }
}

module.exports = { WhatsAppService, STATES, MEDIA_DIR, UPLOAD_DIR, AVATAR_DIR, ROOT, safeSegment };
