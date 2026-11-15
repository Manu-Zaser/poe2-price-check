import { acceleratorFromEvent, formatHotkey, validateHotkey } from '../shared/hotkey';
import { DEFAULT_DANGER_MODS } from '../shared/maps';
import { DEFAULT_KEY_MODS, DEFAULT_LOW_MODS } from '../shared/weights';
import type { AppState, HistoryEntry, HotkeySetting, UpdateState } from '../shared/types';
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
  if (rec) stopRecording();
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
//
// Dieselbe Aufnahme für die Karte auf der Startseite und die drei Zeilen in den Einstellungen.

interface Recorder {
  key: HotkeySetting;
  keys: HTMLElement;
  error: HTMLElement;
  size: 'lg' | 'sm';
  /** Oberfläche in den Aufnahme-Zustand versetzen bzw. zurück. */
  start(): void;
  stop(): void;
  saved(): void;
}

let rec: Recorder | null = null;

function liveModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return mods;
}

function showRecordingKeys(labels: string[]) {
  if (!rec) return;
  if (labels.length === 0) rec.keys.replaceChildren(el('span', 'keys-placeholder', 'Press the new key combination …'));
  else rec.keys.replaceChildren(...keycaps([...labels, '…'], rec.size));
}

function startRecording(r: Recorder) {
  if (rec) stopRecording();
  rec = r;
  api.suspendHotkey(true);
  r.error.textContent = '';
  r.start();
  showRecordingKeys([]);
  window.addEventListener('keydown', onRecordKey, true);
  window.addEventListener('keyup', onRecordKeyUp, true);
}

function stopRecording() {
  const r = rec;
  rec = null;
  window.removeEventListener('keydown', onRecordKey, true);
  window.removeEventListener('keyup', onRecordKeyUp, true);
  r?.stop();
  api.suspendHotkey(false);
  if (current) render(current);
}

async function onRecordKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.repeat || !rec) return;
  const r = rec;
  if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    r.error.textContent = '';
    stopRecording();
    return;
  }
  const acc = acceleratorFromEvent(e);
  if (!acc) {
    showRecordingKeys(liveModifiers(e));
    return;
  }
  r.keys.replaceChildren(...keycaps(formatHotkey(acc), r.size));
  const invalid = validateHotkey(acc);
  if (invalid) {
    r.error.textContent = invalid;
    return;
  }
  const res = await api.saveSettings({ [r.key]: acc });
  if (!res.ok) {
    r.error.textContent = res.error;
    return;
  }
  r.error.textContent = '';
  stopRecording();
  r.saved();
}

function onRecordKeyUp(e: KeyboardEvent) {
  e.preventDefault();
  if (rec && !acceleratorFromEvent(e) && rec.error.textContent === '') showRecordingKeys(liveModifiers(e));
}

function flash(node: HTMLElement) {
  node.classList.remove('saved');
  void node.offsetWidth; // Animation neu starten
  node.classList.add('saved');
}

/** Karte "Price check hotkey" auf der Startseite. */
const homeRecorder: Recorder = {
  key: 'hotkey',
  keys: $('hotkey-keys'),
  error: $('hotkey-error'),
  size: 'lg',
  start() {
    $('hotkey-card').classList.add('recording');
    $('hotkey-pill').className = 'pill rec';
    $('hotkey-pill').querySelector('span')!.textContent = 'Recording';
    $('hotkey-change').hidden = true;
    $('hotkey-reset').hidden = true;
    $('hotkey-cancel').hidden = false;
    $('hotkey-hint').textContent = 'Ctrl or Alt plus a key – or an F-key on its own. Esc cancels.';
  },
  stop() {
    $('hotkey-card').classList.remove('recording');
    $('hotkey-change').hidden = false;
    $('hotkey-cancel').hidden = true;
  },
  saved() {
    flash($('hotkey-card'));
  },
};

$('hotkey-change').addEventListener('click', () => startRecording(homeRecorder));
$('hotkey-cancel').addEventListener('click', () => {
  homeRecorder.error.textContent = '';
  stopRecording();
});
$('hotkey-reset').addEventListener('click', async () => {
  const res = await api.saveSettings({ hotkey: 'Ctrl+D' });
  homeRecorder.error.textContent = res.ok ? '' : res.error;
  if (res.ok) flash($('hotkey-card'));
});

