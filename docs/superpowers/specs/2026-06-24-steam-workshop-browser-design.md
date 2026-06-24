# Steam Workshop Browser (dev-only) — Design Spec

**Date:** 2026-06-24
**Status:** Approved for planning
**Branch (planned):** `feat/steam-workshop-browser`

## Overview

Turn the existing dev-only **Steam Workshop** tab (currently a placeholder) into a
working, keyless Steam Workshop browser, using **tModLoader** (Steam App
`1281930`) as the live test target. The goal is to validate the data flow and
the visual layout for an eventual HumanitZ Workshop integration — HumanitZ has
no official Workshop yet, so this whole feature stays hidden in packaged builds
(`import.meta.env.DEV` gate, already in place on the tab).

## Goal

A complete list + detail browsing experience over Steam Workshop, fetched
**without any Steam Web API key**:

- List page: search box, sort tabs (trending / top-rated / most-recent), card
  grid (thumbnail + title + subscribers), pagination.
- Detail view: in-app modal reusing the Nexus detail visual language (banner,
  stat row, BBCode description, tags), with an "open in Steam" external link.

## Constraints (global)

- **Keyless only.** No Steam Web API key. (The key-based `QueryFiles` path was
  rejected — it 403s without a key.)
- **Dev-only.** Lives inside the `import.meta.env.DEV`-gated tab; production
  builds never show or reach it.
- **No subscribe / download / install.** Keyless subscribe is infeasible (needs
  Steam auth) and Terraria mods cannot install into HumanitZ anyway. The only
  per-item action is "open in Steam" (external browser).
- **Network only in main process.** The renderer calling `steamcommunity.com` /
  `api.steampowered.com` directly would hit CORS. All fetches go through main,
  exposed via IPC + preload — same shape as the existing Nexus client.
- **App ID is a named constant** (`STEAM_WORKSHOP_APP_ID = 1281930`) with a
  comment that it is the tModLoader test target, swappable for HumanitZ later.

## The two keyless endpoints (verified 2026-06-24)

1. **List** — `GET https://steamcommunity.com/workshop/browse/` (server-rendered
   HTML). Extract ordered, unique published-file IDs by matching
   `filedetails/?id=(\d+)` in the HTML. Verified: returns ~30 IDs/page.
   - Query params: `appid`, `browsesort`, `actualsort`, `p` (1-based page),
     `searchtext` (URL-encoded), and `days` (only for `trend`).
2. **Hydrate** — `POST https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`
   - `Content-Type: application/x-www-form-urlencoded`
   - Body: `itemcount=N&publishedfileids[0]=ID0&publishedfileids[1]=ID1…`
   - Verified: keyless, HTTP 200, batch of 5 returned full data. Each entry has
     `result` (1 = ok), `title`, `creator`, `preview_url`, `subscriptions`,
     `favorited`, `views`, `file_size`, `time_created`, `time_updated`,
     `tags[].tag`, and `description` (**BBCode**, e.g. `[h1][hr][b]`).

### Sort mapping (UI → `browsesort`)

| UI label (i18n) | `browsesort` | extra |
|---|---|---|
| Trending (熱門) | `trend` | `days=7` |
| Top Rated (最高評價) | `toprated` | — |
| Most Recent (最新) | `mostrecent` | — |

`actualsort` is set to the same value as `browsesort`.

## Architecture (mirrors the Nexus client)

```
main/ipc/steam-workshop-util.js     pure, unit-tested (no network)
  buildBrowseUrl({appId,sort,page,search}) -> string
  parseWorkshopIds(html)                   -> string[]  (ordered, unique)
  buildDetailsBody(ids)                    -> string    (form-encoded POST body)
  adaptWorkshopItem(raw)                   -> NormalizedItem | null  (null if result!=1)

main/ipc/steam-workshop-client.js   network + IPC (thin)
  browseWorkshop({sort,page,search}) -> { items: NormalizedItem[], page, hasNext }
      fetch browse HTML -> parseWorkshopIds -> POST GetPublishedFileDetails
      -> adaptWorkshopItem(each) -> filter nulls
  registerSteamWorkshopIpc()  ->  ipcMain.handle('steam:browse', …)

preload/index.js
  window.api.steam = {
    browse: (opts) => ipcRenderer.invoke('steam:browse', opts),
  }

renderer
  tabs/SteamWorkshopTab.jsx           list page (replaces placeholder)
  modals/SteamWorkshopDetailModal.jsx detail view (own component; reuses Nexus visuals)
```

### Normalized item shape (`adaptWorkshopItem` output)

```js
{
  id: '2831752947',                 // publishedfileid (string)
  title: 'LuiAFK Reborn',
  previewUrl: 'https://images.steamusercontent.com/…',  // preview_url
  subscriptions: 2070424,
  favorited: 50091,
  views: 1019127,
  fileSize: 3736327,                // bytes
  timeUpdated: 1715710825,          // unix seconds
  timeCreated: 1640000000,
  tags: ['quality of life', 'Utilities', '1.4.4', 'English'],  // tags[].tag
  descriptionBBCode: '[h1]LuiAFK Reborn[/h1]…',
  url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=2831752947',
}
```

Adaptation happens **in main** so the renderer receives ready-to-render objects
(cleaner than Nexus, which adapts in the renderer). `creator` (a raw steamid64)
is intentionally **not surfaced** — keyless persona resolution is out of scope,
and a bare 64-bit id is not worth displaying.

## Data flow

