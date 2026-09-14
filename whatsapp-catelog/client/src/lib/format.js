/** Presentation helpers shared by every screen. */

const CURRENCY_LOCALE = {
  INR: 'en-IN',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  AED: 'en-AE',
};

/**
 * Money, in the currency's own convention.
 * Indian rupees group as 25,00,000 rather than 2,500,000, which matters when
 * the operator is checking a property price at a glance.
 */
export function formatMoney(amount, currency = 'INR', { compact = false } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '-';

  const locale = CURRENCY_LOCALE[currency] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      notation: compact && value >= 1_000_000 ? 'compact' : 'standard',
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
}

/** "3:45 pm" for today, "12 Sep" this year, "12 Sep 2025" otherwise. */
export function formatDate(input, { withTime = false } = {}) {
  if (!input) return '-';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '-';

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const sameYear = date.getFullYear() === now.getFullYear();

  if (sameDay && !withTime) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const datePart = date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (!withTime) return datePart;

  return `${datePart}, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatTime(input) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function formatRelative(input) {
  if (!input) return 'never';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return 'never';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return formatDate(input, { withTime: true });
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d ago`;
  return formatDate(input);
}

/** Countdown for the 24-hour service window. */
export function formatCountdown(expiresAt) {
  if (!expiresAt) return null;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return null;

  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

/** "+91 81400 87463" from raw digits. */
export function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '-';
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

export function initials(name, fallback = '?') {
  const text = String(name || '').trim();
  if (!text) return fallback;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] + parts[parts.length - 1][0]).slice(0, 2);
}

export function truncate(text, max = 80) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Turns SNAKE_CASE enums into "Snake case" for display. */
export function humanize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------- statuses

export const AVAILABILITY_LABELS = {
  IN_STOCK: 'In stock',
  OUT_OF_STOCK: 'Out of stock',
  PREORDER: 'Pre-order',
  AVAILABLE_FOR_ORDER: 'Available to order',
  DISCONTINUED: 'Discontinued',
};

export function availabilityTone(value) {
  if (value === 'IN_STOCK') return 'success';
  if (value === 'OUT_OF_STOCK' || value === 'DISCONTINUED') return 'danger';
  return 'warn';
}

export function syncTone(status) {
  switch (status) {
    case 'SYNCED':
      return 'success';
    case 'PENDING':
      return 'warn';
    case 'FAILED':
      return 'danger';
    case 'CONFLICT':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function connectionTone(status) {
  switch (status) {
    case 'CONNECTED':
      return 'success';
    case 'PENDING':
      return 'warn';
    case 'ERROR':
      return 'danger';
    case 'DISCONNECTED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function qualityTone(rating) {
  switch (String(rating || '').toUpperCase()) {
    case 'GREEN':
      return 'success';
    case 'YELLOW':
      return 'warn';
    case 'RED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function syncRunTone(status) {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'PARTIAL':
      return 'warn';
    case 'FAILED':
      return 'danger';
    case 'RUNNING':
      return 'info';
    default:
      return 'neutral';
  }
}
