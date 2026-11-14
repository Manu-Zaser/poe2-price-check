import { categoryFor, defaultMatchCount } from '../shared/stats';
import { isStale, STALE_DAYS, type PriceSuggestion } from '../shared/extras';
import type { Listing, PriceMatch, PriceResult, TradeMod, TradeSelection } from '../shared/types';
import { api, el, itemIcon } from './api';
import { ageFromIso, amount, currencyShort, parseMin, priceParts, priceText } from './format';

const root = document.getElementById('root')!;

type Result = Exclude<PriceResult, { kind: 'error' }>;
type TradeResult = Extract<PriceResult, { kind: 'trade' }>;

// ---------- Bausteine ----------

function trend(change?: number): HTMLElement | null {
  if (change === undefined || !Number.isFinite(change)) return null;
  const dir = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  return el('span', `trend ${dir}`, `${arrow} ${amount(Math.abs(change))}%`);
}

function bigPrice(value: string, unit: string, prefix?: string, meta?: HTMLElement | null): HTMLElement {
  return el(
    'div', 'price-block',
    el('div', 'price-big', prefix ? el('span', 'prefix', prefix) : null, el('span', 'value', value), el('span', `unit unit-${unit.toLowerCase()}`, unit)),
    meta && meta.childElementCount ? meta : null,
  );
}

/**
 * Mini-Grafik des Kursverlaufs (poe.ninja: Änderung in % je Tag). Die Null-Linie ist der Stand
 * vor einer Woche – darüber teurer, darunter günstiger geworden.
 */
