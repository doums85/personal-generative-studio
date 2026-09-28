'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StudioProvider, useStudio } from './StudioProvider';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import HomeView from './HomeView';
import CreateView from './CreateView';
import VoiceView from './VoiceView';
import ElementsView from './ElementsView';
import GalleryView from './GalleryView';
import { STUDIO_VIEWS } from '@/lib/studio/views';
import { Icon, Notice, Spinner, cx } from './ui';


const NAV = [
  { title: 'Créer', items: ['image', 'video', 'voice'] },
  { title: 'Projet', items: ['elements', 'gallery'] },
];

const LEGACY_TOOLS = [
  ['layers', 'Layers Studio'], ['cinema', 'Cinema Studio'], ['clipping', 'AI Clipping'], ['motion-control', 'Motion Control'],
  ['lipsync', 'Lip Sync (MuAPI)'], ['marketing', 'Marketing Studio'], ['workflows', 'Workflows'], ['agents', 'Agents'], ['design-agent', 'Design Agent'],
];

function Sidebar({ view, collapsed, onToggle, mobileOpen, onCloseMobile }) {
  const { activeJobs, workspace } = useStudio();
  return (
    <aside className={cx('fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/[0.06] bg-[#08080c]/95 backdrop-blur-xl transition-all duration-300 md:static md:translate-x-0', collapsed ? 'md:w-[76px]' : 'md:w-[264px]', mobileOpen ? 'w-[280px] translate-x-0' : '-translate-x-full')}>
      <div className={cx('flex items-center gap-2 px-3 pt-4', collapsed ? 'justify-center' : 'justify-between')}>
        <Link href="/studio" className="flex items-center gap-2.5" onClick={onCloseMobile}>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-300 text-black shadow-[0_0_18px_rgba(34,211,238,0.35)]"><Icon name="layers" size={17} strokeWidth={2.2} /></span>
          {!collapsed && <span className="text-sm font-bold tracking-tight text-white">Personal Studio</span>}
        </Link>
        {!collapsed && (
          <button type="button" onClick={onToggle} className="hidden h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white md:flex" aria-label="Réduire la navigation">
            <Icon name="chevron" size={16} className="rotate-90" />
          </button>
        )}
      </div>
      {collapsed && (
        <button type="button" onClick={onToggle} className="mx-auto mt-3 hidden h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white md:flex" aria-label="Déployer la navigation">
          <Icon name="chevron" size={16} className="-rotate-90" />
        </button>
      )}

      <div className="px-3 pt-4"><WorkspaceSwitcher collapsed={collapsed} /></div>

      <nav className="custom-scrollbar mt-4 flex-1 overflow-y-auto px-3 pb-4" aria-label="Navigation du studio">
        <NavLink id="home" view={view} collapsed={collapsed} onNavigate={onCloseMobile} />
        {NAV.map((group) => (
          <div key={group.title} className="mt-4">
            {!collapsed && <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">{group.title}</p>}
            <div className="space-y-0.5">
              {group.items.map((id) => <NavLink key={id} id={id} view={view} collapsed={collapsed} onNavigate={onCloseMobile} badge={id === 'elements' ? workspace?.counts?.elements : id === 'gallery' ? workspace?.counts?.generations : null} />)}
            </div>
          </div>
        ))}
        <details className="mt-5 group">
          <summary className={cx('flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30 hover:text-white/60', collapsed && 'justify-center')}>
            <Icon name="grid" size={14} />
            {!collapsed && <span className="flex-1">Studios avancés</span>}
            {!collapsed && <Icon name="chevron" size={12} className="transition group-open:rotate-180" />}
          </summary>
          <div className="mt-1 space-y-0.5">
            {LEGACY_TOOLS.map(([id, label]) => (
              <Link key={id} href={`/studio/${id}`} title={label} className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-white/45 hover:bg-white/[0.05] hover:text-white', collapsed && 'justify-center')}>
                <Icon name="external" size={13} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            ))}
          </div>
        </details>
      </nav>

      {activeJobs.length > 0 && (
        <div className={cx('border-t border-white/[0.06] px-3 py-3', collapsed && 'flex justify-center')}>
          <div className={cx('flex items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-100', collapsed ? 'h-9 w-9 justify-center' : 'px-3 py-2')}>
            <Spinner size={14} />
            {!collapsed && <span className="truncate text-xs font-medium">{activeJobs.length === 1 ? activeJobs[0].label : `${activeJobs.length} générations en cours`}</span>}
          </div>
        </div>
      )}
    </aside>
  );
}

function NavLink({ id, view, collapsed, onNavigate, badge }) {
  const meta = STUDIO_VIEWS[id];
  const active = view === id;
  return (
    <Link href={id === 'home' ? '/studio' : `/studio/${id}`} onClick={onNavigate} title={meta.label} aria-current={active ? 'page' : undefined} className={cx('group relative flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition', collapsed && 'justify-center px-0', active ? 'border-cyan-300/20 bg-gradient-to-r from-cyan-300/15 to-violet-500/10 text-white shadow-[0_0_20px_rgba(34,211,238,0.08)]' : 'border-transparent text-white/55 hover:bg-white/[0.05] hover:text-white')}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-gradient-to-b from-cyan-300 to-violet-400" />}
      <Icon name={meta.icon} size={17} className={active ? 'text-cyan-200' : 'text-white/45 group-hover:text-white'} />
      {!collapsed && <span className="flex-1 truncate">{meta.label}</span>}
      {!collapsed && badge != null && badge > 0 && <span className="rounded-md bg-white/[0.08] px-1.5 text-[10px] font-semibold text-white/60">{badge}</span>}
    </Link>
  );
}

function Toasts() {
  const { toasts } = useStudio();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[130] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
      {toasts.map((item) => <Notice key={item.id} tone={item.tone === 'info' ? 'info' : item.tone} className="pointer-events-auto bg-[#0d0d12]/95 shadow-2xl">{item.message}</Notice>)}
    </div>
  );
}

