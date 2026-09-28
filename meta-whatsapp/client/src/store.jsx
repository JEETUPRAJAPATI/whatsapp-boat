import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';
import { api } from './lib/api';

const WaContext = createContext(null);
export const useWa = () => useContext(WaContext);

const emptyThread = { items: [], hasMore: false, loading: false };

export function WaProvider({ children }) {
  const [metaStatus, setMetaStatus] = useState({ configured: false });

  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [threads, setThreads] = useState({});
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [socketLive, setSocketLive] = useState(false);
  const [toast, setToast] = useState(null);

  const socketRef = useRef(null);
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;

  /* Held in refs so the socket effect never lists them as dependencies -
     re-running that effect would tear down and rebuild the connection. */
  const loadConversationsRef = useRef(null);
  const loadMessagesRef = useRef(null);
  const searchRef = useRef('');
  searchRef.current = search;

  const notify = useCallback((text, kind = 'info') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // -------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------

  const loadConversations = useCallback(
    async (term = '') => {
      setLoadingConversations(true);
      try {
        const rows = await api.conversations({ search: term });
        setConversations(rows);
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        setLoadingConversations(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    loadConversations();
    api.status().then(setMetaStatus).catch(() => {});
  }, [loadConversations]);

  /** Server-side search, debounced so typing does not hammer the API. */
  useEffect(() => {
    const id = setTimeout(() => loadConversations(search), 250);
    return () => clearTimeout(id);
  }, [search, loadConversations]);

  const loadMessages = useCallback(
    async (conversationId, { older = false } = {}) => {
      const current = threads[conversationId] || emptyThread;
      if (current.loading) return;
      if (older && !current.hasMore) return;

      setThreads((prev) => ({
        ...prev,
        [conversationId]: { ...(prev[conversationId] || emptyThread), loading: true },
      }));

      try {
        const before = older && current.items.length ? current.items[0].id : undefined;
        const res = await api.messages(conversationId, { before });
        setThreads((prev) => {
          const existing = prev[conversationId] || emptyThread;
          const items = older ? [...res.items, ...existing.items] : res.items;
          return {
            ...prev,
            [conversationId]: { items, hasMore: res.hasMore, loading: false },
          };
        });
      } catch (err) {
        notify(err.message, 'error');
        setThreads((prev) => ({
          ...prev,
          [conversationId]: { ...(prev[conversationId] || emptyThread), loading: false },
        }));
      }
    },
    [threads, notify],
  );

  loadConversationsRef.current = loadConversations;
  loadMessagesRef.current = loadMessages;

  const selectConversation = useCallback(
    async (conversationId) => {
      setActiveId(conversationId);
      if (!threads[conversationId]) loadMessages(conversationId);

      const row = conversations.find((c) => c.id === conversationId);
      if (row && row.unreadCount > 0) {
        // Optimistic: the socket echo confirms it a moment later.
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
        );
        api.markRead(conversationId).catch(() => {});
      }
      if (socketRef.current) {
        socketRef.current.emit('whatsapp:join-conversation', conversationId);
      }
    },
    [threads, conversations, loadMessages],
  );

  // -------------------------------------------------------------------
  // Real-time
  // -------------------------------------------------------------------

  const upsertConversation = useCallback((conversation) => {
    setConversations((prev) => {
      const others = prev.filter((c) => c.id !== conversation.id);
      const next = [conversation, ...others];
      next.sort((a, b) => {
        const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
        const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
        return bt - at;
      });
      return next;
    });
  }, []);

  const appendMessage = useCallback((conversationId, message) => {
    setThreads((prev) => {
      const thread = prev[conversationId];
      // Not loaded yet: it will arrive with the first fetch.
      if (!thread) return prev;
      if (thread.items.some((m) => m.id === message.id)) return prev;
      return {
        ...prev,
        [conversationId]: { ...thread, items: [...thread.items, message] },
      };
    });
  }, []);

  useEffect(() => {
    const socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketLive(true);
      // Messages that arrived while the socket was down were still stored by
      // the webhook, so every (re)connect re-syncs instead of trusting that no
      // event was missed. Without this a drop silently loses a message.
      loadConversationsRef.current(searchRef.current);
      const openId = activeIdRef.current;
      if (openId) {
        socket.emit('whatsapp:join-conversation', openId);
        loadMessagesRef.current(openId);
      }
    });
    socket.on('disconnect', () => setSocketLive(false));

    socket.on('whatsapp:new-message', ({ conversationId, message }) => {
      appendMessage(conversationId, message);
      // A message for the open thread is read as it lands.
      if (conversationId === activeIdRef.current && !message.fromMe) {
        api.markRead(conversationId).catch(() => {});
      }
    });

    socket.on('whatsapp:conversation', ({ conversation }) => {
      upsertConversation(conversation);
    });

    socket.on('whatsapp:message-status', ({ conversationId, metaMessageId, status, error }) => {
      setThreads((prev) => {
        const thread = prev[conversationId];
        if (!thread) return prev;
        return {
          ...prev,
          [conversationId]: {
            ...thread,
            items: thread.items.map((m) =>
              m.metaMessageId === metaMessageId ? { ...m, status, error: error || m.error } : m,
            ),
          },
        };
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [appendMessage, upsertConversation]);

  /**
   * Fallbacks for the cases a socket alone cannot cover: the connection is
   * down for a while, or the tab was in the background and the browser froze
   * its timers. Both re-sync from the database, which is the source of truth.
   */
  useEffect(() => {
    const resync = () => {
      loadConversationsRef.current(searchRef.current);
      if (activeIdRef.current) loadMessagesRef.current(activeIdRef.current);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    document.addEventListener('visibilitychange', onVisible);

    // Only polls while the socket is actually down; live sockets need no help.
    const timer = socketLive ? null : setInterval(resync, 15000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, [socketLive]);

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text) => {
      const conversation = conversations.find((c) => c.id === activeIdRef.current);
      if (!conversation || !text.trim()) return;

      setSending(true);
      try {
        // The socket echo inserts the stored row, so nothing to merge here.
        await api.sendMessage(conversation.phoneNumber, text.trim());
      } catch (err) {
        notify(err.message, 'error');
        if (err.data && err.data.code === 'SERVICE_WINDOW_CLOSED') {
          // Refresh so the composer switches to template-only mode.
          api.conversation(conversation.id).then(upsertConversation).catch(() => {});
        }
        throw err;
      } finally {
        setSending(false);
      }
    },
    [conversations, notify, upsertConversation],
  );

  const sendMedia = useCallback(
    async (file, caption, onProgress) => {
      const conversation = conversations.find((c) => c.id === activeIdRef.current);
      if (!conversation || !file) return;

      setSending(true);
      try {
        // The socket echo inserts the stored row once Meta accepts the upload.
        await api.sendMedia(conversation.phoneNumber, file, { caption, onProgress });
      } catch (err) {
        notify(err.message, 'error');
        throw err;
      } finally {
        setSending(false);
      }
    },
    [conversations, notify],
  );

  const sendTemplate = useCallback(
    async (templateName, language, components) => {
      const conversation = conversations.find((c) => c.id === activeIdRef.current);
      if (!conversation) return;
      setSending(true);
      try {
        await api.sendTemplate(conversation.phoneNumber, templateName, language, components);
        notify('Template sent');
      } catch (err) {
        notify(err.message, 'error');
        throw err;
      } finally {
        setSending(false);
      }
    },
    [conversations, notify],
  );

  const patchConversation = useCallback(
    async (conversationId, patch) => {
      try {
        const updated = await api.updateConversation(conversationId, patch);
        upsertConversation(updated);
        return updated;
      } catch (err) {
        notify(err.message, 'error');
        throw err;
      }
    },
    [upsertConversation, notify],
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  const value = {
    metaStatus,
    conversations,
    loadingConversations,
    loadConversations,
    activeId,
    activeConversation,
    selectConversation,
    closeConversation: () => setActiveId(null),
    threads,
    thread: threads[activeId] || emptyThread,
    loadMessages,
    search,
    setSearch,
    sendMessage,
    sendMedia,
    sendTemplate,
    patchConversation,
    sending,
    socketLive,
    toast,
    notify,
  };

  return <WaContext.Provider value={value}>{children}</WaContext.Provider>;
}
