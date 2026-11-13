import type { PriceMatch, PriceResult } from '../shared/types';
import { api, el, itemIcon } from './api';
import { amount, priceParts, priceText } from './format';

const root = document.getElementById('root')!;
root.addEventListener('click', () => api.hideOverlay());

function trend(change?: number): HTMLElement | null {
  if (change === undefined || !Number.isFinite(change)) return null;
  const dir = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  return el('span', `trend ${dir}`, `${arrow} ${amount(Math.abs(change))} %`);
}

function bigPrice(m: PriceMatch): HTMLElement {
  const p = priceParts(m.divine, m.exalted);
  const meta = el('div', 'price-meta');
  if (p.alt) meta.append(el('span', '', p.alt));
  const t = trend(m.change7d);
  if (t) meta.append(t, el('span', 'faint', '7 Tage'));
  return el(
    'div', 'price-block',
    el('div', 'price-big', el('span', 'value', p.value), el('span', `unit unit-${p.unit.toLowerCase()}`, p.unit)),
    meta.childElementCount ? meta : null,
  );
}

function candidateRow(m: PriceMatch): HTMLElement {
  return el(
    'div', 'cand',
    itemIcon(m.icon, 'cand-icon'),
    el('span', 'cand-name', m.name),
    el('span', 'cand-price', priceText(m)),
  );
}

function header(r: Exclude<PriceResult, { kind: 'error' }>, icon?: string): HTMLElement {
  const item = r.item;
  const sub = item.name ? item.baseType : item.itemClass;
  const tags: string[] = [];
  if (item.corrupted) tags.push('Corrupted');
  if (item.unidentified) tags.push('Unidentifiziert');
  if (item.itemLevel) tags.push(`iLvl ${item.itemLevel}`);
  return el(
    'div', 'head',
    icon ? itemIcon(icon, 'head-icon') : null,
    el(
      'div', 'head-text',
      el('div', `title rarity-${item.rarity.toLowerCase()}`, item.name ?? item.baseType),
      el('div', 'sub', sub),
      tags.length ? el('div', 'tags', ...tags.map((t) => el('span', `tag ${t === 'Corrupted' ? 'tag-bad' : ''}`, t))) : null,
    ),
  );
}

function render(r: PriceResult): HTMLElement {
  const card = el('div', 'card');

  if (r.kind === 'error') {
    card.classList.add('card-error');
    card.append(el('div', 'msg', el('span', 'msg-icon', '!'), el('span', '', r.message)));
    return card;
  }

  if (r.kind !== 'priced') {
    card.append(header(r), el('div', 'note', r.reason));
    return card;
  }

  const first = r.matches[0];
  const unidentified = !r.item.name && r.matches.length > 1;
  card.append(header(r, unidentified ? undefined : first.icon));

  if (unidentified) {
    card.append(el('div', 'label', 'Mögliche Uniques'));
    card.append(el('div', 'cands', ...r.matches.slice(0, 5).map(candidateRow)));
    if (r.matches.length > 5) card.append(el('div', 'note', `+ ${r.matches.length - 5} weitere`));
  } else {
    card.append(bigPrice(first));
    if (r.stackSize && r.stackSize > 1) {
      card.append(el('div', 'stack', el('span', '', `Stapel × ${r.stackSize}`), el('strong', '', priceText(first, r.stackSize))));
    }
  }

  if (r.item.corrupted && r.item.rarity === 'Unique') {
    card.append(el('div', 'note', 'Preis gilt für nicht-corrupted Exemplare.'));
  }

  const listings = !unidentified && first.listingCount !== undefined ? `${first.listingCount} Angebote · ` : '';
  card.append(el('div', 'foot', `${listings}poe.ninja · ${r.league}`));
  return card;
}

api.onResult((r, seconds) => {
  const card = render(r);
  const bar = el('div', 'timer');
  bar.style.animationDuration = `${seconds}s`;
  card.append(bar);
  root.replaceChildren(card);
  // getBoundingClientRect erzwingt das Layout synchron. Kein requestAnimationFrame:
  // Das Fenster ist zu diesem Zeitpunkt noch versteckt, dort feuert rAF nicht zuverlässig.
  api.overlayReady(root.getBoundingClientRect().height);
});
