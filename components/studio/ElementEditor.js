'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { KIND_META, LANGUAGES, api, imageFileToDataUrl, mediaUrlToDataUrl, voiceSuggestions, workspaceUrl } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import { Button, Field, Icon, IconButton, Input, Modal, Notice, Select, Textarea, cx } from './ui';

const SHEET_STYLES = [
  ['photoreal', 'Photoréaliste'], ['editorial', 'Éditorial'], ['anime', 'Anime 2D'], ['3d', '3D stylisé'], ['concept', 'Concept art'],
];

/**
 * Creation and edition of an element (character, avatar, place, object, product, style).
 * Handles multiple reference images, AI-generated reference sheets and the avatar voice.
 */
const NO_IMAGES = [];

export default function ElementEditor({ open, onClose, element = null, initialKind = 'character', initialImages = NO_IMAGES, onSaved }) {
  const { workspaceId, catalog, toast, upsertElement, refresh } = useStudio();
  const fileInput = useRef(null);
  const [kind, setKind] = useState(initialKind);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [voice, setVoice] = useState({ model: '', voice: '', instructions: '', language: 'fr' });
  const [existingImages, setExistingImages] = useState([]);
  const [removedImageIds, setRemovedImageIds] = useState([]);
  const [newImages, setNewImages] = useState([]);
  const [primaryImageId, setPrimaryImageId] = useState(null);
  const [sheetStyle, setSheetStyle] = useState('photoreal');
  const [sheetModel, setSheetModel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setKind(element?.kind || initialKind);
    setName(element?.name || '');
    setDescription(element?.description || '');
    setTags((element?.tags || []).join(', '));
    setVoice({ model: element?.voice?.model || '', voice: element?.voice?.voice || '', instructions: element?.voice?.instructions || '', language: element?.voice?.language || 'fr' });
    setExistingImages(element?.images || []);
    setRemovedImageIds([]);
    setNewImages([]);
    setPrimaryImageId(null);
    setError('');
    let cancelled = false;
    (async () => {
      const converted = [];
      for (const [index, image] of initialImages.entries()) {
        const dataUrl = image.dataUrl || (image.url ? await mediaUrlToDataUrl(image.url).catch(() => null) : null);
        if (dataUrl) converted.push({ id: `init-${index}`, dataUrl, source: image.source || 'generated' });
      }
      if (!cancelled && converted.length) setNewImages(converted);
    })();
    return () => { cancelled = true; };
  }, [open, element, initialKind, initialImages]);

  const referenceModels = catalog.image.filter((model) => model.features?.inputs?.image);
  const sheetModels = catalog.image;
  const meta = KIND_META[kind];
  const visibleImages = existingImages.filter((image) => !removedImageIds.includes(image.id));
  const totalImages = visibleImages.length + newImages.length;

  async function addFiles(files) {
    setError('');
    try {
      const converted = [];
      for (const file of Array.from(files)) converted.push({ id: `${Date.now()}-${Math.random()}`, dataUrl: await imageFileToDataUrl(file), source: 'upload' });
      setNewImages((current) => [...current, ...converted]);
    } catch (fileError) {
      setError(fileError.message);
    }
  }

  async function generateSheet() {
    if (!description.trim()) { setError('Décrivez d’abord l’élément : la planche de référence est générée à partir de cette description.'); return; }
    setGenerating(true);
    setError('');
    try {
      const payload = await api.post(workspaceUrl(workspaceId, '/generate'), {
        modality: 'image',
        prompt: buildSheetPrompt({ name: name || meta.label, description, style: sheetStyle, kind }),
        model: sheetModel || undefined,
        mode: sheetModel ? 'manual' : 'balanced',
        aspectRatio: kind === 'character' || kind === 'avatar' ? '16:9' : kind === 'place' ? '16:9' : '1:1',
        useStyleNotes: false,
      });
      const file = payload.generation.files[0];
      const dataUrl = await mediaUrlToDataUrl(file.url);
      setNewImages((current) => [...current, { id: file.id, dataUrl, source: 'generated' }]);
      toast(`Planche générée avec ${payload.generation.model?.name} (${payload.generation.estimate?.amount != null ? `≈ ${payload.generation.estimate.amount.toFixed(3)} $` : 'coût inconnu'}).`, 'success');
    } catch (generationError) {
      setError(generationError.message);
    } finally {
      setGenerating(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const body = {
      kind,
      name: name.trim(),
      description: description.trim(),
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
      voice: kind === 'avatar' || voice.model || voice.voice ? { model: voice.model || undefined, voice: voice.voice || undefined, instructions: voice.instructions || undefined, language: voice.language || undefined } : undefined,
    };
    try {
      let saved;
      if (element) {
        saved = (await api.patch(workspaceUrl(workspaceId, `/elements/${element.id}`), { ...body, addImages: newImages.map(({ dataUrl, source }) => ({ dataUrl, source })), removeImageIds, primaryImageId: primaryImageId || undefined })).element;
      } else {
        saved = (await api.post(workspaceUrl(workspaceId, '/elements'), { ...body, images: newImages.map(({ dataUrl, source }) => ({ dataUrl, source })) })).element;
      }
      upsertElement(saved);
      refresh().catch(() => {});
      toast(element ? 'Élément mis à jour.' : `« ${saved.name} » ajouté à la bibliothèque.`, 'success');
      onSaved?.(saved);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={element ? `Modifier « ${element.name} »` : 'Nouvel élément'} subtitle="Une fiche réutilisable : ses images de référence et sa description sont injectées dans chaque génération qui la mentionne." width="max-w-3xl"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={save} loading={saving} disabled={!name.trim()}>{element ? 'Enregistrer' : 'Créer l’élément'}</Button></>}>
      <form onSubmit={save} className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Field label="Type">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(KIND_META).map(([id, item]) => (
                <button key={id} type="button" onClick={() => setKind(id)} className={cx('flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition', kind === id ? 'border-cyan-300/60 bg-cyan-300/10 text-white' : 'border-white/10 bg-black/25 text-white/60 hover:border-white/25')}>
                  <Icon name={item.icon} size={16} className={kind === id ? 'text-cyan-200' : 'text-white/40'} />
                  <span className="text-xs font-semibold">{item.label}</span>
                </button>
              ))}
            </div>
            <span className="mt-1.5 block text-[11px] text-white/40">{meta.hint}</span>
          </Field>
          <Field label="Nom" hint="Vous l’appellerez avec @ dans vos prompts, par exemple @Maya.">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'place' ? 'Ex. Appartement Dakar' : kind === 'product' ? 'Ex. Sneaker Aurora' : 'Ex. Maya'} required />
          </Field>
          <Field label="Description de référence" hint="Les traits qui doivent rester constants : visage, âge, coiffure, tenue, matériaux, ambiance…">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Femme de 32 ans, peau noire, cheveux courts bouclés, regard franc, veste en lin beige, petites créoles dorées…" />
          </Field>
          <Field label="Tags" hint="Séparés par des virgules.">
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="héroïne, campagne été" />
          </Field>

          {(kind === 'avatar' || kind === 'character') && (
            <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-violet-100"><Icon name="mic" size={14} /> Voix de l’avatar</p>
              <p className="mt-1 text-[11px] text-white/45">Utilisée par défaut dans « Avatar parlant » et « Voix off ».</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Modèle vocal">
                  <Select value={voice.model} onChange={(event) => setVoice((current) => ({ ...current, model: event.target.value, voice: '' }))}>
                    <option value="">Le moins cher automatiquement</option>
                    {catalog.audio.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </Select>
                </Field>
                <Field label="Voix">
                  <Input list="voice-suggestions" value={voice.voice} onChange={(event) => setVoice((current) => ({ ...current, voice: event.target.value }))} placeholder={voiceSuggestions(voice.model)[0] || 'nova, Kore, Ara…'} />
                  <datalist id="voice-suggestions">{voiceSuggestions(voice.model).map((item) => <option key={item} value={item} />)}</datalist>
                </Field>
                <Field label="Langue">
                  <Select value={voice.language} onChange={(event) => setVoice((current) => ({ ...current, language: event.target.value }))}>
                    {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </Select>
                </Field>
                <Field label="Intention / ton">
                  <Input value={voice.instructions} onChange={(event) => setVoice((current) => ({ ...current, instructions: event.target.value }))} placeholder="Chaleureuse, posée, légèrement complice" />
                </Field>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Field label={`Images de référence (${totalImages})`} hint="La première image est la référence principale. Ajoutez plusieurs angles pour plus de constance.">
            <div className="grid grid-cols-2 gap-2">
              {visibleImages.map((image, index) => (
                <figure key={image.id} className={cx('group relative aspect-square overflow-hidden rounded-xl border bg-black/40', index === 0 && !primaryImageId ? 'border-cyan-300/60' : 'border-white/10')}>
                  <Image src={image.url} alt="" fill unoptimized sizes="140px" className="object-cover" />
                  <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                    <IconButton icon="star" label="Définir comme référence principale" onClick={() => setPrimaryImageId(image.id)} className="bg-black/70" size={13} />
                    <IconButton icon="trash" label="Retirer" onClick={() => setRemovedImageIds((current) => [...current, image.id])} className="bg-black/70" size={13} />
                  </div>
                  {(primaryImageId === image.id || (index === 0 && !primaryImageId)) && <span className="absolute bottom-1 left-1 rounded bg-cyan-300 px-1 text-[9px] font-bold text-black">Principale</span>}
                </figure>
              ))}
              {newImages.map((image) => (
                <figure key={image.id} className="group relative aspect-square overflow-hidden rounded-xl border border-dashed border-cyan-300/40 bg-black/40">
                  <Image src={image.dataUrl} alt="" fill unoptimized sizes="140px" className="object-cover" />
                  <div className="absolute inset-x-1 top-1 flex justify-end opacity-0 transition group-hover:opacity-100">
                    <IconButton icon="trash" label="Retirer" onClick={() => setNewImages((current) => current.filter((item) => item.id !== image.id))} className="bg-black/70" size={13} />
                  </div>
                  <span className="absolute bottom-1 left-1 rounded bg-white/80 px-1 text-[9px] font-bold text-black">{image.source === 'generated' ? 'IA' : 'Nouvelle'}</span>
                </figure>
              ))}
              <button type="button" onClick={() => fileInput.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 text-white/45 transition hover:border-cyan-300/50 hover:text-white">
                <Icon name="upload" size={18} />
                <span className="text-[11px] font-semibold">Importer</span>
              </button>
            </div>
            <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
          </Field>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-white/80"><Icon name="spark" size={14} className="text-cyan-200" /> Planche de référence IA</p>
            <p className="mt-1 text-[11px] leading-4 text-white/40">Génère une fiche cohérente (vue entière + gros plan) à partir de la description, à la manière d’un character sheet de production.</p>
            <div className="mt-3 space-y-2">
              <Select value={sheetStyle} onChange={(event) => setSheetStyle(event.target.value)}>{SHEET_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
              <Select value={sheetModel} onChange={(event) => setSheetModel(event.target.value)}>
                <option value="">Modèle équilibré automatiquement</option>
                {sheetModels.map((model) => <option key={model.id} value={model.id}>{model.name}{referenceModels.includes(model) ? ' · références' : ''}</option>)}
              </Select>
              <Button variant="accent" size="sm" icon="spark" className="w-full" onClick={generateSheet} loading={generating}>Générer la planche</Button>
            </div>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </form>
    </Modal>
  );
}

// Mirrors lib/studio/prompt.mjs characterSheetPrompt so the client can preview the exact request.
function buildSheetPrompt({ name, description, style, kind }) {
  const realism = {
    photoreal: 'visible fine skin texture with natural pores and subtle asymmetries, natural sheen rather than glossy retouched finish, no beauty filter, no digital smoothing, no AI-airbrushed look, high-end but unretouched commercial photography, soft diffused studio lighting without harsh reflections, cinematic realism, 4K, sharp focus',
    editorial: 'flawless-but-natural skin with fine texture retained, soft dewy highlight on cheekbones, editorial beauty lighting with a soft key and gentle fill, high-end fashion editorial photography, magazine cover quality, 4K',
    anime: 'clean anime illustration, crisp lineart, cel-shaded flat color with soft gradient shadows, consistent character model-sheet style, even flat lighting, high-quality anime key visual, 4K',
    '3d': 'stylized 3D character render, appealing proportions, smooth subsurface-scattering skin, detailed hair strands and cloth, soft global illumination, three-point studio lighting, high-end 3D animation studio quality, 4K',
    concept: 'painterly game concept art, semi-realistic rendering, orthographic model sheet, clear silhouette, neutral even concept-art lighting, professional character concept art, 4K',
  }[style] || '';
  if (kind === 'place') return `Location reference sheet for "${name}": wide establishing shot on the left and a detailed close-up of the most recognisable feature on the right, identical location in both panels, consistent lighting and time of day, ${description}. ${realism} no people, no text, no watermark, no logos, no frame borders.`;
  if (kind === 'product' || kind === 'object') return `Product reference sheet for "${name}": front view, three-quarter view and detail close-up of the identical object side by side on a pure white seamless studio background, consistent proportions, materials and colours, ${description}. ${realism} no hands, no text, no watermark, no logos, no frame borders.`;
  if (kind === 'style') return `Visual style reference board for "${name}": a grid of four small scenes rendered in the identical visual style, ${description}. Consistent palette, lighting, grain, lens and colour grading across all four. no text, no watermark, no logos.`;
  return `Split-screen character sheet composition, left side a full-body shot of the character standing upright in a neutral pose facing the camera with both feet visible, right side a tight chest-up portrait of the same character, identical original character on both sides, single subject only, exactly one person, pure white seamless studio background, professional character sheet presentation. ${description}. ${realism} natural anatomy, no other people, no duplicate figures, no props, no furniture, no text, no watermark, no logos, no frame borders.`;
}
