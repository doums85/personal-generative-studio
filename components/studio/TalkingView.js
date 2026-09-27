'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { LANGUAGES, api, describeWarning, formatUsd, modelSupports, takeHandoff, voiceSuggestions, workspaceUrl } from '@/lib/studio/client';
import { getModelPriceSummary } from '@/lib/gateway/pricing.mjs';
import { useStudio } from './StudioProvider';
import ElementEditor from './ElementEditor';
import { GenerationDetail, GenerationThumb } from './GenerationCard';
import { Badge, Button, EmptyState, Field, Icon, Input, Media, Notice, Segmented, Select, Spinner, Textarea, cx } from './ui';

const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];

export default function TalkingView({ navigate }) {
  const { workspaceId, elements, generations, catalog, toast, trackJob, upsertGeneration, refresh } = useStudio();
  const avatars = useMemo(() => elements.filter((element) => (element.kind === 'avatar' || element.kind === 'character') && element.images?.length), [elements]);
  const [elementId, setElementId] = useState('');
  const [script, setScript] = useState('');
  const [scene, setScene] = useState('');
  const [mode, setMode] = useState('reference');
  const [language, setLanguage] = useState('fr');
  const [speechModel, setSpeechModel] = useState('');
  const [voice, setVoice] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoMode, setVideoMode] = useState('balanced');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    const handoff = takeHandoff('talking');
    if (handoff?.elementId) setElementId(handoff.elementId);
    api.get('/api/studio/config').then((payload) => {
      setConfig(payload);
      if (!payload.publicMediaConfigured) setMode('native');
    }).catch(() => setConfig({ publicMediaConfigured: false }));
  }, []);
  useEffect(() => {
    if (!elementId && avatars.length) setElementId(avatars[0].id);
  }, [avatars, elementId]);

  const avatar = avatars.find((item) => item.id === elementId) || null;
  useEffect(() => {
    if (!avatar) return;
    setSpeechModel(avatar.voice?.model || '');
    setVoice(avatar.voice?.voice || '');
    if (avatar.voice?.language) setLanguage(avatar.voice.language);
  }, [avatar]);

  const eligibleVideo = useMemo(() => catalog.video.filter((model) => (mode === 'native' ? modelSupports(model, 'native-audio') : modelSupports(model, 'audio-reference')) && modelSupports(model, 'start-image')), [catalog.video, mode]);
  const selectedVideo = eligibleVideo.find((model) => model.id === videoModel) || null;
  useEffect(() => { if (videoModel && !eligibleVideo.some((model) => model.id === videoModel)) setVideoModel(''); }, [eligibleVideo, videoModel]);
  useEffect(() => {
    const options = selectedVideo?.features?.resolutions || [];
    if (options.length && !options.includes(resolution)) setResolution(options[0]);
    if (!options.length && resolution) setResolution('');
  }, [selectedVideo, resolution]);

  const characters = script.trim().length;
  const speechSeconds = Math.max(1, Math.round(characters / 15));
  const audioLimit = selectedVideo?.features?.inputs?.audio?.maxSeconds;
  const tooLong = mode === 'reference' && audioLimit && speechSeconds > audioLimit;
  const recent = useMemo(() => generations.filter((item) => item.kind === 'talking').slice(0, 8), [generations]);

  async function submit() {
    if (!avatar || !script.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = await trackJob('Avatar parlant en cours', api.post(workspaceUrl(workspaceId, '/talking'), {
        elementId: avatar.id, script, scene, mode, language,
        speechModel: speechModel || undefined, voice: voice || undefined,
        videoModel: videoModel || undefined, videoMode, aspectRatio, resolution: resolution || undefined,
      }));
      upsertGeneration(payload.generation);
      setLatest(payload.generation);
      refresh().catch(() => {});
      toast(`Vidéo prête avec ${payload.generation.model?.name} (${formatUsd(payload.generation.estimate?.amount)}).`, 'success');
    } catch (submitError) {
      setError(submitError.payload?.details?.message || submitError.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = latest || recent[0] || null;
  const output = shown?.files.find((file) => file.role !== 'audio');
  const track = shown?.files.find((file) => file.role === 'audio');

  return (
    <div className="mx-auto grid max-w-[1500px] gap-6 p-4 md:p-6 xl:grid-cols-[460px_1fr]">
      <section className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">Voix synchronisée</p>
          <h1 className="mt-1 text-xl font-semibold">Avatar parlant</h1>
          <p className="mt-1 text-xs leading-5 text-white/45">Un avatar de votre bibliothèque lit un script face caméra. La voix est synthétisée puis transmise au modèle vidéo qui synchronise les lèvres, ou générée nativement par le modèle.</p>

          <Field label="Avatar" className="mt-4" action={<button type="button" onClick={() => setCreating(true)} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">+ Nouvel avatar</button>}>
            {avatars.length === 0 ? (
              <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 px-3 py-3 text-left text-xs text-white/50 hover:border-violet-400/50 hover:text-white"><Icon name="mic" size={16} /> Créez un avatar avec un portrait de référence et, si vous voulez, une voix par défaut.</button>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {avatars.map((item) => (
                  <button key={item.id} type="button" onClick={() => setElementId(item.id)} className={cx('flex w-[84px] shrink-0 flex-col items-center gap-1.5 rounded-xl border p-1.5 transition', item.id === elementId ? 'border-violet-400/60 bg-violet-400/10' : 'border-white/10 hover:border-white/25')}>
                    <span className="relative h-16 w-16 overflow-hidden rounded-lg bg-black/40"><Image src={item.images[0].url} alt="" fill unoptimized sizes="64px" className="object-cover" /></span>
                    <span className="w-full truncate text-center text-[11px] font-medium">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>

          <Field label="Script" className="mt-4" hint={`≈ ${speechSeconds} s de parole · ${characters} caractères${audioLimit ? ` · maximum ${audioLimit} s pour ce modèle` : ''}`}>
            <Textarea value={script} onChange={(event) => setScript(event.target.value)} rows={5} placeholder="Bonjour, je suis Maya. Aujourd’hui je vous montre comment…" />
          </Field>
          {tooLong && <Notice tone="warning" className="mt-2">Le script est trop long pour {selectedVideo?.name}. Raccourcissez-le ou coupez-le en plusieurs plans.</Notice>}

          <Field label="Décor et mise en scène" className="mt-4" hint="Optionnel. Le portrait de référence sert de première image.">
            <Input value={scene} onChange={(event) => setScene(event.target.value)} placeholder="Studio lumineux, fond neutre beige, plan poitrine, légère profondeur de champ" />
          </Field>

          <Field label="Méthode" className="mt-4">
            <Segmented value={mode} onChange={setMode} className="w-full" options={[{ value: 'reference', label: 'Voix synthétisée + synchro' }, { value: 'native', label: 'Voix native du modèle' }]} />
            <span className="mt-1.5 block text-[11px] leading-4 text-white/40">{mode === 'reference' ? 'Contrôle total de la voix (modèle vocal, timbre, langue). Le modèle vidéo suit la piste audio.' : 'Le modèle vidéo génère lui-même la voix et la synchronisation labiale à partir du script. Fonctionne partout, moins de contrôle sur le timbre.'}</span>
          </Field>
          {mode === 'reference' && config && !config.publicMediaConfigured && (
            <Notice tone="warning" className="mt-3">Les modèles vidéo lisent la piste audio via une URL publique. Cette instance n’en expose pas : définissez <span className="font-mono">STUDIO_PUBLIC_URL</span> (adresse publique de l’app) et <span className="font-mono">AUTH_SECRET</span>, ou utilisez la voix native du modèle.</Notice>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Langue">
              <Select value={language} onChange={(event) => setLanguage(event.target.value)}>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</Select>
            </Field>
            {mode === 'reference' && (
              <>
                <Field label="Modèle vocal">
                  <Select value={speechModel} onChange={(event) => { setSpeechModel(event.target.value); setVoice(''); }}>
                    <option value="">{avatar?.voice?.model ? `Voix de l’avatar` : 'Le moins cher automatiquement'}</option>
                    {catalog.audio.map((model) => <option key={model.id} value={model.id}>{model.name} — {getModelPriceSummary(model)}</option>)}
                  </Select>
                </Field>
                <Field label="Voix" className="col-span-2">
                  <Input list="talking-voices" value={voice} onChange={(event) => setVoice(event.target.value)} placeholder={voiceSuggestions(speechModel)[0] || 'nova, Kore, Ara…'} />
                  <datalist id="talking-voices">{voiceSuggestions(speechModel).map((item) => <option key={item} value={item} />)}</datalist>
                </Field>
              </>
            )}
            <Field label="Modèle vidéo" className="col-span-2">
              <Select value={videoModel} onChange={(event) => setVideoModel(event.target.value)}>
                <option value="">Automatique ({{ economy: 'le moins cher', balanced: 'équilibré', quality: 'le plus qualitatif' }[videoMode]})</option>
                {eligibleVideo.map((model) => <option key={model.id} value={model.id}>{model.name} — {getModelPriceSummary(model)}</option>)}
              </Select>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Segmented size="sm" value={videoMode} onChange={setVideoMode} options={[{ value: 'economy', label: 'Éco' }, { value: 'balanced', label: 'Équilibré' }, { value: 'quality', label: 'Qualité' }]} />
                {selectedVideo && <Badge tone="violet">{mode === 'native' ? 'Audio natif' : 'Piste audio'}</Badge>}
              </div>
              {eligibleVideo.length === 0 && <span className="mt-1.5 block text-[11px] text-amber-200/80">Aucun modèle compatible dans le catalogue pour cette méthode.</span>}
            </Field>
            <Field label="Format">
              <Select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{(selectedVideo?.features?.aspectRatios?.filter((r) => r !== 'auto') || RATIOS).map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</Select>
            </Field>
            {selectedVideo?.features?.resolutions?.length > 0 && (
              <Field label="Résolution">
                <Select value={resolution} onChange={(event) => setResolution(event.target.value)}>{selectedVideo.features.resolutions.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
              </Field>
            )}
          </div>

          <Notice tone="info" className="mt-4">La durée de la vidéo est calée automatiquement sur la durée de la voix. Le coût est vérifié contre le plafond avant chaque appel payant.</Notice>
          {error && <Notice tone="error" className="mt-3">{error}</Notice>}
          <Button variant="primary" size="lg" icon="mic" className="mt-4 w-full" onClick={submit} loading={busy} disabled={!avatar || !script.trim() || tooLong}>{busy ? 'Génération en cours…' : 'Faire parler l’avatar'}</Button>
        </div>
      </section>

      <section className="min-w-0 space-y-6">
        <div className="relative flex min-h-[460px] items-center justify-center overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.1),transparent_60%),#08080c]">
          {busy && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
              <Spinner size={28} className="text-violet-200" />
              <p className="text-sm font-medium text-white/80">{mode === 'reference' ? 'Synthèse de la voix, puis génération de la vidéo…' : 'Génération de la vidéo avec voix native…'}</p>
              <p className="text-xs text-white/40">Comptez une à quelques minutes.</p>
            </div>
          )}
          {shown && output ? (
            <div className="flex w-full flex-col items-center gap-3 p-3">
              <button type="button" onClick={() => setViewing(shown)} className="flex max-h-[62vh] items-center justify-center"><Media file={output} alt={shown.prompt} controls className="max-h-[60vh] w-auto max-w-full rounded-2xl shadow-2xl" /></button>
              {track && <div className="w-full max-w-md rounded-xl border border-white/10 bg-black/40 p-2"><Media file={track} /></div>}
              <p className="text-[11px] text-white/45">{shown.model?.name} · {shown.params?.duration} s · {formatUsd(shown.estimate?.amount)}{shown.warnings?.length ? ` · ${shown.warnings.length} avertissement(s)` : ''}</p>
              {shown.warnings?.length > 0 && <p className="max-w-lg text-center text-[11px] text-amber-200/70">{shown.warnings.map(describeWarning).join(' · ')}</p>}
            </div>
          ) : (
            <EmptyState icon="mic" title="Votre avatar apparaîtra ici" description="Choisissez un avatar avec un portrait, écrivez son texte et lancez la génération." className="m-6 border-none bg-transparent" />
          )}
        </div>
        {recent.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-white/80">Vidéos parlantes récentes</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{recent.map((generation) => <GenerationThumb key={generation.id} generation={generation} onOpen={(item) => { setLatest(item); setViewing(item); }} />)}</div>
          </div>
        )}
      </section>

      <ElementEditor open={creating} onClose={() => setCreating(false)} initialKind="avatar" onSaved={(saved) => setElementId(saved.id)} />
      {viewing && <GenerationDetail generation={viewing} onClose={() => setViewing(null)} navigate={navigate} />}
    </div>
  );
}
