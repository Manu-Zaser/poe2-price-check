import { defaultMatchCount } from '../shared/stats';
import type { PriceSuggestion } from '../shared/extras';
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
  return el('span', `trend ${dir}`, `${arrow} ${amount(Math.abs(change))} %`);
}

function bigPrice(value: string, unit: string, prefix?: string, meta?: HTMLElement | null): HTMLElement {
  return el(
    'div', 'price-block',
    el('div', 'price-big', prefix ? el('span', 'prefix', prefix) : null, el('span', 'value', value), el('span', `unit unit-${unit.toLowerCase()}`, unit)),
    meta && meta.childElementCount ? meta : null,
  );
}

function ninjaPrice(m: PriceMatch): HTMLElement {
  const p = priceParts(m.divine, m.exalted);
  const meta = el('div', 'price-meta');
  if (p.alt) meta.append(el('span', '', p.alt));
  const t = trend(m.change7d);
  if (t) meta.append(t, el('span', 'faint', '7 Tage'));
  return bigPrice(p.value, p.unit, undefined, meta);
}

function candidateRow(m: PriceMatch): HTMLElement {
  return el('div', 'cand', itemIcon(m.icon, 'cand-icon'), el('span', 'cand-name', m.name), el('span', 'cand-price', priceText(m)));
}

function closeButton(): HTMLElement {
  const b = el('button', 'close', '×');
  b.title = 'Schließen (Esc)';
  b.addEventListener('click', () => api.hideOverlay());
  return b;
}

/**
 * Kopfzeile = Griff zum Verschieben (-webkit-app-region: drag). Das Fenster merkt sich die
 * neue Position für alle weiteren Preischecks. Der Schließen-Knopf liegt mit darin.
 */
function header(r: Result | null, icon?: string, title?: string): HTMLElement {
  const text = el('div', 'head-text');
  if (r) {
    const item = r.item;
    const tags: string[] = [];
    if (item.corrupted) tags.push('Corrupted');
    if (item.unidentified) tags.push('Unidentifiziert');
    if (item.itemLevel) tags.push(`iLvl ${item.itemLevel}`);
    text.append(
      el('div', `title rarity-${item.rarity.toLowerCase()}`, item.name ?? item.baseType),
      el('div', 'sub', item.name ? item.baseType : item.itemClass),
    );
    if (tags.length) text.append(el('div', 'tags', ...tags.map((t) => el('span', `tag ${t === 'Corrupted' ? 'tag-bad' : ''}`, t))));
  } else {
    text.append(el('div', 'title', title ?? ''));
  }
  const grip = el('span', 'grip', '⠿');
  grip.title = 'Overlay lässt sich an jeder freien Stelle verschieben';
  return el('div', 'head', icon ? itemIcon(icon, 'head-icon') : null, text, grip, closeButton());
}

// ---------- poe.ninja (Währung, Uniques) ----------

function renderNinja(r: Extract<PriceResult, { kind: 'priced' }>): HTMLElement {
  const card = el('div', 'card');
  const first = r.matches[0];
  const unidentified = !r.item.name && r.matches.length > 1;
  card.append(header(r, unidentified ? undefined : first.icon));

  if (unidentified) {
    card.append(el('div', 'label', 'Mögliche Uniques'));
    card.append(el('div', 'cands', ...r.matches.slice(0, 5).map(candidateRow)));
    if (r.matches.length > 5) card.append(el('div', 'note', `+ ${r.matches.length - 5} weitere`));
  } else {
    card.append(ninjaPrice(first));
    if (r.stackSize && r.stackSize > 1) {
      card.append(el('div', 'stack', el('span', '', `Stapel × ${r.stackSize}`), el('strong', '', priceText(first, r.stackSize))));
    }
  }
  if (r.item.corrupted && r.item.rarity === 'Unique') card.append(el('div', 'note', 'Preis gilt für nicht-corrupted Exemplare.'));

  const listings = !unidentified && first.listingCount !== undefined ? `${first.listingCount} Angebote · ` : '';
  card.append(el('div', 'foot', `${listings}poe.ninja · ${r.league}`));
  return card;
}

// ---------- Trade-Suche (Rares) ----------

