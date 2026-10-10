'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { KIND_META, LANGUAGES, RATIOS, api, describeWarning, formatUsd, imageFileToDataUrl, modelSupports, takeHandoff, voiceSuggestions, workspaceUrl } from '@/lib/studio/client';
import { getModelPriceSummary } from '@/lib/gateway/pricing.mjs';
import { useStudio } from './StudioProvider';
import PromptComposer from './PromptComposer';
import MediaPicker from './MediaPicker';
import { GenerationDetail, GenerationThumb } from './GenerationCard';
import { Badge, Button, Chip, EmptyState, Field, Icon, IconButton, Input, Media, Notice, Segmented, Select, Spinner, Textarea, cx } from './ui';

const COPY = {
  image: { title: 'Image Studio', placeholder: 'Décrivez la scène. Mentionnez vos éléments avec @, par exemple : @Maya assise à la terrasse du @Café, lumière du soir, 35 mm…', action: 'Générer l’image', jobLabel: 'Image en cours' },
  video: { title: 'Video Studio', placeholder: 'Décrivez la scène, l’action et la caméra. Ex. : @Maya dans la @Cuisine prépare un thiéboudienne, plan poitrine, lumière douce… Activez « Dialogue » pour la faire parler.', action: 'Générer la vidéo', jobLabel: 'Vidéo en cours' },
};

const MODES = [
  { value: 'economy', label: 'Éco' }, { value: 'balanced', label: 'Équilibré' }, { value: 'quality', label: 'Qualité' },
];

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return debounced;
}

