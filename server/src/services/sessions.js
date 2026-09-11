'use strict';

/**
 * Owns every linked WhatsApp account.
 *
 * Each account is one WhatsAppService instance driving its own Chrome profile
 * under .wwebjs_auth/session-<sessionId>. The manager is the only thing that
 * creates, finds or destroys them, and it re-emits every service event with the
 * sessionId attached so the socket layer can fan events out per account.
 *
 * Startup is serialised on purpose: each account launches a real browser, and
 * booting five of them at once on a laptop is what makes WhatsApp Web time out.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const { WhatsAppService, STATES, ROOT, safeSegment, MEDIA_DIR, UPLOAD_DIR } = require('./whatsapp');
const store = require('./store');
const Account = require('../models/Account');
const { isConnected } = require('../config/db');

const AUTH_ROOT = path.join(ROOT, '.wwebjs_auth');

/** Events a service emits that get forwarded to listeners with the session id. */
const FORWARDED = [
  'state',
  'qr',
  'ready',
  'loading',
  'disconnected',
  'message',
  'ack',
  'revoke',
  'reaction',
  'edit',
  'chat_update',
  'chat_removed',
  'group_event',
  'synced',
  'connection_state',
  'recovered',
];

function newSessionId() {
  return `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.services = new Map(); // sessionId -> WhatsAppService
    this.meta = new Map(); // sessionId -> { label, linked, createdAt, order }
    this.bootQueue = Promise.resolve();
  }

  /* ---------------------------------------------------------------- */
  /* lookup                                                            */
  /* ---------------------------------------------------------------- */

  has(sessionId) {
    return this.services.has(sessionId);
  }

  /** Throws a 404 rather than returning undefined, so routes stay short. */
  get(sessionId) {
    const service = this.services.get(sessionId);
    if (!service) {
      throw Object.assign(new Error(`No such WhatsApp account: ${sessionId}`), { status: 404 });
    }
    return service;
  }

  describe(service) {
    const meta = this.meta.get(service.sessionId) || {};
    return {
      ...service.status(),
      label: meta.label || service.label || '',
      linked: !!meta.linked,
      createdAt: meta.createdAt || service.createdAt,
      order: meta.order || 0,
    };
  }

  list() {
    return [...this.services.values()]
      .map((s) => this.describe(s))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Registers a service for a session id and wires its events. Does not start
   * the browser - callers decide when to do that.
   */
  attach(sessionId, { label = '', linked = false, createdAt = Date.now(), order = 0 } = {}) {
    if (this.services.has(sessionId)) return this.services.get(sessionId);

    const service = new WhatsAppService(sessionId, { label });
    this.meta.set(sessionId, { label, linked, createdAt, order });

    for (const event of FORWARDED) {
      service.on(event, (payload) => {
        this.emit(event, { ...(payload || {}), sessionId });
        this.emit('any', { event, sessionId, payload });
      });
    }

    // A successful link is the moment the account becomes worth restoring on
    // the next boot, so record the identity then.
    service.on('ready', (me) => {
      const meta = this.meta.get(sessionId) || {};
      meta.linked = true;
      if (!meta.label && me && (me.pushname || me.number)) {
        meta.label = me.pushname || `+${me.number}`;
        service.label = meta.label;
      }
      this.meta.set(sessionId, meta);
      this.persist(sessionId, {
        linked: true,
        label: meta.label || '',
        number: me ? me.number : null,
        pushname: me ? me.pushname : null,
        wid: me ? me.id : null,
        lastReadyAt: new Date(),
      });
      this.emit('accounts', this.list());
    });

    service.on('state', () => this.emit('accounts', this.list()));

    this.services.set(sessionId, service);
    return service;
  }

  async persist(sessionId, fields) {
    if (!isConnected()) return;
    try {
      await Account.updateOne({ sessionId }, { $set: { sessionId, ...fields } }, { upsert: true });
    } catch (e) {
      console.warn('[sessions] persist:', e.message);
    }
  }

  /**
   * Creates a brand new account and starts linking it. Returns as soon as the
   * browser is launching - the QR arrives over the socket moments later, so the
   * UI can open its dialog immediately instead of waiting on Chrome.
   */
  async create({ label = '' } = {}) {
    const sessionId = newSessionId();
    const order = this.services.size;
    const service = this.attach(sessionId, { label, linked: false, order });
    await this.persist(sessionId, { label, linked: false, order });

    // Deliberately not awaited: initialize() only resolves once WhatsApp Web is
    // up, which is far longer than a request should hang for.
    service.initialize().catch((err) => {
      console.error(`[sessions] ${sessionId} failed to start:`, err.message);
    });

    this.emit('accounts', this.list());
    return this.describe(service);
  }

  /** Brings an existing but stopped account back up. */
  async start(sessionId) {
    const service = this.get(sessionId);
    service.initialize().catch((err) => {
      console.error(`[sessions] ${sessionId} failed to start:`, err.message);
    });
    return this.describe(service);
  }

  async restart(sessionId) {
    const service = this.get(sessionId);
    await service.restart();
    return this.describe(service);
  }

  async logout(sessionId) {
    const service = this.get(sessionId);
    await service.logout();
    const meta = this.meta.get(sessionId) || {};
    meta.linked = false;
    this.meta.set(sessionId, meta);
    await this.persist(sessionId, { linked: false });
    this.emit('accounts', this.list());
    return this.describe(service);
  }

  /**
   * Unlinks an account and forgets it entirely: WhatsApp logout, browser gone,
   * auth profile deleted, cached media deleted, database rows purged.
   */
  async remove(sessionId, { purge = true } = {}) {
    const service = this.services.get(sessionId);
    if (service) {
      try {
        await service.logout();
      } catch (e) {
        console.warn(`[sessions] ${sessionId} logout during remove:`, e.message);
      }
      await service.hardDestroy();
      clearInterval(service.healthTimer);
      service.removeAllListeners();
      this.services.delete(sessionId);
    }
    this.meta.delete(sessionId);

    // LocalAuth stores the Chrome profile as session-<clientId>.
    for (const dir of [
      path.join(AUTH_ROOT, `session-${sessionId}`),
      path.join(MEDIA_DIR, safeSegment(sessionId)),
    ]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[sessions] could not remove ${dir}:`, e.message);
      }
    }

    if (purge) await store.purgeSession(sessionId);
    if (isConnected()) {
      try {
        await Account.deleteOne({ sessionId });
      } catch (e) {
        console.warn('[sessions] delete account row:', e.message);
      }
    }

    this.emit('accounts', this.list());
    return { ok: true, sessionId };
  }

  async rename(sessionId, label) {
    const service = this.get(sessionId);
    const meta = this.meta.get(sessionId) || {};
    meta.label = label || '';
    service.label = meta.label;
    this.meta.set(sessionId, meta);
    await this.persist(sessionId, { label: meta.label });
    this.emit('accounts', this.list());
    return this.describe(service);
  }

  /* ---------------------------------------------------------------- */
  /* boot                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Rebuilds the account list after a restart. Accounts that were linked are
   * started one at a time; accounts that never finished linking are registered
   * but left stopped, so a half-finished add does not spawn a browser forever.
   */
  async restore() {
    const rows = await this.loadRows();
    if (!rows.length) {
      console.log('[sessions] no saved accounts - add one from the UI');
      return [];
    }

    for (const row of rows) {
      this.attach(row.sessionId, {
        label: row.label || '',
        linked: !!row.linked,
        createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
        order: row.order || 0,
      });
      const service = this.services.get(row.sessionId);
      if (row.number) {
        // Show the last known identity while the browser is still coming up.
        service.me = { id: row.wid, number: row.number, pushname: row.pushname || '', platform: '' };
      }
    }

    const toStart = rows.filter((r) => r.linked);
    console.log(`[sessions] restoring ${toStart.length} linked account(s)`);
    this.bootQueue = toStart.reduce(
      (chain, row) =>
        chain.then(async () => {
          try {
            await this.services.get(row.sessionId).initialize();
          } catch (err) {
            console.error(`[sessions] ${row.sessionId} restore failed:`, err.message);
          }
        }),
      Promise.resolve()
    );
    this.bootQueue.catch(() => {});

    this.emit('accounts', this.list());
    return this.list();
  }

  /**
   * Account rows come from Mongo when it is available. Without a database the
   * auth folders on disk are still a complete record of what was linked, so the
   * app keeps its accounts across restarts either way.
   */
  async loadRows() {
    if (isConnected()) {
      try {
        const rows = await Account.find({}).sort({ order: 1, createdAt: 1 }).lean();
        if (rows.length) return rows;
      } catch (e) {
        console.warn('[sessions] could not read accounts:', e.message);
      }
    }
    try {
      if (!fs.existsSync(AUTH_ROOT)) return [];
      return fs
        .readdirSync(AUTH_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('session-'))
        .map((d, i) => ({ sessionId: d.name.slice('session-'.length), linked: true, order: i }));
    } catch {
      return [];
    }
  }

  /** Closes every browser - called on process shutdown. */
  async shutdown() {
    await Promise.all(
      [...this.services.values()].map(async (service) => {
        clearInterval(service.healthTimer);
        await service.hardDestroy().catch(() => {});
      })
    );
  }

  /** Cheap summary for /health. */
  summary() {
    const list = this.list();
    return {
      accounts: list.length,
      connected: list.filter((a) => a.connected).length,
    };
  }
}

const manager = new SessionManager();
manager.STATES = STATES;
manager.UPLOAD_DIR = UPLOAD_DIR;

module.exports = manager;
