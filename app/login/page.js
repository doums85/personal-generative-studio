import { auth, signIn } from '@/auth';
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
            Ce compte Google n’est pas autorisé à accéder au studio.
          </p>
        )}
        <form className="mt-8" action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/studio' });
        }}>
          <button type="submit" className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-black transition hover:bg-cyan-100">
            Continuer avec Google
          </button>
        </form>
        <p className="mt-5 text-center text-xs text-white/35">
          L’accès est limité à l’adresse configurée par le propriétaire.
        </p>
      </section>
    </main>
  );
}