function listingRow(l: Listing): HTMLElement {
  return el(
    'div', 'lst',
    el('span', 'lst-price', `${amount(l.amount)} `, el('span', `unit unit-${currencyShort(l.currency).toLowerCase()}`, currencyShort(l.currency))),
    el('span', 'lst-ilvl', l.itemLevel ? `iLvl ${l.itemLevel}` : ''),
    el('span', 'lst-age', ageFromIso(l.indexed)),
  );
}

/** Durchschnitt der günstigsten Angebote (in Divine), sofern umrechenbar. */
function averageOfCheapest(listings: Listing[], n = 5): { divine: number; exalted: number } | null {
  const conv = listings.slice(0, n).filter((l) => l.divine !== null && l.exalted !== null);
  if (conv.length < Math.min(3, listings.length) || conv.length === 0) return null;
  const divine = conv.reduce((a, l) => a + l.divine!, 0) / conv.length;
  const exalted = conv.reduce((a, l) => a + l.exalted!, 0) / conv.length;
  return { divine, exalted };
}

const KIND_LABEL: Partial<Record<TradeMod['kind'], string>> = {
  implicit: 'Implicit', rune: 'Rune', enchant: 'Enchant', crafted: 'Crafted', fractured: 'Fractured', desecrated: 'Desecrated',
};

function formatMin(n: number | undefined): string {
  if (n === undefined) return '';
  return Number.isInteger(n) ? String(n) : n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

/** Schrittweite fürs Mausrad, abhängig von der Größenordnung des ursprünglichen Wertes. */
function wheelStep(original: number | null, current: number): number {
  const ref = Math.abs(original ?? current);
  const decimal = original !== null && !Number.isInteger(original);
  if (decimal && ref < 10) return 0.1;
  if (ref < 100) return 1;
  return 5;
}

/** Alles, was zu einer offenen Rare-Ansicht gehört; nach "Suchen" wird nur "results" ersetzt. */
interface TradeView {
  requestId: number;
  card: HTMLElement;
  head: HTMLElement;
  results: HTMLElement;
  searchBtn: HTMLButtonElement;
  openBtn: HTMLButtonElement;
  url: string | null;
  /** Auswahl seit der letzten Suche geändert? */
  dirty: boolean;
  searching: boolean;
  refresh: () => void;
}

let view: TradeView | null = null;

function resultsContent(r: TradeResult): HTMLElement[] {
  const s = r.search;
  const out: HTMLElement[] = [];
  if (r.pending) {
    // Platzhalter in Größe des späteren Ergebnisses, damit das Overlay beim Nachladen kaum springt.
    out.push(
      el('div', 'loading', el('span', 'spinner'), el('span', '', 'Suche auf pathofexile.com …')),
      el('div', 'lsts skeleton', ...Array.from({ length: 4 }, () => el('div', 'lst', el('span', 'bar w40'), el('span', 'bar w20'), el('span', 'bar w30')))),
    );
  } else if (s && s.listings.length > 0) {
    const cheapest = s.listings[0];
    const avg = averageOfCheapest(s.listings);
    const meta = el('div', 'price-meta');
    if (cheapest.divine !== null && cheapest.exalted !== null) {
      const conv = priceParts(cheapest.divine, cheapest.exalted);
      if (conv.unit !== currencyShort(cheapest.currency)) meta.append(el('span', '', `≈ ${conv.value} ${conv.unit}`));
    }
    if (avg) {
      const p = priceParts(avg.divine, avg.exalted);
      meta.append(el('span', '', `Ø ${Math.min(5, s.listings.length)} günstigste ≈ ${p.value} ${p.unit}`));
    }
    meta.append(el('span', 'faint', `${s.total} Treffer`));
    out.push(bigPrice(amount(cheapest.amount), currencyShort(cheapest.currency), 'ab', meta));
    if (s.suggestion) out.push(suggestionRow(s.suggestion));
    out.push(el('div', 'lsts', ...s.listings.slice(0, 6).map(listingRow)));
  } else if (s) {
    out.push(el('div', 'empty-result', 'Keine Angebote mit diesen Mods. Weniger Mods anhaken, Werte senken oder Basistyp lockern.'));
  }
  if (r.error) out.push(el('div', 'alert', r.error));
  return out;
}

/** Verkaufspreis-Vorschlag mit Kopier-Button für die Stash-Notiz. */
function suggestionRow(sg: PriceSuggestion): HTMLElement {
  const btn = el('button', 'btn-xs', 'Kopieren');
  btn.title = 'Als Notiz für den Stash-Tab in die Zwischenablage kopieren';
  btn.addEventListener('click', () => {
    api.copyText(sg.note);
    btn.textContent = 'Kopiert ✓';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = 'Kopieren';
      btn.classList.remove('done');
    }, 1500);
  });
  const unit = sg.currency === 'divine' ? 'Div' : 'Ex';
  const hint = sg.basedOn < 3 ? ' · wenig Daten' : '';
  return el(
    'div', 'suggest',
    el('span', 'suggest-label', 'Verkaufen für'),
    el('strong', 'suggest-value', `${amount(sg.amount)} `, el('span', `unit unit-${unit.toLowerCase()}`, unit)),
    el('code', 'suggest-note', sg.note),
    btn,
    el('span', 'suggest-hint', `knapp unter dem Median der ${sg.basedOn} günstigsten${hint}`),
  );
}

