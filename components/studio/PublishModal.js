'use client';

import { useEffect, useMemo, useState } from 'react';
import { PLATFORM_META, TIKTOK_PRIVACY, api, formatDate, workspaceUrl } from '@/lib/studio/client';
import { CAPTION_LIMITS, SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '@/lib/social/platforms.mjs';
import { checkPublishable, mediaKindOf } from '@/lib/social/rules.mjs';
import { useStudio } from './StudioProvider';
import { Avatar, PlatformBadge, PublicationRow, SchedulerNotice, usePublicationPolling } from './SocialParts';
import { Button, EmptyState, Field, Input, Media, Modal, Notice, Segmented, Select, Spinner, Textarea, cx } from './ui';

/** `datetime-local` value (local time, minute precision) for a timestamp. */
function toLocalInput(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tomorrowMorning() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return toLocalInput(date);
}

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
  const [timing, setTiming] = useState('now');
  const [scheduledFor, setScheduledFor] = useState(tomorrowMorning);

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
  const scheduledTime = timing === 'later' ? new Date(scheduledFor).getTime() : null;
  const scheduleError = timing !== 'later' ? '' : Number.isNaN(scheduledTime) ? 'Choisissez une date et une heure.' : scheduledTime < Date.now() + SCHEDULE_MIN_LEAD_MS + 15000 ? 'Choisissez une heure dans le futur (au moins deux minutes).' : scheduledTime > Date.now() + SCHEDULE_MAX_LEAD_MS ? 'La programmation est limitée à un an.' : '';
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
      const { publications } = await api.post(workspaceUrl(workspaceId, '/publications'), { generationId: generation.id, fileId: file.id, caption, targets, ...(scheduledTime ? { scheduledAt: new Date(scheduledTime).toISOString() } : {}) });
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
          <Button variant="primary" icon="share" loading={submitting} disabled={!chosen.length || blocking || !kind || Boolean(scheduleError)} onClick={submit}>{chosen.length ? `${timing === 'later' ? 'Programmer' : 'Publier'} sur ${chosen.length} compte${chosen.length > 1 ? 's' : ''}` : 'Choisissez un compte'}</Button>
        </>
      )}
    >
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!overview && !loadError && <div className="flex justify-center py-10 text-white/40"><Spinner size={20} /></div>}

      {results && (
        <div className="space-y-3">
          <Notice tone={results.some((item) => item.status === 'failed') ? 'warning' : 'success'}>
            {results.every((item) => item.status === 'scheduled') ? `Programmé pour le ${formatDate(results[0].scheduledAt)}. Le serveur publiera à l’heure dite : il doit rester en marche, et vous pouvez annuler depuis « Réseaux sociaux ».` : done ? 'Envoi terminé.' : 'Envoi en cours : Instagram et TikTok traitent le média avant de le mettre en ligne. Ce suivi se met à jour automatiquement.'}
          </Notice>
          {results.some((item) => item.status === 'scheduled') && <SchedulerNotice scheduler={overview?.scheduler} />}
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

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Quand</p>
                <Segmented size="sm" value={timing} onChange={setTiming} options={[{ value: 'now', label: 'Maintenant' }, { value: 'later', label: 'Programmer' }]} />
                {timing === 'later' && (
                  <Field label="Date et heure" hint={scheduleError || `Heure locale de votre navigateur (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}>
                    <Input type="datetime-local" value={scheduledFor} min={toLocalInput(Date.now() + SCHEDULE_MIN_LEAD_MS + 60000)} onChange={(event) => setScheduledFor(event.target.value)} aria-invalid={Boolean(scheduleError)} />
                  </Field>
                )}
              </div>

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
