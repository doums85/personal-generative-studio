'use client';

import { useEffect } from 'react';
import Image from 'next/image';

const ICONS = {
  home: <path d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5.5-5.5L6 20" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10 5-3v10l-5-3" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  wave: <path d="M4 12h2l2-5 3 10 3-8 2 5 2-2h2" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 20a6 6 0 0 0-5-6" /></>,
  map: <><path d="M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>,
  tag: <><path d="m3 12 9 9 9-9-9-9H3z" /><circle cx="8" cy="8" r="1.5" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 3 0 4-1a9 9 0 0 0-6-12z" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="7" r="1.2" /><circle cx="16" cy="10" r="1.2" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M4 19h16" />,
  star: <path d="m12 3 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.3l-5.7 3.2 1.2-6.4L2.8 9.7l6.4-.8z" />,
  play: <path d="M7 5v14l12-7z" />,
  upload: <path d="M12 16V5m0 0 4 4m-4-4-4 4M4 19h16" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  warning: <path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  arrow: <path d="M5 12h14m0 0-6-6m6 6-6 6" />,
  edit: <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM13 7l3 3" />,
  external: <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />,
};

export function Icon({ name, size = 18, className = '', strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICONS[name] || ICONS.spark}
    </svg>
  );
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

const BUTTON_VARIANTS = {
  primary: 'bg-gradient-to-r from-cyan-300 to-sky-400 text-black shadow-[0_8px_30px_rgba(34,211,238,0.25)] hover:from-cyan-200 hover:to-sky-300 disabled:from-white/20 disabled:to-white/20 disabled:text-white/40 disabled:shadow-none',
  secondary: 'bg-white/[0.06] text-white border border-white/10 hover:bg-white/[0.1] hover:border-white/20 disabled:text-white/30',
  ghost: 'text-white/60 hover:text-white hover:bg-white/[0.06] disabled:text-white/25',
  danger: 'bg-red-500/10 text-red-200 border border-red-400/20 hover:bg-red-500/20 disabled:text-white/30',
  accent: 'bg-violet-500/15 text-violet-100 border border-violet-400/25 hover:bg-violet-500/25',
};

const BUTTON_SIZES = { sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg', md: 'h-10 px-4 text-sm gap-2 rounded-xl', lg: 'h-12 px-5 text-sm gap-2 rounded-xl' };

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', loading = false, ...props }) {
  return (
    <button type="button" {...props} disabled={props.disabled || loading} className={cx('inline-flex items-center justify-center font-semibold transition disabled:cursor-not-allowed', BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}>
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className = '', size = 16, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} {...props} className={cx('inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40', className)}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Spinner({ size = 16, className = '' }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className)} style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Field({ label, hint, action, children, className = '' }) {
  return (
    <label className={cx('block', className)}>
      {(label || action) && (
        <span className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</span>
          {action}
        </span>
      )}
      {children}
      {hint && <span className="mt-1.5 block text-[11px] leading-4 text-white/35">{hint}</span>}
    </label>
  );
}

const CONTROL = 'w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/50 focus:bg-black/60 disabled:opacity-50';

export function Input({ className = '', ...props }) {
  return <input {...props} className={cx(CONTROL, 'h-10', className)} />;
}

export function Textarea({ className = '', ...props }) {
  return <textarea {...props} className={cx(CONTROL, 'resize-y py-2.5 leading-6', className)} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select {...props} className={cx(CONTROL, 'h-10 appearance-none bg-[#0f0f14] pr-8', className)} style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23ffffff80%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}>
      {children}
    </select>
  );
}

export function Segmented({ options, value, onChange, size = 'md', className = '' }) {
  return (
    <div className={cx('inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/30 p-1', className)} role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={active} disabled={option.disabled} title={option.title} onClick={() => onChange(option.value)} className={cx('rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-30', size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs', active ? 'bg-white/[0.12] text-white shadow-inner' : 'text-white/50 hover:text-white')}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ active = false, onClick, children, className = '', tone = 'cyan', ...props }) {
  const tones = { cyan: 'border-cyan-300/50 bg-cyan-300/12 text-cyan-100', violet: 'border-violet-400/50 bg-violet-400/12 text-violet-100', amber: 'border-amber-300/50 bg-amber-300/12 text-amber-100' };
  return (
    <button type="button" onClick={onClick} {...props} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition', active ? tones[tone] : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white', className)}>
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', className = '' }) {
  const tones = {
    neutral: 'bg-white/[0.06] text-white/60 border-white/10',
    cyan: 'bg-[#0b1f24]/85 text-cyan-100 border-cyan-300/30',
    violet: 'bg-[#1a1030]/85 text-violet-100 border-violet-400/30',
    green: 'bg-emerald-400/10 text-emerald-100 border-emerald-400/20',
    amber: 'bg-amber-300/10 text-amber-100 border-amber-300/20',
    red: 'bg-red-400/10 text-red-100 border-red-400/20',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm', tones[tone], className)}>{children}</span>;
}

export function Panel({ title, subtitle, action, children, className = '', bodyClassName = '' }) {
  return (
    <section className={cx('rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-white/40">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon = 'spark', title, description, action, className = '' }) {
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center', className)}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300/15 to-violet-400/15 text-cyan-200"><Icon name={icon} size={22} /></span>
      <p className="text-sm font-semibold text-white/80">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-5 text-white/40">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" className={cx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0c0c11] shadow-2xl sm:rounded-3xl', width)}>
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-white/45">{subtitle}</p>}
          </div>
          <IconButton icon="close" label="Fermer" onClick={onClose} />
        </header>
        <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] px-6 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function Notice({ tone = 'info', children, className = '' }) {
  const tones = {
    info: 'border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-50',
    warning: 'border-amber-300/25 bg-amber-300/[0.08] text-amber-50',
    error: 'border-red-400/25 bg-red-400/[0.08] text-red-50',
    success: 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-50',
  };
  const icon = { info: 'info', warning: 'warning', error: 'warning', success: 'check' }[tone];
  return (
    <div className={cx('flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-5', tones[tone], className)}>
      <Icon name={icon} size={15} className="mt-0.5 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Media thumbnail or player for images, videos and audio stored in a workspace. */
export function Media({ file, alt = '', className = '', controls = false, fill = false, sizes }) {
  if (!file?.url) return null;
  const type = file.mediaType || '';
  if (type.startsWith('video/')) {
    return <video src={file.url} controls={controls} muted={!controls} playsInline preload="metadata" className={cx('bg-black', className)} />;
  }
  if (type.startsWith('audio/')) {
    return <audio src={file.url} controls className={cx('w-full', className)} />;
  }
  if (fill) {
    return <Image src={file.url} alt={alt} fill unoptimized sizes={sizes || '(max-width: 768px) 100vw, 33vw'} className={cx('object-cover', className)} />;
  }
  return <Image src={file.url} alt={alt} width={1024} height={1024} unoptimized className={className} />;
}

export function Kbd({ children }) {
  return <kbd className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/60">{children}</kbd>;
}
