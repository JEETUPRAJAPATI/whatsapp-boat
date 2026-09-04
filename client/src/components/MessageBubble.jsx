import { memo, useState } from 'react';
import { mediaUrl } from '../lib/api';
import {
  clockTime,
  formatBytes,
  formatDuration,
  richTokens,
  previewOf,
  phoneOf,
} from '../lib/format';
import { Ticks, IconDoc, IconDownload, IconLocation, IconPlay } from './Icons';

const QUICK_REACTIONS = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

function RichText({ text }) {
  return (
    <>
      {richTokens(text).map((t, i) => {
        switch (t.kind) {
          case 'link':
            return (
              <a
                key={i}
                href={t.value.startsWith('http') ? t.value : `https://${t.value}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t.value}
              </a>
            );
          case 'bold':
            return <strong key={i}>{t.value}</strong>;
          case 'italic':
            return <em key={i}>{t.value}</em>;
          case 'strike':
            return <s key={i}>{t.value}</s>;
          case 'mono':
            return <code key={i}>{t.value}</code>;
          default:
            return <span key={i}>{t.value}</span>;
        }
      })}
    </>
  );
}

function MediaBody({ message, onOpenMedia }) {
  const [broken, setBroken] = useState(false);
  const url = message.localPreview || mediaUrl(message.id);
  const isTemp = String(message.id).startsWith('temp-');

  if (message.type === 'image' || message.type === 'sticker') {
    const sticker = message.type === 'sticker';
    if (broken && !isTemp) {
      return <div className="media-broken">Image unavailable</div>;
    }
    return (
      <div className={sticker ? 'bubble-sticker' : 'bubble-image'}>
        <img
          src={url}
          alt={message.body || 'Photo'}
          loading="lazy"
          onError={() => setBroken(true)}
          onClick={() => !isTemp && onOpenMedia(message)}
        />
        {message.uploading != null && message.pending && (
          <div className="upload-overlay">
            <div className="upload-ring">{message.uploading}%</div>
          </div>
        )}
      </div>
    );
  }

  if (message.type === 'video') {
    if (isTemp) {
      return (
        <div className="media-placeholder">
          <IconPlay width={26} height={26} />
          <span>Uploading video {message.uploading || 0}%</span>
        </div>
      );
    }
    return (
      <div className="bubble-video">
        <video src={url} controls preload="metadata" />
      </div>
    );
  }

  if (message.type === 'audio' || message.type === 'ptt') {
    return (
      <div className="bubble-audio">
        <audio src={url} controls preload="none" />
        {message.duration ? <span className="audio-dur">{formatDuration(message.duration)}</span> : null}
      </div>
    );
  }

  if (message.type === 'location' && message.location) {
    const { latitude, longitude, description } = message.location;
    return (
      <a
        className="bubble-location"
        href={`https://www.google.com/maps?q=${latitude},${longitude}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        <IconLocation width={22} height={22} />
        <div>
          <strong>{description || 'Shared location'}</strong>
          <span>
            {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}
          </span>
        </div>
      </a>
    );
  }

  if (message.type === 'vcard' || message.type === 'multi_vcard') {
    const names = (message.vcards || [])
      .map((v) => {
        const m = /FN:(.+)/.exec(v);
        return m ? m[1].trim() : null;
      })
      .filter(Boolean);
    return (
      <div className="bubble-vcard">
        <strong>{names.join(', ') || 'Contact card'}</strong>
        <span>{names.length > 1 ? `${names.length} contacts` : 'Contact'}</span>
      </div>
    );
  }

  // Documents and anything else with an attachment.
  return (
    <a
      className="bubble-doc"
      href={isTemp ? undefined : mediaUrl(message.id, true)}
      target="_blank"
      rel="noreferrer noopener"
    >
      <IconDoc width={26} height={26} />
      <div className="bubble-doc-meta">
        <strong>{message.mediaFilename || 'Document'}</strong>
        <span>
          {[message.mediaMime, formatBytes(message.mediaSize)].filter(Boolean).join(' · ')}
        </span>
      </div>
      {!isTemp && <IconDownload width={18} height={18} />}
    </a>
  );
}

function MessageBubble({
  message,
  showAuthor,
  isGroup,
  contactIndex,
  onOpenMedia,
  onReply,
  onReact,
  onDelete,
  onForward,
  onStar,
  onJumpTo,
}) {
  const [menu, setMenu] = useState(false);
  const mine = message.fromMe;

  if (message.type === 'revoked' || message.isDeleted) {
    return (
      <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
        <div className="bubble bubble-deleted">
          <em>This message was deleted</em>
          <span className="bubble-meta">{clockTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  const systemTypes = ['e2e_notification', 'notification_template', 'gp2', 'call_log', 'protocol'];
  if (systemTypes.includes(message.type)) {
    return (
      <div className="system-note">
        {message.body || (message.type === 'call_log' ? 'Call' : 'System message')}
      </div>
    );
  }

  const authorId = message.author || message.from;
  const authorContact = contactIndex.get(authorId);
  const authorName =
    (authorContact && authorContact.displayName) || message.notifyName || phoneOf(authorId);
  const hasMedia = message.hasMedia || ['image', 'video', 'audio', 'ptt', 'sticker', 'document'].includes(message.type);
  const isSticker = message.type === 'sticker';

  return (
    <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
      <div
        className={`bubble ${isSticker ? 'bubble-transparent' : ''} ${message.failed ? 'failed' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu((v) => !v);
        }}
      >
        {showAuthor && isGroup && !mine && (
          <div className="bubble-author" style={{ color: 'var(--author-color)' }}>
            {authorName}
          </div>
        )}

        {message.isForwarded && <div className="bubble-forwarded">Forwarded</div>}

        {message.quotedPreview && (
          <div
            className="bubble-quote"
            onClick={() => onJumpTo && onJumpTo(message.quotedPreview.id)}
            role="button"
            tabIndex={0}
          >
            <div className="bubble-quote-author">
              {message.quotedPreview.fromMe
                ? 'You'
                : (contactIndex.get(message.quotedPreview.author) || {}).displayName ||
                  phoneOf(message.quotedPreview.author)}
            </div>
            <div className="bubble-quote-text">{previewOf(message.quotedPreview)}</div>
          </div>
        )}

        {hasMedia && <MediaBody message={message} onOpenMedia={onOpenMedia} />}

        {message.body && !isSticker && (
          <div className="bubble-text">
            <RichText text={message.body} />
          </div>
        )}

        <div className="bubble-meta">
          {message.edited && <span className="edited">edited</span>}
          <span>{clockTime(message.timestamp)}</span>
          {mine && <Ticks ack={message.pending ? 0 : message.ack} failed={message.failed} />}
        </div>

        {Array.isArray(message.reactions) && message.reactions.length > 0 && (
          <div className="bubble-reactions">
            {message.reactions.map((r, i) => (
              <span key={i}>{r.reaction}</span>
            ))}
          </div>
        )}

        <button
          className="bubble-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenu((v) => !v);
          }}
          aria-label="Message options"
        >
          &#9662;
        </button>

        {menu && (
          <>
            <div className="menu-backdrop" onClick={() => setMenu(false)} />
            <div className={`menu menu-bubble ${mine ? 'left' : 'right'}`}>
              <div className="reaction-strip">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      onReact(message, emoji);
                      setMenu(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <button onClick={() => { onReply(message); setMenu(false); }}>Reply</button>
              <button onClick={() => { onForward(message); setMenu(false); }}>Forward</button>
              <button onClick={() => { onStar(message); setMenu(false); }}>
                {message.isStarred ? 'Unstar' : 'Star'}
              </button>
              {message.body && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(message.body).catch(() => {});
                    setMenu(false);
                  }}
                >
                  Copy text
                </button>
              )}
              <button className="danger" onClick={() => { onDelete(message, false); setMenu(false); }}>
                Delete for me
              </button>
              {mine && (
                <button className="danger" onClick={() => { onDelete(message, true); setMenu(false); }}>
                  Delete for everyone
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
