'use client';

import { useEffect, useMemo, useState } from 'react';
import { PLATFORM_META, TIKTOK_PRIVACY, api, workspaceUrl } from '@/lib/studio/client';
import { CAPTION_LIMITS } from '@/lib/social/platforms.mjs';
import { checkPublishable, mediaKindOf } from '@/lib/social/rules.mjs';
import { useStudio } from './StudioProvider';
import { Avatar, PlatformBadge, PublicationRow, usePublicationPolling } from './SocialParts';
import { Button, EmptyState, Field, Media, Modal, Notice, Segmented, Select, Spinner, Textarea, cx } from './ui';

/** Sends one creation to the social accounts connected to the active project. */
export default function PublishModal({ generation, file, onClose, navigate, onPublished }) {
  const { workspaceId, toast } = useStudio();
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState([]);
  const [caption, setCaption] = useState('');
  const [tiktok, setTiktok] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    api.get(workspaceUrl(workspaceId, '/social')).then(setOverview).catch((error) => setLoadError(error.message));
  }, [workspaceId]);

  const accounts = useMemo(() => overview?.accounts || [], [overview]);
  const chosen = useMemo(() => accounts.filter((account) => selected.includes(account.id)), [accounts, selected]);

  // TikTok tells us which visibilities this creator may use: ask once per selected TikTok account.
  useEffect(() => {
    for (const account of chosen.filter((item) => item.platform === 'tiktok')) {
      if (tiktok[account.id]) continue;
      setTiktok((current) => ({ ...current, [account.id]: { loading: true, mode: 'publish', privacyLevel: 'SELF_ONLY', privacyLevels: ['SELF_ONLY'] } }));
      api.get(workspaceUrl(workspaceId, `/social/accounts/${account.id}/options`))
        .then(({ options }) => setTiktok((current) => ({ ...current, [account.id]: { ...current[account.id], loading: false, privacyLevels: options.privacyLevels, privacyLevel: options.privacyLevels.includes('SELF_ONLY') ? 'SELF_ONLY' : options.privacyLevels[0] } })))
        .catch((error) => setTiktok((current) => ({ ...current, [account.id]: { ...current[account.id], loading: false, error: error.message } })));
    }
  }, [chosen, tiktok, workspaceId]);

  const kind = mediaKindOf(file?.mediaType);
  const issues = useMemo(() => chosen.flatMap((account) => checkPublishable({ platform: account.platform, kind, aspectRatio: generation.params?.aspectRatio, caption }).map((issue) => ({ ...issue, account }))), [chosen, kind, generation.params?.aspectRatio, caption]);
  const blocking = issues.some((issue) => issue.level === 'error') || chosen.some((account) => account.status === 'needs_reconnect');
  const limit = chosen.length ? Math.min(...chosen.map((account) => CAPTION_LIMITS[account.platform])) : null;

  usePublicationPolling(workspaceId, results || [], (publication) => setResults((current) => current.map((item) => (item.id === publication.id ? publication : item))));

  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const patchTiktok = (id, patch) => setTiktok((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  async function submit() {
    setSubmitting(true);
    try {
      const targets = chosen.map((account) => ({
        accountId: account.id,
        options: account.platform === 'tiktok' ? { mode: tiktok[account.id]?.mode, privacyLevel: tiktok[account.id]?.privacyLevel } : {},
      }));
      const { publications } = await api.post(workspaceUrl(workspaceId, '/publications'), { generationId: generation.id, fileId: file.id, caption, targets });
      setResults(publications);
      onPublished?.();
    } catch (error) {
      toast(error.message, 'error', 10000);
    } finally { setSubmitting(false); }
  }

  const goToSocial = () => { onClose(); navigate?.('social'); };
  const done = results && results.every((item) => item.status !== 'processing');

  return (
    <Modal
      open
      onClose={onClose}
      title="Publier"
      subtitle="Sur les comptes connectés à ce projet"
      width="max-w-2xl"
      footer={results ? (
        <Button variant="primary" onClick={onClose}>{done ? 'Terminer' : 'Fermer (le suivi continue)'}</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button variant="primary" icon="share" loading={submitting} disabled={!chosen.length || blocking || !kind} onClick={submit}>{chosen.length ? `Publier sur ${chosen.length} compte${chosen.length > 1 ? 's' : ''}` : 'Choisissez un compte'}</Button>
        </>
      )}
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!overview && !loadError && <div className="flex justify-center py-10 text-white/40"><Spinner size={20} /></div>}

      {results && (
        <div className="space-y-3">
          <Notice tone={results.some((item) => item.status === 'failed') ? 'warning' : 'success'}>
            {done ? 'Envoi terminé.' : 'Envoi en cours : Instagram et TikTok traitent le média avant de le mettre en ligne. Ce suivi se met à jour automatiquement.'}
          </Notice>
          {results.map((publication) => <PublicationRow key={publication.id} publication={publication} />)}
        </div>
      )}

      {overview && !results && (
        <div className="space-y-5">
          {!overview.publicMediaConfigured && <Notice tone="warning">Définissez <code className="rounded bg-black/40 px-1">STUDIO_PUBLIC_URL</code> et <code className="rounded bg-black/40 px-1">STUDIO_MEDIA_SECRET</code> : les réseaux téléchargent le média depuis votre serveur.</Notice>}

          <div className="flex gap-4">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/50">
              <Media file={file} alt={generation.prompt} fill sizes="96px" className="h-full w-full object-cover" />
            </div>
            <p className="line-clamp-4 text-xs leading-5 text-white/50">{generation.prompt}</p>
          </div>

          {accounts.length === 0 ? (
            <EmptyState icon="share" title="Aucun compte connecté à ce projet" description="Connectez Facebook, Instagram ou TikTok pour publier directement depuis le studio." action={<Button variant="primary" onClick={goToSocial}>Connecter un compte</Button>} />
          ) : (
            <>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Comptes</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {accounts.map((account) => {
                    const active = selected.includes(account.id);
                    return (
                      <li key={account.id}>
                        <button type="button" role="checkbox" aria-checked={active} onClick={() => toggle(account.id)} className={cx('flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition', active ? 'border-cyan-300/50 bg-cyan-300/[0.08]' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}>
                          <Avatar account={account} size={32} />
                          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{account.name}</span><span className="block truncate text-[11px] text-white/40">{account.status === 'needs_reconnect' ? 'À reconnecter' : account.handle || PLATFORM_META[account.platform]?.label}</span></span>
                          <PlatformBadge platform={account.platform} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <Field label="Légende" hint={limit ? `${caption.length} / ${limit} caractères` : 'Hashtags et mentions inclus.'}>
                <Textarea rows={4} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Écrivez la légende de la publication…" />
              </Field>

              {chosen.filter((account) => account.platform === 'tiktok').map((account) => {
                const options = tiktok[account.id];
                if (!options) return null;
                return (
                  <div key={account.id} className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
                    <p className="text-xs font-semibold text-white">TikTok · {account.name}</p>
                    <Segmented size="sm" value={options.mode} onChange={(mode) => patchTiktok(account.id, { mode })} options={[{ value: 'publish', label: 'Publier' }, { value: 'draft', label: 'Envoyer en brouillon' }]} />
                    {options.mode === 'publish' ? (
                      <Field label="Visibilité" hint="Tant que votre application TikTok n’est pas auditée, seule « Moi uniquement » est acceptée.">
                        <Select value={options.privacyLevel} disabled={options.loading} onChange={(event) => patchTiktok(account.id, { privacyLevel: event.target.value })}>
                          {options.privacyLevels.map((level) => <option key={level} value={level}>{TIKTOK_PRIVACY[level] || level}</option>)}
                        </Select>
                      </Field>
                    ) : <p className="text-[11px] leading-4 text-white/40">Le média arrive dans les notifications de l’application TikTok : vous le relisez et le publiez vous-même.</p>}
                    {options.error && <p className="text-[11px] text-amber-200">Options TikTok indisponibles ({options.error}).</p>}
                  </div>
                );
              })}

              {issues.length > 0 && (
                <div className="space-y-2">
                  {issues.map((issue, index) => <Notice key={index} tone={issue.level === 'error' ? 'error' : 'warning'}><strong>{PLATFORM_META[issue.account.platform]?.label} · {issue.account.name}</strong> — {issue.message}</Notice>)}
                </div>
              )}
              {chosen.some((account) => account.status === 'needs_reconnect') && <Notice tone="error">Un compte sélectionné doit être reconnecté. <button type="button" className="font-semibold underline" onClick={goToSocial}>Ouvrir les réseaux sociaux</button></Notice>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
