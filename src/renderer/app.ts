import { acceleratorFromEvent, formatHotkey, validateHotkey } from '../shared/hotkey';
import type { AppState, HistoryEntry, UpdateState } from '../shared/types';
import { api, el, itemIcon } from './api';
import { amount, clock, currencyShort, priceParts, timeAgo } from './format';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let current: AppState | null = null;

// ---------- Navigation ----------

function showPage(name: string) {
  for (const n of document.querySelectorAll<HTMLElement>('.nav-item')) n.classList.toggle('active', n.dataset.page === name);
  for (const p of document.querySelectorAll<HTMLElement>('.page')) {
    const active = p.dataset.page === name;
    p.classList.toggle('active', active);
    if (active) {
      $('page-title').textContent = p.dataset.title ?? '';
      $('page-sub').textContent = p.dataset.sub ?? '';
    }
  }
  document.querySelector('main')!.scrollTop = 0;
  if (recording) stopRecording();
}

for (const item of document.querySelectorAll<HTMLButtonElement>('.nav-item')) {
  item.addEventListener('click', () => showPage(item.dataset.page!));
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
  $('guide-keys').replaceChildren(...keycaps(formatHotkey(s.settings.hotkey), 'sm'));
  const line = $('status-line');
  line.className = `status-line ${s.status.hotkeyActive ? 'ok' : 'bad'}`;
  line.querySelector('span')!.textContent = s.status.hotkeyActive
    ? `Ready · ${formatHotkey(s.settings.hotkey).join(' + ')}`
    : 'Hotkey inactive';
  $('hotkey-hint').textContent = 'Hover over an item in game and press the hotkey.';
  const pill = $('hotkey-pill');
  pill.className = `pill ${s.status.hotkeyActive ? 'ok' : 'bad'}`;
  pill.querySelector('span')!.textContent = s.status.hotkeyActive ? 'Active' : 'Inactive';
  $('hotkey-reset').hidden = s.settings.hotkey === 'Ctrl+D' || s.settings.hotkey === 'CommandOrControl+D';
}

function renderStats(s: AppState) {
  const st = s.status;
  $('data-league').textContent = st.league ?? '–';
  $('data-league-sub').textContent = s.leagueAuto ? 'Automatic · current league' : 'Chosen in settings';
  $('data-rate').textContent = st.exaltedPerDivine ? `1 Div = ${amount(st.exaltedPerDivine)} Ex` : '–';
  const count = st.currencyCount + st.uniqueCount;
  $('data-count').textContent = st.fetchedAt ? `${count.toLocaleString('en-US')} items` : '–';
  $('data-count').title = `${st.currencyCount} currency, fragments, runes … and ${st.uniqueCount} uniques priced by poe.ninja`;
  $('data-age').textContent = st.loading ? 'Loading from poe.ninja …' : st.fetchedAt ? `poe.ninja · updated ${timeAgo(st.fetchedAt)}` : 'Not loaded yet';
  $('refresh').classList.toggle('spinning', st.loading);
  ($('refresh') as HTMLButtonElement).disabled = st.loading;

  const banner = $('error-banner');
  banner.hidden = !st.lastError;
  banner.textContent = st.lastError ?? '';
}

/** Kleiner Pfeil "öffnen" am Zeilenende. */
function openIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'h-open');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M9 5l7 7-7 7');
  svg.append(path);
  return svg;
}

/** Ein Eintrag ist ein Knopf: Klick öffnet den Preischeck wieder im Overlay. */
function historyRow(h: HistoryEntry): HTMLElement {
  const inner = historyContent(h);
  const btn = el('button', inner.className, ...inner.children, openIcon());
  btn.type = 'button';
  btn.title = 'Open in the overlay again';
  btn.addEventListener('click', () => api.openHistory(h.id));
  return el('li', '', btn);
}

