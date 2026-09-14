import { useEffect, useRef, useState } from 'react';
import AttachPreview from './AttachPreview';
import EmojiPicker from './EmojiPicker';
import TemplateDialog from './TemplateDialog';
import { IconAttach, IconDoc, IconEmoji, IconSend } from './Icons';
import { countdownLabel } from '../lib/format';
import { useWa } from '../store';

/**
 * Message box. Meta only allows free-form messages inside the 24h customer
 * service window, so when that window is closed the input is replaced by the
 * template path rather than letting the admin type something that would be
 * rejected.
 */
export default function Composer({ conversation }) {
  const { sendMessage, sendMedia, sending } = useWa();
  const [text, setText] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const inputRef = useRef(null);
  const mediaInputRef = useRef(null);
  const docInputRef = useRef(null);

  const windowState = conversation.serviceWindow || { open: false };
  const expiresAt = windowState.expiresAt ? Date.parse(windowState.expiresAt) : null;

  /* Ticks the countdown once a second so the remaining time is always live. */
  useEffect(() => {
    if (!expiresAt) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const remainingMs = expiresAt ? expiresAt - now : 0;
  // Derived from the clock, not the server snapshot, so the composer swaps to
  // the closed state the moment the window actually expires.
  const isOpen = expiresAt ? remainingMs > 0 : Boolean(windowState.open);

  useEffect(() => {
    setText('');
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [conversation.id, isOpen]);

  /* Grows the box with the text, up to a ceiling, like WhatsApp does. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setText('');
    try {
      await sendMessage(value);
    } catch {
      // Restore the draft so nothing is lost on a rejected send.
      setText(value);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  /** Inserts an emoji at the caret rather than always appending. */
  const insertEmoji = (emoji) => {
    const el = inputRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const pickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    setAttachMenu(false);
    if (file) setPendingFile(file);
  };

  const uploadFile = async (caption) => {
    setUploading(true);
    setProgress(0);
    try {
      await sendMedia(pendingFile, caption, setProgress);
      setPendingFile(null);
    } catch {
      // The store surfaced the reason; keep the dialog open so it can be retried.
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) {
    return (
      <>
        <div className="composer-wrap">
          <div className="window-closed">
            <div>
              <strong>The 24-hour customer service window is closed.</strong>
              <span>
                WhatsApp only accepts an approved template message until this customer writes
                again.
              </span>
            </div>
            <button className="btn-primary" onClick={() => setTemplateOpen(true)}>
              Send template
            </button>
          </div>
        </div>
        {templateOpen && <TemplateDialog onClose={() => setTemplateOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="composer-wrap">
        {expiresAt && (
          <div className="window-hint">
            <span className="window-dot" />
            Customer service window open
            <strong className="window-countdown">{countdownLabel(remainingMs)}</strong>
            remaining
          </div>
        )}

        <div className="composer">
          <div className="composer-tools">
            <button
              className="icon-btn"
              onClick={() => {
                setEmojiOpen((v) => !v);
                setAttachMenu(false);
              }}
              title="Emoji"
              type="button"
            >
              <IconEmoji />
            </button>

            <button
              className="icon-btn"
              onClick={() => {
                setAttachMenu((v) => !v);
                setEmojiOpen(false);
              }}
              title="Attach"
              type="button"
            >
              <IconAttach />
            </button>

            {attachMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setAttachMenu(false)} />
                <div className="menu menu-attach">
                  <button onClick={() => mediaInputRef.current.click()}>
                    <IconAttach width={17} height={17} /> Photo or video
                  </button>
                  <button onClick={() => docInputRef.current.click()}>
                    <IconDoc width={17} height={17} /> Document
                  </button>
                </div>
              </>
            )}

            {emojiOpen && (
              <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
            )}
          </div>

          <textarea
            ref={inputRef}
            className="composer-input"
            value={text}
            rows={1}
            placeholder="Type a message (Enter to send, Shift+Enter for a new line)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
          />

          <button
            className={`icon-btn send ${text.trim() ? 'ready' : ''}`}
            onClick={submit}
            disabled={!text.trim() || sending}
            title="Send"
            type="button"
          >
            {sending ? <span className="spinner small" /> : <IconSend />}
          </button>
        </div>

        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          hidden
          onChange={pickFile}
        />
        <input ref={docInputRef} type="file" hidden onChange={pickFile} />
      </div>

      {pendingFile && (
        <AttachPreview
          file={pendingFile}
          sending={uploading}
          progress={progress}
          onSend={uploadFile}
          onCancel={() => !uploading && setPendingFile(null)}
        />
      )}
    </>
  );
}
