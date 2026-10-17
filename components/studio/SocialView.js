'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, workspaceUrl } from '@/lib/studio/client';
import { useStudio } from './StudioProvider';
import { Avatar, PlatformBadge, PublicationRow, SchedulerNotice, usePublicationPolling } from './SocialParts';
import { Badge, Button, EmptyState, Icon, Notice, Panel, Spinner } from './ui';

const CONNECTOR_COPY = {
  meta: { icon: 'users', text: 'Vos Pages Facebook et les comptes Instagram professionnels qui leur sont liés, en une seule autorisation.', docs: 'Application « Facebook Login » sur developers.facebook.com' },
  tiktok: { icon: 'film', text: 'Publication directe ou envoi en brouillon dans l’application TikTok (Content Posting API).', docs: 'Application « Login Kit + Content Posting API » sur developers.tiktok.com' },
};

export default function SocialView() {
  const { workspace, workspaceId, setWorkspaceId, toast } = useStudio();
  const [overview, setOverview] = useState(null);
  const [publications, setPublications] = useState([]);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState('');

  const load = useCallback(async () => {
    try {
      const [social, history] = await Promise.all([api.get(workspaceUrl(workspaceId, '/social')), api.get(workspaceUrl(workspaceId, '/publications'))]);
      setOverview(social);
      setPublications(history.publications);
      setError('');
    } catch (loadError) { setError(loadError.message); }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // Message left by the OAuth callback (?connected=2 / ?error=…), then tidy the address bar.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (!query.has('connected') && !query.has('error')) return;
    if (query.get('error')) toast(query.get('error'), 'error', 10000);
    else toast(`${query.get('connected')} compte(s) connecté(s) à ce projet.`, 'success');
    if (query.get('workspace') && query.get('workspace') !== workspaceId) setWorkspaceId(query.get('workspace'));
    window.history.replaceState(null, '', window.location.pathname);
  }, [toast, workspaceId, setWorkspaceId]);

  usePublicationPolling(workspaceId, publications, (publication) => setPublications((current) => current.map((item) => (item.id === publication.id ? publication : item))));

  async function connect(connector) {
    setConnecting(connector.id);
    try {
      const { url } = await api.post(workspaceUrl(workspaceId, '/social/connect'), { connector: connector.id });
      window.location.assign(url);
    } catch (connectError) {
      toast(connectError.message, 'error');
      setConnecting('');
    }
  }

  async function disconnect(account) {
    if (!window.confirm(`Déconnecter « ${account.name} » de ce projet ? Les publications déjà en ligne ne sont pas supprimées.`)) return;
    try {
      await api.delete(workspaceUrl(workspaceId, `/social/accounts/${account.id}`));
      setOverview((current) => ({ ...current, accounts: current.accounts.filter((item) => item.id !== account.id) }));
      toast('Compte déconnecté.', 'success');
    } catch (disconnectError) { toast(disconnectError.message, 'error'); }
  }

  async function forget(publication) {
    try {
      await api.delete(workspaceUrl(workspaceId, `/publications/${publication.id}`));
      setPublications((current) => current.filter((item) => item.id !== publication.id));
    } catch (forgetError) { toast(forgetError.message, 'error'); }
  }

  if (error) return <div className="p-8"><Notice tone="error">{error}</Notice></div>;
  if (!overview) return <div className="flex h-full items-center justify-center text-white/40"><Spinner size={22} /></div>;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-4 md:p-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">{workspace?.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">Réseaux sociaux</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/45">Les comptes connectés ici appartiennent à ce projet uniquement : un autre projet publie sur ses propres comptes. Depuis la galerie, ouvrez une création puis « Publier ».</p>
      </div>

      {!overview.publicMediaConfigured && (
        <Notice tone="warning">
          Les réseaux téléchargent vos images et vidéos depuis votre serveur : définissez <code className="rounded bg-black/40 px-1">STUDIO_PUBLIC_URL</code> (adresse publique en https) et <code className="rounded bg-black/40 px-1">STUDIO_MEDIA_SECRET</code> avant de publier.
        </Notice>
      )}

      {publications.some((item) => item.status === 'scheduled') && <SchedulerNotice scheduler={overview.scheduler} />}

      <div className="grid gap-4 md:grid-cols-2">
        {overview.connectors.map((connector) => {
          const copy = CONNECTOR_COPY[connector.id];
          const accounts = overview.accounts.filter((account) => connector.platforms.includes(account.platform));
          return (
            <Panel key={connector.id} title={connector.label} subtitle={copy.text}>
              <div className="space-y-3">
                {connector.configured ? (
                  <Button variant="primary" icon="plus" loading={connecting === connector.id} onClick={() => connect(connector)}>{accounts.length ? 'Ajouter ou mettre à jour des comptes' : `Connecter ${connector.label}`}</Button>
                ) : (
                  <Notice tone="info">
                    <p>Non configuré. Créez une {copy.docs}, puis renseignez <strong>{connector.missingEnv.join(', ')}</strong> dans l’environnement du serveur.</p>
                  </Notice>
                )}
                <div className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-white/35">Adresse de retour OAuth à déclarer</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-white/70">{connector.redirectUri}</p>
                </div>
                {connector.id === 'tiktok' && overview.publicMediaPrefix && (
                  <div className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-white/35">Préfixe d’URL à vérifier (URL properties)</p>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-white/70">{overview.publicMediaPrefix}</p>
                  </div>
                )}
                {accounts.length > 0 && (
                  <ul className="space-y-2">
                    {accounts.map((account) => (
                      <li key={account.id} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                        <Avatar account={account} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{account.name}</p>
                          <p className="truncate text-[11px] text-white/40">{account.handle || 'Compte connecté'}</p>
                        </div>
                        <PlatformBadge platform={account.platform} />
                        {account.status === 'needs_reconnect' && <Badge tone="red">À reconnecter</Badge>}
                        <Button size="sm" variant="ghost" onClick={() => disconnect(account)}>Déconnecter</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="Historique des publications" subtitle="Statut en direct : Instagram et TikTok traitent la vidéo de leur côté avant de la mettre en ligne. Les publications programmées partent à l’heure dite." action={<Button size="sm" variant="ghost" icon="refresh" onClick={load}>Actualiser</Button>}>
        {publications.length === 0 ? (
          <EmptyState icon="share" title="Rien de publié pour l’instant" description="Ouvrez une création dans la galerie et choisissez « Publier »." />
        ) : (
          <ul className="space-y-2">
            {publications.map((publication) => (
              <li key={publication.id} className="group relative">
                <PublicationRow publication={publication} />
                {publication.status === 'scheduled' && <Button size="sm" variant="ghost" className="absolute bottom-2 right-2" onClick={() => forget(publication)}>Annuler la programmation</Button>}
                {publication.status !== 'processing' && publication.status !== 'scheduled' && <button type="button" onClick={() => forget(publication)} className="absolute right-2 top-2 hidden rounded-md p-1 text-white/30 hover:bg-white/[0.08] hover:text-white group-hover:block" aria-label="Retirer de l’historique"><Icon name="close" size={12} /></button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
