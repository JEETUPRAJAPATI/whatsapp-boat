import { useRef, useState } from 'react';
import { useAction } from '../hooks/useAsync';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useApp } from '../store/AppContext';
import { IconImage, IconUpload, IconVideo } from './Icons';
import { Alert, Button } from './ui';

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
const VIDEO_TYPES = 'video/mp4,video/quicktime,video/3gpp';

/**
 * Product images and videos.
 *
 * Images are what Meta ingests into the catalog (by public URL); videos are
 * kept for sending to customers as WhatsApp media, since the catalog item
 * itself only carries stills. The distinction is made explicit in the UI so
 * nobody uploads a video expecting it on the product card.
 */
export default function MediaManager({ productId, media = [], onChange, disabled }) {
  const { toast, toastError } = useApp();
  const { pending, perform } = useAction();
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);

  const imageInput = useRef(null);
  const videoInput = useRef(null);

  const images = media.filter((m) => m.kind === 'IMAGE');
  const videos = media.filter((m) => m.kind === 'VIDEO');

  const uploadFiles = async (files, kind) => {
    if (!productId) {
      toast('Save the product first, then add media.', 'warn');
      return;
    }

    for (const file of Array.from(files)) {
      setProgress({ name: file.name, percent: 0 });
      try {
        const upload = kind === 'VIDEO' ? api.uploadProductVideo : api.uploadProductImage;
        await upload(productId, file, (percent) => setProgress({ name: file.name, percent }));
      } catch (err) {
        toastError(err);
      }
    }

    setProgress(null);
    onChange?.();
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;

    const files = Array.from(event.dataTransfer.files || []);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));

    if (imageFiles.length) uploadFiles(imageFiles, 'IMAGE');
    if (videoFiles.length) uploadFiles(videoFiles, 'VIDEO');
  };

  const setPrimary = async (mediaId) => {
    const result = await perform(() => api.setPrimaryImage(productId, mediaId));
    if (result) {
      toast('Main image updated.');
      onChange?.();
    }
  };

  const remove = async (mediaId) => {
    const result = await perform(() => api.deleteProductMedia(productId, mediaId));
    if (result) {
      toast('File removed.');
      onChange?.();
    }
  };

  return (
    <div className="col gap-4">
      {!productId && (
        <Alert tone="info">
          Save this product as a draft first — media is attached to a saved product.
        </Alert>
      )}

      {/* ------------------------------------------------------------ images */}
      <div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div>
            <div className="strong small">Product images</div>
            <div className="field-hint">
              The main image appears on the product card in WhatsApp. Meta requires at least
              500×500, JPG, PNG or WebP.
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<IconUpload size={14} />}
            onClick={() => imageInput.current?.click()}
            disabled={disabled || !productId || Boolean(progress)}
          >
            Add images
          </Button>
        </div>

        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_TYPES}
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(e.target.files, 'IMAGE');
            e.target.value = '';
          }}
        />

        <div
          className="media-grid"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {images.map((item) => (
            <figure className={`media-item ${item.isPrimary ? 'is-primary' : ''}`} key={item.id}>
              <img src={item.url} alt="" loading="lazy" />
              {item.isPrimary && <span className="media-badge">Main</span>}
              <div className="media-actions">
                {!item.isPrimary && (
                  <button type="button" onClick={() => setPrimary(item.id)} disabled={pending}>
                    Set main
                  </button>
                )}
                <button type="button" onClick={() => remove(item.id)} disabled={pending}>
                  Remove
                </button>
              </div>
            </figure>
          ))}

          <button
            type="button"
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onClick={() => imageInput.current?.click()}
            disabled={disabled || !productId || Boolean(progress)}
          >
            {progress ? (
              <>
                <span className="spinner" />
                <span>{progress.percent}%</span>
              </>
            ) : (
              <>
                <IconImage size={20} />
                <span>Drop images or click</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ videos */}
      <div>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div>
            <div className="strong small">Videos</div>
            <div className="field-hint">
              Sent to customers as WhatsApp video messages. Meta catalog items themselves only carry
              images, so videos do not appear on the product card.
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<IconVideo size={14} />}
            onClick={() => videoInput.current?.click()}
            disabled={disabled || !productId || Boolean(progress)}
          >
            Add video
          </Button>
        </div>

        <input
          ref={videoInput}
          type="file"
          accept={VIDEO_TYPES}
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(e.target.files, 'VIDEO');
            e.target.value = '';
          }}
        />

        {videos.length > 0 && (
          <div className="media-grid">
            {videos.map((item) => (
              <figure className="media-item" key={item.id}>
                <video src={item.url} muted playsInline preload="metadata" />
                <span className="media-badge" style={{ background: 'var(--gray-700)' }}>
                  {formatBytes(item.sizeBytes)}
                </span>
                <div className="media-actions">
                  <button type="button" onClick={() => remove(item.id)} disabled={pending}>
                    Remove
                  </button>
                </div>
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
