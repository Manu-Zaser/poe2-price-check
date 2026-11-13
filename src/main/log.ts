/**
 * Einfaches Fehlerprotokoll in %APPDATA%\poe2-pricecheck\poe2-pricecheck.log.
 * Hilft, Abstürze nachzuvollziehen, die im Spiel nicht sichtbar sind.
 */
import { app } from 'electron';
import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 512 * 1024;

export function logFile(): string {
  return join(app.getPath('userData'), 'poe2-pricecheck.log');
}

export function log(level: 'info' | 'warn' | 'error', message: string, err?: unknown): void {
  const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err !== undefined ? String(err) : '';
  const line = `${new Date().toISOString()} [${level}] ${message}${detail ? ` – ${detail}` : ''}\n`;
  try {
    const file = logFile();
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`);
    } catch {
      // Datei existiert noch nicht
    }
    appendFileSync(file, line);
  } catch {
    // Protokollieren darf nie selbst einen Absturz auslösen.
  }
  if (process.env.POE2PC_DEBUG) console.log(line.trimEnd());
}
