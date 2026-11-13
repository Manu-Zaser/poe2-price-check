/**
 * Renders the README screenshots from the real overlay (dist/) with sample data.
 *
 *   npm run readme-images
 *
 * Runs Electron with an invisible offscreen window – no visible window, no input to anything.
 * Output: docs/images/*.png (rendered at 2× for sharp images on high-DPI screens).
 */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'docs', 'images');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '2');

// ---------- Sample data (fictional listings, realistic shape) ----------

const EX_PER_DIV = 640;
const ZOOM = 1.15;
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const listing = (amount, currency, hours, ilvl) => {
  const exalted = currency === 'divine' ? amount * EX_PER_DIV : amount;
  return { amount, currency, exalted, divine: exalted / EX_PER_DIV, indexed: hoursAgo(hours), itemLevel: ilvl };
};
const mod = (key, text, kind, value, enabled, extra = {}) => ({ key, text, kind, statId: `s${key}`, value, min: value, enabled, ...extra });
const misc = (key, text, filter, value, enabled) => ({ key, text, kind: 'misc', statId: null, filter, value, min: value ?? undefined, enabled });

const rare = {
  kind: 'trade', requestId: 1, league: 'Standard', useBaseType: false, matchAll: true, instantOnly: true, exaltedPerDivine: EX_PER_DIV,
  item: { itemClass: 'Bows', rarity: 'Rare', name: 'Morbid Stinger', baseType: 'Obliterator Bow', itemLevel: 80, corrupted: false, unidentified: false, sections: [] },
  mods: [
    { key: 'w:dps', text: '432.9 total DPS', kind: 'weapon', statId: null, filter: 'dps', value: 432.9, min: 432.9, enabled: false },
    { key: 'w:pdps', text: '380.1 physical DPS', kind: 'weapon', statId: null, filter: 'pdps', value: 380.1, min: 380.1, enabled: true },
    { key: 'w:edps', text: '52.8 elemental DPS', kind: 'weapon', statId: null, filter: 'edps', value: 52.8, min: 52.8, enabled: false },
    { key: 'w:crit', text: '8.44% Critical Hit Chance', kind: 'weapon', statId: null, filter: 'crit', value: 8.44, min: 8.4, enabled: true },
    mod('0', 'Bow Attacks fire an additional Arrow', 'rune', 1, false),
    mod('1', '50% reduced Projectile Range', 'implicit', 50, false, { invert: true }),
    mod('2', '+142 to Accuracy Rating', 'explicit', 142, true, { tiers: [{ affix: 'prefix', tier: 3 }] }),
    mod('3', 'Leeches 7.05% of Physical Damage as Life', 'explicit', 7.05, true, { min: 7, tiers: [{ affix: 'suffix', tier: 3 }] }),
    mod('4', '+19% to Critical Damage Bonus', 'explicit', 19, true, { tiers: [{ affix: 'suffix', tier: 3 }] }),
    mod('5', '207% increased Physical Damage', 'explicit', 207, false, { coveredBy: 'DPS', combined: true }),
    mod('6', 'Adds 37 to 59 Cold Damage', 'explicit', 48, false, { coveredBy: 'DPS' }),
    mod('7', '+3.44% to Critical Hit Chance', 'explicit', 3.44, false, { coveredBy: 'crit' }),
    misc('f:corrupted', 'Not corrupted', 'corrupted', null, true),
    misc('f:ilvl', 'Item level', 'ilvl', 80, false),
    misc('f:sockets', 'Rune sockets', 'sockets', 2, false),
  ],
  search: {
    queryId: 'example', url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/example', total: 66,
    listings: [
      listing(62, 'divine', 30, 81), listing(70, 'divine', 6, 80), listing(75, 'divine', 2, 82), listing(78, 'divine', 50, 79),
      listing(80, 'divine', 9, 81), listing(85, 'divine', 120, 80), listing(90, 'divine', 20, 83), listing(95, 'divine', 1, 81),
      listing(100, 'divine', 72, 79), listing(110, 'divine', 600, 82), listing(120, 'divine', 15, 80), listing(130, 'divine', 40, 84),
    ],
    market: { exalted: 70 * EX_PER_DIV, divine: 70, basedOn: 3, staleIgnored: 0 },
    warnings: [],
    // as the tool computes it: just below the median of the 3 cheapest (70 × 0.95 ≈ 67)
    suggestion: { amount: 67, currency: 'divine', note: '~b/o 67 divine', basedOn: 3 },
  },
};

