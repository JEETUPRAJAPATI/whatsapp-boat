import { useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import QrScreen from './components/QrScreen';
import NewChatDialog from './components/NewChatDialog';
import { IconChats } from './components/Icons';
import { useWa } from './store';

function EmptyState() {
  const { status, chats } = useWa();
  return (
    <section className="empty-state">
      <IconChats width={90} height={90} />
      <h2>WhatsApp Boat</h2>
      <p>
        Pick a chat on the left to read the whole conversation, or open the Contacts tab to start a
        new one.
      </p>
      <span className="empty-meta">
        Linked as {(status.me && status.me.pushname) || 'your account'} · {chats.length} chats synced
      </span>
    </section>
  );
}

export default function App() {
  const { status, activeChat, toast, socketLive } = useWa();
  const [newChat, setNewChat] = useState(false);

  if (!status.connected) return <QrScreen />;

  return (
    <div className={`app ${activeChat ? 'has-active' : ''}`}>
      {!socketLive && <div className="offline-banner">Reconnecting to the server...</div>}

      <Sidebar onOpenNewChat={() => setNewChat(true)} />
      {activeChat ? <ChatWindow /> : <EmptyState />}

      {newChat && <NewChatDialog onClose={() => setNewChat(false)} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