function ReferenceSlot({ label, hint, image, onPick, onUpload, onClear, wide = false }) {
  const input = useRef(null);
  return (
    <div className={cx('rounded-xl border border-white/10 bg-black/30 p-2', wide && 'col-span-2')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-white/70">{label}</p>
        {image && <IconButton icon="close" label="Retirer" onClick={onClear} size={13} className="h-6 w-6" />}
      </div>
      {image ? (
        <div className="relative mt-2 h-24 overflow-hidden rounded-lg bg-black/50"><Image src={image.url} alt="" fill unoptimized sizes="200px" className="object-cover" /></div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button type="button" onClick={onPick} className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-[10px] font-semibold text-white/50 hover:border-cyan-300/50 hover:text-white"><Icon name="grid" size={14} />Galerie</button>
          <button type="button" onClick={() => input.current?.click()} className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-[10px] font-semibold text-white/50 hover:border-cyan-300/50 hover:text-white"><Icon name="upload" size={14} />Importer</button>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={(event) => { if (event.target.files?.[0]) onUpload(event.target.files[0]); event.target.value = ''; }} />
        </div>
      )}
      {hint && <p className="mt-1.5 text-[10px] leading-4 text-white/35">{hint}</p>}
    </div>
  );
}

export default function CreateView({ modality, navigate }) {
  const copy = COPY[modality];
  const { workspaceId, workspace, elements, generations, catalog, toast, trackJob, upsertGeneration, refresh } = useStudio();
  const models = catalog[modality];
  const referenceInput = useRef(null);

  const [prompt, setPrompt] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState(workspace?.settings?.mode || 'balanced');
  const [aspectRatio, setAspectRatio] = useState(workspace?.settings?.aspectRatio || (modality === 'video' ? '16:9' : '1:1'));
  const [resolution, setResolution] = useState('');
  const [duration, setDuration] = useState('');
  const [count, setCount] = useState(1);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [references, setReferences] = useState([]);
  const [startImage, setStartImage] = useState(null);
  const [endImage, setEndImage] = useState(null);
  const [parentId, setParentId] = useState(null);
  const [speechOn, setSpeechOn] = useState(false);
  const [script, setScript] = useState('');
  const [speakerId, setSpeakerId] = useState('');
  const [speechMode, setSpeechMode] = useState('reference');
  const [speechLanguage, setSpeechLanguage] = useState('fr');
  const [speechModel, setSpeechModel] = useState('');
  const [speechVoice, setSpeechVoice] = useState('');
  const [config, setConfig] = useState(null);
  const [picker, setPicker] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState(null);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    const handoff = takeHandoff(modality);
    if (!handoff) return;
    if (handoff.prompt) setPrompt(handoff.prompt);
    if (handoff.elementIds?.length) setSelectedIds(handoff.elementIds);
    if (handoff.startImage) setStartImage(handoff.startImage);
    if (handoff.referenceImages?.length) setReferences(handoff.referenceImages.map((item, index) => ({ id: `h-${index}`, ...item })));
    if (handoff.parentId) setParentId(handoff.parentId);
    if (handoff.speech) {
      setSpeechOn(true);
      if (handoff.speech.speakerId) setSpeakerId(handoff.speech.speakerId);
    }
    if (handoff.startImage || handoff.referenceImages?.length) toast(modality === 'video' ? 'Image chargée comme première image de la vidéo.' : 'Image ajoutée comme référence.', 'info');
  }, [modality, toast]);

  useEffect(() => {
    if (modality !== 'video') return;
    api.get('/api/studio/config').then((payload) => {
      setConfig(payload);
      if (!payload.publicMediaConfigured) setSpeechMode('native');
    }).catch(() => setConfig({ publicMediaConfigured: false }));
  }, [modality]);

  const dialogueActive = modality === 'video' && speechOn;
  const speechFeature = speechMode === 'native' ? 'native-audio' : 'audio-reference';
  const availableModels = useMemo(() => (dialogueActive ? models.filter((item) => modelSupports(item, speechFeature)) : models), [models, dialogueActive, speechFeature]);
  useEffect(() => { if (modelId && !availableModels.some((item) => item.id === modelId)) setModelId(''); }, [availableModels, modelId]);
  const model = useMemo(() => models.find((item) => item.id === modelId) || null, [models, modelId]);
  const speakers = useMemo(() => elements.filter((element) => element.images?.length || element.voice?.voice || element.voice?.model), [elements]);
  const speaker = useMemo(() => speakers.find((item) => item.id === speakerId) || null, [speakers, speakerId]);
  useEffect(() => {
    if (!dialogueActive || speakerId) return;
    const mentioned = (prompt.match(/@([\p{L}\p{N}_-]+)/gu) || []).map((token) => token.slice(1).toLowerCase());
    const isPerson = (element) => element.voice?.voice || element.voice?.model || element.kind === 'avatar' || element.kind === 'character';
    const candidate = elements.find((element) => isPerson(element) && (selectedIds.includes(element.id) || mentioned.includes(element.name.split(/\s+/)[0].toLowerCase())));
    if (candidate) setSpeakerId(candidate.id);
  }, [dialogueActive, speakerId, elements, selectedIds, prompt]);
  useEffect(() => {
    if (!speaker?.voice) return;
    setSpeechModel(speaker.voice.model || '');
    setSpeechVoice(speaker.voice.voice || '');
    if (speaker.voice.language) setSpeechLanguage(speaker.voice.language);
  }, [speaker]);
  const scriptCharacters = script.trim().length;
  const scriptSeconds = Math.max(1, Math.round(scriptCharacters / 15));
  const features = model?.features || {};
  const ratioOptions = useMemo(() => (features.aspectRatios?.length ? features.aspectRatios.filter((ratio) => ratio !== 'auto') : RATIOS), [features.aspectRatios]);
  const resolutionOptions = useMemo(() => features.resolutions || [], [features.resolutions]);
  const durationOptions = useMemo(() => features.durations || [], [features.durations]);
  const supportsReferences = model ? modelSupports(model, 'references') : true;
  const supportsStart = modality === 'video' && (model ? modelSupports(model, 'start-image') : true);
  const supportsEnd = modality === 'video' && (model ? modelSupports(model, 'end-image') : false);
  const supportsNativeAudio = modality === 'video' && (model ? modelSupports(model, 'native-audio') : true);
  const maxReferences = features.inputs?.image?.maxCount || 4;

  useEffect(() => {
    if (ratioOptions.length && !ratioOptions.includes(aspectRatio)) setAspectRatio(ratioOptions[0]);
  }, [ratioOptions, aspectRatio]);
  useEffect(() => {
    if (resolutionOptions.length && !resolutionOptions.includes(resolution)) setResolution(resolutionOptions[0]);
    if (!resolutionOptions.length && resolution) setResolution('');
  }, [resolutionOptions, resolution]);
  useEffect(() => {
    if (durationOptions.length && !durationOptions.includes(Number(duration))) setDuration(String(durationOptions.includes(5) ? 5 : durationOptions[0]));
  }, [durationOptions, duration]);

  const selectedElements = elements.filter((element) => selectedIds.includes(element.id));
  const recent = useMemo(() => generations.filter((item) => item.kind === modality).slice(0, 12), [generations, modality]);

  const request = useMemo(() => ({
    modality,
    prompt,
    model: modelId || undefined,
    mode: modelId ? 'manual' : mode,
    aspectRatio: aspectRatio || undefined,
    resolution: modality === 'video' && resolution ? resolution : undefined,
    duration: modality === 'video' && duration ? Number(duration) : undefined,
    count: modality === 'image' ? count : 1,
    generateAudio: modality === 'video' && supportsNativeAudio ? generateAudio : undefined,
    elementIds: selectedIds,
    referenceImages: references.map((item) => item.ref || item.dataUrl),
    startImage: startImage?.ref || startImage?.dataUrl,
    endImage: endImage?.ref || endImage?.dataUrl,
    parentId: parentId || undefined,
    speech: dialogueActive && script.trim() ? { script, speakerId: speakerId || undefined, mode: speechMode, language: speechLanguage, speechModel: speechModel || undefined, voice: speechVoice || undefined } : undefined,
  }), [modality, prompt, modelId, mode, aspectRatio, resolution, duration, count, generateAudio, supportsNativeAudio, selectedIds, references, startImage, endImage, parentId, dialogueActive, script, speakerId, speechMode, speechLanguage, speechModel, speechVoice]);

  const estimateKey = useDebounced(JSON.stringify({ ...request, referenceImages: request.referenceImages.length, startImage: Boolean(request.startImage), endImage: Boolean(request.endImage) }), 450);
  useEffect(() => {
    if (!prompt.trim() || !workspaceId) { setEstimate(null); return undefined; }
    let active = true;
    setEstimating(true);
    api.post(workspaceUrl(workspaceId, '/estimate'), { ...request, referenceImages: request.referenceImages.map(() => 'data:image/jpeg;base64,'), startImage: undefined, endImage: undefined })
      .then((payload) => active && setEstimate(payload))
      .catch((estimateError) => active && setEstimate({ error: estimateError.message }))
      .finally(() => active && setEstimating(false));
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey, workspaceId]);

  const toggleElement = useCallback((id) => setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id])), []);

  async function addReferenceFiles(files) {
    try {
      const next = [];
      for (const file of Array.from(files)) next.push({ id: `${Date.now()}-${Math.random()}`, dataUrl: await imageFileToDataUrl(file), url: await imageFileToDataUrl(file, { maxSize: 320, quality: 0.7 }) });
      setReferences((current) => [...current, ...next].slice(0, maxReferences));
    } catch (fileError) { toast(fileError.message, 'error'); }
  }

  async function uploadSlot(setter, file) {
    try { setter({ dataUrl: await imageFileToDataUrl(file), url: await imageFileToDataUrl(file, { maxSize: 320, quality: 0.7 }) }); } catch (fileError) { toast(fileError.message, 'error'); }
  }

  const dialogueMissing = dialogueActive && !script.trim();

  async function submit() {
    if (!prompt.trim() || busy || dialogueMissing) return;
    setBusy(true);
    setError('');
    try {
      const payload = await trackJob(copy.jobLabel, api.post(workspaceUrl(workspaceId, '/generate'), request));
      upsertGeneration(payload.generation);
      setLatest(payload.generation);
      setParentId(null);
      refresh().catch(() => {});
      toast(`${copy.title} : création terminée avec ${payload.generation.model?.name}.`, 'success');
    } catch (submitError) {
      setError(submitError.payload?.details?.message || submitError.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = latest || recent[0] || null;
  const shownOutput = shown?.files.find((file) => file.role !== 'audio');
  const shownTrack = shown?.files.find((file) => file.role === 'audio');
  const overBudget = estimate?.overBudget;

  return (
    <div className="mx-auto grid max-w-[1500px] gap-6 p-4 md:p-6 xl:grid-cols-[440px_1fr]">
      <section className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">AI Gateway</p>
              <h1 className="mt-1 text-xl font-semibold">{copy.title}</h1>
            </div>
            <Segmented size="sm" value={modelId ? 'manual' : mode} onChange={(value) => { setMode(value); setModelId(''); }} options={[...MODES, ...(modelId ? [{ value: 'manual', label: 'Manuel' }] : [])]} />
          </div>

          <PromptComposer value={prompt} onChange={setPrompt} elements={elements} placeholder={copy.placeholder} onSubmit={submit} disabled={busy} />

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Éléments du projet</p>
              <button type="button" onClick={() => navigate('elements')} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">Gérer</button>
            </div>
            {elements.length === 0 ? (
              <button type="button" onClick={() => navigate('elements')} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-left text-xs text-white/45 hover:border-cyan-300/40 hover:text-white">
                <Icon name="users" size={16} /> Créez un personnage, un lieu ou un produit pour le réutiliser dans chaque scène.
              </button>
            ) : (
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {elements.map((element) => (
                  <Chip key={element.id} active={selectedIds.includes(element.id)} onClick={() => toggleElement(element.id)} title={KIND_META[element.kind]?.label}>
                    {element.images?.[0] ? <Image src={element.images[0].url} alt="" width={20} height={20} unoptimized className="h-5 w-5 rounded-full object-cover" /> : <Icon name={KIND_META[element.kind]?.icon || 'spark'} size={12} />}
                    {element.name}
                  </Chip>
                ))}
              </div>
            )}
            {selectedElements.length > 0 && !supportsReferences && <p className="mt-2 text-[11px] text-amber-200/80">Ce modèle n’accepte pas d’image de référence : seules les descriptions des éléments seront transmises.</p>}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {supportsStart && <ReferenceSlot label="Première image" hint="La vidéo démarre sur cette image." image={startImage} onPick={() => setPicker('start')} onUpload={(file) => uploadSlot(setStartImage, file)} onClear={() => setStartImage(null)} wide={!supportsEnd} />}
            {supportsEnd && <ReferenceSlot label="Dernière image" hint="Interpolation entre les deux plans." image={endImage} onPick={() => setPicker('end')} onUpload={(file) => uploadSlot(setEndImage, file)} onClear={() => setEndImage(null)} />}
          </div>

          {supportsReferences && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Images de référence <span className="text-white/25">({references.length + selectedElements.filter((e) => e.images?.length).length}/{maxReferences})</span></p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setPicker('reference')} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">Galerie</button>
                  <span className="text-white/20">·</span>
                  <button type="button" onClick={() => referenceInput.current?.click()} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">Importer</button>
                  <input ref={referenceInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { addReferenceFiles(event.target.files); event.target.value = ''; }} />
                </div>
              </div>
              {references.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {references.map((item) => (
                    <div key={item.id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-white/10">
                      <Image src={item.url} alt="" fill unoptimized sizes="56px" className="object-cover" />
                      <button type="button" onClick={() => setReferences((current) => current.filter((ref) => ref.id !== item.id))} className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition group-hover:opacity-100" aria-label="Retirer"><Icon name="close" size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {modality === 'video' && (
            <div className={cx('mt-4 rounded-2xl border p-4 transition', speechOn ? 'border-violet-400/40 bg-violet-400/[0.07]' : 'border-white/10 bg-black/25')}>
              <button type="button" onClick={() => setSpeechOn((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={speechOn}>
                <span className="flex items-center gap-2 text-sm font-semibold text-white"><Icon name="mic" size={16} className={speechOn ? 'text-violet-200' : 'text-white/45'} />Dialogue synchronisé</span>
                <span className={cx('relative inline-flex h-5 w-9 items-center rounded-full transition', speechOn ? 'bg-violet-400' : 'bg-white/15')}><span className={cx('absolute h-4 w-4 rounded-full bg-white transition', speechOn ? 'left-[18px]' : 'left-0.5')} /></span>
              </button>
              <p className="mt-1 text-[11px] leading-4 text-white/45">Le personnage parle : la voix est synthétisée puis les lèvres sont synchronisées par le modèle vidéo, ou le modèle génère lui-même la voix. La durée du plan est calée sur les paroles.</p>
              {speechOn && (
                <div className="mt-3 space-y-3">
                  <Field label="Ce qui est dit" hint={`≈ ${scriptSeconds} s de parole · ${scriptCharacters} caractères${model?.features?.inputs?.audio?.maxSeconds && speechMode === 'reference' ? ` · maximum ${model.features.inputs.audio.maxSeconds} s pour ${model.name}` : ''}`}>
                    <Textarea value={script} onChange={(event) => setScript(event.target.value)} rows={3} placeholder="Bonjour, aujourd’hui je vous montre comment préparer…" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Qui parle" className="col-span-2" hint="Son portrait sert de première image si aucune n’est choisie ; sa voix par défaut est reprise.">
                      <Select value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}>
                        <option value="">Personnage décrit dans le prompt</option>
                        {speakers.map((item) => <option key={item.id} value={item.id}>{item.name} · {KIND_META[item.kind]?.label}{item.voice?.voice ? ` · voix ${item.voice.voice}` : ''}</option>)}
                      </Select>
                    </Field>
                    <Field label="Méthode" className="col-span-2">
                      <Segmented size="sm" value={speechMode} onChange={setSpeechMode} className="w-full" options={[{ value: 'reference', label: 'Voix synthétisée + synchro' }, { value: 'native', label: 'Voix native du modèle' }]} />
                    </Field>
                    {speechMode === 'reference' && config && !config.publicMediaConfigured && (
                      <Notice tone="warning" className="col-span-2">Les modèles qui synchronisent une piste audio la lisent via une URL publique. Cette instance n’en expose pas : définissez <span className="font-mono">STUDIO_PUBLIC_URL</span> et <span className="font-mono">AUTH_SECRET</span>, ou utilisez la voix native.</Notice>
                    )}
                    <Field label="Langue">
                      <Select value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value)}>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</Select>
                    </Field>
                    {speechMode === 'reference' && (
                      <>
                        <Field label="Modèle vocal">
                          <Select value={speechModel} onChange={(event) => { setSpeechModel(event.target.value); setSpeechVoice(''); }}>
                            <option value="">{speaker?.voice?.model ? 'Voix du personnage' : 'Le moins cher automatiquement'}</option>
                            {catalog.audio.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </Select>
                        </Field>
                        <Field label="Voix" className="col-span-2">
                          <Input list="dialogue-voices" value={speechVoice} onChange={(event) => setSpeechVoice(event.target.value)} placeholder={voiceSuggestions(speechModel || speaker?.voice?.model)[0] || 'nova, Kore, Ara…'} />
                          <datalist id="dialogue-voices">{voiceSuggestions(speechModel || speaker?.voice?.model).map((item) => <option key={item} value={item} />)}</datalist>
                        </Field>
                      </>
                    )}
                  </div>
                  {availableModels.length === 0 && <Notice tone="warning">Aucun modèle vidéo du catalogue ne prend en charge cette méthode.</Notice>}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Modèle" className="col-span-2">
              <Select value={modelId} onChange={(event) => setModelId(event.target.value)}>
                <option value="">Sélection automatique ({MODES.find((item) => item.value === mode)?.label}){dialogueActive ? ' · compatible dialogue' : ''}</option>
                {availableModels.map((item) => <option key={item.id} value={item.id}>{item.name} — {getModelPriceSummary(item)}</option>)}
              </Select>
              {model && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {modelSupports(model, 'references') && <Badge tone="cyan">Références</Badge>}
                  {modelSupports(model, 'start-image') && modality === 'video' && <Badge tone="cyan">Image → vidéo</Badge>}
                  {modelSupports(model, 'end-image') && <Badge tone="cyan">Début / fin</Badge>}
                  {modelSupports(model, 'native-audio') && <Badge tone="violet">Audio natif</Badge>}
                  {modelSupports(model, 'audio-reference') && <Badge tone="violet">Piste audio</Badge>}
                  {features.resolutions?.includes('4k') && <Badge tone="amber">4K</Badge>}
                </div>
              )}
            </Field>
            <Field label="Format">
              <Select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{ratioOptions.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</Select>
            </Field>
            {modality === 'image' && (
              <Field label="Nombre">
                <Select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value} image{value > 1 ? 's' : ''}</option>)}</Select>
              </Field>
            )}
            {modality === 'video' && dialogueActive && (
              <Field label="Durée" hint="Calée automatiquement sur la durée des paroles.">
                <Input value={estimate?.duration ? `${estimate.duration} s (auto)` : 'auto'} readOnly />
              </Field>
            )}
            {modality === 'video' && !dialogueActive && (
              <Field label="Durée">
                {durationOptions.length ? (
                  <Select value={duration} onChange={(event) => setDuration(event.target.value)}>{durationOptions.map((value) => <option key={value} value={value}>{value} s</option>)}</Select>
                ) : (
                  <Select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="">Par défaut du modèle</option>{[4, 5, 6, 8, 10, 12, 15].map((value) => <option key={value} value={value}>{value} s</option>)}</Select>
                )}
              </Field>
            )}
            {modality === 'video' && resolutionOptions.length > 0 && (
              <Field label="Résolution">
                <Select value={resolution} onChange={(event) => setResolution(event.target.value)}>{resolutionOptions.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
              </Field>
            )}
            {modality === 'video' && supportsNativeAudio && !dialogueActive && (
              <Field label="Son">
                <Segmented size="sm" value={generateAudio ? 'on' : 'off'} onChange={(value) => setGenerateAudio(value === 'on')} options={[{ value: 'on', label: 'Audio natif' }, { value: 'off', label: 'Muet' }]} className="w-full" />
              </Field>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-white/45">Coût estimé</span>
              <span className={cx('font-semibold', overBudget ? 'text-red-200' : 'text-white')}>{estimating ? <Spinner size={12} /> : estimate?.estimate ? `${formatUsd(estimate.estimate.amount)}${estimate.estimate.assumed ? ' (approx.)' : ''}` : '—'}</span>
            </div>
            {estimate?.model && <p className="mt-1 truncate text-[11px] text-white/35">{estimate.model.name} · {estimate.model.id}{estimate.speechModel ? ` + voix ${estimate.speechModel.name}` : ''}{dialogueActive && estimate.duration ? ` · ${estimate.duration} s` : ''}</p>}
            {estimate?.error && <p className="mt-1 text-[11px] text-amber-200/80">{estimate.error}</p>}
            {overBudget && <p className="mt-1 text-[11px] text-red-200/90">Au-delà du plafond MAX_GENERATION_COST_USD ({formatUsd(estimate.maxCostUsd)}). Réduisez la durée, la résolution ou choisissez un modèle moins cher.</p>}
            {estimate?.warnings?.map((warning, index) => <p key={index} className="mt-1 text-[11px] text-amber-200/80">{describeWarning(warning)}</p>)}
          </div>

          {error && <Notice tone="error" className="mt-3">{error}</Notice>}
          <Button variant="primary" size="lg" icon={dialogueActive ? 'mic' : 'spark'} className="mt-4 w-full" onClick={submit} loading={busy} disabled={!prompt.trim() || overBudget || dialogueMissing || (dialogueActive && availableModels.length === 0)}>{busy ? 'Génération en cours…' : dialogueActive ? 'Générer la vidéo parlée' : copy.action}</Button>
        </div>
      </section>

      <section className="min-w-0 space-y-6">
        <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_60%),#08080c]">
          {busy && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
              <Spinner size={28} className="text-cyan-200" />
              <p className="text-sm font-medium text-white/80">{copy.jobLabel}…</p>
              <p className="text-xs text-white/40">{dialogueActive && speechMode === 'reference' ? 'Synthèse de la voix, puis génération de la vidéo synchronisée…' : modality === 'video' ? 'Les vidéos prennent en général de 30 secondes à quelques minutes.' : 'Quelques secondes.'}</p>
            </div>
          )}
          {shown && shownOutput ? (
            <button type="button" onClick={() => setViewing(shown)} className="group relative flex max-h-[70vh] w-full items-center justify-center p-3">
              <Media file={shownOutput} alt={shown.prompt} controls={shownOutput.mediaType.startsWith('video/')} className="max-h-[66vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl" />
              <span className="absolute bottom-5 left-5 rounded-lg bg-black/70 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur">{shown.model?.name}{shown.params?.speech ? ` · dialogue ${shown.params.speech.mode === 'native' ? 'voix native' : 'synchronisé'}` : ''} · {formatUsd(shown.estimate?.amount)} · cliquer pour les détails</span>
            </button>
          ) : (
            <EmptyState icon={modality === 'video' ? 'film' : 'image'} title="Votre création apparaîtra ici" description={modality === 'video' ? 'Décrivez une scène, ajoutez une première image ou un personnage, puis lancez la génération.' : 'Mentionnez vos personnages et lieux avec @ pour une continuité parfaite entre les images.'} className="m-6 border-none bg-transparent" />
          )}
        </div>

        {shownTrack && <div className="rounded-xl border border-white/10 bg-black/40 p-3"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Piste vocale synthétisée</p><Media file={shownTrack} /></div>}
        {shown && shownOutput?.mediaType.startsWith('image/') && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="accent" icon="video" onClick={() => setViewing(shown)}>Animer, décliner ou enregistrer…</Button>
            <a href={`${shownOutput.url}?download=1`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-white hover:bg-white/[0.1]"><Icon name="download" size={14} />Télécharger</a>
          </div>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Créations récentes</h2>
            <button type="button" onClick={() => navigate('gallery')} className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">Toute la galerie →</button>
          </div>
          {recent.length === 0 ? <p className="text-xs text-white/35">Aucune {modality === 'video' ? 'vidéo' : 'image'} dans ce projet pour l’instant.</p> : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {recent.map((generation) => <GenerationThumb key={generation.id} generation={generation} onOpen={(item) => { setLatest(item); setViewing(item); }} />)}
            </div>
          )}
        </div>
      </section>

      <MediaPicker open={Boolean(picker)} onClose={() => setPicker(null)} title={picker === 'reference' ? 'Ajouter une image de référence' : picker === 'end' ? 'Choisir la dernière image' : 'Choisir la première image'} onPick={(item) => {
        if (picker === 'start') setStartImage(item);
        else if (picker === 'end') setEndImage(item);
        else setReferences((current) => [...current, { id: item.key, ref: item.ref, url: item.url }].slice(0, maxReferences));
      }} />
      {viewing && <GenerationDetail generation={viewing} onClose={() => setViewing(null)} navigate={navigate} />}
    </div>
  );
}
