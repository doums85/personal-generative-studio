'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { KIND_META, api, formatDate, setHandoff, workspaceUrl } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import ElementEditor from './ElementEditor';
import { Badge, Button, Chip, EmptyState, Icon, Modal, cx } from './ui';

function ElementCard({ element, onOpen }) {
  const meta = KIND_META[element.kind] || KIND_META.object;
  const cover = element.images?.[0];
  return (
    <button type="button" onClick={() => onOpen(element)} className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left transition hover:-translate-y-0.5 hover:border-cyan-300/40 hover:shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
      <div className="relative aspect-[4/5] overflow-hidden bg-black/50">
        {cover ? <Image src={cover.url} alt={element.name} fill unoptimized sizes="(max-width: 768px) 50vw, 240px" className="object-cover transition duration-500 group-hover:scale-105" /> : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/25"><Icon name={meta.icon} size={30} /><span className="text-[11px]">Pas d’image</span></div>
        )}
        <span className="absolute left-2 top-2"><Badge tone={element.kind === 'avatar' ? 'violet' : 'cyan'}><Icon name={meta.icon} size={11} />{meta.label}</Badge></span>
        {element.images?.length > 1 && <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">{element.images.length} vues</span>}
      </div>
      <div className="p-3.5">
        <p className="truncate text-sm font-semibold text-white">{element.name}</p>
        <p className="mt-1 text-xs leading-5 text-white/45 line-clamp-2">{element.description || meta.hint}</p>
        <p className="mt-2 text-[10px] text-white/30">@{element.name.split(' ')[0]} · {formatDate(element.updatedAt)}</p>
      </div>
    </button>
  );
}