function sparkline(points: number[], change?: number): SVGSVGElement {
  const W = 72;
  const H = 22;
  const lo = Math.min(0, ...points);
  const hi = Math.max(0, ...points);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 2) + 1;
  const y = (v: number) => H - 1 - ((v - lo) / span) * (H - 2);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', `spark ${change === undefined ? '' : change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat'}`);
  const zero = document.createElementNS(ns, 'line');
  zero.setAttribute('x1', '0');
  zero.setAttribute('x2', String(W));
  zero.setAttribute('y1', String(y(0)));
  zero.setAttribute('y2', String(y(0)));
  zero.setAttribute('class', 'spark-zero');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  line.setAttribute('class', 'spark-line');
  svg.append(zero, line);
  const title = document.createElementNS(ns, 'title');
  title.textContent = `Price change over the last ${points.length} days (poe.ninja)`;
  svg.append(title);
  return svg;
}

function ninjaPrice(m: PriceMatch): HTMLElement {
  const p = priceParts(m.divine, m.exalted);
  const meta = el('div', 'price-meta');
  if (p.alt) meta.append(el('span', '', p.alt));
  const t = trend(m.change7d);
  if (m.sparkline) meta.append(sparkline(m.sparkline, m.change7d));
  if (t) meta.append(t, el('span', 'faint', '7 days'));
  return bigPrice(p.value, p.unit, undefined, meta);
}

function candidateRow(m: PriceMatch): HTMLElement {
  return el('div', 'cand', itemIcon(m.icon, 'cand-icon'), el('span', 'cand-name', m.name), el('span', 'cand-price', priceText(m)));
}

function closeButton(): HTMLElement {
  const b = el('button', 'close', '×');
  b.title = 'Close (Esc)';
  b.addEventListener('click', () => api.hideOverlay());
  return b;
}

/**
 * Kopfzeile = Griff zum Verschieben (-webkit-app-region: drag). Das Fenster merkt sich die
 * neue Position für alle weiteren Preischecks. Der Schließen-Knopf liegt mit darin.
 */
function header(r: Result | null, icon?: string, title?: string, showTags = true): HTMLElement {
  const text = el('div', 'head-text');
  if (r) {
    const item = r.item;
    const tags: string[] = [];
    // Corrupted-Status bei Ausrüstung immer zeigen – er ändert den Preis deutlich.
    const gear = ['Normal', 'Magic', 'Rare', 'Unique'].includes(item.rarity);
    if (item.corrupted) tags.push('Corrupted');
    else if (gear) tags.push('Not corrupted');
    if (item.unidentified) tags.push('Unidentified');
    if (item.itemLevel) tags.push(`iLvl ${item.itemLevel}`);
    text.append(
      el('div', `title rarity-${item.rarity.toLowerCase()}`, item.name ?? item.baseType),
      el('div', 'sub', item.name ? item.baseType : item.itemClass),
    );
    if (showTags && tags.length) text.append(el('div', 'tags', ...tags.map((t) => el('span', `tag ${t === 'Corrupted' ? 'tag-bad' : t === 'Not corrupted' ? 'tag-ok' : ''}`, t))));
  } else {
    text.append(el('div', 'title', title ?? ''));
  }
  const grip = el('span', 'grip', '⠿');
  grip.title = 'Drag anywhere on the overlay to move it';
  return el('div', 'head', icon ? itemIcon(icon, 'head-icon') : null, text, grip, closeButton());
}

// ---------- Gemerkte Ansicht ----------

/** Ansicht, die für alle weiteren Preischecks gilt (Stat-Liste eingeklappt, versteckte Stats sichtbar). */
const PREF_DEFAULTS: Record<string, boolean> = { 'stats-collapsed': false, 'show-hidden': false };
/** Fallback, falls localStorage nicht verfügbar ist – gilt dann nur bis zum Neustart. */
const prefMemory = new Map<string, boolean>();

function pref(id: string): boolean {
  if (prefMemory.has(id)) return prefMemory.get(id)!;
  try {
    const v = localStorage.getItem(`pref:${id}`);
    if (v !== null) return v === '1';
  } catch {
    // kein Speicher – Standard verwenden
  }
  return PREF_DEFAULTS[id] ?? false;
}

function setPref(id: string, value: boolean) {
  prefMemory.set(id, value);
  try {
    localStorage.setItem(`pref:${id}`, value ? '1' : '0');
  } catch {
    // egal – Zustand bleibt im Speicher
  }
}

// ---------- poe.ninja (Währung, Uniques) ----------

function renderNinja(r: Extract<PriceResult, { kind: 'priced' }>): HTMLElement {
  const card = el('div', 'card');
  const first = r.matches[0];
  const unidentified = !r.item.name && r.matches.length > 1;
  card.append(header(r, unidentified ? undefined : first.icon));

  if (unidentified) {
    card.append(el('div', 'label', 'Possible uniques'));
    card.append(el('div', 'cands', ...r.matches.slice(0, 5).map(candidateRow)));
    if (r.matches.length > 5) card.append(el('div', 'note', `+ ${r.matches.length - 5} more`));
  } else {
    card.append(ninjaPrice(first));
    if (r.stackSize && r.stackSize > 1) {
      card.append(el('div', 'stack', el('span', '', `Stack × ${r.stackSize}`), el('strong', '', priceText(first, r.stackSize))));
    }
  }
  if (r.item.corrupted && r.item.rarity === 'Unique') card.append(el('div', 'note', 'Price applies to non-corrupted copies.'));

  const listings = !unidentified && first.listingCount !== undefined ? `${first.listingCount} listings · ` : '';
  card.append(el('div', 'foot', `${listings}poe.ninja · ${r.league}`));
  return card;
}

// ---------- Trade-Suche (Rares, Uniques) ----------
//
// Aufbau wie die Trade-Seite bzw. Exiled Exchange:
//   Chips (Kategorie/Basis, Corrupted, Item-Level, Sockel, Mod-Abgleich)
//   Stat-Zeilen mit Min/Max und Herkunft darunter (Explicit, Implicit, Augment …)
//   Ergebnisleiste (Treffer, Sofortkauf, Suchen, Trade-Seite)
//   Kurzfassung (typischer Preis, Verkaufsvorschlag) und Angebotstabelle.
// Gesucht wird nur mit Klick auf "Search" – Änderungen werden bis dahin gesammelt.

/** Herkunft wie auf der Trade-Seite ("Augment" = Rune/Seelenkern im Sockel). */
const KIND_LABEL: Partial<Record<TradeMod['kind'], string>> = {
  explicit: 'Explicit', implicit: 'Implicit', rune: 'Augment', enchant: 'Enchant', crafted: 'Crafted',
  fractured: 'Fractured', desecrated: 'Desecrated', pseudo: 'Total',
};

function formatNum(n: number | undefined): string {
  if (n === undefined) return '';
  return Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Schrittweite fürs Mausrad, abhängig von der Größenordnung des ursprünglichen Wertes. */
function wheelStep(original: number | null, current: number): number {
  const ref = Math.abs(original ?? current);
  const decimal = original !== null && !Number.isInteger(original);
  if (decimal && ref < 10) return 0.1;
  if (ref < 100) return 1;
  return 5;
}

/** Warum ein Stat standardmäßig ausgeblendet ist; null = sichtbar. */
function hiddenReason(m: TradeMod): string | null {
  if (m.statId === null && !m.filter) return 'Not found in the trade search – cannot be searched.';
  if (m.coveredBy === 'total') return 'Already counted in a total above – tick it only to search for this mod on its own.';
  if (m.coveredBy === 'DPS') return 'Already counted in the DPS above – tick it only to search for this mod on its own.';
  if (m.coveredBy === 'crit') return "Already counted in the weapon's critical hit chance above – tick it only when price-checking a crafting base.";
  if (m.coveredBy === 'defence') return 'Already counted in the defences above – tick it only to search for this mod on its own.';
  return null;
}

const AFFIX: Record<string, { short: string; long: string }> = {
  prefix: { short: 'P', long: 'Prefix' },
  suffix: { short: 'S', long: 'Suffix' },
  implicit: { short: 'I', long: 'Implicit' },
  other: { short: '', long: 'Mod' },
};

/** "P T9" = Präfix, Tier 9. In PoE2 ist eine höhere Tier-Zahl besser. */
function tierBadge(t: NonNullable<TradeMod['tiers']>[number]): HTMLElement {
  const a = AFFIX[t.affix] ?? AFFIX.other;
  const badge = el('span', `tier tier-${t.affix}`, a.short ? el('span', 'tier-affix', a.short) : null, `T${t.tier}`);
  badge.title = `${a.long}, tier ${t.tier} – in PoE2 higher is better`;
  return badge;
}

/**
 * Höchstwert des Tiers (aus dem erweiterten Kopieren), z. B. "max 149". Gold = bereits der
 * bestmögliche Wert; der Tooltip zeigt den ganzen Bereich und die Roll-Qualität.
 */
function rollBadge(r: NonNullable<TradeMod['rolls']>[number]): HTMLElement {
  const pct = Math.round(r.quality * 100);
  const perfect = r.quality >= 1;
  const badge = el('span', `roll${perfect ? ' roll-max' : ''}`, perfect ? 'max ✓' : `max ${r.max}`);
  badge.title = perfect
    ? `Perfect roll – the highest value of this tier (${r.range})`
    : `Highest value of this tier: ${r.max} · range ${r.range} · your roll: ${pct}%`;
  return badge;
}

/**
 * Min- oder Max-Feld: Mausrad ändert den Wert ohne Fokuswechsel (das Spiel behält die Tastatur),
 * Klick erlaubt Eintippen, leer = ohne Grenze.
 */
function numInput(m: TradeMod, which: 'min' | 'max', onCommit: () => void): HTMLInputElement {
  const input = el('input', `num-input num-${which}`);
  input.type = 'text';
  input.inputMode = 'decimal';
  input.dataset.which = which;
  input.value = formatNum(which === 'min' ? m.min : m.max);
  input.placeholder = which;
  input.title = `${which === 'min' ? 'Minimum' : 'Maximum'} – scroll to change, click to type, empty = no limit`;
  let committed = input.value;

  const commit = () => {
    const n = parseMin(input.value);
    input.classList.toggle('invalid', Number.isNaN(n));
    if (Number.isNaN(n) || input.value === committed) return;
    committed = input.value;
    onCommit();
  };

  input.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const current = parseMin(input.value);
      const fallback = (which === 'min' ? m.min : m.max) ?? m.value ?? 0;
      const base = current === null || Number.isNaN(current) ? fallback : current;
      const step = wheelStep(m.value, base);
      input.value = formatNum(Math.max(0, Math.round((base + (e.deltaY < 0 ? step : -step)) * 100) / 100));
      commit();
    },
    { passive: false },
  );
  // Zum Tippen braucht das Overlay kurz den Tastaturfokus.
  input.addEventListener('mousedown', () => {
    if (document.activeElement !== input) api.focusOverlay();
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => input.classList.toggle('invalid', Number.isNaN(parseMin(input.value))));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      input.value = committed;
      input.classList.remove('invalid');
      input.blur();
    }
  });
  input.addEventListener('blur', commit);
  return input;
}

/** Eine Stat-Zeile: Haken · Text (darunter Herkunft und Tier) · Min · Max. */
function statRow(m: TradeMod, onChange: () => void): HTMLElement {
  const searchable = m.statId !== null || !!m.filter;
  const reason = hiddenReason(m);
  const row = el('div', `stat stat-${m.kind}${searchable ? '' : ' stat-off'}${reason ? ' stat-hidden' : ''}${m.danger ? ' stat-danger' : ''}${m.low ? ' stat-low' : ''}`);
  row.dataset.key = m.key;
  if (m.statId) row.dataset.stat = '1';
  if (reason) row.title = reason;

  const box = el('input');
  box.type = 'checkbox';
  box.checked = m.enabled;
  box.disabled = !searchable;
  const sync = () => row.classList.toggle('on', box.checked);
  box.addEventListener('change', () => {
    sync();
    onChange();
  });

  // Klick auf den Text schaltet ebenfalls um (große Trefferfläche, kein Fokus nötig).
  const text = el('div', 'stat-text', m.text);
  if (searchable) {
    text.addEventListener('click', () => {
      box.checked = !box.checked;
      sync();
      onChange();
    });
  }

  const tags = el('div', 'stat-tags');
  const coveredLabel: Record<NonNullable<TradeMod['coveredBy']>, string> = { total: 'total', DPS: 'DPS', crit: 'crit chance', defence: 'defences' };
  if (m.danger) tags.append(el('span', 'kind kind-danger', '⚠ Dangerous'));
  if (m.keyMod) {
    const k = el('span', 'kind kind-key', 'Key');
    k.title = 'Usually carries the price on this item type – searched by default (Settings → Mod value)';
    tags.append(k);
  }
  if (m.low) {
    const l = el('span', 'kind kind-low', 'Low value');
    l.title = 'Rarely affects the price – not searched by default (Settings → Mod value)';
    tags.append(l);
  }
  if (reason) tags.append(el('span', 'tag-hidden', m.coveredBy ? `◌ in ${coveredLabel[m.coveredBy]}` : '◌ not searchable'));
  const kind = KIND_LABEL[m.kind];
  if (kind && m.kind !== 'pseudo') tags.append(el('span', `kind kind-${m.kind}`, kind));
  // Tier und Roll paarweise: bei zusammengefassten Mods gehört jeder Roll zu "seinem" Tier.
  const tiers = m.tiers ?? [];
  const rolls = m.rolls ?? [];
  for (let i = 0; i < Math.max(tiers.length, rolls.length); i++) {
    if (tiers[i]) tags.append(tierBadge(tiers[i]));
    if (rolls[i]) tags.append(rollBadge(rolls[i]));
  }
  if (m.combined) {
    const s = el('span', 'kind', 'summed');
    s.title = 'Several lines with the same stat – the trade search uses the sum.';
    tags.append(s);
  }

  const withValue = searchable && m.value !== null;
  const onValue = () => {
    box.checked = true; // Wert geändert → Stat soll mitgesucht werden
    sync();
    onChange();
  };
  const minInput = withValue ? numInput(m, 'min', onValue) : null;
  const maxInput = withValue ? numInput(m, 'max', onValue) : null;

  // Waffen unter 20 % Qualität: per Klick den DPS-Wert bei 20 % als Minimum nehmen.
  if (m.q20 !== undefined && minInput) {
    const q20 = m.q20;
    const btn = el('button', 'q20', `Q20: ${formatNum(q20)}`);
    btn.type = 'button';
    btn.title = `DPS at 20% quality – this weapon has less. Click to use it as the minimum, click again for ${formatNum(m.min)}.`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      minInput.value = formatNum(on ? Math.floor(q20 * 10) / 10 : m.min);
      minInput.dispatchEvent(new Event('blur')); // übernehmen wie nach dem Tippen
    });
    tags.append(btn);
  }

  row.append(
    box,
    el('div', 'stat-main', text, tags.childElementCount ? tags : null),
    minInput ?? el('span', 'num-empty'),
    maxInput ?? el('span', 'num-empty'),
  );
  sync();
  return row;
}

/**
 * Elemental DPS: Element wählen ("Any" oder z. B. "Cold"). Die Wahl hakt den passenden
 * "Adds # to # Cold Damage"-Mod an (ohne Mindestwert) – so passen nur Waffen mit diesem Element.
 */
function elementChoice(stats: HTMLElement, mods: TradeMod[], onChange: () => void) {
  const row = stats.querySelector<HTMLElement>('.stat[data-key="w:edps"]');
  if (!row) return;
  const byElement = new Map<string, string>(); // Element → Mod-Key
  for (const m of mods) {
    const hit = (m.template ?? '').match(/^Adds # to # (Fire|Cold|Lightning) Damage$/);
    if (hit && m.statId) byElement.set(hit[1], m.key);
  }
  if (!byElement.size) return;

  const main = row.querySelector<HTMLElement>('.stat-main')!;
  let tags = main.querySelector<HTMLElement>('.stat-tags');
  if (!tags) {
    tags = el('div', 'stat-tags');
    main.append(tags);
  }
  const group = el('span', 'el-choice');
  const buttons: HTMLButtonElement[] = [];
  const pick = (element: string | null) => {
    for (const [name, key] of byElement) {
      const modRow = stats.querySelector<HTMLElement>(`.stat[data-key="${key}"]`);
      const box = modRow?.querySelector<HTMLInputElement>('input[type=checkbox]');
      const min = modRow?.querySelector<HTMLInputElement>('.num-min');
      if (!modRow || !box) continue;
      const on = name === element;
      if (on && min) min.value = ''; // nur das Element zählt, nicht die Höhe des Schadens
      if (box.checked !== on) {
        box.checked = on;
        box.dispatchEvent(new Event('change'));
      }
    }
    for (const b of buttons) b.classList.toggle('on', (b.dataset.element || null) === element);
    onChange();
  };
  for (const name of ['Any', ...byElement.keys()]) {
    const b = el('button', `el-btn${name === 'Any' ? ' on' : ''}`, name);
    b.type = 'button';
    b.dataset.element = name === 'Any' ? '' : name;
    b.title = name === 'Any' ? 'Any elemental damage' : `Only weapons with added ${name.toLowerCase()} damage`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pick(name === 'Any' ? null : name);
    });
    buttons.push(b);
    group.append(b);
  }
  tags.append(group);
}

function listingRow(l: Listing, now: number): HTMLElement {
  const stale = isStale(l, now);
  const short = currencyShort(l.currency);
  const row = el(
    'div', `lst${stale ? ' lst-stale' : ''}`,
    el('span', 'lst-price', `${amount(l.amount)} `, el('span', `unit unit-${short.toLowerCase()}`, short)),
    el('span', 'lst-ilvl', l.itemLevel ? String(l.itemLevel) : '–'),
    el('span', 'lst-age', ageFromIso(l.indexed)),
  );
  if (stale) row.title = `Listed for more than ${STALE_DAYS} days – probably not a real price, ignored for the typical price.`;
  return row;
}

/** Verkaufspreis-Vorschlag mit Kopier-Button für die Stash-Notiz. */
function sellBlock(sg: PriceSuggestion): HTMLElement {
  const btn = el('button', 'btn-xs', 'Copy');
  btn.title = `Copy "${sg.note}" as a stash tab note`;
  btn.addEventListener('click', () => {
    api.copyText(sg.note);
    btn.textContent = 'Copied ✓';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('done');
    }, 1500);
  });
  const unit = sg.currency === 'divine' ? 'Div' : 'Ex';
  // Vorschläge in Exalted zusätzlich in Div zeigen – sonst muss man im Kopf umrechnen.
  const approx = sg.approxDivine !== undefined && sg.approxDivine >= 0.1 ? ` ≈ ${amount(Math.round(sg.approxDivine * 100) / 100)} Div` : '';
  const block = el(
    'div', 'sum-sell',
    el('span', 'sum-label', 'Sell for'),
    el('strong', 'sum-sell-value', `${amount(sg.amount)} `, el('span', `unit unit-${unit.toLowerCase()}`, unit)),
    approx ? el('span', 'sum-approx', approx) : null,
    btn,
  );
  block.title = `Just below the typical price (median of the ${sg.basedOn} cheapest)${sg.basedOn < 3 ? ' – little data' : ''}`;
  return block;
}

/** Alles, was zu einer offenen Trade-Ansicht gehört; nach "Search" wird nur der Ergebnisteil ersetzt. */
interface TradeView {
  requestId: number;
  card: HTMLElement;
  head: HTMLElement;
  results: HTMLElement;
  matched: HTMLElement;
  searchBtn: HTMLButtonElement;
  openBtn: HTMLButtonElement;
  url: string | null;
  /** Auswahl seit der letzten Suche geändert? */
  dirty: boolean;
  searching: boolean;
  refresh: () => void;
}

let view: TradeView | null = null;

function matchedText(r: TradeResult): string {
  if (r.pending) return 'Searching …';
  return r.search ? `Matched: ${r.search.total}` : 'Not searched';
}

function resultsContent(r: TradeResult): HTMLElement[] {
  const s = r.search;
  const out: HTMLElement[] = [];
  if (r.pending) {
    // Platzhalter in Größe des späteren Ergebnisses, damit das Overlay beim Nachladen kaum springt.
    out.push(
      el('div', 'loading', el('span', 'spinner'), el('span', '', 'Searching pathofexile.com …')),
      el('div', 'lst-table skeleton', ...Array.from({ length: 6 }, () => el('div', 'lst', el('span', 'bar w40'), el('span', 'bar w20'), el('span', 'bar w30')))),
    );
  } else if (!s && !r.error) {
    // Noch nicht gesucht: erst Auswahl prüfen, dann "Search".
    out.push(el('div', 'idle', 'Check the ticked stats and values, then click ', el('strong', '', 'Search'), '.'));
  } else if (s && s.listings.length > 0) {
    const cheapest = s.listings[0];
    const now = Date.now();

    // Kurzfassung: typischer Preis links, Verkaufsvorschlag rechts.
    const price = el('div', 'sum-price');
    if (s.market) {
      const p = priceParts(s.market.divine, s.market.exalted);
      price.append(
        el('strong', 'sum-value', `≈ ${p.value} `, el('span', `unit unit-${p.unit.toLowerCase()}`, p.unit)),
        el('span', 'sum-label', `typical · from ${amount(cheapest.amount)} ${currencyShort(cheapest.currency)}`),
      );
      price.title = `Median of the ${s.market.basedOn} cheapest current listings`
        + (s.market.staleIgnored ? ` – ${s.market.staleIgnored} listings older than ${STALE_DAYS} days ignored` : '');
    } else {
      price.append(
        el('strong', 'sum-value', `${amount(cheapest.amount)} `, el('span', `unit unit-${currencyShort(cheapest.currency).toLowerCase()}`, currencyShort(cheapest.currency))),
        el('span', 'sum-label', 'cheapest'),
      );
    }
    out.push(el('div', 'summary', price, s.suggestion ? sellBlock(s.suggestion) : null));

    // Alle Hinweise in einem Kasten.
    if (s.warnings?.length) out.push(el('div', 'warn', el('span', 'warn-icon', '!'), el('div', 'warn-lines', ...s.warnings.map((w) => el('span', '', w)))));

    out.push(
      el(
        'div', 'lst-table',
        el('div', 'lst lst-head', el('span', '', 'Price'), el('span', '', 'iLvl'), el('span', '', 'Listed')),
        ...s.listings.slice(0, 20).map((l) => listingRow(l, now)),
      ),
    );
  } else if (s) {
    const hint = r.item.rarity === 'Unique' ? 'Tick fewer stats or lower values.' : 'Tick fewer stats or lower values.';
    out.push(el('div', 'empty-result', `No listings with these stats. ${hint}`));
  }
  if (r.error) out.push(el('div', 'alert', r.error));
  // Uniques: poe.ninja-Preis als Vergleich – auch schon vor der ersten Suche.
  if (r.reference && !r.pending) {
    out.push(el('div', 'ref', el('span', '', 'poe.ninja (any rolls)'), el('strong', '', priceText(r.reference))));
  }
  return out;
}

/** Schalt-Chip; aktiv = hervorgehoben. */
function chip(cls = ''): HTMLButtonElement {
  const b = el('button', `chip ${cls}`);
  b.type = 'button';
  return b;
}

function renderTrade(r: TradeResult): HTMLElement {
  const card = el('div', 'card card-trade');
  const head = header(r, r.search?.icon, undefined, false);
  const unique = r.item.rarity === 'Unique';

  // Zustand der Chips; gelesen wird er erst beim Suchen.
  let useBaseType = r.useBaseType;
  let matchAll = r.matchAll;
  let instantOnly = r.instantOnly;
  const misc = r.mods.filter((m) => m.kind === 'misc').map((m) => ({ mod: m, on: m.enabled, min: m.min }));

  // Reihenfolge wie bei der Trade-Seite: Waffe, Verteidigung, Summen, dann die Mods des Items.
  const order: TradeMod['kind'][] = ['weapon', 'defence', 'pseudo'];
  const statMods = [
    ...order.flatMap((k) => r.mods.filter((m) => m.kind === k)),
    ...r.mods.filter((m) => !order.includes(m.kind) && m.kind !== 'misc'),
  ];

  const stats = el('div', 'stats');
  const chips = el('div', 'chips');
  const updaters: (() => void)[] = [];
  const updateChips = () => updaters.forEach((u) => u());

  // Änderungen werden nur gesammelt; gesucht wird erst mit Klick auf "Search".
  const onChange = () => {
    updateChips();
    if (!view) return;
    view.dirty = true;
    view.refresh();
  };

  stats.append(...statMods.map((m) => statRow(m, onChange)));
  elementChoice(stats, r.mods, onChange);

  // --- Chips ---
  // Standard ist die ganze Kategorie; ohne bekannte Kategorie geht nur die Basis.
  if (!unique) {
    const hasCategory = !!categoryFor(r.item.itemClass);
    const c = chip('on');
    c.title = hasCategory
      ? 'Click to switch between the whole item category and only this base type'
      : 'This item class has no trade category – searching this base type';
    c.disabled = !hasCategory;
    updaters.push(() => {
      c.textContent = useBaseType || !hasCategory ? `Base: ${r.item.baseType}` : `Category: ${r.item.itemClass}`;
    });
    c.addEventListener('click', () => {
      useBaseType = !useBaseType;
      onChange();
    });
    chips.append(c);
  }
  for (const f of misc) {
    const c = chip();
    const isValue = f.mod.filter === 'ilvl' || f.mod.filter === 'sockets' || f.mod.filter === 'gem_level' || f.mod.filter === 'quality';
    c.title = isValue ? 'Click to use this filter · scroll to change the value' : 'Click to use this filter';
    updaters.push(() => {
      c.classList.toggle('on', f.on);
      c.textContent =
        f.mod.filter === 'ilvl' ? `Item level ${f.min ?? '–'}+`
        : f.mod.filter === 'sockets' ? `Sockets ${f.min ?? '–'}+`
        : f.mod.filter === 'gem_level' ? `Gem level ${f.min ?? '–'}+`
        : f.mod.filter === 'quality' ? `Quality ${f.min ?? 0}%+`
        : f.mod.text;
    });
    c.addEventListener('click', () => {
      f.on = !f.on;
      onChange();
    });
    if (isValue) {
      c.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          f.min = Math.max(0, (f.min ?? f.mod.value ?? 0) + (e.deltaY < 0 ? 1 : -1));
          f.on = true;
          onChange();
        },
        { passive: false },
      );
    }
    chips.append(c);
  }
  if (statMods.length) {
    const c = chip();
    c.title = 'Click to switch between "all ticked stats must match" and "most of them"';
    updaters.push(() => {
      const n = stats.querySelectorAll('.stat[data-stat] input[type=checkbox]:checked').length;
      c.classList.toggle('on', matchAll);
      c.textContent = n === 0 ? 'No stats ticked' : matchAll || n <= 2 ? `All ${n} stat${n === 1 ? '' : 's'} must match` : `${defaultMatchCount(n)} of ${n} stats must match`;
    });
    c.addEventListener('click', () => {
      matchAll = !matchAll;
      onChange();
    });
    chips.append(c);
  }

  // --- Leiste unter den Stats: Einklappen, versteckte Stats ---
  const hiddenCount = statMods.filter((m) => hiddenReason(m) && !m.danger).length; // gefährliche Mods bleiben immer sichtbar
  const collapseBtn = el('button', 'link-btn');
  const hiddenBtn = el('button', 'link-btn');
  const wheelHint = el('span', 'hint', 'scroll a value to change it');
  hiddenBtn.title = 'Stats that are already counted in a total/DPS or cannot be searched';
  const applyView = () => {
    const collapsed = pref('stats-collapsed');
    const showHidden = pref('show-hidden');
    stats.classList.toggle('collapsed', collapsed);
    stats.classList.toggle('show-hidden', showHidden);
    const ticked = stats.querySelectorAll('.stat input[type=checkbox]:checked').length;
    collapseBtn.textContent = collapsed ? `▾ Show stats (${ticked} ticked)` : '▴ Collapse';
    hiddenBtn.textContent = `${showHidden ? '◉' : '◌'} Hidden (${hiddenCount})`;
    hiddenBtn.classList.toggle('on', showHidden);
    hiddenBtn.hidden = collapsed || hiddenCount === 0;
    wheelHint.hidden = collapsed;
  };
  updaters.push(applyView);
  collapseBtn.addEventListener('click', () => {
    setPref('stats-collapsed', !pref('stats-collapsed'));
    applyView();
    reportSize();
  });
  hiddenBtn.addEventListener('click', () => {
    setPref('show-hidden', !pref('show-hidden'));
    applyView();
    reportSize();
  });
  const statsBar = el('div', 'stats-bar', collapseBtn, hiddenBtn, wheelHint);
  if (!statMods.length) {
    stats.hidden = true;
    statsBar.hidden = true;
  }

  // --- Ergebnisleiste ---
  const matched = el('span', 'matched', matchedText(r));
  const instantChip = chip();
  instantChip.title = 'Only listings that can be bought instantly (current prices). Off = also "in person" trades.';
  updaters.push(() => {
    instantChip.classList.toggle('on', instantOnly);
    instantChip.textContent = instantOnly ? '⏱ Instant buyout' : '⏱ Any listing';
  });
  instantChip.addEventListener('click', () => {
    instantOnly = !instantOnly;
    onChange();
  });
  const searchBtn = el('button', 'btn-sm primary', 'Search');
  const openBtn = el('button', 'btn-sm', 'Trade ↗');
  openBtn.title = 'Open the same search on pathofexile.com';

  const selection = (): TradeSelection => {
    const rows = [...stats.querySelectorAll<HTMLElement>('.stat')];
    const enabled = rows.filter((row) => row.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).map((row) => row.dataset.key!);
    const mins: Record<string, number | null> = {};
    const maxs: Record<string, number | null> = {};
    for (const row of rows) {
      for (const input of row.querySelectorAll<HTMLInputElement>('.num-input')) {
        const n = parseMin(input.value);
        if (Number.isNaN(n)) continue;
        (input.dataset.which === 'max' ? maxs : mins)[row.dataset.key!] = n;
      }
    }
    for (const f of misc) {
      if (f.on) enabled.push(f.mod.key);
      if (f.min !== undefined) mins[f.mod.key] = f.min;
    }
    return { enabled, mins, maxs, useBaseType, matchAll, instantOnly };
  };

  const runSearch = () => {
    if (!view) return;
    view.searching = true;
    view.dirty = false;
    view.refresh();
    results.classList.add('stale');
    api.tradeSearch(selection()); // läuft schon eine Suche, merkt der Main-Prozess die neueste Auswahl vor
  };
  searchBtn.addEventListener('click', () => {
    if (view && !view.searching) runSearch();
  });
  openBtn.addEventListener('click', () => {
    if (view?.url) api.openTrade(view.url);
  });

  const results = el('div', 'results', ...resultsContent(r));
  const rate = r.exaltedPerDivine ? ` · 1 Div = ${amount(r.exaltedPerDivine)} Ex` : '';
  // Waystones/Tablets: gefährliche Mods ganz oben zusammenfassen – auch bei eingeklappter Stat-Liste.
  const dangerous = r.mods.filter((m) => m.danger);
  const dangerBox = dangerous.length
    ? el(
        'div', 'danger',
        el('span', 'danger-title', `⚠ ${dangerous.length} dangerous mod${dangerous.length === 1 ? '' : 's'}`),
        ...dangerous.map((m) => el('span', 'danger-mod', m.text)),
      )
    : null;
  // Schlüssel-Mods dieses Slots, die dem Item fehlen: kurzer Hinweis, Tooltip und Klick zeigen die Liste.
  const missing = r.missingKeys ?? [];
  let missingBox: HTMLElement | null = null;
  if (missing.length) {
    const toggle = el('button', 'missing-toggle', `ⓘ ${missing.length} key mod${missing.length === 1 ? '' : 's'} for ${r.item.itemClass.toLowerCase()} not on this item`);
    toggle.type = 'button';
    toggle.title = `Key mods for this item type that this item doesn't have:\n${missing.map((t) => `• ${t}`).join('\n')}`;
    const list = el('ul', 'missing-list', ...missing.map((t) => el('li', '', t)));
    list.hidden = true;
    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
      toggle.classList.toggle('open', !list.hidden);
      reportSize();
    });
    missingBox = el('div', 'missing', toggle, list);
  }

  card.append(
    head,
    ...(dangerBox ? [dangerBox] : []),
    chips,
    ...(missingBox ? [missingBox] : []),
    stats,
    statsBar,
    el('div', 'results-bar', matched, instantChip, el('span', 'spacer'), searchBtn, openBtn),
    results,
    el('div', 'foot', `pathofexile.com/trade · ${r.league}${rate}`),
  );
  updateChips();

  const v: TradeView = {
    requestId: r.requestId,
    card,
    head,
    results,
    matched,
    searchBtn,
    openBtn,
    url: r.search?.url ?? null,
    // Vor der ersten Suche ist "Search" hervorgehoben – das ist der nächste Schritt.
    dirty: !r.search && !r.pending,
    searching: !!r.pending,
    refresh: () => {
      // "Search" ist hervorgehoben, sobald etwas geändert wurde; nach Fehlern (z. B. Rate-Limit) immer klickbar.
      searchBtn.disabled = v.searching;
      searchBtn.textContent = v.searching ? 'Searching …' : 'Search';
      searchBtn.classList.toggle('dirty', v.dirty && !v.searching);
      openBtn.disabled = !v.url;
    },
  };
  v.refresh();
  view = v;
  return card;
}

