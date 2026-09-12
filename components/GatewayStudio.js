'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

const LABELS = {
  image: { title: 'Image Studio', action: 'Générer l’image', placeholder: 'Décrivez précisément l’image à créer…' },
  video: { title: 'Video Studio', action: 'Générer la vidéo', placeholder: 'Décrivez la scène, le mouvement et la caméra…' },
  audio: { title: 'Audio Studio', action: 'Générer l’audio', placeholder: 'Écrivez le texte à prononcer ou l’ambiance sonore…' },
};

export default function GatewayStudio({ modality }) {
  const copy = LABELS[modality];
  const [catalog, setCatalog] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('balanced');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;
    fetch('/api/gateway/models')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
      .then((payload) => {
        if (!active) return;
        const models = payload.byModality?.[modality] || [];
        setCatalog(modality === 'audio' ? models.filter((item) => item.operation === 'speech') : models);
      })
      .catch(() => active && setError('Le catalogue AI Gateway est temporairement indisponible.'));
    return () => { active = false; };
  }, [modality]);

  const selected = useMemo(() => catalog.find((item) => item.id === model), [catalog, model]);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/gateway/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modality, prompt, model: model || undefined, mode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'La génération a échoué.');
      setResult(payload);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#050506] px-5 py-6 text-white md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[390px_1fr]">
        <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">AI Gateway</p>
          <h1 className="mt-2 text-2xl font-semibold">{copy.title}</h1>

          <label className="mt-6 block text-xs font-semibold text-white/60">Description</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={copy.placeholder}
            rows={8}
            required
            className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/40 p-3 text-sm outline-none transition focus:border-cyan-300/60"
          />

          <label className="mt-4 block text-xs font-semibold text-white/60">Stratégie</label>
          <select value={mode} onChange={(event) => setMode(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111114] p-3 text-sm">
            <option value="economy">Économique</option>
            <option value="balanced">Équilibré</option>
            <option value="quality">Qualité maximale</option>
            <option value="manual">Modèle manuel</option>
          </select>

          <label className="mt-4 block text-xs font-semibold text-white/60">Modèle {mode === 'manual' ? '(obligatoire)' : '(facultatif)'}</label>
          <select value={model} onChange={(event) => setModel(event.target.value)} required={mode === 'manual'} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111114] p-3 text-sm">
            <option value="">Sélection automatique</option>
            {catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>

          {selected && <p className="mt-2 text-xs text-white/35">{selected.id}</p>}
          {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}

          <button disabled={loading || !prompt.trim()} className="mt-6 w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? 'Génération en cours…' : copy.action}
          </button>
        </form>

        <section className="min-h-[520px] rounded-2xl border border-white/10 bg-black/30 p-5">
          {!result && !loading && <div className="flex h-full min-h-[480px] items-center justify-center text-center text-sm text-white/30">Votre création apparaîtra ici.</div>}
          {loading && <div className="flex h-full min-h-[480px] items-center justify-center text-sm text-cyan-200">AI Gateway prépare votre création…</div>}
          {result && (
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Résultat</p>
                <p className="text-xs text-white/40">{result.model?.name}</p>
              </div>
              <div className="grid gap-4">
                {result.media?.map((media, index) => modality === 'image' ? (
                  <Image key={index} src={media.dataUrl} alt="Création générée" width={1024} height={1024} unoptimized className="max-h-[70vh] w-full rounded-xl object-contain" />
                ) : modality === 'video' ? (
                  <video key={index} src={media.dataUrl} controls className="max-h-[70vh] w-full rounded-xl" />
                ) : (
                  <audio key={index} src={media.dataUrl} controls className="w-full" />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
