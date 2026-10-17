import { AuthError } from 'next-auth';
import { auth, signIn } from '@/auth';
import { signInWithPassword } from '@/lib/login-action.mjs';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Connexion — Personal Generative Studio' };

export default async function LoginPage({ searchParams }) {
  const session = await auth();
  if (session?.user) redirect('/studio');
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Espace privé</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Personal Generative Studio</h1>
        <p className="mt-3 text-sm leading-6 text-white/55">
          Images, vidéos, musique, voix et workflows créatifs dans votre studio personnel.
        </p>
        {params?.error && (
          <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            Adresse e-mail ou mot de passe incorrect.
          </p>
        )}
        <form className="mt-8 space-y-4" action={async (formData) => {
          'use server';
          await signInWithPassword(formData, { signIn, redirect, isAuthError: (error) => error instanceof AuthError });
        }}>
          <label className="block text-sm text-white/70">
            Adresse e-mail
            <input name="email" type="email" required autoComplete="username" className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-cyan-300/60" />
          </label>
          <label className="block text-sm text-white/70">
            Mot de passe
            <input name="password" type="password" required autoComplete="current-password" className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-cyan-300/60" />
          </label>
          <button type="submit" className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-cyan-100">
            Se connecter
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-white/35">
          L’accès est limité à l’adresse du propriétaire.
        </p>
      </section>
    </main>
  );
}