/** Neues Ergebnis derselben Prüfung: nur den Ergebnisteil tauschen, Eingaben bleiben unangetastet. */
function updateTrade(v: TradeView, r: TradeResult) {
  v.results.replaceChildren(...resultsContent(r));
  v.results.classList.toggle('stale', !!r.pending);
  v.matched.textContent = matchedText(r);
  v.searching = !!r.pending;
  v.url = r.search?.url ?? v.url;
  if (r.search?.icon && !v.head.querySelector('.head-icon')) v.head.prepend(itemIcon(r.search.icon, 'head-icon'));
  v.refresh();
}

// ---------- Einstieg ----------

function render(r: PriceResult): HTMLElement {
  if (r.kind === 'error') {
    return el('div', 'card card-error', header(null, undefined, 'Price check'), el('div', 'msg', el('span', 'msg-icon', '!'), el('span', '', r.message)));
  }
  if (r.kind === 'priced') return renderNinja(r);
  if (r.kind === 'trade') return renderTrade(r);
  return el('div', 'card', header(r), el('div', 'note', r.reason));
}

/**
 * Natürliche Größe des Inhalts melden. Wichtig: scrollHeight statt der sichtbaren Höhe – die Karte
 * ist auf die aktuelle Fensterhöhe begrenzt, sonst könnte das Fenster nach einer kleinen Karte nie
 * wieder wachsen. Kein requestAnimationFrame: im versteckten Fenster feuert es nicht zuverlässig.
 */
