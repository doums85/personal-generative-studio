'use client';

import { useEffect, useState } from 'react';

/**
 * "Se déconnecter" for the studio header. It asks the server who is signed in (and with which login system), then ends that
 * session: through this site's /api/auth for the Convex login, through /api/studio/session for the password login.
 * Nothing is shown when there is no session to end (local preview) or while the answer is not known.
 */
export default function SignOutButton({ label = 'Se déconnecter', busyLabel = 'Déconnexion…' }) {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/studio/session', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled && body && body.provider !== 'preview') setSession(body); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!session) return null;

  async function signOut() {
    setBusy(true);
    try {
      if (session.provider === 'convex') {
        await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth:signOut', args: {} }) });
      } else {
        await fetch('/api/studio/session', { method: 'POST' });
      }
    } catch {
      // Even if the request failed, going to the login page shows the truth: it redirects back if the session is still alive.
    }
    window.location.assign('/login');
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      title={session.email ? `${label} (${session.email})` : label}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-[13px] font-bold text-white/80 hover:text-white hover:bg-white/10 hover:border-white/20 transition-colors disabled:opacity-60"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      <span className="hidden sm:inline">{busy ? busyLabel : label}</span>
    </button>
  );
}
