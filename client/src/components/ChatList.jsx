import Avatar from './Avatar';
import { Ticks, IconPin, IconMuted } from './Icons';
import { listTime, previewOf, isGroupId } from '../lib/format';
import { useWa } from '../store';

function ChatRow({ chat, active, onOpen, onMenu }) {
  const last = chat.lastMessage;
  const isGroup = chat.isGroup || isGroupId(chat.id);
  const senderPrefix =
    isGroup && last && !last.fromMe && last.notifyName ? `${last.notifyName}: ` : '';

  return (
    <div
      className={`chat-row ${active ? 'active' : ''}`}
      onClick={() => onOpen(chat.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(chat, { x: e.clientX, y: e.clientY });
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(chat.id)}
    >
      <Avatar id={chat.id} name={chat.name} isGroup={isGroup} />
      <div className="chat-row-body">
        <div className="chat-row-top">
          <span className="chat-row-name">{chat.name || chat.id.split('@')[0]}</span>
          <span className={`chat-row-time ${chat.unreadCount ? 'unread' : ''}`}>
            {listTime(chat.timestamp)}
          </span>
        </div>
        <div className="chat-row-bottom">
          <span className="chat-row-preview">
            {last && last.fromMe && !last.isDeleted && (
              <Ticks ack={last.ack} />
            )}
            {senderPrefix}
            {previewOf(last) || (chat.isNew ? 'Start a new conversation' : '')}
          </span>
          <span className="chat-row-badges">
            {chat.isMuted && <IconMuted width={14} height={14} className="badge-icon" />}
            {chat.isPinned && <IconPin width={14} height={14} className="badge-icon" />}
            {chat.unreadCount > 0 && <span className="unread-badge">{chat.unreadCount}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ChatList({ chats, onMenu }) {
  const { activeChatId, selectChat, loadingChats } = useWa();

  if (!chats.length) {
    return (
      <div className="list-empty">
        {loadingChats ? <div className="spinner small" /> : <p>No chats found</p>}
      </div>
    );
  }

  return (
    <div className="chat-list">
      {chats.map((chat) => (
        <ChatRow
          key={chat.id}
          chat={chat}
          active={chat.id === activeChatId}
          onOpen={selectChat}
          onMenu={onMenu}
        />
      ))}
    </div>
  );
}
