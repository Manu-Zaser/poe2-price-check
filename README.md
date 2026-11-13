# PoE2 Preischeck

Kleines Overlay für Path of Exile 2: Maus über ein Item, **Strg+D** drücken, Preis erscheint neben dem Cursor.

> This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Starten

```bash
npm install
npm start
```

Das Hauptfenster zeigt Hotkey, League, Kurse und den Verlauf deiner Preischecks. Schließen beendet das Tool.

**Hotkey ändern:** Übersicht → „Hotkey ändern“ → neue Kombination drücken. Erlaubt sind Strg/Alt + Taste oder eine
F-Taste allein. Kombinationen wie Strg+C werden abgelehnt, weil das Spiel sie braucht. Esc bricht ab.
PoE2 im Modus **Fenster/Vollbild-Fenster** spielen, sonst liegt das Overlay unter dem Spiel.

## Was es kann

- **Währung, Fragmente, Runen, Essenzen, Gemmen usw.** → Preis pro Stück und für den Stapel (poe.ninja)
- **Uniques** (auch unidentifiziert: alle möglichen Uniques der Basis) (poe.ninja)
- **Rares und Magic-Items** → Suche auf der offiziellen Trade-Seite:
  - Mods werden automatisch den Stat-IDs der Trade-Suche zugeordnet (inkl. Runen, Implicits, lokaler Waffen-Stats;
    gleiche Stats aus mehreren Zeilen werden addiert).
  - Standard: explizite Mods mit ca. 85 % des Wertes, davon müssen die meisten passen (z. B. 4 von 6).
  - Im Overlay Mods an-/abhaken (auch Klick auf den Text), Mindestwerte per **Mausrad** ändern oder anklicken und
    eintippen (leer = ohne Minimum). Gesucht wird erst mit Klick auf **Suchen** (leuchtet auf, sobald etwas geändert wurde).
  - „Trade-Seite ↗“ öffnet dieselbe Suche im Browser.

poe.ninja wird höchstens einmal pro Stunde geladen, die Stat-Liste der Trade-Suche einmal am Tag
(`%APPDATA%\poe2-pricecheck\trade-stats.json`).

### Trade-Suche und Rate-Limits

Pro Rare-Preischeck gehen **zwei** Anfragen an pathofexile.com (Suche + Abruf der 10 günstigsten Angebote).
GGG erlaubt derzeit ca. 5 Suchen pro 10 s und 30 pro 5 Min.; wer das überschreitet, wird bis zu 30 Min. gesperrt.
Das Tool liest die Limits aus jeder Antwort, lässt eine Anfrage Puffer und meldet „bitte X s warten“, statt
blind weiterzufragen. Es wird kein Login/POESESSID verwendet.

Die Trade-Endpunkte (`/api/trade2`) sind **nicht** Teil der offiziell dokumentierten GGG-API. Alle verbreiteten
Preischeck-Tools nutzen sie; GGG kann das jederzeit ändern.

## Regeln (GGG Developer Docs)

- Ein Hotkey-Druck = **eine** Aktion im Spiel (ein Strg+C), Zwischenablage wird pro Druck einmal gelesen.
- Strg+C wird nur gesendet, wenn das Fenster „Path of Exile 2“ im Vordergrund ist. Sonst wird nur die aktuelle
  Zwischenablage geprüft (praktisch zum Testen).
- Kein Speicherlesen, keine Client-Änderung, keine Automatisierung.

## Overlay

- Bleibt offen, bis man es mit **×** (oder Esc) schließt; ein neuer Preischeck ersetzt den Inhalt.
- An der Kopfzeile ziehen, um es zu verschieben. Die Position wird gemerkt und für alle weiteren Preischecks
  verwendet (Einstellungen → „Position zurücksetzen“ = wieder neben dem Mauszeiger).
- Stürzt der Overlay-Inhalt ab, wird das Fenster automatisch neu erstellt, damit nichts Unsichtbares über dem
  Spiel liegen bleibt. Fehler landen in `%APPDATA%\poe2-pricecheck\poe2-pricecheck.log`.

## Leistung

Standardmäßig rendert das Tool **ohne GPU-Beschleunigung**, damit es dem Spiel keine Grafikleistung wegnimmt.
Animationen über dem Spiel laufen nur in groben Stufen. Einstellbar unter Einstellungen → Leistung (Neustart nötig).

## Konfiguration

Hotkey, League und Overlay-Dauer stellst du in der Oberfläche ein. Gespeichert wird alles in
`%APPDATA%\poe2-pricecheck\config.json`:

| Feld | Standard | Bedeutung |
|---|---|---|
| `league` | `""` | leer = aktuelle Challenge-League |
| `hotkey` | `Ctrl+D` | Electron-Accelerator |
| `gameWindowTitle` | `Path of Exile 2` | Fenstertitel des Spiels |
| `contact` | `""` | optionaler Kontakt im User-Agent |
| `overlayPosition` | `null` | gemerkte Overlay-Position (`null` = am Mauszeiger) |
| `gpuAcceleration` | `false` | GPU-Beschleunigung der App-Fenster |

## Entwicklung

```bash
npm test           # Vitest (Parser, Preisindex, Hotkeys, Mod-Zuordnung, Rate-Limits)
npm run typecheck  # tsc
```

Aufbau: `src/shared/parser.ts` (Item-Text), `src/shared/hotkey.ts` (Hotkey-Aufnahme und -Prüfung),
`src/shared/mods.ts` + `src/shared/stats.ts` (Mods → Trade-Stats, Suchanfrage), `src/main/trade.ts` + `src/main/ratelimit.ts` (Trade-API), `src/main/rare.ts` (Rare-Preischeck),
`src/main/ninja.ts` (Preise), `src/main/win32.ts` (Strg+C via SendInput), `src/main/index.ts` (Hotkey, Fenster, IPC),
`src/renderer/` (Hauptfenster `app.*`, Overlay `overlay.*`).

Debug-Ausgabe der Ergebnisse: Umgebungsvariable `POE2PC_DEBUG=1` setzen.
