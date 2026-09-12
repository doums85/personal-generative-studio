'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteCreativeElement,
  listCreativeElements,
  saveCreativeElement,
  subscribeToCreativeLibrary,
} from '@/lib/creative-library';
import { getModelPriceSummary } from '@/lib/gateway/pricing.mjs';

const TYPES = [
  { id: 'character', label: 'Personnage', icon: '◉' },
  { id: 'place', label: 'Lieu', icon: '⌂' },
  { id: 'object', label: 'Objet', icon: '◆' },
  { id: 'product', label: 'Produit', icon: '▣' },
  { id: 'style', label: 'Style visuel', icon: '✦' },
];

function optimizeImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const source = new window.Image();
    source.onerror = () => reject(new Error('Format d’image non reconnu.'));
    source.onload = () => {
      const scale = Math.min(1, 900 / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.74));
    };
    source.src = dataUrl;
  });
}

function fileToOptimizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire cette image.'));
    reader.onload = () => optimizeImageDataUrl(reader.result).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}

export default function CreativeLibrary() {
  const fileInput = useRef(null);
  const [elements, setElements] = useState([]);
  const [filter, setFilter] = useState('all');
  const [name, setName] = useState('');
  const [type, setType] = useState('character');
  const [description, setDescription] = useState('');
  const [referenceDataUrl, setReferenceDataUrl] = useState('');
  const [source, setSource] = useState('manual');
  const [catalog, setCatalog] = useState([]);
  const [model, setModel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    listCreativeElements().then(setElements).catch(() => setError('La bibliothèque locale est indisponible.'));
  }, []);

  useEffect(() => {
    refresh();
    return subscribeToCreativeLibrary(refresh);
  }, [refresh]);

  useEffect(() => {
    fetch('/api/gateway/models')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
      .then((payload) => setCatalog(payload.byModality?.image || []))
      .catch(() => setError('Le catalogue des modèles est temporairement indisponible.'));
  }, []);

  const selectedModel = useMemo(() => catalog.find((item) => item.id === model), [catalog, model]);
  const visibleElements = filter === 'all' ? elements : elements.filter((item) => item.type === filter);

  async function importReference(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      setReferenceDataUrl(await fileToOptimizedDataUrl(file));
      setSource('import');
    } catch (fileError) {
      setError(fileError.message);
    } finally {
      event.target.value = '';
    }
  }

  async function generateReference() {
    if (!description.trim()) {
      setError('Décrivez d’abord précisément cet élément.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const response = await fetch('/api/gateway/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modality: 'image',
          prompt: `Create a clean reference image for a reusable ${type}. ${description}`,
          model: model || undefined,
          mode: model ? 'manual' : 'economy',
          aspectRatio: type === 'character' ? '3:4' : '1:1',
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'La génération a échoué.');
      const generatedReference = payload.media?.[0]?.dataUrl;
      setReferenceDataUrl(generatedReference ? await optimizeImageDataUrl(generatedReference) : '');
      setSource('ai');
    } catch (generationError) {
      setError(generationError.message);
    } finally {
      setGenerating(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (!name.trim() || !description.trim()) return;
    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      await saveCreativeElement({
        id: window.crypto.randomUUID(),
        name: name.trim(),
        type,
        description: description.trim(),
        referenceDataUrl,
        source,
        createdAt: now,
        updatedAt: now,
      });
      setName('');
      setDescription('');
      setReferenceDataUrl('');
      setSource('manual');
    } catch {
      setError('Impossible d’enregistrer cet élément sur cet appareil.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(element) {
    if (!window.confirm(`Supprimer « ${element.name} » de la bibliothèque ?`)) return;
    await deleteCreativeElement(element.id);
  }

  return (
    <div className="h-full overflow-y-auto bg-[#050506] px-5 py-6 text-white md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Éléments de base</p>
            <h1 className="mt-2 text-3xl font-semibold">Bibliothèque créative</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/45">Créez une fois vos personnages, lieux et références, puis réutilisez-les dans vos images et vidéos.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/55">
            {elements.length} élément{elements.length === 1 ? '' : 's'} enregistré{elements.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[390px_1fr]">
          <form onSubmit={save} className="self-start rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:sticky lg:top-0">
            <h2 className="text-lg font-semibold">Nouvel élément</h2>

            <label className="mt-5 block text-xs font-semibold text-white/60">Type</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {TYPES.map((item) => (
                <button key={item.id} type="button" onClick={() => setType(item.id)} className={`rounded-xl border px-3 py-2 text-left text-xs transition ${type === item.id ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100' : 'border-white/10 bg-black/25 text-white/55 hover:border-white/25'}`}>
                  <span className="mr-2 text-cyan-300">{item.icon}</span>{item.label}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs font-semibold text-white/60">Nom</label>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Maya, Appartement Dakar…" required className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-cyan-300/60" />

            <label className="mt-4 block text-xs font-semibold text-white/60">Description de référence</label>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Décrivez les traits qui doivent rester constants dans chaque création…" rows={5} required className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-cyan-300/60" />

            {referenceDataUrl && (
              <div className="relative mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                <Image src={referenceDataUrl} alt="Référence de l’élément" width={720} height={720} unoptimized className="h-52 w-full object-contain" />
                <button type="button" onClick={() => setReferenceDataUrl('')} className="absolute right-2 top-2 rounded-lg bg-black/70 px-2 py-1 text-xs text-white/75 hover:text-white">Retirer</button>
              </div>
            )}

            <input ref={fileInput} type="file" accept="image/*" onChange={importReference} className="hidden" />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-white/70 hover:bg-white/[0.08]">Importer une image</button>
              <button type="button" onClick={generateReference} disabled={generating} className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-40">{generating ? 'Création…' : 'Créer avec l’IA'}</button>
            </div>

            <label className="mt-4 block text-xs font-semibold text-white/60">Modèle pour l’aperçu</label>
            <select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111114] p-3 text-sm">
              <option value="">Le moins cher automatiquement</option>
              {catalog.map((item) => <option key={item.id} value={item.id}>{item.name} — {getModelPriceSummary(item)}</option>)}
            </select>
            {selectedModel && <p className="mt-2 text-xs text-cyan-200/60">{getModelPriceSummary(selectedModel)} · tarif indicatif Gateway</p>}

            {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
            <button disabled={saving || !name.trim() || !description.trim()} className="mt-5 w-full rounded-xl bg-cyan-300 px-4 py-3 font-semibold text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? 'Enregistrement…' : 'Ajouter à la bibliothèque'}
            </button>
          </form>

          <section>
            <div className="mb-4 flex flex-wrap gap-2">
              <button onClick={() => setFilter('all')} className={`rounded-full border px-3 py-1.5 text-xs ${filter === 'all' ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-white/45'}`}>Tout</button>
              {TYPES.map((item) => <button key={item.id} onClick={() => setFilter(item.id)} className={`rounded-full border px-3 py-1.5 text-xs ${filter === item.id ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100' : 'border-white/10 text-white/45'}`}>{item.label}</button>)}
            </div>

            {visibleElements.length === 0 ? (
              <div className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-sm text-white/30">Vos éléments de référence apparaîtront ici.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visibleElements.map((element) => {
                  const typeInfo = TYPES.find((item) => item.id === element.type);
                  return (
                    <article key={element.id} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
                      <div className="flex h-48 items-center justify-center bg-black/35">
                        {element.referenceDataUrl ? <Image src={element.referenceDataUrl} alt={element.name} width={640} height={640} unoptimized className="h-full w-full object-cover" /> : <span className="text-5xl text-cyan-300/25">{typeInfo?.icon}</span>}
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/65">{typeInfo?.label || element.type}</p>
                            <h3 className="mt-1 font-semibold">{element.name}</h3>
                          </div>
                          <button onClick={() => remove(element)} className="rounded-lg px-2 py-1 text-xs text-white/30 hover:bg-red-400/10 hover:text-red-200" aria-label={`Supprimer ${element.name}`}>Supprimer</button>
                        </div>
                        <p className="mt-3 line-clamp-3 text-xs leading-5 text-white/45">{element.description}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