function historyContent(h: HistoryEntry): { className: string; children: Node[] } {
  const r = h.result;
  const time = el('span', 'h-time', clock(h.time));
  if (r.kind === 'error') {
    return { className: 'h-row muted', children: [itemIcon(undefined, 'h-icon'), el('div', 'h-main', el('span', 'h-name', 'Error'), el('span', 'h-sub', r.message)), el('span', ''), time] };
  }
  const item = r.item;
  const name = el('span', `h-name rarity-${item.rarity.toLowerCase()}`, item.name ?? item.baseType);
  if (r.kind === 'trade') {
    const cheapest = r.search?.listings[0];
    const sub = r.search ? `${item.baseType} · ${r.search.total} results` : (r.error ?? `${item.baseType} · not searched`);
    const price = cheapest
      ? el('div', 'h-price', el('span', 'h-value', `from ${amount(cheapest.amount)}`), el('span', `unit unit-${currencyShort(cheapest.currency).toLowerCase()}`, currencyShort(cheapest.currency)))
      : el('div', 'h-price muted', '–');
    return { className: `h-row ${cheapest ? '' : 'muted'}`, children: [itemIcon(r.search?.icon, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', sub)), price, time] };
  }
  if (r.kind !== 'priced') {
    return { className: 'h-row muted', children: [itemIcon(undefined, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', r.reason)), el('span', ''), time] };
  }
  const m = r.matches[0];
  const unidentified = !item.name && r.matches.length > 1;
  const sub = unidentified ? `Unidentified · ${r.matches.length} candidates` : item.name ? item.baseType : item.itemClass;
  const p = priceParts(m.divine, m.exalted);
  const price = el('div', 'h-price', el('span', 'h-value', unidentified ? `up to ${p.value}` : p.value), el('span', `unit unit-${p.unit.toLowerCase()}`, p.unit));
  return { className: 'h-row', children: [itemIcon(m.icon, 'h-icon'), el('div', 'h-main', name, el('span', 'h-sub', sub)), price, time] };
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
  $('history-hint').hidden = s.history.length === 0;
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

  const opacity = $<HTMLInputElement>('opacity');
  if (document.activeElement !== opacity) opacity.value = String(Math.round(s.settings.overlayOpacity * 100));
  $('opacity-out').textContent = `${opacity.value}%`;

  $('pos-out').textContent = s.overlayPositionSaved ? 'saved' : 'next to the cursor';
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
// Deckkraft schon beim Ziehen übernehmen, damit man die Wirkung im offenen Overlay direkt sieht.
$<HTMLInputElement>('opacity').addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value;
  $('opacity-out').textContent = `${value}%`;
  void api.saveSettings({ overlayOpacity: Number(value) / 100 });
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

// ---------- Updates ----------

function updateTexts(u: UpdateState): { title: string; text: string; action: 'install' | 'download' | null } | null {
  switch (u.status) {
    case 'ready':
      return { title: `Update ${u.version} ready`, text: 'Installs when you close the tool – or restart now.', action: 'install' };
    case 'downloading':
      return { title: `Downloading ${u.version}`, text: `${u.percent ?? 0} %`, action: null };
    case 'available':
      return { title: `Version ${u.version} available`, text: 'Download the new version from GitHub.', action: 'download' };
    default:
      return null;
  }
}

function renderUpdate(s: AppState) {
  const u = s.update;
  const info = updateTexts(u);
  $('update-card').hidden = !info;
  if (info) {
    $('update-title').textContent = info.title;
    $('update-text').textContent = info.text;
    const action = $('update-action') as HTMLButtonElement;
    action.hidden = !info.action;
    action.textContent = info.action === 'install' ? 'Restart now' : 'Download';
    action.dataset.action = info.action ?? '';
    $('update-progress').hidden = u.status !== 'downloading';
    ($('update-progress').firstElementChild as HTMLElement).style.width = `${u.percent ?? 0}%`;
  }

  $('version-out').textContent = u.current;
  const kind = u.selfUpdating
    ? 'Updates are downloaded automatically and installed when you close the tool.'
    : 'Portable version – new versions are announced here; download them from GitHub.';
  const when = u.checkedAt ? ` Last checked ${timeAgo(u.checkedAt)}.` : '';
  let text = kind;
  if (u.status === 'checking') text = 'Checking for updates …';
  else if (u.status === 'none') text = `You have the latest version.${when}`;
  else if (u.status === 'error') text = `${u.error ?? 'Update check failed.'}${when}`;
  else if (info) text = `${info.title}.`;
  $('update-help').textContent = text;
  ($('update-check') as HTMLButtonElement).disabled = u.status === 'checking' || u.status === 'downloading';
}

$('update-check').addEventListener('click', () => api.checkUpdates());
$('update-action').addEventListener('click', (e) => {
  const action = (e.currentTarget as HTMLElement).dataset.action;
  if (action === 'install') api.installUpdate();
  else if (action === 'download') api.openReleasePage();
});

// ---------- Start ----------

function render(s: AppState) {
  current = s;
  renderHotkey(s);
  renderStats(s);
  renderHistory(s);
  renderSettings(s);
  renderGpu(s);
  renderUpdate(s);
}

api.onState(render);
void api.getState().then(render);
