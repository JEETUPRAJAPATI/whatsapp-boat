/* A small, dependency-free emoji panel covering the everyday support set. */
const GROUPS = [
  {
    name: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '😘', '😗', '😋', '😛', '🤗',
      '🤔', '🤐', '😐', '😑', '😶', '🙄', '😏', '😴', '😪', '😌',
      '😔', '😢', '😭', '😤', '😠', '😡', '🥺', '😳', '🤯', '😎',
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      '👍', '👎', '👌', '🤝', '👏', '🙏', '💪', '🤞', '✌️', '👋',
      '🖐️', '☝️', '👆', '👇', '👈', '👉', '✍️', '🙌', '🤙', '💅',
    ],
  },
  {
    name: 'Business',
    emojis: [
      '✅', '❌', '⚠️', '❓', '❗', '📌', '📎', '📝', '📄', '📁',
      '📷', '🎥', '🎧', '📞', '📱', '💬', '📧', '🔔', '⏰', '📅',
      '💰', '💳', '🧾', '📦', '🚚', '🏠', '🛒', '⭐', '🔥', '🎉',
    ],
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯'],
  },
];

export default function EmojiPicker({ onPick, onClose }) {
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="emoji-panel" role="dialog" aria-label="Emoji picker">
        {GROUPS.map((group) => (
          <div key={group.name} className="emoji-group">
            <span className="emoji-group-name">{group.name}</span>
            <div className="emoji-grid">
              {group.emojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onPick(emoji)}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
