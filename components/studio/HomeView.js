'use client';

import { useState } from 'react';
import Image from 'next/image';
import { KIND_META, formatUsd } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import { GenerationDetail, GenerationThumb } from './GenerationCard';
import { Button, EmptyState, Icon, cx } from './ui';

const ACTIONS = [
  { view: 'image', icon: 'image', title: 'Créer une image', text: 'Scènes, portraits, packshots avec vos personnages et lieux.', tone: 'from-cyan-300/20 to-sky-500/10' },
  { view: 'video', icon: 'video', title: 'Créer une vidéo', text: 'Texte, image de départ ou références, avec ou sans audio natif.', tone: 'from-violet-400/20 to-fuchsia-500/10' },
  { view: 'talking', icon: 'mic', title: 'Faire parler un avatar', text: 'Voix synthétisée synchronisée sur les lèvres de votre présentateur.', tone: 'from-fuchsia-400/20 to-rose-500/10' },
  { view: 'elements', icon: 'users', title: 'Gérer les éléments', text: 'Personnages, avatars, lieux, produits et styles réutilisables.', tone: 'from-emerald-300/20 to-teal-500/10' },
];

const STEPS = [
  ['1', 'Créez vos éléments', 'Un personnage principal avec 2 ou 3 photos, ou une planche générée par l’IA. Ajoutez un lieu et un style.'],
  ['2', 'Composez avec @', 'Dans Image ou Vidéo, écrivez « @Maya au @Café ». Les références partent avec le prompt.'],
  ['3', 'Enchaînez', 'Depuis la galerie : animer une image, la décliner, en faire un avatar qui parle.'],
];

export default function HomeView({ navigate }) {
  const { workspace, elements, generations } = useStudio();
  const [viewing, setViewing] = useState(null);
  const recent = generations.slice(0, 12);
  const counts = workspace?.counts || {};

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(ellipse_at_top_left,rgba(34,211,238,0.16),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(168,85,247,0.16),transparent_55%),#0a0a0f] p-6 md:p-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Projet actif</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{workspace?.name}</h1>
        {workspace?.description && <p className="mt-2 max-w-2xl text-sm text-white/55">{workspace.description}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Éléments" value={counts.elements ?? 0} icon="users" />
          <Stat label="Images" value={counts.images ?? 0} icon="image" />
          <Stat label="Vidéos" value={counts.videos ?? 0} icon="video" />
          <Stat label="Dépense estimée" value={formatUsd(workspace?.estimatedSpendUsd)} icon="tag" />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACTIONS.map((action) => (
          <button key={action.view} type="button" onClick={() => navigate(action.view)} className={cx('group rounded-2xl border border-white/[0.08] bg-gradient-to-br p-5 text-left transition hover:-translate-y-0.5 hover:border-white/20', action.tone)}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-white transition group-hover:bg-white/[0.14]"><Icon name={action.icon} size={18} /></span>
            <p className="mt-4 text-sm font-semibold">{action.title}</p>
            <p className="mt-1 text-xs leading-5 text-white/50">{action.text}</p>
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1fr_360px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Dernières créations</h2>
            <button type="button" onClick={() => navigate('gallery')} className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">Galerie →</button>
          </div>
          {recent.length === 0 ? (
            <EmptyState icon="spark" title="Aucune création pour l’instant" description="Le tableau de bord se remplira au fil de vos images, vidéos et voix." action={<Button variant="primary" icon="image" onClick={() => navigate('image')}>Générer une première image</Button>} />
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{recent.map((generation) => <GenerationThumb key={generation.id} generation={generation} onOpen={setViewing} />)}</div>
          )}
        </section>
        <aside className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white/80">Éléments</h2>
              <button type="button" onClick={() => navigate('elements')} className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">Tout voir →</button>
            </div>
            {elements.length === 0 ? (
              <button type="button" onClick={() => navigate('elements')} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-3 text-left text-xs text-white/50 hover:border-cyan-300/40 hover:text-white"><Icon name="plus" size={16} />Créer un premier personnage</button>
            ) : (
              <div className="space-y-2">
                {elements.slice(0, 6).map((element) => (
                  <button key={element.id} type="button" onClick={() => navigate('elements')} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2 text-left hover:border-white/20">
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-black/40">{element.images?.[0] ? <Image src={element.images[0].url} alt="" fill unoptimized sizes="40px" className="object-cover" /> : <span className="flex h-full w-full items-center justify-center text-white/30"><Icon name={KIND_META[element.kind]?.icon} size={16} /></span>}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{element.name}</span><span className="block text-[10px] uppercase tracking-wide text-white/35">{KIND_META[element.kind]?.label}</span></span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold text-white/80">Comment travailler</h2>
            <ol className="mt-3 space-y-3">
              {STEPS.map(([number, title, text]) => (
                <li key={number} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-[11px] font-bold text-cyan-200">{number}</span><span><span className="block text-xs font-semibold text-white">{title}</span><span className="block text-[11px] leading-4 text-white/45">{text}</span></span></li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      {viewing && <GenerationDetail generation={viewing} onClose={() => setViewing(null)} navigate={navigate} />}
    </div>
  );
}

function Stat({ label, value, icon }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/70"><Icon name={icon} size={16} /></span>
      <span><span className="block text-[10px] uppercase tracking-wide text-white/35">{label}</span><span className="block text-lg font-semibold text-white">{value}</span></span>
    </div>
  );
}
