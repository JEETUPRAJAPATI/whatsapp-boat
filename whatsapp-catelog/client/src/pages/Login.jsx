import { useState } from 'react';
import { IconWhatsapp } from '../components/Icons';
import { Alert, Button, Input } from '../components/ui';
import { useApp } from '../store/AppContext';

export default function Login() {
  const { signIn } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <IconWhatsapp size={24} />
        </div>

        <div className="center" style={{ marginBottom: 'var(--space-6)' }}>
          <h1 style={{ fontSize: 19 }}>Catalog Manager</h1>
          <p className="small muted" style={{ marginTop: 4 }}>
            Sign in to manage your WhatsApp Business catalog
          </p>
        </div>

        {error && (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        <div className="col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
            autoComplete="username"
            required
            autoFocus
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
          <Button type="submit" variant="primary" size="lg" block loading={pending}>
            Sign in
          </Button>
        </div>
      </form>
    </div>
  );
}
