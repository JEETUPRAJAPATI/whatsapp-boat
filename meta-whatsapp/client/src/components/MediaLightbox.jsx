import { useEffect } from 'react';
import { IconClose } from './Icons';

/** Full-screen image viewer; Escape or a click on the backdrop closes it. */
export default function MediaLightbox({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="icon-btn lightbox-close" onClick={onClose} title="Close">
        <IconClose />
      </button>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
