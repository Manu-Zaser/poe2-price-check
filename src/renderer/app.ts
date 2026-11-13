import { acceleratorFromEvent, formatHotkey, validateHotkey } from '../shared/hotkey';
import type { AppState, HistoryEntry } from '../shared/types';
import { api, el, itemIcon } from './api';
import { amount, clock, currencyShort, priceParts, timeAgo } from './format';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let current: AppState | null = null;

// ---------- Tabs ----------

for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
    for (const p of document.querySelectorAll<HTMLElement>('.page')) p.classList.toggle('active', p.dataset.page === tab.dataset.tab);
    if (recording) stopRecording();
  });
}

// ---------- Tastenkappen ----------

function keycaps(labels: string[], size: 'lg' | 'sm' = 'lg'): HTMLElement[] {
  const out: HTMLElement[] = [];
  labels.forEach((label, i) => {
    if (i > 0) out.push(el('span', 'plus', '+'));
    out.push(el('kbd', `key ${size}`, label));
  });
  return out;
}

// ---------- Hotkey-Aufnahme ----------

let recording = false;

function liveModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return mods;
}

function showRecordingKeys(labels: string[]) {
  const box = $('hotkey-keys');
  if (labels.length === 0) box.replaceChildren(el('span', 'keys-placeholder', 'Press the new key combination …'));
  else box.replaceChildren(...keycaps([...labels, '…']));
}

function setError(msg: string) {
  $('hotkey-error').textContent = msg;
}

function startRecording() {
  recording = true;
  api.suspendHotkey(true);
  setError('');
  $('hotkey-card').classList.add('recording');
  $('hotkey-pill').className = 'pill rec';
  $('hotkey-pill').querySelector('span')!.textContent = 'Recording';
  $('hotkey-change').hidden = true;
  $('hotkey-reset').hidden = true;
  $('hotkey-cancel').hidden = false;
  $('hotkey-hint').textContent = 'Ctrl or Alt plus a key – or an F-key on its own. Esc cancels.';
  showRecordingKeys([]);
  window.addEventListener('keydown', onRecordKey, true);
  window.addEventListener('keyup', onRecordKeyUp, true);
}

function stopRecording() {
  recording = false;
  window.removeEventListener('keydown', onRecordKey, true);
  window.removeEventListener('keyup', onRecordKeyUp, true);
  $('hotkey-card').classList.remove('recording');
  $('hotkey-change').hidden = false;
  $('hotkey-reset').hidden = false;
  $('hotkey-cancel').hidden = true;
  api.suspendHotkey(false);
  if (current) render(current);
}

async function onRecordKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat) return;
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    setError('');
    stopRecording();
    return;
  }
  const acc = acceleratorFromEvent(e);
  if (!acc) {
    showRecordingKeys(liveModifiers(e));
    return;
  }
  $('hotkey-keys').replaceChildren(...keycaps(formatHotkey(acc)));
  const invalid = validateHotkey(acc);
  if (invalid) {
    setError(invalid);
    return;
  }
  const res = await api.saveSettings({ hotkey: acc });
  if (!res.ok) {
    setError(res.error);
    return;
  }
  setError('');
  stopRecording();
  flash($('hotkey-card'));
}

function onRecordKeyUp(e: KeyboardEvent) {
  e.preventDefault();
  if (!acceleratorFromEvent(e) && $('hotkey-error').textContent === '') showRecordingKeys(liveModifiers(e));
}

function flash(node: HTMLElement) {
  node.classList.remove('saved');
  void node.offsetWidth; // Animation neu starten
  node.classList.add('saved');
}

$('hotkey-change').addEventListener('click', startRecording);
$('hotkey-cancel').addEventListener('click', () => {
  setError('');
  stopRecording();
});
$('hotkey-reset').addEventListener('click', async () => {
  const res = await api.saveSettings({ hotkey: 'Ctrl+D' });
  setError(res.ok ? '' : res.error);
  if (res.ok) flash($('hotkey-card'));
});
window.addEventListener('blur', () => {
  if (recording) stopRecording();
});

// ---------- Übersicht ----------

function renderHotkey(s: AppState) {
  if (recording) return;
  $('hotkey-keys').replaceChildren(...keycaps(formatHotkey(s.settings.hotkey)));
  $('empty-keys').replaceChildren(...keycaps(formatHotkey(s.settings.hotkey), 'sm'));
  $('hotkey-hint').textContent = 'Hover over an item in game and press the hotkey.';
  const pill = $('hotkey-pill');
  pill.className = `pill ${s.status.hotkeyActive ? 'ok' : 'bad'}`;
  pill.querySelector('span')!.textContent = s.status.hotkeyActive ? 'Active' : 'Inactive';
  $('hotkey-reset').hidden = s.settings.hotkey === 'Ctrl+D' || s.settings.hotkey === 'CommandOrControl+D';
}

function renderStats(s: AppState) {
  const st = s.status;
  $('stat-league').textContent = st.league ?? '–';
  $('stat-rate').textContent = st.exaltedPerDivine ? `${amount(st.exaltedPerDivine)} Ex` : '–';
  $('stat-count').textContent = st.fetchedAt ? `${st.currencyCount + st.uniqueCount}` : '–';
  $('stat-count').title = `${st.currencyCount} currency & co., ${st.uniqueCount} uniques`;
  $('stat-age').textContent = st.loading ? 'loading …' : st.fetchedAt ? timeAgo(st.fetchedAt) : 'not loaded';
  $('refresh').classList.toggle('spinning', st.loading);

  const banner = $('error-banner');
  banner.hidden = !st.lastError;
  banner.textContent = st.lastError ?? '';
}

