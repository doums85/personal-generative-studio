'use client';

import { useMemo, useState } from 'react';
import { LANGUAGES, api, formatUsd, voiceSuggestions, workspaceUrl } from '@/lib/studio/client';
import { getModelPriceSummary } from '@/lib/gateway/pricing.mjs';
import { useStudio } from './StudioProvider';
import { GenerationDetail, GenerationThumb } from './GenerationCard';
import { Button, EmptyState, Field, Input, Media, Notice, Select, Textarea } from './ui';

export default function VoiceView({ navigate }) {
  const { workspaceId, elements, generations, catalog, toast, trackJob, upsertGeneration, refresh, upsertElement } = useStudio();
  const [text, setText] = useState('');
  const [model, setModel] = useState('');
  const [voice, setVoice] = useState('');
  const [instructions, setInstructions] = useState('');
  const [language, setLanguage] = useState('fr');
  const [avatarId, setAvatarId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState(null);
  const [viewing, setViewing] = useState(null);
  const avatars = useMemo(() => elements.filter((element) => element.kind === 'avatar' || element.kind === 'character'), [elements]);
  const recent = useMemo(() => generations.filter((item) => item.kind === 'speech').slice(0, 8), [generations]);
  const selected = catalog.audio.find((item) => item.id === model);
  const perCharacter = Number(selected?.pricing?.speech_input_character_cost);
  const estimate = Number.isFinite(perCharacter) ? perCharacter * text.length : null;

  function applyAvatar(id) {
    setAvatarId(id);
    const avatar = avatars.find((item) => item.id === id);
    if (avatar?.voice) {
      setModel(avatar.voice.model || '');
      setVoice(avatar.voice.voice || '');
      setInstructions(avatar.voice.instructions || '');
      if (avatar.voice.language) setLanguage(avatar.voice.language);
    }
  }

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const payload = await trackJob('Voix en cours', api.post(workspaceUrl(workspaceId, '/generate'), { modality: 'audio', prompt: text, model: model || undefined, mode: model ? 'manual' : 'economy', voice: voice || undefined, instructions: instructions || undefined, language, elementIds: avatarId ? [avatarId] : [] }));
      upsertGeneration(payload.generation);
      setLatest(payload.generation);
      refresh().catch(() => {});
      toast(`Voix générée avec ${payload.generation.model?.name}.`, 'success');
    } catch (submitError) {
      setError(submitError.payload?.details?.message || submitError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveVoiceToAvatar() {
    if (!avatarId) return;
    try {
      const payload = await api.patch(workspaceUrl(workspaceId, `/elements/${avatarId}`), { voice: { model: model || undefined, voice: voice || undefined, instructions: instructions || undefined, language } });
      upsertElement(payload.element);
      toast(`Voix enregistrée sur « ${payload.element.name} ».`, 'success');
    } catch (saveError) { toast(saveError.message, 'error'); }
  }

  const shown = latest || recent[0] || null;
  const output = shown?.files[0];

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 p-4 md:p-6 xl:grid-cols-[440px_1fr]">
      <section className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5 xl:sticky xl:top-6 xl:self-start">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300">Synthèse vocale</p>
        <h1 className="mt-1 text-xl font-semibold">Voix off</h1>
        <p className="mt-1 text-xs leading-5 text-white/45">Testez des voix, générez des narrations et enregistrez la voix idéale sur un avatar pour la retrouver dans « Avatar parlant ».</p>
        <Field label="Texte" className="mt-4" hint={`${text.length} caractères${estimate !== null ? ` · ${formatUsd(estimate)}` : ''}`}>
          <Textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder="Bienvenue dans le studio. Aujourd’hui…" />
        </Field>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Avatar (optionnel)" className="col-span-2">
            <Select value={avatarId} onChange={(event) => applyAvatar(event.target.value)}>
              <option value="">Aucun</option>
              {avatars.map((item) => <option key={item.id} value={item.id}>{item.name}{item.voice?.voice ? ` · ${item.voice.voice}` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Modèle vocal" className="col-span-2">
            <Select value={model} onChange={(event) => { setModel(event.target.value); setVoice(''); }}>
              <option value="">Le moins cher automatiquement</option>
              {catalog.audio.map((item) => <option key={item.id} value={item.id}>{item.name} — {getModelPriceSummary(item)}</option>)}
            </Select>
          </Field>
          <Field label="Voix">
            <Input list="voice-view-voices" value={voice} onChange={(event) => setVoice(event.target.value)} placeholder={voiceSuggestions(model)[0] || 'nova, Kore, Ara…'} />
            <datalist id="voice-view-voices">{voiceSuggestions(model).map((item) => <option key={item} value={item} />)}</datalist>
          </Field>
          <Field label="Langue">
            <Select value={language} onChange={(event) => setLanguage(event.target.value)}>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</Select>
          </Field>
          <Field label="Intention / ton" className="col-span-2">
            <Input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Chaleureuse, rythme posé, sourire dans la voix" />
          </Field>
        </div>
        {error && <Notice tone="error" className="mt-3">{error}</Notice>}
        <div className="mt-4 flex gap-2">
          <Button variant="primary" size="lg" icon="wave" className="flex-1" onClick={submit} loading={busy} disabled={!text.trim()}>Générer la voix</Button>
          <Button size="lg" icon="mic" onClick={saveVoiceToAvatar} disabled={!avatarId} title="Enregistrer ces réglages comme voix par défaut de l’avatar">Assigner</Button>
        </div>
      </section>
      <section className="space-y-6">
        <div className="flex min-h-[260px] items-center justify-center rounded-3xl border border-white/[0.08] bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.08),transparent_60%),#08080c] p-6">
          {shown && output ? (
            <div className="w-full max-w-xl space-y-3">
              <p className="text-sm leading-6 text-white/80">{shown.prompt}</p>
              <Media file={output} />
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                <span>{shown.model?.name}</span><span>·</span><span>{shown.params?.voice || 'voix par défaut'}</span><span>·</span><span>{formatUsd(shown.estimate?.amount)}</span>
                <a href={`${output.url}?download=1`} className="ml-auto font-semibold text-cyan-300 hover:text-cyan-200">Télécharger</a>
                <button type="button" onClick={() => setViewing(shown)} className="font-semibold text-cyan-300 hover:text-cyan-200">Détails</button>
              </div>
            </div>
          ) : <EmptyState icon="wave" title="Votre voix apparaîtra ici" description="Écrivez un texte, choisissez un modèle et une voix, puis générez." className="border-none bg-transparent" />}
        </div>
        {recent.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold text-white/80">Voix récentes</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{recent.map((generation) => <GenerationThumb key={generation.id} generation={generation} onOpen={(item) => { setLatest(item); setViewing(item); }} />)}</div>
          </div>
        )}
      </section>
      {viewing && <GenerationDetail generation={viewing} onClose={() => setViewing(null)} navigate={navigate} />}
    </div>
  );
}