function reportSize() {
  const card = root.firstElementChild as HTMLElement | null;
  const rect = root.getBoundingClientRect();
  const height = card ? Math.max(rect.height, card.scrollHeight + (card.offsetHeight - card.clientHeight)) : rect.height;
  api.overlayReady({ width: rect.width, height });
}

api.onRemeasure(reportSize);

// Nur der Hintergrund wird durchsichtig, Text und Bedienelemente bleiben voll sichtbar.
api.onOpacity((o) => {
  if (Number.isFinite(o)) document.documentElement.style.setProperty('--card-alpha', String(o));
});

// ---------- Verschieben von überall ----------
// Gedrückt halten und ziehen verschiebt das Overlay – außer auf Eingabefeldern, Knöpfen und Checkboxen.
// Ein kurzer Klick ohne Bewegung bleibt ein normaler Klick (z. B. Mod-Text an-/abwählen).

const DRAG_THRESHOLD = 4;
let press: { x: number; y: number; dragging: boolean } | null = null;
let suppressClick = false;

// Wichtig: Wird die Taste AUSSERHALB des Fensters losgelassen (z. B. weil das Fenster beim Ziehen
// hinterherhinkt), kommt hier kein pointerup an. Ein solcher alter Druck darf nie weiterleben –
// sonst startet schon bloßes Darüberfahren ein Verschieben und ein Klick auf × wird verschluckt.

