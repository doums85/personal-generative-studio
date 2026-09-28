'use client';

import { useMemo, useState } from 'react';
import { KIND_META, api, describeWarning, formatDate, formatDurationMs, formatUsd, setHandoff, studioRef, workspaceUrl } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import ElementEditor from './ElementEditor';
import { Badge, Button, Icon, IconButton, Media, Modal, Notice, cx } from './ui';

const KIND_BADGE = { image: ['Image', 'cyan'], video: ['Vidéo', 'violet'], speech: ['Voix', 'amber'] };

function badgeFor(generation) {
  if (generation.kind === 'video' && generation.params?.speech) return ['Vidéo · dialogue', 'violet'];
  return KIND_BADGE[generation.kind] || ['Média', 'neutral'];
}

export function GenerationThumb({ generation, onOpen, className = '' }) {
  const file = generation.files.find((item) => item.role !== 'audio') || generation.files[0];
  const [label, tone] = badgeFor(generation);
  return (
    <button type="button" onClick={() => onOpen?.(generation)} className={cx('group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-black/40 text-left transition hover:border-cyan-300/50', className)}>
      {file?.mediaType?.startsWith('audio/') ? (
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-300/10 to-violet-500/10 text-amber-100"><Icon name="wave" size={28} /><span className="px-3 text-center text-[11px] leading-4 text-white/60 line-clamp-2">{generation.prompt}</span></span>
      ) : file ? <Media file={file} alt={generation.prompt} fill sizes="300px" className="transition duration-500 group-hover:scale-105" /> : null}
      <span className="absolute left-2 top-2"><Badge tone={tone}>{label}</Badge></span>
      {generation.favorite && <span className="absolute right-2 top-2 text-amber-300"><Icon name="star" size={14} /></span>}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-8 text-[11px] leading-4 text-white/85 line-clamp-2">{generation.prompt}</span>
    </button>
  );
}

