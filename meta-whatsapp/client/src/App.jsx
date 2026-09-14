import ChatWindow from './components/ChatWindow';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import { IconChats } from './components/Icons';
import { useWa } from './store';

function EmptyState() {
  const { conversations, metaStatus } = useWa();
  return (
    <section className="empty-state">
      <IconChats width={90} height={90} />
      <h2>WhatsApp Business Inbox</h2>
      <p>
        Pick a conversation on the left to read the full history and reply. New customer messages
        arrive here automatically.
      </p>
      <span className="empty-meta">
        {conversations.length} conversations ·{' '}
        {metaStatus.configured ? 'Cloud API connected' : 'Cloud API not configured'}
      </span>
    </section>
  );
}

export default function App() {
  const { user, booting, activeConversation, toast, socketLive, metaStatus } = useWa();

  if (booting) {
    return (
      <div className="boot-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    /* Banners sit in normal flow above the grid - a fixed overlay would cover
       the chat header and swallow clicks on its buttons. */
    <div className="app-shell">
      {!socketLive && <div className="app-banner">Reconnecting to the server...</div>}
      {socketLive && !metaStatus.configured && (
        <div className="app-banner warn">
          META_WHATSAPP_ACCESS_TOKEN is not set - incoming messages still work, replies will fail.
        </div>
      )}

      <div className={`app ${activeConversation ? 'has-active' : ''}`}>
        <Sidebar />
        {activeConversation ? <ChatWindow /> : <EmptyState />}
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