function endPress() {
  if (press?.dragging) api.dragEnd();
  press = null;
  document.body.classList.remove('dragging');
}

root.addEventListener('pointerdown', (e) => {
  suppressClick = false;
  press = null; // jeder neue Druck beginnt sauber
  document.body.classList.remove('dragging');
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('input, button, select, textarea, a')) return;
  press = { x: e.screenX, y: e.screenY, dragging: false };
});
// Maus raus → Fokus zurück ans Spiel (falls das Overlay durch einen Klick aktiv wurde),
// außer man tippt gerade einen Wert oder zieht das Fenster.
let hovering = false;
window.addEventListener('pointermove', () => {
  hovering = true;
});
document.documentElement.addEventListener('pointerleave', () => {
  if (!hovering) return;
  hovering = false;
  if (press?.dragging) return;
  if (document.activeElement instanceof HTMLInputElement) return;
  api.overlayLeave();
});

window.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (press.dragging) {
    api.dragMove(); // Fenster folgt dem Mauszeiger
    return;
  }
  // Taste nicht mehr gedrückt → wurde außerhalb losgelassen: alten Druck verwerfen.
  if ((e.buttons & 1) === 0) {
    press = null;
    return;
  }
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) >= DRAG_THRESHOLD) {
    press.dragging = true;
    suppressClick = true;
    document.body.classList.add('dragging');
    // Ab jetzt alle Mausereignisse hierher – auch wenn der Zeiger kurz außerhalb des Fensters ist
    // (das Fenster hinkt beim Ziehen etwas hinterher). Erst jetzt, damit normale Klicks ihr Ziel behalten.
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // ohne Capture endet das Ziehen spätestens beim nächsten Klick oder beim Schließen
    }
    api.dragStart();
  }
});
window.addEventListener('pointerup', () => {
  endPress();
  // Der Klick direkt nach dem Ziehen wird unten verschluckt; danach darf nichts mehr hängen bleiben.
  setTimeout(() => (suppressClick = false), 0);
});
window.addEventListener('pointercancel', endPress);
root.addEventListener('lostpointercapture', endPress);
window.addEventListener('blur', endPress);
// Der Klick am Ende eines Ziehvorgangs soll nichts an-/abwählen.
root.addEventListener(
  'click',
  (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);

api.onResult((r) => {
  try {
    if (r.kind === 'trade' && view && view.requestId === r.requestId && root.contains(view.card)) {
      updateTrade(view, r);
    } else {
      view = null;
      root.replaceChildren(render(r));
    }
  } catch (e) {
    // Lieber eine Fehlerkarte als ein leeres, unsichtbares Fenster über dem Spiel.
    view = null;
    root.replaceChildren(render({ kind: 'error', message: `Display error: ${e instanceof Error ? e.message : String(e)}` }));
  }
  reportSize();
});

// Esc schließt das Overlay, sobald es (zum Tippen) den Fokus hat.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) api.hideOverlay();
});