const unique = {
  kind: 'trade', requestId: 2, league: 'Standard', useBaseType: true, matchAll: true, instantOnly: true, exaltedPerDivine: EX_PER_DIV,
  item: { itemClass: 'Body Armours', rarity: 'Unique', name: 'Temporalis', baseType: 'Silk Robe', itemLevel: 79, corrupted: false, unidentified: false, sections: [] },
  reference: { name: 'Temporalis', baseType: 'Silk Robe', divine: 3.1, exalted: 3.1 * EX_PER_DIV, listingCount: 214 },
  mods: [
    { key: 'd:es', text: '412 Energy Shield', kind: 'defence', statId: null, filter: 'es', value: 412, min: 412, enabled: false },
    mod('0', '+137 to maximum Energy Shield', 'explicit', 137, true),
    misc('f:corrupted', 'Not corrupted', 'corrupted', null, true),
  ],
  search: {
    queryId: 'example', url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/example', total: 23,
    listings: [
      listing(5, 'divine', 3, 80), listing(5.5, 'divine', 11, 81), listing(6, 'divine', 1, 79),
      listing(6, 'divine', 26, 82), listing(7, 'divine', 8, 80), listing(8, 'divine', 90, 81),
    ],
    market: { exalted: 5.5 * EX_PER_DIV, divine: 5.5, basedOn: 3, staleIgnored: 0 },
    warnings: [],
    // 5.5 × 0.95 ≈ 5.2 → rounded to half a Divine
    suggestion: { amount: 5, currency: 'divine', note: '~b/o 5 divine', basedOn: 3 },
  },
};

// ---------- Rendering ----------

/** Page around the overlay: stubbed API and a soft dark backdrop. */
function page(result) {
  const url = (f) => pathToFileURL(join(dist, f)).href;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${url('base.css')}"><link rel="stylesheet" href="${url('overlay.css')}">
<style>
  html, body { overflow: visible !important; height: auto !important; }
  body { margin: 0; padding: 28px; display: inline-block;
         background: radial-gradient(120% 90% at 30% 20%, #2a2219 0%, #15110d 55%, #0c0a08 100%) !important; }
  .card { animation: none !important; max-height: none !important; overflow: visible !important; }
</style></head><body><div id="root"></div>
<script>
  let deliver;
  window.api = { onResult: (cb) => (deliver = cb), onRemeasure() {}, onOpacity() {}, overlayReady() {}, hideOverlay() {},
    dragStart() {}, dragMove() {}, dragEnd() {}, tradeSearch() {}, openTrade() {}, copyText() {}, focusOverlay() {}, overlayLeave() {} };
  try { localStorage.clear(); } catch {}
</script>
<script src="${url('overlay.js')}"></script>
<script>deliver(${JSON.stringify(result)});</script>
</body></html>`;
}

async function render(win, tmp, name, result) {
  const file = join(tmp, `${name}.html`);
  writeFileSync(file, page(result));
  await win.loadFile(file);
  win.webContents.setZoomFactor(ZOOM); // like the app's default overlay size (115 %)
  await new Promise((r) => setTimeout(r, 400));
  const size = await win.webContents.executeJavaScript(
    `(() => { const r = document.body.getBoundingClientRect(); return { width: r.width, height: r.height }; })()`,
  );
  const rect = { x: 0, y: 0, width: Math.ceil(size.width * ZOOM), height: Math.ceil(size.height * ZOOM) };
  win.setContentSize(rect.width, rect.height);
  await new Promise((r) => setTimeout(r, 300));
  // Captured at 2× (sharp on high-DPI screens). Scaling down would make the PNG larger, not smaller.
  const image = await win.webContents.capturePage(rect);
  const out = join(outDir, `${name}.png`);
  writeFileSync(out, image.toPNG());
  console.log(`${out}  ${image.getSize().width}×${image.getSize().height}`);
}

app.whenReady().then(async () => {
  try {
    mkdirSync(outDir, { recursive: true });
    const tmp = mkdtempSync(join(tmpdir(), 'poe2pc-readme-'));
    // Never shown – rendered in the background only.
    const win = new BrowserWindow({ show: false, width: 700, height: 2400, paintWhenInitiallyHidden: true });
    await render(win, tmp, 'overlay-rare', rare);
    await render(win, tmp, 'overlay-unique', unique);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
