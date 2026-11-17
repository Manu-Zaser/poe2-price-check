/**
 * Texterkennung mit der in Windows eingebauten OCR (Windows.Media.Ocr) – keine zusätzliche Software.
 * Ein versteckter PowerShell-Prozess lädt die Erkennung einmal und beantwortet dann Anfragen: eine
 * Bilddatei pro Zeile auf stdin, eine JSON-Zeile mit den erkannten Textzeilen (samt Position) auf stdout.
 * Bevorzugt Englisch (der Spieltext), sonst die Sprache des Windows-Profils.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { OcrLine } from '../shared/rewards';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(); $task.Result }
$en = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag -like 'en*' } | Select-Object -First 1
$engine = if ($en) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($en) } else { [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { [Console]::Out.WriteLine('{"fatal":"Windows text recognition is not available."}'); exit 1 }
[Console]::Out.WriteLine((@{ ready = $true; lang = $engine.RecognizerLanguage.LanguageTag } | ConvertTo-Json -Compress))
while ($null -ne ($path = [Console]::In.ReadLine())) {
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    $lines = @()
    foreach ($line in $result.Lines) {
      $x0 = 1e9; $y0 = 1e9; $x1 = 0; $y1 = 0
      foreach ($w in $line.Words) {
        $b = $w.BoundingRect
        if ($b.X -lt $x0) { $x0 = $b.X }; if ($b.Y -lt $y0) { $y0 = $b.Y }
        if ($b.X + $b.Width -gt $x1) { $x1 = $b.X + $b.Width }; if ($b.Y + $b.Height -gt $y1) { $y1 = $b.Y + $b.Height }
      }
      $lines += @{ text = $line.Text; x0 = [int]$x0; y0 = [int]$y0; x1 = [int]$x1; y1 = [int]$y1 }
    }
    [Console]::Out.WriteLine((@{ lines = $lines } | ConvertTo-Json -Compress -Depth 4))
  } catch {
    [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
}
`;

export class WindowsOcr {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<string> | null = null;
  private queue: ((v: { lines?: OcrLine[]; error?: string }) => void)[] = [];

  /** @param scriptDir Ordner, in den das PowerShell-Skript geschrieben wird (z. B. userData). */
  constructor(private readonly scriptDir: string) {}

  /** Startet die Erkennung (einmal); liefert die Sprache, z. B. "en-US". */
  start(): Promise<string> {
    if (this.ready) return this.ready;
    this.ready = new Promise<string>((resolve, reject) => {
      const file = join(this.scriptDir, 'ocr.ps1');
      writeFileSync(file, SCRIPT, 'utf8');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      let started = false;
      createInterface({ input: child.stdout }).on('line', (line) => {
        let msg: { ready?: boolean; lang?: string; fatal?: string; lines?: unknown; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (!started) {
          started = true;
          if (msg.ready) resolve(msg.lang ?? '');
          else reject(new Error(msg.fatal ?? 'Windows text recognition did not start.'));
          return;
        }
        const raw = msg.lines === undefined ? [] : Array.isArray(msg.lines) ? msg.lines : [msg.lines];
        this.queue.shift()?.(msg.error ? { error: msg.error } : { lines: raw as OcrLine[] });
      });
      child.on('error', (e) => {
        if (!started) reject(e);
      });
      child.on('exit', () => {
        for (const cb of this.queue) cb({ error: 'Windows text recognition stopped.' });
        this.queue = [];
        this.child = null;
        this.ready = null;
        if (!started) reject(new Error('Windows text recognition did not start.'));
      });
    });
    return this.ready;
  }

  /** Erkennt den Text einer Bilddatei (PNG/JPG). */
  async recognize(imagePath: string, timeoutMs = 10_000): Promise<OcrLine[]> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error('Windows text recognition is not running.');
    return new Promise<OcrLine[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Text recognition took too long.')), timeoutMs);
      this.queue.push((r) => {
        clearTimeout(timer);
        if (r.error) reject(new Error(r.error));
        else resolve(r.lines ?? []);
      });
      child.stdin.write(imagePath.replace(/\r?\n/g, '') + '\n');
    });
  }

  stop() {
    this.child?.stdin.end();
    this.child = null;
    this.ready = null;
  }
}
