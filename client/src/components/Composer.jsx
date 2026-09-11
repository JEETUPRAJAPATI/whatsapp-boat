import { useEffect, useRef, useState } from 'react';
import { IconSend, IconAttach, IconEmoji, IconClose, IconDoc, IconLocation } from './Icons';
import { previewOf, formatBytes } from '../lib/format';
import { useWa } from '../store';

const EMOJIS = [
  '\u{1F600}', '\u{1F602}', '\u{1F60D}', '\u{1F60E}', '\u{1F914}', '\u{1F644}', '\u{1F62D}', '\u{1F621}',
  '\u{1F44D}', '\u{1F44C}', '\u{1F64F}', '\u{1F44F}', '\u{1F4AA}', '\u{1F525}', '❤️', '\u{1F49B}',
  '\u{1F389}', '\u{2728}', '\u{1F680}', '\u{1F4AF}', '\u{1F60A}', '\u{1F609}', '\u{1F914}', '\u{1F634}',
  '\u{1F31F}', '\u{1F340}', '\u{1F355}', '\u{2615}', '\u{1F381}', '\u{1F3B5}', '\u{26BD}', '\u{1F697}',
];

export default function Composer({ chatId }) {
  const { sendText, sendMedia, emitTyping, replyTo, setReplyTo, notify, api } = useWa();
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [caption, setCaption] = useState('');

  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const docRef = useRef(null);
  const typingTimer = useRef(null);
  const typingActive = useRef(false);

  /* Reset the draft whenever the open chat changes. */
  useEffect(() => {
    setText('');
    setShowEmoji(false);
    setAttachOpen(false);
    setPendingFile(null);
    setCaption('');
  }, [chatId]);

  useEffect(() => {
    if (replyTo && inputRef.current) inputRef.current.focus();
  }, [replyTo]);

  /* Broadcast "typing..." to the contact, then clear it after a pause. */
  const pingTyping = () => {
    if (!typingActive.current) {
      typingActive.current = true;
      emitTyping(chatId, 'typing');
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingActive.current = false;
      emitTyping(chatId, 'clear');
    }, 2500);
  };

  useEffect(() => () => clearTimeout(typingTimer.current), []);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    clearTimeout(typingTimer.current);
    typingActive.current = false;
    emitTyping(chatId, 'clear');
    sendText(chatId, value);
    setText('');
    setShowEmoji(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const autoGrow = (e) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const pickFile = (accept, asDocument) => {
    const ref = asDocument ? docRef : fileRef;
    ref.current.value = '';
    ref.current.accept = accept;
    ref.current.click();
    setAttachOpen(false);
  };

  const onFileChosen = (e, asDocument) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 64 * 1024 * 1024) {
      notify('File is larger than the 64 MB WhatsApp limit', 'error');
      return;
    }
    setPendingFile({ file, asDocument });
    setCaption('');
  };

  const confirmSend = () => {
    if (!pendingFile) return;
    sendMedia(chatId, pendingFile.file, {
      caption: caption.trim() || undefined,
      asDocument: pendingFile.asDocument,
    });
    setPendingFile(null);
    setCaption('');
  };

  const shareLocation = () => {
    setAttachOpen(false);
    if (!navigator.geolocation) {
      notify('Geolocation is not available in this browser', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await api.sendLocation(chatId, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            description: 'Shared from WhatsApp Boat',
          });
        } catch (err) {
          notify(err.message, 'error');
        }
      },
      () => notify('Could not read your location', 'error')
    );
  };

  const onPaste = (e) => {
    const item = [...(e.clipboardData.items || [])].find((i) => i.kind === 'file');
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      e.preventDefault();
      setPendingFile({ file, asDocument: false });
    }
  };

  return (
    <div className="composer-wrap">
      {replyTo && (
        <div className="reply-strip">
          <div className="reply-body">
            <strong>{replyTo.fromMe ? 'You' : replyTo.notifyName || 'Reply'}</strong>
            <span>{previewOf(replyTo)}</span>
          </div>
          <button className="icon-btn" onClick={() => setReplyTo(null)} title="Cancel reply">
            <IconClose width={18} height={18} />
          </button>
        </div>
      )}

      {pendingFile && (
        <div className="attach-preview">
          <div className="attach-preview-inner">
            {pendingFile.file.type.startsWith('image/') && !pendingFile.asDocument ? (
              <img src={URL.createObjectURL(pendingFile.file)} alt="" />
            ) : (
              <div className="attach-doc-icon">
                <IconDoc width={30} height={30} />
              </div>
            )}
            <div className="attach-meta">
              <strong>{pendingFile.file.name}</strong>
              <span>
                {formatBytes(pendingFile.file.size)}
                {pendingFile.asDocument ? ' · sending as document' : ''}
              </span>
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmSend()}
                placeholder="Add a caption"
              />
            </div>
            <div className="attach-actions">
              <button className="btn-ghost" onClick={() => setPendingFile(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={confirmSend}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmoji && (
        <div className="emoji-panel">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                setText((t) => t + e);
                if (inputRef.current) inputRef.current.focus();
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="composer">
        <button
          className="icon-btn"
          onClick={() => {
            setShowEmoji((v) => !v);
            setAttachOpen(false);
          }}
          title="Emoji"
        >
          <IconEmoji />
        </button>

        <div className="attach-wrap">
          <button
            className="icon-btn"
            onClick={() => {
              setAttachOpen((v) => !v);
              setShowEmoji(false);
            }}
            title="Attach"
          >
            <IconAttach />
          </button>
          {attachOpen && (
            <div className="menu menu-attach">
              <button onClick={() => pickFile('image/*,video/*', false)}>Photos &amp; videos</button>
              <button onClick={() => pickFile('*/*', true)}>Document</button>
              <button onClick={() => pickFile('audio/*', false)}>Audio</button>
              <button onClick={shareLocation}>
                <IconLocation width={16} height={16} /> Location
              </button>
            </div>
          )}
        </div>

        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={text}
          placeholder="Type a message"
          onChange={(e) => {
            setText(e.target.value);
            autoGrow(e);
            pingTyping();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        <button
          className={`icon-btn send ${text.trim() ? 'ready' : ''}`}
          onClick={submit}
          disabled={!text.trim()}
          title="Send"
        >
          <IconSend />
        </button>

        <input type="file" ref={fileRef} hidden onChange={(e) => onFileChosen(e, false)} />
        <input type="file" ref={docRef} hidden onChange={(e) => onFileChosen(e, true)} />
      </div>
    </div>
  );
}
