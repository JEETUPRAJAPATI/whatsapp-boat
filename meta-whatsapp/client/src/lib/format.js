/** Helpers for turning API shapes into something readable. */

const AVATAR_COLORS = [
  '#dfa2a2', '#a2c4df', '#a2dfb4', '#dfd0a2', '#c9a2df',
  '#a2dfd8', '#dfb9a2', '#b4a2df', '#a2b0df', '#d5dfa2',
];

export function initials(name = '') {
  const clean = String(name).trim();
  if (!clean) return '?';
  if (/^\+?\d+$/.test(clean)) return '#';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function colorFor(id = '') {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Renders a bare MSISDN from Meta as a readable number. */
export function phoneOf(number = '') {
  const digits = String(number).replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}

/** The API speaks ISO 8601; everything below accepts that or a Date. */
function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n) => String(n).padStart(2, '0');

export function clockTime(value) {
  const d = toDate(value);
  if (!d) return '';
  let h = d.getHours();
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${suffix}`;
}

/** WhatsApp-style relative stamp used in the conversation list. */
export function listTime(value) {
  const d = toDate(value);
  if (!d) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return clockTime(d);
  if (t >= startOfToday - 86400000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Day separator label between message groups. */
export function dayLabel(value) {
  const d = toDate(value);
  if (!d) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (t === startOfToday) return 'Today';
  if (t === startOfToday - 86400000) return 'Yesterday';
  if (t > startOfToday - 6 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
}

export function fullDate(value) {
  const d = toDate(value);
  if (!d) return '--';
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function sameDay(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Countdown label for the 24h customer service window. */
export function windowRemaining(expiresAt) {
  const d = toDate(expiresAt);
  if (!d) return '';
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

/**
 * Full h/m/s breakdown for the live composer countdown. Takes the already
 * computed remaining milliseconds so the caller owns the ticking clock.
 */
export function countdownLabel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0h 00m 00s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const TYPE_LABELS = {
  image: '\u{1F4F7} Photo',
  video: '\u{1F3A5} Video',
  audio: '\u{1F3A7} Audio',
  document: '\u{1F4C4} Document',
  sticker: 'Sticker',
  location: '\u{1F4CD} Location',
  contacts: '\u{1F464} Contact',
  reaction: 'Reaction',
  template: '\u{1F4CB} Template',
};

/** One-line preview for the conversation list. */
export function previewOf(message) {
  if (!message) return '';
  const label = TYPE_LABELS[message.type];
  if (label) return message.text ? `${label.split(' ')[0]} ${message.text}` : label;
  return message.text || '';
}

/** Ticks in the UI reuse the whatsapp-web.js ack scale: 1 sent .. 3 read. */
export function ackFor(status) {
  switch (status) {
    case 'PENDING':
      return 0;
    case 'SENT':
    case 'RECEIVED':
      return 1;
    case 'DELIVERED':
      return 2;
    case 'READ':
      return 3;
    default:
      return 0;
  }
}

/**
 * Renders WhatsApp's inline markup (*bold*, _italic_, ~strike~, ```mono```)
 * and links as React-ready tokens.
 */
export function richTokens(text = '') {
  const tokens = [];
  const pattern =
    /(https?:\/\/[^\s<]+|www\.[^\s<]+)|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|```([\s\S]+?)```/g;
  let last = 0;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[1]) tokens.push({ kind: 'link', value: m[1] });
    else if (m[2]) tokens.push({ kind: 'bold', value: m[2] });
    else if (m[3]) tokens.push({ kind: 'italic', value: m[3] });
    else if (m[4]) tokens.push({ kind: 'strike', value: m[4] });
    else if (m[5]) tokens.push({ kind: 'mono', value: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });
  return tokens;
}
