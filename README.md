<p align="center">
  <img src="resources/icon.png" width="120" alt="HZMM Logo">
</p>

<h1 align="center">HZMM Manager</h1>

<p align="center">
  <strong>The all-in-one mod manager for HumanitZ.</strong><br>
  Install, configure, and organize your mods — without ever touching a game folder.
</p>

<p align="center">
  <a href="https://github.com/uuuu790/HZMM/releases/latest">
    <img src="https://img.shields.io/github/v/release/uuuu790/HZMM?style=flat-square&color=4ade80" alt="Latest Release">
  </a>
  <a href="https://github.com/uuuu790/HZMM/releases">
    <img src="https://img.shields.io/github/downloads/uuuu790/HZMM/total?style=flat-square&color=38bdf8" alt="Total Downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/electron-42-47848F?style=flat-square&logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/license-All%20rights%20reserved-lightgrey?style=flat-square" alt="License">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="85%" alt="HZMM Dashboard">
</p>

---

## Contents

- [Why HZMM?](#why-hzmm)
- [Features](#features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
- [FAQ](#faq)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

## Why HZMM?

Modding HumanitZ usually means juggling `.pak` files by hand, hunting for the right install folder, editing config files in a text editor, and crossing your fingers that two mods don't clash. **HZMM does all of that for you.**

- **Drop a file, done.** No manual folder digging — HZMM detects the mod type and installs it in the right place.
- **Edit configs visually.** Toggles, sliders, and color pickers instead of raw text files.
- **Browse Nexus without leaving the app.** Find and install HumanitZ mods in one window.
- **Catch conflicts before they break your game.** HZMM scans for resource clashes and warns you up front.

A single, polished desktop app — no command line, no guesswork.

## Features

### 🧩 Mod Management
- **One-click install** — Drag & drop `.zip`, `.rar`, or `.pak` files to install mods instantly
- **PAK & UE4SS support** — Manage both resource mods (PAK) and script mods (UE4SS Lua/C++)
- **Inline rename** — Click any mod name to give it a custom display name
- **Conflict detection** — Scans PAK file indexes to detect resource-level conflicts between mods
- **Profile system** — Save and switch between mod configurations with one click

### ⚙️ Config Editor
- **Visual schema editor** — Auto-detected toggles, sliders, color pickers, keybinds, multi-select, string lists, and unified dropdowns ([schema spec](docs/CONFIG_SCHEMA.md))
- **Cross-key search** — Filter large schemas instantly across sections and descriptions
- **Reset to defaults** — One-click revert per section or whole schema
- **Section-aware collapse** — Large schemas fold by section to stay navigable
- **Multi-language descriptions** — Config copy follows the app language
- **Description tokens** — `{value}` interpolation in descriptions for live previews

### 🌐 Nexus Mods Integration
- **In-app browser** — Browse, search, and sort (Trending / Added / Updated / Downloaded) without leaving the app
- **No-key browsing** — An API key is only required to install; browsing works anonymously
- **Multi-file picker** — Pick the exact file variant when a mod ships multiple downloads
- **Installed badge** — Cards and the detail modal show which Nexus mods you already have
- **Per-file install state** — Tracks the specific file you installed, not just the mod
- **Persistent tracking** — Survives reinstall and rename

### 🎮 Engine & Game
- **One-click launch** — Start HumanitZ straight from the dashboard via Steam; launch is blocked if unresolved conflicts are detected
- **UE4SS engine management** — Auto-deploy and update the UE4SS scripting framework
- **Game detection** — Auto-detects the HumanitZ install path via the Steam registry
- **Game running alert** — Warns you before modifying files while the game is running

### 💾 Backup & Update
- **World save backup** — Back up world saves with a mod snapshot, restore anytime
- **Auto-update** — Checks GitHub for new releases, then downloads and replaces in place
- **Startup update pill** — Non-intrusive update notice on launch; opt-in "skip install preview" for fast updates

### ✨ User Experience
- **Splash screen** — Animated startup screen with logo and loading indicator
- **Multi-language** — 繁體中文, English, 日本語, 한국어, Русский, Deutsch, Français
- **6 theme presets** — Ember, Crimson, Toxic, Frost, Violet, Gold — each with Dark / Light mode
- **Logging** — All operations logged to `%APPDATA%/hzmm-manager/hzmm.log`

## Screenshots

<table>
  <tr>
    <td align="center" width="50%"><strong>Dashboard</strong><br><img src="docs/screenshots/dashboard.png" width="100%"></td>
    <td align="center" width="50%"><strong>Library</strong><br><img src="docs/screenshots/library.png" width="100%"></td>
  </tr>
  <tr>
    <td align="center" width="50%"><strong>Profiles</strong><br><img src="docs/screenshots/profiles.png" width="100%"></td>
    <td align="center" width="50%"><strong>Settings</strong><br><img src="docs/screenshots/settings.png" width="100%"></td>
  </tr>
</table>

## Getting Started

### Requirements

- **Windows 10 / 11**
- **HumanitZ** installed via Steam (HZMM auto-detects the install path)
- No runtime to install — the portable build is fully self-contained
- UE4SS is **deployed automatically** by HZMM; you don't need to install it yourself
- A free [Nexus Mods](https://www.nexusmods.com/) API key is optional — only needed to install mods through the in-app Nexus browser

### Download

1. Grab the latest portable `.exe` from [**Releases**](https://github.com/uuuu790/HZMM/releases/latest).
2. Run it — no installation required.
3. On first launch, HZMM detects your HumanitZ folder. If it can't, set the path manually in **Settings**.
4. Drag a mod onto the window, or open the **Nexus** tab to browse.

## FAQ

<details>
<summary><strong>Windows SmartScreen / my antivirus flags the .exe — is it safe?</strong></summary>

The portable build isn't code-signed, so Windows may show an "unknown publisher" warning. This is expected for an unsigned indie app — choose **More info → Run anyway**. The full source is in this repo if you'd rather build it yourself.
</details>

<details>
<summary><strong>HZMM can't find my game.</strong></summary>

HZMM looks up the install path through the Steam registry. If detection fails (e.g. a non-standard Steam library), open **Settings** and point it at your HumanitZ folder manually.
</details>

<details>
<summary><strong>Do I need to pay to use the Nexus browser?</strong></summary>

No. Browsing, searching, and sorting work anonymously and for free. Installing a mod *through the app* requires a Nexus API key — and Nexus restricts API-based downloads to Premium accounts. You can always download from the Nexus site in your browser and drag the file into HZMM instead.
</details>

<details>
<summary><strong>I clicked "Launch Game" and it refused to start.</strong></summary>

HZMM blocks launch when it detects unresolved mod conflicts, so you don't boot into a broken save. Resolve the flagged conflicts in the Library, then launch again.
</details>

<details>
<summary><strong>Which mod formats are supported?</strong></summary>

`.zip`, `.rar`, and raw `.pak` files — covering both resource mods (PAK) and script mods (UE4SS Lua/C++).
</details>

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | [Electron](https://www.electronjs.org/) 42 |
| Frontend | [React](https://react.dev/) 18 + [Tailwind CSS](https://tailwindcss.com/) 4 |
| Build | [electron-vite](https://electron-vite.org/) 5 + [electron-builder](https://www.electron.build/) 26 |
| Archive | [node-stream-zip](https://github.com/antelle/node-stream-zip) + [node-unrar-js](https://github.com/YuJianrong/node-unrar-js) |
| Sanitizer | [DOMPurify](https://github.com/cure53/DOMPurify) (Nexus description rendering) |
| Icons | [Lucide React](https://lucide.dev/) |
| Testing | [Vitest](https://vitest.dev/) 4 + [Playwright](https://playwright.dev/) |

## Project Structure

```
src/
├── main/                   # Electron main process
│   ├── index.js            # App entry, window creation, IPC registration
│   ├── ipc/                # IPC handlers
│   │   ├── mods.js                  # Mod IPC registration + custom names
│   │   ├── mods-scan.js             # Mod scanning with in-memory cache
│   │   ├── mods-install.js          # Archive extraction & mod installation
│   │   ├── mods-config.js           # Per-mod config read / write
│   │   ├── mods-profiles.js         # Profile save / load / switch
│   │   ├── mods-readme.js           # Mod README discovery & rendering
│   │   ├── mods-registry.js         # UE4SS mods.txt / mods.json registry
│   │   ├── mods-download.js         # Direct download helpers
│   │   ├── nexus.js                 # Nexus Mods IPC surface
│   │   ├── nexus-v2-client.js       # Nexus v2 GraphQL client
│   │   ├── nexus-cache.js           # Nexus response cache
│   │   ├── nexus-install-tracker.js # Per-file installed-state tracking
│   │   ├── game.js                  # Game path detection, launch, running check
│   │   ├── ue4ss.js                 # UE4SS engine deploy & update
│   │   ├── settings.js              # Settings, file dialogs, shell commands
│   │   ├── locale.js                # Multi-language support
│   │   ├── saves.js                 # World save backup & restore
│   │   ├── app-update.js            # Auto-update check, download, install
│   │   ├── conflicts.js             # Mod conflict detection
│   │   └── constants.js             # IPC-side shared constants
│   └── services/           # Business logic
│       ├── archive.js          # ZIP/RAR extraction, mod type analysis
│       ├── config-store.js     # JSON config persistence
│       ├── path-safety.js      # isPathWithin / resolveWithin (zip-slip guard)
│       ├── steam-detector.js   # Steam path & game detection
│       ├── github-release.js   # UE4SS GitHub release fetcher
│       ├── app-updater.js      # App update checker & downloader
│       ├── pak-parser.js       # UE4 PAK binary index reader
│       ├── process-detector.js # Game process detection
│       ├── readme-utils.js     # README markdown helpers
│       └── logger.js           # File logger with rotation
├── preload/
│   └── index.js            # Context bridge (API exposure to renderer)
└── renderer/
    └── src/
        ├── App.jsx         # Main UI component
        ├── main.jsx        # React entry point
        ├── index.css       # Global styles
        ├── constants/
        │   └── i18n/       # Per-language string tables (de, en, fr, ja, ko, ru, zh-TW)
        ├── hooks/          # Custom React hooks
        │   ├── useToast.js          # Toast notification system
        │   ├── useConfirmModal.js   # Confirmation dialog state
        │   ├── useTheme.js          # Theme & dark mode management
        │   ├── useAppInit.js        # Game, UE4SS, conflict init
        │   ├── useModHandlers.jsx   # Mod CRUD operations
        │   ├── useBackupHandlers.js # Backup & restore
        │   ├── useProfileHandlers.js # Profile management
        │   ├── useUpdateHandlers.js # Auto-update
        │   └── profile-utils.js     # Profile diff / merge helpers
        └── components/
            ├── layout/     # App shell (Sidebar, AppHeader)
            ├── common/     # Shared UI primitives (GlassCard, Spinner, Toast, NexusModCard, ...)
            ├── tabs/       # Page-level views (Dashboard, Modules, Nexus, Profiles, Settings)
            └── modals/     # Dialog overlays
                └── config-editor/  # Schema renderer + per-type widgets (slider, color, keybind, ...)

tests/                      # Vitest unit tests for pure helpers (main/services + main/ipc)
e2e/                        # Playwright E2E tests (real Electron app)
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [npm](https://www.npmjs.com/) 9+

### Setup

```bash
git clone https://github.com/uuuu790/HZMM.git
cd HZMM
npm install
```

### Run in dev mode

```bash
npm run dev
```

### Build portable exe

```bash
npm run package
```

Output: `dist/HZMM Manager {version}.exe`

### Testing

**415 unit tests** (Vitest) + **18 E2E tests** (Playwright).

```bash
npm run test          # unit tests (one-shot)
npm run test:watch    # unit tests (watch mode)
npm run test:e2e      # E2E tests (requires built Electron app)
npm run check         # audit + lint + unit tests in one shot
```

Unit tests live in `tests/` and target pure helpers. E2E tests live in `e2e/` and launch the real Electron app. Any new IPC handler that builds a filesystem path from renderer input **must** use `resolveWithin` from `services/path-safety.js` and ship with a traversal test.

### Linting

```bash
npm run lint          # report
npm run lint:fix      # auto-fix safe rules
```

Main-process and preload code run under Node/Electron rules via `eslint-plugin-n`. The renderer runs under `eslint-plugin-react` + `react-hooks`. A custom rule bans `child_process.exec` with template literals — use `spawn` with an argv array instead.

## License

All rights reserved. The source is published for reference and transparency; it is not licensed for redistribution.