/** Zeilen unter Einstellungen → Hotkeys. */
const rowRecorders = new Map<HotkeySetting, Recorder>();
for (const row of document.querySelectorAll<HTMLElement>('.hk')) {
  const key = row.dataset.hotkey as HotkeySetting;
  const change = row.querySelector<HTMLButtonElement>('.hk-change')!;
  const off = row.querySelector<HTMLButtonElement>('.hk-off');
  const r: Recorder = {
    key,
    keys: row.querySelector<HTMLElement>('.hk-keys')!,
    error: row.querySelector<HTMLElement>('.hk-error')!,
    size: 'sm',
    start() {
      row.classList.add('recording');
      change.textContent = 'Cancel';
      if (off) off.hidden = true;
    },
    stop() {
      row.classList.remove('recording');
      change.textContent = 'Change';
    },
    saved() {
      flash(row);
    },
  };
  rowRecorders.set(key, r);
  change.addEventListener('click', () => {
    if (rec === r) {
      r.error.textContent = '';
      stopRecording();
    } else startRecording(r);
  });
  off?.addEventListener('click', async () => {
    if (rec) stopRecording();
    const res = await api.saveSettings({ [key]: '' });
    r.error.textContent = res.ok ? '' : res.error;
  });
}

window.addEventListener('blur', () => {
  if (rec) stopRecording();
});

// ---------- Übersicht ----------

function renderHotkeyRows(s: AppState) {
  for (const [key, r] of rowRecorders) {
    if (rec === r) continue;
    const acc = s.settings[key];
    const row = r.keys.closest<HTMLElement>('.hk')!;
    const off = row.querySelector<HTMLButtonElement>('.hk-off');
    if (!acc) {
      r.keys.replaceChildren(el('span', 'hk-none', 'Off'));
      if (off) off.hidden = true;
    } else {
      r.keys.replaceChildren(...keycaps(formatHotkey(acc), 'sm'));
      if (off) off.hidden = false;
    }
    const busy = acc && s.status.hotkeysActive[key] === false;
    if (busy && !r.error.textContent) r.error.textContent = 'Already used by another program – choose a different combination.';
    if (!busy && r.error.textContent.startsWith('Already used by another program')) r.error.textContent = '';
  }
  const trade = s.settings.hotkeyTrade;
  const wiki = s.settings.hotkeyWiki;
  $('guide-keys-trade').replaceChildren(...(trade ? keycaps(formatHotkey(trade), 'sm') : [el('span', 'hk-none', 'Off')]));
  $('guide-keys-wiki').replaceChildren(...(wiki ? keycaps(formatHotkey(wiki), 'sm') : [el('span', 'hk-none', 'Off')]));
}

