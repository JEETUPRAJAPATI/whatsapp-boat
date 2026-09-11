import { useEffect } from 'react';
import { useWa } from '../store';
import { IconClose, IconDownload } from './Icons';
import { clockTime } from '../lib/format';

export default function MediaLightbox({ message, onClose }) {
  const { mediaUrl } = useWa();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isVideo = message.type === 'video';

  return (
    <div className="lightbox" onClick={onClose}>
      <header className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>
          {message.fromMe ? 'You' : message.notifyName || 'Photo'} · {clockTime(message.timestamp)}
        </span>
        <div>
          <a
            className="icon-btn"
            href={mediaUrl(message.id, true)}
            target="_blank"
            rel="noreferrer noopener"
            title="Download"
          >
            <IconDownload />
          </a>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose />
          </button>
        </div>
      </header>

      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video src={mediaUrl(message.id)} controls autoPlay />
        ) : (
          <img src={mediaUrl(message.id)} alt={message.body || ''} />
        )}
      </div>

      {message.body && <p className="lightbox-caption">{message.body}</p>}
    </div>
  );
}
