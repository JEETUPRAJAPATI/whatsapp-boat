/** Helpers for turning WhatsApp's raw shapes into something readable. */

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

export function phoneOf(id = '') {
  const raw = String(id).split('@')[0];
  return raw ? `+${raw}` : '';
}

export function isGroupId(id = '') {
  return String(id).endsWith('@g.us');
}

const pad = (n) => String(n).padStart(2, '0');

export function clockTime(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  let h = d.getHours();
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${suffix}`;
}

/** WhatsApp-style relative stamp used in the chat list. */
export function listTime(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return clockTime(unixSeconds);
  if (t >= startOfToday - 86400000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Day separator label between message groups. */
export function dayLabel(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
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

export function sameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

const TYPE_LABELS = {
  image: '\u{1F4F7} Photo',
  video: '\u{1F3A5} Video',
  audio: '\u{1F3A7} Audio',
  ptt: '\u{1F3A4} Voice message',
  document: '\u{1F4C4} Document',
  sticker: 'Sticker',
  location: '\u{1F4CD} Location',
  vcard: '\u{1F464} Contact',
  multi_vcard: '\u{1F464} Contacts',
  revoked: 'This message was deleted',
  call_log: '\u{1F4DE} Call',
};

/** One-line preview for the chat list and reply strips. */
export function previewOf(message) {
  if (!message) return '';
  if (message.isDeleted) return 'This message was deleted';
  const label = TYPE_LABELS[message.type];
  if (label) return message.body ? `${label.split(' ')[0]} ${message.body}` : label;
  return message.body || '';
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

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
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
