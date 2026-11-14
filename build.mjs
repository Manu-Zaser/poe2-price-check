import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'node22' };

await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.js', platform: 'node', format: 'cjs', external: ['electron', 'koffi', 'electron-updater'] }),
  build({ ...common, entryPoints: ['src/main/preload.ts'], outfile: 'dist/preload.js', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/overlay.ts'], outfile: 'dist/overlay.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
  build({ ...common, entryPoints: ['src/renderer/app.ts'], outfile: 'dist/app.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
]);

for (const f of ['overlay.html', 'app.html', 'base.css', 'app.css', 'overlay.css']) cpSync(`src/renderer/${f}`, `dist/${f}`);
// Bild für die Anleitung im Hauptfenster (dasselbe wie in der README)
cpSync('docs/images/overlay-rare.png', 'dist/guide-overlay.png');
