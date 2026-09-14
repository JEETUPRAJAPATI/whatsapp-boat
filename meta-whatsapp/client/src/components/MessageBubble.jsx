import MediaAttachment from './MediaAttachment';
import { Ticks } from './Icons';
import { ackFor, clockTime, richTokens } from '../lib/format';

function RichText({ text }) {
  return (
    <>
      {richTokens(text).map((token, i) => {
        switch (token.kind) {
          case 'link':
            return (
              <a
                key={i}
                href={token.value.startsWith('http') ? token.value : `https://${token.value}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {token.value}
              </a>
            );
          case 'bold':
            return <strong key={i}>{token.value}</strong>;
          case 'italic':
            return <em key={i}>{token.value}</em>;
          case 'strike':
            return <s key={i}>{token.value}</s>;
          case 'mono':
            return <code key={i}>{token.value}</code>;
          default:
            return <span key={i}>{token.value}</span>;
        }
      })}
    </>
  );
}

/* Types whose payload is a file we fetch and render. */
const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

/* Types with no file: shown as a short label instead. */
const LABEL_ONLY = {
  location: 'Location',
  contacts: 'Contact card',
};

export default function MessageBubble({ message, onRetry, onOpenMedia }) {
  const mine = message.fromMe;
  const failed = message.status === 'FAILED';
  const isMedia = MEDIA_TYPES.includes(message.type);
  const label = LABEL_ONLY[message.type];
  // A caption already sits under the media, so don't print it twice.
  const bodyText = isMedia ? message.caption || null : message.text;

  return (
    <div className={`bubble-row ${mine ? 'mine' : ''}`}>
      <div className={`bubble ${failed ? 'failed' : ''} ${isMedia ? 'has-media' : ''}`}>
        {message.type === 'template' && <div className="bubble-tag">Template message</div>}

        {message.pending && <div className="bubble-uploading">Sending...</div>}

        {isMedia && <MediaAttachment message={message} onOpen={onOpenMedia} />}

        {label && <div className="media-placeholder">{label}</div>}

        {bodyText && (
          <div className="bubble-text">
            <RichText text={bodyText} />
          </div>
        )}

        {!bodyText && !isMedia && !label && (
          <div className="bubble-text bubble-muted">Unsupported message</div>
        )}

        {failed && message.error && (
          <div className="bubble-error">
            {message.error.message || 'Delivery failed'}
            {message.error.code ? ` (code ${message.error.code})` : ''}
            {onRetry && (
              <button className="retry-link" onClick={() => onRetry(message)}>
                Retry
              </button>
            )}
          </div>
        )}

        <div className="bubble-meta">
          <span>{clockTime(message.timestamp)}</span>
          {mine && <Ticks ack={ackFor(message.status)} failed={failed} />}
        </div>
      </div>
    </div>
  );
}
