# PoE2 Price Check

A small overlay for Path of Exile 2: hover over an item, press **Ctrl+D**, and the price appears next to the cursor.

> This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Getting started

```bash
npm install
npm start
```

The main window shows the hotkey, league, exchange rates and the history of your price checks. Closing it quits the tool.

**Changing the hotkey:** Overview → "Change hotkey" → press the new combination. Allowed are Ctrl/Alt + key or a single
F key. Combinations such as Ctrl+C are rejected because the game needs them. Esc cancels.
Play PoE2 in **windowed / windowed fullscreen** mode, otherwise the overlay ends up behind the game.

## Features

- **Currency, fragments, runes, essences, gems, etc.** → price per unit and for the whole stack (poe.ninja)
- **Uniques** (including unidentified ones: all possible uniques for that base) (poe.ninja)
- **Rare and magic items** → search on the official trade site:
  - Mods are mapped to the trade search's stat IDs automatically (including runes, implicits and local weapon stats;
    identical stats from several lines are added up).
  - Default minimums = your item's own values (rounded down to one decimal place); most of the mods have to match
    (e.g. 4 of 6).
  - **Tiers:** every mod shows prefix/suffix and tier (e.g. "P T7"). In PoE2, a higher tier number is better.
  - In the overlay, tick or untick mods (clicking the text works too), change minimums with the **mouse wheel**, or
    click and type them (empty = no minimum). The search only runs when you click **Search** (it lights up as soon as
    something has changed). The toggles "Instant buyout only", "All ticked mods must match" and "Only base" search
    again immediately.
  - "Trade site ↗" opens the same search in your browser.
  - **Totals (pseudo stats):** resistances, life, mana and attributes are combined into totals
    (e.g. "+45% total elemental resistance") and the individual mods are unticked — this finds far more comparable items.
  - **Weapons:** total, physical and elemental DPS are calculated from the item's properties; by default the search
    uses the dominant value and unticks the damage mods it already contains.
  - **Armour:** armour, evasion and energy shield (as displayed, including quality) are searched as minimums, block and
    spirit optionally; the local defence mods they contain are unticked.
  - **Filters:** corrupted state (on by default: only items with the same state), item level and rune sockets
    (optional), **Instant buyout only** (on by default, current instant-buyout prices only).
  - **Suggested selling price:** slightly below the median of the 3 cheapest listings, with a button to copy it as a
    stash note (e.g. `~b/o 58 exalted`).
  - Listings are sorted by their value according to poe.ninja (GGG sorts by its own rates).

poe.ninja is fetched at most once per hour, the trade search's stat list once per day
(`%APPDATA%\poe2-pricecheck\trade-stats.json`).

### Trade search and rate limits

Each rare price check sends **two** requests to pathofexile.com (search + fetching the 10 cheapest listings).
GGG currently allows about 5 searches per 10 s and 30 per 5 min; exceeding that gets you blocked for up to 30 min.
The tool reads the limits from every response, keeps one request in reserve and shows "please wait X s" instead of
retrying blindly. No login / POESESSID is used.

The trade endpoints (`/api/trade2`) are **not** part of GGG's officially documented API. All common price-check tools
use them; GGG may change them at any time.

## Rules (GGG developer docs)

- One hotkey press = **one** action in the game (a single Ctrl+Alt+C = advanced copy including tiers); the clipboard
  is read once per press.
- The copy keystroke is only sent when the "Path of Exile 2" window is in the foreground. Otherwise only the current
  clipboard is checked (handy for testing).
- No memory reading, no client modification, no automation.

## Overlay

- Stays open until you close it with **×** (or Esc); a new price check replaces its content.
- Drag it by any empty spot to move it (a short click stays a click). The position is remembered and used for all
  further price checks (Settings → "Reset position" = back next to the mouse cursor).
- If the overlay content crashes, the window is recreated automatically so nothing invisible is left on top of the
  game. Errors are written to `%APPDATA%\poe2-pricecheck\poe2-pricecheck.log`.

## Performance

By default the tool renders **without GPU acceleration** so it doesn't take graphics performance away from the game.
Animations on top of the game only run in coarse steps. Configurable under Settings → Performance (restart required).

## Configuration

Hotkey, league and overlay settings are set in the UI. Everything is stored in
`%APPDATA%\poe2-pricecheck\config.json`:

| Field | Default | Meaning |
|---|---|---|
| `league` | `""` | empty = current challenge league |
| `hotkey` | `Ctrl+D` | Electron accelerator |
| `gameWindowTitle` | `Path of Exile 2` | window title of the game |
| `contact` | `""` | optional additional contact in the User-Agent (the project URL is always sent) |
| `overlayScale` | `1.15` | overlay size (0.8–1.6) |
| `overlayPosition` | `null` | remembered overlay position (`null` = at the mouse cursor) |
| `gpuAcceleration` | `false` | GPU acceleration for the app windows |

## Building the exe

```bash
npm run dist
```

Creates `release/PoE2-Price-Check-<version>.exe` — a portable file that needs no installation and can be shared.
The exe is not signed: on first launch Windows shows "Windows protected your PC" → "More info" → "Run anyway".
Settings live in `%APPDATA%\poe2-pricecheck`.

## Development

```bash
npm test           # Vitest (parser, price index, hotkeys, mod mapping, rate limits)
npm run typecheck  # tsc
```

Layout: `src/shared/parser.ts` (item text), `src/shared/hotkey.ts` (hotkey capture and validation),
`src/shared/mods.ts` + `src/shared/stats.ts` (mods → trade stats, search query), `src/main/trade.ts` +
`src/main/ratelimit.ts` (trade API), `src/main/rare.ts` (rare price check), `src/main/ninja.ts` (prices),
`src/main/win32.ts` (copy keystroke via SendInput), `src/main/index.ts` (hotkey, windows, IPC),
`src/renderer/` (main window `app.*`, overlay `overlay.*`).

Debug output of the results: set the environment variable `POE2PC_DEBUG=1`.

## License and legal

Code licensed under the [MIT License](LICENSE).

Path of Exile is a trademark of Grinding Gear Games. This project is an unofficial fan tool; it is not affiliated with,
endorsed by or reviewed by GGG. Game content (item texts, stat descriptions) belongs to GGG; price data comes from
[poe.ninja](https://poe.ninja). Requests to pathofexile.com and poe.ninja carry a User-Agent with the project URL so
the operators can identify the sender.
