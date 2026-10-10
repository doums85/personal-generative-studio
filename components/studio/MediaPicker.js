'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { formatDate, studioRef } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import { EmptyState, Modal, Segmented, cx } from './ui';

/**
 * Lets the user pick an existing image from the workspace gallery or from an element.
 * Returns `{ ref, url, label }` where `ref` is a `studio://` reference the server can resolve.
 */
export default function MediaPicker({ open, onClose, onPick, title = 'Choisir une image', accept = 'image' }) {
  const { workspaceId, generations, elements } = useStudio();
  const [source, setSource] = useState('gallery');

  const items = useMemo(() => {
    if (source === 'elements') {
      return elements.flatMap((element) => element.images.map((image) => ({ key: image.id, url: image.url, ref: studioRef(workspaceId, image.file), label: element.name, caption: element.name, mediaType: image.mediaType })));
    }
    return generations.flatMap((generation) => generation.files
      .filter((file) => file.mediaType.startsWith(`${accept}/`))
      .map((file) => ({ key: file.id, url: file.url, ref: studioRef(workspaceId, file.file), label: generation.prompt, caption: formatDate(generation.createdAt), mediaType: file.mediaType })));
  }, [source, elements, generations, workspaceId, accept]);

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle="Réutilisez une création du projet ou l’image de référence d’un élément." width="max-w-4xl">
      <Segmented value={source} onChange={setSource} options={[{ value: 'gallery', label: 'Galerie du projet' }, { value: 'elements', label: 'Éléments' }]} className="mb-4" />
      {items.length === 0 ? (
        <EmptyState icon="image" title="Rien à afficher pour l’instant" description={source === 'gallery' ? 'Générez d’abord une image dans ce projet.' : 'Ajoutez une image de référence à un élément.'} />
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button key={item.key} type="button" onClick={() => { onPick(item); onClose(); }} title={item.label} className={cx('group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40 transition hover:border-cyan-300/60')}>
              {item.mediaType.startsWith('video/') ? <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <Image src={item.url} alt={item.label} fill unoptimized sizes="200px" className="object-cover transition group-hover:scale-105" />}
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4 text-left text-[10px] text-white/80">{item.caption}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
