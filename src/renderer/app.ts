import { acceleratorFromEvent, formatHotkey, validateHotkey } from '../shared/hotkey';
import type { AppState, HistoryEntry } from '../shared/types';
import { api, el, itemIcon } from './api';
import { amount, clock, priceParts, timeAgo } from './format';

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
  if (e.ctrlKey) mods.push('Strg');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Umschalt');
  return mods;
}

function showRecordingKeys(labels: string[]) {
  const box = $('hotkey-keys');
  if (labels.length === 0) box.replaceChildren(el('span', 'keys-placeholder', 'Neue Tastenkombination drücken …'));
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
  $('hotkey-pill').querySelector('span')!.textContent = 'Aufnahme';
  $('hotkey-change').hidden = true;
  $('hotkey-reset').hidden = true;
  $('hotkey-cancel').hidden = false;
  $('hotkey-hint').textContent = 'Strg oder Alt plus eine Taste – oder eine F-Taste allein. Esc bricht ab.';
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
  $('hotkey-hint').textContent = 'Maus im Spiel über ein Item halten und Hotkey drücken.';
  const pill = $('hotkey-pill');
  pill.className = `pill ${s.status.hotkeyActive ? 'ok' : 'bad'}`;
  pill.querySelector('span')!.textContent = s.status.hotkeyActive ? 'Aktiv' : 'Nicht aktiv';
  $('hotkey-reset').hidden = s.settings.hotkey === 'Ctrl+D' || s.settings.hotkey === 'CommandOrControl+D';
}

function renderStats(s: AppState) {
  const st = s.status;
  $('stat-league').textContent = st.league ?? '–';
  $('stat-rate').textContent = st.exaltedPerDivine ? `${amount(st.exaltedPerDivine)} Ex` : '–';
  $('stat-count').textContent = st.fetchedAt ? `${st.currencyCount + st.uniqueCount}` : '–';
  $('stat-count').title = `${st.currencyCount} Währungen & Co., ${st.uniqueCount} Uniques`;
  $('stat-age').textContent = st.loading ? 'lädt …' : st.fetchedAt ? timeAgo(st.fetchedAt) : 'nicht geladen';
  $('refresh').classList.toggle('spinning', st.loading);

  const banner = $('error-banner');
  banner.hidden = !st.lastError;
  banner.textContent = st.lastError ?? '';
}

function historyRow(h: HistoryEntry): HTMLElement {
  const r = h.result;
  const time = el('span', 'h-time', clock(h.time));
  if (r.kind === 'error') {
    return el('li', 'h-row muted', itemIcon(undefined, 'h-icon'), el('div', 'h-main', el('span', 'h-name', 'Fehler'), el('span', 'h-sub', r.message)), time);
  }
  const item = r.item;
  const name = el('span', `h-name rarity-${item.rarity.toLowerCase()}`, item.name ?? item.baseType);
  if (r.kind !== 'priced') {
    return el('li', 'h-row muted', itemIcon(undefined, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', r.reason)), time);
  }
  const m = r.matches[0];
  const unidentified = !item.name && r.matches.length > 1;
  const sub = unidentified ? `Unidentifiziert · ${r.matches.length} Möglichkeiten` : item.name ? item.baseType : item.itemClass;
  const p = priceParts(m.divine, m.exalted);
  const price = el('div', 'h-price', el('span', 'h-value', unidentified ? `bis ${p.value}` : p.value), el('span', `unit unit-${p.unit.toLowerCase()}`, p.unit));
  return el('li', 'h-row', itemIcon(m.icon, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', sub)), price, time);
}

function renderHistory(s: AppState) {
  const list = $('history');
  list.replaceChildren(...s.history.map(historyRow));
  $('history-empty').hidden = s.history.length > 0;
  $('history-clear').hidden = s.history.length === 0;
}

$('refresh').addEventListener('click', () => api.refreshPrices());
$('history-clear').addEventListener('click', () => api.clearHistory());

// ---------- Einstellungen ----------

function renderSettings(s: AppState) {
  const select = $<HTMLSelectElement>('league');
  if (document.activeElement !== select) {
    const options = [el('option', '', `Automatisch${s.leagues[0] ? ` (${s.leagues[0]})` : ''}`)];
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

  const range = $<HTMLInputElement>('seconds');
  if (document.activeElement !== range) range.value = String(s.settings.overlaySeconds);
  $('seconds-out').textContent = `${range.value} s`;
}

$<HTMLSelectElement>('league').addEventListener('change', (e) => {
  void api.saveSettings({ league: (e.target as HTMLSelectElement).value });
});
$<HTMLInputElement>('seconds').addEventListener('input', (e) => {
  $('seconds-out').textContent = `${(e.target as HTMLInputElement).value} s`;
});
$<HTMLInputElement>('seconds').addEventListener('change', (e) => {
  void api.saveSettings({ overlaySeconds: Number((e.target as HTMLInputElement).value) });
});
$('overlay-test').addEventListener('click', () => api.testOverlay());

// ---------- Start ----------

function render(s: AppState) {
  current = s;
  renderHotkey(s);
  renderStats(s);
  renderHistory(s);
  renderSettings(s);
}

api.onState(render);
void api.getState().then(render);
