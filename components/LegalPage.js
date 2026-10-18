export default function LegalPage({ title, updated, children }) {
  return (
    <main className="min-h-screen bg-[#050505] text-white px-6 py-16">
      <article className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Personal Generative Studio</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-white/45">Dernière mise à jour : {updated}</p>
        <div className="mt-8 space-y-6 text-sm leading-7 text-white/70">{children}</div>
      </article>
    </main>
  );
}

export function LegalSection({ title, children }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}
