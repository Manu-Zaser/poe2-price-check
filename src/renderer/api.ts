import type { Api } from '../main/preload';

declare global {
  interface Window { api: Api }
}

export const api = window.api;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c) e.append(c);
  return e;
}

/** Item-Bild; blendet sich bei Ladefehler aus und zeigt stattdessen einen Platzhalter. */
export function itemIcon(src: string | undefined, cls: string): HTMLElement {
  const box = el('div', `${cls} icon-box`);
  if (!src) {
    box.classList.add('icon-empty');
    return box;
  }
  const img = el('img');
  img.src = src;
  img.alt = '';
  img.addEventListener('error', () => {
    img.remove();
    box.classList.add('icon-empty');
  });
  box.append(img);
  return box;
}
