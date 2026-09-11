import { useEffect, useState } from 'react';
import { colorFor, initials } from '../lib/format';
import { useWa } from '../store';
import { IconGroup } from './Icons';

/**
 * Profile photo with an initials fallback. The server answers 204 when a
 * contact has no picture (or hides it), which fires onError here.
 */
export default function Avatar({ id, name, size = 49, isGroup = false, className = '', sessionId }) {
  const { avatarUrl } = useWa();
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [id, sessionId]);

  const style = { width: size, height: size, fontSize: Math.round(size / 2.6) };
  const src = id ? avatarUrl(id, sessionId) : null;

  if (!src || failed) {
    return (
      <div
        className={`avatar avatar-fallback ${className}`}
        style={{ ...style, background: colorFor(id || name || '') }}
        aria-hidden="true"
      >
        {isGroup ? <IconGroup width={size * 0.55} height={size * 0.55} /> : initials(name)}
      </div>
    );
  }

  return (
    <img
      className={`avatar ${className}`}
      style={style}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
