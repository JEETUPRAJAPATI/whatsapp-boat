import { useApp } from '../store/AppContext';
import { IconAlert, IconCheckCircle, IconInfo, IconX } from './Icons';

const ICONS = {
  success: IconCheckCircle,
  error: IconAlert,
  warn: IconAlert,
  info: IconInfo,
};

/** Live region so a screen reader announces results, not just sighted users. */
export default function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Glyph = ICONS[toast.kind] || IconInfo;
        return (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <Glyph size={17} className="toast-icon" />
            <span className="toast-text">{toast.text}</span>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
            >
              <IconX size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