```
SteamWorkshopTab
  └─ window.api.steam.browse({sort,page,search})
       └─ IPC steam:browse
            └─ browseWorkshop()
                 1. GET buildBrowseUrl(...)            (HTML)
                 2. parseWorkshopIds(html)             (ordered IDs)
                 3. POST GetPublishedFileDetails       (buildDetailsBody(ids))
                 4. adaptWorkshopItem(each), drop nulls
                 5. return { items, page, hasNext }
  └─ card click -> SteamWorkshopDetailModal(item)      (already-hydrated item; no refetch)
```

The card grid already holds the full hydrated item (GetPublishedFileDetails
returns the complete description too), so the detail modal is fed the card's
item object directly — **no second fetch, and no per-item endpoint**.

`hasNext` heuristic: `items.length === PAGE_SIZE` (Steam default 30). Acceptable
for a dev tool; avoids parsing Steam's paging widget.

## UI

### List page (`SteamWorkshopTab.jsx`)

- Header row: search input (debounced) + sort tabs (3).
- Card grid: thumbnail (`previewUrl`), title (truncated), subscriber count
  (formatted). Hover lift, consistent with app design quality.
- Pagination: prev / next + page indicator; next disabled when `!hasNext`,
  prev disabled on page 1.
- States: loading (spinner), empty (`steamWorkshopEmpty`), error with retry
  (`steamWorkshopError` + `steamWorkshopRetry`).
- Resetting search or sort returns to page 1.

### Detail modal (`SteamWorkshopDetailModal.jsx`)

- Own component, **mirrors** the Nexus detail layout (does **not** reuse
  `NexusModDetailModal` internals — avoids coupling / breaking Nexus).
- Full-res banner (`previewUrl`), stat row (subscribers / favorites / views /
  updated date / file size), tag chips, BBCode description rendered through the
  existing [`bbcode.js`](../../../src/renderer/src/utils/bbcode.js) parser.
- Footer action: "open in Steam" → `window.api`/shell opens `item.url` in the
  external browser (reuse however the app already opens external Nexus links).
- Rendered via `createPortal` (same fixed-position-in-transformed-ancestor trap
  the other modals avoid).

## Resilience / error handling

- Main fetch helper decodes with **`Buffer.concat(chunks).toString('utf8')`**
  (not per-chunk string concat) — Workshop titles are heavily CJK; this is the
  same multibyte-chunk corruption already fixed for the Nexus V2 client.
- Send a `User-Agent` header on both requests.
- Timeout per request; non-200 → throw, surfaced as the renderer error state.
- `parseWorkshopIds` returning `[]` on a 200 response → treated as "no results"
  (empty state). Main logs a warning so a future Steam markup change is
  diagnosable.
- `GetPublishedFileDetails` entries with `result !== 1` (deleted / hidden) are
  dropped by `adaptWorkshopItem` (returns `null`) and filtered out.
- One `browse` + one batch `GetPublishedFileDetails` per page — gentle on Steam.

## i18n (7 locales: en, zh-TW, de, fr, ja, ko, ru)

Add:
- `steamWorkshopSearch` — search placeholder
- `steamWorkshopSortTrend` / `steamWorkshopSortTopRated` / `steamWorkshopSortRecent`
- `steamWorkshopSubscribers` — subscriber count label
- `steamWorkshopEmpty` — empty state
- `steamWorkshopError` / `steamWorkshopRetry` — error state
- `steamWorkshopOpenInSteam` — detail footer action

Remove (placeholder is gone): `steamWorkshopComingSoon` from all 7 locales.
Keep `steamWorkshop` (nav label).

## Testing (vitest)

`tests/ipc/steam-workshop-util.test.js` covering the pure core:
- `buildBrowseUrl` — sort→`browsesort` mapping, `days=7` only for trend,
  `searchtext` URL-encoding, 1-based `p`, fixed `appid`.
- `parseWorkshopIds` — extracts ordered unique IDs from an HTML fixture;
  dedupes repeated links; returns `[]` for HTML with no matches.
- `buildDetailsBody` — `itemcount` + indexed `publishedfileids[i]` for a list.
- `adaptWorkshopItem` — maps all fields; builds `url`; flattens `tags[].tag`;
  returns `null` when `result !== 1`; tolerates missing optional fields.

Network functions (`browseWorkshop`, `getWorkshopItem`) stay thin and are not
unit-tested (the logic lives in the pure helpers).

## File structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/main/ipc/steam-workshop-util.js` | pure helpers (testable, no network) |
| Create | `src/main/ipc/steam-workshop-client.js` | network fetches + IPC registration |
| Modify | `src/main/index.js` | call `registerSteamWorkshopIpc()` |
| Modify | `src/preload/index.js` | expose `window.api.steam` |
| Modify | `src/renderer/src/components/tabs/SteamWorkshopTab.jsx` | placeholder → list browser |
| Create | `src/renderer/src/components/modals/SteamWorkshopDetailModal.jsx` | detail view |
| Modify | `src/renderer/src/constants/i18n/*.js` (×7) | add/remove keys above |
| Create | `tests/ipc/steam-workshop-util.test.js` | pure-helper tests |

## Out of scope (YAGNI)

- Steam Web API key / `QueryFiles` path.
- Subscribe / download / install of workshop items.
- Author persona-name resolution (no keyless source).
- Special handling of Workshop collections (treated as plain items).
- Caching of browse results (one fetch per navigation; revisit only if needed).
