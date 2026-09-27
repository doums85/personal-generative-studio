'use client';

import { useMemo, useState } from 'react';
import { formatUsd } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import { GenerationDetail, GenerationThumb } from './GenerationCard';
import { Chip, EmptyState, Icon } from './ui';

const FILTERS = [
  ['all', 'Tout', 'grid'], ['image', 'Images', 'image'], ['video', 'Vidéos', 'video'], ['talking', 'Avatars parlants', 'mic'], ['speech', 'Voix', 'wave'], ['favorites', 'Favoris', 'star'],
];

export default function GalleryView({ navigate }) {
  const { generations, workspace } = useStudio();
  const [filter, setFilter] = useState('all');
  const [viewing, setViewing] = useState(null);

  const visible = useMemo(() => generations.filter((item) => filter === 'all' || (filter === 'favorites' ? item.favorite : item.kind === filter)), [generations, filter]);
  const spent = generations.reduce((total, item) => total + (item.estimate?.amount || 0), 0);
  const current = viewing ? generations.find((item) => item.id === viewing.id) || viewing : null;

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">{workspace?.name}</p>
          <h1 className="mt-1 text-2xl font-semibold">Galerie du projet</h1>
          <p className="mt-1.5 text-sm text-white/45">Toutes les créations sont conservées sur le serveur avec leur prompt, leur modèle et leur coût estimé. Ouvrez-en une pour l’animer, la décliner ou l’enregistrer comme élément.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Créations" value={generations.length} />
          <Stat label="Vidéos" value={generations.filter((item) => item.kind === 'video' || item.kind === 'talking').length} />
          <Stat label="Dépense estimée" value={formatUsd(spent)} />
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map(([id, label, icon]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}><Icon name={icon} size={12} />{label}</Chip>)}
      </div>
      {visible.length === 0 ? (
        <EmptyState icon="grid" title="Rien ici pour l’instant" description="Générez une image ou une vidéo : elle apparaîtra dans cette galerie." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {visible.map((generation) => <GenerationThumb key={generation.id} generation={generation} onOpen={setViewing} />)}
        </div>
      )}
      {current && <GenerationDetail generation={current} onClose={() => setViewing(null)} navigate={navigate} />}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