function ElementDetail({ element, onClose, onEdit, navigate }) {
  const { workspaceId, toast, removeElement, refresh, generations } = useStudio();
  const [busy, setBusy] = useState(false);
  const meta = KIND_META[element.kind] || KIND_META.object;
  const related = generations.filter((generation) => generation.elementIds?.includes(element.id)).slice(0, 8);

  async function remove() {
    if (!window.confirm(`Supprimer « ${element.name} » et ses images de référence ?`)) return;
    setBusy(true);
    try {
      await api.delete(workspaceUrl(workspaceId, `/elements/${element.id}`));
      removeElement(element.id);
      refresh().catch(() => {});
      toast('Élément supprimé.', 'success');
      onClose();
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  function openIn(view) {
    const token = `@${element.name.split(' ').slice(0, 2).join(' ')}`;
    setHandoff({ view, prompt: view === 'video' ? `${token} ` : `${token} `, elementIds: [element.id] });
    onClose();
    navigate(view);
  }

  return (
    <Modal open onClose={onClose} title={element.name} subtitle={`${meta.label}${element.tags?.length ? ` · ${element.tags.join(', ')}` : ''}`} width="max-w-4xl"
      footer={<><Button variant="danger" size="sm" icon="trash" onClick={remove} loading={busy}>Supprimer</Button><Button size="sm" icon="edit" onClick={() => onEdit(element)}>Modifier</Button></>}>
      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          {element.images?.length ? (
            <div className="grid grid-cols-2 gap-2">
              {element.images.map((image, index) => (
                <div key={image.id} className={cx('relative overflow-hidden rounded-xl border bg-black/40', index === 0 ? 'col-span-2 aspect-[4/5] border-cyan-300/40' : 'aspect-square border-white/10')}>
                  <Image src={image.url} alt="" fill unoptimized sizes="300px" className="object-cover" />
                  {index === 0 && <span className="absolute bottom-2 left-2 rounded bg-cyan-300 px-1.5 py-0.5 text-[9px] font-bold text-black">Référence principale</span>}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={meta.icon} title="Aucune image de référence" description="Ajoutez une photo ou générez une planche IA pour que les modèles reproduisent fidèlement cet élément." action={<Button size="sm" onClick={() => onEdit(element)}>Ajouter des images</Button>} />
          )}
        </div>
        <div className="space-y-5">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Description de référence</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-white/85">{element.description || <span className="text-white/35">Aucune description. Les modèles s’appuieront uniquement sur les images.</span>}</p>
          </section>
          {element.voice && (element.voice.model || element.voice.voice) && (
            <section className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-3 text-xs text-violet-50">
              <p className="font-semibold"><Icon name="mic" size={13} className="mr-1 inline" />Voix : {element.voice.voice || 'par défaut'}{element.voice.model ? ` · ${element.voice.model}` : ''}{element.voice.language ? ` · ${element.voice.language}` : ''}</p>
              {element.voice.instructions && <p className="mt-1 text-white/60">{element.voice.instructions}</p>}
            </section>
          )}
          <section>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Utiliser dans</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon="image" onClick={() => openIn('image')}>Image</Button>
              <Button size="sm" variant="accent" icon="video" onClick={() => openIn('video')}>Vidéo</Button>
              {(element.kind === 'avatar' || element.kind === 'character') && <Button size="sm" icon="mic" onClick={() => { setHandoff({ view: 'video', prompt: `@${element.name.split(' ').slice(0, 2).join(' ')} `, elementIds: [element.id], speech: { speakerId: element.id } }); onClose(); navigate('video'); }} disabled={!element.images?.length} title={!element.images?.length ? 'Ajoutez d’abord un portrait' : undefined}>Vidéo avec dialogue</Button>}
            </div>
            <p className="mt-2 text-[11px] text-white/35">Dans un prompt, écrivez simplement <span className="font-mono text-cyan-200">@{element.name.split(' ')[0]}</span>.</p>
          </section>
          {related.length > 0 && (
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Créations avec cet élément</p>
              <div className="grid grid-cols-4 gap-2">
                {related.map((generation) => {
                  const file = generation.files.find((item) => item.role !== 'audio');
                  return <div key={generation.id} className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/40">{file?.mediaType.startsWith('video/') ? <video src={file.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : file ? <Image src={file.url} alt="" fill unoptimized sizes="120px" className="object-cover" /> : null}</div>;
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function ElementsView({ navigate }) {
  const { elements } = useStudio();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(null);
  const [viewing, setViewing] = useState(null);

  const visible = useMemo(() => elements.filter((element) => (filter === 'all' || element.kind === filter) && (!query || `${element.name} ${element.description} ${(element.tags || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()))), [elements, filter, query]);
  const counts = useMemo(() => elements.reduce((acc, element) => ({ ...acc, [element.kind]: (acc[element.kind] || 0) + 1 }), {}), [elements]);
  const current = viewing ? elements.find((item) => item.id === viewing.id) || viewing : null;

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Base de références du projet</p>
          <h1 className="mt-1 text-2xl font-semibold">Avatars, personnes, lieux, produits, moodboards</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-white/45">Tout ce que vos images et vidéos doivent respecter : un avatar avec sa voix et sa description, la cuisine d’un tournage, un produit, un style. Mentionnez une référence avec @ dans un prompt : ses images et sa description partent avec la génération.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="plus" onClick={() => setCreating('character')}>Nouveau personnage</Button>
          <Button variant="accent" icon="mic" onClick={() => setCreating('avatar')}>Nouvel avatar</Button>
          <Button icon="map" onClick={() => setCreating('place')}>Lieu</Button>
          <Button icon="tag" onClick={() => setCreating('product')}>Produit</Button>
          <Button icon="layers" onClick={() => setCreating('other')}>Autre référence</Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Tout <span className="text-white/40">{elements.length}</span></Chip>
        {Object.entries(KIND_META).map(([id, meta]) => <Chip key={id} active={filter === id} onClick={() => setFilter(id)}><Icon name={meta.icon} size={12} />{meta.plural} {counts[id] ? <span className="text-white/40">{counts[id]}</span> : null}</Chip>)}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher…" className="ml-auto h-9 w-full rounded-full border border-white/10 bg-black/40 px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-300/50 sm:w-56" />
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="users" title={elements.length ? 'Aucune référence ne correspond' : 'Votre base de références est vide'} description={elements.length ? 'Modifiez le filtre ou la recherche.' : 'Commencez par un avatar ou un personnage principal : importez quelques photos ou laissez l’IA générer une planche de référence, puis ajoutez ses lieux et produits.'} action={!elements.length && <Button variant="primary" icon="plus" onClick={() => setCreating('avatar')}>Créer mon premier avatar</Button>} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((element) => <ElementCard key={element.id} element={element} onOpen={setViewing} />)}
        </div>
      )}

      <ElementEditor open={Boolean(creating)} onClose={() => setCreating(null)} initialKind={creating || 'character'} onSaved={(saved) => setViewing(saved)} />
      <ElementEditor open={Boolean(editing)} onClose={() => setEditing(null)} element={editing} onSaved={(saved) => setViewing(saved)} />
      {current && !editing && <ElementDetail element={current} onClose={() => setViewing(null)} onEdit={(element) => { setEditing(element); }} navigate={navigate} />}
    </div>
  );
}
