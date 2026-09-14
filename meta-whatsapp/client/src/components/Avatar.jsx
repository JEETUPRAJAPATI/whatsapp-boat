import { colorFor, initials } from '../lib/format';

/**
 * Initials avatar. The Cloud API never exposes a customer's profile photo,
 * so unlike the whatsapp-web.js client there is no image to fetch.
 */
export default function Avatar({ id, name, size = 49, className = '' }) {
  return (
    <div
      className={`avatar avatar-fallback ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size / 2.6),
        background: colorFor(id || name || ''),
      }}
      aria-hidden="true"
    >
      {initials(name || id)}
    </div>
  );
}
