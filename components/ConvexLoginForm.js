'use client';

import { useState } from 'react';
import { safeCallbackPath } from '@/lib/login-redirect.mjs';

const inputClass = 'mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-cyan-300/60';

/**
 * Login form for LOGIN_PROVIDER=convex. It talks to this site's own /api/auth, which relays to Convex and stores the
 * session in httpOnly cookies: the browser never receives the refresh token and never contacts Convex.
 */
export default function ConvexLoginForm({ callbackUrl }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'auth:signIn',
          args: { provider: 'password', params: { email: String(form.get('email') ?? '').trim(), password: String(form.get('password') ?? ''), flow: 'signIn' } },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.tokens) {
        window.location.assign(safeCallbackPath(callbackUrl));
        return;
      }
      setError(/TooManyFailedAttempts/i.test(String(body.error)) ? 'Trop de tentatives échouées. Réessayez dans une heure.' : 'Adresse e-mail ou mot de passe incorrect.');
    } catch {
      setError('Impossible de joindre le serveur. Réessayez.');
    }
    setBusy(false);
  }

  return (
    <>
      {error && <p role="alert" data-testid="login-error" className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</p>}
      <form className="mt-8 space-y-4" onSubmit={submit}>
        <label className="block text-sm text-white/70">
          Adresse e-mail
          <input name="email" type="email" required autoComplete="username" className={inputClass} />
        </label>
        <label className="block text-sm text-white/70">
          Mot de passe
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </label>
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-cyan-100 disabled:opacity-60">
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </>
  );
}