function historyRow(h: HistoryEntry): HTMLElement {
  const r = h.result;
  const time = el('span', 'h-time', clock(h.time));
  if (r.kind === 'error') {
    return el('li', 'h-row muted', itemIcon(undefined, 'h-icon'), el('div', 'h-main', el('span', 'h-name', 'Error'), el('span', 'h-sub', r.message)), time);
  }
  const item = r.item;
  const name = el('span', `h-name rarity-${item.rarity.toLowerCase()}`, item.name ?? item.baseType);
  if (r.kind === 'trade') {
    const cheapest = r.search?.listings[0];
    const sub = r.search ? `${item.baseType} · ${r.search.total} results` : (r.error ?? item.baseType);
    const price = cheapest
      ? el('div', 'h-price', el('span', 'h-value', `from ${amount(cheapest.amount)}`), el('span', `unit unit-${currencyShort(cheapest.currency).toLowerCase()}`, currencyShort(cheapest.currency)))
      : el('div', 'h-price muted', '–');
    return el('li', `h-row ${cheapest ? '' : 'muted'}`, itemIcon(r.search?.icon, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', sub)), price, time);
  }
  if (r.kind !== 'priced') {
    return el('li', 'h-row muted', itemIcon(undefined, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', r.reason)), time);
  }
  const m = r.matches[0];
  const unidentified = !item.name && r.matches.length > 1;
  const sub = unidentified ? `Unidentified · ${r.matches.length} candidates` : item.name ? item.baseType : item.itemClass;
  const p = priceParts(m.divine, m.exalted);
  const price = el('div', 'h-price', el('span', 'h-value', unidentified ? `up to ${p.value}` : p.value), el('span', `unit unit-${p.unit.toLowerCase()}`, p.unit));
  return el('li', 'h-row', itemIcon(m.icon, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', sub)), price, time);
}

let historySig = '';

/** Nur neu aufbauen, wenn sich der Verlauf geändert hat (spart Layout und Bild-Dekodierung). */
function renderHistory(s: AppState) {
  const sig = s.history.map((h) => h.id).join(',');
  if (sig === historySig) return;
  historySig = sig;
  const list = $('history');
  const known = new Map([...list.children].map((li) => [(li as HTMLElement).dataset.id, li]));
  list.replaceChildren(
    ...s.history.map((h) => {
      const existing = known.get(String(h.id));
      if (existing) return existing;
      const row = historyRow(h);
      row.dataset.id = String(h.id);
      return row;
    }),
  );
  $('history-empty').hidden = s.history.length > 0;
  $('history-clear').hidden = s.history.length === 0;
}

$('refresh').addEventListener('click', () => api.refreshPrices());
$('history-clear').addEventListener('click', () => api.clearHistory());

// ---------- Einstellungen ----------

let leagueSig = '';
let gpuAtStart: boolean | null = null;

function renderSettings(s: AppState) {
  const select = $<HTMLSelectElement>('league');
  const sig = s.leagues.join('|') + '#' + s.settings.league;
  if (document.activeElement !== select && sig !== leagueSig) {
    leagueSig = sig;
    const options = [el('option', '', `Automatic${s.leagues[0] ? ` (${s.leagues[0]})` : ''}`)];
    options[0].value = '';
    const names = s.leagues.includes(s.settings.league) || !s.settings.league ? s.leagues : [s.settings.league, ...s.leagues];
    for (const l of names) {
      const o = el('option', '', l);
      o.value = l;
      options.push(o);
    }
    select.replaceChildren(...options);
    select.value = s.settings.league;
  }

  const scale = $<HTMLInputElement>('scale');
  if (document.activeElement !== scale) scale.value = String(Math.round(s.settings.overlayScale * 100));
  $('scale-out').textContent = `${scale.value}%`;

  $('pos-out').textContent = s.overlayPositionSaved ? 'saved' : 'at mouse cursor';
  ($('pos-reset') as HTMLButtonElement).disabled = !s.overlayPositionSaved;
  $('log-path').textContent = s.logFile;
}

$<HTMLSelectElement>('league').addEventListener('change', (e) => {
  void api.saveSettings({ league: (e.target as HTMLSelectElement).value });
});
$('pos-reset').addEventListener('click', () => api.resetOverlayPosition());
$<HTMLInputElement>('scale').addEventListener('input', (e) => {
  $('scale-out').textContent = `${(e.target as HTMLInputElement).value}%`;
});
$<HTMLInputElement>('scale').addEventListener('change', (e) => {
  void api.saveSettings({ overlayScale: Number((e.target as HTMLInputElement).value) / 100 });
});
$('overlay-test').addEventListener('click', () => api.testOverlay());

function renderGpu(s: AppState) {
  gpuAtStart ??= s.settings.gpuAcceleration;
  $<HTMLInputElement>('gpu').checked = s.settings.gpuAcceleration;
  $('gpu-restart').hidden = s.settings.gpuAcceleration === gpuAtStart;
}
$<HTMLInputElement>('gpu').addEventListener('change', (e) => {
  void api.saveSettings({ gpuAcceleration: (e.target as HTMLInputElement).checked });
});
$('gpu-restart').addEventListener('click', () => api.restartApp());

// ---------- Start ----------

function render(s: AppState) {
  current = s;
  renderHotkey(s);
  renderStats(s);
  renderHistory(s);
  renderSettings(s);
  renderGpu(s);
}

api.onState(render);
void api.getState().then(render);
