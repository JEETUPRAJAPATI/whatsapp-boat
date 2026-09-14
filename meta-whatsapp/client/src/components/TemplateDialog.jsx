import { useState } from 'react';
import { IconClose } from './Icons';
import { useWa } from '../store';

/**
 * Sends an approved WhatsApp template. Body parameters are free-form here so
 * any approved template can be used without a code change.
 */
export default function TemplateDialog({ onClose }) {
  const { sendTemplate, sending } = useWa();
  const [name, setName] = useState('hello_world');
  const [language, setLanguage] = useState('en_US');
  const [params, setParams] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const values = params
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);

    const components = values.length
      ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
      : undefined;

    try {
      await sendTemplate(name.trim(), language.trim(), components);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>Send template message</strong>
          <button className="icon-btn tiny" onClick={onClose} title="Close">
            <IconClose width={18} height={18} />
          </button>
        </header>

        <form className="modal-body" onSubmit={submit}>
          <label className="field">
            <span>Template name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="hello_world"
              required
            />
          </label>

          <label className="field">
            <span>Language code</span>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="en_US"
              required
            />
          </label>

          <label className="field">
            <span>Body parameters (one per line, optional)</span>
            <textarea
              rows={3}
              value={params}
              onChange={(e) => setParams(e.target.value)}
              placeholder={'Riya\nORD-1042'}
            />
          </label>

          <p className="qr-note">
            The template must already be approved for your WhatsApp Business Account.
          </p>

          {error && <p className="qr-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={sending || !name.trim()}>
              {sending ? 'Sending...' : 'Send template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