const AFFIX: Record<string, { short: string; long: string }> = {
  prefix: { short: 'P', long: 'Präfix' },
  suffix: { short: 'S', long: 'Suffix' },
  implicit: { short: 'I', long: 'Implicit' },
  other: { short: '', long: 'Mod' },
};

/** "P T9" = Präfix, Tier 9. In PoE2 ist eine höhere Tier-Zahl besser. */
function tierBadge(t: NonNullable<TradeMod['tiers']>[number]): HTMLElement {
  const a = AFFIX[t.affix] ?? AFFIX.other;
  const badge = el('span', `tier tier-${t.affix}`, a.short ? el('span', 'tier-affix', a.short) : null, `T${t.tier}`);
  badge.title = `${a.long}, Tier ${t.tier} – in PoE2 gilt: höher = besser`;
  return badge;
}

function modRow(m: TradeMod, onChange: () => void): HTMLElement {
  const searchable = m.statId !== null || !!m.filter;
  const row = el('div', `mod ${searchable ? '' : 'mod-off'} mod-${m.kind}`);
  row.dataset.key = m.key;
  if (m.statId) row.dataset.stat = '1';

  const box = el('input');
  box.type = 'checkbox';
  box.checked = m.enabled;
  box.disabled = !searchable;
  box.addEventListener('change', onChange);

  // Klick auf den Text schaltet ebenfalls um (große Trefferfläche, kein Fokus nötig).
  const text = el('span', 'mod-text', m.text);
  if (searchable) {
    text.addEventListener('click', () => {
      box.checked = !box.checked;
      onChange();
    });
  }

  const side = el('span', 'mod-side');
  for (const t of m.tiers ?? []) side.append(tierBadge(t));
  if (KIND_LABEL[m.kind]) side.append(el('span', 'mod-kind', KIND_LABEL[m.kind]!));
  if (m.combined) {
    side.append(el('span', 'mod-kind', 'addiert'));
    row.title = 'Mehrere Zeilen mit demselben Stat – die Trade-Suche rechnet mit der Summe.';
  }
  if (m.coveredBy) {
    side.append(el('span', 'mod-kind covered', `in ${m.coveredBy}`));
    row.title = m.coveredBy === 'DPS' ? 'Schon in den DPS oben enthalten – daher abgewählt.' : 'Schon in einer Summe oben enthalten – daher abgewählt.';
  }

  if (searchable && m.value !== null) {
    const input = el('input', 'min-input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = formatMin(m.min);
    input.placeholder = 'min';
    input.title = 'Mindestwert – Mausrad zum Ändern, Klick zum Eintippen, leer = ohne Minimum';
    let committed = input.value;

    const commit = () => {
      const n = parseMin(input.value);
      input.classList.toggle('invalid', Number.isNaN(n));
      if (Number.isNaN(n) || input.value === committed) return;
      committed = input.value;
      box.checked = true; // Wert geändert → Mod soll mitgesucht werden
      onChange();
    };

    // Mausrad: ändert den Wert ohne Fokuswechsel – das Spiel behält die Tastatur.
    input.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const current = parseMin(input.value);
        const base = current === null || Number.isNaN(current) ? (m.min ?? m.value ?? 0) : current;
        const step = wheelStep(m.value, base);
        const next = Math.max(0, Math.round((base + (e.deltaY < 0 ? step : -step)) * 100) / 100);
        input.value = formatMin(next);
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
    side.append(el('span', 'min-wrap', el('span', 'min-prefix', '≥'), input));
  }
  if (!searchable) {
    row.title = 'Nicht in der Trade-Suche gefunden';
    side.append(el('span', 'mod-kind', 'n. v.'));
  }
  row.append(box, text, side);
  return row;
}

function renderTrade(r: TradeResult): HTMLElement {
  const card = el('div', 'card card-trade');
  const head = header(r, r.search?.icon);
  const results = el('div', 'results', ...resultsContent(r));
  card.append(head, results);

  const baseBox = el('input');
  baseBox.type = 'checkbox';
  baseBox.checked = r.useBaseType;
  const baseToggle = el('label', 'toggle', baseBox, el('span', '', `Nur Basis „${r.item.baseType}“`));

  const allBox = el('input');
  allBox.type = 'checkbox';
  allBox.checked = r.matchAll;
  const countHint = el('span', 'faint');
  const allToggle = el('label', 'toggle', allBox, el('span', '', 'Alle angehakten Mods müssen passen ', countHint));

  const instantBox = el('input');
  instantBox.type = 'checkbox';
  instantBox.checked = r.instantOnly;
  const instantToggle = el('label', 'toggle', instantBox, el('span', '', 'Nur Sofortkauf ', el('span', 'faint', '(Instant Buyout, aktuelle Preise)')));

  // Alle Zeilen (Summen, Waffe, Mods, Filter) liegen in einem Container – die Auswahl wird daraus gelesen.
  const mods = el('div', 'mod-sections');

  const selection = (): TradeSelection => {
    const rows = [...mods.querySelectorAll<HTMLElement>('.mod')];
    const enabled = rows
      .filter((row) => row.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked)
      .map((row) => row.dataset.key!);
    const mins: Record<string, number | null> = {};
    for (const row of rows) {
      const input = row.querySelector<HTMLInputElement>('.min-input');
      if (!input) continue;
      const n = parseMin(input.value);
      if (!Number.isNaN(n)) mins[row.dataset.key!] = n;
    }
    return { enabled, mins, useBaseType: baseBox.checked, matchAll: allBox.checked, instantOnly: instantBox.checked };
  };

  // Der "mind. N von M"-Modus zählt nur Stat-Zeilen (Mods und Summen), nicht DPS/Item-Level/Sockel.
  const updateCountHint = () => {
    const n = mods.querySelectorAll('.mod[data-stat] input[type=checkbox]:checked').length;
    countHint.textContent = !allBox.checked && n > 2 ? `(sonst mind. ${defaultMatchCount(n)} von ${n})` : '';
  };

  const searchBtn = el('button', 'btn-sm primary', 'Suchen');
  const openBtn = el('button', 'btn-sm', 'Trade-Seite ↗');

  // Änderungen werden nur gesammelt; gesucht wird erst mit Klick auf "Suchen".
  const onChange = () => {
    updateCountHint();
    if (!view) return;
    view.dirty = true;
    view.refresh();
  };

  const section = (title: string, list: TradeMod[], hint?: string) =>
    list.length
      ? el(
          'div', 'mod-section',
          el('div', 'label-row', el('span', 'label', title), hint ? el('span', 'hint', hint) : null),
          el('div', 'mods', ...list.map((m) => modRow(m, onChange))),
        )
      : null;
  const ofKind = (...kinds: TradeMod['kind'][]) => r.mods.filter((m) => kinds.includes(m.kind));
  const plain = r.mods.filter((m) => m.kind !== 'pseudo' && m.kind !== 'weapon' && m.kind !== 'misc');

  const sections = [
    section('Summen', ofKind('pseudo'), 'Mausrad über Wert = ändern'),
    section('Waffe', ofKind('weapon')),
    section('Mods', plain, ofKind('pseudo').length ? undefined : 'Mausrad über Wert = ändern'),
    section('Filter', ofKind('misc')),
  ].filter((s): s is HTMLDivElement => s !== null);
  mods.append(...sections);
  const runSearch = () => {
    if (!view) return;
    view.searching = true;
    view.dirty = false;
    view.refresh();
    results.classList.add('stale');
    api.tradeSearch(selection()); // läuft schon eine Suche, merkt der Main-Prozess die neueste Auswahl vor
  };

  // Die Schalter unten (Sofortkauf, alle Mods, Basis) wirken sofort – samt aktueller Mod-Auswahl.
  // Mods und Werte warten dagegen auf "Suchen".
  for (const box of [baseBox, allBox, instantBox]) {
    box.addEventListener('change', () => {
      updateCountHint();
      runSearch();
    });
  }
  updateCountHint();

  searchBtn.addEventListener('click', () => {
    if (view && !view.searching) runSearch();
  });
  openBtn.addEventListener('click', () => {
    if (view?.url) api.openTrade(view.url);
  });

  card.append(
    mods,
    el('div', 'toggles', instantToggle, allToggle, baseToggle),
    el('div', 'actions', searchBtn, openBtn),
    el('div', 'foot', `pathofexile.com/trade · ${r.league}`),
  );

  const v: TradeView = {
    requestId: r.requestId,
    card,
    head,
    results,
    searchBtn,
    openBtn,
    url: r.search?.url ?? null,
    dirty: false,
    searching: !!r.pending,
    refresh: () => {
      // "Suchen" ist hervorgehoben, sobald etwas geändert wurde; nach Fehlern (z. B. Rate-Limit) immer klickbar.
      searchBtn.disabled = v.searching;
      searchBtn.textContent = v.searching ? 'Suche …' : 'Suchen';
      searchBtn.classList.toggle('dirty', v.dirty && !v.searching);
      openBtn.disabled = !v.url;
    },
  };
  v.refresh();
  view = v;
  return card;
}

/** Neues Ergebnis derselben Rare-Prüfung: nur den Ergebnisbereich tauschen, Eingaben bleiben unangetastet. */
function updateTrade(v: TradeView, r: TradeResult) {
  v.results.replaceChildren(...resultsContent(r));
  v.results.classList.toggle('stale', !!r.pending);
  v.searching = !!r.pending;
  v.url = r.search?.url ?? v.url;
  if (r.search?.icon && !v.head.querySelector('.head-icon')) v.head.prepend(itemIcon(r.search.icon, 'head-icon'));
  v.refresh();
}

// ---------- Einstieg ----------

function render(r: PriceResult): HTMLElement {
  if (r.kind === 'error') {
    return el('div', 'card card-error', header(null, undefined, 'Preischeck'), el('div', 'msg', el('span', 'msg-icon', '!'), el('span', '', r.message)));
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

// ---------- Verschieben von überall ----------
// Gedrückt halten und ziehen verschiebt das Overlay – außer auf Eingabefeldern, Knöpfen und Checkboxen.
// Ein kurzer Klick ohne Bewegung bleibt ein normaler Klick (z. B. Mod-Text an-/abwählen).

const DRAG_THRESHOLD = 4;
let press: { x: number; y: number; dragging: boolean } | null = null;
let suppressClick = false;

root.addEventListener('pointerdown', (e) => {
  suppressClick = false;
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('input, button, select, textarea, a')) return;
  press = { x: e.screenX, y: e.screenY, dragging: false };
});
window.addEventListener('pointermove', (e) => {
  if (!press || press.dragging) return;
  if (Math.hypot(e.screenX - press.x, e.screenY - press.y) >= DRAG_THRESHOLD) {
    press.dragging = true;
    suppressClick = true;
    document.body.classList.add('dragging');
    api.dragStart(); // ab hier folgt das Fenster dem Mauszeiger (vom Main-Prozess gesteuert)
  }
});
window.addEventListener('pointerup', () => {
  if (press?.dragging) api.dragEnd();
  press = null;
  document.body.classList.remove('dragging');
});
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
    root.replaceChildren(render({ kind: 'error', message: `Anzeigefehler: ${e instanceof Error ? e.message : String(e)}` }));
  }
  reportSize();
});

// Esc schließt das Overlay, sobald es (zum Tippen) den Fokus hat.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) api.hideOverlay();
});
