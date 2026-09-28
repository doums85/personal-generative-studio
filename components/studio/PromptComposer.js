'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { KIND_META } from '@/lib/studio/client';
import { Icon, cx } from './ui';

function mentionToken(name) {
  const words = name.trim().split(/\s+/);
  return `@${words.length <= 2 ? words.join(' ') : words[0]}`;
}

/**
 * Prompt textarea with `@` autocompletion over the workspace elements.
 * Selecting an entry inserts `@Name`; the server resolves mentions to references.
 */
export default function PromptComposer({ value, onChange, elements = [], placeholder, rows = 6, disabled = false, onSubmit }) {
  const textarea = useRef(null);
  const [query, setQuery] = useState(null);
  const [cursor, setCursor] = useState(0);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return elements.filter((element) => !needle || element.name.toLowerCase().includes(needle)).slice(0, 6);
  }, [elements, query]);

  useEffect(() => { setCursor(0); }, [query]);

  function updateQuery(text, caret) {
    const before = text.slice(0, caret);
    const match = before.match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
    setQuery(match ? match[1] : null);
  }

  function insert(element) {
    const node = textarea.current;
    const caret = node?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N}_-]*)$/u, '');
    const after = value.slice(caret);
    const token = mentionToken(element.name);
    const next = `${before}${token} ${after}`;
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      node?.focus();
      const position = before.length + token.length + 1;
      node?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event) {
    if (suggestions.length && query !== null) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((index) => (index + 1) % suggestions.length); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((index) => (index - 1 + suggestions.length) % suggestions.length); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insert(suggestions[cursor]); return; }
      if (event.key === 'Escape') { setQuery(null); return; }
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit?.(); }
  }

  return (
    <div className="relative">
      <textarea
        ref={textarea}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => { onChange(event.target.value); updateQuery(event.target.value, event.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onClick={(event) => updateQuery(event.target.value, event.target.selectionStart)}
        onBlur={() => window.setTimeout(() => setQuery(null), 150)}
        className="w-full resize-y rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-[15px] leading-7 text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/50 focus:bg-black/60 disabled:opacity-50"
      />
      <div className="pointer-events-none absolute bottom-2.5 right-3 flex items-center gap-1 text-[10px] text-white/30">
        <span>@ pour insérer un élément · ⌘↵ pour générer</span>
      </div>
      {query !== null && suggestions.length > 0 && (
        <div className="absolute left-3 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0d0d12] p-1 shadow-2xl" role="listbox">
          {suggestions.map((element, index) => (
            <button key={element.id} type="button" role="option" aria-selected={index === cursor} onMouseDown={(event) => { event.preventDefault(); insert(element); }} className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', index === cursor ? 'bg-cyan-300/12 text-white' : 'text-white/70 hover:bg-white/[0.05]')}>
              {element.images?.[0] ? <Image src={element.images[0].url} alt="" width={28} height={28} unoptimized className="h-7 w-7 rounded-md object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06]"><Icon name={KIND_META[element.kind]?.icon || 'spark'} size={14} /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{element.name}</span>
                <span className="block text-[10px] uppercase tracking-wide text-white/35">{KIND_META[element.kind]?.label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