function Frame({ view }) {
  const { status, error, catalogError, workspace } = useStudio();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem('studio:sidebar') === 'collapsed'); } catch { /* optional */ }
  }, []);

  function toggle() {
    setCollapsed((value) => {
      try { window.localStorage.setItem('studio:sidebar', value ? 'open' : 'collapsed'); } catch { /* optional */ }
      return !value;
    });
  }

  const meta = STUDIO_VIEWS[view] || STUDIO_VIEWS.home;
  const navigate = (target) => router.push(target === 'home' ? '/studio' : `/studio/${target}`);

  let content = null;
  if (status === 'error') {
    content = <div className="p-8"><Notice tone="error">Impossible de charger les projets : {error}</Notice></div>;
  } else if (status !== 'ready' || !workspace) {
    content = <div className="flex h-full items-center justify-center text-white/40"><Spinner size={22} /></div>;
  } else {
    content = {
      home: <HomeView navigate={navigate} />,
      image: <CreateView key={`image-${workspace.id}`} modality="image" navigate={navigate} />,
      video: <CreateView key={`video-${workspace.id}`} modality="video" navigate={navigate} />,
      voice: <VoiceView key={`voice-${workspace.id}`} navigate={navigate} />,
      elements: <ElementsView key={`elements-${workspace.id}`} navigate={navigate} />,
      gallery: <GalleryView key={`gallery-${workspace.id}`} navigate={navigate} />,
    }[view] || <HomeView navigate={navigate} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#050507] text-white">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />}
      <Sidebar view={view} collapsed={collapsed} onToggle={toggle} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#08080c]/80 px-4 backdrop-blur-xl md:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/[0.06] md:hidden" aria-label="Ouvrir la navigation"><Icon name="grid" size={18} /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{meta.title}</p>
            {workspace && <p className="truncate text-[11px] text-white/40">{workspace.name}{workspace.description ? ` · ${workspace.description}` : ''}</p>}
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 sm:flex">
            <span className={cx('h-2 w-2 rounded-full', catalogError ? 'bg-red-400' : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]')} />
            {catalogError ? 'Gateway hors ligne' : 'AI Gateway connecté'}
          </div>
        </header>
        <main className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto">{content}</main>
      </div>
      <Toasts />
    </div>
  );
}

export default function StudioShell({ view = 'home' }) {
  return (
    <StudioProvider>
      <Frame view={view} />
    </StudioProvider>
  );
}
