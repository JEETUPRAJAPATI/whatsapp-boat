import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { accountApi, accountsApi, avatarUrl as avatarUrlFor, mediaUrl as mediaUrlFor } from './lib/api';

const WaContext = createContext(null);
export const useWa = () => useContext(WaContext);

const PAGE = 50;
const ACTIVE_KEY = 'wa-boat:active-account';

/** Per-account slice of everything the chat UI renders. */
const EMPTY_DATA = { chats: [], contacts: [], threads: {}, activeChatId: null, loadedOnce: false };

/** Newest-last ordering, pinned chats floated to the top like WhatsApp does. */
function sortChats(list) {
  return [...list].sort((a, b) => {
    if (!!a.isPinned !== !!b.isPinned) return a.isPinned ? -1 : 1;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
}

function upsertMessage(list, message) {
  if (!message || !message.id) return list;
  const idx = list.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...message };
    return next;
  }
  // Drop the optimistic placeholder this real message replaces.
  const withoutTemp = list.filter(
    (m) => !(m.pending && m.fromMe && m.body === message.body && message.fromMe)
  );
  const next = [...withoutTemp, message];
  next.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return next;
}

export function WaProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [activeId, setActiveId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) || null;
    } catch {
      return null;
    }
  });
  // sessionId -> EMPTY_DATA shape. Keeping every account's chats in memory is
  // what lets the switcher show live unread badges for accounts you are not
  // currently looking at, and makes switching back instant.
  const [data, setData] = useState({});
  const [socketLive, setSocketLive] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [toast, setToast] = useState(null);
  const [replyTo, setReplyTo] = useState(null);

  const socketRef = useRef(null);
  // Accounts whose chats / contacts have already been fetched once.
  const readySeen = useRef(new Set());
  const contactsSeen = useRef(new Set());
  const dataRef = useRef(data);
  dataRef.current = data;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, at: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.at >= 3400 ? null : t)), 3500);
  }, []);

  /** Updates one account's slice without touching the others. */
  const patch = useCallback((sessionId, fn) => {
    if (!sessionId) return;
    setData((d) => {
      const current = d[sessionId] || EMPTY_DATA;
      const next = fn(current);
      return next === current ? d : { ...d, [sessionId]: next };
    });
  }, []);

  const sliceOf = useCallback((sessionId) => dataRef.current[sessionId] || EMPTY_DATA, []);

  /* ---------------------------------------------------------------- */
  /* accounts                                                          */
  /* ---------------------------------------------------------------- */

  const applyAccounts = useCallback((list) => {
    const next = Array.isArray(list) ? list : [];
    setAccounts(next);
    setAccountsLoaded(true);
    // Keep a valid selection: fall back to the first connected account, then to
    // whatever exists, so the UI never points at an account that was removed.
    setActiveId((current) => {
      if (current && next.some((a) => a.sessionId === current)) return current;
      const ready = next.find((a) => a.connected) || next[0];
      return ready ? ready.sessionId : null;
    });
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const { accounts: list } = await accountsApi.list();
      applyAccounts(list);
      return list;
    } catch (err) {
      notify(err.message, 'error');
      setAccountsLoaded(true);
      return [];
    }
  }, [applyAccounts, notify]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* private browsing - the selection is just not remembered */
    }
  }, [activeId]);

  const account = useMemo(
    () => accounts.find((a) => a.sessionId === activeId) || null,
    [accounts, activeId]
  );
  const api = useMemo(() => accountApi(activeId), [activeId]);

  const addAccount = useCallback(
    async (label) => {
      const { account: created } = await accountsApi.create(label || '');
      await refreshAccounts();
      setActiveId(created.sessionId);
      return created;
    },
    [refreshAccounts]
  );

  const removeAccount = useCallback(
    async (sessionId, opts) => {
      try {
        await accountsApi.remove(sessionId, opts);
        setData((d) => {
          const next = { ...d };
          delete next[sessionId];
          return next;
        });
        await refreshAccounts();
        notify('Account removed');
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [refreshAccounts, notify]
  );

  const renameAccount = useCallback(
    async (sessionId, label) => {
      try {
        await accountsApi.rename(sessionId, label);
        await refreshAccounts();
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [refreshAccounts, notify]
  );

  const restartAccount = useCallback(
    async (sessionId) => {
      try {
        await accountsApi.restart(sessionId);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify]
  );

  const startAccount = useCallback(
    async (sessionId) => {
      try {
        await accountsApi.start(sessionId);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify]
  );

  /* ---------------------------------------------------------------- */
  /* loaders                                                           */
  /* ---------------------------------------------------------------- */

  const loadChats = useCallback(
    async (sessionId = activeIdRef.current) => {
      if (!sessionId) return;
      const scoped = accountApi(sessionId);
      if (sessionId === activeIdRef.current) setLoadingChats(true);

      // Paint the last known list first. On an account with thousands of chats
      // the live fetch waits behind WhatsApp's own initial sync, and staring at
      // a spinner for a minute is worse than a list that is a few minutes old.
      let painted = false;
      try {
        const { chats: cached } = await scoped.chats({ preferCache: true });
        if (cached && cached.length) {
          painted = true;
          patch(sessionId, (s) =>
            s.chats.length ? s : { ...s, chats: sortChats(cached), fromCache: true }
          );
          if (sessionId === activeIdRef.current) setLoadingChats(false);
        }
      } catch {
        /* no cache yet - the live fetch below is the only source */
      }

      try {
        const { chats: list } = await scoped.chats();
        patch(sessionId, (s) => ({
          ...s,
          chats: sortChats(list || []),
          loadedOnce: true,
          fromCache: false,
        }));
      } catch (err) {
        if (!painted && err.status !== 409 && err.status !== 404) notify(err.message, 'error');
      } finally {
        if (sessionId === activeIdRef.current) setLoadingChats(false);
      }
    },
    [patch, notify]
  );

  const loadContacts = useCallback(
    async (sessionId = activeIdRef.current) => {
      if (!sessionId) return;
      const scoped = accountApi(sessionId);
      try {
        const { contacts: cached } = await scoped.contacts({ preferCache: true });
        if (cached && cached.length) {
          patch(sessionId, (s) => (s.contacts.length ? s : { ...s, contacts: cached }));
        }
      } catch {
        /* no cache yet */
      }
      try {
        const { contacts: list } = await scoped.contacts();
        patch(sessionId, (s) => ({ ...s, contacts: list || [] }));
      } catch (err) {
        // Leaving the set marked as loaded would strand the tab on zero, so let
        // a later switch or a manual sync try again.
        contactsSeen.current.delete(sessionId);
        if (err.status !== 409 && err.status !== 404) notify(err.message, 'error');
      }
    },
    [patch, notify]
  );

  const loadMessages = useCallback(
    async (chatId, { older = false, sessionId = activeIdRef.current } = {}) => {
      if (!chatId || !sessionId) return;
      const current = sliceOf(sessionId).threads[chatId];
      if (older && (!current || current.loading || !current.hasMore)) return;
      const offset = older && current ? current.items.length : 0;

      patch(sessionId, (s) => ({
        ...s,
        threads: {
          ...s.threads,
          [chatId]: { items: [], hasMore: false, ...(s.threads[chatId] || {}), loading: true },
        },
      }));
      try {
        const res = await accountApi(sessionId).messages(chatId, { limit: PAGE, offset });
        patch(sessionId, (s) => {
          const prev = s.threads[chatId] || { items: [] };
          const incoming = res.messages || [];
          const merged = older
            ? [...incoming, ...prev.items.filter((m) => !incoming.some((i) => i.id === m.id))]
            : incoming;
          return {
            ...s,
            threads: {
              ...s.threads,
              [chatId]: { items: merged, hasMore: !!res.hasMore, loading: false, loaded: true },
            },
          };
        });
      } catch (err) {
        patch(sessionId, (s) => ({
          ...s,
          threads: {
            ...s.threads,
            [chatId]: { ...(s.threads[chatId] || { items: [] }), loading: false },
          },
        }));
        if (err.status !== 409 && err.status !== 404) notify(err.message, 'error');
      }
    },
    [patch, notify, sliceOf]
  );

  const selectChat = useCallback(
    async (chatId) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      patch(sessionId, (s) => ({ ...s, activeChatId: chatId }));
      setReplyTo(null);
      if (!chatId) return;
      const thread = sliceOf(sessionId).threads[chatId];
      if (!thread || !thread.loaded) await loadMessages(chatId, { sessionId });
      patch(sessionId, (s) => ({
        ...s,
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)),
      }));
      accountApi(sessionId).markSeen(chatId).catch(() => {});
    },
    [patch, loadMessages, sliceOf]
  );

  /**
   * Switching accounts keeps the other account's data in memory, so coming back
   * is instant. Only a never-loaded account triggers a fetch.
   */
  const selectAccount = useCallback(
    (sessionId) => {
      setActiveId(sessionId);
      setReplyTo(null);
      const slice = dataRef.current[sessionId];
      const target = accounts.find((a) => a.sessionId === sessionId);
      if (target && target.connected && (!slice || !slice.loadedOnce)) loadChats(sessionId);
    },
    [accounts, loadChats]
  );

  /**
   * Opens a chat for a contact that may not have one yet - WhatsApp creates the
   * thread lazily, so an empty thread is a valid starting point.
   */
  const openChatWithContact = useCallback(
    async (contact) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      const chatId = contact.id;
      patch(sessionId, (s) => {
        if (s.chats.some((c) => c.id === chatId)) return s;
        const stub = {
          id: chatId,
          name: contact.displayName || contact.name || contact.number,
          isGroup: !!contact.isGroup,
          unreadCount: 0,
          timestamp: Math.floor(Date.now() / 1000),
          lastMessage: null,
          isNew: true,
        };
        return { ...s, chats: sortChats([stub, ...s.chats]) };
      });
      await selectChat(chatId);
    },
    [patch, selectChat]
  );

  /**
   * Opens a chat with a raw phone number, whether or not it is in the address
   * book. Returns the resolved WhatsApp id, or null when the number is not on
   * WhatsApp.
   */
  const openChatWithNumber = useCallback(
    async (raw) => {
      const sessionId = activeIdRef.current;
      const clean = String(raw || '').replace(/[^0-9]/g, '');
      if (!sessionId || clean.length < 8) return null;
      try {
        const { id, registered } = await accountApi(sessionId).resolveNumber(clean);
        if (!registered || !id) {
          notify('That number is not registered on WhatsApp', 'error');
          return null;
        }
        await openChatWithContact({ id, displayName: `+${clean}`, number: clean });
        return id;
      } catch (err) {
        notify(err.message, 'error');
        return null;
      }
    },
    [openChatWithContact, notify]
  );

  /* ---------------------------------------------------------------- */
  /* socket                                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setSocketLive(true));
    socket.on('disconnect', () => setSocketLive(false));

    // The server pushes the whole account list whenever any account's state
    // changes, so the switcher, the QR dialog and the badges all stay in sync
    // from one event.
    socket.on('wa:accounts', (list) => applyAccounts(list));

    socket.on('wa:qr', ({ sessionId, dataUrl }) => {
      setAccounts((list) =>
        list.map((a) =>
          a.sessionId === sessionId ? { ...a, state: 'QR', qr: dataUrl, connected: false } : a
        )
      );
    });

    socket.on('wa:loading', ({ sessionId, ...loading }) => {
      setAccounts((list) =>
        list.map((a) => (a.sessionId === sessionId ? { ...a, loading } : a))
      );
    });

    socket.on('wa:message', ({ sessionId, message, chat }) => {
      if (!sessionId || !message || !message.chatId) return;
      const chatId = message.chatId;
      const isActiveChat =
        activeIdRef.current === sessionId &&
        (dataRef.current[sessionId] || EMPTY_DATA).activeChatId === chatId;

      patch(sessionId, (s) => {
        const thread = s.threads[chatId];
        // Only append to threads that have actually been opened; the rest
        // reload on demand.
        const threads =
          thread && thread.loaded
            ? { ...s.threads, [chatId]: { ...thread, items: upsertMessage(thread.items, message) } }
            : s.threads;

        const existing = s.chats.find((c) => c.id === chatId);
        const base = existing || {
          id: chatId,
          name: (chat && chat.name) || message.notifyName || chatId.split('@')[0],
          isGroup: chatId.endsWith('@g.us'),
        };
        const unread = message.fromMe || isActiveChat ? 0 : (base.unreadCount || 0) + 1;
        const updated = {
          ...base,
          ...(chat || {}),
          unreadCount: chat && !message.fromMe && !isActiveChat ? chat.unreadCount : unread,
          timestamp: message.timestamp,
          lastMessage: message,
          isNew: false,
        };
        return {
          ...s,
          threads,
          chats: sortChats([updated, ...s.chats.filter((c) => c.id !== chatId)]),
        };
      });

      if (isActiveChat && !message.fromMe) {
        accountApi(sessionId).markSeen(chatId).catch(() => {});
      }
    });

    socket.on('wa:ack', ({ sessionId, id, chatId, ack }) => {
      patch(sessionId, (s) => {
        const thread = s.threads[chatId];
        const threads = thread
          ? {
              ...s.threads,
              [chatId]: {
                ...thread,
                items: thread.items.map((m) => (m.id === id ? { ...m, ack } : m)),
              },
            }
          : s.threads;
        // The chat row draws its ticks from lastMessage, so it needs the ack too
        // - otherwise the list stays on the pending clock forever while the open
        // thread shows the message as delivered.
        const chats = s.chats.map((c) =>
          c.lastMessage && c.lastMessage.id === id
            ? { ...c, lastMessage: { ...c.lastMessage, ack, pending: false } }
            : c
        );
        return { ...s, threads, chats };
      });
    });

    socket.on('wa:revoke', ({ sessionId, id, chatId }) => {
      patch(sessionId, (s) => {
        const keys = chatId && s.threads[chatId] ? [chatId] : Object.keys(s.threads);
        const threads = { ...s.threads };
        for (const key of keys) {
          threads[key] = {
            ...threads[key],
            items: threads[key].items.map((m) =>
              m.id === id ? { ...m, isDeleted: true, body: '', type: 'revoked' } : m
            ),
          };
        }
        const chats = s.chats.map((c) =>
          c.lastMessage && c.lastMessage.id === id
            ? { ...c, lastMessage: { ...c.lastMessage, isDeleted: true, body: '', type: 'revoked' } }
            : c
        );
        return { ...s, threads, chats };
      });
    });

    socket.on('wa:edit', ({ sessionId, id, chatId, body }) => {
      patch(sessionId, (s) => {
        const thread = s.threads[chatId];
        const threads = thread
          ? {
              ...s.threads,
              [chatId]: {
                ...thread,
                items: thread.items.map((m) => (m.id === id ? { ...m, body, edited: true } : m)),
              },
            }
          : s.threads;
        const chats = s.chats.map((c) =>
          c.lastMessage && c.lastMessage.id === id
            ? { ...c, lastMessage: { ...c.lastMessage, body, edited: true } }
            : c
        );
        return { ...s, threads, chats };
      });
    });

    socket.on('wa:reaction', ({ sessionId, msgId, reaction, senderId }) => {
      patch(sessionId, (s) => {
        const threads = { ...s.threads };
        for (const key of Object.keys(threads)) {
          if (!threads[key].items.some((m) => m.id === msgId)) continue;
          threads[key] = {
            ...threads[key],
            items: threads[key].items.map((m) => {
              if (m.id !== msgId) return m;
              const others = (m.reactions || []).filter((r) => r.senderId !== senderId);
              return { ...m, reactions: reaction ? [...others, { senderId, reaction }] : others };
            }),
          };
        }
        return { ...s, threads };
      });
    });

    socket.on('wa:chat_removed', ({ sessionId, id }) => {
      patch(sessionId, (s) => ({
        ...s,
        chats: s.chats.filter((c) => c.id !== id),
        activeChatId: s.activeChatId === id ? null : s.activeChatId,
      }));
    });

    return () => socket.close();
  }, [patch, applyAccounts]);

  /* Load an account's chats the first time it reports ready. */
  useEffect(() => {
    for (const acc of accounts) {
      if (acc.connected && !readySeen.current.has(acc.sessionId)) {
        readySeen.current.add(acc.sessionId);
        loadChats(acc.sessionId);
      }
      if (!acc.connected) {
        readySeen.current.delete(acc.sessionId);
        contactsSeen.current.delete(acc.sessionId);
      }
    }
  }, [accounts, loadChats]);

  /* Contacts are big, so only the account being read pays for them. */
  useEffect(() => {
    if (!activeId || contactsSeen.current.has(activeId)) return;
    if (!account || !account.connected) return;
    contactsSeen.current.add(activeId);
    loadContacts(activeId);
  }, [activeId, account, loadContacts]);

  /* ---------------------------------------------------------------- */
  /* actions                                                           */
  /* ---------------------------------------------------------------- */

  const sendText = useCallback(
    async (chatId, text) => {
      const sessionId = activeIdRef.current;
      const trimmed = text.trim();
      if (!trimmed || !chatId || !sessionId) return;
      const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const optimistic = {
        id: tempId,
        chatId,
        body: trimmed,
        fromMe: true,
        type: 'chat',
        timestamp: Math.floor(Date.now() / 1000),
        ack: 0,
        pending: true,
        quotedMsgId: replyTo ? replyTo.id : null,
        quotedPreview: replyTo
          ? { id: replyTo.id, body: replyTo.body, type: replyTo.type, fromMe: replyTo.fromMe }
          : null,
      };
      patch(sessionId, (s) => {
        const thread = s.threads[chatId] || { items: [], hasMore: false, loaded: true };
        return {
          ...s,
          threads: { ...s.threads, [chatId]: { ...thread, items: [...thread.items, optimistic] } },
        };
      });
      const quoted = replyTo ? replyTo.id : undefined;
      setReplyTo(null);

      try {
        const { message } = await accountApi(sessionId).sendText(chatId, trimmed, {
          quotedMessageId: quoted,
        });
        // WhatsApp took the message but did not return the model. It is on its
        // way - keep the optimistic bubble and let the socket replace it rather
        // than telling the user it failed.
        if (!message) return;
        patch(sessionId, (s) => {
          const thread = s.threads[chatId];
          if (!thread) return s;
          return {
            ...s,
            threads: {
              ...s.threads,
              [chatId]: {
                ...thread,
                items: upsertMessage(thread.items.filter((m) => m.id !== tempId), message),
              },
            },
            chats: sortChats(
              s.chats.map((c) =>
                c.id === chatId
                  ? { ...c, lastMessage: message, timestamp: message.timestamp, isNew: false }
                  : c
              )
            ),
          };
        });
      } catch (err) {
        patch(sessionId, (s) => {
          const thread = s.threads[chatId];
          if (!thread) return s;
          return {
            ...s,
            threads: {
              ...s.threads,
              [chatId]: {
                ...thread,
                items: thread.items.map((m) =>
                  m.id === tempId ? { ...m, pending: false, failed: true } : m
                ),
              },
            },
          };
        });
        notify(err.message, 'error');
      }
    },
    [replyTo, notify, patch]
  );

  const sendMedia = useCallback(
    async (chatId, file, opts = {}) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      const tempId = `temp-${Date.now()}`;
      const quoted = replyTo ? replyTo.id : undefined;
      setReplyTo(null);
      patch(sessionId, (s) => {
        const thread = s.threads[chatId] || { items: [], hasMore: false, loaded: true };
        return {
          ...s,
          threads: {
            ...s.threads,
            [chatId]: {
              ...thread,
              items: [
                ...thread.items,
                {
                  id: tempId,
                  chatId,
                  fromMe: true,
                  pending: true,
                  uploading: 0,
                  body: opts.caption || '',
                  type: file.type.startsWith('image/')
                    ? 'image'
                    : file.type.startsWith('video/')
                    ? 'video'
                    : file.type.startsWith('audio/')
                    ? 'audio'
                    : 'document',
                  mediaFilename: file.name,
                  mediaMime: file.type,
                  localPreview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
                  timestamp: Math.floor(Date.now() / 1000),
                  ack: 0,
                },
              ],
            },
          },
        };
      });

      try {
        const { message } = await accountApi(sessionId).sendMedia(chatId, file, {
          ...opts,
          quotedMessageId: quoted,
          onProgress: (pct) =>
            patch(sessionId, (s) => {
              const thread = s.threads[chatId];
              if (!thread) return s;
              return {
                ...s,
                threads: {
                  ...s.threads,
                  [chatId]: {
                    ...thread,
                    items: thread.items.map((m) => (m.id === tempId ? { ...m, uploading: pct } : m)),
                  },
                },
              };
            }),
        });
        if (!message) return; // sent, model not returned - socket will confirm
        patch(sessionId, (s) => {
          const thread = s.threads[chatId];
          if (!thread) return s;
          return {
            ...s,
            threads: {
              ...s.threads,
              [chatId]: {
                ...thread,
                items: upsertMessage(thread.items.filter((m) => m.id !== tempId), message),
              },
            },
          };
        });
      } catch (err) {
        patch(sessionId, (s) => {
          const thread = s.threads[chatId];
          if (!thread) return s;
          return {
            ...s,
            threads: {
              ...s.threads,
              [chatId]: {
                ...thread,
                items: thread.items.map((m) =>
                  m.id === tempId ? { ...m, pending: false, failed: true } : m
                ),
              },
            },
          };
        });
        notify(err.message, 'error');
      }
    },
    [replyTo, notify, patch]
  );

  const emitTyping = useCallback((chatId, mode) => {
    if (socketRef.current) {
      socketRef.current.emit('wa:typing', { sessionId: activeIdRef.current, chatId, mode });
    }
  }, []);

  const deleteMessage = useCallback(
    async (message, everyone) => {
      const sessionId = activeIdRef.current;
      try {
        await accountApi(sessionId).remove(message.id, everyone);
        patch(sessionId, (s) => {
          const thread = s.threads[message.chatId];
          if (!thread) return s;
          return {
            ...s,
            threads: {
              ...s.threads,
              [message.chatId]: {
                ...thread,
                items: everyone
                  ? thread.items.map((m) =>
                      m.id === message.id ? { ...m, isDeleted: true, body: '', type: 'revoked' } : m
                    )
                  : thread.items.filter((m) => m.id !== message.id),
              },
            },
          };
        });
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify, patch]
  );

  const reactTo = useCallback(
    async (message, emoji) => {
      try {
        await accountApi(activeIdRef.current).react(message.id, emoji);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify]
  );

  const runChatAction = useCallback(
    async (chatId, action, value) => {
      const sessionId = activeIdRef.current;
      try {
        const res = await accountApi(sessionId).chatAction(chatId, action, value);
        patch(sessionId, (s) => {
          let next = s;
          if (res.deleted) {
            next = {
              ...next,
              chats: next.chats.filter((c) => c.id !== chatId),
              activeChatId: next.activeChatId === chatId ? null : next.activeChatId,
            };
          } else if (res.chat) {
            next = {
              ...next,
              chats: sortChats(next.chats.map((c) => (c.id === chatId ? { ...c, ...res.chat } : c))),
            };
          }
          if (action === 'clear') {
            next = {
              ...next,
              threads: { ...next.threads, [chatId]: { items: [], hasMore: false, loaded: true } },
            };
          }
          return next;
        });
        notify(`Chat ${action === 'markUnread' ? 'marked unread' : `${action}d`}`);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify, patch]
  );

  /** Unlinks the account but keeps it in the list, ready for a fresh QR scan. */
  const logout = useCallback(
    async (sessionId = activeIdRef.current) => {
      try {
        await accountsApi.logout(sessionId);
        setData((d) => ({ ...d, [sessionId]: EMPTY_DATA }));
        readySeen.current.delete(sessionId);
        contactsSeen.current.delete(sessionId);
        await accountsApi.start(sessionId).catch(() => {});
        await refreshAccounts();
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify, refreshAccounts]
  );

  /* ---------------------------------------------------------------- */
  /* derived                                                           */
  /* ---------------------------------------------------------------- */

  const slice = data[activeId] || EMPTY_DATA;
  const { chats, contacts, threads, activeChatId } = slice;

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) || null,
    [chats, activeChatId]
  );
  const activeThread = threads[activeChatId] || { items: [], hasMore: false, loading: false };

  const contactIndex = useMemo(() => {
    const map = new Map();
    for (const c of contacts) map.set(c.id, c);
    return map;
  }, [contacts]);

  /** Unread totals per account, for the badges on the switcher. */
  const unreadByAccount = useMemo(() => {
    const out = {};
    for (const acc of accounts) {
      const s = data[acc.sessionId];
      out[acc.sessionId] = s ? s.chats.reduce((n, c) => n + (c.unreadCount || 0), 0) : 0;
    }
    return out;
  }, [accounts, data]);

  const mediaUrl = useCallback(
    (messageId, download = false) => mediaUrlFor(activeId, messageId, download),
    [activeId]
  );
  const avatarUrl = useCallback(
    (contactId, sessionId = activeId) => (sessionId ? avatarUrlFor(sessionId, contactId) : null),
    [activeId]
  );

  const value = {
    // accounts
    accounts,
    accountsLoaded,
    account,
    activeId,
    unreadByAccount,
    selectAccount,
    addAccount,
    removeAccount,
    renameAccount,
    restartAccount,
    startAccount,
    refreshAccounts,

    // the active account, in the shape the chat UI already expected
    status: account || { state: 'DISCONNECTED', connected: false, qr: null, me: null },
    api,
    socketLive,
    chats,
    contacts,
    contactIndex,
    activeChat,
    activeChatId,
    activeThread,
    loadingChats,
    toast,
    replyTo,
    setReplyTo,
    notify,
    mediaUrl,
    avatarUrl,
    selectChat,
    openChatWithContact,
    openChatWithNumber,
    loadChats,
    loadContacts,
    loadMessages,
    sendText,
    sendMedia,
    emitTyping,
    deleteMessage,
    reactTo,
    runChatAction,
    logout,
  };

  return <WaContext.Provider value={value}>{children}</WaContext.Provider>;
}
