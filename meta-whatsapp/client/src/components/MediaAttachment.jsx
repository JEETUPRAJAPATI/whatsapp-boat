import { useEffect, useState } from 'react';
import { IconDoc, IconDownload } from './Icons';
import { mediaObjectUrl } from '../lib/api';
import { formatBytes } from '../lib/format';

/**
 * Renders a message's media. Bytes are pulled through our own authenticated
 * proxy (see mediaObjectUrl) because Meta's media URLs require the access
 * token, which never leaves the server.
 */
export default function MediaAttachment({ message, onOpen }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');
  const isDocument = message.type === 'document';

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError('');

    // Documents are fetched on demand - no point downloading a 50 MB PDF
    // just to draw a row for it.
    if (isDocument || !message.mediaId) return undefined;

    mediaObjectUrl(message.id)
      .then((objectUrl) => alive && setUrl(objectUrl))
      .catch((err) => alive && setError(err.message));

    return () => {
      alive = false;
    };
  }, [message.id, message.mediaId, isDocument]);

  const download = async () => {
    try {
      const objectUrl = url || (await mediaObjectUrl(message.id));
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = message.mediaFilename || `${message.type}-${message.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!message.mediaId) {
    return <div className="media-placeholder">{message.type} (no media attached)</div>;
  }

  if (error) {
    return <div className="media-placeholder media-broken">{error}</div>;
  }

  if (isDocument) {
    return (
      <button className="bubble-doc" onClick={download} title="Download">
        <IconDoc width={26} height={26} />
        <span className="bubble-doc-meta">
          <strong>{message.mediaFilename || 'Document'}</strong>
          <span>{message.mediaMimeType || 'file'}</span>
        </span>
        <IconDownload width={18} height={18} />
      </button>
    );
  }

  if (!url) {
    return (
      <div className="media-placeholder">
        <span className="spinner small" />
      </div>
    );
  }

  if (message.type === 'image' || message.type === 'sticker') {
    return (
      <div className={message.type === 'sticker' ? 'bubble-sticker' : 'bubble-image'}>
        <img
          src={url}
          alt={message.caption || 'Attachment'}
          onClick={() => onOpen && onOpen(url)}
          loading="lazy"
        />
      </div>
    );
  }

  if (message.type === 'video') {
    return (
      <div className="bubble-video">
        <video src={url} controls preload="metadata" />
      </div>
    );
  }

  if (message.type === 'audio') {
    return (
      <div className="bubble-audio">
        <audio src={url} controls preload="metadata" />
      </div>
    );
  }

  return (
    <button className="bubble-doc" onClick={download}>
      <IconDoc width={26} height={26} />
      <span className="bubble-doc-meta">
        <strong>{message.mediaFilename || message.type}</strong>
        <span>{formatBytes(message.mediaSize) || message.mediaMimeType}</span>
      </span>
      <IconDownload width={18} height={18} />
    </button>
  );
}
