'use client';

import { useEffect, useRef } from 'react';
import { PLATFORM_META, api, formatDate, workspaceUrl } from '@/lib/studio/client';
import { Badge, Icon, Notice, Spinner } from './ui';

/** Profile picture served by the network's CDN (arbitrary hosts, so no next/image). */
export function Avatar({ account, size = 36 }) {
  if (!account.avatarUrl) return <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-full bg-white/[0.08]"><Icon name="user" size={Math.round(size / 2.2)} /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={account.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />;
}

export function PlatformBadge({ platform }) {
  const meta = PLATFORM_META[platform] || { label: platform, tone: 'neutral' };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const STATUS = {
  scheduled: ['Programmé', 'cyan'],
  processing: ['Traitement…', 'amber'],
  published: ['Publié', 'green'],
  failed: ['Échec', 'red'],
};

export function StatusBadge({ publication }) {
  const [label, tone] = publication.status === 'published' && publication.draft ? ['Brouillon envoyé', 'green'] : STATUS[publication.status] || STATUS.processing;
  return (
    <Badge tone={tone}>
      {publication.status === 'processing' && <Spinner size={10} />}
      {label}
    </Badge>
  );
}

export function PublicationRow({ publication }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlatformBadge platform={publication.platform} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{publication.accountName}</span>
        <StatusBadge publication={publication} />
        {publication.url && <a href={publication.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-200 hover:text-cyan-100">Ouvrir<Icon name="external" size={12} /></a>}
      </div>
      {publication.caption && <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-white/50">{publication.caption}</p>}
      {publication.error && <p className={publication.status === 'failed' ? 'mt-1.5 text-xs leading-5 text-red-200' : 'mt-1.5 text-xs leading-5 text-amber-200'}>{publication.error}</p>}
      <p className="mt-1 text-[10px] uppercase tracking-wide text-white/30">{publication.status === 'scheduled' ? `Prévu le ${formatDate(publication.scheduledAt)}` : formatDate(publication.publishedAt || publication.createdAt)}</p>
    </div>
  );
}

/** Warns when scheduled posts would never leave: no ticker (serverless host) and no cron configured. */
export function SchedulerNotice({ scheduler }) {
  if (!scheduler || scheduler.active) return null;
  return (
    <Notice tone="warning">
      Aucun planificateur actif : les publications programmées ne partiront pas. Sur un hébergement serverless (Vercel), définissez <code className="rounded bg-black/40 px-1">CRON_SECRET</code> et faites appeler <code className="rounded bg-black/40 px-1">/api/studio/social/run-due</code> chaque minute par un cron (en-tête <code className="rounded bg-black/40 px-1">Authorization: Bearer …</code>).
    </Notice>
  );
}

/**
 * Instagram and TikTok finish processing on their side: while a publication is `processing`,
 * ask the server (which asks the platform) every few seconds and report the new state.
 */
export function usePublicationPolling(workspaceId, publications, onUpdate, intervalMs = 5000) {
  const pending = publications.filter((item) => item.status === 'processing').map((item) => item.id).join(',');
  const update = useRef(onUpdate);
  update.current = onUpdate;
  useEffect(() => {
    if (!pending) return undefined;
    let active = true;
    const timer = window.setInterval(async () => {
      for (const id of pending.split(',')) {
        try {
          const { publication } = await api.get(workspaceUrl(workspaceId, `/publications/${id}`));
          if (active) update.current(publication);
        } catch { /* try again on the next tick */ }
      }
    }, intervalMs);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspaceId, pending, intervalMs]);
}
