import { useState } from 'react';
import { useWa } from '../store';

export default function Login() {
  const { login } = useWa();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qr-screen">
      <div className="qr-brand">
        <span className="qr-brand-dot" />
        WhatsApp Business Inbox
      </div>

      <div className="qr-card login-card">
        <div className="qr-instructions">
          <h1>Sign in</h1>
          <p className="qr-note">
            Staff access only. Messages are sent through the Meta WhatsApp Cloud API.
          </p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              autoComplete="username"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="qr-error">{error}</p>}

          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
