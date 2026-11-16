/**
 * Fehlerprotokoll in %APPDATA%\poe2-pricecheck\poe2-pricecheck.log (über @poe2/core).
 * Hilft, Abstürze nachzuvollziehen, die im Spiel nicht sichtbar sind. Konsole nur mit POE2PC_DEBUG.
 */
import { createLogger, type LogLevel } from '@poe2/core/log';

const logger = createLogger({ fileName: 'poe2-pricecheck.log', console: () => !!process.env.POE2PC_DEBUG });

export function logFile(): string {
  return logger.file;
}

export function log(level: LogLevel, message: string, err?: unknown): void {
  logger.log(level, message, err);
}
