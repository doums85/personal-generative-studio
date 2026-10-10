'use client';

import { useEffect, useRef, useState } from 'react';
import { api, formatUsd, workspaceUrl, RATIOS } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import { Button, Field, Icon, Input, Modal, Select, Textarea, cx } from './ui';

function WorkspaceForm({ initial, onSubmit, onCancel, submitLabel, busy }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [styleNotes, setStyleNotes] = useState(initial?.settings?.styleNotes || '');
  const [aspectRatio, setAspectRatio] = useState(initial?.settings?.aspectRatio || '');
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit({ name, description, settings: { styleNotes, aspectRatio: aspectRatio || undefined } }); }}>
      <Field label="Nom du projet">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Campagne été 2026, Série Instagram Maya…" required autoFocus />
      </Field>
      <Field label="Description" hint="Optionnel. Objectif, client, format visé.">
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="Trois vidéos verticales pour lancer la collection…" />
      </Field>
      <Field label="Direction artistique du projet" hint="Ajoutée automatiquement à chaque génération d’image ou de vidéo de ce projet.">
        <Textarea value={styleNotes} onChange={(event) => setStyleNotes(event.target.value)} rows={3} placeholder="Photographie éditoriale, lumière naturelle chaude, grain léger, palette sable et bleu profond…" />
      </Field>
      <Field label="Format par défaut">
        <Select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
          <option value="">Choisir à chaque fois</option>
          {RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>Annuler</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!name.trim()}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export default function WorkspaceSwitcher({ collapsed = false }) {
  const { workspaces, workspace, setWorkspaceId, loadWorkspaces, toast } = useStudio();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const container = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event) => { if (!container.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  async function create(input) {
    setBusy(true);
    try {
      const payload = await api.post('/api/studio/workspaces', input);
      await loadWorkspaces();
      setWorkspaceId(payload.workspace.id);
      setModal(null);
      toast(`Projet « ${payload.workspace.name} » créé.`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function update(input) {
    setBusy(true);
    try {
      await api.patch(workspaceUrl(workspace.id), input);
      await loadWorkspaces();
      setModal(null);
      toast('Projet mis à jour.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Supprimer le projet « ${workspace.name} » et tout son contenu (éléments, images, vidéos) ? Cette action est définitive.`)) return;
    setBusy(true);
    try {
      await api.delete(workspaceUrl(workspace.id));
      const list = await loadWorkspaces();
      setWorkspaceId(list[0]?.id || null);
      setModal(null);
      toast('Projet supprimé.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={container} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className={cx('flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] text-left transition hover:border-white/20 hover:bg-white/[0.07]', collapsed ? 'justify-center p-2' : 'px-3 py-2.5')} aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-300 to-violet-500 text-sm font-bold text-black shadow-[0_0_20px_rgba(34,211,238,0.25)]">
          {(workspace?.name || 'P').slice(0, 1).toUpperCase()}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Projet</span>
              <span className="block truncate text-sm font-semibold text-white">{workspace?.name || 'Chargement…'}</span>
            </span>
            <Icon name="chevron" size={16} className={cx('shrink-0 text-white/40 transition', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute left-0 right-0 top-full z-50 mt-2 min-w-[260px] overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d12] p-1.5 shadow-2xl">
          <div className="custom-scrollbar max-h-64 overflow-y-auto">
            {workspaces.map((item) => (
              <button key={item.id} type="button" role="menuitem" onClick={() => { setWorkspaceId(item.id); setOpen(false); }} className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06]', item.id === workspace?.id && 'bg-cyan-300/10')}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-xs font-bold text-white/80">{item.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{item.name}</span>
                  <span className="block text-[11px] text-white/40">{item.counts?.elements ?? 0} élément{item.counts?.elements === 1 ? '' : 's'} · {item.counts?.generations ?? 0} création{item.counts?.generations === 1 ? '' : 's'} · {formatUsd(item.estimatedSpendUsd)}</span>
                </span>
                {item.id === workspace?.id && <Icon name="check" size={14} className="text-cyan-200" />}
              </button>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 border-t border-white/[0.06] pt-1.5">
            <Button size="sm" variant="ghost" icon="plus" onClick={() => { setOpen(false); setModal('create'); }}>Nouveau projet</Button>
            <Button size="sm" variant="ghost" icon="settings" onClick={() => { setOpen(false); setModal('edit'); }} disabled={!workspace}>Paramètres</Button>
          </div>
        </div>
      )}

      <Modal open={modal === 'create'} onClose={() => setModal(null)} title="Nouveau projet" subtitle="Chaque projet a ses propres personnages, lieux, styles et sa galerie." width="max-w-lg">
        <WorkspaceForm onSubmit={create} onCancel={() => setModal(null)} submitLabel="Créer le projet" busy={busy} />
      </Modal>
      <Modal open={modal === 'edit' && Boolean(workspace)} onClose={() => setModal(null)} title="Paramètres du projet" subtitle={workspace?.name} width="max-w-lg" footer={<Button variant="danger" size="sm" icon="trash" onClick={remove} loading={busy}>Supprimer le projet</Button>}>
        {workspace && <WorkspaceForm initial={workspace} onSubmit={update} onCancel={() => setModal(null)} submitLabel="Enregistrer" busy={busy} />}
      </Modal>
    </div>
  );
}
