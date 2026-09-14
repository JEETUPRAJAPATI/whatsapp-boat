import { useEffect, useState } from 'react';
import { IconClose, IconDoc, IconSend } from './Icons';
import { formatBytes } from '../lib/format';

/**
 * WhatsApp-style confirm step before a file goes out: preview, optional
 * caption, upload progress.
 */
export default function AttachPreview({ file, sending, progress, onSend, onCancel }) {
  const [caption, setCaption] = useState('');
  const [preview, setPreview] = useState(null);

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  useEffect(() => {
    if (!isImage && !isVideo) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    // Revoking on unmount keeps a big local file from being held in memory.
    return () => URL.revokeObjectURL(url);
  }, [file, isImage, isVideo]);

  const submit = (e) => {
    e.preventDefault();
    if (!sending) onSend(caption.trim());
  };

  return (
    <div className="modal-backdrop" onClick={sending ? undefined : onCancel}>
      <div className="modal attach-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>Send file</strong>
          <button className="icon-btn tiny" onClick={onCancel} disabled={sending} title="Cancel">
            <IconClose width={18} height={18} />
          </button>
        </header>

        <div className="attach-preview">
          {isImage && preview && <img src={preview} alt="" />}
          {isVideo && preview && <video src={preview} controls />}
          {!isImage && !isVideo && (
            <div className="attach-doc-icon">
              <IconDoc width={46} height={46} />
            </div>
          )}
        </div>

        <div className="attach-meta">
          <strong title={file.name}>{file.name}</strong>
          <span>
            {formatBytes(file.size)} · {file.type || 'unknown type'}
          </span>
        </div>

        <form className="modal-body" onSubmit={submit}>
          <input
            className="attach-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            disabled={sending}
            autoFocus
          />

          {sending && (
            <div className="upload-bar">
              <div className="upload-bar-fill" style={{ width: `${progress}%` }} />
              <span>{progress}%</span>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onCancel} disabled={sending}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? 'Sending...' : 'Send'}
              {!sending && <IconSend width={16} height={16} />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