function renderHotkey(s: AppState) {
  renderHotkeyRows(s);
  if (rec === homeRecorder) return;
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

// ---------- Wert der Mods (Key / Low value) ----------

/** Textfeld mit einer Liste (eine Regel pro Zeile), gespeichert beim Verlassen des Feldes. */
function listEditor(areaId: string, savedId: string, resetId: string, setting: 'keyMods' | 'lowMods', defaults: string[]) {
  const area = $<HTMLTextAreaElement>(areaId);
  const save = async (lines: string[]) => {
    const res = await api.saveSettings({ [setting]: lines });
    if (res.ok) {
      const hint = $(savedId);
      hint.hidden = false;
      setTimeout(() => (hint.hidden = true), 1500);
    }
  };
  area.addEventListener('change', () => void save(area.value.split(/\r?\n/)));
  $(resetId).addEventListener('click', () => {
    area.value = defaults.join('\n');
    void save(defaults);
  });
  return (s: AppState) => {
    if (document.activeElement !== area) area.value = s.settings[setting].join('\n');
  };
}

const renderKeyMods = listEditor('key-mods', 'key-saved', 'key-reset', 'keyMods', DEFAULT_KEY_MODS);
const renderLowMods = listEditor('low-mods', 'low-saved', 'low-reset', 'lowMods', DEFAULT_LOW_MODS);

// ---------- Währungsrechner ----------

type Unit = 'divine' | 'exalted' | 'chaos' | 'mirror';
const UNIT_NAMES: Record<Unit, string> = { divine: 'Divine', exalted: 'Exalted', chaos: 'Chaos', mirror: 'Mirror' };
let rates: Partial<Record<Unit, number>> = {};

/** Betrag in einer Währung → die beiden anderen (über den Wert in Exalted). */
function renderConverter() {
  const out = $('conv-out');
  const input = $<HTMLInputElement>('conv-amount');
  const unit = $<HTMLSelectElement>('conv-unit').value as Unit;
  const value = Number(input.value.replace(',', '.'));
  input.classList.toggle('invalid', input.value.trim() !== '' && !Number.isFinite(value));
  const from = rates[unit];
  if (!from) {
    out.replaceChildren(el('span', 'conv-none', 'Rates not loaded yet'));
    return;
  }
  if (!Number.isFinite(value) || input.value.trim() === '') {
    out.replaceChildren(el('span', 'conv-none', 'Enter an amount'));
    return;
  }
  const exalted = value * from;
  out.replaceChildren(
    ...(Object.keys(UNIT_NAMES) as Unit[])
      .filter((u) => u !== unit && rates[u])
      .map((u) => el('span', 'conv-val', el('strong', '', amount(exalted / rates[u]!)), ` ${UNIT_NAMES[u]}`)),
  );
}

function renderRates(s: AppState) {
  rates = s.status.currencyRates;
  // Währungen ohne Kurs (z. B. Mirror noch nicht gehandelt) nicht auswählbar machen
  for (const unit of ['chaos', 'mirror'] as const) {
    $<HTMLSelectElement>('conv-unit').querySelector<HTMLOptionElement>(`option[value="${unit}"]`)!.disabled = !rates[unit];
  }
  renderConverter();
}

$<HTMLInputElement>('conv-amount').addEventListener('input', renderConverter);
$<HTMLSelectElement>('conv-unit').addEventListener('change', renderConverter);

// ---------- Start, Infobereich ----------

function renderStartup(s: AppState) {
  const start = $<HTMLInputElement>('start-windows');
  start.checked = s.settings.startWithWindows;
  start.disabled = !s.status.canStartWithWindows;
  if (!s.status.canStartWithWindows) $('start-windows-help').textContent = 'Only available in the installed or portable exe, not when running from source.';
  $<HTMLInputElement>('close-tray').checked = s.settings.closeToTray;
}
$<HTMLInputElement>('start-windows').addEventListener('change', (e) => {
  void api.saveSettings({ startWithWindows: (e.target as HTMLInputElement).checked });
});
$<HTMLInputElement>('close-tray').addEventListener('change', (e) => {
  void api.saveSettings({ closeToTray: (e.target as HTMLInputElement).checked });
});

// ---------- Gefährliche Map-Mods ----------

function renderDangerMods(s: AppState) {
  const area = $<HTMLTextAreaElement>('danger-mods');
  if (document.activeElement !== area) area.value = s.settings.dangerMods.join('\n');
}

async function saveDangerMods(lines: string[]) {
  const res = await api.saveSettings({ dangerMods: lines });
  if (res.ok) {
    const hint = $('danger-saved');
    hint.hidden = false;
    setTimeout(() => (hint.hidden = true), 1500);
  }
}
$<HTMLTextAreaElement>('danger-mods').addEventListener('change', (e) => {
  void saveDangerMods((e.target as HTMLTextAreaElement).value.split(/\r?\n/));
});
$('danger-reset').addEventListener('click', () => {
  $<HTMLTextAreaElement>('danger-mods').value = DEFAULT_DANGER_MODS.join('\n');
  void saveDangerMods(DEFAULT_DANGER_MODS);
});

// ---------- Updates ----------

function updateTexts(u: UpdateState): { title: string; text: string; action: 'install' | 'download' | 'fetch' | null } | null {
  switch (u.status) {
    case 'ready':
      return { title: `Update ${u.version} ready`, text: 'Installs when you quit the tool – or restart now.', action: 'install' };
    case 'downloading':
      return { title: `Downloading ${u.version}`, text: `${u.percent ?? 0} %`, action: null };
    case 'available':
      return u.selfUpdating
        ? { title: `Version ${u.version} available`, text: 'Download it now – it installs when you quit the tool.', action: 'fetch' }
        : { title: `Version ${u.version} available`, text: 'Download the new version from GitHub.', action: 'download' };
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
    action.textContent = info.action === 'install' ? 'Restart now' : info.action === 'fetch' ? 'Download' : 'Open download page';
    action.dataset.action = info.action ?? '';
    $('update-progress').hidden = u.status !== 'downloading';
    ($('update-progress').firstElementChild as HTMLElement).style.width = `${u.percent ?? 0}%`;
  }

  $('version-out').textContent = u.current;
  const kind = u.selfUpdating
    ? 'Checks for updates at start. A new version is downloaded after you confirm and installs when you quit the tool.'
    : 'Portable version – new versions are announced here; download them from GitHub.';
  const when = u.checkedAt ? ` Last checked ${timeAgo(u.checkedAt)}.` : '';
  let text = kind;
  if (u.status === 'checking') text = 'Checking for updates …';
  else if (u.status === 'none') text = `You have the latest version.${when}`;
  else if (u.status === 'error') text = `${u.error ?? 'Update check failed.'}${when}`;
  else if (info) text = `${info.title}.`;
  $('update-help').textContent = text;
  ($('update-check') as HTMLButtonElement).disabled = u.status === 'checking' || u.status === 'downloading';
  maybeAskUpdate(u);
}

// Rückfrage, sobald eine neue Version gefunden wird (beim Start, alle 6 h oder per "Check now").
// "Later" merkt sich die Version – gefragt wird dann erst wieder bei "Check now" oder einer neueren.
let updateDismissed: string | null = null;
let manualCheck = false;
let modalFor: string | null = null;

function maybeAskUpdate(u: UpdateState) {
  if (u.status !== 'available' || !u.version) {
    if (u.status !== 'checking') manualCheck = false;
    closeUpdateModal();
    return;
  }
  if (modalFor === u.version || (updateDismissed === u.version && !manualCheck)) return;
  manualCheck = false;
  modalFor = u.version;
  $('update-modal-title').textContent = `Update ${u.version} available`;
  $('update-modal-text').textContent = u.selfUpdating
    ? `You have ${u.current}. Download the new version now? It installs when you quit the tool – or right away with "Restart now".`
    : `You have ${u.current}. This is the portable version – open the download page for the new version?`;
  $('update-confirm').textContent = u.selfUpdating ? 'Download' : 'Open download page';
  $('update-modal').hidden = false;
  $('update-confirm').focus();
}

function closeUpdateModal() {
  $('update-modal').hidden = true;
  modalFor = null;
}

function runUpdateAction(action: string | undefined) {
  if (action === 'install') api.installUpdate();
  else if (action === 'fetch') api.downloadUpdate();
  else if (action === 'download') api.openReleasePage();
}

$('update-check').addEventListener('click', () => {
  manualCheck = true;
  updateDismissed = null;
  // Schon gefunden: gleich wieder fragen, statt erneut nachzusehen.
  if (current?.update.status === 'available') maybeAskUpdate(current.update);
  else api.checkUpdates();
});
$('update-action').addEventListener('click', (e) => runUpdateAction((e.currentTarget as HTMLElement).dataset.action));
$('update-confirm').addEventListener('click', () => {
  const version = modalFor;
  runUpdateAction(current?.update.selfUpdating ? 'fetch' : 'download');
  closeUpdateModal();
  updateDismissed = version;
});
$('update-later').addEventListener('click', () => {
  const version = modalFor;
  closeUpdateModal();
  updateDismissed = version;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('update-modal').hidden) $('update-later').click();
});

// ---------- Fenster-Buttons ----------

$('win-min').addEventListener('click', () => api.windowControl('minimize'));
$('win-close').addEventListener('click', () => api.windowControl('close'));

// ---------- Start ----------

function render(s: AppState) {
  current = s;
  renderHotkey(s);
  renderStats(s);
  renderHistory(s);
  renderSettings(s);
  renderGpu(s);
  renderUpdate(s);
  renderStartup(s);
  renderDangerMods(s);
  renderRates(s);
  renderKeyMods(s);
  renderLowMods(s);
}

api.onState(render);
void api.getState().then(render);
