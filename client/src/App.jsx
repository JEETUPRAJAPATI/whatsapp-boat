import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import AccountsScreen from './components/AccountsScreen';
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
        Linked as {status.label || (status.me && status.me.pushname) || 'your account'} ·{' '}
        {chats.length} chats synced
      </span>
    </section>
  );
}

export default function App() {
  const { accounts, accountsLoaded, account, activeChat, toast, socketLive } = useWa();
  const [newChat, setNewChat] = useState(false);
  const [view, setView] = useState('accounts');

  const connected = !!(account && account.connected);

  // The account manager is the front door: the chat view only takes over once
  // an account is actually linked, and losing that link sends you back.
  useEffect(() => {
    if (!connected) setView('accounts');
  }, [connected]);

  // With exactly one account already linked, going straight to its chats is
  // what the user wants - the manager stays one click away in the sidebar.
  // Only on the first load, or opening the manager would bounce right back.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !accountsLoaded || !connected) return;
    jumped.current = true;
    if (accounts.length === 1) setView('chats');
  }, [accountsLoaded, connected, accounts.length]);

  if (view === 'accounts' || !connected) {
    return (
      <>
        <AccountsScreen
          onOpenChats={() => setView('chats')}
          canGoBack={connected}
          onBack={() => setView('chats')}
        />
        {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      </>
    );
  }

  return (
    <div className={`app ${activeChat ? 'has-active' : ''}`}>
      {!socketLive && <div className="offline-banner">Reconnecting to the server...</div>}

      <Sidebar onOpenNewChat={() => setNewChat(true)} onManageAccounts={() => setView('accounts')} />
      {activeChat ? <ChatWindow /> : <EmptyState />}

      {newChat && <NewChatDialog onClose={() => setNewChat(false)} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
