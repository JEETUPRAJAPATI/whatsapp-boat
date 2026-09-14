import { useEffect, useId, useRef, useState } from 'react';
import {
  IconAlert,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconInfo,
  IconSearch,
  IconX,
} from '../Icons';

/**
 * The shared UI kit.
 *
 * Every page composes these, which is what keeps twelve screens looking like
 * one product. Each component is deliberately thin - a class name and the
 * accessibility wiring - so the CSS stays the single source of styling truth.
 */

// -------------------------------------------------------------------- button

export function Button({
  variant = 'secondary',
  size,
  loading = false,
  icon,
  block = false,
  children,
  className = '',
  disabled,
  ...rest
}) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    !children ? 'btn-icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

// --------------------------------------------------------------------- field

export function Field({ label, hint, error, required, children, className = '' }) {
  const id = useId();
  const child =
    typeof children === 'function'
      ? children({ id, 'aria-invalid': error ? 'true' : undefined })
      : children;

  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {typeof children === 'function' ? child : <div id={id}>{child}</div>}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

/** Label + input in one call, for the common case. */
export function Input({ label, hint, error, required, className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => <input className="input" {...props} {...rest} />}
    </Field>
  );
}

export function Textarea({ label, hint, error, required, className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => <textarea className="textarea" {...props} {...rest} />}
    </Field>
  );
}

export function Select({ label, hint, error, required, options = [], className, children, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(props) => (
        <select className="select" {...props} {...rest}>
          {children ||
            options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ label, hint, ...rest }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" {...rest} />
      <span>
        <span className="strong">{label}</span>
        {hint && <div className="field-hint">{hint}</div>}
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', ...rest }) {
  return (
    <div className="search">
      <IconSearch size={15} />
      <input
        className="input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}

// --------------------------------------------------------------------- card

export function Card({ title, description, actions, footer, children, bodyClass = '', className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <div className="small muted">{description}</div>}
          </div>
          {actions && <div className="row gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={`card-body ${bodyClass}`}>{children}</div>}
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon }) {
  return (
    <div className={`stat ${tone ? `stat-accent-${tone}` : ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// -------------------------------------------------------------------- badge

export function Badge({ tone = 'neutral', dot = false, children }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

// -------------------------------------------------------------------- alert

const ALERT_ICONS = {
  success: IconCheckCircle,
  warn: IconAlert,
  danger: IconAlert,
  info: IconInfo,
};

export function Alert({ tone = 'info', title, children, actions }) {
  const Glyph = ALERT_ICONS[tone] || IconInfo;
  return (
    <div className={`alert alert-${tone}`}>
      <Glyph size={17} className="alert-icon" />
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children}
      </div>
      {actions}
    </div>
  );
}

// ------------------------------------------------------------------ states

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <span className="spinner spinner-lg" />
      <span className="small">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty">
      <div className="empty-icon" style={{ color: 'var(--danger-fg)' }}>
        <IconAlert size={22} />
      </div>
      <h3>Could not load this</h3>
      <p>{error?.message || 'An unexpected error occurred.'}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- modal

export function Modal({ open, onClose, title, description, footer, size = '', children }) {
  const ref = useRef(null);

  // Escape closes, and the body must not scroll behind the overlay.
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog so keyboard users are not left behind it.
    ref.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal ${size ? `modal-${size}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-header">
          <div>
            <div className="modal-title">{title}</div>
            {description && <div className="modal-desc">{description}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Confirmation for destructive actions.
 *
 * Deliberately not window.confirm: deleting a product also deletes it from the
 * live Meta catalog, and that consequence deserves to be spelled out.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  variant = 'danger',
  pending = false,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={pending ? undefined : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

// --------------------------------------------------------------- pagination

export function Pagination({ page, pages, total, pageSize, onPage }) {
  if (!pages || pages <= 1) {
    return (
      <div className="pagination">
        <span className="small muted">
          {total} {total === 1 ? 'item' : 'items'}
        </span>
      </div>
    );
  }

  // A sliding window keeps the control narrow on a phone even at page 40.
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(pages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const numbers = [];
  for (let i = start; i <= end; i += 1) numbers.push(i);

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <span className="small muted">
        {from}–{to} of {total}
      </span>
      <div className="pagination-pages">
        <button className="page-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <IconChevronLeft size={15} />
        </button>
        {start > 1 && (
          <>
            <button className="page-btn" onClick={() => onPage(1)}>
              1
            </button>
            {start > 2 && <span className="page-btn" style={{ cursor: 'default' }}>…</span>}
          </>
        )}
        {numbers.map((number) => (
          <button
            key={number}
            className={`page-btn ${number === page ? 'active' : ''}`}
            onClick={() => onPage(number)}
            aria-current={number === page ? 'page' : undefined}
          >
            {number}
          </button>
        ))}
        {end < pages && (
          <>
            {end < pages - 1 && <span className="page-btn" style={{ cursor: 'default' }}>…</span>}
            <button className="page-btn" onClick={() => onPage(pages)}>
              {pages}
            </button>
          </>
        )}
        <button
          className="page-btn"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
        >
          <IconChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- tabs

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={active === tab.value}
          className={`tab ${active === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="muted"> ({tab.count})</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- chips

export function Chip({ children, onRemove }) {
  return (
    <span className="chip">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove">
          <IconX size={11} />
        </button>
      )}
    </span>
  );
}

/**
 * Comma / Enter separated tag entry, used for auto-reply keywords.
 * Kept controlled so the parent owns the array.
 */
export function ChipInput({ value = [], onChange, placeholder = 'Type and press Enter' }) {
  const [draft, setDraft] = useState('');

  const commit = (raw) => {
    const parts = String(raw)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;

    const next = [...value];
    for (const part of parts) {
      if (!next.some((existing) => existing.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setDraft('');
  };

  return (
    <div>
      <div className="row wrap gap-2" style={{ marginBottom: value.length ? 8 : 0 }}>
        {value.map((item, index) => (
          <Chip key={`${item}-${index}`} onRemove={() => onChange(value.filter((_, i) => i !== index))}>
            {item}
          </Chip>
        ))}
      </div>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