/** Full-size viewer for a generation with the actions that chain it into the next step. */
export function GenerationDetail({ generation, onClose, navigate }) {
  const { workspaceId, elements, toast, upsertGeneration, removeGeneration, refresh } = useStudio();
  const [busy, setBusy] = useState(false);
  const [saveAs, setSaveAs] = useState(null);
  const output = generation?.files.find((file) => file.role !== 'audio') || generation?.files[0];
  const saveImages = useMemo(() => (output?.mediaType?.startsWith('image/') ? [{ url: output.url, source: 'generated' }] : []), [output]);
  if (!generation) return null;
  const audio = generation.files.find((file) => file.role === 'audio');
  const isImage = output?.mediaType?.startsWith('image/');
  const usedElements = elements.filter((element) => generation.elementIds?.includes(element.id));

  async function toggleFavorite() {
    setBusy(true);
    try {
      upsertGeneration((await api.patch(workspaceUrl(workspaceId, `/generations/${generation.id}`), { favorite: !generation.favorite })).generation);
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Supprimer définitivement cette création et ses fichiers ?')) return;
    setBusy(true);
    try {
      await api.delete(workspaceUrl(workspaceId, `/generations/${generation.id}`));
      removeGeneration(generation.id);
      refresh().catch(() => {});
      toast('Création supprimée.', 'success');
      onClose();
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  function animate() {
    setHandoff({ view: 'video', startImage: { ref: studioRef(workspaceId, output.file), url: output.url }, prompt: generation.prompt, elementIds: generation.elementIds, parentId: generation.id });
    onClose();
    navigate('video');
  }

  function variation() {
    setHandoff({ view: 'image', prompt: generation.prompt, elementIds: generation.elementIds, referenceImages: [{ ref: studioRef(workspaceId, output.file), url: output.url }], parentId: generation.id });
    onClose();
    navigate('image');
  }

  return (
    <Modal open onClose={onClose} title={badgeFor(generation)[0]} subtitle={`${generation.model?.name || ''} · ${formatDate(generation.createdAt)}${generation.durationMs ? ` · ${formatDurationMs(generation.durationMs)}` : ''}`} width="max-w-5xl">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/60">
            {output && <Media file={output} alt={generation.prompt} controls className="max-h-[62vh] w-auto max-w-full object-contain" />}
          </div>
          {audio && <div className="rounded-xl border border-white/10 bg-black/40 p-3"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Piste vocale synthétisée</p><Media file={audio} /></div>}
          <div className="flex flex-wrap gap-2">
            <a href={`${output?.url}?download=1`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white hover:bg-white/[0.1]"><Icon name="download" size={14} />Télécharger</a>
            {isImage && <Button size="sm" variant="accent" icon="video" onClick={animate}>Animer en vidéo</Button>}
            {isImage && <Button size="sm" icon="refresh" onClick={variation}>Variation</Button>}
            {isImage && <Button size="sm" icon="user" onClick={() => setSaveAs('character')}>Enregistrer comme élément</Button>}
            {isImage && <Button size="sm" icon="mic" onClick={() => setSaveAs('avatar')}>En faire un avatar</Button>}
            <Button size="sm" variant="ghost" icon="star" onClick={toggleFavorite} loading={busy} className={generation.favorite ? 'text-amber-300' : ''}>{generation.favorite ? 'Favori' : 'Ajouter aux favoris'}</Button>
            <Button size="sm" variant="danger" icon="trash" onClick={remove} loading={busy}>Supprimer</Button>
          </div>
        </div>
        <aside className="space-y-4 text-sm">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Prompt</p>
            <p className="mt-1 whitespace-pre-wrap leading-6 text-white/85">{generation.prompt}</p>
          </section>
          {generation.params?.speech?.script && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Dialogue{generation.params.speech.speaker ? ` · ${generation.params.speech.speaker.name}` : ''}</p>
              <p className="mt-1 whitespace-pre-wrap leading-6 text-white/85">« {generation.params.speech.script} »</p>
            </section>
          )}
          {usedElements.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Éléments utilisés</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{usedElements.map((element) => <Badge key={element.id} tone="cyan"><Icon name={KIND_META[element.kind]?.icon} size={11} />{element.name}</Badge>)}</div>
            </section>
          )}
          <section className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Modèle" value={generation.model?.id} />
            <Stat label="Coût estimé" value={formatUsd(generation.estimate?.amount)} />
            {generation.params?.aspectRatio && <Stat label="Format" value={generation.params.aspectRatio} />}
            {generation.params?.resolution && <Stat label="Résolution" value={generation.params.resolution} />}
            {generation.params?.duration && <Stat label="Durée" value={`${generation.params.duration} s`} />}
            {generation.params?.mode && <Stat label="Mode" value={generation.params.mode} />}
            {generation.params?.speech && <Stat label="Dialogue" value={`${generation.params.speech.mode === 'native' ? 'voix native' : 'piste synchronisée'}${generation.params.speech.voice ? ` · ${generation.params.speech.voice}` : ''}${generation.params.speech.seconds ? ` · ${generation.params.speech.seconds} s` : ''}`} />}
            {generation.params?.voice && !generation.params?.speech && <Stat label="Voix" value={generation.params.voice} />}
            {output?.bytes && <Stat label="Fichier" value={`${output.mediaType} · ${Math.round(output.bytes / 1024)} Ko`} />}
          </section>
          {generation.warnings?.length > 0 && <Notice tone="warning"><ul className="list-disc space-y-1 pl-4">{generation.warnings.map((warning, index) => <li key={index}>{describeWarning(warning)}</li>)}</ul></Notice>}
          <details className="rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/50">
            <summary className="cursor-pointer font-semibold text-white/70">Prompt envoyé au modèle</summary>
            <p className="mt-2 whitespace-pre-wrap leading-5">{generation.resolvedPrompt}</p>
          </details>
        </aside>
      </div>
      <ElementEditor open={Boolean(saveAs)} onClose={() => setSaveAs(null)} initialKind={saveAs || 'character'} initialImages={saveImages} />
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p>
      <p className="mt-0.5 truncate font-medium text-white/85" title={value}>{value || '—'}</p>
    </div>
  );
}

export function useGenerationViewer() {
  const [current, setCurrent] = useState(null);
  return { current, open: setCurrent, close: () => setCurrent(null) };
}

export function DetailButton({ icon = 'external', label, onClick }) {
  return <IconButton icon={icon} label={label} onClick={onClick} />;
}
