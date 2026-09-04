import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './lib/api';

const WaContext = createContext(null);
export const useWa = () => useContext(WaContext);

const PAGE = 50;

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
  const [status, setStatus] = useState({ state: 'INITIALIZING', connected: false, qr: null, me: null });
  const [socketLive, setSocketLive] = useState(false);
  const [chats, setChats] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [threads, setThreads] = useState({}); // chatId -> { items, hasMore, loading, loaded }
  const [loadingChats, setLoadingChats] = useState(false);
  const [toast, setToast] = useState(null);
  const [replyTo, setReplyTo] = useState(null);

  const socketRef = useRef(null);
  const activeChatIdRef = useRef(null);
  activeChatIdRef.current = activeChatId;

  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind, at: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.at >= 3400 ? null : t)), 3500);
  }, []);

  /* ---------------------------------------------------------------- */
  /* loaders                                                           */
  /* ---------------------------------------------------------------- */

  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    try {
      const { chats: list } = await api.chats();
      setChats(sortChats(list || []));
    } catch (err) {
      if (err.status !== 409) notify(err.message, 'error');
    } finally {
      setLoadingChats(false);
    }
  }, [notify]);

  const loadContacts = useCallback(async () => {
    try {
      const { contacts: list } = await api.contacts();
      setContacts(list || []);
    } catch (err) {
      if (err.status !== 409) notify(err.message, 'error');
    }
  }, [notify]);

  const loadMessages = useCallback(
    async (chatId, { older = false } = {}) => {
      if (!chatId) return;
      const current = threads[chatId];
      if (older && (!current || current.loading || !current.hasMore)) return;
      const offset = older && current ? current.items.length : 0;

      setThreads((t) => ({
        ...t,
        [chatId]: { items: [], hasMore: false, ...(t[chatId] || {}), loading: true },
      }));
      try {
        const res = await api.messages(chatId, { limit: PAGE, offset });
        setThreads((t) => {
          const prev = t[chatId] || { items: [] };
          const incoming = res.messages || [];
          const merged = older
            ? [...incoming, ...prev.items.filter((m) => !incoming.some((i) => i.id === m.id))]
            : incoming;
          return {
            ...t,
            [chatId]: { items: merged, hasMore: !!res.hasMore, loading: false, loaded: true },
          };
        });
      } catch (err) {
        setThreads((t) => ({ ...t, [chatId]: { ...(t[chatId] || { items: [] }), loading: false } }));
        if (err.status !== 409) notify(err.message, 'error');
      }
    },
    [threads, notify]
  );

  const selectChat = useCallback(
    async (chatId) => {
      setActiveChatId(chatId);
      setReplyTo(null);
      if (!chatId) return;
      if (!threads[chatId] || !threads[chatId].loaded) await loadMessages(chatId);
      setChats((list) => list.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)));
      api.markSeen(chatId).catch(() => {});
    },
    [threads, loadMessages]
  );

  /**
   * Opens a chat for a contact that may not have one yet - WhatsApp creates the
   * thread lazily, so an empty thread is a valid starting point.
   */
  const openChatWithContact = useCallback(
    async (contact) => {
      const chatId = contact.id;
      if (!chats.some((c) => c.id === chatId)) {
        const stub = {
          id: chatId,
          name: contact.displayName || contact.name || contact.number,
          isGroup: !!contact.isGroup,
          unreadCount: 0,
          timestamp: Math.floor(Date.now() / 1000),
          lastMessage: null,
          isNew: true,
        };
        setChats((list) => sortChats([stub, ...list]));
      }
      await selectChat(chatId);
    },
    [chats, selectChat]
  );

  /* ---------------------------------------------------------------- */
  /* socket                                                            */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setSocketLive(true));
    socket.on('disconnect', () => setSocketLive(false));
    socket.on('wa:state', (s) => setStatus(s));
    socket.on('wa:qr', ({ dataUrl }) =>
      setStatus((s) => ({ ...s, state: 'QR', qr: dataUrl, connected: false }))
    );
    socket.on('wa:loading', (loading) => setStatus((s) => ({ ...s, loading })));

    socket.on('wa:message', ({ message, chat }) => {
      if (!message || !message.chatId) return;
      const chatId = message.chatId;

      setThreads((t) => {
        const thread = t[chatId];
        // Only append to threads the user has actually opened; others reload on demand.
        if (!thread || !thread.loaded) return t;
        return { ...t, [chatId]: { ...thread, items: upsertMessage(thread.items, message) } };
      });

      setChats((list) => {
        const isActive = activeChatIdRef.current === chatId;
        const existing = list.find((c) => c.id === chatId);
        const base = existing || {
          id: chatId,
          name: (chat && chat.name) || message.notifyName || chatId.split('@')[0],
          isGroup: chatId.endsWith('@g.us'),
        };
        const unread = message.fromMe || isActive ? 0 : (base.unreadCount || 0) + 1;
        const updated = {
          ...base,
          ...(chat || {}),
          unreadCount: chat && !message.fromMe && !isActive ? chat.unreadCount : unread,
          timestamp: message.timestamp,
          lastMessage: message,
          isNew: false,
        };
        return sortChats([updated, ...list.filter((c) => c.id !== chatId)]);
      });

      if (activeChatIdRef.current === chatId && !message.fromMe) {
        api.markSeen(chatId).catch(() => {});
      }
    });

    socket.on('wa:ack', ({ id, chatId, ack }) => {
      setThreads((t) => {
        const thread = t[chatId];
        if (!thread) return t;
        return {
          ...t,
          [chatId]: { ...thread, items: thread.items.map((m) => (m.id === id ? { ...m, ack } : m)) },
        };
      });
    });

    socket.on('wa:revoke', ({ id, chatId }) => {
      setThreads((t) => {
        const target = chatId && t[chatId] ? [chatId] : Object.keys(t);
        const next = { ...t };
        for (const key of target) {
          next[key] = {
            ...next[key],
            items: next[key].items.map((m) =>
              m.id === id ? { ...m, isDeleted: true, body: '', type: 'revoked' } : m
            ),
          };
        }
        return next;
      });
    });

    socket.on('wa:edit', ({ id, chatId, body }) => {
      setThreads((t) => {
        const thread = t[chatId];
        if (!thread) return t;
        return {
          ...t,
          [chatId]: {
            ...thread,
            items: thread.items.map((m) => (m.id === id ? { ...m, body, edited: true } : m)),
          },
        };
      });
    });

    socket.on('wa:reaction', ({ msgId, reaction, senderId }) => {
      setThreads((t) => {
        const next = { ...t };
        for (const key of Object.keys(next)) {
          if (!next[key].items.some((m) => m.id === msgId)) continue;
          next[key] = {
            ...next[key],
            items: next[key].items.map((m) => {
              if (m.id !== msgId) return m;
              const others = (m.reactions || []).filter((r) => r.senderId !== senderId);
              return {
                ...m,
                reactions: reaction ? [...others, { senderId, reaction }] : others,
              };
            }),
          };
        }
        return next;
      });
    });

    socket.on('wa:chat_removed', ({ id }) => {
      setChats((list) => list.filter((c) => c.id !== id));
      setActiveChatId((cur) => (cur === id ? null : cur));
    });

    return () => socket.close();
  }, []);

  /* Boot: read status, then load data once WhatsApp reports ready. */
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  const wasReady = useRef(false);
  useEffect(() => {
    if (status.connected && !wasReady.current) {
      wasReady.current = true;
      loadChats();
      loadContacts();
    }
    if (!status.connected) wasReady.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected]);

  /* ---------------------------------------------------------------- */
  /* actions                                                           */
  /* ---------------------------------------------------------------- */

  const sendText = useCallback(
    async (chatId, text) => {
      const trimmed = text.trim();
      if (!trimmed || !chatId) return;
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
      setThreads((t) => {
        const thread = t[chatId] || { items: [], hasMore: false, loaded: true };
        return { ...t, [chatId]: { ...thread, items: [...thread.items, optimistic] } };
      });
      const quoted = replyTo ? replyTo.id : undefined;
      setReplyTo(null);

      try {
        const { message } = await api.sendText(chatId, trimmed, { quotedMessageId: quoted });
        // WhatsApp took the message but did not return the model. It is on its
        // way - keep the optimistic bubble and let the socket replace it rather
        // than telling the user it failed.
        if (!message) return;
        setThreads((t) => {
          const thread = t[chatId];
          if (!thread) return t;
          return {
            ...t,
            [chatId]: {
              ...thread,
              items: upsertMessage(
                thread.items.filter((m) => m.id !== tempId),
                message
              ),
            },
          };
        });
        setChats((list) =>
          sortChats(
            list.map((c) =>
              c.id === chatId
                ? { ...c, lastMessage: message, timestamp: message.timestamp, isNew: false }
                : c
            )
          )
        );
      } catch (err) {
        setThreads((t) => {
          const thread = t[chatId];
          if (!thread) return t;
          return {
            ...t,
            [chatId]: {
              ...thread,
              items: thread.items.map((m) =>
                m.id === tempId ? { ...m, pending: false, failed: true } : m
              ),
            },
          };
        });
        notify(err.message, 'error');
      }
    },
    [replyTo, notify]
  );

  const sendMedia = useCallback(
    async (chatId, file, opts = {}) => {
      const tempId = `temp-${Date.now()}`;
      const quoted = replyTo ? replyTo.id : undefined;
      setReplyTo(null);
      setThreads((t) => {
        const thread = t[chatId] || { items: [], hasMore: false, loaded: true };
        return {
          ...t,
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
        };
      });

      try {
        const { message } = await api.sendMedia(chatId, file, {
          ...opts,
          quotedMessageId: quoted,
          onProgress: (pct) =>
            setThreads((t) => {
              const thread = t[chatId];
              if (!thread) return t;
              return {
                ...t,
                [chatId]: {
                  ...thread,
                  items: thread.items.map((m) => (m.id === tempId ? { ...m, uploading: pct } : m)),
                },
              };
            }),
        });
        if (!message) return; // sent, model not returned - socket will confirm
        setThreads((t) => {
          const thread = t[chatId];
          if (!thread) return t;
          return {
            ...t,
            [chatId]: {
              ...thread,
              items: upsertMessage(thread.items.filter((m) => m.id !== tempId), message),
            },
          };
        });
      } catch (err) {
        setThreads((t) => {
          const thread = t[chatId];
          if (!thread) return t;
          return {
            ...t,
            [chatId]: {
              ...thread,
              items: thread.items.map((m) =>
                m.id === tempId ? { ...m, pending: false, failed: true } : m
              ),
            },
          };
        });
        notify(err.message, 'error');
      }
    },
    [replyTo, notify]
  );

  const emitTyping = useCallback((chatId, mode) => {
    if (socketRef.current) socketRef.current.emit('wa:typing', { chatId, mode });
  }, []);

  const deleteMessage = useCallback(
    async (message, everyone) => {
      try {
        await api.remove(message.id, everyone);
        setThreads((t) => {
          const thread = t[message.chatId];
          if (!thread) return t;
          return {
            ...t,
            [message.chatId]: {
              ...thread,
              items: everyone
                ? thread.items.map((m) =>
                    m.id === message.id ? { ...m, isDeleted: true, body: '', type: 'revoked' } : m
                  )
                : thread.items.filter((m) => m.id !== message.id),
            },
          };
        });
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify]
  );

  const reactTo = useCallback(
    async (message, emoji) => {
      try {
        await api.react(message.id, emoji);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify]
  );

  const runChatAction = useCallback(
    async (chatId, action, value) => {
      try {
        const res = await api.chatAction(chatId, action, value);
        if (res.deleted) {
          setChats((list) => list.filter((c) => c.id !== chatId));
          setActiveChatId((cur) => (cur === chatId ? null : cur));
        } else if (res.chat) {
          setChats((list) => sortChats(list.map((c) => (c.id === chatId ? { ...c, ...res.chat } : c))));
        }
        if (action === 'clear') {
          setThreads((t) => ({ ...t, [chatId]: { items: [], hasMore: false, loaded: true } }));
        }
        notify(`Chat ${action === 'markUnread' ? 'marked unread' : `${action}d`}`);
      } catch (err) {
        notify(err.message, 'error');
      }
    },
    [notify]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
      setChats([]);
      setContacts([]);
      setThreads({});
      setActiveChatId(null);
      // Kick off a fresh session so a QR appears without a manual reload.
      api.startSession().catch(() => {});
    } catch (err) {
      notify(err.message, 'error');
    }
  }, [notify]);

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

  const value = {
    status,
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
    selectChat,
    openChatWithContact,
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
